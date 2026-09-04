"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ThreatRadar, type RadarEvent } from "./threat-radar";
import { LivePipeline } from "./live-pipeline";
import { useVerificationStream } from "@/components/verification/use-verification-stream";

/**
 * The live agent.
 *
 * A viewer with no token sees the agent working and can read everything. The
 * operator strip — token, scenario picker, inject — is folded away behind a
 * disclosure, because PRD §1.5 asks for screens a real user would want to look
 * at, and "bypass stage 02" is not one of them for anybody but us.
 *
 * All four scripted scenarios are reachable here. Only one was before, which
 * left the exchange-freeze decision beat and the debunk rollback beat with no
 * way to run them from the browser.
 */

interface Scenario {
  id: string;
  name: string;
  rawText: string;
  expectedTier: string;
}

interface Counters {
  screened: number;
  kept: number;
  rejected: number;
  /** Rendered when the data arrived: reading the clock during render is impure. */
  lastPollLabel: string;
  polling: boolean;
}

/** Read the clock once, when the payload lands, never during a render. */
function relativeLabel(iso: string | null): string {
  if (!iso) return "not yet";
  const secs = Math.floor((Date.now() - Date.parse(iso)) / 1000);
  if (secs < 60) return `${secs}s ago`;
  return `${Math.floor(secs / 60)}m ago`;
}

const OPERATOR_TOKEN_KEY = "nutshell_operator_token";

export function AgentConsole() {
  const { run, stage, isRunning, start, restore, reset } = useVerificationStream({
    persist: true,
  });

  const [agentStatus, setAgentStatus] = useState<"ARMED" | "PAUSED">("ARMED");
  const [execMode, setExecMode] = useState<"AUTONOMOUS" | "APPROVAL_REQUIRED" | "MONITOR_ONLY">(
    "AUTONOMOUS",
  );
  const [events, setEvents] = useState<RadarEvent[]>([]);
  const [counters, setCounters] = useState<Counters | null>(null);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioId, setScenarioId] = useState("scen_bridge_exploit");
  const [operatorToken, setOperatorToken] = useState("");
  const [showOperator, setShowOperator] = useState(false);
  const [openStages, setOpenStages] = useState<Record<string, boolean>>({});

  // One token per session, shared with the other operator surfaces. Held in
  // sessionStorage rather than state alone so moving between pages does not
  // mean typing it again; it never leaves the browser except as a bearer
  // header, and the server is the only thing that can validate it.
  useEffect(() => {
    // Deferred rather than run inline: setting state in an effect body commits
    // a second render before paint, which the compiler flags.
    const t = setTimeout(() => {
      try {
        const saved = sessionStorage.getItem(OPERATOR_TOKEN_KEY);
        if (saved) {
          setOperatorToken(saved);
          setShowOperator(true);
        }
      } catch {
        /* private mode; the field just starts empty */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const rememberToken = useCallback((value: string) => {
    setOperatorToken(value);
    try {
      if (value.trim()) sessionStorage.setItem(OPERATOR_TOKEN_KEY, value.trim());
      else sessionStorage.removeItem(OPERATOR_TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  // Control state, counters and the screening history, on one timer.
  useEffect(() => {
    let cancelled = false;

    const pull = async () => {
      try {
        // Two event calls, deliberately. A busy day pushes the handful of
        // promoted items past any reasonable slice of the recent list, and
        // those are exactly the ones the radar plots a real score for — so
        // they are asked for by name rather than hoped for in the window.
        const [statusRes, ingestRes, recentRes, keptRes] = await Promise.all([
          fetch("/api/control/status"),
          fetch("/api/ingest"),
          fetch("/api/events?limit=80"),
          fetch("/api/events?kept=true&limit=40"),
        ]);
        if (cancelled) return;

        if (statusRes.ok) {
          const d = await statusRes.json();
          if (d?.status) setAgentStatus(d.status);
          if (d?.mode) setExecMode(d.mode);
        }
        if (ingestRes.ok) {
          const d = await ingestRes.json();
          setCounters({
            screened: d.screened ?? 0,
            kept: d.kept ?? 0,
            rejected: d.rejected ?? 0,
            lastPollLabel: relativeLabel(d.lastPollAt),
            polling: Boolean(d.polling),
          });
        }
        const recent = recentRes.ok ? await recentRes.json() : [];
        const kept = keptRes.ok ? await keptRes.json() : [];
        if (Array.isArray(recent) || Array.isArray(kept)) {
          const byId = new Map<string, RadarEvent>();
          for (const e of [...(recent ?? []), ...(kept ?? [])] as RadarEvent[]) {
            byId.set(e.id, e);
          }
          setEvents([...byId.values()]);
        }
      } catch {
        /* the next tick retries */
      }
    };

    const first = setTimeout(pull, 0);
    const repeat = setInterval(pull, 10_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(repeat);
    };
  }, []);

  useEffect(() => {
    fetch("/api/scenarios")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => Array.isArray(d) && setScenarios(d))
      .catch(() => {});
  }, []);

  // Reattach to a run that was in flight when the tab was last open.
  useEffect(() => {
    const stored = (() => {
      try {
        return sessionStorage.getItem("nutshell_active_job");
      } catch {
        return null;
      }
    })();
    if (!stored) return;
    const t = setTimeout(() => void restore(stored), 0);
    return () => clearTimeout(t);
  }, [restore]);

  // Keep the active stage open as the run advances.
  useEffect(() => {
    if (stage === "IDLE" || stage === "COMPLETE") return;
    const t = setTimeout(() => {
      setOpenStages((prev) => (prev[stage] ? prev : { ...prev, [stage]: true }));
      document.getElementById(`stage-${stage}`)?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }, 150);
    return () => clearTimeout(t);
  }, [stage]);

  const inject = useCallback(
    (skipInvestigation: boolean) => {
      if (!operatorToken.trim()) return;
      setOpenStages({ "01_DETECT": true });
      void start({
        scenarioId,
        skipInvestigation,
        dryRun: true,
        operatorToken,
      });
    },
    [operatorToken, scenarioId, start],
  );

  const toggleStage = useCallback((id: string) => {
    setOpenStages((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const expandAll = useCallback(() => {
    setOpenStages({
      "01_DETECT": true,
      "02_INVESTIGATE": true,
      "03_ANALYZE": true,
      "04_CHALLENGE": true,
      "05_DECIDE": true,
      "06_PROTECT": true,
    });
  }, []);

  const modeLabel =
    execMode === "AUTONOMOUS"
      ? "Autonomous"
      : execMode === "APPROVAL_REQUIRED"
        ? "Approval required"
        : "Monitor only";

  return (
    <div className="space-y-6">
      {/* ── Heartbeat ─────────────────────────────────────────────────── */}
      <div className="space-y-4 rounded-2xl border border-cyan-900/40 bg-gradient-to-r from-[#070e17] via-[#09131f] to-[#06090e] p-5 font-mono-code shadow-xl">
        <div className="flex flex-col justify-between gap-4 border-b border-cyan-950/80 pb-3.5 md:flex-row md:items-center">
          <div className="flex items-center gap-3">
            <span className="relative flex h-3 w-3">
              {agentStatus === "ARMED" ? (
                <>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500" />
                </>
              ) : (
                <span className="relative inline-flex h-3 w-3 rounded-full bg-amber-500" />
              )}
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2 text-sm font-bold tracking-wider text-white">
                <span>NUTSHELL AGENT</span>
                <span
                  className={`rounded border px-2 py-0.5 text-[10px] font-normal ${
                    agentStatus === "ARMED"
                      ? "border-emerald-500/30 bg-emerald-950 text-emerald-300"
                      : "border-amber-500/30 bg-amber-950 text-amber-300"
                  }`}
                >
                  {agentStatus === "ARMED" ? "MONITORING" : "PAUSED"}
                </span>
                <span className="rounded border border-cyan-500/30 bg-cyan-950 px-2 py-0.5 text-[10px] font-normal text-cyan-300">
                  {modeLabel}
                </span>
              </div>
              <div className="mt-0.5 font-sans text-xs text-zinc-400">
                Reading eight newswires and Base mainnet · Thetanuts OptionBook
              </div>
            </div>
          </div>

          <Link
            href="/control"
            className="self-start rounded-lg border border-[#2d3748] px-3.5 py-1.5 text-[11px] font-bold text-zinc-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300 md:self-auto"
          >
            Console →
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          {[
            {
              label: "Headlines screened",
              value: counters ? counters.screened.toLocaleString() : "—",
              tone: "text-white",
            },
            {
              label: "Passed screening",
              value: counters ? counters.kept.toLocaleString() : "—",
              tone: "text-emerald-400",
            },
            {
              label: "Dismissed",
              value: counters ? counters.rejected.toLocaleString() : "—",
              tone: "text-cyan-300",
            },
            {
              label: "Last scan",
              value: counters?.polling ? counters.lastPollLabel : "poller off",
              tone: "text-zinc-300",
            },
          ].map((k) => (
            <div key={k.label} className="rounded-xl border border-cyan-950 bg-[#09111c]/80 p-2.5">
              <div className="text-[11px] text-zinc-400">{k.label}</div>
              <div className={`mt-0.5 text-sm font-bold ${k.tone}`}>{k.value}</div>
            </div>
          ))}
        </div>

        {/* ── Operator ─────────────────────────────────────────────────── */}
        <div className="rounded-xl border border-[#1e2433] bg-[#05070b]">
          <button
            type="button"
            onClick={() => setShowOperator((v) => !v)}
            className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left"
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
              Operator controls
            </span>
            <span className="text-[10px] text-cyan-400">{showOperator ? "Hide ▲" : "Show ▼"}</span>
          </button>

          {showOperator && (
            <div className="animate-fadeIn space-y-3 border-t border-[#1e2433] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Scenario
                  </span>
                  <select
                    value={scenarioId}
                    onChange={(e) => setScenarioId(e.target.value)}
                    disabled={isRunning}
                    className="mt-1 w-full cursor-pointer rounded-lg border border-[#2d3748] bg-[#0a0f18] px-3 py-2 text-xs text-zinc-200 focus:border-cyan-500/60 focus:outline-none disabled:opacity-50"
                  >
                    {scenarios.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — measured {s.expectedTier}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                    Operator token
                  </span>
                  <input
                    type="password"
                    value={operatorToken}
                    onChange={(e) => rememberToken(e.target.value)}
                    placeholder="OPERATOR_TOKEN"
                    className="mt-1 w-full rounded-lg border border-[#2d3748] bg-[#0a0f18] px-3 py-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => inject(false)}
                  disabled={isRunning || agentStatus === "PAUSED" || !operatorToken.trim()}
                  className="cursor-pointer rounded-xl bg-gradient-to-r from-red-500 via-amber-500 to-emerald-400 px-5 py-2.5 text-xs font-black text-zinc-950 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:from-zinc-800 disabled:via-zinc-800 disabled:to-zinc-800 disabled:text-zinc-500"
                  title="Measures Base mainnet first, then scores the claim against it."
                >
                  {isRunning ? "RUN IN FLIGHT…" : "INJECT — FULL PIPELINE"}
                </button>
                <button
                  type="button"
                  onClick={() => inject(true)}
                  disabled={isRunning || agentStatus === "PAUSED" || !operatorToken.trim()}
                  className="cursor-pointer rounded-xl border border-amber-500/60 bg-amber-950/50 px-5 py-2.5 text-xs font-black text-amber-200 transition-all hover:bg-amber-900/50 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                  title="Skips stage 02, so the models score the wording alone."
                >
                  BYPASS STAGE 02
                </button>
                {run.jobId && !isRunning && (
                  <button
                    type="button"
                    onClick={reset}
                    className="cursor-pointer rounded-xl border border-[#2d3748] px-4 py-2.5 text-xs font-bold text-zinc-400 transition-colors hover:text-zinc-200"
                  >
                    Clear
                  </button>
                )}
              </div>

              <p className="text-[10px] leading-relaxed text-zinc-500">
                {agentStatus === "PAUSED"
                  ? "The agent is paused. Resume it in the console before injecting."
                  : operatorToken.trim()
                    ? "Injections run as the operator and are trade-eligible, but stay in dry run unless the process was started with live trading on."
                    : "A token is required. Without one, use the public verify box on the landing page — it runs the same pipeline and cannot trade."}
              </p>

              {run.error && (
                <p className="rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-[11px] text-red-300">
                  {run.error}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Radar ─────────────────────────────────────────────────────── */}
      <div className="rgb-liquid-border-lg">
        <div className="rounded-[calc(1.5rem-1.5px)] bg-gradient-to-b from-[#090e17] via-[#06090e] to-[#040609] p-6 shadow-2xl">
          <ThreatRadar
            events={events}
            live={{ consensus: run.consensus, running: isRunning, jobId: run.jobId }}
            agentPaused={agentStatus === "PAUSED"}
          />
        </div>
      </div>

      {/* ── Pipeline ──────────────────────────────────────────────────── */}
      {run.jobId && (
        <LivePipeline
          run={run}
          stage={stage}
          open={openStages}
          onToggle={toggleStage}
          onExpandAll={expandAll}
          onCollapseAll={() => setOpenStages({})}
        />
      )}
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Navigation } from "@/components/navigation";
import { useOperatorToken } from "@/components/console/use-operator-token";

/**
 * Everything that belongs to the operator, on one page.
 *
 * It was two: /control held the live switches and /configuration held the
 * persistent policy, with overlapping and contradictory mode controls on both.
 * Neither said which one was in force, and one of them saved nothing at all —
 * its Save button set a flag that made the label read CONFIGURATION SAVED and
 * did not touch the server.
 *
 * The split that survives is the one that is real: what changes right now, and
 * what the agent runs by default. Both write to the server, both are read back
 * from it, and one operator token covers the page.
 */

type RiskTier = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
type Mode = "AUTONOMOUS" | "APPROVAL_REQUIRED" | "MONITOR_ONLY";

interface Settings {
  riskTier: RiskTier;
  hardCeilingUsdc: string;
  dailyCapPercent: number;
  truthHedge: number;
  truthFull: number;
  agreement: number;
  agreementFull: number;
  executionMode: Mode;
  matchesPreset: boolean;
}

interface IngestStats {
  polling: boolean;
  polls: number;
  screened: number;
  kept: number;
  rejected: number;
  lastPollError: string | null;
}

interface Health {
  status?: string;
  rpc?: { reachable: boolean; blockNumber: number | null; chainId: number | null };
  book?: { reachable: boolean; orderCount: number | null; vanillaPutCount: number | null };
  clock?: { withinLimit: boolean; localSkewSeconds: number | null };
  burner?: { address: string | null; canSign: boolean };
}

const TIER_COPY: Record<RiskTier, { dot: string; name: string; blurb: string }> = {
  CONSERVATIVE: {
    dot: "bg-emerald-400",
    name: "Conservative",
    blurb: "Acts only on overwhelming evidence. Fewer hedges, higher confidence in each.",
  },
  BALANCED: {
    dot: "bg-cyan-400",
    name: "Balanced",
    blurb: "The measured defaults. Hedges when two of three models agree it is real.",
  },
  AGGRESSIVE: {
    dot: "bg-amber-400",
    name: "Aggressive",
    blurb: "Reacts earlier on weaker signals. More hedges, more premium spent on false alarms.",
  },
};

const MODE_COPY: Record<Mode, { icon: string; name: string; blurb: string }> = {
  AUTONOMOUS: {
    icon: "🤖",
    name: "Autonomous",
    blurb:
      "Buys the put itself when a verified crisis clears policy, then sends you the receipt.",
  },
  APPROVAL_REQUIRED: {
    icon: "✋",
    name: "Operator approval",
    blurb:
      "Investigates, decides and sizes, then stops and alerts you. Nothing is spent until you approve it on the incident record.",
  },
  MONITOR_ONLY: {
    icon: "👁",
    name: "Monitor only",
    blurb: "Runs the full verification and records it. Never touches funds.",
  },
};

function Panel({
  n,
  title,
  subtitle,
  children,
  danger,
}: {
  n: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <section
      className={`space-y-4 rounded-2xl border p-6 shadow-xl ${
        danger
          ? "border-l-4 border-red-500 bg-gradient-to-b from-[#18080c] to-[#0d0407]"
          : "border-cyan-950 bg-[#09111c]"
      }`}
    >
      <div className="space-y-0.5 border-b border-[#1e2433] pb-3">
        <h2
          className={`font-mono-code text-xs font-bold uppercase tracking-wider ${
            danger ? "text-red-400" : "text-white"
          }`}
        >
          {n} · {title}
        </h2>
        {subtitle && <p className="text-[11px] leading-relaxed text-zinc-400">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export default function ConsolePage() {
  const { token, setToken, authHeaders, hasToken } = useOperatorToken();

  const [status, setStatus] = useState<"ARMED" | "PAUSED">("ARMED");
  const [liveMode, setLiveMode] = useState<Mode>("AUTONOMOUS");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [ingest, setIngest] = useState<IngestStats | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const say = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, c, i, h] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/control/status"),
        fetch("/api/ingest"),
        fetch("/api/health"),
      ]);
      if (s.ok) setSettings(await s.json());
      if (c.ok) {
        const d = await c.json();
        if (d?.status) setStatus(d.status);
        if (d?.mode) setLiveMode(d.mode);
      }
      if (i.ok) setIngest(await i.json());
      if (h.ok) setHealth(await h.json());
    } catch {
      /* the next action retries */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const repeat = setInterval(() => void refresh(), 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(repeat);
    };
  }, [refresh]);

  const patchSettings = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!hasToken) {
        say("An operator token is required to change policy.");
        return;
      }
      setBusy("settings");
      try {
        const res = await fetch("/api/settings", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) {
          say(data?.error?.message ?? "Could not save.");
          return;
        }
        setSettings(data);
        say("Policy saved. The pipeline reads it on the next run.");
      } catch (e) {
        say(e instanceof Error ? e.message : "Could not save.");
      } finally {
        setBusy(null);
      }
    },
    [authHeaders, hasToken, say],
  );

  const setControl = useCallback(
    async (patch: { status?: string; mode?: Mode }) => {
      setBusy("control");
      try {
        const res = await fetch("/api/control/status", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify(patch),
        });
        const d = await res.json();
        if (d?.status) setStatus(d.status);
        if (d?.mode) setLiveMode(d.mode);
        say(
          patch.status
            ? patch.status === "PAUSED"
              ? "Agent paused. Scanning and execution are stopped; verification still answers."
              : "Agent resumed."
            : `Live mode is now ${patch.mode}.`,
        );
      } catch {
        say("Could not reach the control endpoint.");
      } finally {
        setBusy(null);
      }
    },
    [authHeaders, say],
  );

  const ingestAction = useCallback(
    async (action: "start" | "stop" | "poll") => {
      if (!hasToken) {
        say("An operator token is required to drive the poller.");
        return;
      }
      setBusy(action);
      try {
        const res = await fetch("/api/ingest", {
          method: "POST",
          headers: { "content-type": "application/json", ...authHeaders() },
          body: JSON.stringify({ action }),
        });
        const d = await res.json();
        if (!res.ok) {
          say(d?.error?.message ?? "The poller refused.");
          return;
        }
        if (action === "poll" && d.result) {
          say(
            `Read ${d.result.fetched} headlines · ${d.result.fresh} new · ${d.result.kept} passed screening.`,
          );
        } else {
          say(action === "start" ? "Poller started." : "Poller stopped.");
        }
        await refresh();
      } catch {
        say("Could not reach the poller.");
      } finally {
        setBusy(null);
      }
    },
    [authHeaders, hasToken, refresh, say],
  );

  const testTelegram = useCallback(async () => {
    setBusy("telegram");
    try {
      const res = await fetch("/api/control/telegram", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json();
      say(d?.ok ? "Test ping sent — check your phone." : `Telegram: ${d?.error ?? "not configured"}`);
    } catch {
      say("Could not reach the Telegram endpoint.");
    } finally {
      setBusy(null);
    }
  }, [say]);

  const abandonHedge = useCallback(async () => {
    if (!hasToken) {
      say("An operator token is required.");
      return;
    }
    setBusy("abandon");
    try {
      const list = await fetch("/api/positions?status=OPEN").then((r) => r.json());
      const open = Array.isArray(list) ? list[0] : null;
      if (!open) {
        say("No open hedge to abandon.");
        return;
      }
      const res = await fetch(`/api/hedge/${open.correlationId}/unwind`, {
        method: "POST",
        headers: { "content-type": "application/json", ...authHeaders() },
        body: JSON.stringify({ reason: "ROLLBACK" }),
      });
      const d = await res.json();
      if (!res.ok) {
        say(`${d?.error?.code ?? res.status}: ${d?.error?.message ?? "failed"}`);
        return;
      }
      say(
        `Abandoned the ${open.asset} hedge. Recovered $${d?.outcome?.recoveredUsdc ?? "0"} — no transaction was sent, because none is possible.`,
      );
    } catch (e) {
      say(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(null);
    }
  }, [authHeaders, hasToken, say]);

  return (
    <>
      <Navigation />
      <main className="mx-auto w-full max-w-[1400px] space-y-6 px-4 py-8 font-sans sm:px-6 lg:px-8">
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 max-w-sm animate-fadeIn rounded-xl bg-cyan-500 px-5 py-3 font-mono-code text-xs font-bold text-zinc-950 shadow-2xl">
            {toast}
          </div>
        )}

        <div className="flex flex-col justify-between gap-4 border-b border-zinc-800/80 pb-5 md:flex-row md:items-end">
          <div className="space-y-1">
            <div className="flex items-center gap-2 font-mono-code text-xs font-bold uppercase tracking-wider text-cyan-400">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              <span>Operator console</span>
            </div>
            <h1 className="font-mono-code text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
              Agent Controls &amp; Policy
            </h1>
            <p className="text-xs text-zinc-400">
              What the agent may do, how sure it has to be, and who has to say yes.
            </p>
          </div>

          <label className="block w-full md:w-72">
            <span className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
              Operator token · used by everything on this page
            </span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="OPERATOR_TOKEN"
              className="mt-1 w-full rounded-lg border border-[#2d3748] bg-[#05070b] px-3 py-2 font-mono-code text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-500/60 focus:outline-none"
            />
            <span className="mt-1 block font-mono-code text-[10px] text-zinc-600">
              {hasToken ? "Held for this tab only. Checked server-side." : "Read-only without it."}
            </span>
          </label>
        </div>

        {/* ① Live state */}
        <Panel
          n="01"
          title="Live state"
          subtitle="Takes effect immediately, and is not remembered across a restart."
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              className={`rounded border px-2.5 py-1 font-mono-code text-xs font-bold ${
                status === "ARMED"
                  ? "border-emerald-500/40 bg-emerald-950 text-emerald-300"
                  : "border-amber-500/40 bg-amber-950 text-amber-300"
              }`}
            >
              ● {status === "ARMED" ? "ARMED" : "PAUSED"}
            </span>
            <span className="rounded border border-cyan-500/30 bg-cyan-950 px-2.5 py-1 font-mono-code text-xs font-bold text-cyan-300">
              {MODE_COPY[liveMode].icon} {MODE_COPY[liveMode].name}
            </span>
            <span className="font-mono-code text-[11px] text-zinc-500">
              {MODE_COPY[liveMode].blurb}
            </span>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {(Object.keys(MODE_COPY) as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={busy === "control"}
                onClick={() => setControl({ mode: m })}
                className={`cursor-pointer rounded-xl border p-3 text-left transition-all ${
                  liveMode === m
                    ? "border-cyan-400 bg-cyan-950 text-cyan-300 ring-1 ring-cyan-400"
                    : "border-zinc-800 bg-[#050b12] text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                <div className="font-mono-code text-xs font-bold">
                  {liveMode === m ? "● " : "○ "}
                  {MODE_COPY[m].icon} {MODE_COPY[m].name}
                </div>
                <div className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">
                  {MODE_COPY[m].blurb}
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              disabled={busy === "control"}
              onClick={() => setControl({ status: status === "ARMED" ? "PAUSED" : "ARMED" })}
              className={`cursor-pointer rounded-xl px-4 py-2 font-mono-code text-xs font-bold transition-all ${
                status === "ARMED"
                  ? "border border-amber-500/30 bg-zinc-800 text-amber-300 hover:bg-zinc-700"
                  : "bg-emerald-500 text-zinc-950 hover:bg-emerald-400"
              }`}
            >
              {status === "ARMED" ? "⏸ Pause agent" : "▶ Resume agent"}
            </button>
            <button
              type="button"
              disabled={busy === "telegram"}
              onClick={testTelegram}
              className="cursor-pointer rounded-xl border border-cyan-500/40 bg-cyan-950 px-4 py-2 font-mono-code text-xs font-bold text-cyan-300 transition-all hover:bg-cyan-900"
            >
              📲 Test Telegram
            </button>
            <span className="font-mono-code text-[10px] text-zinc-500">
              Alerts fire in every mode; only the content changes.
            </span>
          </div>
        </Panel>

        {/* ② Risk profile */}
        <Panel
          n="02"
          title="Risk profile"
          subtitle="Persisted server-side and read by the policy engine on the next run."
        >
          <div className="grid gap-3 md:grid-cols-3">
            {(Object.keys(TIER_COPY) as RiskTier[]).map((tier) => {
              const active = settings?.riskTier === tier;
              return (
                <button
                  key={tier}
                  type="button"
                  disabled={!hasToken || busy === "settings"}
                  onClick={() => patchSettings({ riskTier: tier })}
                  className={`cursor-pointer space-y-2 rounded-xl border p-4 text-left transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
                    active
                      ? "border-emerald-400 bg-emerald-950/40 ring-2 ring-emerald-400/30"
                      : "border-zinc-800/80 bg-[#050b12] hover:border-zinc-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5 font-mono-code text-sm font-bold text-white">
                      <span className={`h-2 w-2 rounded-full ${TIER_COPY[tier].dot}`} />
                      {TIER_COPY[tier].name}
                    </span>
                    <span className="font-mono-code text-[10px] text-zinc-500">
                      {active ? "● Active" : "○ Select"}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-zinc-400">
                    {TIER_COPY[tier].blurb}
                  </p>
                </button>
              );
            })}
          </div>

          {settings && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Hedge above truth", `${settings.truthHedge}`, "Below this, nothing is bought"],
                ["Full size above", `${settings.truthFull}`, "Between the two, reduced size"],
                [
                  "Minimum agreement",
                  `${Math.round(settings.agreement * 100)}%`,
                  "A split panel cannot trade",
                ],
                [
                  "Per-trade ceiling",
                  `$${settings.hardCeilingUsdc}`,
                  `Daily cap ${settings.dailyCapPercent}% of vault`,
                ],
              ].map(([label, value, foot]) => (
                <div
                  key={label}
                  className="rounded-xl border border-zinc-800 bg-[#050b12] p-3.5"
                >
                  <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
                    {label}
                  </div>
                  <div className="mt-0.5 font-mono-code text-lg font-bold text-white">{value}</div>
                  <div className="text-[10px] text-zinc-500">{foot}</div>
                </div>
              ))}
            </div>
          )}

          {!hasToken && (
            <p className="rounded-lg border border-zinc-800 bg-[#050b12] px-3 py-2 font-mono-code text-[10px] text-zinc-500">
              Read-only. Enter the operator token above to change policy.
            </p>
          )}
        </Panel>

        {/* ③ Advanced */}
        <section className="overflow-hidden rounded-2xl border border-cyan-950 bg-[#09111c] font-mono-code shadow-xl">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex w-full cursor-pointer select-none items-center justify-between p-5 text-left transition-colors hover:bg-white/[0.02]"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                03 · Thresholds &amp; budget
              </span>
              <span className="font-sans text-xs text-zinc-500">
                Hand-tune what the profile above sets
              </span>
            </span>
            <span className="text-xs font-bold text-cyan-400">
              {showAdvanced ? "Hide ▲" : "Show ▼"}
            </span>
          </button>

          {showAdvanced && settings && (
            <div className="animate-fadeIn space-y-5 border-t border-cyan-950 p-6 pt-5">
              <div className="grid gap-5 md:grid-cols-3">
                {[
                  {
                    key: "truthHedge",
                    label: "Hedge threshold",
                    value: settings.truthHedge,
                    min: 40,
                    max: 95,
                    step: 1,
                    accent: "accent-cyan-400",
                    note: "Truth score needed before any protection is bought.",
                  },
                  {
                    key: "truthFull",
                    label: "Full-size threshold",
                    value: settings.truthFull,
                    min: 50,
                    max: 99,
                    step: 1,
                    accent: "accent-red-400",
                    note: "Above this, the full budget is committed.",
                  },
                  {
                    key: "agreement",
                    label: "Minimum agreement",
                    value: Math.round(settings.agreement * 100),
                    min: 30,
                    max: 99,
                    step: 5,
                    accent: "accent-emerald-400",
                    note: "How much the three models must concur before acting.",
                  },
                ].map((s) => (
                  <div
                    key={s.key}
                    className="space-y-1.5 rounded-xl border border-zinc-800 bg-[#050b12] p-4"
                  >
                    <div className="flex justify-between text-xs text-zinc-300">
                      <span>{s.label}</span>
                      <strong className="text-white">
                        {s.value}
                        {s.key === "agreement" ? "%" : ""}
                      </strong>
                    </div>
                    <input
                      type="range"
                      min={s.min}
                      max={s.max}
                      step={s.step}
                      value={s.value}
                      disabled={!hasToken}
                      onChange={(e) =>
                        patchSettings({
                          [s.key]:
                            s.key === "agreement"
                              ? Number(e.target.value) / 100
                              : Number(e.target.value),
                        })
                      }
                      className={`w-full cursor-pointer ${s.accent} disabled:cursor-not-allowed`}
                    />
                    <p className="font-sans text-[10px] leading-relaxed text-zinc-500">{s.note}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-[#050b12] p-4">
                  <div className="flex justify-between text-xs text-zinc-300">
                    <span>Maximum per hedge</span>
                    <strong className="text-amber-300">${settings.hardCeilingUsdc}</strong>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={Number(settings.hardCeilingUsdc)}
                    disabled={!hasToken}
                    onChange={(e) =>
                      patchSettings({ hardCeilingUsdc: Number(e.target.value).toFixed(2) })
                    }
                    className="w-full cursor-pointer accent-amber-400 disabled:cursor-not-allowed"
                  />
                  <p className="font-sans text-[10px] text-zinc-500">
                    The single largest trade the agent may ever place. Enforced server-side on
                    every path, including manual approval.
                  </p>
                </div>

                <div className="space-y-1.5 rounded-xl border border-zinc-800 bg-[#050b12] p-4">
                  <div className="flex justify-between text-xs text-zinc-300">
                    <span>Daily spending limit</span>
                    <strong className="text-cyan-300">{settings.dailyCapPercent}% / 24h</strong>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    step="1"
                    value={settings.dailyCapPercent}
                    disabled={!hasToken}
                    onChange={(e) => patchSettings({ dailyCapPercent: Number(e.target.value) })}
                    className="w-full cursor-pointer accent-cyan-400 disabled:cursor-not-allowed"
                  />
                  <p className="font-sans text-[10px] text-zinc-500">
                    Share of the vault spendable in a rolling day, whatever the signals say.
                  </p>
                </div>
              </div>

              {!settings.matchesPreset && (
                <p className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 font-sans text-[11px] text-amber-200/80">
                  These values have been hand-edited away from the {settings.riskTier} profile.
                  Selecting a profile again will overwrite them.
                </p>
              )}
            </div>
          )}
        </section>

        {/* ④ What it may do */}
        <Panel
          n="04"
          title="What the agent may do"
          subtitle="The deterministic boundary. Not settings — these are what the code allows at all."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="space-y-2">
              {[
                ["Buy a protective put", "ALLOWED", "emerald"],
                ["Let a hedge expire, or abandon it", "ALLOWED", "emerald"],
                ["Settle at expiry (automatic, no gas)", "ALLOWED", "emerald"],
                ["Unwind or close a hedge early", "NOT POSSIBLE", "zinc"],
                ["Transfer funds anywhere", "FORBIDDEN", "red"],
                ["Sell or write options", "FORBIDDEN", "red"],
                ["Touch the vault principal", "FORBIDDEN", "red"],
              ].map(([label, state, tone]) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-3 rounded-xl border border-zinc-800/70 bg-[#050b12] px-4 py-2.5"
                >
                  <span className="font-mono-code text-xs text-zinc-200">{label}</span>
                  <span
                    className={`shrink-0 rounded px-2 py-0.5 font-mono-code text-[10px] font-bold ${
                      tone === "emerald"
                        ? "bg-emerald-950 text-emerald-300"
                        : tone === "red"
                          ? "bg-red-950 text-red-300"
                          : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {state}
                  </span>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Network", `Base mainnet ${health?.rpc?.chainId ?? 8453}`],
                  ["Options venue", "Thetanuts OptionBook"],
                  ["Settlement currency", "USDC (Base native)"],
                  ["Signing", health?.burner?.canSign ? "Burner key present" : "No signer here"],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-zinc-800 bg-[#050b12] p-3">
                    <div className="font-mono-code text-[10px] uppercase text-zinc-500">{k}</div>
                    <div className="mt-0.5 font-mono-code text-xs font-bold text-emerald-400">
                      {v}
                    </div>
                  </div>
                ))}
              </div>

              <p className="rounded-xl border border-zinc-800 bg-[#03070c] p-3.5 text-[11px] leading-relaxed text-zinc-400">
                <span className="font-bold text-zinc-300">Why early exit is impossible.</span>{" "}
                Measured against a real open position:{" "}
                <code className="text-zinc-300">close()</code> reverts unless one address holds
                both sides, <code className="text-zinc-300">reclaimCollateral()</code> is
                seller-only, and no live quote bids for puts. Premium recovery on an early exit
                is 0%. The real protection against a false alarm is the gate that runs before the
                money moves.
              </p>
            </div>
          </div>
        </Panel>

        {/* ⑤ Ingest */}
        <Panel
          n="05"
          title="Signal intake"
          subtitle="The newswire poller. Reading is not acting — a scan still runs while the agent is paused."
        >
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Poller", ingest?.polling ? "Running" : "Stopped", ingest?.polling],
              ["Passes", ingest ? String(ingest.polls) : "—", true],
              ["Screened", ingest ? ingest.screened.toLocaleString() : "—", true],
              ["Passed", ingest ? String(ingest.kept) : "—", true],
            ].map(([label, value, ok]) => (
              <div key={String(label)} className="rounded-xl border border-zinc-800 bg-[#050b12] p-3">
                <div className="font-mono-code text-[10px] uppercase text-zinc-500">{label}</div>
                <div
                  className={`mt-0.5 font-mono-code text-sm font-bold ${ok ? "text-white" : "text-amber-300"}`}
                >
                  {value}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy === "poll"}
              onClick={() => ingestAction("poll")}
              className="cursor-pointer rounded-xl bg-cyan-500 px-4 py-2 font-mono-code text-xs font-bold text-zinc-950 transition-all hover:bg-cyan-400 disabled:opacity-50"
            >
              {busy === "poll" ? "Scanning…" : "Scan now"}
            </button>
            <button
              type="button"
              disabled={busy === "start"}
              onClick={() => ingestAction(ingest?.polling ? "stop" : "start")}
              className="cursor-pointer rounded-xl border border-zinc-700 bg-[#050b12] px-4 py-2 font-mono-code text-xs font-bold text-zinc-300 transition-all hover:bg-zinc-800"
            >
              {ingest?.polling ? "Stop the poller" : "Start the poller"}
            </button>
            <Link
              href="/signals"
              className="rounded-xl border border-zinc-700 px-4 py-2 font-mono-code text-xs font-bold text-zinc-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
            >
              See what it screened →
            </Link>
          </div>

          {ingest?.lastPollError && (
            <p className="rounded-lg border border-amber-700/40 bg-amber-950/20 px-3 py-2 font-mono-code text-[10px] text-amber-200/80">
              Last pass reported: {ingest.lastPollError}
            </p>
          )}
        </Panel>

        {/* ⑥ Emergency */}
        <Panel
          n="06"
          title="Emergency actions"
          danger
          subtitle="Immediate interventions. An open hedge cannot be unwound on this venue — abandoning records the decision to stop protecting and sends no transaction, because none is possible."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setControl({ status: "PAUSED" })}
              className="cursor-pointer rounded-xl border border-red-800/60 bg-red-950/90 p-3 text-center font-mono-code text-xs font-bold text-red-300 transition-all hover:bg-red-900"
            >
              🛑 Pause the agent now
            </button>
            <button
              type="button"
              disabled={busy === "abandon"}
              onClick={abandonHedge}
              title="Records the decision to stop protecting. Sends no transaction."
              className="cursor-pointer rounded-xl border border-amber-800/60 bg-amber-950/90 p-3 text-center font-mono-code text-xs font-bold text-amber-300 transition-all hover:bg-amber-900 disabled:opacity-50"
            >
              {busy === "abandon" ? "Abandoning…" : "⚑ Abandon the open hedge"}
            </button>
          </div>
        </Panel>

        {/* ⑦ Health */}
        <Panel n="07" title="Diagnostics" subtitle="Live reads, not cached status strings.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              [
                "Base RPC",
                health?.rpc?.reachable
                  ? `block ${health.rpc.blockNumber?.toLocaleString()}`
                  : "unreachable",
                health?.rpc?.reachable,
              ],
              [
                "Order book",
                health?.book?.reachable
                  ? `${health.book.vanillaPutCount} puts / ${health.book.orderCount} orders`
                  : "unreachable",
                health?.book?.reachable,
              ],
              [
                "Clock skew",
                health?.clock?.localSkewSeconds === null ||
                health?.clock?.localSkewSeconds === undefined
                  ? "—"
                  : `${health.clock.localSkewSeconds.toFixed(2)}s`,
                health?.clock?.withinLimit,
              ],
              ["Overall", health?.status ?? "checking", health?.status === "ok"],
            ].map(([label, value, ok]) => (
              <div key={String(label)} className="rounded-xl border border-zinc-800 bg-[#050b12] p-3.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      ok === undefined ? "bg-zinc-600" : ok ? "bg-emerald-400" : "bg-red-500"
                    }`}
                  />
                  <span className="font-mono-code text-[10px] uppercase text-zinc-500">
                    {label}
                  </span>
                </div>
                <div className="mt-0.5 font-mono-code text-xs font-bold text-zinc-200">
                  {String(value)}
                </div>
              </div>
            ))}
          </div>

          {health?.burner?.address && (
            <a
              href={`https://basescan.org/address/${health.burner.address}`}
              target="_blank"
              rel="noreferrer"
              className="block break-all font-mono-code text-[10px] text-zinc-500 hover:text-cyan-300"
            >
              Burner {health.burner.address} ↗
            </a>
          )}
        </Panel>
      </main>
    </>
  );
}

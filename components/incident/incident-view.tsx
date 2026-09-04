"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type {
  AlertEvent,
  Attestation,
  EvidencePacket,
  ErrorEnvelope,
  HedgeDecision,
  HedgePosition,
  VerificationResult,
} from "@/types";
import { ConsensusDetail, ScoreGauges } from "@/components/verification/score-gauges";
import { VerdictPanel } from "@/components/verification/model-verdict-card";
import { EvidencePanel } from "@/components/verification/evidence-panel";
import {
  DecisionPanel,
  ReasoningTrace,
} from "@/components/verification/decision-panel";
import {
  EMPTY_RUN,
  useVerificationStream,
  type LiveRun,
} from "@/components/verification/use-verification-stream";

export interface IncidentSeed {
  id: string;
  found: boolean;
  status: string | null;
  alert: AlertEvent | null;
  evidence: EvidencePacket | null;
  investigationSkipped: boolean;
  /** Rebuilt from the archive rather than held in memory. */
  restoredFromDb?: boolean;
  /** Stage 02 is not persisted by any table, so it cannot be restored. */
  evidenceUnavailable?: boolean;
  verification: VerificationResult | null;
  decision: HedgeDecision | null;
  position: HedgePosition | null;
  attestation: Attestation | null;
  error: ErrorEnvelope | null;
}

/**
 * Statuses where the pipeline is genuinely still working, and so the only ones
 * worth opening a stream for.
 *
 * Framed as an allowlist rather than a list of terminal states, because DECIDED
 * is the trap: it is not terminal — an autonomous run moves on from it — but it
 * is also where a run stops and waits under APPROVAL_REQUIRED, and where a
 * worked record sits forever. Treating it as in-flight opened an EventSource
 * against a job emitting nothing, which held the connection until the server's
 * five-minute expiry and left the page loading the whole time.
 */
const IN_FLIGHT = new Set(["QUEUED", "VERIFYING", "VERIFIED", "SELECTING", "EXECUTING"]);

function Section({
  step,
  title,
  subtitle,
  children,
  tone = "cyan",
}: {
  step: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  tone?: "cyan" | "emerald" | "amber" | "red";
}) {
  const rail = {
    cyan: "before:bg-cyan-500/60",
    emerald: "before:bg-emerald-500/60",
    amber: "before:bg-amber-500/60",
    red: "before:bg-red-500/60",
  }[tone];

  return (
    <section
      className={`relative pl-6 before:absolute before:left-0 before:top-2 before:bottom-0 before:w-px sm:pl-8 ${rail}`}
    >
      <div
        className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-[#05070b] ${rail.replace("before:", "")}`}
      />
      <div className="mb-3">
        <div className="font-mono-code text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
          {step}
        </div>
        <h2 className="font-mono-code text-base font-black tracking-tight text-white sm:text-lg">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500">{subtitle}</p>}
      </div>
      <div className="pb-9">{children}</div>
    </section>
  );
}

/**
 * The approval half of APPROVAL_REQUIRED.
 *
 * Shown only when a decision wants to trade and nothing has been filled yet.
 * The route behind it requires an operator token, refuses while the agent is
 * paused, and re-applies the per-trade hard ceiling — so this form is a
 * request, not an authority.
 */
function ApprovalPanel({
  jobId,
  decision,
  onFilled,
}: {
  jobId: string;
  decision: HedgeDecision;
  onFilled: (p: HedgePosition) => void;
}) {
  const [token, setToken] = useState("");
  const [budget, setBudget] = useState(decision.targetSizeUsdc);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/hedge/manual", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token.trim() ? { authorization: `Bearer ${token.trim()}` } : {}),
        },
        body: JSON.stringify({
          jobId,
          asset: decision.targetAsset,
          budgetUsdc: budget,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error?.message ?? "Execution failed.");
      }
      onFilled(data.position as HedgePosition);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [budget, decision.targetAsset, jobId, onFilled, token]);

  return (
    <div className="space-y-4 rounded-2xl border border-amber-700/50 bg-amber-950/15 p-5">
      <div>
        <div className="font-mono-code text-xs font-bold uppercase tracking-wider text-amber-300">
          Awaiting your approval
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
          The agent reached a decision but is not configured to act alone. Approving
          signs and broadcasts a real transaction on Base mainnet with real USDC.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            Premium budget (USDC)
          </span>
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            inputMode="decimal"
            className="mt-1 w-full rounded-lg border border-[#2d3748] bg-[#05070b] px-3 py-2 font-mono-code text-sm text-white focus:border-amber-500/60 focus:outline-none"
          />
          <span className="mt-1 block font-mono-code text-[10px] text-zinc-600">
            Policy sized this at {decision.targetSizeUsdc}. The server ceiling still applies.
          </span>
        </label>

        <label className="block">
          <span className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            Operator token
          </span>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="OPERATOR_TOKEN"
            className="mt-1 w-full rounded-lg border border-[#2d3748] bg-[#05070b] px-3 py-2 font-mono-code text-sm text-white placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none"
          />
          <span className="mt-1 block font-mono-code text-[10px] text-zinc-600">
            Checked server-side. Never stored.
          </span>
        </label>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 font-mono-code text-[11px] text-red-300">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={execute}
        disabled={busy || !token.trim()}
        className="w-full cursor-pointer rounded-xl bg-emerald-500 px-5 py-3 font-mono-code text-xs font-black text-zinc-950 transition-all hover:bg-emerald-400 active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
      >
        {busy ? "QUERYING THE BOOK AND FILLING…" : "APPROVE — BUY THE PUT ON THETANUTS"}
      </button>
    </div>
  );
}

function PositionCard({ position }: { position: HedgePosition }) {
  const cover = Number(position.notionalProtectedUsdc);
  const premium = Number(position.premiumPaidUsdc);
  const ratio = cover > 0 ? ((premium / cover) * 100).toFixed(3) : "—";

  return (
    <div className="space-y-4 rounded-2xl border border-emerald-700/40 bg-emerald-950/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-mono-code text-base font-black text-white">
            {position.asset} ${Number(position.strike).toLocaleString()} put
          </div>
          <div className="font-mono-code text-[11px] text-zinc-400">
            {position.contracts} contracts · expires{" "}
            {new Date(position.expiry).toUTCString().replace("GMT", "UTC")}
          </div>
        </div>
        <span
          className={`rounded-lg border px-2.5 py-1 font-mono-code text-[10px] font-bold ${
            position.wasDryRun
              ? "border-amber-500/40 bg-amber-950/50 text-amber-300"
              : "border-emerald-500/40 bg-emerald-950/50 text-emerald-300"
          }`}
        >
          {position.wasDryRun ? "DRY RUN — NOTHING SIGNED" : "FILLED ON BASE MAINNET"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Premium paid", `$${position.premiumPaidUsdc}`, "text-amber-300"],
          ["Cover bought", `$${cover.toLocaleString()}`, "text-white"],
          ["Cost of cover", `${ratio}%`, "text-emerald-300"],
          ["Spot at entry", `$${Number(position.spotAtEntry).toLocaleString()}`, "text-zinc-300"],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-xl border border-[#1e2433] bg-[#05070b] p-3">
            <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
              {label}
            </div>
            <div className={`mt-0.5 font-mono-code text-sm font-bold ${tone}`}>{value}</div>
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-400">
        If {position.asset} settles below ${Number(position.strike).toLocaleString()} at expiry,
        this pays{" "}
        <code className="font-mono-code text-emerald-300">
          (strike − settlement) × {position.contracts}
        </code>
        , up to ${cover.toLocaleString()}. If it settles above, the option expires worth
        nothing and the ${position.premiumPaidUsdc} premium was the whole cost — insurance
        that was not needed. Settlement is automatic; the buyer sends nothing.
      </p>

      {position.entryTxHash && !position.wasDryRun && (
        <a
          href={position.baseScanUrl || `https://basescan.org/tx/${position.entryTxHash}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 break-all font-mono-code text-[11px] text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
        >
          {position.entryTxHash} ↗
        </a>
      )}
    </div>
  );
}

function AttestationCard({ attestation }: { attestation: Attestation }) {
  const p = attestation.payload;
  return (
    <div className="space-y-3 rounded-2xl border border-[#1e2433] bg-[#0a0f18] p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono-code text-xs font-bold text-white">
          Reasoning anchored on-chain
        </div>
        <span className="rounded border border-[#2d3748] px-2 py-0.5 font-mono-code text-[10px] text-zinc-400">
          {attestation.method}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-zinc-400">
        A transaction carrying the scores, the request ids and a hash of the evidence that
        produced this trade. It is what makes the decision auditable after the fact rather
        than a claim about what the agent was thinking.
      </p>
      <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        {[
          ["Truth score", `${p.truthScore} / 100`],
          ["Agreement", `${Math.round(p.agreement * 100)}%`],
          ["Severity", `${p.severity} / 5`],
          ["Evidence hash", p.evidenceHash.slice(0, 18) + "…"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 font-mono-code text-[11px]">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="font-bold text-zinc-200">{v}</dd>
          </div>
        ))}
      </dl>
      {p.gonkaRequestIds.length > 0 && (
        <div>
          <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            Gonka request ids in the payload
          </div>
          <ul className="mt-1 space-y-0.5">
            {p.gonkaRequestIds.map((id) => (
              <li key={id} className="break-all font-mono-code text-[10px] text-zinc-400">
                {id}
              </li>
            ))}
          </ul>
        </div>
      )}
      {attestation.baseScanUrl && (
        <a
          href={attestation.baseScanUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 font-mono-code text-[11px] text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
        >
          View the attestation transaction ↗
        </a>
      )}
    </div>
  );
}

export function IncidentView({ seed }: { seed: IncidentSeed }) {
  const { run, attach, setRun } = useVerificationStream();

  // Seed from the server, then let the stream take over if the job is live.
  useEffect(() => {
    const seeded: LiveRun = {
      ...EMPTY_RUN,
      jobId: seed.id,
      status: (seed.status as LiveRun["status"]) ?? null,
      evidence: seed.evidence,
      checks: seed.evidence?.checks ?? [],
      verdicts: seed.verification?.verdicts ?? [],
      consensus: seed.verification?.consensus ?? null,
      decision: seed.decision,
      position: seed.position,
      attestation: seed.attestation,
      reasoningTrace: seed.verification?.reasoningTrace ?? [],
      idChainResolvable: seed.verification?.idChainResolvable ?? false,
      investigationSkipped: seed.investigationSkipped,
      error: seed.error?.error?.message ?? null,
      finished: seed.status ? !IN_FLIGHT.has(seed.status) : false,
    };
    setRun(seeded);

    if (seed.found && seed.status && IN_FLIGHT.has(seed.status)) {
      attach(seed.id, seeded);
    }
  }, [seed, attach, setRun]);

  const onFilled = useCallback(
    (position: HedgePosition) => {
      setRun((prev) => ({ ...prev, position, finished: true }));
    },
    [setRun],
  );

  const wantsTrade =
    run.decision?.tier === "HEDGE_FULL" || run.decision?.tier === "HEDGE_SMALL";
  const awaitingApproval = wantsTrade && !run.position;

  const claim = seed.alert?.rawText ?? "";
  const receivedAt = seed.alert?.receivedAt;

  const headline = useMemo(() => {
    if (!run.consensus) return "Verification in progress";
    if (run.consensus.truthScore >= 70) return "Judged a real incident";
    if (run.consensus.truthScore >= 40) return "Judged suspicious, held under watch";
    return "Judged a false alarm";
  }, [run.consensus]);

  if (!seed.found) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-20 text-center sm:px-8">
        <h1 className="font-mono-code text-2xl font-black text-white">No record here</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-zinc-400">
          Nothing is stored under{" "}
          <code className="font-mono-code text-zinc-300">{seed.id}</code>. Verification jobs
          live in memory and do not survive a server restart; positions are written to disk
          and do.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link
            href="/signals"
            className="rounded-xl border border-[#2d3748] px-5 py-2.5 font-mono-code text-xs font-bold text-zinc-300 transition-colors hover:text-white"
          >
            Browse signals
          </Link>
          <Link
            href="/protection"
            className="rounded-xl border border-[#2d3748] px-5 py-2.5 font-mono-code text-xs font-bold text-zinc-300 transition-colors hover:text-white"
          >
            See open protection
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-8 sm:px-8">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="mb-8 space-y-3 border-b border-[#1e2433] pb-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono-code text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400">
            Incident record
          </span>
          <code className="rounded border border-[#1e2433] bg-[#0a0f18] px-2 py-0.5 font-mono-code text-[10px] text-zinc-400">
            {seed.id}
          </code>
          {run.status && (
            <span className="rounded border border-[#2d3748] px-2 py-0.5 font-mono-code text-[10px] font-bold text-zinc-300">
              {run.status}
            </span>
          )}
          {seed.restoredFromDb && (
            <span
              className="rounded border border-cyan-500/40 bg-cyan-950/40 px-2 py-0.5 font-mono-code text-[10px] font-bold text-cyan-300"
              title="Rebuilt from the Postgres archive rather than held in memory."
            >
              FROM ARCHIVE
            </span>
          )}
        </div>
        <h1 className="font-mono-code text-2xl font-black tracking-tight text-white sm:text-3xl">
          {headline}
        </h1>
        <p className="max-w-2xl text-[11px] leading-relaxed text-zinc-500">
          Everything below shares one correlation id: the sentence that arrived, what the
          chain said about it, what each model concluded, what policy decided, and whatever
          was actually bought.
        </p>
      </div>

      <div className="space-y-0">
        <Section
          step="01 · Detect"
          title="What arrived"
          subtitle={
            receivedAt
              ? `Received ${new Date(receivedAt).toUTCString().replace("GMT", "UTC")}`
              : undefined
          }
          tone="red"
        >
          <div className="rounded-2xl border border-[#1e2433] bg-[#0a0f18] p-5">
            {seed.alert?.source && (
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="rounded border border-[#2d3748] px-2 py-0.5 font-mono-code text-[10px] uppercase tracking-wider text-zinc-400">
                  {typeof seed.alert.source === "string"
                    ? seed.alert.source
                    : (seed.alert.source as { type?: string })?.type ?? "SOURCE"}
                </span>
                {seed.alert.sourceUrl && (
                  <a
                    href={seed.alert.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="truncate font-mono-code text-[10px] text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
                  >
                    {seed.alert.sourceUrl}
                  </a>
                )}
              </div>
            )}
            <p className="text-sm leading-relaxed text-zinc-200">
              {claim || "No claim text recorded for this id."}
            </p>
            {seed.alert?.metadata?.triage && (
              <p className="mt-3 border-t border-[#1e2433] pt-3 text-[11px] leading-relaxed text-zinc-500">
                <span className="font-mono-code uppercase tracking-wider text-zinc-600">
                  Screening ·{" "}
                </span>
                {seed.alert.metadata.triage}
              </p>
            )}
          </div>
        </Section>

        <Section
          step="02 · Investigate"
          title="What the chain said"
          subtitle="Measured before any model was asked, so the claim is scored against evidence rather than its own wording."
        >
          {/*
            "Not stored" and "found nothing" are different claims and must not
            look the same. No table holds the evidence packet, so a record
            rebuilt from the archive has none to show — and says so rather than
            rendering an empty result that reads as a clean chain.
          */}
          {seed.evidenceUnavailable && !run.evidence && run.checks.length === 0 ? (
            <div className="rounded-2xl border border-[#1e2433] bg-[#0a0f18] p-5">
              <div className="font-mono-code text-xs font-bold text-zinc-300">
                Not recorded for this incident
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
                This record was rebuilt from the archive, and the on-chain evidence
                packet is not one of the things the schema stores. The stage ran — the
                verdicts below were scored against it — but the individual checks live
                only in the process that performed them. This is missing data, not a
                clean chain.
              </p>
            </div>
          ) : (
            <EvidencePanel
              evidence={run.evidence}
              checks={run.checks}
              skipped={run.investigationSkipped}
            />
          )}
        </Section>

        <Section
          step="03 · Analyze"
          title="What each model concluded"
          subtitle="Three independent models on the Gonka network, scoring in parallel. Every request id is shown and copyable."
        >
          <VerdictPanel
            verdicts={run.verdicts}
            waiting={!run.finished && run.verdicts.length < 3}
          />
        </Section>

        {(run.consensus || run.reasoningTrace.length > 0) && (
          <Section
            step="04 · Challenge"
            title="Where they landed"
            subtitle="Agreement carries its own policy threshold, so it is shown at the same weight as the score."
            tone="amber"
          >
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#1e2433] bg-[#0a0f18] p-6">
                <ScoreGauges consensus={run.consensus} />
                {run.consensus && (
                  <div className="mt-6 border-t border-[#1e2433] pt-5">
                    <ConsensusDetail consensus={run.consensus} />
                  </div>
                )}
              </div>
              {run.reasoningTrace.length > 0 && (
                <ReasoningTrace trace={run.reasoningTrace} />
              )}
            </div>
          </Section>
        )}

        <Section
          step="05 · Decide"
          title="What policy allowed"
          subtitle="The tier, the instrument it mapped to, and which of the five caps actually bound the size."
        >
          <DecisionPanel decision={run.decision} />
        </Section>

        <Section
          step="06 · Protect"
          title="What was actually bought"
          tone="emerald"
          subtitle={
            run.position
              ? undefined
              : "Nothing has been filled against this incident."
          }
        >
          <div className="space-y-4">
            {run.position ? (
              <PositionCard position={run.position} />
            ) : awaitingApproval && run.jobId ? (
              <ApprovalPanel
                jobId={run.jobId}
                decision={run.decision!}
                onFilled={onFilled}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-[#1e2433] bg-[#070b12] p-5 text-center">
                <span className="font-mono-code text-xs text-zinc-600">
                  {run.decision
                    ? "This decision did not call for a trade — capital untouched."
                    : "Waiting for the pipeline to reach a decision."}
                </span>
              </div>
            )}

            {run.attestation && <AttestationCard attestation={run.attestation} />}
          </div>
        </Section>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-[#1e2433] pt-6">
        <Link
          href="/signals"
          className="rounded-xl border border-[#2d3748] px-5 py-2.5 font-mono-code text-xs font-bold text-zinc-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
        >
          ← All signals
        </Link>
        <Link
          href="/protection"
          className="rounded-xl border border-[#2d3748] px-5 py-2.5 font-mono-code text-xs font-bold text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300"
        >
          Open protection →
        </Link>
      </div>
    </main>
  );
}

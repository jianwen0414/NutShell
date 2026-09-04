"use client";

import Link from "next/link";
import { EvidencePanel } from "@/components/verification/evidence-panel";
import { VerdictPanel } from "@/components/verification/model-verdict-card";
import { ConsensusDetail, ScoreGauges } from "@/components/verification/score-gauges";
import { DecisionPanel, ReasoningTrace } from "@/components/verification/decision-panel";
import {
  STAGE_ORDER,
  type LiveRun,
  type Stage,
} from "@/components/verification/use-verification-stream";

/**
 * The six stages of a run, unfolding as the frames arrive.
 *
 * The bodies are the shared verification components, so what appears here is
 * identical to what the incident record and the public paste box show. The old
 * version of this had its own copy of every panel — around a thousand lines of
 * JSX — and the copies had drifted: stage 06 rendered a fixed "$2,400 put,
 * BROADCAST CONFIRMED" block regardless of what the decision actually said.
 */

const STAGES: Array<{ id: Stage; num: string; name: string; question: string }> = [
  { id: "01_DETECT", num: "01", name: "Detect", question: "What arrived?" },
  { id: "02_INVESTIGATE", num: "02", name: "Investigate", question: "What does the chain say?" },
  { id: "03_ANALYZE", num: "03", name: "Analyze", question: "What does each model think?" },
  { id: "04_CHALLENGE", num: "04", name: "Challenge", question: "Where did they land?" },
  { id: "05_DECIDE", num: "05", name: "Decide", question: "What does policy allow?" },
  { id: "06_PROTECT", num: "06", name: "Protect", question: "What happened?" },
];

function summaryFor(stage: Stage, run: LiveRun): string {
  switch (stage) {
    case "01_DETECT":
      return run.jobId ? "Claim accepted, correlation id assigned" : "Waiting";
    case "02_INVESTIGATE":
      if (run.investigationSkipped) return "Bypassed — scored on wording alone";
      if (run.evidence) {
        return `${run.evidence.checks.length} checks at block ${run.evidence.blockNumber.toLocaleString()} · ${run.evidence.corroborating} support, ${run.evidence.contradicting} contradict`;
      }
      return run.checks.length > 0 ? `${run.checks.length} checks so far` : "Reading Base mainnet";
    case "03_ANALYZE":
      return run.verdicts.length > 0
        ? `${run.verdicts.length} of 3 models returned`
        : "Waiting on the models";
    case "04_CHALLENGE":
      return run.consensus
        ? `Truth ${run.consensus.truthScore} · agreement ${Math.round(run.consensus.agreement * 100)}%${run.consensus.debateTriggered ? " · challenge round ran" : ""}`
        : "Aggregating";
    case "05_DECIDE":
      return run.decision
        ? `${run.decision.tier} · ${run.decision.targetSizeUsdc} USDC · bound by ${run.decision.bindingCap}`
        : "Applying policy";
    case "06_PROTECT":
      if (run.position) {
        return run.position.wasDryRun
          ? "Dry run — priced and sized, nothing signed"
          : `Filled: ${run.position.contracts} contracts for ${run.position.premiumPaidUsdc} USDC`;
      }
      if (run.decision && run.decision.tier !== "HEDGE_FULL" && run.decision.tier !== "HEDGE_SMALL") {
        return "No trade called for — capital untouched";
      }
      return "Awaiting execution";
    default:
      return "";
  }
}

export function LivePipeline({
  run,
  stage,
  open,
  onToggle,
  onExpandAll,
  onCollapseAll,
}: {
  run: LiveRun;
  stage: Stage;
  open: Record<string, boolean>;
  onToggle: (id: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  const currentIdx = STAGE_ORDER.indexOf(stage);
  const complete = stage === "COMPLETE";

  return (
    <div className="space-y-4 pt-2">
      <div className="flex flex-col justify-between gap-2 border-b border-zinc-800/80 pb-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2 font-mono-code text-sm font-bold text-white">
          <span
            className={`h-2.5 w-2.5 rounded-full ${complete ? "bg-emerald-500" : "animate-ping bg-red-500"}`}
          />
          <span>Investigation pipeline</span>
          {run.jobId && (
            <Link
              href={`/incident/${run.jobId}`}
              className="font-mono-code text-[10px] font-normal text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
            >
              {run.jobId}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono-code text-xs">
          <button
            type="button"
            onClick={onExpandAll}
            className="cursor-pointer text-cyan-400 hover:text-cyan-300"
          >
            Expand all
          </button>
          <span className="text-zinc-600">|</span>
          <button
            type="button"
            onClick={onCollapseAll}
            className="cursor-pointer text-zinc-400 hover:text-zinc-300"
          >
            Collapse all
          </button>
        </div>
      </div>

      {/* Stepper */}
      <div className="grid grid-cols-2 gap-2 font-mono-code sm:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((s, idx) => {
          const stepIndex = idx + 1;
          const passed = currentIdx > stepIndex || complete;
          const current = currentIdx === stepIndex && !complete;
          const expanded = Boolean(open[s.id]);

          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onToggle(s.id)}
              className={`cursor-pointer rounded-xl border p-2.5 text-left transition-all ${
                expanded
                  ? "border-cyan-400 bg-cyan-950 text-cyan-300 ring-1 ring-cyan-400"
                  : current
                    ? "border-cyan-500 bg-[#111a26] text-cyan-300"
                    : passed
                      ? "border-emerald-500/40 bg-[#09121c] text-emerald-400 hover:bg-[#0d1a29]"
                      : "border-zinc-800/60 bg-[#070a0f] text-zinc-600 opacity-50"
              }`}
            >
              <div className="flex items-center justify-between text-xs font-bold">
                <span>
                  {current ? "● " : passed ? "✓ " : "○ "}
                  {s.num} {s.name}
                </span>
                <span className="text-[10px] text-zinc-500">{expanded ? "▲" : "▼"}</span>
              </div>
              <div className="mt-0.5 truncate text-[10px] text-zinc-500">
                {current ? "Active" : passed ? "Done" : "Pending"}
              </div>
            </button>
          );
        })}
      </div>

      {/* Cards */}
      <div className="space-y-3 pt-1">
        {STAGES.map((s, idx) => {
          const stepIndex = idx + 1;
          const passed = currentIdx > stepIndex || complete;
          const current = currentIdx === stepIndex && !complete;
          if (!passed && !current) return null;

          const expanded = Boolean(open[s.id]);
          const rail =
            s.id === "01_DETECT"
              ? "border-l-red-500 bg-[#0c0608]"
              : s.id === "04_CHALLENGE"
                ? "border-l-amber-400 bg-[#0d0903]"
                : s.id === "06_PROTECT"
                  ? "border-l-emerald-500 bg-[#040f0a]"
                  : "border-l-cyan-400 bg-[#09111c]";

          return (
            <div
              key={s.id}
              id={`stage-${s.id}`}
              className={`scroll-mt-28 overflow-hidden rounded-2xl border border-l-4 border-zinc-800/80 transition-all ${rail} ${
                current ? "ring-2 ring-cyan-500/50" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => onToggle(s.id)}
                className="flex w-full cursor-pointer select-none items-center justify-between gap-4 p-4 text-left font-mono-code transition-colors hover:bg-white/[0.02] sm:p-5"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1.5 text-sm font-bold text-white">
                    <span className={current ? "text-cyan-400" : "text-emerald-400"}>
                      {current ? "●" : "✓"}
                    </span>
                    {s.num} {s.name}
                  </span>
                  <span className="hidden text-zinc-600 md:inline">|</span>
                  <span className="hidden text-xs text-zinc-500 md:inline">{s.question}</span>
                  <span className="text-zinc-600">•</span>
                  <span className="truncate text-xs text-zinc-200">{summaryFor(s.id, run)}</span>
                </span>
                <span className="shrink-0 text-xs font-bold text-cyan-400">
                  {expanded ? "Hide ▲" : "Details ▼"}
                </span>
              </button>

              {expanded && (
                <div className="animate-fadeIn space-y-4 border-t border-zinc-800/80 p-5 pt-4">
                  {s.id === "01_DETECT" && (
                    <div className="rounded-xl border border-[#1e2433] bg-[#05070b] p-4 text-sm leading-relaxed text-zinc-200">
                      {run.jobId
                        ? "A claim entered the pipeline and was assigned the correlation id above. Every stage below writes against that id."
                        : "Nothing yet."}
                    </div>
                  )}

                  {s.id === "02_INVESTIGATE" && (
                    <EvidencePanel
                      evidence={run.evidence}
                      checks={run.checks}
                      skipped={run.investigationSkipped}
                    />
                  )}

                  {s.id === "03_ANALYZE" && (
                    <VerdictPanel
                      verdicts={run.verdicts}
                      waiting={!run.finished && run.verdicts.length < 3}
                    />
                  )}

                  {s.id === "04_CHALLENGE" && (
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
                  )}

                  {s.id === "05_DECIDE" && <DecisionPanel decision={run.decision} />}

                  {s.id === "06_PROTECT" && (
                    <ProtectBody run={run} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ProtectBody({ run }: { run: LiveRun }) {
  if (run.position) {
    const p = run.position;
    return (
      <div className="space-y-3 rounded-2xl border border-emerald-900/50 bg-[#05140d] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-emerald-950 pb-2">
          <div>
            <div className="font-mono-code text-sm font-bold text-white">
              {p.asset} ${Number(p.strike).toLocaleString()} put · {p.contracts} contracts
            </div>
            <div className="font-mono-code text-[11px] text-zinc-400">
              Expires {new Date(p.expiry).toUTCString().replace("GMT", "UTC")}
            </div>
          </div>
          <span
            className={`rounded border px-2.5 py-1 font-mono-code text-[10px] font-bold ${
              p.wasDryRun
                ? "border-amber-500/40 bg-amber-950/50 text-amber-300"
                : "border-emerald-500/40 bg-emerald-950 text-emerald-300"
            }`}
          >
            {p.wasDryRun ? "DRY RUN" : "BROADCAST CONFIRMED"}
          </span>
        </div>
        <div className="grid gap-3 text-xs sm:grid-cols-3">
          <div>
            Premium: <strong className="text-amber-300">${p.premiumPaidUsdc}</strong>
          </div>
          <div>
            Cover:{" "}
            <strong className="text-white">
              ${Number(p.notionalProtectedUsdc).toLocaleString()}
            </strong>
          </div>
          <div>
            Spot at entry:{" "}
            <strong className="text-zinc-200">
              ${Number(p.spotAtEntry).toLocaleString()}
            </strong>
          </div>
        </div>
        {p.entryTxHash && !p.wasDryRun && (
          <a
            href={p.baseScanUrl || `https://basescan.org/tx/${p.entryTxHash}`}
            target="_blank"
            rel="noreferrer"
            className="block break-all font-mono-code text-[11px] text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
          >
            {p.entryTxHash} ↗
          </a>
        )}
      </div>
    );
  }

  const trades =
    run.decision?.tier === "HEDGE_FULL" || run.decision?.tier === "HEDGE_SMALL";

  return (
    <div className="rounded-2xl border border-[#1e2433] bg-[#05070b] p-5">
      <div className="font-mono-code text-sm font-bold text-white">
        {run.decision
          ? trades
            ? "Decision reached, nothing filled yet"
            : "No trade called for"
          : "Waiting for a decision"}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-400">
        {run.decision
          ? trades
            ? "The agent sized a hedge but has not executed it here. Approving and filling is done on the incident record, where it is token-gated."
            : `${run.decision.reason} Capital was not touched, which is the outcome on the large majority of signals.`
          : "Policy runs once consensus lands."}
      </p>
      {run.jobId && trades && (
        <Link
          href={`/incident/${run.jobId}`}
          className="mt-3 inline-block rounded-lg border border-emerald-500/40 bg-emerald-950/30 px-4 py-2 font-mono-code text-[11px] font-bold text-emerald-300 transition-colors hover:bg-emerald-950/60"
        >
          Review and approve →
        </Link>
      )}
    </div>
  );
}

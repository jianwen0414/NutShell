"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConsensusDetail, ScoreGauges } from "./score-gauges";
import { VerdictPanel } from "./model-verdict-card";
import { EvidencePanel } from "./evidence-panel";
import { DecisionPanel, ReasoningTrace } from "./decision-panel";
import { useVerificationStream } from "./use-verification-stream";

/**
 * The paste box.
 *
 * PRD §2 lists this as a mandatory deliverable: "a live URL where a user
 * pastes a link or text and gets a verification report... it must work with no
 * wallet connection". PROJECT-PLAN §5 makes it the demo beat that carries the
 * whole argument — a judge pasting their own words and watching three named
 * models disagree in real time proves the thing no amount of narration can.
 *
 * So this component is deliberately spare. No operator token, no scenario
 * injection, no mode switches, nothing that trades. A claim entered here is
 * marked USER_PASTE when the job is created, which makes it ineligible to
 * reach the book no matter what happens downstream.
 */

interface Scenario {
  id: string;
  name: string;
  rawText: string;
  expectedTier: string;
}

const STEP_COPY: Record<string, string> = {
  investigating: "Reading Base mainnet for anything the claim can be checked against",
  "investigation-skipped": "Chain measurement skipped for this run",
  layer1: "Three Gonka models scoring the claim in parallel",
  synthesizing: "Models disagreed — running the challenge round",
};

export function VerifyConsole({ autoFocus = false }: { autoFocus?: boolean }) {
  const [text, setText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const { run, stage, isRunning, start, reset } = useVerificationStream();

  useEffect(() => {
    let live = true;
    fetch("/api/scenarios")
      .then((r) => (r.ok ? r.json() : []))
      .then((d) => {
        if (live && Array.isArray(d)) setScenarios(d);
      })
      .catch(() => {
        /* chips are a convenience; the box works without them */
      });
    return () => {
      live = false;
    };
  }, []);

  const submit = useCallback(() => {
    const claim = text.trim();
    if (!claim || isRunning) return;
    void start({ text: claim, sourceUrl: sourceUrl.trim() || undefined });
  }, [text, sourceUrl, isRunning, start]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd/Ctrl+Enter submits. A judge who types into this box should not
      // have to hunt for the button.
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    },
    [submit],
  );

  const hasResult = Boolean(run.consensus) || run.verdicts.length > 0 || Boolean(run.error);
  const waitingForModels = isRunning && !run.consensus;

  const statusLine = useMemo(() => {
    if (run.error) return null;
    if (!isRunning) return null;
    if (run.step && STEP_COPY[run.step]) return STEP_COPY[run.step];
    if (stage === "01_DETECT") return "Claim accepted, starting the pipeline";
    return "Working";
  }, [isRunning, run.error, run.step, stage]);

  return (
    <div className="space-y-6">
      {/* ── Input ─────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-3xl border border-[#1e2433] bg-[#0a0f18]/90 shadow-2xl backdrop-blur-xl">
        <div className="border-b border-[#1e2433] px-5 py-3.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <span className="font-mono-code text-xs font-bold uppercase tracking-wider text-white">
                Verify any claim
              </span>
            </div>
            <span className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
              No wallet · no signup · nothing is traded
            </span>
          </div>
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus={autoFocus}
            rows={5}
            maxLength={4000}
            disabled={isRunning}
            placeholder="Paste a headline, a tweet, a Telegram message, or anything you have seen claimed about a DeFi protocol. Three independent models on the Gonka network will score it against what is actually on Base mainnet right now."
            className="w-full resize-y rounded-2xl border border-[#1e2433] bg-[#05070b] p-4 text-sm leading-relaxed text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none disabled:opacity-60"
          />

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              disabled={isRunning}
              placeholder="Source URL (optional)"
              className="min-w-0 flex-1 rounded-xl border border-[#1e2433] bg-[#05070b] px-3.5 py-2.5 font-mono-code text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none disabled:opacity-60"
            />
            <div className="flex items-center gap-2">
              {hasResult && !isRunning && (
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setText("");
                    setSourceUrl("");
                  }}
                  className="cursor-pointer rounded-xl border border-[#2d3748] px-4 py-2.5 font-mono-code text-xs font-bold text-zinc-400 transition-colors hover:text-zinc-200"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={submit}
                disabled={isRunning || text.trim().length === 0}
                className="cursor-pointer rounded-xl bg-emerald-500 px-6 py-2.5 font-mono-code text-xs font-black text-zinc-950 shadow-[0_0_24px_rgba(16,185,129,0.28)] transition-all hover:bg-emerald-400 active:scale-95 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:shadow-none"
              >
                {isRunning ? "VERIFYING…" : "VERIFY CLAIM"}
              </button>
            </div>
          </div>

          {scenarios.length > 0 && !hasResult && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
                Or try one
              </span>
              {scenarios.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={isRunning}
                  onClick={() => setText(s.rawText)}
                  className="cursor-pointer rounded-full border border-[#2d3748] bg-[#0e1622] px-3 py-1 font-mono-code text-[10px] text-zinc-300 transition-colors hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-50"
                  title={`Loads the exact text. Measured outcome: ${s.expectedTier}`}
                >
                  {s.name}
                </button>
              ))}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-zinc-500">
            Every model that answers shows its name, its score and its Gonka request id.
            Nothing here is scripted — edit a word and the score moves.
          </p>
        </div>
      </div>

      {/* ── Progress ──────────────────────────────────────────────────── */}
      {isRunning && (
        <div className="relative overflow-hidden rounded-2xl border border-cyan-900/50 bg-[#08131c]/90 px-5 py-3.5 backdrop-blur-xl">
          <div className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-cyan-500/10 to-transparent" />
          <div className="relative flex items-center gap-3">
            <span className="h-2 w-2 shrink-0 animate-ping rounded-full bg-cyan-400" />
            <span className="font-mono-code text-xs text-cyan-200">{statusLine}</span>
            <span className="ml-auto font-mono-code text-[10px] text-zinc-500">
              {run.verdicts.length} / 3 models in
            </span>
          </div>
        </div>
      )}

      {run.error && (
        <div className="rounded-2xl border border-red-800/60 bg-red-950/30 px-5 py-4">
          <div className="font-mono-code text-xs font-bold text-red-300">
            Verification failed
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-red-200/80">{run.error}</p>
        </div>
      )}

      {/* ── Report ────────────────────────────────────────────────────── */}
      {hasResult && !run.error && (
        <div className="space-y-5 animate-fadeIn">
          <div className="rounded-3xl border border-[#1e2433] bg-[#0a0f18]/90 p-6 backdrop-blur-xl sm:p-8">
            <ScoreGauges consensus={run.consensus} />
            {run.consensus && (
              <div className="mt-7 border-t border-[#1e2433] pt-6">
                <ConsensusDetail consensus={run.consensus} />
              </div>
            )}
          </div>

          <div>
            <h3 className="mb-3 font-mono-code text-xs font-bold uppercase tracking-wider text-zinc-400">
              What each model said
            </h3>
            <VerdictPanel verdicts={run.verdicts} waiting={waitingForModels} />
          </div>

          {(run.evidence || run.checks.length > 0 || run.investigationSkipped) && (
            <div>
              <h3 className="mb-3 font-mono-code text-xs font-bold uppercase tracking-wider text-zinc-400">
                What the chain said
              </h3>
              <EvidencePanel
                evidence={run.evidence}
                checks={run.checks}
                skipped={run.investigationSkipped}
              />
            </div>
          )}

          {run.reasoningTrace.length > 0 && <ReasoningTrace trace={run.reasoningTrace} />}

          {run.decision && (
            <div>
              <h3 className="mb-3 font-mono-code text-xs font-bold uppercase tracking-wider text-zinc-400">
                What the agent would do
              </h3>
              <DecisionPanel decision={run.decision} />
              <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-500">
                This claim was pasted publicly, so it is scored and shown and stops here.
                Reaching the order book takes an authenticated source — a public paste can
                never spend.{" "}
                {run.jobId && (
                  <Link
                    href={`/incident/${run.jobId}`}
                    className="text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
                  >
                    See the full record →
                  </Link>
                )}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

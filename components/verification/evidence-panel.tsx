"use client";

import { useState } from "react";
import type { EvidencePacket, EvidenceStance, InvestigationCheck } from "@/types";

/**
 * Stage 02 — what the chain said, before any model was asked.
 *
 * This is the stage that separates the product from a headline classifier. The
 * models do not score the wording of a claim; they score it against numbers
 * read off Base mainnet at a named block. So the block height, the method used
 * for each check, and the raw facts behind each one-line summary are all on
 * screen — a summary nobody can check is indistinguishable from a summary that
 * was invented.
 *
 * The four stances stay separate on purpose. An RPC that failed is not
 * evidence that nothing happened, and folding UNAVAILABLE into CONTRADICTS
 * would let a broken node read as innocence.
 */

const STANCE: Record<EvidenceStance, { dot: string; text: string; label: string }> = {
  CORROBORATES: { dot: "bg-red-400", text: "text-red-300", label: "SUPPORTS CLAIM" },
  CONTRADICTS: { dot: "bg-emerald-400", text: "text-emerald-300", label: "CONTRADICTS" },
  INCONCLUSIVE: { dot: "bg-zinc-500", text: "text-zinc-400", label: "INCONCLUSIVE" },
  UNAVAILABLE: { dot: "bg-amber-400", text: "text-amber-300", label: "UNAVAILABLE" },
};

function CheckRow({ check }: { check: InvestigationCheck }) {
  const [open, setOpen] = useState(false);
  const s = STANCE[check.stance];
  const facts = Object.entries(check.facts ?? {});

  return (
    <div className="rounded-xl border border-[#1e2433] bg-[#070b12]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-pointer items-start gap-3 p-3 text-left transition-colors hover:bg-white/[0.02]"
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono-code text-xs font-bold text-white">{check.title}</span>
            <span className={`font-mono-code text-[10px] font-bold ${s.text}`}>{s.label}</span>
          </span>
          <span className="mt-0.5 block text-[11px] leading-relaxed text-zinc-400">
            {check.summary}
          </span>
        </span>
        <span className="shrink-0 font-mono-code text-[10px] text-zinc-600">
          {open ? "HIDE" : "FACTS"}
        </span>
      </button>

      {open && (
        <div className="space-y-2 border-t border-[#1e2433] p-3">
          <div>
            <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
              Method
            </div>
            <p className="mt-0.5 break-all font-mono-code text-[10px] text-zinc-300">
              {check.method}
            </p>
          </div>
          {check.target && (
            <div>
              <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
                Target
              </div>
              <p className="mt-0.5 break-all font-mono-code text-[10px] text-zinc-300">
                {check.target}
              </p>
            </div>
          )}
          {facts.length > 0 && (
            <div>
              <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
                Measured
              </div>
              <dl className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {facts.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-2 font-mono-code text-[10px]">
                    <dt className="truncate text-zinc-500">{k}</dt>
                    <dd className="shrink-0 font-bold text-zinc-200">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {check.error && (
            <p className="font-mono-code text-[10px] text-amber-300">{check.error}</p>
          )}
          <p className="font-mono-code text-[10px] text-zinc-600">
            {check.source} · {check.latencyMs}ms
          </p>
        </div>
      )}
    </div>
  );
}

export function EvidencePanel({
  evidence,
  checks,
  skipped,
}: {
  evidence: EvidencePacket | null;
  checks: InvestigationCheck[];
  skipped?: boolean;
}) {
  if (skipped) {
    return (
      <div className="rounded-2xl border border-amber-700/40 bg-amber-950/20 p-5">
        <div className="font-mono-code text-xs font-bold text-amber-300">
          Stage 02 bypassed
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
          The chain was not measured for this run. The models scored the claim on its
          wording alone, as they did before the investigation stage existed.
        </p>
      </div>
    );
  }

  const shown = evidence?.checks?.length ? evidence.checks : checks;

  if (shown.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#1e2433] bg-[#070b12] p-5 text-center">
        <span className="font-mono-code text-xs text-zinc-600">
          Reading Base mainnet…
        </span>
      </div>
    );
  }

  const tallies = [
    { label: "Supports", n: evidence?.corroborating ?? 0, tone: "text-red-300" },
    { label: "Contradicts", n: evidence?.contradicting ?? 0, tone: "text-emerald-300" },
    { label: "Inconclusive", n: evidence?.inconclusive ?? 0, tone: "text-zinc-400" },
    { label: "Unavailable", n: evidence?.unavailable ?? 0, tone: "text-amber-300" },
  ];

  return (
    <div className="space-y-3 rounded-2xl border border-[#1e2433] bg-[#0a0f18] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1e2433] pb-3">
        <div>
          <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            On-chain evidence
          </div>
          <div className="font-mono-code text-xs text-zinc-300">
            {evidence ? (
              <>
                {shown.length} check{shown.length === 1 ? "" : "s"} anchored to block{" "}
                <span className="text-cyan-300">{evidence.blockNumber.toLocaleString()}</span>
              </>
            ) : (
              `${shown.length} check${shown.length === 1 ? "" : "s"} so far`
            )}
          </div>
        </div>
        {evidence && (
          <div className="flex flex-wrap gap-3">
            {tallies.map((t) => (
              <div key={t.label} className="text-center">
                <div className={`font-mono-code text-sm font-bold ${t.tone}`}>{t.n}</div>
                <div className="font-mono-code text-[9px] uppercase tracking-wider text-zinc-600">
                  {t.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {evidence?.noTargetResolved && (
        <p className="rounded-lg border border-amber-700/40 bg-amber-950/20 p-2.5 text-[11px] leading-relaxed text-amber-200/80">
          The claim named nothing checkable on Base. That is itself evidence — a report
          with no falsifiable specifics — and it was passed to the models as such.
        </p>
      )}

      {evidence?.budgetExhausted && (
        <p className="rounded-lg border border-zinc-700 bg-zinc-900/50 p-2.5 text-[11px] leading-relaxed text-zinc-400">
          The stage hit its time budget and stopped early. The checks below are the ones
          that completed.
        </p>
      )}

      <div className="space-y-2">
        {shown.map((c, i) => (
          <CheckRow key={`${c.id}-${i}`} check={c} />
        ))}
      </div>
    </div>
  );
}

"use client";

import { useCallback, useState } from "react";
import type { ModelVerdict, Stance } from "@/types";

/**
 * One model's answer, with the receipt attached.
 *
 * Two hackathon requirements meet on this card and neither is optional:
 *
 *   PRD 2       "Gonka request IDs must be visible in the UI for every
 *               inference step."
 *   PRD 13.1    "every model verdict must show which model produced it",
 *               with copyable request ids.
 *
 * And one honesty rule, PRD 13.2: the id may be presented as a chain record
 * only when it actually resolves to one. When the shard parsed, the card links
 * out. When it did not, it says "auditable request reference" and links
 * nowhere, because a dead link in front of a judge is worse than a plain
 * string.
 */

const STANCE: Record<Stance, { chip: string; dot: string; label: string }> = {
  REAL: {
    chip: "border-red-500/40 bg-red-950/50 text-red-300",
    dot: "bg-red-400",
    label: "REAL",
  },
  FAKE: {
    chip: "border-emerald-500/40 bg-emerald-950/50 text-emerald-300",
    dot: "bg-emerald-400",
    label: "FALSE",
  },
  UNCERTAIN: {
    chip: "border-amber-500/40 bg-amber-950/50 text-amber-300",
    dot: "bg-amber-400",
    label: "UNCERTAIN",
  },
};

/** "gonka/moonshotai/Kimi-K2-Instruct" reads as "Kimi-K2-Instruct". */
export function shortModelName(modelId: string): string {
  const tail = modelId.split("/").pop() ?? modelId;
  return tail.replace(/[:@].*$/, "");
}

function CopyableId({ value, resolvable, url }: { value: string; resolvable: boolean; url?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard
      ?.writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {
        /* clipboard blocked; the id is still selectable on screen */
      });
  }, [value]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
          {resolvable ? "Gonka request · on-chain" : "Auditable request reference"}
        </span>
        <button
          type="button"
          onClick={copy}
          className="shrink-0 cursor-pointer rounded border border-[#2d3748] px-1.5 py-0.5 font-mono-code text-[10px] text-zinc-400 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
          title="Copy the request id"
        >
          {copied ? "COPIED" : "COPY"}
        </button>
      </div>
      {resolvable && url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="block break-all font-mono-code text-[10px] text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
        >
          {value}
        </a>
      ) : (
        <span className="block break-all font-mono-code text-[10px] text-zinc-400">{value}</span>
      )}
    </div>
  );
}

export function ModelVerdictCard({ verdict }: { verdict: ModelVerdict }) {
  const s = STANCE[verdict.stance];
  const resolvable = Boolean(verdict.chainUrl);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-[#1e2433] bg-[#0a0f18] p-4 transition-colors hover:border-[#2d3748]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-mono-code text-sm font-bold text-white">
            {shortModelName(verdict.modelId)}
          </div>
          <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            {verdict.role.toLowerCase()}
          </div>
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono-code text-[10px] font-bold ${s.chip}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
          {s.label}
        </span>
      </div>

      <div className="flex items-end gap-2">
        <span className="font-mono-code text-3xl font-black tabular-nums text-white">
          {verdict.claimScore}
        </span>
        <span className="pb-1 font-mono-code text-xs text-zinc-500">/ 100</span>
        <span className="ml-auto pb-1 font-mono-code text-[10px] text-zinc-500">
          severity {verdict.severity}
        </span>
      </div>

      {verdict.keyEvidence.length > 0 && (
        <div className="space-y-1">
          <div className="font-mono-code text-[10px] uppercase tracking-wider text-emerald-500/80">
            Evidence cited
          </div>
          <ul className="space-y-1">
            {verdict.keyEvidence.slice(0, 2).map((e, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-zinc-300">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}

      {verdict.redFlags.length > 0 && (
        <div className="space-y-1">
          <div className="font-mono-code text-[10px] uppercase tracking-wider text-amber-500/80">
            Red flags
          </div>
          <ul className="space-y-1">
            {verdict.redFlags.slice(0, 2).map((f, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-zinc-300">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-auto space-y-2 border-t border-[#1e2433] pt-2">
        <div className="font-mono-code text-[10px] text-zinc-500">
          {(verdict.latencyMs / 1000).toFixed(1)}s
          {verdict.parseRepaired ? " · JSON repaired" : ""}
        </div>
        <CopyableId
          value={verdict.gonkaRequestId}
          resolvable={resolvable}
          url={verdict.chainUrl}
        />
      </div>
    </div>
  );
}

/** Placeholder while a model is still thinking, or after it dropped out. */
export function PendingVerdictCard({ waiting }: { waiting: boolean }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-[#1e2433] bg-[#070b12] p-4">
      <span
        className={`font-mono-code text-xs ${waiting ? "animate-pulse text-zinc-500" : "text-zinc-600"}`}
      >
        {waiting ? "waiting for model…" : "no response"}
      </span>
    </div>
  );
}

/**
 * The panel of three.
 *
 * Always renders three slots. A model that times out leaves a visible hole
 * rather than a grid that silently shrinks to two, because a degraded panel
 * changes what the consensus means and the viewer should be able to see it.
 */
export function VerdictPanel({
  verdicts,
  waiting,
  panelSize = 3,
}: {
  verdicts: ModelVerdict[];
  waiting: boolean;
  panelSize?: number;
}) {
  const missing = Math.max(0, panelSize - verdicts.length);

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {verdicts.map((v) => (
        <ModelVerdictCard key={v.modelId} verdict={v} />
      ))}
      {Array.from({ length: missing }).map((_, i) => (
        <PendingVerdictCard key={`pending-${i}`} waiting={waiting} />
      ))}
    </div>
  );
}

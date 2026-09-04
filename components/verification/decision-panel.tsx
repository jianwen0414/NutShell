"use client";

import type { ActionTier, BindingCap, HedgeDecision, MappingRule } from "@/types";

/**
 * What the policy engine decided, and what stopped it going further.
 *
 * The binding cap is the part worth reading. Any system can print a number it
 * intends to spend; this one says which of five limits actually produced that
 * number, which is the difference between a size and a justified size. PROJECT
 * PLAN 5 makes it a demo beat for exactly that reason: "show the sizing and
 * which cap bound it".
 */

const TIER: Record<ActionTier, { label: string; chip: string; blurb: string }> = {
  HEDGE_FULL: {
    label: "HEDGE — FULL SIZE",
    chip: "border-red-500/50 bg-red-950/60 text-red-300",
    blurb: "Truth and agreement both cleared the full-size thresholds.",
  },
  HEDGE_SMALL: {
    label: "HEDGE — REDUCED SIZE",
    chip: "border-amber-500/50 bg-amber-950/60 text-amber-300",
    blurb: "Credible enough to act on, not enough to commit the full budget.",
  },
  ESCALATE: {
    label: "ESCALATE",
    chip: "border-cyan-500/50 bg-cyan-950/60 text-cyan-300",
    blurb: "The claim scored highly but the models did not agree enough to trade on it.",
  },
  WATCH: {
    label: "WATCH",
    chip: "border-zinc-600 bg-zinc-900 text-zinc-300",
    blurb: "Logged and monitored. Below the threshold that spends anything.",
  },
  REJECT: {
    label: "REJECT",
    chip: "border-emerald-500/50 bg-emerald-950/60 text-emerald-300",
    blurb: "Read as a false alarm. Capital untouched — which is the common case.",
  },
};

const CAP: Record<BindingCap, string> = {
  RESERVE: "The premium reserve. Yield available to spend ran out before any other limit.",
  DAILY: "The daily cap. Earlier spending today left less room than the tier would allow.",
  CEILING: "The per-trade hard ceiling. The single largest trade this agent may ever place.",
  LIQUIDITY: "The order book. The best fillable quote could not absorb the intended size.",
  TIER: "The tier multiplier. The decision tier itself sized this, no external limit bit.",
  NONE: "Nothing bound it — the tier asked for zero, so no size was computed.",
};

const MAPPING: Record<MappingRule, string> = {
  DIRECT: "The claim named this asset outright.",
  CONTAGION: "The claim named something correlated; this is the closest hedgeable proxy.",
  ABSTAIN: "Nothing hedgeable could be resolved from the claim.",
};

export function DecisionPanel({
  decision,
  className = "",
}: {
  decision: HedgeDecision | null;
  className?: string;
}) {
  if (!decision) {
    return (
      <div
        className={`rounded-2xl border border-dashed border-[#1e2433] bg-[#070b12] p-5 text-center ${className}`}
      >
        <span className="font-mono-code text-xs text-zinc-600">
          No decision yet — policy runs once consensus lands.
        </span>
      </div>
    );
  }

  const t = TIER[decision.tier];
  const trades = decision.tier === "HEDGE_FULL" || decision.tier === "HEDGE_SMALL";

  return (
    <div className={`space-y-4 rounded-2xl border border-[#1e2433] bg-[#0a0f18] p-5 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            Policy decision
          </div>
          <span
            className={`inline-block rounded-lg border px-3 py-1 font-mono-code text-sm font-black ${t.chip}`}
          >
            {t.label}
          </span>
        </div>
        {trades && (
          <div className="text-right">
            <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
              Premium committed
            </div>
            <div className="font-mono-code text-2xl font-black tabular-nums text-amber-300">
              ${decision.targetSizeUsdc}
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-400">{t.blurb}</p>

      <div className="rounded-xl border border-[#1e2433] bg-[#070b12] p-3">
        <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
          Reason given
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-zinc-200">{decision.reason}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-[#1e2433] bg-[#070b12] p-3">
          <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            Instrument mapped
          </div>
          <div className="mt-0.5 font-mono-code text-sm font-bold text-white">
            {decision.targetAsset || "none"}{" "}
            <span className="text-[10px] font-normal text-cyan-400">
              {decision.mappingRule}
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
            {MAPPING[decision.mappingRule]}
          </p>
        </div>

        <div className="rounded-xl border border-[#1e2433] bg-[#070b12] p-3">
          <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            Binding cap
          </div>
          <div className="mt-0.5 font-mono-code text-sm font-bold text-cyan-300">
            {decision.bindingCap}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
            {CAP[decision.bindingCap]}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * The synthesizer's narrative.
 *
 * Layer 2 only runs when layer 1 disagreed, so an empty trace is a fact about
 * the run rather than a missing feature, and the empty state says so.
 */
export function ReasoningTrace({ trace }: { trace: string[] }) {
  const lines = trace.filter((t) => !t.toLowerCase().includes("synthesizer unavailable"));
  if (lines.length === 0) return null;

  return (
    <div className="space-y-2 rounded-2xl border border-[#1e2433] bg-[#0a0f18] p-5">
      <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
        How the disagreement was resolved
      </div>
      <ol className="space-y-2">
        {lines.map((line, i) => (
          <li key={i} className="flex gap-2.5 text-[11px] leading-relaxed text-zinc-300">
            <span className="mt-px font-mono-code text-[10px] text-cyan-500">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

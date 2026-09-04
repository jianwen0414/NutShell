"use client";

import type { ConsensusMetrics } from "@/types";

/**
 * Truth and agreement, side by side, at the same size.
 *
 * PRD 13.1 makes this a functional requirement rather than a styling
 * preference: "the agreement metric must be as prominent as the truth score".
 * The reason is the product argument itself. A high truth score from three
 * models that disagree is not the same claim as a high truth score from three
 * that concur, and the policy engine treats them differently — agreement has
 * its own threshold and can downgrade a HEDGE to an ESCALATE on its own. A
 * layout that renders truth large and buries agreement in an accordion tells
 * the viewer the opposite of how the system actually decides.
 *
 * So: two dials, identical geometry, identical type scale.
 */

const BANDS = {
  hedge: 70,
  watch: 40,
} as const;

function truthTone(score: number) {
  if (score >= BANDS.hedge) return { stroke: "#ef4444", text: "text-red-400", label: "REAL INCIDENT" };
  if (score >= BANDS.watch) return { stroke: "#f59e0b", text: "text-amber-400", label: "SUSPICIOUS" };
  return { stroke: "#10b981", text: "text-emerald-400", label: "FALSE ALARM" };
}

function agreementTone(fraction: number) {
  if (fraction >= 0.75) return { stroke: "#10b981", text: "text-emerald-400", label: "STRONG CONSENSUS" };
  if (fraction >= 0.6) return { stroke: "#06b6d4", text: "text-cyan-400", label: "QUORUM MET" };
  return { stroke: "#f59e0b", text: "text-amber-400", label: "MODELS SPLIT" };
}

interface DialProps {
  value: number;
  /** 0-100 for the arc sweep. */
  percent: number;
  suffix?: string;
  caption: string;
  sublabel: string;
  stroke: string;
  textClass: string;
  pending: boolean;
}

function Dial({ value, percent, suffix, caption, sublabel, stroke, textClass, pending }: DialProps) {
  // A 240 degree arc reads as a gauge rather than a progress ring, and leaves
  // room at the bottom for the caption without crowding the number.
  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const sweep = 0.75;
  const track = circumference * sweep;
  const filled = track * Math.max(0, Math.min(1, percent / 100));

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-[132px] w-[132px]">
        <svg viewBox="0 0 132 132" className="h-full w-full -rotate-[225deg]">
          <circle
            cx="66"
            cy="66"
            r={radius}
            fill="none"
            stroke="#1a2130"
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${track} ${circumference}`}
          />
          <circle
            cx="66"
            cy="66"
            r={radius}
            fill="none"
            stroke={pending ? "#2d3748" : stroke}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            className="transition-all duration-700 ease-out"
            style={pending ? undefined : { filter: `drop-shadow(0 0 6px ${stroke}66)` }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div
            className={`font-mono-code text-3xl font-black tabular-nums ${
              pending ? "text-zinc-600" : textClass
            }`}
          >
            {pending ? "—" : value}
            {!pending && suffix ? (
              <span className="text-base font-bold">{suffix}</span>
            ) : null}
          </div>
          <div className="font-mono-code text-[10px] uppercase tracking-[0.18em] text-zinc-500">
            {caption}
          </div>
        </div>
      </div>
      <div
        className={`font-mono-code text-[10px] font-bold uppercase tracking-wider ${
          pending ? "text-zinc-600" : textClass
        }`}
      >
        {pending ? "AWAITING MODELS" : sublabel}
      </div>
    </div>
  );
}

export function ScoreGauges({
  consensus,
  className = "",
}: {
  consensus: ConsensusMetrics | null;
  className?: string;
}) {
  const pending = !consensus;
  const truth = consensus?.truthScore ?? 0;
  const agreement = consensus?.agreement ?? 0;
  const t = truthTone(truth);
  const a = agreementTone(agreement);

  return (
    <div className={`flex flex-wrap items-start justify-center gap-8 sm:gap-14 ${className}`}>
      <Dial
        value={truth}
        percent={truth}
        caption="Truth"
        sublabel={t.label}
        stroke={t.stroke}
        textClass={t.text}
        pending={pending}
      />
      <Dial
        value={Math.round(agreement * 100)}
        percent={agreement * 100}
        suffix="%"
        caption="Agreement"
        sublabel={a.label}
        stroke={a.stroke}
        textClass={a.text}
        pending={pending}
      />
    </div>
  );
}

/**
 * The numbers behind the two dials.
 *
 * Spread and concordance are what make agreement falsifiable rather than a
 * mood — they say how far apart the models were and how many shared the modal
 * stance, so a viewer can check the headline number against its inputs.
 */
export function ConsensusDetail({ consensus }: { consensus: ConsensusMetrics | null }) {
  if (!consensus) return null;

  const rows: Array<{ label: string; value: string; hint: string }> = [
    {
      label: "Conviction",
      value: consensus.conviction.toFixed(2),
      hint: "truth ÷ 100 × agreement — what sizing is scaled by",
    },
    {
      label: "Spread",
      value: String(consensus.spread),
      hint: "highest model score minus lowest",
    },
    {
      label: "Concordance",
      value: `${Math.round(consensus.concordance * 100)}%`,
      hint: "share of models on the modal stance",
    },
    {
      label: "Severity",
      value: `${consensus.severity} / 5`,
      hint: "median across responding models",
    },
    {
      label: "Panel",
      value: `${consensus.modelsResponded} / 3`,
      hint: "models that returned a usable vote",
    },
    {
      label: "Challenge round",
      value: consensus.debateTriggered ? "Triggered" : "Not needed",
      hint: "runs when layer 1 disagrees",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {rows.map((r) => (
        <div
          key={r.label}
          className="rounded-xl border border-[#1e2433] bg-[#0a0f18] p-3"
          title={r.hint}
        >
          <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            {r.label}
          </div>
          <div className="mt-0.5 font-mono-code text-sm font-bold text-white tabular-nums">
            {r.value}
          </div>
        </div>
      ))}
    </div>
  );
}

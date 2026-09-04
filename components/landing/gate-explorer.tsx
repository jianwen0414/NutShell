"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The gate, with its hands on the controls.
 *
 * This is the beat from `scripts/decline-demo.ts`, given a home. Two readings
 * of one event, priced against the same book: the signal scores 91 with 86%
 * agreement and commits the full budget; the debunk scores the *same* 91 with
 * 31% agreement and commits nothing. The truth score does not move. Agreement
 * alone flips it — which is the entire difference between a consensus system
 * and one that averages three numbers.
 *
 * It is interactive because PRD §18 does not ask for the agreement metric to be
 * displayed, it asks for it to "demonstrably change the outcome". A number on a
 * card is not a demonstration; a control that flips HEDGE_FULL to ESCALATE when
 * you drag it under the floor is.
 *
 * Every answer comes from the real `selectTier` via /api/policy/preview, using
 * whatever thresholds the operator currently has set. Nothing here re-implements
 * the matrix, which is the trap the terminal version fell into.
 */

interface Preview {
  tier: string;
  reason: string;
  thresholds: {
    truthHedge: number;
    truthFull: number;
    agreement: number;
    agreementFull: number;
  };
}

const PRESETS = [
  { label: "The signal", truth: 91, agreement: 86, severity: 5 },
  { label: "The debunk", truth: 91, agreement: 31, severity: 5 },
] as const;

const TIER_TONE: Record<string, { chip: string; note: string }> = {
  HEDGE_FULL: {
    chip: "border-red-500/50 bg-red-950/60 text-red-300",
    note: "Buys protection at full size.",
  },
  HEDGE_SMALL: {
    chip: "border-amber-500/50 bg-amber-950/60 text-amber-300",
    note: "Buys protection at reduced size.",
  },
  ESCALATE: {
    chip: "border-cyan-500/50 bg-cyan-950/60 text-cyan-300",
    note: "Credible, but the panel is split. Nothing is spent.",
  },
  WATCH: {
    chip: "border-zinc-600 bg-zinc-900 text-zinc-300",
    note: "Monitored. Nothing is spent.",
  },
  REJECT: {
    chip: "border-emerald-500/50 bg-emerald-950/60 text-emerald-300",
    note: "Read as a false alarm. Nothing is spent.",
  },
};

export function GateExplorer() {
  const [truth, setTruth] = useState(91);
  const [agreement, setAgreement] = useState(86);
  const [preview, setPreview] = useState<Preview | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (t: number, a: number) => {
    const mine = ++seq.current;
    try {
      const res = await fetch(
        `/api/policy/preview?truth=${t}&agreement=${(a / 100).toFixed(4)}&severity=5`,
      );
      if (!res.ok) return;
      const data = await res.json();
      // Slider drags fire faster than the round trip; only the newest answer
      // may land, or the panel flickers backwards through stale results.
      if (mine === seq.current) setPreview(data);
    } catch {
      /* leave the previous answer up */
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(truth, agreement), 90);
    return () => clearTimeout(t);
  }, [truth, agreement, load]);

  const tone = preview ? (TIER_TONE[preview.tier] ?? TIER_TONE.WATCH) : null;
  const spends = preview?.tier === "HEDGE_FULL" || preview?.tier === "HEDGE_SMALL";
  const floor = preview ? Math.round(preview.thresholds.agreement * 100) : 60;

  return (
    <div className="overflow-hidden rounded-3xl border border-[#1e2433] bg-[#0a0f18]/90 backdrop-blur-xl">
      <div className="border-b border-[#1e2433] px-5 py-3.5 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono-code text-xs font-bold uppercase tracking-wider text-white">
            The gate, before the money moves
          </span>
          <span className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            Live policy engine · nothing is spent
          </span>
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => {
              const active = truth === p.truth && agreement === p.agreement;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setTruth(p.truth);
                    setAgreement(p.agreement);
                  }}
                  className={`cursor-pointer rounded-full border px-3.5 py-1.5 font-mono-code text-[11px] font-bold transition-colors ${
                    active
                      ? "border-emerald-500/50 bg-emerald-950/40 text-emerald-300"
                      : "border-[#2d3748] bg-[#0e1622] text-zinc-300 hover:border-emerald-500/40"
                  }`}
                >
                  {p.label} · truth {p.truth} · agreement {p.agreement}%
                </button>
              );
            })}
          </div>

          <div className="space-y-4">
            <label className="block">
              <span className="flex items-baseline justify-between font-mono-code text-[11px] text-zinc-400">
                <span>Truth score</span>
                <strong className="text-lg text-white">{truth}</strong>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={truth}
                onChange={(e) => setTruth(Number(e.target.value))}
                className="mt-1.5 w-full cursor-pointer accent-red-400"
              />
            </label>

            <label className="block">
              <span className="flex items-baseline justify-between font-mono-code text-[11px] text-zinc-400">
                <span>Model agreement</span>
                <strong className="text-lg text-white">{agreement}%</strong>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={agreement}
                onChange={(e) => setAgreement(Number(e.target.value))}
                className="mt-1.5 w-full cursor-pointer accent-emerald-400"
              />
              <span className="mt-1 block font-mono-code text-[10px] text-zinc-600">
                The floor is {floor}%. Drag below it and the decision changes with the
                truth score untouched.
              </span>
            </label>
          </div>
        </div>

        <div className="flex flex-col justify-center gap-3 rounded-2xl border border-[#1e2433] bg-[#05070b] p-5">
          <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
            The agent would
          </div>
          <span
            className={`inline-block self-start rounded-lg border px-3 py-1.5 font-mono-code text-sm font-black transition-colors ${
              tone?.chip ?? "border-zinc-700 bg-zinc-900 text-zinc-500"
            }`}
          >
            {preview?.tier ?? "…"}
          </span>
          <p className="text-[11px] leading-relaxed text-zinc-400">
            {tone?.note ?? "Asking the policy engine…"}
          </p>
          {preview && (
            <p className="border-t border-[#1e2433] pt-3 text-[11px] leading-relaxed text-zinc-500">
              {preview.reason}
            </p>
          )}
          <div
            className={`mt-1 rounded-lg border px-3 py-2 font-mono-code text-[11px] font-bold ${
              spends
                ? "border-amber-700/50 bg-amber-950/20 text-amber-300"
                : "border-emerald-700/40 bg-emerald-950/20 text-emerald-300"
            }`}
          >
            {spends ? "Premium committed" : "Premium not spent"}
          </div>
        </div>
      </div>
    </div>
  );
}

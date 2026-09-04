"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { ConsensusMetrics } from "@/types";

/**
 * The last day of screening, plotted against the thresholds that decide.
 *
 * Every point is a headline the system actually read. Height is the truth
 * score for the ones that reached a verdict; the ones triage rejected sit on
 * a baseline, because they were never scored and pretending otherwise would
 * invent a number.
 *
 * The previous version of this chart had four points hardcoded at 14:15,
 * 14:24, 14:31 and 14:36 with fixed scores, which never moved and never
 * corresponded to anything the system had done.
 */

export interface RadarEvent {
  id: string;
  title: string;
  sourceName: string;
  publishedAt: string;
  kept: boolean;
  reason: string;
  asset: string | null;
  jobId: string | null;
  outcome: { truthScore: number; agreement: number; tier: string; status: string } | null;
}

/** Rejected items were never scored, so they sit here rather than at zero. */
const BASELINE = 6;

function scoreOf(e: RadarEvent): number {
  return e.outcome ? e.outcome.truthScore : BASELINE;
}

function toneOf(score: number, kept: boolean) {
  if (!kept) return { dot: "bg-zinc-700 border-zinc-600", text: "text-zinc-500" };
  if (score >= 70) return { dot: "bg-red-500 border-red-300", text: "text-red-300" };
  if (score >= 40) return { dot: "bg-amber-500 border-amber-300", text: "text-amber-300" };
  return { dot: "bg-emerald-500 border-emerald-300", text: "text-emerald-300" };
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function ThreatRadar({
  events,
  live,
  agentPaused,
}: {
  events: RadarEvent[];
  /** The run happening right now, if any. */
  live: { consensus: ConsensusMetrics | null; running: boolean; jobId: string | null };
  agentPaused: boolean;
}) {
  const [selected, setSelected] = useState<string | null>(null);

  // Oldest to newest, left to right, capped so the axis stays readable.
  const plotted = useMemo(() => {
    const sorted = [...events].sort(
      (a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt),
    );
    // Prefer the scored ones — a row of identical baseline dots says nothing.
    const scored = sorted.filter((e) => e.outcome);
    const rest = sorted.filter((e) => !e.outcome);
    const keep = [...scored, ...rest.slice(0, Math.max(0, 14 - scored.length))];
    return keep.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  }, [events]);

  const liveScore = live.consensus?.truthScore ?? BASELINE;
  const active = plotted.find((e) => e.id === selected) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col justify-between gap-2 border-b border-zinc-800/80 pb-3 sm:flex-row sm:items-center">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2 font-mono-code text-xs font-bold uppercase tracking-wider text-white">
            {agentPaused ? (
              <>
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-amber-300">Detection paused</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 animate-ping rounded-full bg-cyan-400" />
                <span>Suspicion timeline</span>
              </>
            )}
          </div>
          <p className="text-xs text-zinc-400">
            {agentPaused
              ? "Autonomous scanning is idle. Resume it in the console."
              : "Every point is a headline the agent read. Click one to see what it decided."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono-code text-[11px]">
          <span className="flex items-center gap-1 text-zinc-500">
            <span className="h-1.5 w-1.5 rounded-full bg-zinc-700" /> Screened out
          </span>
          <span className="flex items-center gap-1 text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Rejected (&lt;40)
          </span>
          <span className="flex items-center gap-1 text-amber-400">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Watch (40–69)
          </span>
          <span className="flex items-center gap-1 text-red-400">
            <span className="h-1.5 w-1.5 rounded-full bg-red-400" /> Hedge (≥70)
          </span>
        </div>
      </div>

      <div className="relative h-56 overflow-hidden rounded-2xl border border-zinc-800/50 bg-[#04070c] p-4">
        {agentPaused && !live.running && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-[#04070c]/85 p-4 text-center backdrop-blur-[1.5px]">
            <span className="flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-950/90 px-3.5 py-1.5 font-mono-code text-xs font-bold text-amber-300">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Detection and scanning idle
            </span>
            <p className="max-w-sm text-[11px] text-zinc-400">
              Sensors are paused by the operator. Verification still works — pausing stops
              the agent acting, not answering.
            </p>
          </div>
        )}

        {/*
          Hedge threshold, on the same scale as the points. Right-aligned: the
          left edge is where the oldest point sits, and a badge there covers it.
        */}
        <div
          className="pointer-events-none absolute inset-x-0 z-0 flex justify-end px-4"
          style={{ bottom: `${16 + 70 * 1.55}px` }}
        >
          <span className="-mt-3.5 rounded-md border border-red-500/60 bg-red-950/95 px-2.5 py-0.5 font-mono-code text-[10px] font-bold text-red-300">
            HEDGE THRESHOLD · TRUTH ≥ 70
          </span>
        </div>
        <div
          className="pointer-events-none absolute inset-x-0 z-0 border-b border-dashed border-red-500/50"
          style={{ bottom: `${16 + 70 * 1.55}px` }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 z-0 border-b border-dashed border-amber-500/25"
          style={{ bottom: `${16 + 40 * 1.55}px` }}
        />

        <div className="pointer-events-none absolute inset-0 grid grid-cols-6 grid-rows-4 opacity-10">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="border-b border-r border-cyan-500" />
          ))}
        </div>

        <div className="absolute inset-0 flex items-end justify-between gap-1 px-5 pb-4">
          {plotted.map((e) => {
            const score = scoreOf(e);
            const tone = toneOf(score, e.kept);
            const isSel = selected === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelected(isSel ? null : e.id)}
                className={`group flex cursor-pointer flex-col items-center transition-transform ${
                  isSel ? "scale-125" : "hover:scale-110"
                }`}
                style={{ transform: `translateY(-${score * 1.55}px)` }}
                title={e.title}
              >
                <span
                  className={`flex h-3 w-3 items-center justify-center rounded-full border-2 ${
                    isSel ? "border-white bg-cyan-400 ring-4 ring-cyan-400/40" : tone.dot
                  }`}
                />
                <span
                  className={`mt-1 font-mono-code text-[10px] ${
                    isSel ? "font-bold text-cyan-300" : "text-zinc-600 group-hover:text-cyan-300"
                  }`}
                >
                  {hhmm(e.publishedAt)}
                </span>
              </button>
            );
          })}

          {/* Now. */}
          <div
            className="flex flex-col items-center"
            style={{ transform: `translateY(-${liveScore * 1.55}px)` }}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                agentPaused
                  ? "border-amber-400/80 bg-zinc-900"
                  : live.running
                    ? "animate-pulse border-cyan-400 bg-cyan-950 ring-4 ring-cyan-400/30"
                    : live.consensus && live.consensus.truthScore >= 70
                      ? "border-red-500 bg-red-950 ring-4 ring-red-500/30"
                      : "border-emerald-400 bg-emerald-950 ring-2 ring-emerald-500/20"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  agentPaused
                    ? "bg-amber-400"
                    : live.running
                      ? "animate-ping bg-cyan-400"
                      : "bg-emerald-400"
                }`}
              />
            </span>
            <span className="mt-1 whitespace-nowrap rounded border border-zinc-700 bg-zinc-900/90 px-2 py-0.5 font-mono-code text-[10px] font-bold text-white">
              {agentPaused
                ? "NOW · PAUSED"
                : live.consensus
                  ? `NOW · ${live.consensus.truthScore}`
                  : live.running
                    ? "NOW · ANALYSING"
                    : "NOW · SCANNING"}
            </span>
          </div>
        </div>
      </div>

      {active && (
        <div className="animate-fadeIn space-y-2 rounded-xl border border-cyan-950 bg-[#09111c] p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-white">{active.title}</span>
                <span className="font-mono-code text-[10px] text-zinc-500">
                  {active.sourceName} · {hhmm(active.publishedAt)} UTC
                </span>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400">{active.reason}</p>
              {active.jobId && (
                <Link
                  href={`/incident/${active.jobId}`}
                  className="inline-block font-mono-code text-[11px] text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
                >
                  Open the full record →
                </Link>
              )}
            </div>
            <div className="shrink-0 text-right">
              <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
                {active.outcome ? "Truth score" : "Never scored"}
              </div>
              <div
                className={`font-mono-code text-lg font-bold ${toneOf(scoreOf(active), active.kept).text}`}
              >
                {active.outcome ? `${active.outcome.truthScore} / 100` : "—"}
              </div>
              {active.outcome && (
                <div className="font-mono-code text-[10px] text-zinc-500">
                  {active.outcome.tier}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

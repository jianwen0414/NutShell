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

/**
 * One geometry for the whole plot.
 *
 * The dots, the curve and the threshold lines each used to derive their own
 * position — flexbox for the dots, a stretched 1000x200 viewBox for the curve,
 * a third offset for the lines — so the curve ran about 19px below the points
 * it was meant to join, ended short of the last one, and the hedge line missed
 * the hedged dots by a similar margin. Everything is placed from the two
 * functions below instead, and the viewBox is 224 units tall so that its y
 * units are the pixels of the box.
 */
const PLOT_H = 224; // matches h-56 on the plot box
const FLOOR = 24; // px above the floor where a score of zero sits
const PER_POINT = 1.5; // px of height per truth-score point
const PAD_L = 11; // % of width reserved on the left for the axis labels
const PAD_R = 6; // % of width kept clear on the right for the NOW marker

/** Distance from the floor of the box to the centre of a point, in px. */
const bottomFor = (score: number) => FLOOR + score * PER_POINT;

/** Horizontal position of point `i` of `n`, as a percentage of the width. */
const xFor = (i: number, n: number) =>
  n <= 1 ? PAD_L : PAD_L + (i * (100 - PAD_L - PAD_R)) / (n - 1);

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

  // The plotted headlines, plus the live point on the end.
  const total = plotted.length + 1;

  /** The path through the plotted scores, in the shared geometry. */
  const curve = useMemo(() => {
    const scores = [...plotted.map(scoreOf), liveScore];
    if (scores.length < 2) return null;

    const points = scores.map((s, i) => ({
      x: xFor(i, scores.length) * 10, // percent of the width, in viewBox units
      y: PLOT_H - bottomFor(s),
    }));

    // Midpoint smoothing: each segment curves through the average of its
    // endpoints, which rounds the joins without letting the line rise above
    // the highest point it connects.
    let d = `M ${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const cur = points[i];
      const mx = (prev.x + cur.x) / 2;
      d += ` Q ${prev.x.toFixed(1)},${prev.y.toFixed(1)} ${mx.toFixed(1)},${((prev.y + cur.y) / 2).toFixed(1)}`;
      d += ` Q ${cur.x.toFixed(1)},${cur.y.toFixed(1)} ${cur.x.toFixed(1)},${cur.y.toFixed(1)}`;
    }

    const endTone =
      liveScore >= 70 ? "#ef4444" : liveScore >= 40 ? "#f59e0b" : "#10b981";

    return { d, endTone, first: points[0].x, last: points[points.length - 1].x };
  }, [plotted, liveScore]);

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

      <div className="relative h-56 overflow-hidden rounded-2xl border border-zinc-800/50 bg-[#04070c]">
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

        <div className="pointer-events-none absolute inset-0 grid grid-cols-6 grid-rows-4 opacity-10">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="border-b border-r border-cyan-500" />
          ))}
        </div>

        {/*
          The tier thresholds, on the same scale as the points, labelled in a
          gutter down the left. The label used to be a badge floated to the
          right of its line, where it landed on top of whichever point happened
          to be there — which in a hedged run is the point worth looking at.
        */}
        {[
          { score: 70, line: "border-red-500/50", text: "text-red-300/90" },
          { score: 40, line: "border-amber-500/25", text: "text-amber-300/70" },
        ].map((t) => (
          <div
            key={t.score}
            className="pointer-events-none absolute inset-x-0 z-0"
            style={{ bottom: `${bottomFor(t.score)}px` }}
          >
            <div
              className={`absolute top-0 border-b border-dashed ${t.line}`}
              style={{ left: `${PAD_L - 4}%`, right: 0 }}
            />
            <span
              className={`absolute left-2 top-0 -translate-y-1/2 font-mono-code text-[10px] font-bold ${t.text}`}
            >
              ≥ {t.score}
            </span>
          </div>
        ))}

        {/*
          The curve through the points.

          The old version drew a fixed decorative path that ignored the data —
          it swept to the same shape whatever had been screened. This one is
          built from the plotted scores, so a flat run of rejections reads flat
          and a spike is a real one. Smoothed with a monotone-ish midpoint
          spline so it never overshoots above a point and implies a score
          nothing earned.
        */}
        {curve && (
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            viewBox={`0 0 1000 ${PLOT_H}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="radarStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="70%" stopColor="#10b981" />
                <stop offset="100%" stopColor={curve.endTone} />
              </linearGradient>
              <linearGradient id="radarFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={curve.endTone} stopOpacity="0.22" />
                <stop offset="100%" stopColor={curve.endTone} stopOpacity="0.02" />
              </linearGradient>
            </defs>
            {/* Closed against the floor under the first and last points only. */}
            <path
              d={`${curve.d} L ${curve.last.toFixed(1)},${PLOT_H} L ${curve.first.toFixed(1)},${PLOT_H} Z`}
              fill="url(#radarFill)"
            />
            <path
              d={curve.d}
              fill="none"
              stroke="url(#radarStroke)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}

        {/*
          The points. Each is centred on its coordinate — bottom puts its lower
          edge on the score, translate-y-1/2 pushes it down by half its height —
          and the time label hangs off it absolutely, so the label never shifts
          the dot it belongs to.
        */}
        <div className="absolute inset-0">
          {plotted.map((e, i) => {
            const score = scoreOf(e);
            const tone = toneOf(score, e.kept);
            const isSel = selected === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelected(isSel ? null : e.id)}
                className={`group absolute z-[1] -translate-x-1/2 translate-y-1/2 cursor-pointer transition-transform ${
                  isSel ? "scale-125" : "hover:scale-110"
                }`}
                style={{ left: `${xFor(i, total)}%`, bottom: `${bottomFor(score)}px` }}
                title={e.title}
              >
                <span
                  className={`block h-3 w-3 rounded-full border-2 ${
                    isSel ? "border-white bg-cyan-400 ring-4 ring-cyan-400/40" : tone.dot
                  }`}
                />
                <span
                  className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 font-mono-code text-[10px] ${
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
            className="absolute z-[1] -translate-x-1/2 translate-y-1/2"
            style={{
              left: `${xFor(total - 1, total)}%`,
              bottom: `${bottomFor(liveScore)}px`,
            }}
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
            {/* Right-aligned: it is the widest label and sits closest to the edge. */}
            <span className="absolute right-0 top-full mt-1 whitespace-nowrap rounded border border-zinc-700 bg-zinc-900/90 px-2 py-0.5 font-mono-code text-[10px] font-bold text-white">
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

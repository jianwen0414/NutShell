"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { RadarEvent } from "./threat-radar";

/**
 * What the agent decided, most recent first.
 *
 * Deliberately the promoted items rather than the raw stream. On a normal day
 * the newest eight headlines are eight rejections with eight identical badges,
 * which tells a reader nothing and buries the handful of items that actually
 * reached the models. The full firehose, rejections and all, is the whole point
 * of /signals and one click away.
 *
 * Replaces a table of four hardcoded rows labelled "Last 4 Background Signals"
 * that had never been near a feed.
 */

function relative(iso: string): string {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Outcome({ e }: { e: RadarEvent }) {
  if (!e.kept) {
    return (
      <span className="inline-block rounded border border-zinc-700 bg-zinc-900 px-2.5 py-0.5 font-mono-code text-[10px] font-bold text-zinc-400">
        SCREENED OUT
      </span>
    );
  }
  if (!e.outcome) {
    return (
      <span className="inline-block rounded border border-cyan-500/30 bg-cyan-950/50 px-2.5 py-0.5 font-mono-code text-[10px] font-bold text-cyan-300">
        VERIFYING
      </span>
    );
  }
  const t = e.outcome.tier;
  const tone =
    t === "HEDGE_FULL" || t === "HEDGE_SMALL"
      ? "border-red-500/30 bg-red-950/50 text-red-300"
      : t === "ESCALATE"
        ? "border-cyan-500/30 bg-cyan-950/50 text-cyan-300"
        : t === "WATCH"
          ? "border-amber-500/30 bg-amber-950/50 text-amber-300"
          : "border-emerald-500/30 bg-emerald-950/50 text-emerald-300";
  return (
    <span
      className={`inline-block rounded border px-2.5 py-0.5 font-mono-code text-[10px] font-bold ${tone}`}
    >
      {t}
    </span>
  );
}

export function RecentSignals() {
  const [events, setEvents] = useState<RadarEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/events?kept=true&limit=8")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && Array.isArray(d)) setEvents(d as RadarEvent[]);
        })
        .catch(() => {});
    };
    const first = setTimeout(load, 0);
    const repeat = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(repeat);
    };
  }, []);

  return (
    <div className="space-y-4 pt-4">
      <div className="flex items-center justify-between font-mono-code">
        <span className="text-sm font-bold uppercase tracking-wider text-zinc-300">
          Recent verifications
        </span>
        <Link
          href="/signals"
          className="text-xs text-cyan-400 underline decoration-cyan-500/40 underline-offset-2 hover:text-cyan-300"
        >
          See everything screened →
        </Link>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-zinc-800/60 bg-[#090c12] shadow-md">
        <table className="w-full text-left font-mono-code text-sm">
          <thead>
            <tr className="border-b border-zinc-800/80 text-xs uppercase text-zinc-400">
              <th className="px-5 py-3.5">Headline</th>
              <th className="hidden px-5 py-3.5 md:table-cell">Source</th>
              <th className="hidden px-5 py-3.5 lg:table-cell">Truth</th>
              <th className="px-5 py-3.5 text-right">Outcome</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/40 text-zinc-200">
            {events === null && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-xs text-zinc-600">
                  Loading…
                </td>
              </tr>
            )}
            {events?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-xs text-zinc-600">
                  Nothing has passed screening yet. Every headline so far was dismissed before reaching the models.
                </td>
              </tr>
            )}
            {events?.map((e) => (
              <tr key={e.id} className="transition-colors hover:bg-zinc-900/50">
                <td className="max-w-sm px-5 py-3.5">
                  {e.jobId ? (
                    <Link
                      href={`/incident/${e.jobId}`}
                      className="line-clamp-1 font-semibold text-white hover:text-cyan-300"
                    >
                      {e.title}
                    </Link>
                  ) : (
                    <span className="line-clamp-1 font-semibold text-zinc-300">{e.title}</span>
                  )}
                  <div className="mt-0.5 line-clamp-1 text-[10px] font-normal text-zinc-500">
                    {e.reason}
                  </div>
                </td>
                <td className="hidden px-5 py-3.5 text-xs text-zinc-400 md:table-cell">
                  {e.sourceName}
                  <div className="text-[10px] text-zinc-600">{relative(e.publishedAt)}</div>
                </td>
                <td className="hidden px-5 py-3.5 lg:table-cell">
                  {e.outcome ? (
                    <span className="font-bold text-white">{e.outcome.truthScore}/100</span>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <Outcome e={e} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

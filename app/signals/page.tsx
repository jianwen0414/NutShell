"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Navigation } from "@/components/navigation";
import { useOperatorToken } from "@/components/console/use-operator-token";

/**
 * Stage 01 — what the system read and what it did about it.
 *
 * A work surface, so it carries no ambient motion. Everything that moves here
 * moves because data arrived.
 *
 * The rejections are the point. A feed showing only the headlines that passed
 * would be indistinguishable from a feed that found nothing, and it would hide
 * the part a judge should be able to audit: the reason each item was dropped.
 */

interface EventItem {
  id: string;
  /** Contract field: structured source, not a bare name. */
  source: { type: string; name: string; url?: string };
  receivedAt: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  ingestedAt: string;
  kept: boolean;
  reason: string;
  asset: string | null;
  jobId: string | null;
}

interface Stats {
  polling: boolean;
  intervalMs: number;
  polls: number;
  lastPollAt: string | null;
  lastPollError: string | null;
  screened: number;
  kept: number;
  rejected: number;
}

/** Publisher marks. The favicon when it loads, initials when it does not. */
const SOURCE_MARK: Record<string, { initials: string; domain: string }> = {
  Cointelegraph: { initials: "CT", domain: "cointelegraph.com" },
  "The Block": { initials: "TB", domain: "theblock.co" },
  Decrypt: { initials: "DC", domain: "decrypt.co" },
  CryptoSlate: { initials: "CS", domain: "cryptoslate.com" },
};

function SourceMark({ source }: { source: string }) {
  const mark = SOURCE_MARK[source];
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#1e2433] bg-[#0e1622] overflow-hidden">
      <span className="font-mono-code text-[10px] font-bold tracking-wider text-zinc-500">
        {mark?.initials ?? source.slice(0, 2).toUpperCase()}
      </span>
      {mark && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://${mark.domain}/favicon.ico`}
          alt=""
          width={20}
          height={20}
          className="absolute inset-0 m-auto h-5 w-5 object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function relative(iso: string): string {
  const mins = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type Filter = "all" | "kept" | "rejected";

export default function FeedPage() {
  const [items, setItems] = useState<EventItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const { authHeaders, hasToken } = useOperatorToken();
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  // Expansion is rendered state, so it lives in state. It was held in a ref
  // alongside a force-render counter, which means reading the ref during
  // render — the pattern the React compiler flags, because a ref mutated
  // outside a commit can disagree with what was actually painted.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [visible, setVisible] = useState(30);

  // Two calls, because the contract fixes /api/events as a bare array and
  // leaves the counters nowhere to live. They are fetched together so the
  // tiles and the list never disagree about what has been screened.
  const load = useCallback(async () => {
    try {
      const [eventsRes, statsRes] = await Promise.all([
        fetch("/api/events?limit=120"),
        fetch("/api/ingest"),
      ]);
      const events = await eventsRes.json();
      setItems(Array.isArray(events) ? events : []);
      setStats(statsRes.ok ? await statsRes.json() : null);
    } catch {
      /* the next tick retries */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    // The first pass goes through the same scheduler as the rest rather than
    // running inline. Calling it in the effect body sets state synchronously
    // during the commit, which cascades a second render before paint.
    let cancelled = false;
    const tick = () => {
      if (!cancelled) void load();
    };
    const first = setTimeout(tick, 0);
    const repeat = setInterval(tick, 15_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(repeat);
    };
  }, [load]);

  async function scanNow() {
    setScanning(true);
    setNotice(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeaders(),
        },
        body: JSON.stringify({ action: "poll" }),
      });
      const body = await res.json();
      if (!res.ok) {
        setNotice(body?.error?.message ?? "Scan failed.");
      } else {
        const r = body.result;
        setNotice(
          `Read ${r.fetched} headlines. ${r.fresh} new, ${r.kept} passed screening` +
            (r.seeded ? ", baseline established so no verification started." : "."),
        );
        await load();
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  const matching = items.filter((i) =>
    filter === "all" ? true : filter === "kept" ? i.kept : !i.kept,
  );
  // The full history is the point of the page, but a few hundred articles in
  // one scroll is not readable. Everything is reachable, a page at a time.
  const shown = matching.slice(0, visible);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-[#070e17]">
        <div className="mx-auto max-w-[1560px] px-4 py-8 sm:px-6 lg:px-10">
        {/* Heading */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="font-mono-code text-[11px] uppercase tracking-[0.28em] text-cyan-400/80">
              Stage 01 · Detect
            </div>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Signal Intake
            </h1>
            <p className="mt-2 max-w-[34em] text-sm leading-relaxed text-zinc-400">
              Public crypto newswires, read continuously and screened before
              anything reaches the verification layer. Every headline the system
              saw is listed, including the ones it dismissed.
            </p>
          </div>

          {/*
            The scan control, without a password box beside the headline. This
            page is for anyone auditing the filter; the token it needs is the
            one already held for the session, entered once on the console.
          */}
          <div className="flex items-center gap-2">
            <button
              onClick={scanNow}
              disabled={scanning}
              className="cursor-pointer rounded-lg bg-cyan-500 px-4 py-2 font-mono-code text-xs font-semibold uppercase tracking-wider text-[#04121a] transition-transform duration-100 hover:bg-cyan-400 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              title={
                hasToken
                  ? "Runs one pass over every feed now."
                  : "Needs the operator token — enter it once on the console."
              }
            >
              {scanning ? "Scanning" : "Scan now"}
            </button>
            {!hasToken && (
              <Link
                href="/console"
                className="font-mono-code text-[11px] text-zinc-500 underline decoration-zinc-700 underline-offset-2 hover:text-cyan-300"
              >
                operator token →
              </Link>
            )}
          </div>
        </div>

        {notice && (
          <div className="mt-4 rounded-lg border border-[#1e2433] bg-[#09111c] px-4 py-2.5 text-xs text-zinc-300">
            {notice}
          </div>
        )}

        {/* Stat tiles */}
        <div className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { label: "Headlines screened", value: stats?.screened ?? 0, tone: "text-white" },
            { label: "Dismissed", value: stats?.rejected ?? 0, tone: "text-zinc-300" },
            { label: "Passed to verification", value: stats?.kept ?? 0, tone: "text-emerald-400" },
            {
              label: "Last scan",
              value: stats?.lastPollAt ? relative(stats.lastPollAt) : "Not yet run",
              tone: "text-zinc-300",
              small: true,
            },
          ].map((tile) => (
            <div
              key={tile.label}
              className="rounded-xl border border-[#1e2433] bg-[#09111c] p-4 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_10px_30px_rgba(0,0,0,0.04)]"
            >
              <div className="font-mono-code text-[10px] uppercase tracking-widest text-zinc-500">
                {tile.label}
              </div>
              <div
                className={`mt-2 font-mono-code tabular-nums font-bold ${tile.tone} ${
                  tile.small ? "text-lg" : "text-3xl"
                }`}
              >
                {tile.value}
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="mt-7 flex items-center justify-between gap-4 border-b border-[#1e2433] pb-3">
          <div className="flex items-center gap-1.5 rounded-lg border border-[#1e2433] bg-[#0e1117] p-1">
            {([
              ["all", "All"],
              ["kept", "Passed"],
              ["rejected", "Dismissed"],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`rounded-md px-3 py-1.5 font-mono-code text-[11px] font-semibold uppercase tracking-wider transition-colors ${
                  filter === key
                    ? "border border-cyan-500/30 bg-[#132030] text-cyan-300"
                    : "border border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <span className="font-mono-code text-[11px] text-zinc-500">
            {shown.length} shown
          </span>
        </div>

        {/* Feed */}
        <div className="mt-1 divide-y divide-[#151d29]">
          {!loaded && (
            <div className="py-16 text-center text-sm text-zinc-500">Loading intake.</div>
          )}

          {loaded && shown.length === 0 && (
            <div className="py-16 text-center">
              <div className="text-sm text-zinc-400">
                {stats?.screened
                  ? "No headlines match this filter."
                  : "No scan has run yet."}
              </div>
              <div className="mt-1.5 text-xs text-zinc-600">
                {stats?.screened
                  ? "Switch the filter to see the rest."
                  : "Enter the operator token and run a scan."}
              </div>
            </div>
          )}

          {shown.map((item) => {
            const open = expanded.has(item.id);
            return (
              <article
                key={item.id}
                className="group py-3.5 transition-colors hover:bg-white/[0.02]"
              >
                <div className="flex items-start gap-3.5">
                  <SourceMark source={item.source.name} />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        {/*
                          A promoted headline is the entry point to its own
                          record, so the headline itself is the link. It used to
                          be a small "Verification record" anchor hidden inside
                          the expanded detail, pointing at the raw JSON route —
                          written before /incident existed — so nothing on this
                          page led anywhere a reader would want to go.
                        */}
                        <h2 className="truncate text-[15px] font-semibold leading-snug text-zinc-100">
                          {item.jobId ? (
                            <Link
                              href={`/incident/${item.jobId}`}
                              className="transition-colors hover:text-cyan-300 hover:underline decoration-cyan-500/40 underline-offset-2"
                            >
                              {item.title}
                            </Link>
                          ) : (
                            item.title
                          )}
                        </h2>
                        <div className="mt-1 flex items-center gap-2 font-mono-code text-[11px] text-zinc-500">
                          <span>{item.source.name}</span>
                          <span className="text-zinc-700">/</span>
                          <span>{relative(item.publishedAt)}</span>
                          {item.asset && (
                            <>
                              <span className="text-zinc-700">/</span>
                              <span className="text-zinc-400">{item.asset}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 font-mono-code text-[10px] font-semibold uppercase tracking-wider ${
                          item.kept
                            ? "bg-emerald-500/10 text-emerald-300"
                            : "bg-zinc-500/10 text-zinc-400"
                        }`}
                      >
                        {item.kept ? "Verifying" : "Dismissed"}
                      </span>
                    </div>

                    <button
                      onClick={() => toggle(item.id)}
                      className="mt-1.5 text-left font-mono-code text-[11px] text-zinc-500 transition-colors hover:text-zinc-300"
                    >
                      {item.reason}
                    </button>

                    {open && (
                      <div className="mt-2.5 rounded-lg border border-[#1e2433] bg-[#0b131e] p-3.5">
                        {item.summary ? (
                          <p className="text-[13px] leading-relaxed text-zinc-400">
                            {item.summary}
                          </p>
                        ) : (
                          <p className="text-[13px] text-zinc-600">
                            The publisher supplied no summary.
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-4 font-mono-code text-[11px]">
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-400 transition-colors hover:text-cyan-300"
                            >
                              Read the original
                            </a>
                          )}
                          {item.jobId && (
                            <Link
                              href={`/incident/${item.jobId}`}
                              className="font-semibold text-cyan-400 transition-colors hover:text-cyan-300"
                            >
                              Open the full record →
                            </Link>
                          )}
                          <span className="text-zinc-600">
                            Seen {relative(item.ingestedAt)}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}

          {matching.length > shown.length && (
            <div className="flex flex-col items-center gap-2 pt-4">
              <button
                type="button"
                onClick={() => setVisible((v) => v + 40)}
                className="cursor-pointer rounded-xl border border-[#2d3748] px-6 py-2.5 font-mono-code text-xs font-bold text-zinc-300 transition-colors hover:border-cyan-500/50 hover:text-cyan-300"
              >
                Show 40 more
              </button>
              <span className="font-mono-code text-[10px] text-zinc-600">
                Showing {shown.length} of {matching.length} screened
              </span>
            </div>
          )}
          </div>
        </div>
      </div>
    </>
  );
}

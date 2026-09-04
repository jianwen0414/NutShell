"use client";

import { useEffect, useState } from "react";

/**
 * The footer that used to lie.
 *
 * It previously read "Base RPC Healthy (12ms) · Gonka AI Triad Connected ·
 * Thetanuts OptionBook Settled" as three hardcoded strings — green whatever
 * was actually happening, including with the RPC unreachable. /api/health does
 * every one of those checks for real, so it reports what that returns and goes
 * amber or red when it should.
 */

interface Health {
  status?: "ok" | "degraded" | "down";
  rpc?: { reachable: boolean; chainId: number | null; blockNumber: number | null };
  book?: { reachable: boolean; orderCount: number | null; vanillaPutCount: number | null };
  clock?: { withinLimit: boolean; localSkewSeconds: number | null };
  burner?: { address: string | null; canSign: boolean };
}

function Dot({ ok }: { ok: boolean | undefined }) {
  return (
    <span
      className={`h-1.5 w-1.5 rounded-full ${
        ok === undefined ? "bg-zinc-600" : ok ? "bg-emerald-400" : "bg-red-500"
      }`}
    />
  );
}

export function SystemStatusBar() {
  const [h, setH] = useState<Health | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/health")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!cancelled && d) setH(d);
        })
        .catch(() => {});
    };
    const first = setTimeout(load, 0);
    const repeat = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(repeat);
    };
  }, []);

  return (
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-zinc-800/50 pt-6 font-mono-code text-[11px] text-zinc-500">
      <div className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-1.5">
          <Dot ok={h?.rpc?.reachable} />
          Base RPC{" "}
          <strong className="text-zinc-400">
            {h?.rpc?.blockNumber ? `block ${h.rpc.blockNumber.toLocaleString()}` : "—"}
          </strong>
        </span>
        <span className="flex items-center gap-1.5">
          <Dot ok={h?.book?.reachable} />
          Thetanuts book{" "}
          <strong className="text-zinc-400">
            {h?.book?.vanillaPutCount ?? "—"} puts / {h?.book?.orderCount ?? "—"} orders
          </strong>
        </span>
        <span className="flex items-center gap-1.5">
          <Dot ok={h?.clock?.withinLimit} />
          Clock skew{" "}
          <strong className="text-zinc-400">
            {h?.clock?.localSkewSeconds === null || h?.clock?.localSkewSeconds === undefined
              ? "—"
              : `${h.clock.localSkewSeconds.toFixed(1)}s`}
          </strong>
        </span>
      </div>
      <div className={h?.status === "ok" ? "text-zinc-500" : "text-amber-400"}>
        {h?.status ? `System ${h.status}` : "Checking…"} · Base mainnet 8453
      </div>
    </footer>
  );
}

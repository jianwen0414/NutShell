"use client";

import { useEffect, useState } from "react";

/**
 * Four numbers, read live, directly under the hero.
 *
 * The job of this strip is to end the "is this a mockup?" question in the
 * first three seconds. So every figure is pulled from a running endpoint and
 * none is written into the markup: the book depth churns between polls because
 * a real market maker is quoting, and a visitor who reloads sees it move.
 *
 * If an endpoint is unreachable the tile shows a dash. A placeholder that
 * looks like data would defeat the entire purpose of the component.
 */

interface Health {
  status?: string;
  book?: { orderCount: number | null; vanillaPutCount: number | null };
  rpc?: { reachable: boolean; blockNumber: number | null };
}

interface IngestStats {
  screened: number;
  kept: number;
  rejected: number;
  polling: boolean;
  lastPollAt: string | null;
}

interface Position {
  status: string;
  expiry: string;
  premiumPaidUsdc: string;
  notionalProtectedUsdc: string;
  isExpired?: boolean;
}

/**
 * True only while the option can still pay out.
 *
 * The stored `status` is not enough: a record sits at OPEN long after its
 * expiry has passed, and two of the positions on the book right now are
 * exactly that. Counting them would put lapsed cover in the one strip whose
 * whole job is to be checkable — and being wrong in the reassuring direction
 * is the worst way to be wrong on a landing page about insurance. `/protection`
 * already reads expiry from the option; this did not.
 */
function isLive(p: Position): boolean {
  if (p.isExpired === true) return false;
  if (p.status !== "OPEN") return false;
  return Date.parse(p.expiry) > Date.now();
}

function Tile({
  value,
  label,
  hint,
  tone = "text-white",
}: {
  value: string;
  label: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="flex-1 border-l border-[#1e2433] px-4 py-3 first:border-l-0 sm:px-5">
      <div className={`font-mono-code text-xl font-black tabular-nums sm:text-2xl ${tone}`}>
        {value}
      </div>
      <div className="mt-0.5 font-mono-code text-[10px] font-bold uppercase tracking-wider text-zinc-400">
        {label}
      </div>
      <div className="mt-0.5 text-[10px] leading-snug text-zinc-600">{hint}</div>
    </div>
  );
}

export function ProofStrip() {
  const [health, setHealth] = useState<Health | null>(null);
  const [ingest, setIngest] = useState<IngestStats | null>(null);
  const [positions, setPositions] = useState<Position[] | null>(null);

  useEffect(() => {
    let live = true;

    const load = () => {
      fetch("/api/health")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => live && d && setHealth(d))
        .catch(() => {});
      fetch("/api/ingest")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => live && d && setIngest(d))
        .catch(() => {});
      fetch("/api/positions")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => live && Array.isArray(d) && setPositions(d))
        .catch(() => {});
    };

    load();
    // The book churns; refreshing keeps the strip visibly alive without
    // hammering an endpoint that reads mainnet.
    const t = setInterval(load, 30_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);

  const open = (positions ?? []).filter(isLive);
  const cover = open.reduce((a, p) => a + Number(p.notionalProtectedUsdc || 0), 0);
  const puts = health?.book?.vanillaPutCount;
  const screened = ingest?.screened;
  const rejected = ingest?.rejected;

  return (
    <div className="w-full overflow-hidden rounded-2xl border border-[#1e2433] bg-[#080c14]/80 backdrop-blur-xl">
      <div className="flex flex-wrap divide-[#1e2433] sm:flex-nowrap">
        <Tile
          value={screened === undefined ? "—" : screened.toLocaleString()}
          label="Headlines read"
          hint={
            rejected === undefined
              ? "across eight public newswires"
              : `${rejected.toLocaleString()} screened out before any model ran`
          }
          tone="text-white"
        />
        <Tile
          value={puts === null || puts === undefined ? "—" : String(puts)}
          label="Live put quotes"
          hint="on the Thetanuts book right now"
          tone="text-cyan-300"
        />
        <Tile
          value={positions === null ? "—" : String(open.length)}
          label="Positions held"
          hint={
            open.length > 0
              ? `$${cover.toLocaleString(undefined, { maximumFractionDigits: 0 })} of cover on Base`
              : "no premium being paid right now"
          }
          tone="text-emerald-300"
        />
        <Tile
          value={health?.rpc?.blockNumber ? `#${health.rpc.blockNumber.toLocaleString()}` : "—"}
          label="Base block"
          hint={health?.status === "ok" ? "all systems reachable" : "reading mainnet"}
          tone="text-zinc-300"
        />
      </div>
    </div>
  );
}

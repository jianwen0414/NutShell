"use client";

import { useEffect, useState } from "react";

/**
 * The anchoring number in the hero: premium paid against downside covered.
 *
 * It used to be two literals in the markup — `$2.15` and `$2,443` — written
 * when they were true and left behind by every fill since. By the time anyone
 * checked, `/protection` was computing $2.50 against $2,488.24 from the same
 * position store, so the first number a visitor read and the number on the
 * page it links to disagreed. On a page whose entire argument is "these
 * figures are live, reload and they move", a stale literal is the one thing
 * that cannot be there.
 *
 * So it is read from `/api/positions`, the same source `/protection` uses,
 * with the same arithmetic. Until it lands the tiles show a dash: a
 * placeholder shaped like data would defeat the point.
 */

interface Position {
  premiumPaidUsdc: string;
  notionalProtectedUsdc: string;
}

const money = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export function CoverAnchor() {
  const [positions, setPositions] = useState<Position[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/positions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && Array.isArray(d) && setPositions(d))
      .catch(() => {
        /* the tiles stay dashed rather than inventing a figure */
      });
    return () => {
      live = false;
    };
  }, []);

  // Every position ever opened, not only the live ones. The claim being made
  // is about the price of protection, and a lapsed put cost exactly what it
  // cost and covered exactly what it covered.
  const premium = (positions ?? []).reduce((a, p) => a + Number(p.premiumPaidUsdc || 0), 0);
  const cover = (positions ?? []).reduce((a, p) => a + Number(p.notionalProtectedUsdc || 0), 0);
  const ready = positions !== null && premium > 0 && cover > 0;
  const pctOfNotional = ready ? (premium / cover) * 100 : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-[#1e2433] bg-[#080c14]/70 px-5 py-4 backdrop-blur-xl">
      <div>
        <div className="font-mono-code text-3xl font-black tabular-nums text-white">
          {ready ? `$${money(premium)}` : "—"}
        </div>
        <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
          premium paid
        </div>
      </div>
      <div className="text-2xl text-zinc-700">→</div>
      <div>
        <div className="font-mono-code text-3xl font-black tabular-nums text-emerald-400">
          {ready ? `$${money(cover, 0)}` : "—"}
        </div>
        <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
          downside covered
        </div>
      </div>
      <div className="hidden h-10 w-px bg-[#1e2433] sm:block" />
      <p className="max-w-[15rem] text-[11px] leading-relaxed text-zinc-400">
        {ready ? `${pctOfNotional.toFixed(2)}%` : "A fraction"} of notional for real
        protection, paid on Base mainnet. The reason nobody hedges this way is that you
        cannot afford to hold it always. A trustworthy trigger changes the arithmetic.
      </p>
    </div>
  );
}

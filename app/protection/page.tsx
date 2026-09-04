"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Navigation } from "@/components/navigation";

/**
 * What the agent is protecting, what it cost, and where the money came from.
 *
 * The economics are the product argument and they were being fetched and
 * dropped: accrued yield, the premium reserve and the APY all arrived in the
 * payload and none of them reached the screen, so the one line that makes
 * event-driven hedging viable — the yield pays for it, the principal never
 * moves — appeared nowhere in the product.
 *
 * Expiry is read from the option, not from the stored status. A record can sit
 * at OPEN long after its expiry passed, and a card headed "protection active"
 * over a position that lapsed two days ago is the worst kind of wrong: it
 * reassures.
 */

interface Position {
  correlationId: string;
  status: string;
  asset: string;
  strike: string;
  expiry: string;
  contracts: string;
  premiumPaidUsdc: string;
  notionalProtectedUsdc: string;
  entryTxHash: string;
  baseScanUrl: string;
  spotAtEntry: string;
  openedAt: string;
  realisedPnlUsdc?: string;
  wasDryRun: boolean;
  isExpired?: boolean;
  hoursToExpiry?: number;
  execution?: {
    settlement?: { settlementPrice: string; inTheMoney: boolean; recovered: string };
  };
}

interface Vault {
  driver: string;
  isSimulated: boolean;
  principalUsdc: string;
  accruedYieldUsdc: string;
  premiumReserveUsdc: string;
  dailySpentUsdc: string;
  dailyCapUsdc: string;
  apyBps: number;
}

interface Health {
  burner: { address: string | null; ethWei: string | null; usdcRaw: string | null };
  book: { orderCount: number | null; vanillaPutCount: number | null };
}

const money = (n: string | number, dp = 2) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** True only while the option can still pay out. */
function isLive(p: Position): boolean {
  if (p.isExpired === true) return false;
  if (p.status !== "OPEN") return false;
  return Date.parse(p.expiry) > Date.now();
}

function expiryLabel(p: Position): string {
  const hours = (Date.parse(p.expiry) - Date.now()) / 3_600_000;
  if (hours <= 0) {
    const ago = Math.abs(hours);
    return ago < 48 ? `Lapsed ${ago.toFixed(0)}h ago` : `Lapsed ${(ago / 24).toFixed(0)}d ago`;
  }
  return hours < 48 ? `${hours.toFixed(1)}h left` : `${(hours / 24).toFixed(1)}d left`;
}

export default function ProtectionPage() {
  const [showTechnical, setShowTechnical] = useState(false);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      fetch("/api/positions")
        .then((r) => r.json())
        .then(setPositions)
        .catch(() => setPositions([]));
      fetch("/api/vault").then((r) => r.json()).then(setVault).catch(() => {});
      fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const all = positions ?? [];
  const live = all.filter(isLive);
  const past = all.filter((p) => !isLive(p));
  const totalPremium = all.reduce((a, p) => a + Number(p.premiumPaidUsdc), 0);
  const liveCover = live.reduce((a, p) => a + Number(p.notionalProtectedUsdc), 0);
  const everCover = all.reduce((a, p) => a + Number(p.notionalProtectedUsdc), 0);

  const usdc = health?.burner?.usdcRaw ? Number(health.burner.usdcRaw) / 1e6 : null;
  const eth = health?.burner?.ethWei ? Number(health.burner.ethWei) / 1e18 : null;

  const yieldEarned = vault ? Number(vault.accruedYieldUsdc) : 0;
  const reserve = vault ? Number(vault.premiumReserveUsdc) : 0;
  const principal = vault ? Number(vault.principalUsdc) : 0;
  const apyPct = vault ? vault.apyBps / 100 : 0;
  const coverRatio = totalPremium > 0 ? everCover / totalPremium : 0;

  return (
    <>
      <Navigation />
      <main className="mx-auto w-full max-w-[1400px] space-y-8 px-4 py-8 font-sans sm:px-6 lg:px-8">
        <div className="space-y-1 border-b border-zinc-800/80 pb-5">
          <div className="flex items-center gap-2 font-mono-code text-xs font-bold uppercase tracking-wider text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span>Protection status</span>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Your Protected Portfolio
          </h1>
          <p className="text-xs text-zinc-400 sm:text-sm">
            What the agent holds on Base mainnet, what it cost, and where the money came from.
          </p>
        </div>

        {/* ── The economics ─────────────────────────────────────────────── */}
        <section className="rounded-3xl border border-[#1e2433] bg-[#09111c] p-6 sm:p-7">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-mono-code text-sm font-bold uppercase tracking-wider text-white">
                Where the premiums come from
              </h2>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-400">
                Protection is paid for out of what the deposit earns, never out of the deposit.
                That is the whole reason event-driven hedging works at all — holding puts
                continuously costs more than the position yields, so the trigger has to be
                good enough to buy them only when it matters.
              </p>
            </div>
            <span className="rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-3 py-1 font-mono-code text-[10px] font-bold text-emerald-300">
              {apyPct.toFixed(1)}% APY
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-4">
            {[
              {
                label: "Principal",
                value: `$${money(principal)}`,
                foot: "Never debited by any code path",
                tone: "text-white",
                ring: "border-[#1e2433]",
              },
              {
                label: "Yield earned",
                value: `+$${money(yieldEarned)}`,
                foot: `Accrued at ${apyPct.toFixed(1)}% — this is the budget`,
                tone: "text-emerald-400",
                ring: "border-emerald-900/50",
              },
              {
                label: "Premium reserve",
                value: `$${money(reserve)}`,
                foot: `Spendable now · $${money(vault?.dailySpentUsdc ?? 0)} of $${money(vault?.dailyCapUsdc ?? 0)} used today`,
                tone: "text-cyan-300",
                ring: "border-cyan-900/50",
              },
              {
                label: "Spent on protection",
                value: `$${money(totalPremium)}`,
                foot: `Across ${all.length} position${all.length === 1 ? "" : "s"}`,
                tone: "text-amber-300",
                ring: "border-amber-900/40",
              },
            ].map((c, i) => (
              <div key={c.label} className="relative">
                <div className={`h-full rounded-2xl border bg-[#050b12] p-5 ${c.ring}`}>
                  <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-500">
                    {c.label}
                  </div>
                  <div className={`mt-1 font-mono-code text-2xl font-black ${c.tone}`}>
                    {vault ? c.value : "—"}
                  </div>
                  <div className="mt-1 text-[10px] leading-snug text-zinc-500">{c.foot}</div>
                </div>
                {i < 3 && (
                  <span className="pointer-events-none absolute -right-2 top-1/2 z-10 hidden -translate-y-1/2 font-mono-code text-lg text-zinc-700 lg:block">
                    →
                  </span>
                )}
              </div>
            ))}
          </div>

          {totalPremium > 0 && (
            <p className="mt-4 rounded-xl border border-[#1e2433] bg-[#050b12] px-4 py-3 text-[11px] leading-relaxed text-zinc-300">
              <span className="font-bold text-white">The trade so far.</span> $
              {money(totalPremium)} of premium bought ${money(everCover)} of downside cover —{" "}
              <span className="font-bold text-emerald-400">
                {coverRatio.toFixed(0)}× the outlay
              </span>
              , at {((totalPremium / everCover) * 100).toFixed(3)}% of notional. Paid from $
              {money(yieldEarned)} of yield, so the principal has not moved.
            </p>
          )}
        </section>

        {/* ── Active cover ──────────────────────────────────────────────── */}
        {live.length > 0 ? (
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400" />
              <h2 className="font-mono-code text-sm font-bold uppercase tracking-wider text-emerald-400">
                Protection active · {live.length} position{live.length === 1 ? "" : "s"}
              </h2>
              <span className="font-mono-code text-xs text-zinc-500">
                ${money(liveCover)} of cover
              </span>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {live.map((p) => (
                <div
                  key={p.correlationId}
                  className="space-y-5 rounded-3xl border-2 border-emerald-500/60 bg-gradient-to-b from-[#06150f] via-[#040e0a] to-[#020705] p-6"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b border-emerald-950/80 pb-4">
                    <h3 className="text-xl font-extrabold text-white">
                      {p.asset} downside protection
                    </h3>
                    <Link
                      href={`/incident/${p.correlationId}`}
                      className="rounded-xl bg-emerald-500 px-4 py-2 text-center font-mono-code text-xs font-bold text-zinc-950 transition-all hover:bg-emerald-400"
                    >
                      Full record →
                    </Link>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {[
                      ["Protection starts below", `$${money(p.strike)}`, `Spot at entry $${money(p.spotAtEntry)}`],
                      ["Expiry", expiryLabel(p), new Date(p.expiry).toUTCString().replace("GMT", "UTC")],
                      ["Premium paid", `$${money(p.premiumPaidUsdc)}`, "Real USDC on Base mainnet"],
                      [
                        "Maximum cover",
                        `$${money(p.notionalProtectedUsdc)}`,
                        `${((Number(p.premiumPaidUsdc) / Number(p.notionalProtectedUsdc)) * 100).toFixed(3)}% of notional`,
                      ],
                    ].map(([label, value, foot]) => (
                      <div
                        key={label}
                        className="space-y-0.5 rounded-xl border border-emerald-900/40 bg-[#030a07] p-4"
                      >
                        <div className="font-mono-code text-[10px] uppercase tracking-wider text-zinc-400">
                          {label}
                        </div>
                        <div className="font-mono-code text-lg font-bold text-white">{value}</div>
                        <div className="text-[10px] text-zinc-500">{foot}</div>
                      </div>
                    ))}
                  </div>

                  <p className="rounded-2xl border border-emerald-900/40 bg-[#030a07] p-4 text-[11px] leading-relaxed text-zinc-300">
                    <span className="font-bold text-zinc-100">What this pays.</span> If {p.asset}{" "}
                    settles below ${money(p.strike)}, the option pays{" "}
                    <code className="font-mono-code text-emerald-300">
                      (strike − settlement) × {p.contracts}
                    </code>
                    , up to ${money(p.notionalProtectedUsdc)}. If it settles above, the option
                    expires worth nothing and the ${money(p.premiumPaidUsdc)} premium was the whole
                    cost — insurance that was not needed. Settlement is automatic.
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : (
          <section className="space-y-3 rounded-3xl border-2 border-zinc-800 bg-[#070c14] p-8 text-center">
            <div className="font-mono-code text-sm font-bold uppercase tracking-wider text-zinc-400">
              No protection currently active
            </div>
            <p className="mx-auto max-w-lg text-xs leading-relaxed text-zinc-500">
              {positions === null
                ? "Loading positions…"
                : all.length === 0
                  ? "The agent has never opened a hedge. Nothing is being paid for."
                  : `Every hedge the agent has bought has now expired. Nothing is being paid for, and nothing is covered — the agent buys protection when a verified crisis clears policy, not continuously.`}
            </p>
          </section>
        )}

        {/* ── History ───────────────────────────────────────────────────── */}
        <section className="space-y-4 rounded-2xl border border-[#1e2433] bg-[#09111c] p-6">
          <div className="flex items-center justify-between border-b border-[#1e2433] pb-3">
            <div className="space-y-0.5">
              <h2 className="font-mono-code text-xs font-bold uppercase tracking-wider text-white">
                Protection history
              </h2>
              <p className="text-xs text-zinc-400">
                Every hedge the agent has recorded. Transaction links resolve on BaseScan.
              </p>
            </div>
            <span className="font-mono-code text-xs text-zinc-500">{all.length} recorded</span>
          </div>

          {positions && all.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">No positions recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono-code text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 uppercase text-zinc-400">
                    <th className="px-4 py-3">Protection</th>
                    <th className="px-4 py-3">State</th>
                    <th className="px-4 py-3">Premium</th>
                    <th className="px-4 py-3">Cover</th>
                    <th className="px-4 py-3">Outcome</th>
                    <th className="px-4 py-3 text-right">Links</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40 text-zinc-300">
                  {[...live, ...past].map((p) => {
                    const active = isLive(p);
                    return (
                      <tr key={p.correlationId} className="transition-colors hover:bg-zinc-900/40">
                        <td className="px-4 py-3.5 font-bold text-white">
                          {p.asset} ${money(p.strike)} put
                          <div className="text-[10px] font-normal text-zinc-500">
                            {p.correlationId}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`rounded px-2.5 py-0.5 text-[10px] font-bold ${
                              active
                                ? "border border-emerald-500/40 bg-emerald-950 text-emerald-300"
                                : p.status === "UNWOUND"
                                  ? "border border-amber-500/40 bg-amber-950 text-amber-300"
                                  : "bg-zinc-800 text-zinc-400"
                            }`}
                          >
                            {active ? "ACTIVE" : p.status === "UNWOUND" ? "ABANDONED" : "LAPSED"}
                          </span>
                          <div className="mt-0.5 text-[10px] text-zinc-600">{expiryLabel(p)}</div>
                        </td>
                        <td className="px-4 py-3.5 font-bold text-amber-300">
                          ${money(p.premiumPaidUsdc)}
                        </td>
                        <td className="px-4 py-3.5">${money(p.notionalProtectedUsdc)}</td>
                        <td className="max-w-xs px-4 py-3.5 font-sans text-zinc-400">
                          {p.execution?.settlement
                            ? `Settled ${p.execution.settlement.inTheMoney ? "in" : "out of"} the money at $${money(p.execution.settlement.settlementPrice)} — recovered $${p.execution.settlement.recovered}`
                            : active
                              ? "Covering"
                              : p.realisedPnlUsdc
                                ? `Realised ${p.realisedPnlUsdc} USDC`
                                : "Expired worthless — the crash did not come"}
                        </td>
                        <td className="space-x-3 px-4 py-3.5 text-right">
                          <Link
                            href={`/incident/${p.correlationId}`}
                            className="text-cyan-400 hover:underline"
                          >
                            Record
                          </Link>
                          {p.baseScanUrl && (
                            <a
                              href={p.baseScanUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-400 hover:underline"
                            >
                              Tx ↗
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Technical ─────────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-2xl border border-[#1e2433] bg-[#09111c] font-mono-code">
          <button
            type="button"
            onClick={() => setShowTechnical(!showTechnical)}
            className="flex w-full cursor-pointer select-none items-center justify-between p-5 text-left transition-colors hover:bg-white/[0.02]"
          >
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                Technical details
              </span>
              <span className="font-sans text-xs text-zinc-500">
                Contract addresses, execution wallet, live book depth
              </span>
            </span>
            <span className="text-xs font-bold text-cyan-400">
              {showTechnical ? "Hide ▲" : "Show ▼"}
            </span>
          </button>

          {showTechnical && (
            <div className="animate-fadeIn space-y-4 border-t border-[#1e2433] p-6 pt-4 text-xs">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1 rounded-xl border border-zinc-800 bg-[#050b12] p-4">
                  <div className="text-[10px] uppercase text-zinc-500">Execution router</div>
                  <div className="text-sm font-bold text-cyan-300">Thetanuts OptionBook</div>
                  <a
                    href="https://basescan.org/address/0x1bDff855d6811728acaDC00989e79143a2bdfDed"
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-[11px] text-zinc-400 hover:text-cyan-300"
                  >
                    0x1bDff855…dfDed
                  </a>
                </div>

                <div className="space-y-1 rounded-xl border border-zinc-800 bg-[#050b12] p-4">
                  <div className="text-[10px] uppercase text-zinc-500">Agent wallet</div>
                  <div className="text-sm font-bold text-emerald-400">
                    {usdc === null ? "—" : `$${money(usdc)} USDC`}
                  </div>
                  <a
                    href={
                      health?.burner?.address
                        ? `https://basescan.org/address/${health.burner.address}`
                        : "#"
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="block truncate text-[11px] text-zinc-400 hover:text-cyan-300"
                  >
                    {health?.burner?.address ?? "—"}
                  </a>
                  <div className="text-[10px] text-zinc-600">
                    {eth === null ? "—" : `${eth.toFixed(6)} ETH for gas`} · burner only
                  </div>
                </div>

                <div className="space-y-1 rounded-xl border border-zinc-800 bg-[#050b12] p-4">
                  <div className="text-[10px] uppercase text-zinc-500">Live book depth</div>
                  <div className="text-sm font-bold text-white">
                    {health?.book?.vanillaPutCount ?? "—"} vanilla puts
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    of {health?.book?.orderCount ?? "—"} orders quoting now
                  </div>
                </div>

                <div className="space-y-1 rounded-xl border border-zinc-800 bg-[#050b12] p-4">
                  <div className="text-[10px] uppercase text-zinc-500">Vault driver</div>
                  <div className="text-sm font-bold text-zinc-200">
                    {vault?.driver ?? "—"}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Yield modelled at {apyPct.toFixed(1)}%; the driver interface takes a real
                    lending market unchanged.
                  </div>
                </div>
              </div>

              {/*
                Measured on the first fill, and absent from the PRD entirely:
                OrderFilled reported feeCollected 0.062499 on a premium of
                0.499999. It sits inside the quoted price rather than on top of
                it, so the premium shown is what was paid — but a reader
                comparing our cost of cover against a raw quote elsewhere should
                know where the difference goes.
              */}
              <p className="rounded-xl border border-zinc-800 bg-[#03070c] p-4 font-sans text-[11px] leading-relaxed text-zinc-400">
                <span className="font-bold text-zinc-300">On the fee.</span> The protocol
                takes <strong className="text-zinc-300">12.5% of each premium</strong>, inside
                the quoted price rather than added to it — measured on our first fill, where
                a $0.499999 premium carried $0.062499 of fee. The maker nets the other
                87.5%. Every figure on this page is the price actually paid, fee included.
              </p>

              <p className="rounded-xl border border-zinc-800 bg-[#03070c] p-4 font-sans text-[11px] leading-relaxed text-zinc-400">
                <span className="font-bold text-zinc-300">On early exit.</span> A long put has no
                way out on this venue before expiry. Measured against a real open position:{" "}
                <code className="text-zinc-300">close()</code> reverts unless one address holds
                both sides, <code className="text-zinc-300">reclaimCollateral()</code> is
                seller-only, and no live vanilla put quote bids for puts — so there is nobody to
                sell to. Measured premium recovery on an early exit is 0%. The agent&rsquo;s real
                protection against a false alarm is the gate that runs before the money moves,
                not an exit after it.
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

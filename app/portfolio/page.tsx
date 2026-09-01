"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Navigation } from "@/components/navigation";

/**
 * Real positions from the agent's position store, plus the real burner
 * balances. Nothing on this page is invented.
 *
 * 🔒 PRD §13.2. The vault's yield accounting is MODELLED; the premiums are
 * paid with real USDC on Base mainnet. Both facts are stated, side by side,
 * because presenting modelled yield as real would be the overclaim that costs
 * more credibility than the feature gains.
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
  deltaAtEntry: number;
  openedAt: string;
  realisedPnlUsdc?: string;
  wasDryRun: boolean;
  optionAddress?: string;
  isExpired?: boolean;
  hoursToExpiry?: number;
  execution?: { settlement?: { settlementPrice: string; inTheMoney: boolean; recovered: string } };
}

interface Vault {
  isSimulated: boolean;
  principalUsdc: string;
  accruedYieldUsdc: string;
  premiumReserveUsdc: string;
  dailySpentUsdc: string;
  dailyCapUsdc: string;
  apyBps: number;
}

interface Health {
  burner: { address: string | null; ethWei: string | null; usdcRaw: string | null; canSign: boolean };
  book: { orderCount: number | null; vanillaPutCount: number | null };
}

const fmt = (n: string | number, dp = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export default function PortfolioPage() {
  const [showTechnical, setShowTechnical] = useState(false);
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [vault, setVault] = useState<Vault | null>(null);
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    fetch("/api/positions").then((r) => r.json()).then(setPositions).catch(() => setPositions([]));
    fetch("/api/vault").then((r) => r.json()).then(setVault).catch(() => {});
    fetch("/api/health").then((r) => r.json()).then(setHealth).catch(() => {});
  }, []);

  const open = (positions ?? []).filter((p) => p.status === "OPEN");
  const closed = (positions ?? []).filter((p) => p.status !== "OPEN");
  const active = open[0];
  const totalPremium = (positions ?? []).reduce((a, p) => a + Number(p.premiumPaidUsdc), 0);
  const totalCover = open.reduce((a, p) => a + Number(p.notionalProtectedUsdc), 0);

  const usdc = health?.burner?.usdcRaw ? Number(health.burner.usdcRaw) / 1e6 : null;
  const eth = health?.burner?.ethWei ? Number(health.burner.ethWei) / 1e18 : null;

  return (
    <>
      <Navigation />
      <main className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 space-y-8 font-sans">
        {/* Page Header */}
        <div className="border-b border-zinc-800/80 pb-5 space-y-1">
          <div className="flex items-center gap-2 text-xs font-mono-code text-emerald-400 font-bold uppercase tracking-wider">
            <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
            <span>PORTFOLIO PROTECTION STATUS</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Your Protected Portfolio
          </h1>
          <p className="text-xs sm:text-sm text-zinc-400">
            Live positions the agent actually holds on Base mainnet, and the wallet it trades from.
          </p>
        </div>

        {/* 🔒 PRD §13.2 honesty banner */}
        <div className="rounded-xl border border-amber-700/50 bg-amber-950/20 p-4 text-xs leading-relaxed text-amber-200/90">
          <span className="font-bold text-amber-300">Simulated vault, real trades.</span> The vault
          principal and yield below are <strong>modelled</strong> — no lending market is connected
          yet. Everything under &ldquo;Positions&rdquo; is real: premiums were paid with real USDC on
          Base mainnet, and every transaction link resolves on BaseScan.
        </div>

        {/* 1. The numbers */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-1">
            <div className="text-xs text-zinc-400 font-mono-code uppercase tracking-wider">
              Modelled Vault Principal
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-white font-mono-code pt-1">
              ${vault ? fmt(vault.principalUsdc) : "—"}{" "}
              <span className="text-xs text-zinc-500 font-normal">USDC</span>
            </div>
            <div className="text-xs text-amber-400/80 font-medium pt-1">
              Modelled — never debited by any code path
            </div>
          </div>

          <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-1">
            <div className="text-xs text-zinc-400 font-mono-code uppercase tracking-wider">
              Agent Wallet (real)
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-cyan-300 font-mono-code pt-1">
              ${usdc === null ? "—" : fmt(usdc)}{" "}
              <span className="text-xs text-zinc-500 font-normal">USDC</span>
            </div>
            <div className="text-xs text-zinc-400 pt-1">
              {eth === null ? "—" : `${eth.toFixed(6)} ETH for gas`} · burner only
            </div>
          </div>

          <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-1">
            <div className="text-xs text-zinc-400 font-mono-code uppercase tracking-wider">
              Premium Spent (real)
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-amber-400 font-mono-code pt-1">
              ${fmt(totalPremium, 6)}{" "}
              <span className="text-xs text-zinc-500 font-normal">
                / ${vault ? fmt(vault.dailyCapUsdc) : "—"} daily cap
              </span>
            </div>
            <div className="text-xs text-zinc-400 pt-1">
              Across {positions?.length ?? 0} recorded position{positions?.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>

        {/* 2. Active protection */}
        {active ? (
          <div className="rounded-3xl bg-gradient-to-b from-[#06150f] via-[#040e0a] to-[#020705] p-7 sm:p-8 border-2 border-emerald-500/60 shadow-2xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-emerald-950/80 pb-5">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-full bg-emerald-400 animate-ping"></span>
                  <span className="text-xs font-mono-code font-bold text-emerald-400 uppercase tracking-wider">
                    🛡️ PROTECTION STATUS: ACTIVE
                  </span>
                  <span className="bg-emerald-950 text-emerald-300 text-xs px-2.5 py-0.5 rounded font-bold border border-emerald-500/30 font-mono-code">
                    {open.length} POSITION{open.length === 1 ? "" : "S"} ACTIVE
                  </span>
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
                  {active.asset} Downside Protection Active
                </h2>
              </div>

              {/*
                No unwind button. Measured on mainnet: a long put has no early
                exit here — close() reverts unless one address holds both
                sides, and no live quote bids for puts — so premium recovery is
                0%. Abandoning a hedge is an operator action on the Control
                page, and it sends no transaction because none is possible.
              */}
              <Link
                href={`/position/${active.correlationId}`}
                className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-4 py-2 text-xs font-mono-code font-bold transition-all self-start sm:self-auto text-center"
              >
                View Full Lifecycle →
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#030a07] p-4 rounded-xl border border-emerald-900/40 space-y-1">
                <div className="text-zinc-400 text-xs uppercase font-mono-code">Protection Starts Below</div>
                <div className="text-xl font-bold text-white font-mono-code">
                  ${fmt(active.strike)} {active.asset}
                </div>
                <div className="text-xs text-emerald-400">
                  Spot at entry ${fmt(active.spotAtEntry)}
                </div>
              </div>

              <div className="bg-[#030a07] p-4 rounded-xl border border-emerald-900/40 space-y-1">
                <div className="text-zinc-400 text-xs uppercase font-mono-code">Expiry</div>
                <div className="text-xl font-bold text-white font-mono-code">
                  {active.hoursToExpiry !== undefined && active.hoursToExpiry > 0
                    ? `${active.hoursToExpiry.toFixed(1)}h left`
                    : "Expired"}
                </div>
                <div className="text-xs text-zinc-400">
                  {new Date(active.expiry).toUTCString().replace("GMT", "UTC")}
                </div>
              </div>

              <div className="bg-[#030a07] p-4 rounded-xl border border-emerald-900/40 space-y-1">
                <div className="text-zinc-400 text-xs uppercase font-mono-code">Premium Paid</div>
                <div className="text-xl font-bold text-amber-300 font-mono-code">
                  ${active.premiumPaidUsdc}
                </div>
                <div className="text-xs text-zinc-400">Real USDC, Base mainnet</div>
              </div>

              <div className="bg-[#030a07] p-4 rounded-xl border border-emerald-900/40 space-y-1">
                <div className="text-zinc-400 text-xs uppercase font-mono-code">Maximum Cover</div>
                <div className="text-xl font-bold text-white font-mono-code">
                  ${fmt(active.notionalProtectedUsdc)}
                </div>
                <div className="text-xs text-emerald-400">
                  {((Number(active.premiumPaidUsdc) / Number(active.notionalProtectedUsdc)) * 100).toFixed(3)}% of
                  notional
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-[#030a07] p-5 border border-emerald-900/40 text-xs text-zinc-300 leading-relaxed">
              <span className="font-bold text-zinc-100">What this pays.</span> If {active.asset}{" "}
              settles below ${fmt(active.strike)} at expiry, the option pays{" "}
              <code className="text-emerald-300">(strike − settlement) × {active.contracts}</code>{" "}
              contracts, up to ${fmt(active.notionalProtectedUsdc)}. If it settles above, the option
              expires worth nothing and the ${active.premiumPaidUsdc} premium is the whole cost —
              insurance that was not needed. Settlement is automatic; the buyer sends nothing.
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border-2 border-zinc-800 bg-[#070c14] p-8 text-center space-y-2">
            <div className="text-sm font-mono-code font-bold text-zinc-400 uppercase tracking-wider">
              No open protection
            </div>
            <p className="text-xs text-zinc-500">
              {positions === null
                ? "Loading positions…"
                : "The agent holds no open hedge right now. Nothing is being paid for."}
            </p>
          </div>
        )}

        {/* 3. History — real, from the store */}
        <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-cyan-950 pb-3 font-mono-code">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                📜 PROTECTION HISTORY
              </span>
              <p className="text-xs text-zinc-400 font-sans">
                Every hedge the agent has recorded. Transaction links resolve on BaseScan.
              </p>
            </div>
            <span className="text-xs text-zinc-500">
              {positions?.length ?? 0} recorded
            </span>
          </div>

          {positions && positions.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">No positions recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono-code text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400 uppercase">
                    <th className="px-4 py-3">Protection</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Premium</th>
                    <th className="px-4 py-3">Cover</th>
                    <th className="px-4 py-3">Outcome</th>
                    <th className="px-4 py-3 text-right">Links</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40 text-zinc-300">
                  {[...open, ...closed].map((p) => (
                    <tr key={p.correlationId} className="hover:bg-zinc-900/40 transition-colors">
                      <td className="px-4 py-3.5 font-bold text-white">
                        {p.asset} ${fmt(p.strike)} put
                        <div className="text-[10px] font-normal text-zinc-500">{p.correlationId}</div>
                      </td>
                      <td className="px-4 py-3.5">
                        <span
                          className={`px-2.5 py-0.5 rounded font-bold text-[10px] ${
                            p.status === "OPEN"
                              ? "bg-emerald-950 text-emerald-300 border border-emerald-500/40"
                              : p.status === "EXPIRED"
                                ? "bg-zinc-800 text-zinc-400"
                                : "bg-amber-950 text-amber-300 border border-amber-500/40"
                          }`}
                        >
                          {p.status === "OPEN" ? "🟢 OPEN" : p.status === "EXPIRED" ? "⚪ EXPIRED" : `⚑ ${p.status}`}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 font-bold text-amber-300">${p.premiumPaidUsdc}</td>
                      <td className="px-4 py-3.5 text-zinc-300">${fmt(p.notionalProtectedUsdc)}</td>
                      <td className="px-4 py-3.5 font-sans text-zinc-400">
                        {p.execution?.settlement
                          ? `Settled ${p.execution.settlement.inTheMoney ? "in" : "out of"} the money at $${fmt(p.execution.settlement.settlementPrice)} — recovered $${p.execution.settlement.recovered}`
                          : p.status === "OPEN"
                            ? "Active"
                            : p.realisedPnlUsdc
                              ? `Realised ${p.realisedPnlUsdc} USDC`
                              : "—"}
                      </td>
                      <td className="px-4 py-3.5 text-right space-x-3">
                        <Link href={`/position/${p.correlationId}`} className="text-cyan-400 hover:underline">
                          Detail
                        </Link>
                        {p.baseScanUrl && (
                          <a href={p.baseScanUrl} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">
                            Tx ↗
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 4. Technical details */}
        <div className="rounded-2xl bg-[#09111c] border border-cyan-950 shadow-xl overflow-hidden font-mono-code">
          <div
            onClick={() => setShowTechnical(!showTechnical)}
            className="p-5 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors select-none"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                🔧 VIEW TECHNICAL DETAILS
              </span>
              <span className="text-xs text-zinc-500 font-sans">
                (Contract addresses, execution wallet, live book depth)
              </span>
            </div>
            <span className="text-xs text-cyan-400 font-bold">
              {showTechnical ? "Hide ▲" : "Show ▼"}
            </span>
          </div>

          {showTechnical && (
            <div className="p-6 pt-0 border-t border-cyan-950 space-y-4 text-xs animate-fadeIn">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1">
                  <div className="text-zinc-500 text-[10px] uppercase">Instrument</div>
                  <div className="text-white font-bold text-sm">
                    {active ? `${active.asset} $${fmt(active.strike)} cash-settled put` : "None open"}
                  </div>
                  <div className="text-zinc-400 text-[11px]">
                    {active ? `${active.contracts} contracts` : "—"}
                  </div>
                </div>

                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1">
                  <div className="text-zinc-500 text-[10px] uppercase">Execution Router</div>
                  <div className="text-cyan-300 font-bold text-sm">Thetanuts OptionBook</div>
                  <div className="text-zinc-400 text-[11px] truncate">0x1bDff855…dfDed (Base 8453)</div>
                </div>

                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1">
                  <div className="text-zinc-500 text-[10px] uppercase">Agent Wallet</div>
                  <div className="text-emerald-400 font-bold text-sm">
                    {usdc === null ? "—" : `$${fmt(usdc)} USDC`} · {eth === null ? "—" : `${eth.toFixed(4)} ETH`}
                  </div>
                  <a
                    href={health?.burner?.address ? `https://basescan.org/address/${health.burner.address}` : "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="text-zinc-400 text-[11px] truncate block hover:text-cyan-300"
                  >
                    {health?.burner?.address ?? "—"}
                  </a>
                </div>

                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1">
                  <div className="text-zinc-500 text-[10px] uppercase">Live Book Depth</div>
                  <div className="text-white font-bold text-sm">
                    {health?.book?.vanillaPutCount ?? "—"} vanilla puts
                  </div>
                  <div className="text-zinc-400 text-[11px]">
                    of {health?.book?.orderCount ?? "—"} orders on the book
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-zinc-800 bg-[#03070c] p-4 text-[11px] leading-relaxed text-zinc-400 font-sans">
                <span className="font-bold text-zinc-300">Total cover currently held:</span> $
                {fmt(totalCover)} across {open.length} open position{open.length === 1 ? "" : "s"},
                bought for ${fmt(totalPremium, 6)} in premium. The protocol takes 12.5% of each
                premium as a fee, inside the quoted price.
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

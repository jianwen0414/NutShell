"use client";

import { useState } from "react";
import Link from "next/link";
import { Navigation } from "@/components/navigation";

interface HistoryRecord {
  id: string;
  name: string;
  status: "ACTIVE" | "CLOSED" | "EXPIRED";
  cost: string;
  reason: string;
  timeAgo: string;
  note?: string;
  txHash: string;
}

const PROTECTION_HISTORY: HistoryRecord[] = [
  {
    id: "rec-1",
    name: "ETH Downside Protection",
    status: "ACTIVE",
    cost: "$2.15",
    reason: "Base Bridge $40.2M Outflow",
    timeAgo: "2 min ago",
    note: "Currently active • Protects against ETH drops below $2,400",
    txHash: "0x7355eb92dfb0503db558a70c10843618932ab290",
  },
  {
    id: "rec-2",
    name: "ETH Downside Protection",
    status: "CLOSED",
    cost: "$0.30",
    reason: "False alarm debunked (Whitehat test)",
    timeAgo: "3 hours ago",
    note: "$1.85 USDC recovered back to protection reserve",
    txHash: "0x4200000000000000000000000000000000000006",
  },
  {
    id: "rec-3",
    name: "ETH Downside Protection",
    status: "EXPIRED",
    cost: "$1.40",
    reason: "Transient DEX pool volatility",
    timeAgo: "2 days ago",
    note: "Expired safely with zero portfolio loss",
    txHash: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  },
];

export default function PortfolioPage() {
  const [showTechnical, setShowTechnical] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }

  return (
    <>
      <Navigation />
      <main className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 lg:px-8 py-8 space-y-8 font-sans">
        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-cyan-500 text-zinc-950 px-5 py-3 font-mono-code text-xs font-bold shadow-2xl animate-fadeIn flex items-center gap-2">
            <span>⚡</span>
            <span>{toastMessage}</span>
          </div>
        )}

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
            Real-time status of your protected capital, defensive budget, and active market insurance.
          </p>
        </div>

        {/* ========================================================================= */}
        {/* 1. HOW MUCH MONEY DO I HAVE? (3 Clear Numbers) */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Total Protected Capital */}
          <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-1">
            <div className="text-xs text-zinc-400 font-mono-code uppercase tracking-wider">
              Total Protected Capital
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-white font-mono-code pt-1">
              $100,000.00 <span className="text-xs text-zinc-500 font-normal">USDC</span>
            </div>
            <div className="text-xs text-emerald-400 font-medium pt-1">
              ✓ 100% Principal Safe • Untouchable by Agent
            </div>
          </div>

          {/* Available Protection Budget */}
          <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-1">
            <div className="text-xs text-zinc-400 font-mono-code uppercase tracking-wider">
              Available Protection Budget
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-cyan-300 font-mono-code pt-1">
              $142.50 <span className="text-xs text-zinc-500 font-normal">USDC</span>
            </div>
            <div className="text-xs text-zinc-400 pt-1">
              Funded entirely by vault yield (zero principal cost)
            </div>
          </div>

          {/* Spent on Protection Today */}
          <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-1">
            <div className="text-xs text-zinc-400 font-mono-code uppercase tracking-wider">
              Spent on Protection Today
            </div>
            <div className="text-3xl sm:text-4xl font-extrabold text-amber-400 font-mono-code pt-1">
              $2.15 <span className="text-xs text-zinc-500 font-normal">/ $7.12 daily limit</span>
            </div>
            <div className="text-xs text-zinc-400 pt-1">
              $4.97 daily spending allowance remaining
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 2. AM I CURRENTLY PROTECTED? (Active Protection Hero Card) */}
        {/* ========================================================================= */}
        <div className="rounded-3xl bg-gradient-to-b from-[#06150f] via-[#040e0a] to-[#020705] p-7 sm:p-8 border-2 border-emerald-500/60 shadow-2xl space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-emerald-950/80 pb-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-emerald-400 animate-ping"></span>
                <span className="text-xs font-mono-code font-bold text-emerald-400 uppercase tracking-wider">
                  🛡️ PROTECTION STATUS: ACTIVE
                </span>
                <span className="bg-emerald-950 text-emerald-300 text-xs px-2.5 py-0.5 rounded font-bold border border-emerald-500/30 font-mono-code">
                  1 POSITION ACTIVE
                </span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white">
                ETH Downside Protection Active
              </h2>
            </div>

            <button
              onClick={() => {
                showToast("⚡ Emergency Unwind broadcasted. Closing active hedge...");
              }}
              className="rounded-xl bg-amber-950/80 hover:bg-amber-900 border border-amber-500/40 text-amber-300 px-4 py-2 text-xs font-mono-code font-bold transition-all self-start sm:self-auto cursor-pointer"
            >
              ⚡ Close & Unwind Hedge
            </button>
          </div>

          {/* Plain English 4-Point Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-[#030a07] p-4 rounded-xl border border-emerald-900/40 space-y-1">
              <div className="text-zinc-400 text-xs uppercase font-mono-code">Protection Starts Below</div>
              <div className="text-xl font-bold text-white font-mono-code">$2,400.00 ETH</div>
              <div className="text-xs text-emerald-400">Covers portfolio downside</div>
            </div>

            <div className="bg-[#030a07] p-4 rounded-xl border border-emerald-900/40 space-y-1">
              <div className="text-zinc-400 text-xs uppercase font-mono-code">Duration / Expiry</div>
              <div className="text-xl font-bold text-white font-mono-code">7 Days Remaining</div>
              <div className="text-xs text-zinc-400">Active until Sep 06, 2026</div>
            </div>

            <div className="bg-[#030a07] p-4 rounded-xl border border-emerald-900/40 space-y-1">
              <div className="text-zinc-400 text-xs uppercase font-mono-code">Total Cost Paid</div>
              <div className="text-xl font-bold text-amber-300 font-mono-code">$2.15 USDC</div>
              <div className="text-xs text-zinc-400">100% Yield Funded</div>
            </div>

            <div className="bg-[#030a07] p-4 rounded-xl border border-emerald-900/40 space-y-1">
              <div className="text-zinc-400 text-xs uppercase font-mono-code">Protection Trigger</div>
              <div className="text-sm font-bold text-white leading-tight">Verified Market Threat</div>
              <div className="text-xs text-red-400 font-mono-code">Base Bridge Anomaly</div>
            </div>
          </div>

          {/* ========================================================================= */}
          {/* 3. WHY DID NUTSHELL BUY IT? */}
          {/* ========================================================================= */}
          <div className="rounded-2xl bg-[#030a07] p-5 border border-emerald-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-mono-code font-bold text-red-400 flex items-center gap-1.5">
                <span>🚨</span>
                <span>Why this protection was activated:</span>
              </div>
              <p className="text-xs sm:text-sm text-zinc-200 leading-relaxed">
                NutShell detected a <strong>$40.2M abnormal outflow</strong> on the Base Bridge, confirmed the emergency contract pause on-chain, and reached consensus across 3 AI models (Truth Score: <strong>88/100</strong>).
              </p>
            </div>

            <Link
              href="/"
              className="rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 px-5 py-2.5 text-xs font-mono-code font-bold whitespace-nowrap transition-all text-center self-start sm:self-center shrink-0"
            >
              View Full Investigation on Dashboard →
            </Link>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 4. WHAT HAPPENED TO PREVIOUS PROTECTION? (Protection History) */}
        {/* ========================================================================= */}
        <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-cyan-950 pb-3 font-mono-code">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                📜 PROTECTION HISTORY & RESOLUTIONS
              </span>
              <p className="text-xs text-zinc-400 font-sans">
                Audit trail of active, unwound, and expired protective hedges.
              </p>
            </div>
            <span className="text-xs text-zinc-500">3 Recorded Events</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono-code text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 uppercase">
                  <th className="px-4 py-3">Protection Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Cost</th>
                  <th className="px-4 py-3">Reason / Trigger</th>
                  <th className="px-4 py-3">Logged</th>
                  <th className="px-4 py-3 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40 text-zinc-300">
                {PROTECTION_HISTORY.map((rec) => (
                  <tr key={rec.id} className="hover:bg-zinc-900/40 transition-colors">
                    <td className="px-4 py-3.5 font-bold text-white">
                      {rec.name}
                    </td>
                    <td className="px-4 py-3.5">
                      <span
                        className={`px-2.5 py-0.5 rounded font-bold text-[10px] ${
                          rec.status === "ACTIVE"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-500/40"
                            : rec.status === "CLOSED"
                            ? "bg-cyan-950 text-cyan-300 border border-cyan-500/40"
                            : "bg-zinc-800 text-zinc-400"
                        }`}
                      >
                        {rec.status === "ACTIVE" ? "🟢 ACTIVE" : rec.status === "CLOSED" ? "🔵 UNWOUND" : "⚪ EXPIRED"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-bold text-amber-300">{rec.cost}</td>
                    <td className="px-4 py-3.5 text-zinc-300 font-sans">{rec.reason}</td>
                    <td className="px-4 py-3.5 text-zinc-500">{rec.timeAgo}</td>
                    <td className="px-4 py-3.5 text-right">
                      <a
                        href={`https://basescan.org/tx/${rec.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 hover:underline"
                      >
                        Tx ↗
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 5. VIEW TECHNICAL DETAILS (Collapsed Accordion) */}
        {/* ========================================================================= */}
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
                (Underlying options derivative specs, contract addresses & execution wallet)
              </span>
            </div>
            <span className="text-xs text-cyan-400 font-bold">
              {showTechnical ? "Hide Technical Details ▲" : "Show Technical Details ▼"}
            </span>
          </div>

          {showTechnical && (
            <div className="p-6 pt-0 border-t border-cyan-950 space-y-4 text-xs animate-fadeIn">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1">
                  <div className="text-zinc-500 text-[10px] uppercase">Option Contract Type</div>
                  <div className="text-white font-bold text-sm">ETH $2,400 European Put</div>
                  <div className="text-zinc-400 text-[11px]">7-Day Expiry (Sep 06)</div>
                </div>

                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1">
                  <div className="text-zinc-500 text-[10px] uppercase">Execution Router</div>
                  <div className="text-cyan-300 font-bold text-sm">Thetanuts OptionBook v1</div>
                  <div className="text-zinc-400 text-[11px] truncate">0x1bDff855...dfDed (Base)</div>
                </div>

                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1">
                  <div className="text-zinc-500 text-[10px] uppercase">Agent Wallet Balance</div>
                  <div className="text-emerald-400 font-bold text-sm">$5.00 USDC • 0.001 ETH</div>
                  <div className="text-zinc-400 text-[11px] truncate">0x8bbF552...a975</div>
                </div>

                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1">
                  <div className="text-zinc-500 text-[10px] uppercase">Attestation Proof</div>
                  <div className="text-white font-bold text-sm">SELF_TX Attestation</div>
                  <div className="text-zinc-400 text-[11px]">Zero-revert guarantee</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

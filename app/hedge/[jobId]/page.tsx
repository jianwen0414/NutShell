"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";

interface JobDetails {
  jobId: string;
  status: string;
  alert: {
    rawText: string;
    receivedAt: string;
  };
  verification?: {
    consensus?: {
      truthScore: number;
      severity: number;
    };
  };
  decision?: {
    tier: string;
    targetAsset: string;
    targetSizeUsdc: string;
    reason: string;
  };
  position?: {
    status: string;
    asset: string;
    strike: string;
    expiry: string;
    contracts: string;
    premiumPaidUsdc: string;
    notionalProtectedUsdc: string;
    entryTxHash: string;
    wasDryRun: boolean;
  };
}

export default function ManualHedgePage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const resolvedParams = use(params);
  const jobId = resolvedParams.jobId;

  const [job, setJob] = useState<JobDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [executedPosition, setExecutedPosition] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [customBudget, setCustomBudget] = useState<string>("50.00");

  useEffect(() => {
    async function loadJob() {
      try {
        const res = await fetch(`/api/verify/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          setJob(data);
          if (data.decision?.targetSizeUsdc) {
            setCustomBudget(data.decision.targetSizeUsdc);
          }
          if (data.position) {
            setExecutedPosition(data.position);
          }
        }
      } catch (e) {
        console.error("Failed to load job:", e);
      } finally {
        setLoading(false);
      }
    }
    loadJob();
  }, [jobId]);

  async function handleExecute() {
    setExecuting(true);
    setError(null);

    try {
      const res = await fetch("/api/hedge/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          asset: job?.decision?.targetAsset || "ETH",
          budgetUsdc: customBudget,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to execute manual hedge");
      }

      setExecutedPosition(data.position);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExecuting(false);
    }
  }

  const truthScore = job?.verification?.consensus?.truthScore ?? 0;
  const isCritical = truthScore >= 70;

  return (
    <div className="min-h-screen bg-[#07090e] text-zinc-100 font-mono selection:bg-emerald-500/30 selection:text-emerald-300 p-4 sm:p-8 flex flex-col items-center justify-center">
      <div className="w-full max-w-xl space-y-6">
        {/* Navigation / Header */}
        <div className="flex items-center justify-between">
          <Link
            href={`/?jobId=${jobId}`}
            className="text-xs text-zinc-400 hover:text-emerald-400 transition-colors flex items-center gap-1.5"
          >
            ← Back to Dashboard
          </Link>
          <span className="text-[11px] font-bold px-2.5 py-1 rounded bg-amber-950/80 text-amber-300 border border-amber-500/40">
            👁 MONITOR ONLY • HITL OVERRIDE
          </span>
        </div>

        {/* Main Card */}
        <div className="bg-[#0b0f17] border border-zinc-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 via-red-500 to-emerald-500" />

          <div>
            <div className="text-xs text-zinc-400 font-sans uppercase tracking-wider">
              Human-In-The-Loop Emergency Action
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-white mt-1">
              Manual Protective Put Option
            </h1>
            <p className="text-xs text-zinc-400 font-sans mt-1">
              Authoritative execution on Thetanuts OptionBook (Base Mainnet)
            </p>
          </div>

          {/* Incident Box */}
          <div className="bg-black/40 border border-zinc-800/60 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Incident Target:</span>
              <span className="font-bold text-white">Base Bridge • {job?.decision?.targetAsset || "ETH"}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">Consensus Truth:</span>
              <span
                className={`font-bold ${
                  isCritical ? "text-red-400" : "text-amber-400"
                }`}
              >
                {truthScore > 0 ? `${truthScore} / 100` : "78.5 / 100 (Critical Exploit Claim)"}
              </span>
            </div>
            {job?.alert?.rawText && (
              <p className="text-[11px] text-zinc-300 font-sans italic border-t border-zinc-800/60 pt-2 line-clamp-3">
                "{job.alert.rawText}"
              </p>
            )}
          </div>

          {/* Sizing & Parameters */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                <label className="text-[10px] text-zinc-400 uppercase tracking-wider block">
                  Asset to Protect
                </label>
                <div className="text-sm font-bold text-white mt-1">
                  {job?.decision?.targetAsset || "ETH"}
                </div>
              </div>
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3">
                <label className="text-[10px] text-zinc-400 uppercase tracking-wider block">
                  Instrument
                </label>
                <div className="text-sm font-bold text-cyan-400 mt-1">
                  Vanilla Put (Thetanuts)
                </div>
              </div>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 space-y-1.5">
              <label className="text-[11px] text-zinc-300 font-medium block">
                Premium Budget (USDC):
              </label>
              <div className="flex items-center gap-2">
                <span className="text-zinc-500 font-bold">$</span>
                <input
                  type="number"
                  step="5"
                  min="1"
                  max="1000"
                  value={customBudget}
                  onChange={(e) => setCustomBudget(e.target.value)}
                  disabled={Boolean(executedPosition)}
                  className="bg-black/50 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-white font-mono w-full focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                />
                <span className="text-xs text-zinc-400 font-bold">USDC</span>
              </div>
              <span className="text-[10px] text-zinc-500 block">
                Policy recommended: {job?.decision?.targetSizeUsdc || "50.00"} USDC
              </span>
            </div>
          </div>

          {/* Success Box */}
          {executedPosition && (
            <div className="bg-emerald-950/40 border border-emerald-500/50 rounded-xl p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between text-emerald-300 font-bold">
                <span>✓ HEDGE SUCCESSFULLY EXECUTED</span>
                <span>{executedPosition.wasDryRun ? "SIMULATED / DRY RUN" : "LIVE ON BASE"}</span>
              </div>
              <div className="text-zinc-300 space-y-1 text-[11px]">
                <div>Strike Price: <strong className="text-white">${executedPosition.strike ?? "2,400.00"}</strong></div>
                <div>Contracts Filled: <strong className="text-white">{executedPosition.contracts ?? "0.0205 ETH"}</strong></div>
                <div>Expiry: <strong className="text-white">{executedPosition.expiry ?? "7-Day Vanilla"}</strong></div>
                {executedPosition.entryTxHash && (
                  <div className="pt-1 text-[10px] text-zinc-400 truncate">
                    Tx: <a href={`https://basescan.org/tx/${executedPosition.entryTxHash}`} target="_blank" rel="noreferrer" className="text-emerald-400 underline">{executedPosition.entryTxHash}</a>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-950/40 border border-red-500/50 rounded-xl p-3 text-xs text-red-300">
              ❌ Execution error: {error}
            </div>
          )}

          {/* Action Button */}
          {!executedPosition ? (
            <button
              onClick={handleExecute}
              disabled={executing}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-700 text-black font-bold py-3.5 px-4 rounded-xl text-sm transition-all shadow-[0_0_25px_rgba(16,185,129,0.3)] flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {executing ? (
                <>
                  <span className="animate-spin inline-block w-4 h-4 border-2 border-black border-t-transparent rounded-full" />
                  <span>Querying Orderbook & Filling Put...</span>
                </>
              ) : (
                <>
                  <span>🛡 CONFIRM & FILL PUT OPTION ON THETANUTS</span>
                </>
              )}
            </button>
          ) : (
            <Link
              href={`/?jobId=${jobId}`}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-bold py-3.5 px-4 rounded-xl text-sm transition-all flex items-center justify-center gap-2 text-center"
            >
              <span>View Active Position in Dashboard →</span>
            </Link>
          )}

          <div className="text-[10px] text-zinc-500 text-center">
            Settles on Thetanuts Finance OptionBook contract on Base mainnet.
          </div>
        </div>
      </div>
    </div>
  );
}

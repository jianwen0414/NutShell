"use client";

import { useState } from "react";
import { Navigation } from "@/components/navigation";

type RiskTier = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";

export default function ConfigurationPage() {
  const [riskTier, setRiskTier] = useState<RiskTier>("BALANCED");
  const [useTierDefaults, setUseTierDefaults] = useState(true);
  const [maxTradeCost, setMaxTradeCost] = useState("3.00");
  const [dailyBudgetCap, setDailyBudgetCap] = useState("5");
  const [execMode, setExecMode] = useState<"AUTONOMOUS" | "APPROVAL_REQUIRED" | "MONITOR_ONLY">("AUTONOMOUS");
  
  // Advanced Granular Variables (Hidden under Advanced Accordion)
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [truthThresholdFull, setTruthThresholdFull] = useState("85");
  const [truthThresholdSmall, setTruthThresholdSmall] = useState("70");
  const [agreementThreshold, setAgreementThreshold] = useState("70");

  const [saved, setSaved] = useState(false);

  function applyRiskTier(tier: RiskTier) {
    setRiskTier(tier);
    if (useTierDefaults) {
      if (tier === "CONSERVATIVE") {
        setMaxTradeCost("1.50");
        setDailyBudgetCap("3");
        setTruthThresholdFull("90");
        setTruthThresholdSmall("80");
        setAgreementThreshold("85");
      } else if (tier === "BALANCED") {
        setMaxTradeCost("3.00");
        setDailyBudgetCap("5");
        setTruthThresholdFull("85");
        setTruthThresholdSmall("70");
        setAgreementThreshold("70");
      } else if (tier === "AGGRESSIVE") {
        setMaxTradeCost("5.00");
        setDailyBudgetCap("10");
        setTruthThresholdFull("75");
        setTruthThresholdSmall("60");
        setAgreementThreshold("60");
      }
    }
  }

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  return (
    <>
      <Navigation />
      <main className="mx-auto w-full max-w-[1560px] px-4 sm:px-6 lg:px-8 py-8 space-y-8 font-sans">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-mono-code text-amber-400 font-bold uppercase tracking-wider">
              <span className="h-2 w-2 rounded-full bg-amber-400"></span>
              <span>PERSISTENT POLICY & RISK SETTINGS</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white font-mono-code tracking-tight">
              Autonomous Safety Configuration
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400">
              Configure long-term risk appetite, protection budgets, execution mode, and deterministic guardrails.
            </p>
          </div>

          <button
            onClick={handleSave}
            className="flex items-center gap-2 rounded-xl bg-cyan-500 px-6 py-2.5 text-xs font-mono-code font-bold text-zinc-950 hover:bg-cyan-400 active:scale-95 transition-all shadow-md shadow-cyan-500/20 self-start md:self-auto cursor-pointer"
          >
            <span>{saved ? "✓ CONFIGURATION SAVED" : "SAVE CONFIGURATION"}</span>
          </button>
        </div>

        {/* ========================================================================= */}
        {/* 01. RISK PROFILE */}
        {/* ========================================================================= */}
        <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-4 font-mono-code">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-cyan-950 pb-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                01 🛡️ RISK PROFILE
              </span>
              <p className="text-xs text-zinc-400 font-sans">
                Controls evidence requirements, AI agreement threshold, and default sizing.
              </p>
            </div>
            <span className="text-xs bg-cyan-950 text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded font-bold">
              Active: {riskTier}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
            {/* Conservative */}
            <div
              onClick={() => applyRiskTier("CONSERVATIVE")}
              className={`rounded-xl p-4 border transition-all cursor-pointer space-y-2 ${
                riskTier === "CONSERVATIVE"
                  ? "bg-emerald-950/40 border-emerald-400 ring-2 ring-emerald-400/30"
                  : "bg-[#050b12] border-zinc-800/80 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-emerald-400 text-sm flex items-center gap-1.5">
                  <span>🟢</span>
                  <span>Conservative</span>
                </span>
                <span className="text-xs text-zinc-500">{riskTier === "CONSERVATIVE" ? "● Active" : "○ Select"}</span>
              </div>
              <p className="text-xs text-zinc-300 font-sans leading-relaxed">
                Requires overwhelming on-chain evidence (Truth ≥ 90, Agreement ≥ 85%). Recommended max hedge: <strong>$1.50 USDC</strong>.
              </p>
            </div>

            {/* Balanced (Recommended) */}
            <div
              onClick={() => applyRiskTier("BALANCED")}
              className={`rounded-xl p-4 border transition-all cursor-pointer space-y-2 ${
                riskTier === "BALANCED"
                  ? "bg-amber-950/40 border-amber-400 ring-2 ring-amber-400/30 shadow-[0_0_15px_rgba(245,158,11,0.15)]"
                  : "bg-[#050b12] border-zinc-800/80 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-400 text-sm flex items-center gap-1.5">
                  <span>🟡</span>
                  <span>Balanced</span>
                  <span className="text-[10px] bg-amber-950 text-amber-300 px-1.5 py-0.2 rounded font-normal">
                    Recommended
                  </span>
                </span>
                <span className="text-xs text-zinc-500">{riskTier === "BALANCED" ? "● Active" : "○ Select"}</span>
              </div>
              <p className="text-xs text-zinc-300 font-sans leading-relaxed">
                Standard protection requirements (Truth ≥ 85, Agreement ≥ 70%). Recommended max hedge: <strong>$3.00 USDC</strong>.
              </p>
            </div>

            {/* Aggressive */}
            <div
              onClick={() => applyRiskTier("AGGRESSIVE")}
              className={`rounded-xl p-4 border transition-all cursor-pointer space-y-2 ${
                riskTier === "AGGRESSIVE"
                  ? "bg-red-950/40 border-red-400 ring-2 ring-red-400/30"
                  : "bg-[#050b12] border-zinc-800/80 hover:border-zinc-700"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-red-400 text-sm flex items-center gap-1.5">
                  <span>🔴</span>
                  <span>Aggressive</span>
                </span>
                <span className="text-xs text-zinc-500">{riskTier === "AGGRESSIVE" ? "● Active" : "○ Select"}</span>
              </div>
              <p className="text-xs text-zinc-300 font-sans leading-relaxed">
                Responds earlier to suspected incidents (Truth ≥ 70, Agreement ≥ 60%). Recommended max hedge: <strong>$5.00 USDC</strong>.
              </p>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 02 & 03: PROTECTION BUDGET & EXECUTION MODE */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 02. Protection Budget (6 cols) */}
          <div className="lg:col-span-6 rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-4 font-mono-code">
            <div className="flex items-center justify-between border-b border-cyan-950 pb-3">
              <div className="space-y-0.5">
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  02 💰 PROTECTION BUDGET
                </span>
                <p className="text-xs text-zinc-400 font-sans">
                  Maximum allowable spend per hedge and daily ceiling.
                </p>
              </div>
              <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useTierDefaults}
                  onChange={(e) => {
                    setUseTierDefaults(e.target.checked);
                    if (e.target.checked) applyRiskTier(riskTier);
                  }}
                  className="accent-cyan-400 rounded"
                />
                <span>Use {riskTier} defaults</span>
              </label>
            </div>

            <div className="space-y-4">
              {/* Max Cost Per Hedge */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 font-semibold">Maximum Cost Per Hedge Trade:</span>
                  <div className="flex items-center gap-1 bg-[#050b12] px-2.5 py-1 rounded-lg border border-zinc-800">
                    <span className="text-amber-400">$</span>
                    <input
                      type="number"
                      value={maxTradeCost}
                      disabled={useTierDefaults}
                      onChange={(e) => setMaxTradeCost(e.target.value)}
                      className="w-14 bg-transparent text-white font-bold focus:outline-none text-right disabled:opacity-60"
                      step="0.1"
                      min="0.5"
                      max="10"
                    />
                    <span className="text-zinc-400 text-[11px]">USDC</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="10"
                  step="0.25"
                  value={maxTradeCost}
                  disabled={useTierDefaults}
                  onChange={(e) => setMaxTradeCost(e.target.value)}
                  className="w-full accent-amber-400 cursor-pointer disabled:opacity-40"
                />
                <div className="flex justify-between text-[11px] text-zinc-500">
                  <span>$0.50 (Min)</span>
                  <span>Cost Cap: ${maxTradeCost} USDC</span>
                  <span>$10.00 (Max)</span>
                </div>
              </div>

              {/* Daily Risk Budget Cap */}
              <div className="space-y-2 pt-3 border-t border-zinc-800/80">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-300 font-semibold">Daily Protection Spending Limit:</span>
                  <div className="flex items-center gap-1 bg-[#050b12] px-2.5 py-1 rounded-lg border border-zinc-800">
                    <input
                      type="number"
                      value={dailyBudgetCap}
                      disabled={useTierDefaults}
                      onChange={(e) => setDailyBudgetCap(e.target.value)}
                      className="w-10 bg-transparent text-white font-bold focus:outline-none text-right disabled:opacity-60"
                      min="1"
                      max="20"
                    />
                    <span className="text-amber-400 font-bold">%</span>
                    <span className="text-zinc-400 text-[11px]">/ 24h</span>
                  </div>
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="1"
                  value={dailyBudgetCap}
                  disabled={useTierDefaults}
                  onChange={(e) => setDailyBudgetCap(e.target.value)}
                  className="w-full accent-amber-400 cursor-pointer disabled:opacity-40"
                />
                <div className="flex justify-between text-[11px] text-zinc-500">
                  <span>1% (Conservative)</span>
                  <span>Daily Cap: {dailyBudgetCap}%</span>
                  <span>20% (Aggressive)</span>
                </div>
              </div>
            </div>
          </div>

          {/* 03. Execution Mode (6 cols) */}
          <div className="lg:col-span-6 rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-4 font-mono-code">
            <div className="border-b border-cyan-950 pb-3">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                03 🤖 DEFAULT EXECUTION MODE
              </span>
              <p className="text-xs text-zinc-400 font-sans mt-0.5">
                Set the agent&apos;s standard trading autonomy. (Can be overridden in Control).
              </p>
            </div>

            <div className="space-y-2.5">
              <button
                onClick={() => setExecMode("AUTONOMOUS")}
                className={`w-full p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  execMode === "AUTONOMOUS"
                    ? "bg-cyan-950 border-cyan-400 text-cyan-300 ring-1 ring-cyan-400"
                    : "bg-[#050b12] border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                <div className="font-bold text-xs">
                  {execMode === "AUTONOMOUS" ? "● " : "○ "}🤖 Autonomous Execution
                </div>
                <div className="text-[11px] text-zinc-400 font-sans mt-0.5">
                  Agent executes approved put options immediately upon verified policy breach.
                </div>
              </button>

              <button
                onClick={() => setExecMode("APPROVAL_REQUIRED")}
                className={`w-full p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  execMode === "APPROVAL_REQUIRED"
                    ? "bg-cyan-950 border-cyan-400 text-cyan-300 ring-1 ring-cyan-400"
                    : "bg-[#050b12] border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                <div className="font-bold text-xs">
                  {execMode === "APPROVAL_REQUIRED" ? "● " : "○ "}✋ Operator Approval Required
                </div>
                <div className="text-[11px] text-zinc-400 font-sans mt-0.5">
                  Agent investigates threats and prepares the trade; operator must confirm before broadcast.
                </div>
              </button>

              <button
                onClick={() => setExecMode("MONITOR_ONLY")}
                className={`w-full p-3 rounded-xl border text-left transition-all cursor-pointer ${
                  execMode === "MONITOR_ONLY"
                    ? "bg-cyan-950 border-cyan-400 text-cyan-300 ring-1 ring-cyan-400"
                    : "bg-[#050b12] border-zinc-800 text-zinc-400 hover:bg-zinc-900"
                }`}
              >
                <div className="font-bold text-xs">
                  {execMode === "MONITOR_ONLY" ? "● " : "○ "}👁 Monitor Only
                </div>
                <div className="text-[11px] text-zinc-400 font-sans mt-0.5">
                  Runs full AI verification and logs telemetry, but cannot touch funds or trade.
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 04. AGENT SAFETY PERMISSIONS */}
        {/* ========================================================================= */}
        <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-5 font-mono-code">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-cyan-950 pb-3">
            <div className="space-y-0.5">
              <span className="text-xs font-bold text-white uppercase tracking-wider">
                04 🔐 AGENT SAFETY PERMISSIONS & ALLOWLIST
              </span>
              <p className="text-xs text-zinc-400 font-sans">
                Deterministic security boundary declaring what actions NutShell is allowed vs forbidden to execute.
              </p>
            </div>
            <span className="text-xs bg-emerald-950 text-emerald-300 border border-emerald-500/40 px-2.5 py-0.5 rounded font-bold">
              Base Mainnet
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Allowed vs Forbidden Actions (7 cols) */}
            <div className="lg:col-span-7 space-y-3 text-xs">
              <div className="text-zinc-400 uppercase font-bold text-[11px]">
                Deterministic Action Permissions:
              </div>
              <div className="space-y-2">
                <div className="bg-[#050b12] p-3 rounded-xl border border-emerald-900/40 flex items-center justify-between text-emerald-300">
                  <span className="flex items-center gap-2">
                    <span className="text-emerald-400 font-bold">✓</span>
                    <span>Buy protective put options</span>
                  </span>
                  <span className="text-[10px] bg-emerald-950 px-2 py-0.5 rounded font-bold">ALLOWED</span>
                </div>
                <div className="bg-[#050b12] p-3 rounded-xl border border-emerald-900/40 flex items-center justify-between text-emerald-300">
                  <span className="flex items-center gap-2">
                    <span className="text-emerald-400 font-bold">✓</span>
                    <span>Unwind / close existing hedges</span>
                  </span>
                  <span className="text-[10px] bg-emerald-950 px-2 py-0.5 rounded font-bold">ALLOWED</span>
                </div>
                <div className="bg-[#050b12] p-3 rounded-xl border border-red-900/40 flex items-center justify-between text-red-400 opacity-80">
                  <span className="flex items-center gap-2">
                    <span className="text-red-400 font-bold">✕</span>
                    <span>Transfer funds externally</span>
                  </span>
                  <span className="text-[10px] bg-red-950 px-2 py-0.5 rounded font-bold">FORBIDDEN</span>
                </div>
                <div className="bg-[#050b12] p-3 rounded-xl border border-red-900/40 flex items-center justify-between text-red-400 opacity-80">
                  <span className="flex items-center gap-2">
                    <span className="text-red-400 font-bold">✕</span>
                    <span>Sell naked calls / write options</span>
                  </span>
                  <span className="text-[10px] bg-red-950 px-2 py-0.5 rounded font-bold">FORBIDDEN</span>
                </div>
              </div>
            </div>

            {/* Verified Infrastructure (5 cols) */}
            <div className="lg:col-span-5 space-y-3 text-xs">
              <div className="text-zinc-400 uppercase font-bold text-[11px]">
                Verified Infrastructure:
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-[#050b12] p-3 rounded-xl border border-emerald-900/40 space-y-0.5">
                  <div className="text-zinc-500 text-[10px]">Target Network</div>
                  <div className="text-emerald-400 font-bold">Base Mainnet ✓</div>
                </div>
                <div className="bg-[#050b12] p-3 rounded-xl border border-emerald-900/40 space-y-0.5">
                  <div className="text-zinc-500 text-[10px]">Options Provider</div>
                  <div className="text-emerald-400 font-bold">Thetanuts OptionBook ✓</div>
                </div>
                <div className="bg-[#050b12] p-3 rounded-xl border border-emerald-900/40 space-y-0.5">
                  <div className="text-zinc-500 text-[10px]">Protected Assets</div>
                  <div className="text-emerald-400 font-bold">ETH / WETH / cbETH ✓</div>
                </div>
                <div className="bg-[#050b12] p-3 rounded-xl border border-emerald-900/40 space-y-0.5">
                  <div className="text-zinc-500 text-[10px]">Settlement Currency</div>
                  <div className="text-emerald-400 font-bold">USDC (Base Native) ✓</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 05. ADVANCED TECHNICAL SETTINGS (Collapsed Accordion by default) */}
        {/* ========================================================================= */}
        <div className="rounded-2xl bg-[#09111c] border border-cyan-950 shadow-xl overflow-hidden font-mono-code">
          <div
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="p-5 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] transition-colors select-none"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                05 ⚙️ ADVANCED TECHNICAL SETTINGS
              </span>
              <span className="text-xs text-zinc-500 font-sans">
                (Granular policy thresholds & contract addresses)
              </span>
            </div>
            <span className="text-xs text-cyan-400 font-bold">
              {showAdvanced ? "Hide Advanced Settings ▲" : "Show Advanced Settings ▼"}
            </span>
          </div>

          {showAdvanced && (
            <div className="p-6 pt-0 border-t border-cyan-950 space-y-6 animate-fadeIn">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-4 text-xs">
                {/* Full Hedge Threshold */}
                <div className="space-y-1.5 bg-[#050b12] p-4 rounded-xl border border-zinc-800">
                  <div className="flex justify-between text-zinc-300">
                    <span>HEDGE_FULL Threshold:</span>
                    <strong className="text-red-400">≥ {truthThresholdFull} / 100</strong>
                  </div>
                  <input
                    type="range"
                    min="75"
                    max="95"
                    step="1"
                    value={truthThresholdFull}
                    onChange={(e) => setTruthThresholdFull(e.target.value)}
                    className="w-full accent-red-400 cursor-pointer"
                  />
                  <p className="text-[11px] text-zinc-500 font-sans">
                    Score required for full-size derivative option execution.
                  </p>
                </div>

                {/* Small Hedge Threshold */}
                <div className="space-y-1.5 bg-[#050b12] p-4 rounded-xl border border-zinc-800">
                  <div className="flex justify-between text-zinc-300">
                    <span>HEDGE_SMALL Threshold:</span>
                    <strong className="text-cyan-400">≥ {truthThresholdSmall} / 100</strong>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="85"
                    step="5"
                    value={truthThresholdSmall}
                    onChange={(e) => setTruthThresholdSmall(e.target.value)}
                    className="w-full accent-cyan-400 cursor-pointer"
                  />
                  <p className="text-[11px] text-zinc-500 font-sans">
                    Score required for partial downside protection.
                  </p>
                </div>

                {/* Agreement Threshold */}
                <div className="space-y-1.5 bg-[#050b12] p-4 rounded-xl border border-zinc-800">
                  <div className="flex justify-between text-zinc-300">
                    <span>Model Agreement Minimum:</span>
                    <strong className="text-emerald-400">≥ {agreementThreshold}%</strong>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="95"
                    step="5"
                    value={agreementThreshold}
                    onChange={(e) => setAgreementThreshold(e.target.value)}
                    className="w-full accent-emerald-400 cursor-pointer"
                  />
                  <p className="text-[11px] text-zinc-500 font-sans">
                    Minimum multi-LLM concordance across the Gonka Triad.
                  </p>
                </div>
              </div>

              {/* Technical Allowlist Raw Addresses */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1.5">
                  <div className="text-zinc-500 text-[10px] uppercase">Thetanuts OptionBook Contract</div>
                  <div className="text-cyan-300 font-mono-code text-[11px] truncate">
                    0x1bDff855d6811728acaDC00989e79143a2bdfDed
                  </div>
                </div>

                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1.5">
                  <div className="text-zinc-500 text-[10px] uppercase">Attestation Mechanism</div>
                  <div className="text-emerald-400 font-mono-code text-[11px]">
                    SELF_TX (Zero-revert execution proof)
                  </div>
                </div>

                <div className="bg-[#050b12] p-4 rounded-xl border border-zinc-800 space-y-1.5">
                  <div className="text-zinc-500 text-[10px] uppercase">Gonka AI Models</div>
                  <div className="text-zinc-300 text-[11px]">
                    MiniMax-M2.5 • Kimi-k1.5 • GLM-4
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

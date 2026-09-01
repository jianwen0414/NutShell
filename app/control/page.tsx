"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Navigation } from "@/components/navigation";

interface VerificationOutcome {
  claim: string;
  sourceUrl?: string;
  truthScore: number;
  agreement: number;
  verdict: "REAL INCIDENT" | "FALSE ALARM" | "SUSPICIOUS / WATCH";
  decision: "HEDGE_FULL" | "HEDGE_SMALL" | "WATCH" | "REJECT";
  models: Array<{
    name: string;
    score: number;
    stance: "REAL" | "FAKE" | "UNCERTAIN";
    reason: string;
  }>;
  resolutionTrace: string;
}

interface HistoryItem {
  id: string;
  claim: string;
  source: string;
  verdict: "REAL" | "FAKE" | "WATCH";
  truthScore: number;
  timeAgo: string;
  outcome: VerificationOutcome;
}

const PRESET_CLAIMS = [
  {
    title: "Base Bridge Outflow ($40M)",
    text: "ALERT: Large abnormal outflows totaling ~16,800 ETH ($40.2M) detected from Base Bridge across 2 blocks. Emergency pause contract state emitted.",
    sourceUrl: "https://x.com/chainwatch_sec/status/1892049",
    outcome: {
      claim: "ALERT: Large abnormal outflows totaling ~16,800 ETH ($40.2M) detected from Base Bridge across 2 blocks.",
      sourceUrl: "https://x.com/chainwatch_sec/status/1892049",
      truthScore: 88,
      agreement: 92,
      verdict: "REAL INCIDENT" as const,
      decision: "HEDGE_FULL" as const,
      models: [
        {
          name: "MiniMax-M2.7",
          score: 88,
          stance: "REAL" as const,
          reason: "Velocity spike 4.2x baseline & destination matches drain pattern.",
        },
        {
          name: "Kimi-K2.6",
          score: 86,
          stance: "REAL" as const,
          reason: "Pause emitted 66s post-outflow confirms unauthorized event.",
        },
        {
          name: "DeepSeek-V4-Flash",
          score: 88,
          stance: "REAL" as const,
          reason: "Multi-sig emergency circuit breaker triggered immediately.",
        },
      ],
      resolutionTrace: "Consensus reached. Score 88 exceeds policy threshold (85). Autonomous put option hedge authorized on Thetanuts.",
    },
  },
  {
    title: "USDC Freeze Social Rumor",
    text: "RUMOR: Circle reportedly blacklisting major Base bridging contracts following compliance inquiry. Heavy market dumping expected.",
    sourceUrl: "https://x.com/defialerts_x/status/1892110",
    outcome: {
      claim: "RUMOR: Circle reportedly blacklisting major Base bridging contracts following compliance inquiry.",
      sourceUrl: "https://x.com/defialerts_x/status/1892110",
      truthScore: 18,
      agreement: 95,
      verdict: "FALSE ALARM" as const,
      decision: "REJECT" as const,
      models: [
        {
          name: "MiniMax-M2.7",
          score: 15,
          stance: "FAKE" as const,
          reason: "Zero blacklist bytecode events detected on Base USDC contract.",
        },
        {
          name: "Kimi-K2.6",
          score: 20,
          stance: "FAKE" as const,
          reason: "Attestation reserves and redemption channels nominal.",
        },
        {
          name: "DeepSeek-V4-Flash",
          score: 19,
          stance: "FAKE" as const,
          reason: "Unsubstantiated social leak lacking cryptographic proof.",
        },
      ],
      resolutionTrace: "Consensus rejected. Truth score (18) well beneath hedge threshold. Preserved capital reserve.",
    },
  },
  {
    title: "DEX Pool Slippage Spike",
    text: "Uniswap v3 WETH/USDC 0.05% pool experiencing localized 0.85% slippage imbalance following 600 ETH swap.",
    sourceUrl: "https://basescan.org/tx/0x982f",
    outcome: {
      claim: "Uniswap v3 WETH/USDC 0.05% pool experiencing localized 0.85% slippage imbalance.",
      sourceUrl: "https://basescan.org/tx/0x982f",
      truthScore: 42,
      agreement: 88,
      verdict: "SUSPICIOUS / WATCH" as const,
      decision: "WATCH" as const,
      models: [
        {
          name: "MiniMax-M2.7",
          score: 40,
          stance: "UNCERTAIN" as const,
          reason: "Normal arbitrageur rebalance window in progress.",
        },
        {
          name: "Kimi-K2.6",
          score: 45,
          stance: "UNCERTAIN" as const,
          reason: "Slippage remains beneath the 1.5% volatility threshold.",
        },
        {
          name: "DeepSeek-V4-Flash",
          score: 41,
          stance: "UNCERTAIN" as const,
          reason: "No contract vulnerability or abnormal gas spike observed.",
        },
      ],
      resolutionTrace: "Placed on active surveillance watch. No hedge action executed.",
    },
  },
];

const INITIAL_HISTORY: HistoryItem[] = [
  {
    id: "hist-1",
    claim: "Base Bridge $40.2M abnormal outflow spike",
    source: "ChainWatch (X)",
    verdict: "REAL",
    truthScore: 88,
    timeAgo: "12m ago",
    outcome: PRESET_CLAIMS[0].outcome,
  },
  {
    id: "hist-2",
    claim: "Circle USDC blacklisting rumors on Base",
    source: "Telegram Firehose",
    verdict: "FAKE",
    truthScore: 18,
    timeAgo: "45m ago",
    outcome: PRESET_CLAIMS[1].outcome,
  },
  {
    id: "hist-3",
    claim: "WETH/USDC localized 0.85% liquidity imbalance",
    source: "Uniswap Sensor",
    verdict: "WATCH",
    truthScore: 42,
    timeAgo: "2h ago",
    outcome: PRESET_CLAIMS[2].outcome,
  },
];

export default function ControlPage() {
  const [agentStatus, setAgentStatus] = useState<"ARMED" | "PAUSED">("ARMED");
  const [execMode, setExecMode] = useState<"AUTONOMOUS" | "APPROVAL_REQUIRED" | "MONITOR_ONLY">("AUTONOMOUS");
  
  const [claimText, setClaimText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyStep, setVerifyStep] = useState<number>(0);
  const [verifiedOutcome, setVerifiedOutcome] = useState<VerificationOutcome | null>(null);
  // Verdicts as they arrive, so the progress rows show real models and real
  // scores rather than a fixed slot per model.
  const [liveModels, setLiveModels] = useState<VerificationOutcome["models"]>([]);
  
  const [history, setHistory] = useState<HistoryItem[]>(INITIAL_HISTORY);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  /**
   * Operator token for the mutating routes. Held only in component state, never
   * persisted — every operator endpoint checks it server-side against
   * OPERATOR_TOKEN, so an empty box simply means those actions 401.
   */
  const [operatorToken, setOperatorToken] = useState("");

  const verificationResultRef = useRef<HTMLDivElement | null>(null);

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }

  /**
   * Runs the real pipeline. The step indicator, the scroll and the result
   * panels are unchanged; they are driven by events arriving rather than by a
   * chain of timers, so a slow model looks slow and a model that drops out is
   * missing rather than invented.
   *
   * This posts to the public verify route, which verifies and decides but
   * never trades. Reaching the book needs an operator token, which does not
   * belong in the browser.
   */
  async function handleVerify() {
    if (!claimText.trim()) return;
    setIsVerifying(true);
    setVerifyStep(1);
    setVerifiedOutcome(null);
    setLiveModels([]);

    setTimeout(() => {
      verificationResultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);

    let jobId: string;
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: claimText.trim(), sourceUrl: sourceUrl || undefined }),
      });
      const body = await res.json();
      if (!res.ok || !body?.jobId) throw new Error(body?.error?.message ?? "Could not start.");
      jobId = body.jobId;
    } catch (e) {
      setIsVerifying(false);
      setVerifyStep(0);
      setToastMessage(e instanceof Error ? e.message : "Verification failed to start.");
      return;
    }

    const models: VerificationOutcome["models"] = [];
    let truthScore = 0;
    let agreement = 0;
    let decision: VerificationOutcome["decision"] = "WATCH";
    let trace = "";

    const es = new EventSource(`/api/verify/${jobId}/stream`);

    es.addEventListener("verdict", (ev) => {
      const v = JSON.parse((ev as MessageEvent).data);
      models.push({
        name: v.modelId.split("/").pop() ?? v.modelId,
        score: v.claimScore,
        stance: v.stance,
        reason: v.keyEvidence?.[0] ?? v.redFlags?.[0] ?? "No evidence cited.",
      });
      setLiveModels([...models]);
      setVerifyStep(Math.min(4, models.length + 1));
    });

    es.addEventListener("consensus", (ev) => {
      const c = JSON.parse((ev as MessageEvent).data);
      truthScore = c.truthScore;
      agreement = Math.round(c.agreement * 100);
      setVerifyStep(5);
    });

    es.addEventListener("decision", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      decision = d.tier;
      trace = d.reason;
    });

    const settle = () => {
      es.close();
      // Bands match the policy engine: hedge at 70, reject below 40.
      const verdict: VerificationOutcome["verdict"] =
        truthScore >= 70 ? "REAL INCIDENT" : truthScore < 40 ? "FALSE ALARM" : "SUSPICIOUS / WATCH";

      const outcome: VerificationOutcome = {
        claim: claimText,
        sourceUrl,
        truthScore,
        agreement,
        verdict,
        decision,
        models,
        resolutionTrace:
          trace || `Verified across ${models.length} of 3 models. Truth score ${truthScore}.`,
      };

      setVerifiedOutcome(outcome);
      setIsVerifying(false);
      setVerifyStep(0);

      setHistory((prev) => [
        {
          id: `hist-${Date.now()}`,
          claim: claimText.slice(0, 50) + (claimText.length > 50 ? "..." : ""),
          source: sourceUrl ? "Custom URL" : "Manual Paste",
          verdict:
            outcome.verdict === "REAL INCIDENT"
              ? "REAL"
              : outcome.verdict === "FALSE ALARM"
                ? "FAKE"
                : "WATCH",
          truthScore: outcome.truthScore,
          timeAgo: "Just now",
          outcome,
        },
        ...prev,
      ]);
    };

    es.addEventListener("done", settle);
    es.addEventListener("error", (ev) => {
      const raw = (ev as MessageEvent).data;
      if (raw) {
        try {
          setToastMessage(JSON.parse(raw)?.error?.message ?? "Verification failed.");
        } catch {
          setToastMessage("Verification failed.");
        }
      }
      settle();
    });
  }

  return (
    <>
      <Navigation />
      <main className="mx-auto w-full max-w-[1560px] px-4 sm:px-6 lg:px-8 py-8 space-y-8 font-sans">
        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed bottom-6 right-6 z-50 rounded-xl bg-cyan-500 text-zinc-950 px-5 py-3 font-mono-code text-xs font-bold shadow-2xl animate-fadeIn flex items-center gap-2">
            <span>⚡</span>
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-mono-code text-cyan-400 font-bold uppercase tracking-wider">
              <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
              <span>OPERATOR COMMAND CENTER</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white font-mono-code tracking-tight">
              Interactive Agent Controls & Manual Verification
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400">
              Test claims against the Gonka AI Triad, toggle live agent execution modes, and access emergency controls.
            </p>
          </div>

          <Link
            href="/"
            className="rounded-xl bg-[#09111c] hover:bg-[#0e1b2b] border border-cyan-900/50 text-cyan-300 px-4 py-2 text-xs font-mono-code font-bold transition-all self-start md:self-auto flex items-center gap-2"
          >
            <span>← LIVE DASHBOARD</span>
          </Link>
        </div>

        {/* ========================================================================= */}
        {/* ① AGENT STATUS & QUICK OPERATIONAL OVERRIDES */}
        {/* ========================================================================= */}
        <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-4 font-mono-code">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-cyan-950 pb-3">
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                ① AGENT STATUS & LIVE OVERRIDES
              </span>
              <span
                className={`text-xs font-bold px-2.5 py-0.5 rounded border ${
                  agentStatus === "ARMED"
                    ? "bg-emerald-950 text-emerald-300 border-emerald-500/40"
                    : "bg-amber-950 text-amber-300 border-amber-500/40"
                }`}
              >
                ● {agentStatus === "ARMED" ? "AGENT ARMED" : "AGENT PAUSED"}
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">Current Mode:</span>
              <span className="text-cyan-300 font-bold bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500/30">
                {execMode === "AUTONOMOUS" ? "🤖 AUTONOMOUS" : execMode === "APPROVAL_REQUIRED" ? "✋ APPROVAL REQ" : "👁 MONITOR ONLY"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="bg-[#050b12] p-3 rounded-xl border border-zinc-800/60">
              <div className="text-zinc-500 text-[11px]">Monitoring</div>
              <div className="text-sm font-bold text-white mt-0.5">
                {agentStatus === "ARMED" ? "ACTIVE" : "STANDBY"}
              </div>
            </div>
            <div className="bg-[#050b12] p-3 rounded-xl border border-zinc-800/60">
              <div className="text-zinc-500 text-[11px]">Target Network</div>
              <div className="text-sm font-bold text-cyan-400 mt-0.5">Base Mainnet</div>
            </div>
            <div className="bg-[#050b12] p-3 rounded-xl border border-zinc-800/60">
              <div className="text-zinc-500 text-[11px]">Option Router</div>
              <div className="text-sm font-bold text-emerald-400 mt-0.5">Thetanuts v1</div>
            </div>
            <div className="bg-[#050b12] p-3 rounded-xl border border-zinc-800/60">
              <div className="text-zinc-500 text-[11px]">Gonka Consensus</div>
              <div className="text-sm font-bold text-zinc-200 mt-0.5">3 / 3 Triad</div>
            </div>
          </div>

          {/* Quick Override Action Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => {
                  setAgentStatus(agentStatus === "ARMED" ? "PAUSED" : "ARMED");
                  showToast(
                    agentStatus === "ARMED"
                      ? "Agent autonomous monitoring paused."
                      : "Agent monitoring resumed & armed."
                  );
                }}
                className={`py-2 px-4 rounded-xl font-mono-code font-bold text-xs transition-all cursor-pointer flex-1 sm:flex-none ${
                  agentStatus === "ARMED"
                    ? "bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30"
                    : "bg-emerald-500 hover:bg-emerald-400 text-zinc-950"
                }`}
              >
                {agentStatus === "ARMED" ? "⏸ PAUSE AGENT" : "▶ RESUME AGENT"}
              </button>

              <button
                onClick={() => {
                  const newMode = execMode === "MONITOR_ONLY" ? "AUTONOMOUS" : "MONITOR_ONLY";
                  setExecMode(newMode);
                  showToast(`Live Override: Mode set to ${newMode}.`);
                }}
                className="py-2 px-4 rounded-xl bg-[#050b12] hover:bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono-code font-bold text-xs transition-all cursor-pointer flex-1 sm:flex-none"
              >
                {execMode === "MONITOR_ONLY" ? "🤖 RESTORE AUTONOMOUS" : "👁 SWITCH TO MONITOR ONLY"}
              </button>
            </div>

            <Link
              href="/configuration"
              className="text-xs text-cyan-400 hover:underline flex items-center gap-1 self-end sm:self-auto"
            >
              <span>Edit permanent policy in Configuration →</span>
            </Link>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* ② MANUAL CLAIM VERIFICATION */}
        {/* ========================================================================= */}
        <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-5 font-mono-code">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-cyan-950 pb-3">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
              ② MANUAL VERIFICATION
            </span>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-zinc-500">Preset Scenarios:</span>
              <div className="flex flex-wrap gap-1.5">
                {PRESET_CLAIMS.map((preset) => (
                  <button
                    key={preset.title}
                    onClick={() => {
                      setClaimText(preset.text);
                      setSourceUrl(preset.sourceUrl);
                    }}
                    className={`rounded-lg px-2.5 py-0.5 text-xs transition-all cursor-pointer ${
                      claimText === preset.text
                        ? "bg-cyan-500 text-zinc-950 font-bold"
                        : "bg-[#050b12] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-zinc-800"
                    }`}
                  >
                    {preset.title}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-8 space-y-2">
              <label className="block text-xs text-zinc-400 uppercase tracking-wider">
                Claim / Alert Text:
              </label>
              <textarea
                value={claimText}
                onChange={(e) => setClaimText(e.target.value)}
                placeholder="Enter suspicious claim, tweet, or on-chain transaction alert..."
                rows={3}
                className="w-full rounded-xl bg-[#050b12] p-3 text-xs sm:text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 border border-zinc-800 resize-none shadow-inner"
              />
            </div>

            <div className="lg:col-span-4 flex flex-col justify-between space-y-3">
              <div className="space-y-2">
                <label className="block text-xs text-zinc-400 uppercase tracking-wider">
                  Source URL / Tx Hash:
                </label>
                <input
                  type="text"
                  value={sourceUrl}
                  onChange={(e) => setSourceUrl(e.target.value)}
                  placeholder="https://x.com/... or 0x7355..."
                  className="w-full rounded-xl bg-[#050b12] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/60 border border-zinc-800"
                />
              </div>

              <button
                onClick={handleVerify}
                disabled={isVerifying || !claimText.trim()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-cyan-500 py-3 text-xs font-bold text-zinc-950 hover:bg-cyan-400 active:scale-95 transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)] disabled:opacity-50 cursor-pointer"
              >
                <span>{isVerifying ? "⟳ VERIFYING ACROSS TRIAD..." : "▶ VERIFY CLAIM"}</span>
              </button>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* ③ LIVE VERIFICATION RESULT (Directly follows step 2) */}
        {/* ========================================================================= */}
        <div ref={verificationResultRef} className="space-y-3 font-mono-code">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-bold uppercase tracking-wider">
              ③ LIVE VERIFICATION RESULT
            </span>
            {isVerifying && (
              <span className="text-cyan-400 animate-pulse font-bold">
                ● STATUS: TRIAD PARALLEL INFERENCE ACTIVE...
              </span>
            )}
          </div>

          {/* Live In-Flight Progress Animation */}
          {isVerifying && (
            <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-500/60 shadow-xl space-y-4 animate-fadeIn">
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-300">1. Parsing extracted claims & entities:</span>
                  <span className="text-emerald-400 font-bold">✓ DONE</span>
                </div>
                  {liveModels.map((m, i) => (
                    <div key={m.name} className="flex items-center justify-between">
                      <span className="text-zinc-300 truncate pr-2">
                        {i + 2}. {m.name} returned a verdict:
                      </span>
                      <span className="text-emerald-400 font-bold whitespace-nowrap">
                        ✓ DONE ({m.score}%)
                      </span>
                    </div>
                  ))}

                  {liveModels.length < 3 &&
                    Array.from({ length: 3 - liveModels.length }).map((_, i) => (
                      <div key={`pending-${i}`} className="flex items-center justify-between">
                        <span className="text-zinc-300">
                          {liveModels.length + i + 2}. Awaiting a verdict:
                        </span>
                        <span className="text-cyan-400 animate-pulse">⟳ ANALYZING...</span>
                      </div>
                    ))}

                <div className="flex items-center justify-between">
                  <span className="text-zinc-300">5. Computing consensus concordance & policy check:</span>
                  <span className={verifyStep >= 5 ? "text-emerald-400 font-bold" : "text-zinc-500"}>
                    {verifyStep >= 5 ? "✓ FINALIZING" : "PENDING"}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Verification Final Result Card */}
          {!isVerifying && verifiedOutcome && (
            <div className="rounded-2xl bg-[#09111c] p-6 border border-cyan-950 shadow-xl space-y-5 animate-fadeIn">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
                <div>
                  <div className="text-xs text-zinc-400">Consensus Verdict</div>
                  <div
                    className={`text-xl font-bold mt-0.5 ${
                      verifiedOutcome.verdict === "REAL INCIDENT"
                        ? "text-red-400"
                        : verifiedOutcome.verdict === "FALSE ALARM"
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }`}
                  >
                    {verifiedOutcome.verdict}
                  </div>
                </div>

                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <div className="text-xs text-zinc-400">Truth Score</div>
                    <div className="text-2xl font-bold text-white">
                      {verifiedOutcome.truthScore}
                      <span className="text-xs text-zinc-500 font-normal"> / 100</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-zinc-400">Agreement</div>
                    <div className="text-2xl font-bold text-cyan-400">
                      {verifiedOutcome.agreement}%
                    </div>
                  </div>
                </div>
              </div>

              {/* Compact 3-Model Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {verifiedOutcome.models.map((m) => (
                  <div
                    key={m.name}
                    className="bg-[#050b12] p-3.5 rounded-xl border border-zinc-800/70 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-white">{m.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          m.stance === "REAL"
                            ? "bg-red-950 text-red-300"
                            : m.stance === "FAKE"
                            ? "bg-emerald-950 text-emerald-300"
                            : "bg-amber-950 text-amber-300"
                        }`}
                      >
                        {m.stance} ({m.score}%)
                      </span>
                    </div>
                    <div className="text-zinc-300 text-[11px] font-sans leading-relaxed">
                      {m.reason}
                    </div>
                  </div>
                ))}
              </div>

              {/* Resolution Action */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
                <div className="text-xs text-zinc-300 font-sans">
                  <strong>Resolution: </strong>
                  {verifiedOutcome.resolutionTrace}
                </div>

                <Link
                  href="/"
                  className="rounded-xl bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 px-4 py-2 text-xs font-mono-code font-bold whitespace-nowrap transition-all text-center"
                >
                  View Full Investigation in Dashboard →
                </Link>
              </div>
            </div>
          )}

          {/* Idle Placeholder */}
          {!isVerifying && !verifiedOutcome && (
            <div className="rounded-2xl bg-[#09111c] p-8 border border-zinc-800/60 text-center text-xs text-zinc-500 space-y-1">
              <div className="text-zinc-300 font-bold text-sm">NO VERIFICATION RUNNING</div>
              <div>Submit a claim above or select a preset to query the Gonka AI Triad.</div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* ④ EMERGENCY ACTIONS ⚠️ (Visually isolated danger container) */}
        {/* ========================================================================= */}
        <div className="rounded-2xl bg-gradient-to-b from-[#18080c] to-[#0d0407] p-6 border-l-4 border-red-500 shadow-xl space-y-4 font-mono-code">
          <div className="flex items-center justify-between border-b border-red-950 pb-3">
            <span className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center gap-2">
              <span>⚠️</span>
              <span>④ EMERGENCY ACTIONS</span>
            </span>
            <span className="bg-red-950 text-red-300 text-xs px-2.5 py-0.5 rounded font-bold border border-red-800/40">
              Immediate Interventions
            </span>
          </div>

          <p className="text-xs text-zinc-300 font-sans leading-relaxed">
            Emergency override actions to interrupt an active execution pipeline, abandon an open
            hedge, or resolve an active case.
          </p>
          {/*
            There is deliberately no "unwind" here. Measured on mainnet, a long
            put has no early exit on this venue and premium recovery is 0%, so a
            button claiming to broadcast an exit order would be describing a
            transaction that cannot exist.
          */}
          <p className="text-[11px] text-amber-300/80 font-sans leading-relaxed border-l-2 border-amber-700/50 pl-3">
            <span className="font-bold">Note.</span> An open hedge cannot be unwound early on this
            venue — there is no exit and no bid to sell into, so premium recovery is 0%.{" "}
            <span className="text-amber-200">Abandon</span> records the decision to stop protecting
            and lets the position lapse; it sends no transaction, because none is possible.
          </p>

          <div className="pt-1">
            <label className="block text-[10px] uppercase tracking-wider text-zinc-500 font-mono-code mb-1">
              Operator token — required by every action below
            </label>
            <input
              type="password"
              value={operatorToken}
              onChange={(e) => setOperatorToken(e.target.value)}
              placeholder="OPERATOR_TOKEN"
              className="w-full rounded-lg bg-[#050b12] border border-zinc-800 px-3 py-2 text-xs font-mono-code text-zinc-200 placeholder:text-zinc-600 focus:border-amber-700 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <button
              onClick={() => {
                // Local UI state only: this pauses what the operator sees. It
                // does not reach into a transaction already in flight, and it
                // does not claim to.
                setAgentStatus("PAUSED");
                showToast("🛑 AGENT PAUSED locally. An in-flight transaction cannot be recalled.");
              }}
              className="rounded-xl bg-red-950/90 hover:bg-red-900 text-red-300 p-3 border border-red-800/60 font-bold text-xs transition-all text-center cursor-pointer shadow-[0_0_12px_rgba(239,68,68,0.2)]"
            >
              🛑 PAUSE AGENT
            </button>
            <button
              onClick={async () => {
                // Real call. It abandons the oldest open position: records the
                // decision to stop protecting and lets it lapse. No transaction
                // is sent, because on this venue none is possible.
                try {
                  const list = await fetch("/api/positions?status=OPEN").then((r) => r.json());
                  const open = Array.isArray(list) ? list[0] : null;
                  if (!open) {
                    showToast("No open hedge to abandon.");
                    return;
                  }
                  const res = await fetch(`/api/hedge/${open.correlationId}/unwind`, {
                    method: "POST",
                    headers: {
                      "content-type": "application/json",
                      authorization: `Bearer ${operatorToken}`,
                    },
                    body: JSON.stringify({ reason: "ROLLBACK" }),
                  });
                  const data = await res.json();
                  if (!res.ok) {
                    showToast(`✕ ${data?.error?.code ?? res.status}: ${data?.error?.message ?? "failed"}`);
                    return;
                  }
                  showToast(
                    `⚑ ABANDONED ${open.asset} hedge — recovered ${data?.outcome?.recoveredUsdc ?? "0"} USDC, ` +
                      `no transaction sent. Realised ${data?.realisedPnlUsdc ?? "-"} USDC.`,
                  );
                } catch (e) {
                  showToast(`✕ ${e instanceof Error ? e.message : "request failed"}`);
                }
              }}
              className="rounded-xl bg-amber-950/90 hover:bg-amber-900 text-amber-300 p-3 border border-amber-800/60 font-bold text-xs transition-all text-center cursor-pointer"
              title="Records the decision to stop protecting. Sends no transaction — early exit is impossible on this venue."
            >
              ⚑ ABANDON HEDGE
            </button>
            <button
              onClick={() => {
                showToast("✓ CLOSE INVESTIGATION: Active case marked resolved.");
              }}
              className="rounded-xl bg-zinc-900 hover:bg-zinc-800 text-zinc-300 p-3 border border-zinc-700 font-bold text-xs transition-all text-center cursor-pointer"
            >
              ✕ CLOSE INVESTIGATION
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* ⑤ OPERATOR AUDIT TRAIL */}
        {/* ========================================================================= */}
        <div className="space-y-3 font-mono-code">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
              ⑤ OPERATOR AUDIT TRAIL
            </span>
            <span className="text-xs text-zinc-500">Recent Manual Verifications</span>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-[#09111c] shadow-md">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400 uppercase">
                  <th className="px-5 py-3">Claim</th>
                  <th className="px-5 py-3">Source</th>
                  <th className="px-5 py-3">Verdict</th>
                  <th className="px-5 py-3">Truth Score</th>
                  <th className="px-5 py-3">Logged</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/40 text-zinc-300">
                {history.map((item) => (
                  <tr key={item.id} className="hover:bg-zinc-900/50 transition-colors">
                    <td className="px-5 py-3 font-semibold text-white truncate max-w-xs">
                      {item.claim}
                    </td>
                    <td className="px-5 py-3 text-zinc-400">{item.source}</td>
                    <td className="px-5 py-3">
                      <span
                        className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                          item.verdict === "REAL"
                            ? "bg-red-950 text-red-300 border border-red-500/30"
                            : item.verdict === "FAKE"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-500/30"
                            : "bg-amber-950 text-amber-300 border border-amber-500/30"
                        }`}
                      >
                        {item.verdict}
                      </span>
                    </td>
                    <td className="px-5 py-3 font-bold text-white">{item.truthScore} / 100</td>
                    <td className="px-5 py-3 text-zinc-400">{item.timeAgo}</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => {
                          setClaimText(item.outcome.claim);
                          setVerifiedOutcome(item.outcome);
                        }}
                        className="text-cyan-400 hover:text-cyan-300 font-bold cursor-pointer"
                      >
                        Inspect Result
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </>
  );
}

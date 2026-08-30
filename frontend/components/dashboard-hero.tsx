"use client";

import { useState, useEffect, useRef } from "react";

type SimStep =
  | "IDLE"
  | "01_DETECT"
  | "02_INVESTIGATE"
  | "03_ANALYZE"
  | "04_CHALLENGE"
  | "05_DECIDE"
  | "06_PROTECT"
  | "COMPLETE";

interface RadarNode {
  id: string;
  time: string;
  title: string;
  source: string;
  risk: "LOW" | "REJECTED" | "INVESTIGATING" | "CRITICAL";
  score: number;
  desc: string;
  authorName: string;
  handle: string;
  platform: string;
  content: string;
  txHash?: string;
  resolution: string;
}

const INITIAL_RADAR_NODES: RadarNode[] = [
  {
    id: "node-1",
    time: "14:15",
    title: "Base RPC Telemetry Scan",
    source: "Base Mainnet Node",
    risk: "LOW",
    score: 6,
    desc: "Bridge contracts healthy. Zero velocity spike.",
    authorName: "Base RPC Sentinel",
    handle: "@base_node_rpc",
    platform: "On-Chain Sensor",
    content: "HEARTBEAT: Block 18492012 processed. Base Bridge TVL: $284.5M. Outflow velocity: 1.02x baseline (nominal). All withdrawal circuits active.",
    txHash: "0x194a...88df",
    resolution: "NutShell Verdict: HEALTHY — Routine telemetry cycle logged. No action needed.",
  },
  {
    id: "node-2",
    time: "14:24",
    title: "USDC Freeze Social Rumor",
    source: "Social Intelligence (X)",
    risk: "REJECTED",
    score: 18,
    desc: "Triad verified false alarm. No on-chain blacklisting.",
    authorName: "DeFi Firehose Alert",
    handle: "@defialerts_x",
    platform: "𝕏 / Social Intel",
    content: "⚠️ RUMOR: Circle reportedly freezing bridging contracts on Base network following regulatory compliance notice. Traders dumping bridged assets?",
    txHash: "0x334c...11aa",
    resolution: "NutShell Verdict: FALSE ALARM REJECTED — Contract bytecode verification confirms zero blacklist events. Gonka Triad: 99% False Alarm.",
  },
  {
    id: "node-3",
    time: "14:31",
    title: "DEX WETH Pool Rebalance",
    source: "Uniswap v3 Sensor",
    risk: "LOW",
    score: 12,
    desc: "Routine arbitrage liquidity shift within bounds.",
    authorName: "Uniswap Analytics Bot",
    handle: "@uni_pool_watcher",
    platform: "DEX Telemetry",
    content: "Pool Notice: WETH/USDC 0.05% pool experienced 450 ETH localized swap. Slippage peaked at 0.12% before automated market maker rebalancing.",
    txHash: "0x982f...cc41",
    resolution: "NutShell Verdict: CLEARED — Normal arbitrageur rebalancing. Slippage remained well beneath the 1.5% volatility trigger threshold.",
  },
  {
    id: "node-4",
    time: "14:36",
    title: "Whitehat Test Transfer",
    source: "Contract Monitor",
    risk: "LOW",
    score: 28,
    desc: "Small 2 ETH canary deposit. Authorized signature.",
    authorName: "Security Researcher",
    handle: "@whitehat_sec",
    platform: "Telegram / Webhook",
    content: "Notice: Executing scheduled multisig canary call on Base Bridge test fixture. 2.0 ETH migration test initiated to verify pause mechanics.",
    txHash: "0x55aa...3344",
    resolution: "NutShell Verdict: CLEARED — Verified authorized multi-sig timelock signature. No anomaly declared.",
  },
];

const STAGES = [
  {
    id: "01_DETECT",
    num: "01",
    name: "DETECT",
    question: "What happened?",
    summaryResult: "🚨 ChainWatch Security alert intercepted • Unusual Base Bridge outflow claim",
  },
  {
    id: "02_INVESTIGATE",
    num: "02",
    name: "INVESTIGATE",
    question: "What evidence do we have?",
    summaryResult: "🔍 $40.2M Outflow confirmed (16.8k ETH / 2 blocks) • Emergency pause triggered",
  },
  {
    id: "03_ANALYZE",
    num: "03",
    name: "ANALYZE",
    question: "What does each AI think?",
    summaryResult: "🤖 Gonka Triad: MiniMax (88% Real) • Kimi (68% Needs Evidence) • GLM (88% Real)",
  },
  {
    id: "04_CHALLENGE",
    num: "04",
    name: "CHALLENGE",
    question: "How was disagreement resolved?",
    summaryResult: "⚡ Base RPC confirmed pause followed drain immediately ➔ Kimi updated: 86% REAL ✓",
  },
  {
    id: "05_DECIDE",
    num: "05",
    name: "DECIDE",
    question: "What should the system do?",
    summaryResult: "🧠 Truth Score: 88/100 (Policy ≥85 Passed) • Budget: $2.15 ≤ $3.00 ➔ HEDGE_FULL APPROVED",
  },
  {
    id: "06_PROTECT",
    num: "06",
    name: "PROTECT",
    question: "What actually happened?",
    summaryResult: "🛡️ Protective Put Executed: ETH $2,400 Strike ($2.15 USDC) • Settled on Thetanuts (Base)",
  },
];

export function DashboardHero() {
  const [currentStep, setCurrentStep] = useState<SimStep>("IDLE");
  const [selectedNode, setSelectedNode] = useState<string>("node-live");
  const [openStages, setOpenStages] = useState<Record<string, boolean>>({});

  const [detectSearching, setDetectSearching] = useState<boolean>(true);
  const [step01Done, setStep01Done] = useState<boolean>(false);
  const [investigateSubstep, setInvestigateSubstep] = useState<number>(0);
  const [modelState, setModelState] = useState<{
    mm: "IDLE" | "THINKING" | "DONE";
    km: "IDLE" | "THINKING" | "DONE";
    glm: "IDLE" | "THINKING" | "DONE";
  }>({
    mm: "IDLE",
    km: "IDLE",
    glm: "IDLE",
  });
  const [challengePhase, setChallengePhase] = useState<"DISAGREEMENT" | "FETCHING" | "RESOLVED">("DISAGREEMENT");
  const [scoreProgress, setScoreProgress] = useState<number>(0);
  const [protectPhase, setProtectPhase] = useState<"LOCATING" | "SUBMITTING" | "FILLED">("LOCATING");

  const [lastScanSec, setLastScanSec] = useState<number>(2);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const investigationSectionRef = useRef<HTMLDivElement | null>(null);

  const isRunning = currentStep !== "IDLE" && currentStep !== "COMPLETE";
  const isThreatActive = currentStep !== "IDLE";

  useEffect(() => {
    const interval = setInterval(() => {
      setLastScanSec((prev) => (prev >= 6 ? 1 : prev + 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // During active simulation, auto-open currently active stage and smooth scroll down
  useEffect(() => {
    if (isRunning) {
      setOpenStages((prev) => ({
        ...prev,
        [currentStep]: true,
      }));

      // Smoothly scroll down to keep the active stage in view
      const timer = setTimeout(() => {
        const stageEl = document.getElementById(`stage-${currentStep}`);
        if (stageEl) {
          stageEl.scrollIntoView({ behavior: "smooth", block: "center" });
        } else if (investigationSectionRef.current) {
          investigationSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [currentStep, isRunning]);

  function toggleStage(stageId: string) {
    setOpenStages((prev) => ({
      ...prev,
      [stageId]: !prev[stageId],
    }));
  }

  function startLiveExecution() {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCurrentStep("01_DETECT");
    setSelectedNode("node-live");
    setOpenStages({ "01_DETECT": true });
    setDetectSearching(true);
    setStep01Done(false);
    setInvestigateSubstep(0);
    setModelState({ mm: "IDLE", km: "IDLE", glm: "IDLE" });
    setChallengePhase("DISAGREEMENT");
    setScoreProgress(0);
    setProtectPhase("LOCATING");

    // STEP 01: Searching pulse (1.3s) -> Post intercepted
    timerRef.current = setTimeout(() => {
      setDetectSearching(false);

      // Extract entities (1.1s)
      timerRef.current = setTimeout(() => {
        setStep01Done(true);

        // STEP 02: INVESTIGATE (0.4s pause)
        timerRef.current = setTimeout(() => {
          setCurrentStep("02_INVESTIGATE");
          setInvestigateSubstep(1);

          timerRef.current = setTimeout(() => {
            setInvestigateSubstep(2); // Outflow confirmed

            timerRef.current = setTimeout(() => {
              setInvestigateSubstep(3); // Pause confirmed

              timerRef.current = setTimeout(() => {
                setInvestigateSubstep(4); // Packet ready

                // STEP 03: ANALYZE (~4.5s)
                timerRef.current = setTimeout(() => {
                  setCurrentStep("03_ANALYZE");
                  setModelState({ mm: "THINKING", km: "THINKING", glm: "THINKING" });

                  timerRef.current = setTimeout(() => {
                    setModelState({ mm: "DONE", km: "THINKING", glm: "THINKING" });

                    timerRef.current = setTimeout(() => {
                      setModelState({ mm: "DONE", km: "DONE", glm: "THINKING" });

                      timerRef.current = setTimeout(() => {
                        setModelState({ mm: "DONE", km: "DONE", glm: "DONE" });

                        // STEP 04: CHALLENGE (~3.5s)
                        timerRef.current = setTimeout(() => {
                          setCurrentStep("04_CHALLENGE");
                          setChallengePhase("DISAGREEMENT");

                          timerRef.current = setTimeout(() => {
                            setChallengePhase("FETCHING");

                            timerRef.current = setTimeout(() => {
                              setChallengePhase("RESOLVED");

                              // STEP 05: DECIDE (~3.0s)
                              timerRef.current = setTimeout(() => {
                                setCurrentStep("05_DECIDE");
                                setScoreProgress(1);

                                timerRef.current = setTimeout(() => {
                                  setScoreProgress(2);

                                  timerRef.current = setTimeout(() => {
                                    setScoreProgress(3);

                                    timerRef.current = setTimeout(() => {
                                      setScoreProgress(4);

                                      // STEP 06: PROTECT (~3.0s)
                                      timerRef.current = setTimeout(() => {
                                        setCurrentStep("06_PROTECT");
                                        setProtectPhase("LOCATING");

                                        timerRef.current = setTimeout(() => {
                                          setProtectPhase("SUBMITTING");

                                          timerRef.current = setTimeout(() => {
                                            setProtectPhase("FILLED");
                                            setCurrentStep("COMPLETE");
                                          }, 1400);
                                        }, 1200);
                                      }, 800);
                                    }, 500);
                                  }, 500);
                                }, 500);
                              }, 800);
                            }, 1400);
                          }, 1200);
                        }, 800);
                      }, 1200);
                    }, 1300);
                  }, 1200);
                }, 600);
              }, 800);
            }, 800);
          }, 800);
        }, 400);
      }, 1100);
    }, 1300);
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const stepOrder = [
    "IDLE",
    "01_DETECT",
    "02_INVESTIGATE",
    "03_ANALYZE",
    "04_CHALLENGE",
    "05_DECIDE",
    "06_PROTECT",
    "COMPLETE",
  ];

  const currentIdx = stepOrder.indexOf(currentStep);

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. TOP HERO: AUTONOMOUS AGENT HEARTBEAT & KPI STRIP */}
      {/* ========================================================================= */}
      <div className="rounded-2xl bg-gradient-to-r from-[#070e17] via-[#09131f] to-[#06090e] p-5 border border-cyan-900/40 shadow-xl space-y-4 font-mono-code">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-cyan-950/80 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </div>
            <div>
              <div className="text-sm font-bold text-white tracking-wider flex items-center gap-2">
                <span>NUTSHELL AUTONOMOUS AGENT</span>
                <span className="text-[11px] bg-emerald-950 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-normal">
                  CONTINUOUS MONITORING ACTIVE
                </span>
              </div>
              <div className="text-xs text-zinc-400 font-sans mt-0.5">
                Protecting on-chain portfolios on Base Mainnet • Thetanuts Options Router
              </div>
            </div>
          </div>

          {/* Single Scenario Trigger Button */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => startLiveExecution()}
              disabled={isRunning}
              className="rounded-xl bg-gradient-to-r from-red-500 via-amber-500 to-emerald-400 px-5 py-2.5 text-xs font-black text-zinc-950 hover:opacity-90 active:scale-95 disabled:opacity-50 transition-all shadow-[0_0_20px_rgba(239,68,68,0.3)] cursor-pointer"
            >
              {isRunning ? "⚡ AUTONOMOUS RESOLUTION IN FLIGHT..." : "🧪 INJECT BRIDGE EXPLOIT SCENARIO"}
            </button>
          </div>
        </div>

        {/* Live Telemetry KPI Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div className="bg-[#09111c]/80 p-2.5 rounded-xl border border-cyan-950">
            <div className="text-zinc-400 text-[11px]">Target Network</div>
            <div className="text-xs font-bold text-white mt-0.5">Base Mainnet</div>
          </div>
          <div className="bg-[#09111c]/80 p-2.5 rounded-xl border border-cyan-950">
            <div className="text-zinc-400 text-[11px]">Last Scan</div>
            <div className="text-xs font-bold text-emerald-400 mt-0.5">{lastScanSec}s ago</div>
          </div>
          <div className="bg-[#09111c]/80 p-2.5 rounded-xl border border-cyan-950">
            <div className="text-zinc-400 text-[11px]">Signals Processed</div>
            <div className="text-xs font-bold text-white mt-0.5">24 today</div>
          </div>
          <div className="bg-[#09111c]/80 p-2.5 rounded-xl border border-cyan-950">
            <div className="text-zinc-400 text-[11px]">Threats Rejected</div>
            <div className="text-xs font-bold text-cyan-300 mt-0.5">23 cleared</div>
          </div>
          <div className="bg-[#09111c]/80 p-2.5 rounded-xl border border-cyan-950 col-span-2 sm:col-span-1">
            <div className="text-zinc-400 text-[11px]">Active Crisis</div>
            <div className="text-xs font-bold text-red-400 mt-0.5">
              {isThreatActive ? "1 ACTIVE (BASE BRIDGE)" : "0 (STANDBY)"}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. MAIN HERO: LIVE THREAT RADAR & SUSPICION INDEX TIMELINE (~60% VISUAL) */}
      {/* ========================================================================= */}
      <div className="rgb-liquid-border-lg">
        <div className="rounded-[calc(1.5rem-1.5px)] bg-gradient-to-b from-[#090e17] via-[#06090e] to-[#040609] p-6 shadow-2xl space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3.5">
          <div className="space-y-0.5">
            <div className="flex items-center gap-2 font-mono-code text-xs sm:text-sm font-bold text-white uppercase tracking-wider">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping"></span>
              <span>LIVE THREAT RADAR & SUSPICION TIMELINE</span>
            </div>
            <p className="text-xs text-zinc-400 font-sans">
              Click any timeline point below to inspect historical signal events.
            </p>
          </div>

          <div className="flex items-center gap-3 font-mono-code text-xs">
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> Normal (&lt;30)
            </span>
            <span className="flex items-center gap-1 text-amber-400">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400"></span> Elevated (30-84)
            </span>
            <span className="flex items-center gap-1 text-red-400">
              <span className="h-1.5 w-1.5 rounded-full bg-red-400"></span> Policy Breach (≥85)
            </span>
          </div>
        </div>

        {/* Visual Interactive Threat Suspicion Graph */}
        <div className="relative w-full h-52 bg-[#04070c] rounded-2xl p-4 border border-zinc-800/50 overflow-hidden">
          {/* Policy Breach Threshold Line (85) - Left-Aligned to prevent any text overlaps */}
          <div className="absolute top-[22%] left-0 right-0 border-b-2 border-dashed border-red-500/70 z-0 pointer-events-none flex justify-start px-4">
            <span className="text-[11px] font-mono-code font-bold text-red-300 bg-red-950/95 px-2.5 py-0.5 rounded-md border border-red-500/60 shadow-[0_0_12px_rgba(239,68,68,0.3)] -mt-3.5">
              🔴 HEDGE ACTION THRESHOLD: TRUTH SCORE ≥ 85
            </span>
          </div>

          {/* Background Grid Lines */}
          <div className="absolute inset-0 grid grid-rows-4 grid-cols-6 opacity-15 pointer-events-none">
            {Array.from({ length: 24 }).map((_, i) => (
              <div key={i} className="border-b border-r border-cyan-500"></div>
            ))}
          </div>

          {/* SVG Smooth Risk Curve */}
          <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 1000 200">
            <defs>
              <linearGradient id="curveGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={isThreatActive ? "#ef4444" : "#06b6d4"} stopOpacity="0.35" />
                <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
              </linearGradient>
            </defs>

            {/* Area under curve */}
            <path
              d={
                isThreatActive
                  ? "M 0,180 Q 200,170 300,150 T 600,165 T 850,140 Q 940,30 1000,24 L 1000,200 L 0,200 Z"
                  : "M 0,180 Q 200,170 300,150 T 600,165 T 850,140 Q 940,170 1000,175 L 1000,200 L 0,200 Z"
              }
              fill="url(#curveGradient)"
              className="transition-all duration-1000 ease-out"
            />

            {/* Main Dynamic Curve Line */}
            <path
              d={
                isThreatActive
                  ? "M 0,180 Q 200,170 300,150 T 600,165 T 850,140 Q 940,30 1000,24"
                  : "M 0,180 Q 200,170 300,150 T 600,165 T 850,140 Q 940,170 1000,175"
              }
              fill="none"
              stroke={isThreatActive ? "#ef4444" : "#06b6d4"}
              strokeWidth="3"
              className="transition-all duration-1000 ease-out"
            />
          </svg>

          {/* Interactive Radar Timeline Nodes */}
          <div className="absolute inset-0 flex items-end justify-between px-6 pb-4 pointer-events-none">
            {INITIAL_RADAR_NODES.map((node) => {
              const isSelected = selectedNode === node.id;
              return (
                <div
                  key={node.id}
                  onClick={() => setSelectedNode(node.id)}
                  className={`pointer-events-auto flex flex-col items-center group cursor-pointer transition-transform ${
                    isSelected ? "scale-125" : "hover:scale-110"
                  }`}
                  style={{ transform: `translateY(-${node.score * 1.3}px)` }}
                >
                  <div
                    className={`h-3.5 w-3.5 rounded-full border-2 transition-all flex items-center justify-center ${
                      isSelected
                        ? "bg-cyan-400 border-white ring-4 ring-cyan-400/40 shadow-[0_0_15px_rgba(6,182,212,0.8)]"
                        : node.risk === "REJECTED"
                        ? "bg-zinc-800 border-zinc-400 shadow-[0_0_8px_rgba(255,255,255,0.2)]"
                        : "bg-emerald-950 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.4)]"
                    }`}
                  >
                    <div className="h-1 w-1 rounded-full bg-white"></div>
                  </div>
                  <div
                    className={`text-[11px] font-mono-code font-bold mt-1 ${
                      isSelected ? "text-cyan-300 font-extrabold" : "text-zinc-400 group-hover:text-cyan-300"
                    }`}
                  >
                    {node.time}
                  </div>
                </div>
              );
            })}

            {/* LIVE PULSING NODE */}
            <div
              onClick={() => setSelectedNode("node-live")}
              className={`pointer-events-auto flex flex-col items-center group cursor-pointer transition-transform ${
                selectedNode === "node-live" ? "scale-115" : "hover:scale-110"
              }`}
              style={{ transform: isThreatActive ? "translateY(-155px)" : "translateY(-20px)" }}
            >
              <div
                className={`h-5 w-5 rounded-full border-2 transition-all flex items-center justify-center ${
                  isThreatActive
                    ? "bg-red-950 border-red-500 shadow-[0_0_25px_rgba(239,68,68,0.8)] ring-4 ring-red-500/30 animate-pulse"
                    : selectedNode === "node-live"
                    ? "bg-cyan-950 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.8)] ring-4 ring-cyan-400/30"
                    : "bg-emerald-950 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.5)] ring-2 ring-emerald-500/20"
                }`}
              >
                <div
                  className={`h-2 w-2 rounded-full ${
                    isThreatActive ? "bg-red-400 animate-ping" : selectedNode === "node-live" ? "bg-cyan-400" : "bg-emerald-400"
                  }`}
                ></div>
              </div>
              <div className="text-[11px] font-mono-code font-extrabold mt-1 text-white bg-zinc-900/90 px-2 py-0.5 rounded border border-zinc-700">
                {isThreatActive ? "NOW • SCORE 88 (CRISIS)" : "NOW • SCANNING (SCORE 4)"}
              </div>
            </div>
          </div>
        </div>

        {/* Selected Historical Node Summary Card */}
        {selectedNode !== "node-live" && (
          <div className="rounded-xl bg-[#09111c] p-4 border border-cyan-950 font-mono-code text-xs space-y-2 animate-fadeIn">
            {(() => {
              const node = INITIAL_RADAR_NODES.find((n) => n.id === selectedNode);
              if (!node) return null;
              return (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-white">{node.title}</span>
                      <span className="text-zinc-500 text-[11px]">({node.time} UTC)</span>
                      <span className="bg-zinc-800 text-zinc-300 text-[10px] px-2 py-0.5 rounded font-bold">{node.risk}</span>
                    </div>
                    <div className="text-xs text-zinc-300 font-sans">{node.desc}</div>
                    <div className="text-xs text-emerald-400">{node.resolution}</div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <div className="text-zinc-400 text-[11px]">Truth Score</div>
                    <div className="text-sm font-bold text-white">{node.score} / 100</div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 3. EVENT-DRIVEN INVESTIGATION PIPELINE: RESULT BLOCKS + ON-DEMAND EXPANSION */}
      {/* ========================================================================= */}
      {isThreatActive && (
        <div ref={investigationSectionRef} className="space-y-4 pt-2 animate-fadeIn">
          {/* Section Header & Stepper */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
            <div className="flex items-center gap-2 font-mono-code text-sm font-bold text-white">
              <span className="h-2.5 w-2.5 rounded-full bg-red-500 animate-ping"></span>
              <span>AUTONOMOUS INVESTIGATION PIPELINE</span>
              <span className="text-xs text-zinc-400 font-normal font-sans">(Click any stage to expand details)</span>
            </div>

            <div className="flex items-center gap-2 font-mono-code text-xs">
              <button
                onClick={() => {
                  const allOpen: Record<string, boolean> = {};
                  STAGES.forEach((s) => (allOpen[s.id] = true));
                  setOpenStages(allOpen);
                }}
                className="text-cyan-400 hover:text-cyan-300 cursor-pointer"
              >
                Expand All
              </button>
              <span className="text-zinc-600">|</span>
              <button
                onClick={() => setOpenStages({})}
                className="text-zinc-400 hover:text-zinc-300 cursor-pointer"
              >
                Collapse All
              </button>
            </div>
          </div>

          {/* Stepper Row */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 font-mono-code">
            {STAGES.map((s, idx) => {
              const stepIndex = idx + 1;
              const isPassed = currentIdx > stepIndex || currentStep === "COMPLETE";
              const isCurrent = currentIdx === stepIndex && currentStep !== "COMPLETE";
              const isExpanded = !!openStages[s.id];

              return (
                <button
                  key={s.id}
                  onClick={() => toggleStage(s.id)}
                  className={`rounded-xl p-2.5 border transition-all text-left cursor-pointer ${
                    isExpanded
                      ? "bg-cyan-950 border-cyan-400 text-cyan-300 ring-1 ring-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.3)]"
                      : isCurrent
                      ? "bg-[#111a26] border-cyan-500 text-cyan-300"
                      : isPassed
                      ? "bg-[#09121c] border-emerald-500/40 text-emerald-400 hover:bg-[#0d1a29]"
                      : "bg-[#070a0f] border-zinc-800/60 text-zinc-600 opacity-50"
                  }`}
                >
                  <div className="flex items-center justify-between font-bold text-xs">
                    <span>
                      {isCurrent ? "● " : isPassed ? "✓ " : "○ "}
                      {s.num} {s.name}
                    </span>
                    <span className="text-[10px] text-zinc-400">{isExpanded ? "▲" : "▼"}</span>
                  </div>
                  <div className="text-[11px] text-zinc-400 font-sans mt-0.5 truncate">
                    {isCurrent ? "Active..." : isPassed ? "Completed" : "Pending"}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Progressive Stage Cards */}
          <div className="space-y-3 pt-1">
            {STAGES.map((stage) => {
              const stepIndex = STAGES.findIndex((s) => s.id === stage.id) + 1;
              const isPassed = currentIdx > stepIndex || currentStep === "COMPLETE";
              const isCurrent = currentIdx === stepIndex && currentStep !== "COMPLETE";
              const isExpanded = !!openStages[stage.id];

              if (!isPassed && !isCurrent) return null; // Don't show future locked stages

              return (
                <div
                  key={stage.id}
                  id={`stage-${stage.id}`}
                  className={`rounded-2xl border transition-all overflow-hidden scroll-mt-24 ${
                    stage.id === "01_DETECT"
                      ? "border-l-4 border-l-red-500 bg-[#0c0608] border-zinc-800/80"
                      : stage.id === "04_CHALLENGE"
                      ? "border-l-4 border-l-amber-400 bg-[#0d0903] border-zinc-800/80"
                      : stage.id === "06_PROTECT"
                      ? "border-l-4 border-l-emerald-500 bg-[#040f0a] border-zinc-800/80"
                      : "border-l-4 border-l-cyan-400 bg-[#09111c] border-zinc-800/80"
                  }`}
                >
                  {/* RESULT BLOCK (Visible by default) */}
                  <div
                    onClick={() => toggleStage(stage.id)}
                    className="p-4 sm:p-5 flex items-center justify-between gap-4 cursor-pointer font-mono-code select-none hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm sm:text-base font-bold text-white flex items-center gap-1.5">
                        <span className={isCurrent ? "text-cyan-400" : "text-emerald-400"}>
                          {isCurrent ? "●" : "✓"}
                        </span>
                        <span>{stage.num} {stage.name}</span>
                      </span>
                      <span className="text-zinc-600">|</span>
                      <span className="text-xs text-zinc-400 font-sans hidden md:inline">
                        {stage.question}
                      </span>
                      <span className="text-zinc-600 hidden md:inline">•</span>
                      <span className="text-xs sm:text-sm text-zinc-200 font-sans font-medium truncate max-w-lg">
                        {stage.summaryResult}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 whitespace-nowrap">
                      <span className="text-xs font-bold text-cyan-400 hover:underline">
                        {isExpanded ? "Hide Details ▲" : "View Details ▼"}
                      </span>
                    </div>
                  </div>

                  {/* EXPANDED DETAILS (Unfolded when open) */}
                  {isExpanded && (
                    <div className="p-5 pt-0 border-t border-zinc-800/80 space-y-4 animate-fadeIn">
                      {/* ================= STAGE 01 DETAILS ================= */}
                      {stage.id === "01_DETECT" && (
                        <div className="pt-4">
                          {detectSearching ? (
                            <div className="bg-[#12080d] p-6 rounded-xl border border-red-900/30 flex flex-col items-center justify-center space-y-2 font-mono-code text-center">
                              <div className="flex items-center gap-2.5">
                                <span className="inline-block animate-spin text-red-400 text-xl">⟳</span>
                                <span className="text-base font-bold text-white">
                                  Searching web feeds & social intelligence...
                                </span>
                              </div>
                              <div className="text-xs text-zinc-400 animate-pulse">
                                NutShell Sentinel crawling Base Bridge social firehose for anomalies...
                              </div>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                              <div className="lg:col-span-8 rounded-xl bg-[#14171f] p-4 shadow-lg space-y-2.5 font-mono-code">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2.5">
                                    <div className="h-8 w-8 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-white">
                                      CW
                                    </div>
                                    <div>
                                      <div className="text-xs font-bold text-white flex items-center gap-1">
                                        <span>ChainWatch Security</span>
                                        <span className="text-cyan-400 text-[10px]">✓</span>
                                      </div>
                                      <div className="text-[11px] text-zinc-400">@chainwatch_sec • 12s ago</div>
                                    </div>
                                  </div>
                                  <span className="text-[11px] font-bold text-zinc-300 bg-zinc-800 px-2.5 py-0.5 rounded">
                                    𝕏 / Social Intel
                                  </span>
                                </div>
                                <p className="text-xs sm:text-sm text-zinc-100 font-sans leading-relaxed">
                                  🚨 <strong className="text-red-400">ALERT:</strong> Unusual activity detected involving the <strong>Base Bridge</strong>. Large ETH outflows have occurred across multiple transactions within a short period. We are investigating whether this represents an exploit or authorized activity.
                                </p>
                                <div className="flex items-center gap-3 text-xs text-cyan-400 pt-1">
                                  <span>Tx: 0x7355eb...b290 ↗</span>
                                  <span className="text-zinc-600">•</span>
                                  <span>Unconfirmed Signal (Ingested)</span>
                                </div>
                              </div>

                              <div className="lg:col-span-4 rounded-xl bg-[#161208] p-4 flex flex-col justify-between space-y-2 font-mono-code border border-amber-500/30">
                                <div className="space-y-1.5">
                                  <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                                    NutShell Ingestion Engine
                                  </div>
                                  <div className="text-xs text-zinc-300 font-sans leading-relaxed">
                                    Signal intercepted from X • Source reputation: <strong className="text-amber-200">MONITORED</strong>
                                  </div>
                                  <div className="text-xs text-zinc-400">
                                    Extracted entities: <strong className="text-zinc-200">Base Bridge</strong>, <strong className="text-zinc-200">ETH</strong>, <strong className="text-zinc-200">Abnormal Outflow</strong>
                                  </div>
                                </div>
                                <div className="pt-2 border-t border-amber-950 text-xs text-emerald-400">
                                  ✓ Ingestion complete. Dispatched on-chain telemetry scanner.
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* ================= STAGE 02 DETAILS ================= */}
                      {stage.id === "02_INVESTIGATE" && (
                        <div className="space-y-3 pt-4 font-mono-code">
                          {/* Agent Reasoning Notice */}
                          <div className="rounded-xl bg-[#09121d] p-3.5 border border-cyan-900/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2 text-zinc-300 font-sans">
                              <span className="text-cyan-400 font-bold font-mono-code">🤖 NutShell Agent:</span>
                              <span>&ldquo;The social media signal alone is insufficient. Dispatching on-chain investigation tool calls.&rdquo;</span>
                            </div>
                            <span className="text-cyan-300 font-bold bg-cyan-950 px-2 py-0.5 rounded border border-cyan-500/30">
                              3 / 3 Tool Calls Executed
                            </span>
                          </div>

                          {/* Tool Call 1: checkRecentTransactions */}
                          <div className="bg-[#070e17] p-3.5 rounded-xl space-y-1.5 border border-cyan-950">
                            <div className="flex items-center justify-between text-xs text-cyan-300">
                              <span className="font-bold flex items-center gap-2">
                                <span>🔧 TOOL CALL:</span>
                                <code className="bg-black/50 px-1.5 py-0.5 rounded text-cyan-200">
                                  checkRecentTransactions(target: &quot;Base_Bridge&quot;)
                                </code>
                              </span>
                              <span className="text-emerald-400 font-bold text-[11px]">✓ 2 BLOCKS SCANNED</span>
                            </div>
                            <div className="text-xs sm:text-sm text-zinc-200 pl-2 border-l-2 border-cyan-500/40">
                              → <strong>16,800 ETH ($40.2M)</strong> abnormal outflow detected across 2 blocks (<strong>4.2×</strong> above historical baseline).
                            </div>
                          </div>

                          {/* Tool Call 2: checkContractState */}
                          <div className="bg-[#070e17] p-3.5 rounded-xl space-y-1.5 border border-cyan-950">
                            <div className="flex items-center justify-between text-xs text-cyan-300">
                              <span className="font-bold flex items-center gap-2">
                                <span>🔧 TOOL CALL:</span>
                                <code className="bg-black/50 px-1.5 py-0.5 rounded text-cyan-200">
                                  checkContractState(contract: &quot;0x4904...BaseBridge&quot;)
                                </code>
                              </span>
                              <span className="text-red-400 font-bold text-[11px]">✓ PAUSE DETECTED</span>
                            </div>
                            <div className="text-xs sm:text-sm text-zinc-200 pl-2 border-l-2 border-red-500/40">
                              → Emergency withdrawal pause triggered. Contract state changed to <strong className="text-red-300">PAUSED</strong>.
                            </div>
                          </div>

                          {/* Tool Call 3: checkPoolSlippage */}
                          <div className="bg-[#070e17] p-3.5 rounded-xl space-y-1.5 border border-cyan-950">
                            <div className="flex items-center justify-between text-xs text-cyan-300">
                              <span className="font-bold flex items-center gap-2">
                                <span>🔧 TOOL CALL:</span>
                                <code className="bg-black/50 px-1.5 py-0.5 rounded text-cyan-200">
                                  checkPoolSlippage(pool: &quot;WETH/USDC-Base&quot;)
                                </code>
                              </span>
                              <span className="text-amber-400 font-bold text-[11px]">✓ IMBALANCE DETECTED</span>
                            </div>
                            <div className="text-xs sm:text-sm text-zinc-200 pl-2 border-l-2 border-amber-500/40">
                              → Secondary market DEX slippage surge detected. Liquidity pool imbalance confirmed.
                            </div>
                          </div>

                          {/* Evidence Packet Ready Badge */}
                          <div className="rounded-xl bg-[#06140e] p-3 border border-emerald-500/30 flex items-center justify-between text-xs text-emerald-300">
                            <span className="flex items-center gap-2">
                              <span>📦</span>
                              <span><strong>Investigation Packet Complete:</strong> Compiled on-chain proofs & timestamps.</span>
                            </span>
                            <span className="font-bold">Ready for Triad Verification ➔</span>
                          </div>
                        </div>
                      )}

                      {/* ================= STAGE 03 DETAILS ================= */}
                      {stage.id === "03_ANALYZE" && (
                        <div className="space-y-4 pt-4">
                          <div className="bg-[#070e17] p-4 rounded-xl space-y-2 font-mono-code">
                            <div className="flex justify-between items-center text-xs font-bold text-cyan-300">
                              <span>📨 INVESTIGATION PACKET SENT SIMULTANEOUSLY TO ALL 3 MODELS</span>
                              <span className="text-zinc-400 font-normal text-xs">Task: Real Incident vs False Alarm</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-zinc-300">
                              <div><strong className="text-emerald-400">🟢 On-Chain: </strong>$40.2M ETH across 2 blocks</div>
                              <div><strong className="text-amber-400">🟡 Contract: </strong>Emergency pause active</div>
                              <div><strong className="text-cyan-400">🔵 Market: </strong>WETH/USDC imbalance</div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 font-mono-code">
                            {/* MiniMax */}
                            <div className="bg-[#0e1622] p-4 rounded-xl space-y-2.5 flex flex-col justify-between">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-bold text-white">🤖 MiniMax</span>
                                  <span className="text-red-400 font-bold bg-red-950 px-2 py-0.5 rounded text-xs">REAL INCIDENT • 88%</span>
                                </div>
                                <div className="text-xs text-zinc-200 font-sans leading-relaxed">
                                  <strong className="font-mono-code text-zinc-400 uppercase text-[10px] block mb-0.5">Primary Finding</strong>
                                  &ldquo;Transaction velocity is significantly abnormal compared with historical bridge activity.&rdquo;
                                </div>
                              </div>
                              <div className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
                                Evidence: Velocity & destination pattern
                              </div>
                            </div>

                            {/* Kimi */}
                            <div className="bg-[#0e1622] p-4 rounded-xl space-y-2.5 flex flex-col justify-between">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-bold text-white">🤖 Kimi</span>
                                  <span className="text-amber-400 font-bold bg-amber-950 px-2 py-0.5 rounded text-xs">NEEDS EVIDENCE • 68%</span>
                                </div>
                                <div className="text-xs text-zinc-200 font-sans leading-relaxed">
                                  <strong className="font-mono-code text-zinc-400 uppercase text-[10px] block mb-0.5">Primary Finding</strong>
                                  &ldquo;The pattern could potentially represent a scheduled treasury migration.&rdquo;
                                </div>
                                <div className="text-xs text-amber-200 bg-amber-950/50 p-2 rounded">
                                  <strong className="font-mono-code uppercase text-[10px] block text-amber-400">Requested Evidence</strong>
                                  Verify whether emergency pause followed the outflow.
                                </div>
                              </div>
                              <div className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
                                Evidence: Historical treasury records
                              </div>
                            </div>

                            {/* GLM */}
                            <div className="bg-[#0e1622] p-4 rounded-xl space-y-2.5 flex flex-col justify-between">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-bold text-white">🤖 GLM</span>
                                  <span className="text-red-400 font-bold bg-red-950 px-2 py-0.5 rounded text-xs">REAL INCIDENT • 88%</span>
                                </div>
                                <div className="text-xs text-zinc-200 font-sans leading-relaxed">
                                  <strong className="font-mono-code text-zinc-400 uppercase text-[10px] block mb-0.5">Primary Finding</strong>
                                  &ldquo;An emergency pause occurring immediately after abnormal outflows strongly correlates with a security incident.&rdquo;
                                </div>
                              </div>
                              <div className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800">
                                Evidence: Multi-sig contract pause event
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ================= STAGE 04 DETAILS ================= */}
                      {stage.id === "04_CHALLENGE" && (
                        <div className="bg-[#0b0802] p-4 rounded-xl space-y-3 font-mono-code text-xs pt-4 border border-amber-900/40">
                          <div className="space-y-1">
                            <div className="text-amber-400 font-bold uppercase text-[11px]">Kimi Evidence Request</div>
                            <div className="text-sm text-zinc-100 font-sans">
                              &ldquo;Verify whether the emergency pause was triggered after the abnormal outflow.&rdquo;
                            </div>
                          </div>

                          <div className="bg-[#140e05] p-3 rounded-lg space-y-1">
                            <div className="text-amber-400 font-bold uppercase text-[10px]">NutShell Controller Action</div>
                            <div className="text-zinc-300 text-xs font-sans">
                              {challengePhase === "RESOLVED" ? (
                                <span className="text-emerald-400 font-semibold">
                                  ✓ Base RPC Confirmed: Emergency pause occurred immediately following the $40.2M outflow. Zero scheduled migration records found.
                                </span>
                              ) : (
                                <span className="text-amber-300 animate-pulse">
                                  Querying Base RPC node for block-level event timestamp correlation...
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-amber-950">
                            <div className="text-zinc-300 text-xs font-sans">
                              Kimi re-evaluated the claim with verified pause telemetry:
                            </div>
                            <div>
                              {challengePhase === "RESOLVED" ? (
                                <span className="bg-emerald-950 text-emerald-300 px-3 py-1 rounded text-xs font-bold font-mono-code">
                                  KIMI UPDATED: UNCERTAIN (68%) ➔ REAL (86%) ✓
                                </span>
                              ) : (
                                <span className="text-amber-300 text-xs animate-pulse">Updating inference...</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ================= STAGE 05 DETAILS ================= */}
                      {stage.id === "05_DECIDE" && (
                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-center font-mono-code text-xs pt-4">
                          <div className="lg:col-span-7 space-y-2">
                            <div className="flex justify-between text-zinc-300">
                              <span>On-chain abnormal outflow ($40.2M)</span>
                              <span className={scoreProgress >= 1 ? "text-cyan-300 font-bold" : "text-zinc-600"}>
                                {scoreProgress >= 1 ? "██████████ +35" : "⟳"}
                              </span>
                            </div>
                            <div className="flex justify-between text-zinc-300">
                              <span>Emergency pause contract verification</span>
                              <span className={scoreProgress >= 2 ? "text-cyan-300 font-bold" : "text-zinc-600"}>
                                {scoreProgress >= 2 ? "█████████ +30" : "⟳"}
                              </span>
                            </div>
                            <div className="flex justify-between text-zinc-300">
                              <span>3/3 AI consensus concordance</span>
                              <span className={scoreProgress >= 3 ? "text-cyan-300 font-bold" : "text-zinc-600"}>
                                {scoreProgress >= 3 ? "████ +15" : "⟳"}
                              </span>
                            </div>
                            <div className="flex justify-between text-zinc-300">
                              <span>Secondary market impact & slippage</span>
                              <span className={scoreProgress >= 4 ? "text-cyan-300 font-bold" : "text-zinc-600"}>
                                {scoreProgress >= 4 ? "███ +8" : "⟳"}
                              </span>
                            </div>
                          </div>

                          <div className="lg:col-span-5 bg-[#0e1622] p-4 rounded-xl space-y-2 text-center">
                            <div className="text-3xl font-black text-white">
                              <span className="text-red-400">{scoreProgress >= 4 ? "88" : "..."}</span>
                              <span className="text-zinc-500 text-base"> / 100</span>
                            </div>
                            <div className="text-[10px] uppercase font-bold text-zinc-400">Total Truth Score</div>
                            <div className="pt-2 border-t border-zinc-800 space-y-1 text-[11px] text-zinc-300 text-left">
                              <div className="flex justify-between"><span>Policy Threshold (≥85):</span><span className="text-emerald-400 font-bold">✓ Exceeded (88)</span></div>
                              <div className="flex justify-between"><span>Trade Ceiling ($3.00):</span><span className="text-emerald-400 font-bold">✓ Approved ($2.15)</span></div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* ================= STAGE 06 DETAILS ================= */}
                      {stage.id === "06_PROTECT" && (
                        <div className="bg-[#05140d] p-4 rounded-xl space-y-3 font-mono-code text-xs pt-4 border border-emerald-900/50">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-emerald-950 pb-2">
                            <div>
                              <div className="text-base font-bold text-white">
                                ✓ Protective Hedge Active: ETH $2,400 Put Option
                              </div>
                              <div className="text-zinc-400 text-[11px] font-sans">
                                7-Day Expiry • Settled on Thetanuts OptionBook (Base Mainnet)
                              </div>
                            </div>
                            <span className="bg-emerald-950 text-emerald-300 px-3 py-1 rounded text-xs font-bold border border-emerald-500/40">
                              BROADCAST CONFIRMED
                            </span>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 pt-1 text-zinc-200 text-xs">
                            <div>Premium Cost: <strong className="text-amber-300">$2.15 USDC</strong></div>
                            <div>Protected Downside: <strong className="text-white">~$2,443.00 ETH</strong></div>
                            <div className="col-span-2 md:col-span-1 text-right text-zinc-400 text-[11px]">
                              Zero manual intervention required
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

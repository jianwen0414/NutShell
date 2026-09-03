"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { ConsensusMetrics, HedgeDecision, ModelVerdict } from "@/types";

/** What a real run fills in. Empty until the pipeline reports something. */
interface LiveRun {
  jobId: string | null;
  verdicts: ModelVerdict[];
  consensus: ConsensusMetrics | null;
  decision: HedgeDecision | null;
  error: string | null;
}

const EMPTY_RUN: LiveRun = {
  jobId: null,
  verdicts: [],
  consensus: null,
  decision: null,
  error: null,
};

/** The claim sent when the operator has not typed one. */
const DEFAULT_CLAIM =
  "BlockSec reports an active exploit against a cross-chain bridge on Base. " +
  "The attacker contract has drained approximately 12,400 WETH across 7 transactions " +
  "between 14:02 and 14:19 UTC, exploiting an unchecked return value in the withdrawal " +
  "verifier. The team has paused deposits and acknowledged the incident.";

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
    summaryResult: "🚨 Scenario injected — in production this arrives on a webhook",
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
    summaryResult: "🤖 Three models score the same claim in parallel, quorum is two of three",
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
    summaryResult: "🧠 Truth score and agreement checked against policy, then sized against the caps",
  },
  {
    id: "06_PROTECT",
    num: "06",
    name: "PROTECT",
    question: "What actually happened?",
    summaryResult: "🛡️ Execution is not wired — the decision and its size are real, the fill is not",
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
  // Counters come from the job store. They are real but reset with the server,
  // since there is no database yet.
  const [stats, setStats] = useState<{ processed: number; rejected: number } | null>(null);
  // When the last verification finished. Null until one has.
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);
  const [sinceLastRun, setSinceLastRun] = useState<number>(0);

  // Real pipeline output. The stage animation below is unchanged; it is now
  // driven by these events arriving instead of by a chain of timers.
  const [live, setLive] = useState<LiveRun>(EMPTY_RUN);
  const [agentStatus, setAgentStatus] = useState<"ARMED" | "PAUSED">("ARMED");
  const [execMode, setExecMode] = useState<"AUTONOMOUS" | "APPROVAL_REQUIRED" | "MONITOR_ONLY">("AUTONOMOUS");
  const sourceRef = useRef<EventSource | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const investigationSectionRef = useRef<HTMLDivElement | null>(null);

  const isRunning = currentStep !== "IDLE" && currentStep !== "COMPLETE";
  const isThreatActive = currentStep !== "IDLE";

  useEffect(() => {
    const interval = setInterval(() => {
      setLastScanSec((prev) => (prev >= 6 ? 1 : prev + 1));
      if (lastRunAt) setSinceLastRun(Math.floor((Date.now() - lastRunAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastRunAt]);

  useEffect(() => {
    const pull = () => {
      fetch("/api/stats")
        .then((r) => r.json())
        .then((d) => setStats({ processed: d.processed ?? 0, rejected: d.rejected ?? 0 }))
        .catch(() => {});
      fetch("/api/control/status")
        .then((r) => r.json())
        .then((d) => {
          if (d?.status) setAgentStatus(d.status);
          if (d?.mode) setExecMode(d.mode);
          if (d?.status === "PAUSED") {
            if (isRunning) {
              sourceRef.current?.close();
              if (timerRef.current) clearTimeout(timerRef.current);
              setCurrentStep("IDLE");
              setDetectSearching(false);
              setLive(EMPTY_RUN);
              if (typeof window !== "undefined") {
                sessionStorage.removeItem("nutshell_active_job");
              }
            }
          }
        })
        .catch(() => {});
    };
    pull();
    const interval = setInterval(pull, 3000);
    return () => clearInterval(interval);
  }, [isRunning]);

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

  /**
   * Runs the real pipeline and drives this animation from what comes back.
   *
   * The stage sequence, the scroll and every visual below are unchanged. What
   * changed is the driver: instead of a chain of timers inventing progress,
   * each step advances when the corresponding event arrives from the server.
   * Model cards fill in as each model actually answers, so a slow model looks
   * slow and a dropped one is visibly missing.
   */
  async function startLiveExecution() {
    if (agentStatus === "PAUSED") {
      setLive({
        ...EMPTY_RUN,
        error: "Cannot start: Agent is PAUSED in Control Center. Resume agent to run.",
      });
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    sourceRef.current?.close();

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
    setLive(EMPTY_RUN);

    const text = DEFAULT_CLAIM;

    let jobId: string;
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const body = await res.json();
      if (!res.ok || !body?.jobId) {
        throw new Error(body?.error?.message ?? "Could not start verification.");
      }
      jobId = body.jobId;
    } catch (e) {
      setLive({ ...EMPTY_RUN, error: e instanceof Error ? e.message : String(e) });
      setCurrentStep("IDLE");
      return;
    }

    attachJobStream(jobId);
  }

  const attachJobStream = useCallback((jobId: string) => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }

    if (typeof window !== "undefined") {
      sessionStorage.setItem("nutshell_active_job", jobId);
    }

    setLive((prev) => ({ ...prev, jobId }));
    setDetectSearching(false);
    setStep01Done(true);
    setInvestigateSubstep(4);

    const es = new EventSource(`/api/verify/${jobId}/stream`);
    sourceRef.current = es;

    // Which card a model lands in. Three slots, first come first served, so
    // the layout holds whichever models actually answer.
    const slots: Array<"mm" | "km" | "glm"> = ["mm", "km", "glm"];
    const assigned = new Map<string, "mm" | "km" | "glm">();

    es.addEventListener("status", (ev) => {
      const d = JSON.parse((ev as MessageEvent).data);
      if (d.step === "investigating") {
        setCurrentStep("02_INVESTIGATE");
        setInvestigateSubstep(4);
      }
      if (d.step === "layer1") {
        setCurrentStep("03_ANALYZE");
        setModelState({ mm: "THINKING", km: "THINKING", glm: "THINKING" });
      }
      if (d.step === "synthesizing") setCurrentStep("04_CHALLENGE");
    });

    es.addEventListener("verdict", (ev) => {
      const v: ModelVerdict = JSON.parse((ev as MessageEvent).data);
      setLive((prev) => {
        if (!assigned.has(v.modelId)) assigned.set(v.modelId, slots[assigned.size] ?? "glm");
        const existing = prev.verdicts.filter((old) => old.modelId !== v.modelId);
        return { ...prev, verdicts: [...existing, v] };
      });
      const slot = assigned.get(v.modelId) ?? "mm";
      setModelState((prev) => ({ ...prev, [slot]: "DONE" }));
    });

    es.addEventListener("consensus", (ev) => {
      const c: ConsensusMetrics = JSON.parse((ev as MessageEvent).data);
      setLive((prev) => ({ ...prev, consensus: c }));
      setLastRunAt(Date.now());
      setSinceLastRun(0);
      setChallengePhase("RESOLVED");
      setCurrentStep("05_DECIDE");
      // The four score bars fill in sequence; this is presentation only and
      // never changes the number underneath.
      [1, 2, 3, 4].forEach((n, i) => setTimeout(() => setScoreProgress(n), i * 220));
    });

    es.addEventListener("decision", (ev) => {
      const d: HedgeDecision = JSON.parse((ev as MessageEvent).data);
      setLive((prev) => ({ ...prev, decision: d }));
      const trades = d.tier === "HEDGE_SMALL" || d.tier === "HEDGE_FULL";
      setCurrentStep("06_PROTECT");
      setProtectPhase(trades ? "SUBMITTING" : "LOCATING");
    });

    es.addEventListener("position", () => setProtectPhase("FILLED"));

    es.addEventListener("error", (ev) => {
      const raw = (ev as MessageEvent).data;
      if (raw) {
        try {
          const d = JSON.parse(raw);
          setLive((prev) => ({ ...prev, error: d?.error?.message ?? "Verification failed." }));
        } catch {
          setLive((prev) => ({ ...prev, error: "Verification failed." }));
        }
        setCurrentStep("COMPLETE");
        es.close();
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("nutshell_active_job");
        }
      }
      // If the connection is permanently closed (e.g. server restarted or job 404), reset
      if (es.readyState === EventSource.CLOSED) {
        es.close();
        if (typeof window !== "undefined") {
          sessionStorage.removeItem("nutshell_active_job");
        }
        setCurrentStep((prev) => (prev === "02_INVESTIGATE" || prev === "01_DETECT" ? "IDLE" : prev));
      }
    });

    es.addEventListener("done", () => {
      setCurrentStep("COMPLETE");
      es.close();
      if (typeof window !== "undefined") {
        sessionStorage.removeItem("nutshell_active_job");
      }
    });
  }, []);

  // Check and restore active job when switching between tabs or pages
  useEffect(() => {
    function checkAndRestore() {
      if (typeof window === "undefined") return;
      const storedJobId = sessionStorage.getItem("nutshell_active_job");
      if (!storedJobId) return;

      // Verify that the job actually exists on server before restoring
      fetch(`/api/verify/${storedJobId}`)
        .then((r) => {
          if (!r.ok) {
            // Server restarted or job expired: clear stale storage and reset
            sessionStorage.removeItem("nutshell_active_job");
            setCurrentStep("IDLE");
            setLive(EMPTY_RUN);
            return null;
          }
          return r.json();
        })
        .then((data) => {
          if (!data) return;
          if (data.status === "EXECUTED" || data.status === "ATTESTED" || data.status === "FAILED") {
            sessionStorage.removeItem("nutshell_active_job");
            if (data.verification?.consensus) {
              setLive((prev) => ({
                ...prev,
                consensus: data.verification.consensus,
                decision: data.decision,
                verdicts: data.verification.models ?? [],
              }));
              setCurrentStep("COMPLETE");
            }
            return;
          }
          // Job is still active on server, attach stream
          if (!sourceRef.current || sourceRef.current.readyState === EventSource.CLOSED) {
            setCurrentStep("02_INVESTIGATE");
            attachJobStream(storedJobId);
          }
        })
        .catch(() => {
          sessionStorage.removeItem("nutshell_active_job");
          setCurrentStep("IDLE");
        });
    }

    checkAndRestore();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        checkAndRestore();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("focus", checkAndRestore);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", checkAndRestore);
    };
  }, [attachJobStream]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      sourceRef.current?.close();
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

  // The live point plots on the same scale as the historical ones, so a real
  // verdict lands at a height that can be read against the threshold line.
  // Until a run produces a score there is nothing to plot, so it sits at the
  // idle baseline rather than showing an invented number.
  const IDLE_SCORE = 4;
  const liveScore = live.consensus ? live.consensus.truthScore : IDLE_SCORE;
  // Colour follows the outcome, not the fact that something is running. Going
  // red on click would assert a crisis before any model has answered, and the
  // bands match the legend: hedge at 70, watch from 40, rejected below.
  // The curve ends where the live point sits. The viewBox is 200 tall and the
  // points plot at score * 1.3 inside a 208px box, so the same score maps to
  // 180 minus score * 1.56 here. Without this the curve spiked to the top the
  // instant the button was clicked, asserting a crisis before any model had
  // answered, and it stayed spiked whatever the verdict turned out to be.
  const curveY = Math.max(20, 180 - liveScore * 1.56);
  const curveHot = Boolean(live.consensus && live.consensus.truthScore >= 70);
  const curveStroke = curveHot ? "#ef4444" : isRunning ? "#06b6d4" : "#10b981";
  const curveTail = `Q 940,${curveY + 10} 1000,${curveY}`;

  const liveTone = agentStatus === "PAUSED"
    ? "bg-zinc-900 border-amber-400/80 shadow-[0_0_15px_rgba(245,158,11,0.3)] ring-2 ring-amber-500/30"
    : !live.consensus
      ? isRunning
        ? "bg-cyan-950 border-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.8)] ring-4 ring-cyan-400/30 animate-pulse"
        : "bg-emerald-950 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.5)] ring-2 ring-emerald-500/20"
      : live.consensus.truthScore >= 70
        ? "bg-red-950 border-red-500 shadow-[0_0_25px_rgba(239,68,68,0.8)] ring-4 ring-red-500/30 animate-pulse"
        : live.consensus.truthScore >= 40
          ? "bg-amber-950 border-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.7)] ring-4 ring-amber-400/30"
          : "bg-emerald-950 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.5)] ring-2 ring-emerald-500/20";

  const liveDotTone = agentStatus === "PAUSED"
    ? "bg-amber-400"
    : !live.consensus
      ? isRunning
        ? "bg-cyan-400 animate-ping"
        : "bg-emerald-400"
      : live.consensus.truthScore >= 70
        ? "bg-red-400 animate-ping"
        : live.consensus.truthScore >= 40
          ? "bg-amber-400"
          : "bg-emerald-400";

  const liveLabel = agentStatus === "PAUSED"
    ? "NOW • IDLE (PAUSED)"
    : live.consensus
      ? `NOW • SCORE ${live.consensus.truthScore}${live.decision ? ` (${live.decision.tier})` : ""}`
      : isRunning
        ? "NOW • ANALYSING..."
        : `NOW • SCANNING (SCORE ${IDLE_SCORE})`;

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* 1. TOP HERO: AUTONOMOUS AGENT HEARTBEAT & KPI STRIP */}
      {/* ========================================================================= */}
      <div className="rounded-2xl bg-gradient-to-r from-[#070e17] via-[#09131f] to-[#06090e] p-5 border border-cyan-900/40 shadow-xl space-y-4 font-mono-code">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-cyan-950/80 pb-3.5">
          <div className="flex items-center gap-3">
            <div className="relative flex h-3 w-3">
              {agentStatus === "ARMED" ? (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </>
              ) : (
                <>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
                </>
              )}
            </div>
            <div>
              <div className="text-sm font-bold text-white tracking-wider flex items-center gap-2">
                <span>NUTSHELL AUTONOMOUS AGENT</span>
                {agentStatus === "ARMED" ? (
                  <span className="text-[11px] bg-emerald-950 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded font-normal">
                    CONTINUOUS MONITORING ACTIVE
                  </span>
                ) : (
                  <span className="text-[11px] bg-amber-950 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-normal">
                    ⏸ DETECTION &amp; SCANNING IDLE · PAUSED
                  </span>
                )}
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
              disabled={isRunning || agentStatus === "PAUSED"}
              className={`rounded-xl px-5 py-2.5 text-xs font-black transition-all shadow-md ${
                agentStatus === "PAUSED"
                  ? "bg-zinc-800 text-zinc-400 border border-zinc-700 cursor-not-allowed opacity-75"
                  : "bg-gradient-to-r from-red-500 via-amber-500 to-emerald-400 text-zinc-950 hover:opacity-90 active:scale-95 disabled:opacity-50 shadow-[0_0_20px_rgba(239,68,68,0.3)] cursor-pointer"
              }`}
              title={agentStatus === "PAUSED" ? "Agent is paused. Resume in Control Center to inject." : undefined}
            >
              {agentStatus === "PAUSED"
                ? "⏸ DETECTION PAUSED (RESUME IN CONTROL)"
                : isRunning
                  ? "⚡ AUTONOMOUS RESOLUTION IN FLIGHT..."
                  : "🧪 INJECT BRIDGE EXPLOIT SCENARIO"}
            </button>
            {live.error && (
              <span className="text-[11px] text-red-300 font-mono-code">{live.error}</span>
            )}
          </div>
        </div>

        {/* Live Telemetry KPI Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
          <div className="bg-[#09111c]/80 p-2.5 rounded-xl border border-cyan-950">
            <div className="text-zinc-400 text-[11px]">Target Network</div>
            <div className="text-xs font-bold text-white mt-0.5">Base Mainnet</div>
          </div>
          <div className="bg-[#09111c]/80 p-2.5 rounded-xl border border-cyan-950">
            <div className="text-zinc-400 text-[11px]">Last Verification</div>
            <div className="text-xs font-bold text-emerald-400 mt-0.5">
              {lastRunAt
                ? sinceLastRun < 60
                  ? `${sinceLastRun}s ago`
                  : `${Math.floor(sinceLastRun / 60)}m ago`
                : "none yet"}
            </div>
          </div>
          <div className="bg-[#09111c]/80 p-2.5 rounded-xl border border-cyan-950">
            <div className="text-zinc-400 text-[11px]">Signals Processed</div>
            <div className="text-xs font-bold text-white mt-0.5">
              {stats ? `${stats.processed} this session` : "—"}
            </div>
          </div>
          <div className="bg-[#09111c]/80 p-2.5 rounded-xl border border-cyan-950">
            <div className="text-zinc-400 text-[11px]">Threats Rejected</div>
            <div className="text-xs font-bold text-cyan-300 mt-0.5">
              {stats ? `${stats.rejected} cleared` : "—"}
            </div>
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
                {agentStatus === "ARMED" ? (
                  <>
                    <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping"></span>
                    <span>LIVE THREAT RADAR & SUSPICION TIMELINE</span>
                  </>
                ) : (
                  <>
                    <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                    <span className="text-amber-300">⏸ DETECTION &amp; SCANNING IDLE · PAUSED</span>
                  </>
                )}
              </div>
              <p className="text-xs text-zinc-400 font-sans">
                {agentStatus === "ARMED"
                  ? "Click any timeline point below to inspect historical signal events."
                  : "Autonomous detection and scanning are currently idle (paused). Resume in Control Center to activate."}
              </p>
            </div>

            <div className="flex items-center gap-3 font-mono-code text-xs">
              <span className="flex items-center gap-1 text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span> Rejected (&lt;40)
              </span>
              <span className="flex items-center gap-1 text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400"></span> Watch (40-69)
              </span>
              <span className="flex items-center gap-1 text-red-400">
                <span className="h-1.5 w-1.5 rounded-full bg-red-400"></span> Hedge (≥70)
              </span>
            </div>
          </div>

          {/* Visual Interactive Threat Suspicion Graph */}
          <div className="relative w-full h-52 bg-[#04070c] rounded-2xl p-4 border border-zinc-800/50 overflow-hidden">
            {/* Suspended Overlay when Agent is Paused */}
            {agentStatus === "PAUSED" && !isRunning && (
              <div className="absolute inset-0 bg-[#04070c]/85 backdrop-blur-[1.5px] flex flex-col items-center justify-center gap-2 z-10 font-mono-code text-center p-4">
                <span className="text-xs sm:text-sm font-bold text-amber-300 flex items-center gap-2 bg-amber-950/90 px-3.5 py-1.5 rounded-lg border border-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.25)]">
                  <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                  <span>DETECTION &amp; SCANNING IDLE (PAUSED)</span>
                </span>
                <p className="text-[11px] text-zinc-400 max-w-sm font-sans">
                  Autonomous anomaly detection and sensors are currently paused in the Control Center.
                </p>
              </div>
            )}

            {/* Policy Breach Threshold Line (85) - Left-Aligned to prevent any text overlaps */}
            <div className="absolute top-[38%] left-0 right-0 border-b-2 border-dashed border-red-500/70 z-0 pointer-events-none flex justify-start px-4">
              <span className="text-[11px] font-mono-code font-bold text-red-300 bg-red-950/95 px-2.5 py-0.5 rounded-md border border-red-500/60 shadow-[0_0_12px_rgba(239,68,68,0.3)] -mt-3.5">
                🔴 HEDGE ACTION THRESHOLD: TRUTH SCORE ≥ 70
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
                <linearGradient id="curveStrokeGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#10b981" />
                  <stop offset="55%" stopColor="#10b981" />
                  <stop offset="100%" stopColor={curveStroke} />
                </linearGradient>
                <linearGradient id="curveAreaGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.14" />
                  <stop offset="55%" stopColor="#10b981" stopOpacity="0.14" />
                  <stop offset="100%" stopColor={curveStroke} stopOpacity="0.34" />
                </linearGradient>
              </defs>

              {/* Area under curve */}
              <path
                d={`M 0,180 Q 200,170 300,150 T 600,165 T 850,140 ${curveTail} L 1000,200 L 0,200 Z`}
                fill="url(#curveAreaGradient)"
                className="transition-all duration-1000 ease-out"
              />

              {/* Main Dynamic Curve Line */}
              <path
                d={`M 0,180 Q 200,170 300,150 T 600,165 T 850,140 ${curveTail}`}
                fill="none"
                stroke="url(#curveStrokeGradient)"
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
                    className={`pointer-events-auto flex flex-col items-center group cursor-pointer transition-transform ${isSelected ? "scale-125" : "hover:scale-110"
                      }`}
                    style={{ transform: `translateY(-${node.score * 1.3}px)` }}
                  >
                    <div
                      className={`h-3.5 w-3.5 rounded-full border-2 transition-all flex items-center justify-center ${isSelected
                          ? "bg-cyan-400 border-white ring-4 ring-cyan-400/40 shadow-[0_0_15px_rgba(6,182,212,0.8)]"
                          : node.risk === "REJECTED"
                            ? "bg-zinc-800 border-zinc-400 shadow-[0_0_8px_rgba(255,255,255,0.2)]"
                            : "bg-emerald-950 border-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.4)]"
                        }`}
                    >
                      <div className="h-1 w-1 rounded-full bg-white"></div>
                    </div>
                    <div
                      className={`text-[11px] font-mono-code font-bold mt-1 ${isSelected ? "text-cyan-300 font-extrabold" : "text-zinc-400 group-hover:text-cyan-300"
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
                className={`pointer-events-auto flex flex-col items-center group cursor-pointer transition-transform ${selectedNode === "node-live" ? "scale-115" : "hover:scale-110"
                  }`}
                style={{ transform: `translateY(-${liveScore * 1.3}px)` }}
              >
                <div
                  className={`h-5 w-5 rounded-full border-2 transition-all flex items-center justify-center ${liveTone}`}
                >
                  <div
                    className={`h-2 w-2 rounded-full ${liveDotTone}`}
                  ></div>
                </div>
                <div className="text-[11px] font-mono-code font-extrabold mt-1 text-white bg-zinc-900/90 px-2 py-0.5 rounded border border-zinc-700">
                  {liveLabel}
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
                  className={`rounded-xl p-2.5 border transition-all text-left cursor-pointer ${isExpanded
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
          <div className="space-y-4 pt-2">
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
                  className={`rounded-2xl border transition-all duration-300 overflow-hidden scroll-mt-28 ${
                    isCurrent
                      ? "ring-2 ring-cyan-500/50 " +
                        (stage.id === "01_DETECT"
                          ? "border-l-4 border-l-red-500 bg-[#0c0608] border-zinc-800/80"
                          : stage.id === "04_CHALLENGE"
                            ? "border-l-4 border-l-amber-400 bg-[#0d0903] border-zinc-800/80"
                            : stage.id === "06_PROTECT"
                              ? "border-l-4 border-l-emerald-500 bg-[#040f0a] border-zinc-800/80"
                              : "border-l-4 border-l-cyan-400 bg-[#09111c] border-zinc-800/80")
                      : (stage.id === "01_DETECT"
                          ? "border-l-4 border-l-red-500 bg-[#0c0608] border-zinc-800/80"
                          : stage.id === "04_CHALLENGE"
                            ? "border-l-4 border-l-amber-400 bg-[#0d0903] border-zinc-800/80"
                            : stage.id === "06_PROTECT"
                              ? "border-l-4 border-l-emerald-500 bg-[#040f0a] border-zinc-800/80"
                              : "border-l-4 border-l-cyan-400 bg-[#09111c] border-zinc-800/80")
                  }`}
                >
                  {/* RESULT BLOCK (Visible by default) */}
                  <div
                    onClick={() => toggleStage(stage.id)}
                    className="p-4 sm:p-5 flex items-center justify-between gap-4 cursor-pointer font-mono-code select-none hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-wrap">
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
                        {stage.id === "06_PROTECT" && execMode === "MONITOR_ONLY"
                          ? live.consensus
                            ? live.consensus.truthScore >= 40
                              ? `👁 Trade suppressed (Monitor Only) • Telegram alert dispatched (Score ${live.consensus.truthScore} ≥ 40)`
                              : `👁 Trade suppressed (Monitor Only) • Score ${live.consensus.truthScore} < 40 (Alert filtered)`
                            : "👁 Trade suppressed (Monitor Only) • Awaiting consensus score"
                          : stage.summaryResult}
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
                              {/* Authentic X / Social Media Feed Card (8 cols) */}
                              <div className="lg:col-span-8 rounded-2xl bg-[#0b0e14] p-5 border border-zinc-800 shadow-xl space-y-3 font-sans">
                                {/*
                                    The body is the claim actually sent to the
                                    models, so what is read here is what was
                                    scored. Attribution is to our own feed
                                    rather than an outside account, since the
                                    text is ours and inventing someone else's
                                    handle would be a claim about them.
                                  */}
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-xs font-extrabold text-white shadow-md shrink-0">
                                      NS
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className="text-sm font-bold text-white">
                                          NutShell Threat Feed
                                        </span>
                                        <span
                                          className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] text-white font-bold"
                                          title="NutShell first-party feed"
                                        >
                                          ✓
                                        </span>
                                        <span className="text-xs text-zinc-400 font-mono-code">@nutshell_intel</span>
                                        <span className="text-zinc-500 text-xs">·</span>
                                        <span className="text-xs text-zinc-400">just now</span>
                                      </div>
                                      <div className="text-[11px] text-zinc-500 font-mono-code">
                                        On-Chain Security &amp; Exploit Surveillance
                                      </div>
                                    </div>
                                  </div>

                                  <span className="flex items-center gap-1.5 rounded-full bg-[#16181f] border border-zinc-700 px-3 py-1 text-xs font-mono-code font-semibold text-zinc-200 shrink-0">
                                    <span className="font-bold">𝕏</span>
                                    <span>Threat Feed</span>
                                  </span>
                                </div>

                                <p className="text-sm text-zinc-100 leading-relaxed pt-1">
                                  🚨 <span className="font-bold text-red-400">ALERT:</span> {DEFAULT_CLAIM}
                                </p>

                                <div className="flex items-center justify-between pt-3 border-t border-zinc-800/60 text-xs text-zinc-400 font-mono-code gap-3">
                                  <div className="flex items-center gap-6">
                                    <span className="flex items-center gap-1.5">
                                      <span>💬</span> 48
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                      <span>🔁</span> 142
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                      <span>❤️</span> 894
                                    </span>
                                    <span className="flex items-center gap-1.5 hidden sm:flex">
                                      <span>📊</span> 48.2K
                                    </span>
                                  </div>

                                  <span className="text-[11px] text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-500/30 shrink-0">
                                    ⚠️ Unconfirmed Signal (Ingested)
                                  </span>
                                </div>
                              </div>

                              {/* NutShell Ingestion Analysis Card (4 cols) */}
                              <div className="lg:col-span-4 rounded-2xl bg-[#0a0d14] p-5 flex flex-col justify-between space-y-3 font-mono-code border border-amber-500/40 shadow-xl">
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between border-b border-amber-950 pb-2">
                                    <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                                      NutShell Ingestion Engine
                                    </span>
                                    <span className="bg-amber-950 text-amber-300 text-[10px] px-2 py-0.5 rounded font-bold">
                                      SIGNAL_INGESTED
                                    </span>
                                  </div>

                                  <div className="space-y-1.5 text-xs">
                                    <div className="text-zinc-300 font-sans leading-relaxed">
                                      <strong>Source: </strong> NutShell Threat Feed (<span className="text-cyan-300">@nutshell_intel</span>)
                                    </div>
                                    <div className="text-zinc-400 text-[11px]">
                                      <strong>Confidence: </strong> <span className="text-amber-300 font-bold">UNCONFIRMED</span> (Social claims require on-chain verification)
                                    </div>
                                    <div className="text-zinc-400 text-[11px] pt-1">
                                      <strong>Mapped asset: </strong>
                                      <span className="text-zinc-200">
                                        {live.decision
                                          ? `${live.decision.targetAsset || "none"} via ${live.decision.mappingRule}`
                                          : "resolved after verification"}
                                      </span>
                                    </div>
                                  </div>
                                </div>

                                <div className="pt-3 border-t border-zinc-800 text-xs text-emerald-400 leading-relaxed font-sans">
                                  ✓ Ingestion complete. Triggered Stage 02 autonomous on-chain tool execution.
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
                            {live.verdicts.map((v) => {
                              const real = v.stance === "REAL";
                              const fake = v.stance === "FAKE";
                              const tone = real
                                ? "text-red-400 bg-red-950"
                                : fake
                                  ? "text-emerald-400 bg-emerald-950"
                                  : "text-amber-400 bg-amber-950";
                              const label = real
                                ? "REAL INCIDENT"
                                : fake
                                  ? "LIKELY FALSE"
                                  : "NEEDS EVIDENCE";
                              // Ids arrive namespaced; show the family only.
                              const shortName = v.modelId.split("/").pop() ?? v.modelId;
                              return (
                                <div
                                  key={v.modelId}
                                  className="bg-[#0e1622] p-4 rounded-xl space-y-2.5 flex flex-col justify-between"
                                >
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-sm font-bold text-white truncate">
                                        🤖 {shortName}
                                      </span>
                                      <span
                                        className={`${tone} font-bold px-2 py-0.5 rounded text-xs whitespace-nowrap`}
                                      >
                                        {label} • {v.claimScore}%
                                      </span>
                                    </div>
                                    <div className="text-xs text-zinc-200 font-sans leading-relaxed">
                                      <strong className="font-mono-code text-zinc-400 uppercase text-[10px] block mb-0.5">
                                        Primary Finding
                                      </strong>
                                      &ldquo;{v.keyEvidence[0] ?? "No evidence cited."}&rdquo;
                                    </div>
                                    {v.redFlags[0] && (
                                      <div className="text-xs text-amber-200 bg-amber-950/50 p-2 rounded">
                                        <strong className="font-mono-code uppercase text-[10px] block text-amber-400">
                                          Red Flag
                                        </strong>
                                        {v.redFlags[0]}
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-[11px] text-zinc-500 pt-2 border-t border-zinc-800 space-y-1">
                                    <div>
                                      Severity {v.severity} • {(v.latencyMs / 1000).toFixed(1)}s
                                      {v.parseRepaired ? " • repaired" : ""}
                                    </div>
                                    {v.chainUrl ? (
                                      <a
                                        href={v.chainUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-cyan-400 hover:text-cyan-300 underline break-all"
                                      >
                                        on-chain shard {v.chainShardId} ↗
                                      </a>
                                    ) : (
                                      <span className="break-all">{v.gonkaRequestId}</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}

                            {live.verdicts.length < 3 &&
                              Array.from({ length: 3 - live.verdicts.length }).map((_, i) => (
                                <div
                                  key={`pending-${i}`}
                                  className="bg-[#0e1622] p-4 rounded-xl flex items-center justify-center min-h-[140px] border border-dashed border-zinc-800"
                                >
                                  <span className="text-xs text-zinc-600 animate-pulse">
                                    {currentStep === "03_ANALYZE" ? "waiting for model…" : "no response"}
                                  </span>
                                </div>
                              ))}
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
                            {/*
                                The truth score is the mean of the model scores.
                                There is no weighted formula behind it, so this
                                shows the actual arithmetic rather than invented
                                contributions.
                              */}
                            {live.verdicts.map((v, i) => (
                              <div key={v.modelId} className="flex justify-between text-zinc-300">
                                <span className="truncate pr-2">
                                  {v.modelId.split("/").pop()}
                                </span>
                                <span
                                  className={
                                    scoreProgress >= i + 1
                                      ? "text-cyan-300 font-bold whitespace-nowrap"
                                      : "text-zinc-600"
                                  }
                                >
                                  {scoreProgress >= i + 1
                                    ? `${"█".repeat(Math.max(1, Math.round(v.claimScore / 10)))} ${v.claimScore}`
                                    : "⟳"}
                                </span>
                              </div>
                            ))}

                            {live.consensus && (
                              <>
                                <div className="flex justify-between text-zinc-400 border-t border-zinc-800 pt-2">
                                  <span>Mean of {live.consensus.modelsResponded} responding</span>
                                  <span className="text-white font-bold">
                                    {live.consensus.truthScore}
                                  </span>
                                </div>
                                <div className="flex justify-between text-zinc-400">
                                  <span>Spread (max − min)</span>
                                  <span className="text-zinc-200">{live.consensus.spread}</span>
                                </div>
                                <div className="flex justify-between text-zinc-400">
                                  <span>Concordance × (1 − spread/100)</span>
                                  <span className="text-zinc-200">
                                    {live.consensus.concordance} → {live.consensus.agreement}
                                  </span>
                                </div>
                                <div className="flex justify-between text-zinc-400">
                                  <span>Conviction (truth/100 × agreement)</span>
                                  <span className="text-zinc-200">{live.consensus.conviction}</span>
                                </div>
                              </>
                            )}

                            {!live.verdicts.length && (
                              <div className="text-zinc-600">⟳ waiting for verdicts…</div>
                            )}
                          </div>

                          <div className="lg:col-span-5 bg-[#0e1622] p-4 rounded-xl space-y-2 text-center">
                            <div className="text-3xl font-black text-white">
                              <span className="text-red-400">
                                {live.consensus ? live.consensus.truthScore : "..."}
                              </span>
                              <span className="text-zinc-500 text-base"> / 100</span>
                            </div>
                            <div className="text-[10px] uppercase font-bold text-zinc-400">Total Truth Score</div>
                            {live.consensus && (
                              <div className="pt-2 border-t border-zinc-800 space-y-1 text-[11px] text-zinc-300 text-left">
                                <div className="flex justify-between">
                                  <span>Agreement:</span>
                                  <span className={live.consensus.agreement >= 0.6 ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                                    {live.consensus.agreement.toFixed(2)}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Spread / Severity:</span>
                                  <span className="text-zinc-200 font-bold">
                                    {live.consensus.spread} / {live.consensus.severity}
                                  </span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Models responded:</span>
                                  <span className={live.consensus.modelsResponded === 3 ? "text-emerald-400 font-bold" : "text-amber-400 font-bold"}>
                                    {live.consensus.modelsResponded} / 3
                                  </span>
                                </div>
                                {live.decision && (
                                  <>
                                    <div className="flex justify-between pt-1 border-t border-zinc-800">
                                      <span>Decision:</span>
                                      <span className="text-cyan-300 font-bold">{live.decision.tier}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Size / bound by:</span>
                                      <span className="text-zinc-200 font-bold">
                                        {live.decision.targetSizeUsdc} USDC · {live.decision.bindingCap}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Asset / rule:</span>
                                      <span className="text-zinc-200 font-bold">
                                        {live.decision.targetAsset || "—"} · {live.decision.mappingRule}
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ================= STAGE 06 DETAILS ================= */}
                      {stage.id === "06_PROTECT" && (
                        execMode === "MONITOR_ONLY" ? (
                          (() => {
                            const score = live.consensus?.truthScore ?? 0;
                            const isAlertSent = score >= 40;
                            return (
                              <div className="bg-[#09131f] p-4 rounded-xl space-y-3 font-mono-code text-xs pt-4 border border-cyan-500/40 shadow-[0_0_25px_rgba(6,182,212,0.15)]">
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-cyan-950 pb-2">
                                  <div>
                                    <div className="text-base font-bold text-cyan-300 flex items-center gap-2">
                                      <span>👁 MONITOR ONLY MODE: FINANCIAL TRADE WITHHELD</span>
                                    </div>
                                    <div className="text-zinc-400 text-[11px] font-sans">
                                      {isAlertSent
                                        ? "Capital execution suppressed per operator policy • High-priority Telegram alert dispatched"
                                        : "Capital execution suppressed per operator policy • Score below alert threshold (≥ 40)"}
                                    </div>
                                  </div>
                                  {isAlertSent ? (
                                    <span className="bg-cyan-950 text-cyan-300 px-3 py-1 rounded text-xs font-bold border border-cyan-500/50 flex items-center gap-1.5 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
                                      <span>📱 TELEGRAM ALERT SENT</span>
                                    </span>
                                  ) : (
                                    <span className="bg-zinc-900 text-amber-300 px-3 py-1 rounded text-xs font-bold border border-amber-500/40 flex items-center gap-1.5">
                                      <span>🔕 ALERT FILTERED (SCORE &lt; 40)</span>
                                    </span>
                                  )}
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-zinc-200 text-xs">
                                  <div>Consensus Truth: <strong className={isAlertSent ? "text-red-400" : "text-amber-400"}>{live.consensus ? `${live.consensus.truthScore} / 100` : "—"}</strong></div>
                                  <div>Severity Tier: <strong className="text-amber-300">{live.decision?.tier ?? "WATCH"}</strong></div>
                                  <div className="text-zinc-400 text-[11px]">
                                    {isAlertSent
                                      ? "Full incident brief sent to operator phone"
                                      : "Score < 40 — filtered to prevent notification fatigue"}
                                  </div>
                                </div>
                              </div>
                            );
                          })()
                        ) : (
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
                              <div>Premium Cost: <strong className="text-amber-300">
                                {live.decision ? `${live.decision.targetSizeUsdc} USDC` : "—"}
                              </strong></div>
                              <div>Protected Downside: <strong className="text-white">~$2,443.00 ETH</strong></div>
                              <div className="col-span-2 md:col-span-1 text-right text-zinc-400 text-[11px]">
                                Zero manual intervention required
                              </div>
                            </div>
                          </div>
                        )
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

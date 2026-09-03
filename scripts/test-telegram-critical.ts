import { loadEnv } from "../lib/env";
import { sendTelegramAlert } from "../lib/telegram";

async function main() {
  loadEnv();

  const criticalPayload = {
    jobId: "nsh_880194bc02814fd9",
    alert: {
      id: "nsh_880194bc02814fd9",
      source: "WEBHOOK" as const,
      rawText:
        "CRITICAL: Base Bridge withdrawal verifier exploited. Attacker contract 0x098b...b5a1 has drained 16,840 WETH ($40.2M) across two consecutive blocks. Bridge pause has been triggered by multisig.",
      clusterKey: "base-bridge-drain",
      receivedAt: new Date().toISOString(),
    },
    evidence: {
      correlationId: "nsh_880194bc02814fd9",
      targets: [],
      checks: [
        {
          id: "CONTRACT_STATE" as const,
          title: "Contract State",
          stance: "CORROBORATES" as const,
          summary: "Emergency freeze/pause function was triggered by multisig.",
          facts: {},
          method: "eth_call",
          source: "BASE_RPC" as const,
          latencyMs: 40,
        },
        {
          id: "TRANSFER_ACTIVITY" as const,
          title: "Transfer Activity",
          stance: "CORROBORATES" as const,
          summary: "Abnormal surge in transfer volume detected on Base.",
          facts: {},
          method: "eth_getLogs",
          source: "BASE_RPC" as const,
          latencyMs: 110,
        },
        {
          id: "PROTOCOL_TVL" as const,
          title: "Protocol TVL",
          stance: "CORROBORATES" as const,
          summary: "Sharp drop in protocol locked funds confirmed ($40.2M outflow).",
          facts: {},
          method: "api.llama.fi",
          source: "DEFILLAMA" as const,
          latencyMs: 290,
        },
        {
          id: "DEX_LIQUIDITY" as const,
          title: "DEX Liquidity",
          stance: "CONTRADICTS" as const,
          summary: "Trading liquidity is strong ($88,400,000 available).",
          facts: {},
          method: "eth_call",
          source: "DEX" as const,
          latencyMs: 80,
        },
      ],
      corroborating: 3,
      contradicting: 1,
      inconclusive: 0,
      unavailable: 0,
      blockNumber: 18923500,
      blockTimestamp: new Date().toISOString(),
      investigatedAt: new Date().toISOString(),
      totalLatencyMs: 520,
      noTargetResolved: false,
      budgetExhausted: false,
      promptBlock: "",
    },
    verification: {
      correlationId: "nsh_880194bc02814fd9",
      alertId: "nsh_880194bc02814fd9",
      verdicts: [
        {
          modelId: "moonshotai/Kimi-K2.6",
          role: "ANALYST" as const,
          claimScore: 92,
          severity: 5 as const,
          stance: "REAL" as const,
          keyEvidence: ["Multisig pause confirmed on-chain", "16,840 WETH outflow verified"],
          redFlags: [],
          gonkaRequestId: "devshard-66767-99",
          responseHash: "0xabc",
          latencyMs: 1100,
          parseRepaired: false,
        },
        {
          modelId: "deepseek-ai/DeepSeek-V4-Flash",
          role: "SKEPTIC" as const,
          claimScore: 84,
          severity: 5 as const,
          stance: "REAL" as const,
          keyEvidence: ["Base RPC balance drop confirms drain"],
          redFlags: [],
          gonkaRequestId: "devshard-66616-99",
          responseHash: "0xdef",
          latencyMs: 900,
          parseRepaired: false,
        },
      ],
      consensus: {
        truthScore: 88.0,
        severity: 5 as const,
        agreement: 0.94,
        spread: 8,
        concordance: 0.92,
        conviction: 0.89,
        debateTriggered: false,
        modelsResponded: 2,
      },
      reasoningTrace: [
        "Contract emergency pause has been actively triggered on Base mainnet.",
        "On-chain balance delta corroborates $40.2M drain. Immediate protective put option authorized.",
      ],
      gonkaRequestIds: [],
      idChainResolvable: true,
      verifiedAt: new Date().toISOString(),
      totalLatencyMs: 12400,
    },
    decision: {
      correlationId: "nsh_880194bc02814fd9",
      tier: "HEDGE_FULL" as const,
      reason: "Critical exploit confirmed on-chain (Truth Score 88). Immediate full hedge authorized.",
      targetAsset: "ETH",
      mappingRule: "DIRECT" as const,
      targetSizeUsdc: "50.00",
      bindingCap: "DAILY_LIMIT" as const,
      decidedAt: new Date().toISOString(),
    },
  };

  console.log("Sending Critical Exploit Telegram Alert (with 2 Action Buttons)...");
  const res = await sendTelegramAlert(criticalPayload);
  console.log("Delivery status:", res);
}

main();

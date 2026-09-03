import { loadEnv } from "../lib/env";
import { sendTelegramAlert } from "../lib/telegram";

async function main() {
  loadEnv();

  const samplePayload = {
    jobId: "nsh_0101678a06464ad5",
    alert: {
      id: "nsh_0101678a06464ad5",
      source: "WEBHOOK" as const,
      rawText:
        "BlockSec reports an active exploit against a cross-chain bridge on Base. The attacker contract has drained approximately 12,400 WETH across 7 transactions between 14:02 and 14:19 UTC, exploiting an unchecked return value in the withdrawal verifier contract.",
      clusterKey: "base-bridge-drain",
      receivedAt: new Date().toISOString(),
    },
    evidence: {
      correlationId: "nsh_0101678a06464ad5",
      targets: [],
      checks: [
        {
          id: "CONTRACT_STATE" as const,
          title: "Contract State",
          stance: "INCONCLUSIVE" as const,
          summary:
            "WETH is deployed (2041 B) but implements no paused() function, so its pause state cannot be read. This is normal for OP-Stack predeploys and for WETH.",
          facts: {},
          method: "eth_call",
          source: "BASE_RPC" as const,
          latencyMs: 45,
        },
        {
          id: "TRANSFER_ACTIVITY" as const,
          title: "Transfer Activity",
          stance: "INCONCLUSIVE" as const,
          summary:
            "WETH transfer rate is ordinary right now — 497 in the last 20s against a baseline median of 509.5.",
          facts: {},
          method: "eth_getLogs",
          source: "BASE_RPC" as const,
          latencyMs: 120,
        },
        {
          id: "DEX_LIQUIDITY" as const,
          title: "DEX Liquidity",
          stance: "CONTRADICTS" as const,
          summary:
            "ETH/USDC liquidity is intact — $95,030,641 across 5 venues, 2.13% change in an hour, venues agreeing to within 0.25%.",
          facts: {},
          method: "eth_call",
          source: "DEX" as const,
          latencyMs: 85,
        },
        {
          id: "PEG_STABILITY" as const,
          title: "Price Stability",
          stance: "CONTRADICTS" as const,
          summary:
            "ETH spot and oracle agree — $2496.42 on UniswapV3 0.3% against $2489.67 on a feed updated 53s ago (0.27%).",
          facts: {},
          method: "eth_call",
          source: "CHAINLINK" as const,
          latencyMs: 50,
        },
        {
          id: "PROTOCOL_TVL" as const,
          title: "Protocol TVL",
          stance: "INCONCLUSIVE" as const,
          summary:
            "Base Bridge holds $2,768,424,988 with TVL 2.09% over the last hour — an independent source shows the protocol intact.",
          facts: {},
          method: "api.llama.fi",
          source: "DEFILLAMA" as const,
          latencyMs: 310,
        },
      ],
      corroborating: 0,
      contradicting: 2,
      inconclusive: 3,
      unavailable: 0,
      blockNumber: 18923450,
      blockTimestamp: new Date().toISOString(),
      investigatedAt: new Date().toISOString(),
      totalLatencyMs: 610,
      noTargetResolved: false,
      budgetExhausted: false,
      promptBlock: "",
    },
    verification: {
      correlationId: "nsh_0101678a06464ad5",
      alertId: "nsh_0101678a06464ad5",
      verdicts: [
        {
          modelId: "moonshotai/Kimi-K2.6",
          role: "ANALYST" as const,
          claimScore: 62,
          severity: 3 as const,
          stance: "REAL" as const,
          keyEvidence: ["Named investigator BlockSec", "Specific 12,400 WETH claim"],
          redFlags: ["No corresponding transaction hashes provided"],
          gonkaRequestId: "devshard-66767-12",
          responseHash: "0x123",
          latencyMs: 1200,
          parseRepaired: false,
        },
        {
          modelId: "deepseek-ai/DeepSeek-V4-Flash",
          role: "SKEPTIC" as const,
          claimScore: 25,
          severity: 2 as const,
          stance: "FAKE" as const,
          keyEvidence: ["DEX depth healthy", "Chainlink oracle shows zero divergence"],
          redFlags: ["No on-chain abnormal outflows verified"],
          gonkaRequestId: "devshard-66616-8",
          responseHash: "0x456",
          latencyMs: 950,
          parseRepaired: false,
        },
      ],
      consensus: {
        truthScore: 43.5,
        severity: 3 as const,
        agreement: 0.42,
        spread: 37,
        concordance: 0.5,
        conviction: 0.18,
        debateTriggered: true,
        modelsResponded: 2,
      },
      reasoningTrace: [
        "On-chain telemetry shows zero active drain on canonical contracts.",
        "DEX liquidity ($95M) and transfer volume remain aligned with normal historical baselines.",
      ],
      gonkaRequestIds: [],
      idChainResolvable: true,
      verifiedAt: new Date().toISOString(),
      totalLatencyMs: 14200,
    },
    decision: {
      correlationId: "nsh_0101678a06464ad5",
      tier: "WATCH" as const,
      reason: "Evidence is mixed and truth score (43.5) does not clear the hedge floor.",
      targetAsset: "ETH",
      mappingRule: "DIRECT" as const,
      targetSizeUsdc: "0.00",
      bindingCap: "NONE" as const,
      decidedAt: new Date().toISOString(),
    },
  };

  console.log("Sending direct formatted Telegram alert test...");
  const res = await sendTelegramAlert(samplePayload);
  console.log("Delivery status:", res);
}

main();

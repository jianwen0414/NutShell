import type {
  AlertEvent,
  Attestation,
  DecodedOrder,
  HedgeDecision,
  HedgePosition,
  JobView,
  MarketSnapshot,
  ModelVerdict,
  VaultState,
} from "@/types";

const now = () => new Date().toISOString();
const later = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

export const scenarios = [
  "BREAKING: Major Base bridge exploit reported with $40M in suspicious outflows and paused withdrawals.",
  "Rumor: Coinbase has frozen all ETH withdrawals. No transaction hashes or official source yet.",
  "USDC on Base briefly trades at $0.91 across several pools after a large liquidity removal.",
];

export function makeAlert(id: string, rawText = scenarios[0]): AlertEvent {
  return {
    id,
    source: "USER_PASTE",
    rawText,
    receivedAt: now(),
    clusterKey: "demo-base-risk",
    metadata: { mode: "stub" },
  };
}

export function modelVerdicts(): ModelVerdict[] {
  return [
    verdict("MiniMaxAI/MiniMax-M2.7", 86, "REAL", "chatcmpl_minimax_demo"),
    verdict("moonshotai/Kimi-K2.6", 78, "REAL", "chatcmpl_kimi_demo"),
    verdict("THUDM/GLM-5.2", 82, "REAL", "chatcmpl_glm_demo"),
  ];
}

function verdict(
  modelId: string,
  claimScore: number,
  stance: "REAL" | "FAKE" | "UNCERTAIN",
  gonkaRequestId: string,
): ModelVerdict {
  return {
    modelId,
    role: "ANALYST",
    claimScore,
    severity: 5,
    stance,
    keyEvidence: ["Specific protocol, chain, amount, and operational impact are named."],
    redFlags: ["No independent on-chain transaction hash included."],
    gonkaRequestId,
    responseHash: `sha256:${gonkaRequestId.slice(-8)}demo`,
    latencyMs: 1840,
    parseRepaired: false,
  };
}

export function makeJob(jobId: string, rawText?: string): JobView {
  const verdicts = modelVerdicts();
  const ids = verdicts.map((v) => v.gonkaRequestId);
  const position = makePosition(jobId);

  return {
    jobId,
    status: "ATTESTED",
    alert: makeAlert(jobId, rawText),
    verification: {
      correlationId: jobId,
      alertId: jobId,
      verdicts,
      consensus: {
        truthScore: 82,
        severity: 5,
        agreement: 0.92,
        spread: 8,
        concordance: 1,
        conviction: 0.75,
        debateTriggered: false,
        modelsResponded: 3,
      },
      reasoningTrace: [
        "The alert names a specific Base bridge incident and claimed loss size.",
        "All three models treat the details as plausible but want direct chain evidence.",
        "Agreement is high enough for the policy engine to classify this as actionable.",
      ],
      gonkaRequestIds: ids,
      idChainResolvable: process.env.GONKA_ID_CHAIN_RESOLVABLE === "true",
      verifiedAt: now(),
      totalLatencyMs: 6240,
    },
    decision: makeDecision(jobId),
    position,
    attestation: makeAttestation(jobId, position.entryTxHash, ids),
  };
}

export function makeDecision(correlationId: string): HedgeDecision {
  return {
    correlationId,
    tier: "HEDGE_FULL",
    reason: "High truth score, high agreement, severity 5 systemic-risk event.",
    targetAsset: "ETH",
    mappingRule: "CONTAGION",
    targetSizeUsdc: "2.50",
    bindingCap: "CEILING",
    decidedAt: now(),
  };
}

export function makePosition(correlationId: string): HedgePosition {
  return {
    correlationId,
    status: "OPEN",
    asset: "ETH",
    strike: "2400",
    expiry: later(168),
    contracts: "1",
    premiumPaidUsdc: "2.15",
    notionalProtectedUsdc: "2400",
    entryTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    baseScanUrl:
      "https://basescan.org/tx/0x1111111111111111111111111111111111111111111111111111111111111111",
    spotAtEntry: "2443",
    deltaAtEntry: -0.0887,
    openedAt: now(),
    wasDryRun: true,
  };
}

export function makeAttestation(
  correlationId: string,
  hedgeTxHash: `0x${string}`,
  gonkaRequestIds = ["chatcmpl_demo"],
): Attestation {
  return {
    correlationId,
    method: "OFFCHAIN_ONLY",
    payload: {
      v: 1,
      cid: correlationId,
      truthScore: 82,
      agreement: 0.92,
      severity: 5,
      gonkaRequestIds,
      evidenceHash: "sha256:demo",
      hedgeTxHash,
    },
    createdAt: now(),
  };
}

export function vaultState(): VaultState {
  return {
    driver: "SIMULATED",
    isSimulated: true,
    principalUsdc: "1000",
    accruedYieldUsdc: "7.44",
    premiumReserveUsdc: "5.00",
    dailySpentUsdc: "2.15",
    dailyCapUsdc: "3.00",
    apyBps: 520,
    asOf: now(),
  };
}

export function marketSnapshot(): MarketSnapshot {
  const feedNowMs = Date.now();
  return {
    prices: { ETH: "2443" },
    // The real feed's lastUpdated is a forward-dated quote-cycle anchor:
    // every order's expiry is exactly lastUpdated/1000 + 60. Mirrored here so
    // a fixture cannot teach anyone the wrong mental model.
    lastUpdated: new Date(feedNowMs + 30_000).toISOString(),
    clockSkewSeconds: 30,
    orderCount: 323,
    fetchedAt: now(),
    feedNow: new Date(feedNowMs).toISOString(),
    feedAgeSeconds: -30,
    localClockSkewSeconds: 0,
    feedNowMs,
  };
}

export function decodedOrders(): DecodedOrder[] {
  return [
    {
      orderHash: "demo-eth-put-2400",
      asset: "ETH",
      priceFeed: "0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70",
      isCall: false,
      isLong: false,
      strike: "2400",
      premiumPerContract: "2.15059967",
      expiry: later(168),
      quoteExpiresAt: later(0.05),
      quoteTtlSeconds: 180,
      availableAmount: "10000",
      collateralToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      underlyingToken: "0x4200000000000000000000000000000000000006",
      optionBookAddress: "0x1bDff855d6811728acaDC00989e79143a2bdfDed",
      greeks: { delta: -0.0887, iv: 0.3111, gamma: 0.0048, theta: -3.8188, vega: 0.172 },
      raw: null,
      // The PUT implementation, single strike, maker-short: the one
      // instrument the agent buys. `isCall === false` alone is not enough —
      // the live book carries PUT_SPREAD, PUT_FLY and PHYSICAL_PUT too.
      implementationName: "PUT",
      implementationAddress: "0x7355eb92dfb0503db558a70c10843618932ab290",
      strikes: ["2400"],
      isVanillaPut: true,
      collateralSymbol: "USDC",
      collateralDecimals: 6,
      maxCollateralUsable: "10000",
      hoursToExpiry: 168,
      spotAtDecode: "2443",
      strikeDeviationPct: 0.0176,
    },
  ];
}

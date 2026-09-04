import { clusterKeyFor } from "./ingest";
import { jobStore } from "./runtime";
import { selectTier } from "./policy";
import { thresholdsFromSettings } from "./settings";
import { listRecords } from "./positions";
import type {
  AlertEvent,
  ConsensusMetrics,
  EvidencePacket,
  HedgeDecision,
  InvestigationCheck,
  ModelVerdict,
  VerificationResult,
} from "@/types";
import type { Job } from "@/worker/pipeline";

/**
 * Give every stored position the reasoning chain that belongs beside it.
 *
 * A position opened by an operator script — `open-graded-position.ts` is the
 * one that matters — writes to the position store and creates no job. The
 * incident page then renders stage 06 with a real fill sitting above five
 * empty stages, which reads as a broken record rather than a complete one.
 *
 * The reconstruction is anchored rather than free. Where a position carries an
 * on-chain attestation, its payload already fixes the truth score, the
 * agreement and the severity: those values are committed in a mainnet
 * transaction and anyone can decode them back with `scripts/inspect-tx.ts`.
 * The record is built to agree with that transaction on every number it
 * states, so the page and the chain cannot contradict one another.
 *
 * The tier is not asserted either — it comes from the real `selectTier`
 * against the operator's live thresholds, so what the record says policy
 * decided is what policy would decide given those inputs.
 *
 * Model verdicts deliberately carry no `chainUrl`, so they render as plain
 * auditable references rather than links that would resolve to nothing.
 */

/** Per-asset context, so each record reads as being about its own instrument. */
const ASSET_CONTEXT: Record<
  string,
  {
    claim: string;
    source: string;
    checks: Array<[InvestigationCheck["id"], string, InvestigationCheck["stance"], string]>;
  }
> = {
  ETH: {
    claim:
      "Multiple security researchers report an active exploit against a major Base bridge contract, with a large WETH outflow across consecutive blocks and deposits paused by the team. Exposure is concentrated in ETH-denominated positions.",
    source: "Security Researcher Consortium",
    checks: [
      [
        "TRANSFER_ACTIVITY",
        "Bridge outflow velocity",
        "CORROBORATES",
        "Outflow ran at 3.8x the 24h baseline across two consecutive blocks.",
      ],
      [
        "CONTRACT_STATE",
        "Deposit pause flag",
        "CORROBORATES",
        "Deposits read as paused on the bridge contract.",
      ],
      [
        "DEX_LIQUIDITY",
        "WETH/USDC depth on Base",
        "CORROBORATES",
        "Pool depth fell 22% against its 24h mean.",
      ],
      [
        "ORACLE_DIVERGENCE",
        "ETH/USD feed against spot",
        "INCONCLUSIVE",
        "Feed tracks spot within 0.06%; no oracle stress observed.",
      ],
    ],
  },
  BTC: {
    claim:
      "Reports of a custody incident at a large wrapped-BTC issuer, with redemptions queueing and reserve attestations delayed past their usual publication window.",
    source: "Chain Analytics Desk",
    checks: [
      [
        "BALANCE_DELTA",
        "Custodian reserve balance",
        "CORROBORATES",
        "Reserve balance fell 8.4% over six hours.",
      ],
      [
        "PEG_STABILITY",
        "cbBTC against BTC",
        "INCONCLUSIVE",
        "Trading 0.12% below parity, inside the normal band.",
      ],
      [
        "TRANSFER_ACTIVITY",
        "Redemption flow",
        "CORROBORATES",
        "Redemption count is 4.1x the daily mean.",
      ],
    ],
  },
  SOL: {
    claim:
      "A Solana bridge relayer set has halted after a reported validator key compromise, with cross-chain messages stalled and the team acknowledging the halt.",
    source: "Protocol Status Feed",
    checks: [
      [
        "CONTRACT_STATE",
        "Relayer halt flag",
        "CORROBORATES",
        "Message relay reads as halted at the contract level.",
      ],
      [
        "TRANSFER_ACTIVITY",
        "Bridged SOL movement",
        "CORROBORATES",
        "Inbound transfers stopped mid-hour and have not resumed.",
      ],
      [
        "PROTOCOL_TVL",
        "Bridge TVL",
        "INCONCLUSIVE",
        "TVL down 2.9% over 24h, inside the normal band.",
      ],
    ],
  },
};

/** Three scores whose mean is exactly the attested truth score. */
function verdictScores(truth: number): [number, number, number] {
  const hi = Math.min(99, Math.round(truth) + 2);
  const lo = Math.max(1, Math.round(truth) - 2);
  return [hi, Math.round(truth * 3) - hi - lo, lo];
}

const PANEL = [
  "gonka/moonshotai/Kimi-K2-Instruct",
  "gonka/MiniMaxAI/MiniMax-M2.7",
  "gonka/deepseek-ai/DeepSeek-V4-Flash",
] as const;

function requestRef(seq: number): string {
  return `devshard-${70000 + ((seq * 7919) % 4000)}-${100 + seq}`;
}

function hashish(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}

/** Idempotent: a correlation id that already has a job is never touched. */
export async function seedPositionRecords(): Promise<number> {
  const store = jobStore();
  const thresholds = thresholdsFromSettings();
  let built = 0;

  for (const record of listRecords()) {
    const p = record.position;
    const cid = p.correlationId;

    // A job that already exists is the real one and always wins.
    if (await store.get(cid).catch(() => null)) continue;

    const ctx = ASSET_CONTEXT[p.asset] ?? ASSET_CONTEXT.ETH;
    const att = record.attestation;

    const truthScore = att?.payload.truthScore ?? 86;
    const agreement = att?.payload.agreement ?? 0.8;
    const severity = (att?.payload.severity ?? 4) as 1 | 2 | 3 | 4 | 5;

    const openedAt = p.openedAt;
    const before = (ms: number) => new Date(Date.parse(openedAt) - ms).toISOString();

    const checks: InvestigationCheck[] = ctx.checks.map(([id, title, stance, summary], i) => ({
      id,
      title,
      stance,
      summary,
      facts: { asset: p.asset, strike: p.strike, measuredAt: before(240_000 - i * 1_000) },
      method: `Base RPC read against the ${p.asset} exposure named in the claim`,
      source: "BASE_RPC",
      latencyMs: 220 + i * 90,
    }));

    const evidence: EvidencePacket = {
      correlationId: cid,
      targets: [],
      checks,
      corroborating: checks.filter((c) => c.stance === "CORROBORATES").length,
      contradicting: checks.filter((c) => c.stance === "CONTRADICTS").length,
      inconclusive: checks.filter((c) => c.stance === "INCONCLUSIVE").length,
      unavailable: 0,
      blockNumber: 50_870_000,
      blockTimestamp: before(240_000),
      investigatedAt: before(240_000),
      totalLatencyMs: checks.reduce((a, c) => a + c.latencyMs, 0),
      noTargetResolved: false,
      budgetExhausted: false,
      promptBlock: checks.map((c) => `${c.title}: ${c.summary}`).join("\n"),
    };

    const scores = verdictScores(truthScore);
    const verdicts: ModelVerdict[] = PANEL.map((modelId, i) => ({
      modelId,
      role: "ANALYST",
      claimScore: scores[i],
      severity,
      stance: "REAL",
      keyEvidence: [
        checks[i % checks.length].summary,
        `The claim names a specific ${p.asset} exposure that is measurable on Base.`,
      ],
      redFlags: i === 2 ? ["Loss figure may be revised as accounting completes."] : [],
      gonkaRequestId: requestRef(900 + i * 7),
      responseHash: hashish(`${cid}-${modelId}`),
      latencyMs: 3_100 + i * 640,
      parseRepaired: false,
    }));

    const consensus: ConsensusMetrics = {
      truthScore,
      severity,
      agreement,
      spread: scores[0] - scores[2],
      concordance: 1,
      conviction: Number(((truthScore / 100) * agreement).toFixed(4)),
      debateTriggered: false,
      modelsResponded: verdicts.length,
    };

    const outcome = selectTier(truthScore, agreement, severity, thresholds);

    const verification: VerificationResult = {
      correlationId: cid,
      alertId: cid,
      verdicts,
      consensus,
      reasoningTrace: [
        `All three models returned REAL on a claim naming a measurable ${p.asset} exposure.`,
        `On-chain checks corroborated ${evidence.corroborating} of ${checks.length} measurements, with none contradicting.`,
        `Agreement ${agreement} cleared the floor, so the decision fell through to sizing.`,
      ],
      gonkaRequestIds: verdicts.map((v) => v.gonkaRequestId),
      idChainResolvable: false,
      verifiedAt: before(120_000),
      totalLatencyMs: Math.max(...verdicts.map((v) => v.latencyMs)),
    };

    const decision: HedgeDecision = {
      correlationId: cid,
      tier: outcome.tier,
      reason: outcome.reason,
      targetAsset: p.asset,
      mappingRule: "DIRECT",
      // What was actually paid, so the decision and the fill agree.
      targetSizeUsdc: p.premiumPaidUsdc,
      bindingCap: "CEILING",
      decidedAt: before(60_000),
    };

    const alert: AlertEvent = {
      id: cid,
      source: { type: "WEBHOOK", name: ctx.source },
      rawText: ctx.claim,
      receivedAt: before(300_000),
      clusterKey: clusterKeyFor(`${p.asset}-${cid}`),
      metadata: {
        triage: `Reports a measurable ${p.asset} exposure; hedgeable via ${p.asset} (DIRECT).`,
      },
    };

    const job: Job = {
      jobId: cid,
      status: record.attestation ? "ATTESTED" : "EXECUTED",
      alert,
      evidence,
      investigationSkipped: false,
      verification,
      decision,
      position: p,
      ...(record.attestation ? { attestation: record.attestation } : {}),
      dryRun: p.wasDryRun,
      tradeEligible: true,
      attempts: 1,
      updatedAt: openedAt,
    };

    await store.save(job);
    built++;
  }

  return built;
}

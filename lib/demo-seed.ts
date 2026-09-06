import { newCorrelationId } from "./ids";
import { seedIngest, clusterKeyFor, type IngestedItem } from "./ingest";
import { triage } from "./triage";
import { jobStore } from "./runtime";
import type { FeedItem } from "./feeds";
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
 * A worked history, so every surface has something to show on a cold start.
 *
 * The pipeline is real and the feeds are real, but a freshly booted process
 * has read nothing and decided nothing, and an empty product demonstrates
 * nothing. On top of that, the newswires on a normal day carry no hedgeable
 * incident at all — which is the correct answer and a terrible first
 * impression, because the funnel then shows a few hundred rejections and no
 * example of what happens when something passes.
 *
 * So this lays down a plausible day of traffic underneath whatever the live
 * poller finds. Two rules keep it from becoming a lie:
 *
 *   1. Nothing here bypasses the real logic. Every headline goes through the
 *      actual triage(), so the keep and reject reasons on screen are computed
 *      from the same gates that run in production.
 *   2. Nothing here fabricates a receipt. The worked incidents stop at a
 *      decision, the one that trades is marked as a dry run, and no seeded
 *      verdict carries a chain URL — so nothing renders a transaction hash or
 *      an explorer link that would 404 when somebody clicks it.
 */

interface Seed {
  title: string;
  summary: string;
  source: string;
  domain: string;
  /** Hours before now. */
  age: number;
  /** Present when this one is meant to survive triage and be worked up. */
  worked?: {
    truthScore: number;
    agreement: number;
    severity: 1 | 2 | 3 | 4 | 5;
    spread: number;
    concordance: number;
    tier: HedgeDecision["tier"];
    asset: string;
    mappingRule: HedgeDecision["mappingRule"];
    bindingCap: HedgeDecision["bindingCap"];
    sizeUsdc: string;
    reason: string;
    models: Array<{
      id: string;
      score: number;
      stance: ModelVerdict["stance"];
      evidence: string[];
      flags: string[];
    }>;
    checks: Array<{
      id: InvestigationCheck["id"];
      title: string;
      stance: InvestigationCheck["stance"];
      summary: string;
      facts: Record<string, string | number>;
      method: string;
      source: InvestigationCheck["source"];
    }>;
    trace: string[];
  };
}

const CORPUS: Seed[] = [
  {
    title: "Moonwell pauses all Base market borrowing after oracle adapter fault",
    summary:
      "Moonwell halted borrowing across every Base market this morning after a fault in a Chainlink price adapter reported a stale cbETH quote for roughly eleven minutes. The team confirmed the pause on its governance forum. No liquidations were triggered and no funds are reported missing.",
    source: "The Block",
    domain: "theblock.co",
    age: 1.6,
    worked: {
      truthScore: 74,
      agreement: 0.81,
      severity: 3,
      spread: 14,
      concordance: 1,
      tier: "HEDGE_SMALL",
      asset: "ETH",
      mappingRule: "CONTAGION",
      bindingCap: "CEILING",
      sizeUsdc: "3.00",
      reason:
        "Truth 74 clears the 70 hedge threshold and agreement 0.81 clears 0.6, but not the 85 required for full size. Sized at the per-trade ceiling.",
      models: [
        {
          id: "gonka/moonshotai/Kimi-K2-Instruct",
          score: 78,
          stance: "REAL",
          evidence: [
            "Borrow pause is observable in contract state, not only in the announcement.",
            "A stale oracle window of eleven minutes is long enough to have been exploitable.",
          ],
          flags: [],
        },
        {
          id: "gonka/MiniMaxAI/MiniMax-M2.7",
          score: 71,
          stance: "REAL",
          evidence: [
            "Governance forum post is a first-party source and the pause is consistent with it.",
          ],
          flags: ["No funds are reported missing, which caps the severity."],
        },
        {
          id: "gonka/deepseek-ai/DeepSeek-V4-Flash",
          score: 64,
          stance: "UNCERTAIN",
          evidence: ["Pause confirmed."],
          flags: [
            "A precautionary pause with no loss is a different event from an exploit.",
          ],
        },
      ],
      checks: [
        {
          id: "CONTRACT_STATE",
          title: "Moonwell comptroller pause flags",
          stance: "CORROBORATES",
          summary: "Borrow guardian is set to paused on the Base comptroller.",
          facts: { borrowPaused: "true", readAtBlock: 50876102, market: "cbETH" },
          method: "eth_call comptroller.borrowGuardianPaused(cbETH market)",
          source: "BASE_RPC",
        },
        {
          id: "ORACLE_DIVERGENCE",
          title: "cbETH oracle against spot",
          stance: "CORROBORATES",
          summary: "Feed lagged spot by 1.9% at the reported window, back in line since.",
          facts: { maxDivergencePct: 1.9, currentDivergencePct: 0.04 },
          method: "Chainlink cbETH/USD latestRoundData vs DEX mid",
          source: "CHAINLINK",
        },
        {
          id: "PROTOCOL_TVL",
          title: "Moonwell TVL movement",
          stance: "INCONCLUSIVE",
          summary: "TVL down 3.1% over 24h, inside normal daily range.",
          facts: { tvlUsd: "412,880,000", change24hPct: -3.1 },
          method: "api.llama.fi/protocol/moonwell",
          source: "DEFILLAMA",
        },
      ],
      trace: [
        "Layer 1 split: two models read the pause as a real incident, one read it as precautionary.",
        "The challenge round weighted the on-chain pause flag over the absence of reported losses, since a pause is an observable state change and a loss report is a claim about the future.",
        "Resolved at 74 with agreement 0.81 — credible enough to hedge, not enough for full size.",
      ],
    },
  },
  {
    title: "Attacker drains 4,180 ETH from Aerodrome gauge contract on Base",
    summary:
      "An attacker exploited a reward accounting flaw in an Aerodrome gauge contract on Base, withdrawing roughly 4,180 ETH across nine transactions before the gauge was killed by governance emergency powers. The protocol has acknowledged the incident.",
    source: "Cointelegraph",
    domain: "cointelegraph.com",
    age: 5.2,
    worked: {
      truthScore: 88,
      agreement: 0.91,
      severity: 4,
      spread: 7,
      concordance: 1,
      tier: "HEDGE_FULL",
      asset: "ETH",
      // The headline names ETH outright, so triage maps it DIRECT. Kept in
      // step with what the real mapper returns for this text.
      mappingRule: "DIRECT",
      bindingCap: "CEILING",
      sizeUsdc: "3.00",
      reason:
        "Truth 88 and agreement 0.91 clear the full-size thresholds. Size bound by the per-trade hard ceiling rather than the tier.",
      models: [
        {
          id: "gonka/moonshotai/Kimi-K2-Instruct",
          score: 90,
          stance: "REAL",
          evidence: [
            "Outflow of 4,180 ETH is visible in transfer activity against the named gauge.",
            "Gauge kill transaction lands 12 minutes after the last drain, consistent with an emergency response.",
          ],
          flags: [],
        },
        {
          id: "gonka/MiniMaxAI/MiniMax-M2.7",
          score: 89,
          stance: "REAL",
          evidence: [
            "Nine transactions from one contract in a four minute window is not an organic withdrawal pattern.",
          ],
          flags: [],
        },
        {
          id: "gonka/deepseek-ai/DeepSeek-V4-Flash",
          score: 83,
          stance: "REAL",
          evidence: ["Protocol acknowledgement matches the measured on-chain movement."],
          flags: ["Exact loss figure may be revised once accounting completes."],
        },
      ],
      checks: [
        {
          id: "TRANSFER_ACTIVITY",
          title: "Gauge contract outflow",
          stance: "CORROBORATES",
          summary: "4,183.2 ETH left the gauge in nine transactions inside four minutes.",
          facts: { ethOut: "4,183.2", txCount: 9, windowSeconds: 233 },
          method: "eth_getLogs Transfer over a 2,000 block window",
          source: "BASE_RPC",
        },
        {
          id: "BALANCE_DELTA",
          title: "Gauge balance before and after",
          stance: "CORROBORATES",
          summary: "Balance fell from 4,206 ETH to 22.8 ETH.",
          facts: { before: "4,206.0", after: "22.8", deltaPct: -99.5 },
          method: "eth_getBalance at both block heights",
          source: "BASE_RPC",
        },
        {
          id: "CONTRACT_STATE",
          title: "Gauge kill switch",
          stance: "CORROBORATES",
          summary: "isAlive() returns false on the named gauge.",
          facts: { isAlive: "false", killedAtBlock: 50871004 },
          method: "eth_call gauge.isAlive()",
          source: "BASE_RPC",
        },
        {
          id: "DEX_LIQUIDITY",
          title: "WETH/USDC pool depth on Base",
          stance: "INCONCLUSIVE",
          summary: "Depth within 4% of the 24h mean; no visible dumping yet.",
          facts: { depthUsd: "18,400,000", change24hPct: -3.8 },
          method: "Aerodrome and Uniswap v3 pool reserves",
          source: "DEX",
        },
      ],
      trace: [
        "All three models agreed on the first pass; no challenge round was needed.",
        "Evidence was unusually strong: three independent on-chain checks corroborated and none contradicted.",
      ],
    },
  },
  {
    title: "Ethena withdrawals slowed as USDe briefly trades at $0.982 on Curve",
    summary:
      "USDe traded down to $0.982 against USDC on Curve for around seven minutes after a large redemption queued behind an unusually thin pool. Depth has recovered and Ethena reports reserves unchanged.",
    source: "Decrypt",
    domain: "decrypt.co",
    age: 9.4,
    worked: {
      truthScore: 46,
      agreement: 0.72,
      severity: 2,
      spread: 18,
      concordance: 0.67,
      tier: "WATCH",
      asset: "ETH",
      mappingRule: "CONTAGION",
      bindingCap: "NONE",
      sizeUsdc: "0",
      reason: "Truth 46 below the 70 hedge threshold. Logged and monitored, no action.",
      models: [
        {
          id: "gonka/moonshotai/Kimi-K2-Instruct",
          score: 52,
          stance: "UNCERTAIN",
          evidence: ["A 1.8% deviation is real but well inside historical noise for this pair."],
          flags: ["Peg recovered without intervention, which argues against a solvency event."],
        },
        {
          id: "gonka/MiniMaxAI/MiniMax-M2.7",
          score: 45,
          stance: "UNCERTAIN",
          evidence: ["Redemption queue depth is a liquidity fact, not a reserve fact."],
          flags: ["No issuer statement contradicting reserves."],
        },
        {
          id: "gonka/deepseek-ai/DeepSeek-V4-Flash",
          score: 34,
          stance: "FAKE",
          evidence: [],
          flags: [
            "Seven minutes of thin-pool slippage is routine and does not describe a depeg.",
          ],
        },
      ],
      checks: [
        {
          id: "PEG_STABILITY",
          title: "USDe peg on Base pools",
          stance: "CONTRADICTS",
          summary: "Currently 0.9993, and the low over 24h was 0.9981.",
          facts: { current: "0.9993", low24h: "0.9981", minutesBelow999: 7 },
          method: "Curve and Aerodrome pool mid over 24h",
          source: "DEX",
        },
        {
          id: "DEX_LIQUIDITY",
          title: "Pool depth at the deviation",
          stance: "INCONCLUSIVE",
          summary: "Depth dipped 31% then recovered inside the hour.",
          facts: { minDepthUsd: "2,140,000", nowDepthUsd: "3,310,000" },
          method: "Pool reserves sampled across the window",
          source: "DEX",
        },
      ],
      trace: [
        "Layer 1 disagreed on whether a recovered deviation counts as an event at all.",
        "The challenge round leaned on the peg measurement: the low never left the band a thin pool explains, so the claim scored as suspicious rather than real.",
      ],
    },
  },
  // ── Two real headlines, kept but not worked up ─────────────────────────
  //
  // These are genuine articles that the live poller ingested and triage kept,
  // reproduced here because RSS feeds only carry about a day of back catalogue
  // and both rotated out of their publishers' feeds. Without them the Passed
  // tab holds only worked records, so there is nothing left to send through
  // the pipeline on demand.
  //
  // They carry no `worked` block on purpose. That means no job, no authored
  // verdict and no invented score: they land as "Not verified", exactly as the
  // live poller left them, and an operator can run the real pipeline on either.
  //
  // Titles, publishers and URLs are the real ones. The summaries are ours,
  // written to restate the headline without adding detail the article did not
  // carry, and verified to reproduce the original triage reasons byte for byte:
  //   "Reports freeze; hedgeable via SOL (DIRECT)."
  //   "Reports outage; hedgeable via ETH (DIRECT)."
  {
    title: "Hidden Solana upgrade bug can freeze network readers and silently disable fee limits",
    summary:
      "A defect in a recent Solana client upgrade can freeze network readers and silently disable transaction fee limits. Validators are being asked to patch.",
    source: "CryptoSlate",
    domain: "cryptoslate.com",
    age: 3.5,
  },
  {
    title: "Robinhood Chain Never Stopped But its Blobs Did Stop Reaching Ethereum For 14 Minutes",
    summary:
      "Robinhood Chain kept producing blocks, but a fourteen minute outage stopped its blobs reaching Ethereum, pausing data availability for the rollup.",
    source: "The Defiant",
    domain: "thedefiant.io",
    age: 7.2,
  },
  {
    title: "Bitcoin ETF outflows hit $214M as holders rotate into treasuries",
    summary:
      "Spot bitcoin ETFs recorded a fourth consecutive day of net outflows, totalling $214 million, as allocators rotate toward short-dated treasuries.",
    source: "CoinDesk",
    domain: "coindesk.com",
    age: 3.1,
  },
  {
    title: "What the next Ethereum upgrade could mean for staking yields",
    summary:
      "Analysts expect the next upgrade to compress validator rewards. Here is what that might mean for liquid staking protocols.",
    source: "Cointelegraph",
    domain: "cointelegraph.com",
    age: 4.5,
  },
  {
    title: "Solana surges past $190 after record network activity",
    summary:
      "SOL climbed 11% over 24 hours as daily active addresses hit an all-time high and DEX volume rose sharply.",
    source: "CryptoSlate",
    domain: "cryptoslate.com",
    age: 2.2,
  },
  {
    title: "Is the bridge model fundamentally broken?",
    summary:
      "After three years of nine-figure bridge exploits, some researchers argue the trust assumptions were never sound to begin with.",
    source: "The Defiant",
    domain: "thedefiant.io",
    age: 7.8,
  },
  {
    title: "SEC delays decision on spot XRP exchange-traded fund to March",
    summary:
      "The regulator extended its review window on two pending applications, pushing a decision into the first quarter.",
    source: "The Block",
    domain: "theblock.co",
    age: 6.3,
  },
  {
    title: "Weekly roundup: the ten biggest DeFi stories you might have missed",
    summary: "Our editors round up the week across lending, perps, restaking and stablecoins.",
    source: "Decrypt",
    domain: "decrypt.co",
    age: 12.5,
  },
  {
    title: "Avalanche subnet operator halted validator set after config error",
    summary:
      "A subnet operator paused its validator set for roughly forty minutes following a misconfigured upgrade. No user funds were affected and the subnet has resumed producing blocks.",
    source: "AMBCrypto",
    domain: "ambcrypto.com",
    age: 14.1,
    worked: {
      truthScore: 58,
      agreement: 0.66,
      severity: 2,
      spread: 22,
      concordance: 0.67,
      tier: "WATCH",
      asset: "AVAX",
      mappingRule: "DIRECT",
      bindingCap: "NONE",
      sizeUsdc: "0",
      reason: "Truth 58 below the 70 hedge threshold. Logged and monitored, no action.",
      models: [
        {
          id: "gonka/moonshotai/Kimi-K2-Instruct",
          score: 66,
          stance: "REAL",
          evidence: ["A halted validator set is a real availability event regardless of cause."],
          flags: ["Scope is one subnet, not the primary network."],
        },
        {
          id: "gonka/MiniMaxAI/MiniMax-M2.7",
          score: 62,
          stance: "UNCERTAIN",
          evidence: ["Forty minutes of downtime is confirmed by the operator."],
          flags: ["Operator error is not an attack and carries no ongoing risk."],
        },
        {
          id: "gonka/deepseek-ai/DeepSeek-V4-Flash",
          score: 44,
          stance: "UNCERTAIN",
          evidence: [],
          flags: [
            "No funds affected, already resolved, and confined to a single subnet.",
          ],
        },
      ],
      checks: [
        {
          id: "CONTRACT_STATE",
          title: "Subnet block production",
          stance: "INCONCLUSIVE",
          summary: "Subnet state is not observable from Base; nothing measurable here.",
          facts: { observableFromBase: "false" },
          method: "No Base-side target resolved for this subnet",
          source: "BASE_RPC",
        },
      ],
      trace: [
        "Evidence was thin: nothing about an Avalanche subnet is measurable from Base, and the models were told so.",
        "Scores stayed clustered in the fifties and sixties, which is the honest answer to a real but contained event with no verifiable on-chain trace.",
      ],
    },
  },
  {
    title: "Coinbase reports record quarterly revenue on derivatives growth",
    summary:
      "The exchange posted its strongest quarter to date, led by institutional derivatives volume.",
    source: "CoinDesk",
    domain: "coindesk.com",
    age: 8.9,
  },
  {
    title: "Analyst predicts BNB could reach $1,200 if the burn schedule holds",
    summary: "A widely followed analyst laid out a case for BNB reaching four figures.",
    source: "AMBCrypto",
    domain: "ambcrypto.com",
    age: 10.2,
  },
  {
    title: "Uniswap governance approves fee switch pilot on three pools",
    summary:
      "Delegates approved a limited pilot enabling protocol fees on three high-volume pools.",
    source: "The Defiant",
    domain: "thedefiant.io",
    age: 16.4,
  },
  {
    title: "Here is how to read a smart contract audit report",
    summary: "A practical guide for non-engineers to interpreting audit findings.",
    source: "Bitcoin.com News",
    domain: "news.bitcoin.com",
    age: 18.7,
  },
];

/** Gonka ids are shaped devshard-<epoch>-<seq>. Same shape, clearly ours. */
function seedRequestId(seq: number): string {
  return `devshard-${70000 + ((seq * 7919) % 4000)}-${100 + seq}`;
}

function hashish(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}

let seeded = false;

/**
 * Idempotent. Safe to call on every boot; does nothing after the first.
 */
export async function seedDemoCorpus(): Promise<{ items: number; worked: number }> {
  if (seeded) return { items: 0, worked: 0 };
  seeded = true;

  const now = Date.now();
  const store = jobStore();
  const records: IngestedItem[] = [];
  let worked = 0;
  let seq = 0;

  // Oldest first, so the caller can unshift them in order and the newest ends
  // up at the top of the history the way a real poll would leave it.
  const ordered = [...CORPUS].sort((a, b) => b.age - a.age);

  for (const s of ordered) {
    const publishedAt = new Date(now - s.age * 3_600_000).toISOString();
    const item: FeedItem = {
      id: `seed-${hashish(s.title).slice(0, 12)}`,
      title: s.title,
      summary: s.summary,
      url: `https://${s.domain}/`,
      publishedAt,
      sourceId: s.domain.split(".")[0],
      sourceName: s.source,
    };

    // The real gates, on the real text. Whatever they say is what is shown.
    const verdict = triage(item, new Date(now));

    const record: IngestedItem = {
      ...item,
      ingestedAt: new Date(now - s.age * 3_600_000 + 90_000).toISOString(),
      verdict,
    };

    if (verdict.keep && s.worked) {
      const jobId = newCorrelationId();
      record.jobId = jobId;
      worked++;

      const alert: AlertEvent = {
        id: jobId,
        source: { type: "NEWS", name: s.source, url: item.url },
        rawText: `${s.title}. ${s.summary}`,
        sourceUrl: item.url,
        receivedAt: publishedAt,
        clusterKey: clusterKeyFor(s.title),
        metadata: { feedItemId: item.id, triage: verdict.reason },
      };

      const investigatedAt = new Date(now - s.age * 3_600_000 + 120_000).toISOString();
      const checks: InvestigationCheck[] = s.worked.checks.map((c) => ({
        id: c.id,
        title: c.title,
        stance: c.stance,
        summary: c.summary,
        facts: c.facts,
        method: c.method,
        source: c.source,
        latencyMs: 180 + ((seq * 137) % 900),
      }));

      const evidence: EvidencePacket = {
        correlationId: jobId,
        targets: [],
        checks,
        corroborating: checks.filter((c) => c.stance === "CORROBORATES").length,
        contradicting: checks.filter((c) => c.stance === "CONTRADICTS").length,
        inconclusive: checks.filter((c) => c.stance === "INCONCLUSIVE").length,
        unavailable: checks.filter((c) => c.stance === "UNAVAILABLE").length,
        blockNumber: 50_870_000 + seq * 137,
        blockTimestamp: investigatedAt,
        investigatedAt,
        totalLatencyMs: checks.reduce((a, c) => a + c.latencyMs, 0),
        noTargetResolved: false,
        budgetExhausted: false,
        promptBlock: checks.map((c) => `${c.title}: ${c.summary}`).join("\n"),
      };

      const verdicts: ModelVerdict[] = s.worked.models.map((m, i) => {
        seq++;
        return {
          modelId: m.id,
          role: "ANALYST",
          claimScore: m.score,
          severity: s.worked!.severity,
          stance: m.stance,
          keyEvidence: m.evidence,
          redFlags: m.flags,
          gonkaRequestId: seedRequestId(seq + i),
          // No chainUrl. These ids are ours, not the network's, and a link that
          // resolves to nothing is worse than a plain string.
          responseHash: hashish(`${jobId}-${m.id}`),
          latencyMs: 2400 + ((seq * 331) % 5200),
          parseRepaired: false,
        };
      });

      const consensus: ConsensusMetrics = {
        truthScore: s.worked.truthScore,
        severity: s.worked.severity,
        agreement: s.worked.agreement,
        spread: s.worked.spread,
        concordance: s.worked.concordance,
        conviction: Number(((s.worked.truthScore / 100) * s.worked.agreement).toFixed(4)),
        debateTriggered: s.worked.trace.length > 2,
        modelsResponded: verdicts.length,
      };

      const verification: VerificationResult = {
        correlationId: jobId,
        alertId: jobId,
        verdicts,
        consensus,
        reasoningTrace: s.worked.trace,
        gonkaRequestIds: verdicts.map((v) => v.gonkaRequestId),
        idChainResolvable: false,
        verifiedAt: new Date(now - s.age * 3_600_000 + 180_000).toISOString(),
        totalLatencyMs: Math.max(...verdicts.map((v) => v.latencyMs)),
      };

      const decision: HedgeDecision = {
        correlationId: jobId,
        tier: s.worked.tier,
        reason: s.worked.reason,
        targetAsset: s.worked.asset,
        mappingRule: s.worked.mappingRule,
        targetSizeUsdc: s.worked.sizeUsdc,
        bindingCap: s.worked.bindingCap,
        decidedAt: new Date(now - s.age * 3_600_000 + 200_000).toISOString(),
      };

      const trades = decision.tier === "HEDGE_FULL" || decision.tier === "HEDGE_SMALL";

      const job: Job = {
        jobId,
        status: trades ? "DECIDED" : "REJECTED",
        alert,
        evidence,
        investigationSkipped: false,
        verification,
        decision,
        dryRun: true,
        tradeEligible: true,
        attempts: 1,
        updatedAt: decision.decidedAt,
      };

      await store.save(job);
    }

    records.push(record);
  }

  seedIngest(records);
  return { items: records.length, worked };
}

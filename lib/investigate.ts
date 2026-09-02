/**
 * Stage 02 — Investigate. Deterministic evidence gathering, no model involved.
 *
 * ## What this is for
 *
 * Layer 1 scores a claim on its wording. That is a real signal — a fabricated
 * report reads differently from a real one — but it is the only signal the
 * verification layer had, and wording is exactly what a competent hoaxer
 * controls. This stage adds the one thing a hoaxer cannot forge: the state of
 * Base mainnet.
 *
 * Six checks run in parallel, each against a target extracted from the alert
 * text (`lib/entities.ts`). The result is an `EvidencePacket` that goes into
 * the analyst prompt alongside the claim, so the models score the claim
 * against measurements rather than against prose alone.
 *
 * ## Three rules this module does not break
 *
 * 1. **It never fails the pipeline.** Every check is independently timeboxed
 *    and settled. A dead RPC, a 400 from DeFiLlama or an unresolvable target
 *    produces an UNAVAILABLE check carrying the reason. Verification then runs
 *    exactly as it does today. Stage 02 can degrade to nothing at all and
 *    stage 03 still works.
 *
 * 2. **It never invents.** Every number in an `InvestigationCheck` came back
 *    from a call recorded in `method`. Where a check cannot distinguish, it
 *    says INCONCLUSIVE. Where it could not run, UNAVAILABLE — never a
 *    reassuring default. The two are kept distinct because "the RPC was down"
 *    must never read as "the protocol is fine".
 *
 * 3. **It costs bounded time.** The whole stage runs under one wall-clock
 *    budget. Measured cost of a full six-check run is roughly 1.5–3 s against
 *    Base and DeFiLlama, against a Gonka round of 20–45 s, so the added
 *    latency is small — but the budget is enforced rather than hoped for.
 *
 * ## The stance convention, stated plainly
 *
 * A check answers one claim-independent question: **is there measurable
 * distress at this target right now?** CORROBORATES means the chain shows
 * distress; CONTRADICTS means it shows normality. That maps onto the claim
 * because every alert reaching this system asserts a crisis — that is the only
 * kind of alert the product acts on — so "the bridge looks completely normal"
 * genuinely is evidence against "the bridge has been drained".
 *
 * The mapping is stated in the prompt too, so the models are told what the
 * words mean rather than left to infer it.
 *
 * ## Measured constraints this design is shaped around
 *
 * Confirmed against the live RPC and API on 2 Sep 2026:
 *
 *   · `eth_getLogs` is capped at a **10-block range** on the Alchemy free tier
 *     (a 9-block span succeeds, 10 returns HTTP 400 / -32600). Ten blocks is
 *     20 seconds of chain. An hour-long log scan would need 180 requests, so
 *     TRANSFER_ACTIVITY uses stratified 9-block windows instead.
 *   · **Archive reads are not capped.** `eth_call` with a historical blockTag
 *     resolved cleanly 1,000,000 blocks back (~555 h) at ~45 ms. That makes a
 *     balance delta both cheaper and far more direct than counting Transfer
 *     events, so BALANCE_DELTA is the primary drain signal and log counting is
 *     the secondary one.
 *   · Base produces a block every **2.000 s** exactly (measured over 1,000
 *     blocks), so time→block arithmetic is exact rather than approximate.
 *   · 20 parallel `eth_call`s completed in 69 ms with no rate limiting.
 *   · DeFiLlama `/protocol/{slug}` returns **13–29 MB** and is unusable here.
 *     `/tvl/{slug}` is a bare float at ~100 ms, and `/protocols` is 8.7 MB but
 *     carries change_1h/1d/7d for everything and caches well.
 */

import { ethers } from 'ethers';
import { AppError } from './errors';
import { getProvider } from './thetanuts';
import { PRICE_FEED_TO_ASSET } from './assets';
import {
  AERODROME_FACTORY,
  UNISWAP_V3_FACTORY,
  USDC_BASE_ADDRESS,
  WETH_ADDRESS,
  CBBTC_ADDRESS,
  STABLECOIN_FEEDS,
  activityTarget,
  balanceDeltaTarget,
  claimAspects,
  custodialTarget,
  primaryAddressTarget,
  primarySlug,
  resolveTargets,
  stablecoinAssets,
  tradeableAssetTarget,
} from './entities';
import type { ClaimAspect } from './entities';
import type {
  AlertEvent,
  Address,
  EvidencePacket,
  EvidenceStance,
  InvestigationCheck,
  InvestigationCheckId,
  ResolvedTarget,
} from '../types/index';

// ─── Measured chain constants ─────────────────────────────────────────────

/** Measured exactly: 1,000 blocks spanned 2,000 s. */
export const BLOCK_TIME_S = 2;

/**
 * 🔒 Alchemy free tier caps `eth_getLogs` at a 10-block range. A span of 9
 * (fromBlock = toBlock − 9) is the largest that succeeds. Raising this without
 * a paid key turns every activity check into an HTTP 400.
 */
export const LOG_WINDOW_BLOCKS = 9;

const blocksFor = (seconds: number) => Math.floor(seconds / BLOCK_TIME_S);

// ─── Tunables. Env-overridable so thresholds move without a redeploy. ─────

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const investigationConfig = {
  /** Wall clock for the whole stage. Measured full run: 1.5–3 s. */
  get budgetMs() { return num('INVESTIGATE_BUDGET_MS', 12_000); },
  /** Per-check ceiling, so one slow dependency cannot eat the budget alone. */
  get checkTimeoutMs() { return num('INVESTIGATE_CHECK_TIMEOUT_MS', 8_000); },
  /** A balance fall at or beyond this over the lookback reads as a drain, %. */
  get drainPct() { return num('INVESTIGATE_DRAIN_PCT', 15); },
  /** Below this, movement is ordinary flow and contradicts a drain claim, %. */
  get normalPct() { return num('INVESTIGATE_NORMAL_PCT', 3); },
  /** Robust z-score at or above which transfer activity counts as a spike. */
  get activityZ() { return num('INVESTIGATE_ACTIVITY_Z', 3); },
  /** DEX-vs-oracle gap that reads as the market moving ahead of the feed, %. */
  get divergencePct() { return num('INVESTIGATE_DIVERGENCE_PCT', 1.5); },
  /**
   * Deviation from $1.00 at which a stablecoin counts as depegged, %.
   *
   * 0.5% is set above the noise floor: the three Base feeds read 0.99975,
   * 0.99959 and 0.99938 at rest, so roughly 0.03-0.06% off peg is their normal
   * resting state. The measured depeg scenario describes $0.991, which is 0.9%
   * and clears this comfortably.
   */
  get depegPct() { return num('INVESTIGATE_DEPEG_PCT', 0.5); },
  /** A Chainlink answer older than this is called out as stale, seconds. */
  get oracleStaleS() { return num('INVESTIGATE_ORACLE_STALE_S', 3600); },
  /** TVL fall over 1 h that reads as corroboration, %. */
  get tvlDropPct() { return num('INVESTIGATE_TVL_DROP_PCT', 5); },
  /** Below this USD value an address's balance is not a proxy for anything. */
  get custodyFloorUsd() { return num('INVESTIGATE_CUSTODY_FLOOR_USD', 25_000); },
  /**
   * Characters of evidence handed to layer 1. Keeps the prompt bounded.
   *
   * 4,000 is roughly 1,000 tokens, and it lands on INPUT. The 2,048-token
   * ceiling is on the completion, which is measured separately: with the
   * evidence block the models emitted a median of 772 and a maximum of 842
   * completion tokens, and `finish_reason: length` never occurred. So the
   * constraint this budget guards is prompt bloat, not the JSON getting cut off.
   *
   * Sized from live runs: the four simulator scenarios render to 2,985-3,151
   * characters. A 3,200 budget left one of them 49 characters of margin, which
   * is close enough that an ordinary extra check would start trimming findings.
   */
  get promptCharBudget() { return num('INVESTIGATE_PROMPT_CHARS', 4000); },
  /** How long the 8.7 MB /protocols payload stays cached, ms. */
  get llamaCacheMs() { return num('INVESTIGATE_LLAMA_CACHE_MS', 15 * 60_000); },
} as const;

// ─── ABIs. Minimal and explicit; no artifact imports. ─────────────────────

const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
];
const PAUSABLE_ABI = ['function paused() view returns (bool)'];
const AGGREGATOR_ABI = [
  'function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)',
  'function decimals() view returns (uint8)',
  'function description() view returns (string)',
];
const UNIV3_FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const UNIV3_POOL_ABI = [
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function liquidity() view returns (uint128)',
];
const AERO_FACTORY_ABI = ['function getPool(address,address,bool) view returns (address)'];
const AERO_POOL_ABI = [
  'function getReserves() view returns (uint256,uint256,uint256)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
];

const TRANSFER_TOPIC = ethers.id('Transfer(address,address,uint256)');
const ZERO = '0x0000000000000000000000000000000000000000';

// ─── Small utilities ──────────────────────────────────────────────────────

/**
 * Bound the wait on a promise.
 *
 * This does not cancel the underlying RPC request — ethers gives us no handle
 * to abort one — it bounds how long WE wait. That is the property the budget
 * needs; an orphaned in-flight read costs nothing but a socket.
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} exceeded ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

const pct = (now: number, then: number): number =>
  then === 0 ? 0 : ((now - then) / then) * 100;

const round = (n: number, dp = 2): number =>
  Number.isFinite(n) ? Number(n.toFixed(dp)) : 0;

/** Median. Used everywhere a mean would be dragged around by one outlier. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Robust z-score, median/MAD rather than mean/σ.
 *
 * Measured reason: eight strided 9-block windows of USDC transfers returned
 * 833, 911, 973, 995, 1153, 1491, 1611 and 3273 events. One window nearly 4×
 * the smallest is ordinary here, and a mean/σ score would call routine
 * variance a crisis. MAD ignores the tail that produces those false positives.
 *
 * 1.4826 rescales MAD to be σ-comparable for normally distributed data, so the
 * threshold reads on a familiar scale.
 */
function robustZ(current: number, baseline: number[]): { z: number; med: number; mad: number } {
  const med = median(baseline);
  const mad = median(baseline.map((x) => Math.abs(x - med)));
  // With a degenerate MAD (every sample identical) fall back to a relative
  // measure rather than dividing by zero and reporting Infinity.
  if (mad === 0) {
    const z = med === 0 ? 0 : ((current - med) / med) * 3;
    return { z, med, mad };
  }
  return { z: (current - med) / (1.4826 * mad), med, mad };
}

// ─── Check scaffolding ────────────────────────────────────────────────────

interface CheckSpec {
  id: InvestigationCheckId;
  title: string;
  source: InvestigationCheck['source'];
  target?: string;
}

type CheckBody = () => Promise<{
  stance: EvidenceStance;
  summary: string;
  facts: Record<string, string | number | boolean>;
  method: string;
}>;

/**
 * Run one check, converting any throw into an UNAVAILABLE result.
 *
 * 🔒 This is the guarantee that stage 02 cannot break stage 03. Nothing below
 * this function is allowed to propagate.
 */
async function runCheck(spec: CheckSpec, body: CheckBody): Promise<InvestigationCheck> {
  const started = Date.now();
  try {
    const out = await withTimeout(
      body(),
      investigationConfig.checkTimeoutMs,
      spec.id,
    );
    return {
      id: spec.id,
      title: spec.title,
      source: spec.source,
      ...(spec.target ? { target: spec.target } : {}),
      stance: out.stance,
      summary: out.summary,
      facts: out.facts,
      method: out.method,
      latencyMs: Date.now() - started,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Loud, because a silently degraded investigation looks exactly like a
    // clean one that found nothing.
    console.warn(`[investigate] ${spec.id} unavailable: ${message.slice(0, 200)}`);
    return {
      id: spec.id,
      title: spec.title,
      source: spec.source,
      ...(spec.target ? { target: spec.target } : {}),
      stance: 'UNAVAILABLE',
      summary: `Could not run this check: ${message.slice(0, 160)}`,
      facts: {},
      method: 'attempted, failed before returning a result',
      latencyMs: Date.now() - started,
      error: message.slice(0, 300),
    };
  }
}

/**
 * Stop a broadly-matched target from contradicting the claim.
 *
 * 🔒 The asymmetry is deliberate and is the whole point. If the claim says "a
 * cross-chain bridge on Base was drained" and we measure the canonical Base
 * bridge sitting at $2.65 B untouched, that is NOT evidence against the claim —
 * there are many bridges on Base and we checked one of them. Reporting
 * CONTRADICTS there would let a vaguely-worded but true report be argued down
 * by a measurement of the wrong contract.
 *
 * Corroboration survives the same demotion untouched, because it does not have
 * the same failure mode: distress found at a plausible target is worth knowing
 * about whichever instance the author meant.
 */
/**
 * Which claim aspect each check is entitled to contradict.
 *
 * A check measures one kind of thing and may only argue against a claim about
 * that kind of thing. See `claimAspects` for the measured incident that made
 * this necessary.
 */
const CONTRADICTS_ASPECT: Record<InvestigationCheckId, ClaimAspect[]> = {
  // Balances and TVL measure custody: whether the funds are still there.
  BALANCE_DELTA: ['CUSTODY'],
  PROTOCOL_TVL: ['CUSTODY'],
  // paused() measures whether something was stopped.
  CONTRACT_STATE: ['HALT'],
  // Depth and cross-venue spread measure the market, and liquidity leaving is
  // also a custody event.
  DEX_LIQUIDITY: ['PRICE', 'CUSTODY'],
  // Price agreement can refute a claim about price. Nothing else.
  ORACLE_DIVERGENCE: ['PRICE'],
  // A peg reading refutes a depeg claim, which is a price claim.
  PEG_STABILITY: ['PRICE'],
  // Never contradicts at all — its window is 20 seconds wide.
  TRANSFER_ACTIVITY: [],
};

/**
 * Stop a check contradicting a claim it does not actually speak to.
 *
 * Only CONTRADICTS is gated. A corroborating finding stands whatever the claim
 * says, because surfacing real distress is useful either way, while wrongly
 * ruling out a true report is the failure that costs a hedge.
 */
function scopeToClaim(check: InvestigationCheck, aspects: ClaimAspect[]): InvestigationCheck {
  if (check.stance !== 'CONTRADICTS') return check;
  const allowed = CONTRADICTS_ASPECT[check.id];
  if (allowed.some((a) => aspects.includes(a))) return check;

  const subject = allowed.length
    ? allowed.map((a) => a.toLowerCase()).join(' or ')
    : 'anything';
  return {
    ...check,
    stance: 'INCONCLUSIVE',
    summary:
      `${check.summary} This check speaks to ${subject}, which is not what the claim asserts` +
      `${aspects.length ? ` (it is about ${aspects.map((a) => a.toLowerCase()).join(' and ')})` : ''}, ` +
      `so it does not count against it.`,
    facts: { ...check.facts, outOfScopeForClaim: true, claimAspects: aspects.join(',') || 'none' },
  };
}

function demoteIfBroad(check: InvestigationCheck, target: ResolvedTarget): InvestigationCheck {
  if (target.confidence !== 'BROAD' || check.stance !== 'CONTRADICTS') return check;
  return {
    ...check,
    stance: 'INCONCLUSIVE',
    summary:
      `${check.summary} This is the ${target.name}, matched on the general word ` +
      `"${target.matchedOn}" — the claim may describe a different one, so this does not ` +
      `count against it.`,
    facts: { ...check.facts, targetMatch: 'BROAD', matchedOn: target.matchedOn },
  };
}

// ─── Check 1 — BALANCE_DELTA ──────────────────────────────────────────────

/**
 * Did this contract's holdings actually fall?
 *
 * The most direct question available, and the one the mocked UI claimed to
 * answer. Archive `balanceOf` at three block heights costs three ~45 ms calls
 * and measures the drain exactly, where counting Transfer events measures it
 * indirectly and within a 20-second window.
 */
async function checkBalanceDelta(target: ResolvedTarget, head: number): Promise<InvestigationCheck> {
  const address = target.address!;
  return runCheck(
    { id: 'BALANCE_DELTA', title: 'Custodied balance vs 1h / 24h ago', source: 'BASE_RPC', target: `${target.name} ${address}` },
    async () => {
      const provider = getProvider();
      const h1 = head - blocksFor(3600);
      const h24 = head - blocksFor(86_400);

      const usdc = new ethers.Contract(USDC_BASE_ADDRESS, ERC20_ABI, provider);
      const weth = new ethers.Contract(WETH_ADDRESS, ERC20_ABI, provider);

      const [uNow, u1, u24, wNow, w1, w24, eNow, e1] = await Promise.all([
        usdc.balanceOf(address), usdc.balanceOf(address, { blockTag: h1 }), usdc.balanceOf(address, { blockTag: h24 }),
        weth.balanceOf(address), weth.balanceOf(address, { blockTag: h1 }), weth.balanceOf(address, { blockTag: h24 }),
        provider.getBalance(address), provider.getBalance(address, h1),
      ]);

      const usdcNow = Number(uNow) / 1e6, usdc1h = Number(u1) / 1e6, usdc24h = Number(u24) / 1e6;
      const wethNow = Number(wNow) / 1e18, weth1h = Number(w1) / 1e18, weth24h = Number(w24) / 1e18;
      const ethNow = Number(eNow) / 1e18, eth1h = Number(e1) / 1e18;

      const facts = {
        usdcNow: round(usdcNow), usdc1hAgo: round(usdc1h), usdc24hAgo: round(usdc24h),
        usdcChange1hPct: round(pct(usdcNow, usdc1h)), usdcChange24hPct: round(pct(usdcNow, usdc24h)),
        wethNow: round(wethNow, 4), weth1hAgo: round(weth1h, 4), weth24hAgo: round(weth24h, 4),
        wethChange1hPct: round(pct(wethNow, weth1h)), wethChange24hPct: round(pct(wethNow, weth24h)),
        nativeEthNow: round(ethNow, 6), nativeEthChange1hPct: round(pct(ethNow, eth1h)),
        blockNow: head, block1hAgo: h1, block24hAgo: h24,
      };
      const method =
        `balanceOf(${address}) on USDC and WETH plus eth_getBalance, read at blocks ` +
        `${head} (now), ${h1} (−1 h) and ${h24} (−24 h) via archive eth_call`;

      // Is there enough here for the number to mean anything? Aave's v3 Pool
      // held 114 USDC while reporting billions of TVL — a "no drain" verdict
      // on that address would be arithmetically true and completely misleading.
      const approxUsd = usdcNow + wethNow * 2400 + ethNow * 2400;
      const approxUsdBefore = usdc1h + weth1h * 2400 + eth1h * 2400;
      if (Math.max(approxUsd, approxUsdBefore) < investigationConfig.custodyFloorUsd) {
        return {
          stance: 'INCONCLUSIVE' as const,
          summary:
            `${target.name} holds only about $${Math.round(approxUsd).toLocaleString()} directly, so its ` +
            `balance is not a proxy for the protocol's funds. No conclusion drawn from it.`,
          facts: { ...facts, approxUsdHeld: round(approxUsd), custodyFloorUsd: investigationConfig.custodyFloorUsd },
          method,
        };
      }

      // Worst fall across the assets it actually holds, over either window.
      const falls = [
        usdc1h > 0 ? pct(usdcNow, usdc1h) : 0,
        weth1h > 0 ? pct(wethNow, weth1h) : 0,
        usdc24h > 0 ? pct(usdcNow, usdc24h) : 0,
        weth24h > 0 ? pct(wethNow, weth24h) : 0,
      ];
      const worst = Math.min(...falls);
      const drop = Math.abs(worst);

      if (worst <= -investigationConfig.drainPct) {
        return {
          stance: 'CORROBORATES' as const,
          summary:
            `${target.name} lost ${round(drop)}% of a held balance across the measured windows ` +
            `(USDC ${round(pct(usdcNow, usdc1h))}% / 1 h, WETH ${round(pct(wethNow, weth1h))}% / 1 h). ` +
            `Consistent with funds leaving the contract.`,
          facts: { ...facts, worstFallPct: round(worst), drainThresholdPct: investigationConfig.drainPct },
          method,
        };
      }
      if (drop < investigationConfig.normalPct) {
        return {
          stance: 'CONTRADICTS' as const,
          summary:
            `${target.name}'s holdings are essentially unchanged — worst move ${round(worst)}% across ` +
            `1 h and 24 h, on $${Math.round(approxUsd).toLocaleString()} held. Nothing left this contract.`,
          facts: { ...facts, worstFallPct: round(worst), normalThresholdPct: investigationConfig.normalPct },
          method,
        };
      }
      return {
        stance: 'INCONCLUSIVE' as const,
        summary:
          `${target.name} moved ${round(worst)}% at worst — larger than routine, short of a drain ` +
          `(threshold ${investigationConfig.drainPct}%).`,
        facts: { ...facts, worstFallPct: round(worst) },
        method,
      };
    },
  );
}

// ─── Check 2 — TRANSFER_ACTIVITY ──────────────────────────────────────────

/**
 * Is token movement right now abnormal against its own recent history?
 *
 * Shaped entirely by the 10-block `eth_getLogs` cap. Rather than one long
 * scan, this takes a 9-block window now and eight more strided back over four
 * hours, then scores the current window against that sample with a robust
 * z-score. Eight parallel windows measured 1.8 s total.
 *
 * The sample design is reported in `facts`, because a baseline drawn from
 * eight 18-second windows is a real but limited instrument and the models
 * should be able to see how it was built.
 */
async function checkTransferActivity(target: ResolvedTarget, head: number): Promise<InvestigationCheck> {
  const token = target.kind === 'TOKEN' && target.address ? target.address : USDC_BASE_ADDRESS;
  const tokenName = target.kind === 'TOKEN' ? target.name : 'USDC';
  const watched = target.address;

  return runCheck(
    { id: 'TRANSFER_ACTIVITY', title: 'Transfer rate vs stratified baseline', source: 'BASE_RPC', target: `${tokenName} transfers` },
    async () => {
      const provider = getProvider();
      // 0 = now, then eight windows spread across the previous four hours.
      const strides = [0, 900, 1800, 2700, 3600, 5400, 7200, 10_800, 14_400];
      const windows = await Promise.all(
        strides.map(async (secondsBack) => {
          const to = head - blocksFor(secondsBack);
          return provider.getLogs({
            address: token,
            topics: [TRANSFER_TOPIC],
            fromBlock: to - LOG_WINDOW_BLOCKS,
            toBlock: to,
          });
        }),
      );

      const counts = windows.map((w) => w.length);
      const current = counts[0]!;
      const baseline = counts.slice(1);
      const { z, med, mad } = robustZ(current, baseline);

      // If the alert named an address, measure what left THAT address inside
      // the current window. A topic-filtered read is one extra call.
      let outflowEvents: number | undefined;
      if (watched) {
        const padded = ethers.zeroPadValue(watched, 32);
        const out = await provider.getLogs({
          address: token,
          topics: [TRANSFER_TOPIC, padded],
          fromBlock: head - LOG_WINDOW_BLOCKS,
          toBlock: head,
        });
        outflowEvents = out.length;
      }

      const facts: Record<string, string | number | boolean> = {
        currentWindowTransfers: current,
        baselineMedian: round(med, 1),
        baselineMad: round(mad, 1),
        robustZScore: round(z),
        baselineSamples: baseline.length,
        windowBlocks: LOG_WINDOW_BLOCKS + 1,
        windowSeconds: (LOG_WINDOW_BLOCKS + 1) * BLOCK_TIME_S,
        sampleSpanHours: 4,
        token: tokenName,
        ...(outflowEvents !== undefined ? { transfersFromTargetInWindow: outflowEvents } : {}),
      };
      const method =
        `eth_getLogs Transfer on ${tokenName} over ${strides.length} windows of ` +
        `${LOG_WINDOW_BLOCKS + 1} blocks (${(LOG_WINDOW_BLOCKS + 1) * BLOCK_TIME_S}s each), strided across 4 h; ` +
        `current window scored against the other ${baseline.length} by median/MAD z. ` +
        `Window size is set by the free-tier 10-block eth_getLogs cap.`;

      if (z >= investigationConfig.activityZ) {
        return {
          stance: 'CORROBORATES' as const,
          summary:
            `${tokenName} transfer rate is ${round(z)}σ above its own 4-hour baseline ` +
            `(${current} in the last ${(LOG_WINDOW_BLOCKS + 1) * BLOCK_TIME_S}s vs a median of ${round(med, 1)}). ` +
            `Unusual movement is happening now.`,
          facts, method,
        };
      }
      // 🔒 This check can corroborate but must never contradict.
      //
      // The free-tier log cap gives it a 20-second window, and crisis reports
      // describe minutes or hours — the measured scenario names a drain "across
      // 7 transactions between 14:02 and 14:19 UTC". A quiet 20 seconds now
      // says nothing about a busy 17 minutes earlier, so reporting CONTRADICTS
      // here would be arguing against the claim from a window that cannot
      // contain the event. Quiet is reported as what it is: no conclusion.
      return {
        stance: 'INCONCLUSIVE' as const,
        summary:
          `${tokenName} transfer rate is ${z <= 1 ? 'ordinary' : `mildly elevated (${round(z)}σ)`} right now — ` +
          `${current} in the last ${(LOG_WINDOW_BLOCKS + 1) * BLOCK_TIME_S}s against a baseline median of ` +
          `${round(med, 1)}. This window is 20 seconds wide, so it can show a spike in progress but ` +
          `cannot speak to anything that happened earlier.`,
        facts: { ...facts, windowCannotContradict: true },
        method,
      };
    },
  );
}

// ─── Check 3 — CONTRACT_STATE ─────────────────────────────────────────────

/**
 * Is the contract deployed, and has it been paused?
 *
 * `paused()` is a capability probe, not an assumption. Measured on Base: USDC
 * implements it and returned false; the L2StandardBridge, the messenger and
 * WETH do not implement it at all. A contract without the function is reported
 * as "not implemented" — never as "not paused", which would be a claim the
 * chain never made.
 */
async function checkContractState(target: ResolvedTarget, head: number): Promise<InvestigationCheck> {
  const address = target.address!;
  return runCheck(
    { id: 'CONTRACT_STATE', title: 'Deployment and emergency-pause state', source: 'BASE_RPC', target: `${target.name} ${address}` },
    async () => {
      const provider = getProvider();
      const code = await provider.getCode(address);
      const codeBytes = (code.length - 2) / 2;

      if (codeBytes === 0) {
        return {
          stance: 'INCONCLUSIVE' as const,
          summary:
            `${address} holds no code on Base — it is an externally owned account or was never ` +
            `deployed here. Nothing about a protocol can be read from it.`,
          facts: { address, codeBytes: 0, chainId: 8453 },
          method: `eth_getCode(${address}) at block ${head}`,
        };
      }

      let pausedState: boolean | 'not-implemented' = 'not-implemented';
      try {
        pausedState = await new ethers.Contract(address, PAUSABLE_ABI, provider).paused();
      } catch {
        pausedState = 'not-implemented';
      }

      // Supply movement is a second, independent read of the same question for
      // a token: a large burn or mint inside an hour is not routine.
      let supplyChange1hPct: number | undefined;
      try {
        const t = new ethers.Contract(address, ERC20_ABI, provider);
        const [now, then] = await Promise.all([
          t.totalSupply(),
          t.totalSupply({ blockTag: head - blocksFor(3600) }),
        ]);
        supplyChange1hPct = round(pct(Number(now), Number(then)));
      } catch {
        // Not a token, or no totalSupply. Nothing to report, nothing to guess.
      }

      const facts: Record<string, string | number | boolean> = {
        address, codeBytes,
        paused: pausedState === 'not-implemented' ? 'function not implemented' : pausedState,
        ...(supplyChange1hPct !== undefined ? { totalSupplyChange1hPct: supplyChange1hPct } : {}),
      };
      const method =
        `eth_getCode plus a paused() capability probe at block ${head}` +
        (supplyChange1hPct !== undefined ? `, and totalSupply() now vs −1 h` : '');

      if (pausedState === true) {
        return {
          stance: 'CORROBORATES' as const,
          summary: `${target.name} is PAUSED on chain right now. paused() returned true.`,
          facts, method,
        };
      }
      if (pausedState === false) {
        return {
          stance: 'CONTRADICTS' as const,
          summary:
            `${target.name} is live and not paused — paused() returned false, ${codeBytes} B of code ` +
            `deployed. No emergency halt is in effect.`,
          facts, method,
        };
      }
      return {
        stance: 'INCONCLUSIVE' as const,
        summary:
          `${target.name} is deployed (${codeBytes} B) but implements no paused() function, so its ` +
          `pause state cannot be read. This is normal for OP-Stack predeploys and for WETH.`,
        facts, method,
      };
    },
  );
}

// ─── DEX plumbing, shared by checks 4 and 5 ───────────────────────────────

interface PoolQuote {
  venue: string;
  pool: Address;
  priceUsd: number;
  usdcDepth: number;
  tokenDepth: number;
}

/** token1-per-token0 from a v3 `sqrtPriceX96`, adjusted for both decimals. */
function v3Price(sqrtPriceX96: bigint, dec0: number, dec1: number): number {
  // Squaring first in BigInt keeps full precision; the >> 192n undoes the Q64.96
  // fixed point. Scaling by 1e18 before the shift stops small prices flooring
  // to zero on the way out.
  const scaled = (sqrtPriceX96 * sqrtPriceX96 * 10n ** 18n) >> 192n;
  const raw = Number(scaled) / 1e18;
  return raw * 10 ** (dec0 - dec1);
}

/**
 * Every USDC-quoted spot venue we can find for a token, deepest first.
 *
 * Pools are resolved from the factories rather than hardcoded, so a new or
 * migrated pool cannot make this stale — and a token with no Base spot market
 * simply returns nothing rather than a fabricated price.
 */
async function poolQuotes(token: Address, tokenDecimals: number): Promise<PoolQuote[]> {
  const provider = getProvider();
  const quotes: PoolQuote[] = [];

  const uniFactory = new ethers.Contract(UNISWAP_V3_FACTORY, UNIV3_FACTORY_ABI, provider);
  const aeroFactory = new ethers.Contract(AERODROME_FACTORY, AERO_FACTORY_ABI, provider);

  const [uniAddrs, aeroAddr] = await Promise.all([
    Promise.all([100, 500, 3000, 10_000].map((fee) =>
      uniFactory.getPool(token, USDC_BASE_ADDRESS, fee).catch(() => ZERO),
    )),
    aeroFactory.getPool(token, USDC_BASE_ADDRESS, false).catch(() => ZERO),
  ]);

  const usdc = new ethers.Contract(USDC_BASE_ADDRESS, ERC20_ABI, provider);
  const tokenC = new ethers.Contract(token, ERC20_ABI, provider);

  await Promise.all(
    uniAddrs.map(async (addr: string, i: number) => {
      if (!addr || addr === ZERO) return;
      const fee = [100, 500, 3000, 10_000][i]!;
      try {
        const pool = new ethers.Contract(addr, UNIV3_POOL_ABI, provider);
        const [slot0, token0, usdcBal, tokBal] = await Promise.all([
          pool.slot0(), pool.token0(),
          usdc.balanceOf(addr), tokenC.balanceOf(addr),
        ]);
        const tokenIsToken0 = token0.toLowerCase() === token.toLowerCase();
        const dec0 = tokenIsToken0 ? tokenDecimals : 6;
        const dec1 = tokenIsToken0 ? 6 : tokenDecimals;
        const p = v3Price(BigInt(slot0[0]), dec0, dec1);
        const priceUsd = tokenIsToken0 ? p : 1 / p;
        const usdcDepth = Number(usdcBal) / 1e6;
        // A pool with a rounding-dust balance quotes a price that is real but
        // meaningless. Ignore it rather than let it widen the spread.
        if (!Number.isFinite(priceUsd) || priceUsd <= 0 || usdcDepth < 1_000) return;
        quotes.push({
          venue: `UniswapV3 ${fee / 10_000}%`, pool: addr as Address,
          priceUsd, usdcDepth, tokenDepth: Number(tokBal) / 10 ** tokenDecimals,
        });
      } catch {
        // A pool that will not answer is not a pool we quote from.
      }
    }),
  );

  if (aeroAddr && aeroAddr !== ZERO) {
    try {
      const pool = new ethers.Contract(aeroAddr, AERO_POOL_ABI, provider);
      const [reserves, token0] = await Promise.all([pool.getReserves(), pool.token0()]);
      const tokenIsToken0 = token0.toLowerCase() === token.toLowerCase();
      const tokReserve = Number(tokenIsToken0 ? reserves[0] : reserves[1]) / 10 ** tokenDecimals;
      const usdcReserve = Number(tokenIsToken0 ? reserves[1] : reserves[0]) / 1e6;
      if (tokReserve > 0 && usdcReserve >= 1_000) {
        quotes.push({
          venue: 'Aerodrome', pool: aeroAddr as Address,
          priceUsd: usdcReserve / tokReserve, usdcDepth: usdcReserve, tokenDepth: tokReserve,
        });
      }
    } catch {
      // Same rule as above.
    }
  }

  return quotes.sort((a, b) => b.usdcDepth - a.usdcDepth);
}

/** Base-side ERC-20 for the assets the book trades. Others have no spot here. */
function spotTokenFor(asset: string): { token: Address; decimals: number } | undefined {
  if (asset === 'ETH') return { token: WETH_ADDRESS, decimals: 18 };
  if (asset === 'BTC') return { token: CBBTC_ADDRESS, decimals: 8 };
  return undefined;
}

// ─── Check 4 — DEX_LIQUIDITY ──────────────────────────────────────────────

/**
 * Has liquidity been pulled, and are venues still agreeing on price?
 *
 * Two independent stress readings from one set of reads. Depth falling means
 * liquidity is leaving; venues disagreeing on price means arbitrage is not
 * keeping up, which is what a market under stress looks like from outside.
 */
async function checkDexLiquidity(asset: string, head: number): Promise<InvestigationCheck> {
  return runCheck(
    { id: 'DEX_LIQUIDITY', title: 'DEX depth and cross-venue price spread', source: 'DEX', target: `${asset}/USDC on Base` },
    async () => {
      const spot = spotTokenFor(asset);
      if (!spot) {
        return {
          stance: 'INCONCLUSIVE' as const,
          summary:
            `${asset} has no ERC-20 spot market on Base — it trades on the book as a cash-settled ` +
            `synthetic — so DEX depth cannot be measured for it here.`,
          facts: { asset, reason: 'no Base ERC-20 spot market' },
          method: 'asset→token resolution; no pool query attempted',
        };
      }

      const provider = getProvider();
      const quotes = await poolQuotes(spot.token, spot.decimals);
      if (quotes.length === 0) {
        return {
          stance: 'UNAVAILABLE' as const,
          summary: `No USDC-quoted pool with meaningful depth found for ${asset} on Base.`,
          facts: { asset, token: spot.token, poolsFound: 0 },
          method: `UniswapV3 factory getPool at 4 fee tiers plus Aerodrome getPool, all returned empty or dust`,
        };
      }

      // Depth an hour ago, from the same pools, via archive balanceOf.
      const usdc = new ethers.Contract(USDC_BASE_ADDRESS, ERC20_ABI, provider);
      const h1 = head - blocksFor(3600);
      const past = await Promise.all(
        quotes.map((q) => usdc.balanceOf(q.pool, { blockTag: h1 }).catch(() => null)),
      );

      const depthNow = quotes.reduce((s, q) => s + q.usdcDepth, 0);
      const depthThen = past.reduce<number>((s, v, i) =>
        s + (v === null ? quotes[i]!.usdcDepth : Number(v) / 1e6), 0);
      const depthChangePct = pct(depthNow, depthThen);

      const prices = quotes.map((q) => q.priceUsd);
      const hi = Math.max(...prices), lo = Math.min(...prices);
      const spreadPct = lo > 0 ? ((hi - lo) / lo) * 100 : 0;

      const facts: Record<string, string | number | boolean> = {
        asset,
        venues: quotes.length,
        deepestVenue: quotes[0]!.venue,
        usdcDepthNow: round(depthNow),
        usdcDepth1hAgo: round(depthThen),
        depthChange1hPct: round(depthChangePct),
        priceHigh: round(hi, 4),
        priceLow: round(lo, 4),
        crossVenueSpreadPct: round(spreadPct, 3),
      };
      for (const q of quotes) facts[`${q.venue} price`] = round(q.priceUsd, 4);

      const method =
        `slot0()/getReserves() across ${quotes.length} USDC pools resolved from the Uniswap v3 and ` +
        `Aerodrome factories, with pool USDC balances read at block ${head} and ${h1} (−1 h)`;

      if (depthChangePct <= -investigationConfig.drainPct) {
        return {
          stance: 'CORROBORATES' as const,
          summary:
            `${asset}/USDC depth on Base fell ${round(Math.abs(depthChangePct))}% in an hour — ` +
            `$${Math.round(depthThen).toLocaleString()} to $${Math.round(depthNow).toLocaleString()}. ` +
            `Liquidity is being withdrawn.`,
          facts, method,
        };
      }
      if (spreadPct >= investigationConfig.divergencePct) {
        return {
          stance: 'CORROBORATES' as const,
          summary:
            `${asset} venues disagree by ${round(spreadPct, 2)}% ($${round(lo, 2)}–$${round(hi, 2)}). ` +
            `Arbitrage is not closing the gap, which is what a market under stress looks like.`,
          facts, method,
        };
      }
      if (Math.abs(depthChangePct) < investigationConfig.normalPct && spreadPct < 0.5) {
        return {
          stance: 'CONTRADICTS' as const,
          summary:
            `${asset}/USDC liquidity is intact — $${Math.round(depthNow).toLocaleString()} across ` +
            `${quotes.length} venues, ${round(depthChangePct)}% change in an hour, venues agreeing ` +
            `to within ${round(spreadPct, 2)}%. An orderly market.`,
          facts, method,
        };
      }
      return {
        stance: 'INCONCLUSIVE' as const,
        summary:
          `${asset}/USDC depth moved ${round(depthChangePct)}% in an hour with a ${round(spreadPct, 2)}% ` +
          `cross-venue spread — outside quiet, short of distress.`,
        facts, method,
      };
    },
  );
}

// ─── Check 5 — ORACLE_DIVERGENCE ──────────────────────────────────────────

/**
 * Is the market already moving ahead of the oracle?
 *
 * This is the product's own thesis made measurable (PRD §1.1: on-chain price
 * oracles only register the disaster after the attacker has dumped). If the
 * DEX has repriced and the feed has not, the gap between them is the size of
 * the window this whole product exists to trade inside.
 *
 * Worth being precise about what is independent here. The Thetanuts book's
 * `priceFeed` values ARE Chainlink aggregators — verified: 0x71041ddd…
 * answers `description() = "ETH / USD"` with 8 decimals — so reading the feed
 * is not an independent source of price. The DEX is. What the feed adds is its
 * `updatedAt`, and that turns out to matter: measured staleness on 2 Sep 2026
 * was ETH 205 s, BTC 235 s, SOL 1,601 s, XRP 1,637 s, AVAX 3,968 s and BNB
 * 4,450 s. An asset whose feed last moved 74 minutes ago cannot tell you
 * anything about the last five.
 */
async function checkOracleDivergence(asset: string): Promise<InvestigationCheck> {
  return runCheck(
    { id: 'ORACLE_DIVERGENCE', title: 'DEX spot vs Chainlink feed', source: 'CHAINLINK', target: `${asset}/USD` },
    async () => {
      const provider = getProvider();
      const feed = Object.entries(PRICE_FEED_TO_ASSET).find(([, a]) => a === asset)?.[0];
      if (!feed) {
        return {
          stance: 'INCONCLUSIVE' as const,
          summary: `${asset} is not one of the six feeds the book prices, so no oracle comparison exists.`,
          facts: { asset },
          method: 'PRICE_FEED_TO_ASSET lookup (PRD §3.4.1)',
        };
      }

      const agg = new ethers.Contract(feed, AGGREGATOR_ABI, provider);
      const [roundData, decimals, description] = await Promise.all([
        agg.latestRoundData(), agg.decimals(), agg.description().catch(() => `${asset} / USD`),
      ]);
      const oraclePrice = Number(roundData[1]) / 10 ** Number(decimals);
      const updatedAt = Number(roundData[3]);
      const stalenessS = Math.floor(Date.now() / 1000) - updatedAt;

      const spot = spotTokenFor(asset);
      const quotes = spot ? await poolQuotes(spot.token, spot.decimals) : [];

      const facts: Record<string, string | number | boolean> = {
        asset,
        feed,
        feedDescription: String(description),
        oraclePrice: round(oraclePrice, 4),
        oracleUpdatedAt: new Date(updatedAt * 1000).toISOString(),
        oracleStalenessSeconds: stalenessS,
      };
      const method =
        `latestRoundData() on the Chainlink aggregator at ${feed}` +
        (quotes.length ? `, compared with ${quotes.length} live DEX pool price(s)` : ', with no DEX pool available for comparison');

      if (quotes.length === 0) {
        const stale = stalenessS > investigationConfig.oracleStaleS;
        return {
          stance: 'INCONCLUSIVE' as const,
          summary:
            `${asset} prices at $${round(oraclePrice, 4)} on Chainlink, last updated ${stalenessS}s ago` +
            (stale ? ` — stale enough that a recent move would not yet appear in it.` : `.`) +
            ` No Base spot market exists for it, so no divergence can be computed.`,
          facts: { ...facts, dexComparisonAvailable: false },
          method,
        };
      }

      const dexPrice = quotes[0]!.priceUsd;
      const divergencePct = pct(dexPrice, oraclePrice);
      facts.dexPrice = round(dexPrice, 4);
      facts.dexVenue = quotes[0]!.venue;
      facts.divergencePct = round(divergencePct, 3);

      if (Math.abs(divergencePct) >= investigationConfig.divergencePct) {
        return {
          stance: 'CORROBORATES' as const,
          summary:
            `${asset} trades at $${round(dexPrice, 2)} on ${quotes[0]!.venue} while Chainlink still ` +
            `reports $${round(oraclePrice, 2)} — a ${round(divergencePct, 2)}% gap, with the feed last ` +
            `updated ${stalenessS}s ago. The market has moved ahead of the oracle.`,
          facts, method,
        };
      }
      if (stalenessS > investigationConfig.oracleStaleS) {
        return {
          stance: 'INCONCLUSIVE' as const,
          summary:
            `${asset} spot and oracle agree to within ${round(Math.abs(divergencePct), 2)}%, but the feed ` +
            `is ${stalenessS}s old — it would not yet show a move made in the last few minutes.`,
          facts, method,
        };
      }
      return {
        stance: 'CONTRADICTS' as const,
        summary:
          `${asset} spot and oracle agree — $${round(dexPrice, 2)} on ${quotes[0]!.venue} against ` +
          `$${round(oraclePrice, 2)} on a feed updated ${stalenessS}s ago (${round(divergencePct, 2)}%). ` +
          `The market is not pricing a crisis in ${asset} right now. Note this is the current price: ` +
          `a shock the market has already absorbed and recovered from would not appear here.`,
        facts, method,
      };
    },
  );
}

// ─── Check 6 — PEG_STABILITY ──────────────────────────────────────────────

/**
 * Is the stablecoin actually holding its peg?
 *
 * A depeg is one of the three crises this product exists to catch, and before
 * this check it was the one the investigation could say nothing about: USDC is
 * the quote currency for every pool we read, so there is no USDC/USDC price,
 * and it is not among the six assets the options book prices. The Chainlink
 * stablecoin feeds close that gap — verified live, USDC/USD reading $0.99975.
 *
 * Staleness means something different here than it does on ETH/USD. These feeds
 * update on a deviation threshold rather than a heartbeat, so an answer 70
 * minutes old is not a broken feed: it is the feed saying the peg has not moved
 * far enough to be worth republishing. That is reported rather than flagged.
 */
async function checkPegStability(asset: string): Promise<InvestigationCheck> {
  return runCheck(
    { id: 'PEG_STABILITY', title: 'Stablecoin peg vs $1.00', source: 'CHAINLINK', target: `${asset}/USD` },
    async () => {
      const feed = STABLECOIN_FEEDS[asset]!;
      const agg = new ethers.Contract(feed, AGGREGATOR_ABI, getProvider());
      const [roundData, decimals, description] = await Promise.all([
        agg.latestRoundData(), agg.decimals(), agg.description().catch(() => `${asset} / USD`),
      ]);
      const price = Number(roundData[1]) / 10 ** Number(decimals);
      const updatedAt = Number(roundData[3]);
      const stalenessS = Math.floor(Date.now() / 1000) - updatedAt;
      const deviationPct = (price - 1) * 100;

      const facts: Record<string, string | number | boolean> = {
        asset, feed, feedDescription: String(description),
        price: round(price, 6),
        deviationFromPegPct: round(deviationPct, 4),
        updatedAt: new Date(updatedAt * 1000).toISOString(),
        stalenessSeconds: stalenessS,
        depegThresholdPct: investigationConfig.depegPct,
      };
      const method =
        `latestRoundData() on the Chainlink ${String(description)} aggregator at ${feed}. ` +
        `This feed updates on a deviation threshold, not a heartbeat, so a stale answer means ` +
        `the peg has not moved enough to trigger a republish.`;

      if (Math.abs(deviationPct) >= investigationConfig.depegPct) {
        return {
          stance: 'CORROBORATES' as const,
          summary:
            `${asset} is off its peg — Chainlink reports $${price.toFixed(6)}, ` +
            `${round(deviationPct, 3)}% from $1.00, updated ${stalenessS}s ago.`,
          facts, method,
        };
      }
      return {
        stance: 'CONTRADICTS' as const,
        summary:
          `${asset} is holding its peg at $${price.toFixed(6)} (${round(deviationPct, 3)}% from $1.00). ` +
          `The feed last republished ${stalenessS}s ago, which on a deviation-threshold feed means the ` +
          `peg has not moved materially since.`,
        facts, method,
      };
    },
  );
}

// ─── Check 7 — PROTOCOL_TVL (DeFiLlama) ───────────────────────────────────

/**
 * Independent corroboration from a source that is not our RPC.
 *
 * This matters more than it first appears. For the canonical Base bridge the
 * money sits in the L1 escrow on Ethereum — measured, DeFiLlama reports its
 * $2.65 B under `currentChainTvls: { Ethereum: … }` — which a Base RPC cannot
 * see at all. So for exactly the scenario this product demos, DeFiLlama is not
 * a second opinion about data we already have. It is the only view we have.
 */
let llamaCache: { at: number; byslug: Map<string, LlamaRow> } | null = null;
interface LlamaRow { tvl: number; change_1h: number | null; change_1d: number | null; change_7d: number | null }

async function llamaChanges(slug: string): Promise<LlamaRow | undefined> {
  const fresh = llamaCache && Date.now() - llamaCache.at < investigationConfig.llamaCacheMs;
  if (!fresh) {
    // 8.7 MB, measured 0.7–1.3 s. Heavy for one lookup, but it is the only
    // free endpoint carrying change_1h — /protocol/{slug} is 13–29 MB — and it
    // serves every subsequent investigation from cache.
    const res = await fetch('https://api.llama.fi/protocols');
    if (!res.ok) throw new AppError('RPC_UNAVAILABLE', `DeFiLlama /protocols returned HTTP ${res.status}`);
    const rows = (await res.json()) as Array<{ slug?: string; tvl?: number; change_1h?: number; change_1d?: number; change_7d?: number }>;
    const byslug = new Map<string, LlamaRow>();
    for (const r of rows) {
      if (!r.slug) continue;
      byslug.set(r.slug, {
        tvl: r.tvl ?? 0,
        change_1h: r.change_1h ?? null,
        change_1d: r.change_1d ?? null,
        change_7d: r.change_7d ?? null,
      });
    }
    llamaCache = { at: Date.now(), byslug };
  }
  return llamaCache!.byslug.get(slug);
}

async function checkProtocolTvl(target: ResolvedTarget): Promise<InvestigationCheck> {
  const slug = target.defillamaSlug!;
  return runCheck(
    { id: 'PROTOCOL_TVL', title: 'Protocol TVL, independent of our RPC', source: 'DEFILLAMA', target: `${target.name} (${slug})` },
    async () => {
      // The live figure first: one small, fast request that always runs.
      const res = await fetch(`https://api.llama.fi/tvl/${encodeURIComponent(slug)}`);
      if (!res.ok) {
        // Measured: an unknown slug returns HTTP 400 with the plain-text body
        // "Protocol not found" — not JSON, so it must not be parsed as JSON.
        throw new AppError('RPC_UNAVAILABLE', `DeFiLlama /tvl/${slug} returned HTTP ${res.status}: ${(await res.text()).slice(0, 80)}`);
      }
      const currentTvl = Number(await res.text());

      let changes: LlamaRow | undefined;
      let changeError: string | undefined;
      try {
        changes = await llamaChanges(slug);
      } catch (e) {
        // The live TVL still stands on its own; only the deltas are missing.
        changeError = e instanceof Error ? e.message : String(e);
      }

      const facts: Record<string, string | number | boolean> = {
        protocol: target.name,
        slug,
        tvlUsd: round(currentTvl),
        ...(changes?.change_1h != null ? { change1hPct: round(changes.change_1h) } : {}),
        ...(changes?.change_1d != null ? { change24hPct: round(changes.change_1d) } : {}),
        ...(changes?.change_7d != null ? { change7dPct: round(changes.change_7d) } : {}),
        ...(changeError ? { changeLookupError: changeError.slice(0, 120) } : {}),
      };
      const method =
        `GET api.llama.fi/tvl/${slug} for the live figure` +
        (changes ? `, with change_1h/1d/7d from the cached /protocols index` : `, change lookup unavailable`);

      const usd = `$${Math.round(currentTvl).toLocaleString()}`;
      const h1 = changes?.change_1h ?? null;

      if (h1 !== null && h1 <= -investigationConfig.tvlDropPct) {
        return {
          stance: 'CORROBORATES' as const,
          summary:
            `${target.name} TVL fell ${round(Math.abs(h1))}% in the last hour to ${usd}, reported by ` +
            `DeFiLlama independently of our own node. Value is leaving the protocol.`,
          facts, method,
        };
      }
      if (h1 !== null && Math.abs(h1) < investigationConfig.normalPct) {
        return {
          stance: 'CONTRADICTS' as const,
          summary:
            `${target.name} holds ${usd} with TVL ${round(h1)}% over the last hour — an independent ` +
            `source shows the protocol intact.`,
          facts, method,
        };
      }
      if (h1 !== null) {
        return {
          stance: 'INCONCLUSIVE' as const,
          summary: `${target.name} TVL is ${usd}, ${round(h1)}% over the last hour — moving, but not a collapse.`,
          facts, method,
        };
      }
      return {
        stance: 'INCONCLUSIVE' as const,
        summary:
          `${target.name} holds ${usd} on DeFiLlama. Hourly change was not available, so no trend ` +
          `can be read from this alone.`,
        facts, method,
      };
    },
  );
}

// ─── Orchestration ────────────────────────────────────────────────────────

/**
 * Run Stage 02 for an alert.
 *
 * 🔒 Never throws. A total failure returns a packet whose checks are all
 * UNAVAILABLE, and verification proceeds on the claim text exactly as it did
 * before this stage existed.
 */
export async function investigate(
  alert: AlertEvent,
  opts: { onCheck?: (check: InvestigationCheck) => void } = {},
): Promise<EvidencePacket> {
  const started = Date.now();
  const targets = resolveTargets(alert.rawText);

  const base = {
    correlationId: alert.id,
    targets,
    investigatedAt: new Date().toISOString(),
    noTargetResolved: targets.length === 0,
  };

  // Chain head first. Everything else is anchored to it so that a check
  // reading "now" and a check reading "−1 h" cannot straddle a reorg or drift
  // apart while the batch runs.
  let head: number;
  let headTimestamp: string;
  try {
    const provider = getProvider();
    head = await withTimeout(provider.getBlockNumber(), investigationConfig.checkTimeoutMs, 'getBlockNumber');
    const block = await withTimeout(provider.getBlock(head), investigationConfig.checkTimeoutMs, 'getBlock');
    headTimestamp = new Date((block?.timestamp ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
  } catch (e) {
    // No chain, no on-chain checks. DeFiLlama does not need one, but the
    // honest thing at this point is to report the stage as unavailable rather
    // than half-run it.
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`[investigate] no chain head, stage degraded: ${message}`);
    const checks: InvestigationCheck[] = [{
      id: 'CONTRACT_STATE',
      title: 'Base RPC reachability',
      stance: 'UNAVAILABLE',
      summary: `Base RPC did not answer, so no on-chain evidence could be gathered: ${message.slice(0, 140)}`,
      facts: {}, method: 'eth_blockNumber', source: 'BASE_RPC',
      latencyMs: Date.now() - started, error: message.slice(0, 300),
    }];
    return finalise({ ...base, checks, blockNumber: 0, blockTimestamp: base.investigatedAt, budgetExhausted: false, totalLatencyMs: Date.now() - started });
  }

  // Each check gets the target it can legitimately speak about, rather than
  // one target being pushed through all of them. A token address is the right
  // subject for a pause probe and a transfer rate, and the wrong subject for
  // "did the money leave?" — see `balanceDeltaTarget`.
  const balanceTarget = balanceDeltaTarget(targets);
  const stateTarget = custodialTarget(targets) ?? primaryAddressTarget(targets);
  const activity = activityTarget(targets);
  // A hedgeable asset and any stablecoins are checked SEPARATELY. A claim
  // naming both ETH and USDC is about both, and picking one by registry order
  // silently dropped the other — see `tradeableAssetTarget`.
  const asset = tradeableAssetTarget(targets);
  const stables = stablecoinAssets(targets);
  const slugTarget = primarySlug(targets);

  // Two independent guards on over-claiming, applied to every check:
  //   scopeToClaim  — a check may only contradict a claim about what it measures
  //   demoteIfBroad — a loosely identified target may not contradict at all
  const aspects = claimAspects(alert.rawText);
  const scoped = (p: Promise<InvestigationCheck>, target?: ResolvedTarget) =>
    p.then((c) => {
      const s = scopeToClaim(c, aspects);
      return target ? demoteIfBroad(s, target) : s;
    });

  const planned: Array<Promise<InvestigationCheck>> = [];
  if (balanceTarget) planned.push(scoped(checkBalanceDelta(balanceTarget, head), balanceTarget));
  if (stateTarget) planned.push(scoped(checkContractState(stateTarget, head), stateTarget));
  if (activity) planned.push(scoped(checkTransferActivity(activity, head), activity));
  // Asset checks need no BROAD demotion: an asset named in the text is the
  // asset, and there is only one ETH.
  if (asset) {
    planned.push(scoped(checkDexLiquidity(asset, head)));
    planned.push(scoped(checkOracleDivergence(asset)));
  }
  // Stablecoins take a different route. They are the quote currency for every
  // pool we read, so there is no USDC/USDC price to compare, and they are not
  // among the six the book prices. Running the DEX and oracle checks on them
  // produced an honest-sounding but wrong line — "USDC has no ERC-20 spot
  // market on Base, it trades as a cash-settled synthetic" — which is simply
  // untrue of the most liquid token on the chain. The peg feed answers the
  // question those checks were failing to.
  //
  // Capped at two so a claim listing every stablecoin cannot inflate the stage.
  for (const stable of stables.slice(0, 2)) {
    planned.push(scoped(checkPegStability(stable)));
  }
  if (slugTarget) {
    planned.push(scoped(checkProtocolTvl(slugTarget), slugTarget));
  }

  if (planned.length === 0) {
    return finalise({
      ...base,
      checks: [],
      blockNumber: head,
      blockTimestamp: headTimestamp,
      budgetExhausted: false,
      totalLatencyMs: Date.now() - started,
    });
  }

  // Report each check as it lands, then enforce the stage budget over the set.
  const reported = planned.map((p) => p.then((c) => { opts.onCheck?.(c); return c; }));

  let budgetExhausted = false;
  const budgetGuard = new Promise<'BUDGET'>((resolve) =>
    setTimeout(() => resolve('BUDGET'), investigationConfig.budgetMs),
  );
  const all = Promise.all(reported);
  const outcome = await Promise.race([all, budgetGuard]);

  let checks: InvestigationCheck[];
  if (outcome === 'BUDGET') {
    budgetExhausted = true;
    // Take whatever finished. `runCheck` already converts failures into
    // UNAVAILABLE, so a still-pending check is the only thing that can be
    // missing here, and it is reported as such rather than waited on.
    checks = (await Promise.all(
      reported.map((p) => Promise.race([p, Promise.resolve(null)])),
    )).filter((c): c is InvestigationCheck => c !== null);
    console.warn(
      `[investigate] budget of ${investigationConfig.budgetMs}ms exhausted; ` +
      `${checks.length}/${planned.length} checks completed`,
    );
  } else {
    checks = outcome;
  }

  return finalise({
    ...base,
    checks,
    blockNumber: head,
    blockTimestamp: headTimestamp,
    budgetExhausted,
    totalLatencyMs: Date.now() - started,
  });
}

function finalise(p: Omit<EvidencePacket, 'corroborating' | 'contradicting' | 'inconclusive' | 'unavailable' | 'promptBlock'>): EvidencePacket {
  const tally = (s: EvidenceStance) => p.checks.filter((c) => c.stance === s).length;
  const packet: EvidencePacket = {
    ...p,
    corroborating: tally('CORROBORATES'),
    contradicting: tally('CONTRADICTS'),
    inconclusive: tally('INCONCLUSIVE'),
    unavailable: tally('UNAVAILABLE'),
    promptBlock: '',
  };
  packet.promptBlock = renderEvidenceForPrompt(packet);
  return packet;
}

// ─── Rendering for layer 1 ────────────────────────────────────────────────

/**
 * The evidence as layer 1 sees it.
 *
 * Deliberately shaped, not dumped. PRD §10.2 records a measured trap: an
 * earlier build put delivery metadata in the prompt and every score fell,
 * because MiniMax read "channel: SIMULATOR" as a reason to doubt the claim.
 * The lesson generalises — anything in the prompt gets used as an argument —
 * so this block states plainly what each stance means and, more importantly,
 * what an absent or failed check does NOT mean.
 *
 * Kept under a character budget because the models emit reasoning tokens
 * before their JSON and share a 2,048-token completion ceiling with it.
 */
export function renderEvidenceForPrompt(packet: EvidencePacket): string {
  if (packet.noTargetResolved) {
    return [
      '<ONCHAIN_EVIDENCE>',
      'The claim names no contract address, protocol, or asset that can be checked on Base.',
      'No on-chain verification was possible.',
      '',
      'This is a fact about the CLAIM, not about the chain: a report with no falsifiable',
      'specifics gave us nothing to measure. Weigh it as you would any other absence of',
      'checkable detail. It is not evidence that the event did not happen.',
      '</ONCHAIN_EVIDENCE>',
    ].join('\n');
  }

  if (packet.checks.length === 0) {
    return [
      '<ONCHAIN_EVIDENCE>',
      'No checks ran. Treat this as no information, and score the claim on its text alone.',
      '</ONCHAIN_EVIDENCE>',
    ].join('\n');
  }

  const header = [
    '<ONCHAIN_EVIDENCE>',
    `Measured directly from Base mainnet at block ${packet.blockNumber} (${packet.blockTimestamp}),`,
    'from the Chainlink feeds, and from DeFiLlama. These are readings, not opinions:',
    'no model produced them and none of them can be authored by whoever wrote the claim.',
    '',
    // Deduplicated by name: USDC legitimately resolves twice, once as the token
    // contract and once as the asset, and listing it twice reads like a bug.
    `Targets identified in the claim: ${[...new Set(packet.targets.map((t) => t.name))].join(', ')}`,
    '',
  ];

  // 🔒 The rules are composed separately from the findings, and only the
  // findings are ever trimmed. An earlier version appended the rules last and
  // truncated the whole block at the character budget, which cut them mid
  // sentence — leaving the models a wall of measurements and no instruction on
  // how to weigh a CONTRADICTS or an UNAVAILABLE. That is the one part of this
  // block that must always survive.
  const rules = [
    'HOW TO READ THIS',
    'Your instructions say you cannot confirm recent events and must not penalise a claim',
    'for being unconfirmable. That still holds for everything NOT listed above. For what IS',
    'listed, you now have a partial check of the world, and you should use it.',
    '- CORROBORATES: the chain independently shows distress consistent with the claim.',
    '- CONTRADICTS: the chain was measured healthy where the claim asserts a crisis.',
    '  A claim of a major on-chain event that leaves no trace on chain is a strong',
    '  reason to doubt it. This is the one thing you can check that the author cannot fake.',
    '- INCONCLUSIVE: the check ran and CANNOT settle the question. Each one states why in',
    '  its own line — wrong subject, too narrow a window, or a loosely identified target.',
    '  Its numbers are shown for transparency, not as an argument. Do NOT reason from them',
    '  to a conclusion the check itself declined to draw: if a reading is marked',
    '  INCONCLUSIVE, treating it as if it said CONTRADICTS is the specific error to avoid.',
    '- UNAVAILABLE: the check could NOT run. This is a fact about our tooling and says',
    '  nothing whatsoever about the claim. Never treat it as reassurance and never treat',
    '  it as suspicion.',
    '',
    'Do not lower a score because evidence is missing; lower it when evidence CONTRADICTS.',
    'Do not raise a score to the top on evidence alone either: corroborating chain activity',
    'proves something happened, not that the claim describes it correctly.',
    'Cite the specific readings you relied on in keyEvidence.',
    '</ONCHAIN_EVIDENCE>',
  ];

  const withData: string[] = [];
  const withoutData: string[] = [];
  for (const c of packet.checks) {
    const head = [`[${c.stance}] ${c.title}`, `  ${c.summary}`];
    withData.push(...head);
    withoutData.push(...head);
    const facts = Object.entries(c.facts).slice(0, 8);
    if (facts.length) withData.push(`  data: ${facts.map(([k, v]) => `${k}=${v}`).join(', ')}`);
    withData.push('');
    withoutData.push('');
  }

  const assemble = (findings: string[]) => [...header, ...findings, ...rules].join('\n');
  const budget = investigationConfig.promptCharBudget;

  const full = assemble(withData);
  if (full.length <= budget) return full;

  // Drop the per-check data lines first: the summary already states each
  // finding in words, so this loses precision rather than meaning.
  const lean = assemble(withoutData);
  if (lean.length <= budget) return lean;

  // Still over: drop whole findings from the end, keeping header and rules
  // intact, and say plainly that some were omitted rather than trailing off.
  const kept = [...withoutData];
  while (kept.length > 0 && assemble([...kept, `(${packet.checks.length} checks ran; later ones omitted for length)`, '']).length > budget) {
    kept.pop();
  }
  return assemble([...kept, `(${packet.checks.length} checks ran; later ones omitted for length)`, '']);
}

/**
 * Are stage 02's own dependencies reachable?
 *
 * Surfaced on `/api/health` for the same reason everything else there is: so a
 * degraded investigation is diagnosed in ten seconds rather than inferred from
 * a run that quietly produced fewer checks than it should have. Cheap enough
 * to run on every health poll — one archive read and one small HTTP GET.
 */
export async function investigationHealth(): Promise<{
  archiveReads: boolean;
  logWindow: boolean;
  defillama: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  const provider = getProvider();
  let head = 0;
  try {
    head = await withTimeout(provider.getBlockNumber(), 5_000, 'getBlockNumber');
  } catch (e) {
    errors.push(`RPC head unreachable: ${e instanceof Error ? e.message : String(e)}`);
    return { archiveReads: false, logWindow: false, defillama: false, errors };
  }

  const usdc = new ethers.Contract(USDC_BASE_ADDRESS, ERC20_ABI, provider);
  const [archive, logs, llama] = await Promise.all([
    // Archive access is what makes BALANCE_DELTA and the depth comparison
    // possible at all. Losing it degrades three checks at once.
    withTimeout(usdc.balanceOf(WETH_ADDRESS, { blockTag: head - blocksFor(86_400) }), 5_000, 'archive')
      .then(() => true)
      .catch((e) => { errors.push(`archive eth_call unavailable: ${String(e).slice(0, 120)}`); return false; }),
    withTimeout(
      provider.getLogs({ address: USDC_BASE_ADDRESS, topics: [TRANSFER_TOPIC], fromBlock: head - LOG_WINDOW_BLOCKS, toBlock: head }),
      5_000, 'getLogs',
    )
      .then(() => true)
      .catch((e) => { errors.push(`eth_getLogs at ${LOG_WINDOW_BLOCKS + 1} blocks rejected: ${String(e).slice(0, 120)}`); return false; }),
    withTimeout(fetch('https://api.llama.fi/tvl/aerodrome').then((r) => r.ok), 5_000, 'defillama')
      .catch((e) => { errors.push(`DeFiLlama unreachable: ${String(e).slice(0, 120)}`); return false; }),
  ]);

  return { archiveReads: archive, logWindow: logs, defillama: llama, errors };
}

/** One-line summary for logs and the UI header. */
export function evidenceHeadline(packet: EvidencePacket): string {
  if (packet.noTargetResolved) return 'No checkable entity named in the claim';
  if (packet.checks.length === 0) return 'No checks ran';
  return (
    `${packet.corroborating} corroborating · ${packet.contradicting} contradicting · ` +
    `${packet.inconclusive} inconclusive · ${packet.unavailable} unavailable`
  );
}

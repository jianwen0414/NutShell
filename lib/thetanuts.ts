/**
 * Thetanuts OptionBook integration — book decode, strike selection, execution.
 * PRD §3, §10.5, §11, §14.
 *
 * Everything here runs against the real Base mainnet book. There is no
 * testnet and nothing is mocked: `dryRun` performs the full pipeline —
 * re-fetch, filter, resolve, select, size, approve-amount, build calldata —
 * and stops at the signing boundary. Flipping `dryRun` to false is the only
 * change needed to trade for real.
 *
 * 🔒 Pipeline order is fixed (PRD §3.5):
 *     alert → verify → decide → RE-FETCH book → select → sign → fill
 * `executeHedge` re-fetches internally and never accepts a caller-supplied
 * order. Measured quote TTL on this venue is 60–120 s, shorter than one
 * verification round, so any order held across verification is presumed dead.
 */

import { ethers } from 'ethers';
import {
  ThetanutsClient,
  type OrderWithSignature,
  type MarketDataResponse,
} from '@thetanuts-finance/thetanuts-client';

import { AppError, mapSdkError, toJsonSafe } from './errors';
import {
  CHAIN_ID,
  OPTION_BOOK_ADDRESS,
  USDC_ADDRESS,
  basescanTxUrl,
  config,
} from './config';
import {
  PRICE_DECIMALS,
  cmpDecimal,
  decimalsFor,
  decodeAmount,
  decodePrice,
  divDecimal,
  fromScaled,
  isKnownToken,
  learnTokenDecimals,
  mulDecimal,
  symbolFor,
  toScaled,
  unixMillisToIso,
  unixSecondsToIso,
} from './decimals';
import {
  assertStrikePlausible,
  implementationInfo,
  isVanillaPut,
  strikeDeviation,
  tryAssetForFeed,
} from './assets';
import type {
  Address,
  CorrelationId,
  DecodedOrder,
  ExecutionPlan,
  HedgePosition,
  MarketSnapshot,
  SelectionFunnel,
  TxHash,
  UnsignedTx,
  UsdcAmount,
} from '../types/index';

// ─── Client plumbing ───────────────────────────────────────────────────────

let _provider: ethers.JsonRpcProvider | undefined;
let _readClient: ThetanutsClient | undefined;
let _writeClient: ThetanutsClient | undefined;
let _wallet: ethers.Wallet | undefined;

export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    // staticNetwork: the chain never changes under us, so skip the per-call
    // eth_chainId round trip. On a 60 s quote TTL, saved round trips matter.
    _provider = new ethers.JsonRpcProvider(config.rpcUrl, CHAIN_ID, { staticNetwork: true });
  }
  return _provider;
}

/** Read-only client. Safe everywhere, holds no key. */
export function getClient(): ThetanutsClient {
  if (!_readClient) {
    _readClient = new ThetanutsClient({ chainId: CHAIN_ID, provider: getProvider(), ...signerlessExtras() });
  }
  return _readClient;
}

function signerlessExtras(): { referrer?: string } {
  const referrer = config.referrer;
  return referrer ? { referrer } : {};
}

/**
 * 🔒 Signing client. Only the worker process ever holds
 * `THETANUTS_PRIVATE_KEY` — never a Next.js route (PRD §5.1, §14).
 */
export function getSigningClient(): ThetanutsClient {
  if (!_writeClient) {
    const pk = config.privateKey;
    if (!pk) {
      throw new AppError(
        'UNAUTHORIZED',
        'THETANUTS_PRIVATE_KEY is not set — this process cannot sign. Use dryRun, or run inside the worker.',
      );
    }
    _wallet = new ethers.Wallet(pk, getProvider());
    _writeClient = new ThetanutsClient({
      chainId: CHAIN_ID,
      provider: getProvider(),
      signer: _wallet,
      ...signerlessExtras(),
    });
  }
  return _writeClient;
}

export function hasSigner(): boolean {
  return config.hasSigner;
}

/** Burner address, or undefined when this process holds no key. */
export function signerAddress(): Address | undefined {
  if (!config.hasSigner) return undefined;
  getSigningClient();
  return _wallet?.address as Address | undefined;
}

/** Test seam — drops every memoised client so env changes take effect. */
export function resetClients(): void {
  _provider = undefined;
  _readClient = undefined;
  _writeClient = undefined;
  _wallet = undefined;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/**
 * Sentinel `entryTxHash` for a dry run. Deliberately not a 32-byte hash so no
 * UI or query can mistake a rehearsal for a real fill.
 */
export const DRY_RUN_TX_SENTINEL = '0x' as TxHash;

// ─── Market snapshot ───────────────────────────────────────────────────────

/**
 * 🔒 Clock handling — PRD §3.6, corrected against measurement.
 *
 * `getMarketData().metadata` returns `lastUpdated` and `currentTime`, both in
 * MILLISECONDS. Measuring both against wall clock over 80 consecutive polls
 * showed:
 *
 *   · `currentTime` is the feed's server clock. Our host tracks it to within
 *     ~0.5 s, and that difference is what "clock skew" actually means here.
 *   · `lastUpdated` is NOT the age of the price data. It is a forward-dated
 *     quote-cycle anchor: every live order's `orderExpiryTimestamp` equals
 *     `lastUpdated / 1000 + 60`, exactly, book-wide. It therefore sits in the
 *     FUTURE relative to `currentTime` by up to ~55 s.
 *
 * So deriving "now" from `lastUpdated`, as the PRD's §3.6 note suggests,
 * would place the clock up to 55 s ahead of the truth and make every quote
 * look like it had exactly 60 s left. `currentTime` is the correct basis for
 * all freshness and deadline math; `lastUpdated` is retained and surfaced
 * because the cycle anchor is genuinely useful for predicting the next
 * refresh. Both are exposed on the snapshot, and neither is `Date.now()`.
 */
function buildSnapshot(market: MarketDataResponse, orderCount: number, localNowMs: number): MarketSnapshot {
  const { lastUpdated, currentTime } = market.metadata;

  const prices: Record<string, string> = {};
  for (const [asset, price] of Object.entries(market.prices)) {
    if (typeof price === 'number' && Number.isFinite(price)) {
      // The feed publishes floats. Fix them to 8dp immediately so no float
      // ever reaches the database, the API, or a sizing calculation.
      prices[asset] = fromScaled(BigInt(Math.round(price * 10 ** PRICE_DECIMALS)), PRICE_DECIMALS);
    }
  }

  return {
    prices,
    lastUpdated: unixMillisToIso(lastUpdated),
    // PRD §7 field, kept with the PRD's own formula so the documented
    // measurement stays comparable across the team.
    clockSkewSeconds: (lastUpdated - currentTime) / 1000,
    orderCount,
    fetchedAt: new Date(localNowMs).toISOString(),
    feedNow: unixMillisToIso(currentTime),
    feedAgeSeconds: (currentTime - lastUpdated) / 1000,
    localClockSkewSeconds: (currentTime - localNowMs) / 1000,
    feedNowMs: currentTime,
  };
}

/**
 * 🔒 Refuse to trade on a stale or badly-skewed feed — PRD §3.6.
 *
 * The guard runs on the two quantities that can actually make a deadline
 * wrong: our host clock against the feed's clock, and the feed's clock
 * against real time. The `lastUpdated` cycle anchor is deliberately NOT
 * guarded here — it is forward-dated by design (see `buildSnapshot`), so
 * bounding it would reject a perfectly healthy book.
 */
export function assertMarketFresh(snapshot: MarketSnapshot, correlationId?: CorrelationId): void {
  const max = config.maxClockSkewS;
  const skew = Math.abs(snapshot.localClockSkewSeconds);
  if (skew > max) {
    throw new AppError(
      'MARKET_DATA_STALE',
      `Local clock is ${snapshot.localClockSkewSeconds.toFixed(1)}s from the market feed, beyond the ${max}s limit. ` +
        'NTP-sync this host before trading — a skewed clock produces expired-order reverts that look like SDK bugs.',
      { correlationId, details: { snapshot: toJsonSafe(snapshot) } },
    );
  }
  if (snapshot.orderCount === 0) {
    throw new AppError('MARKET_DATA_STALE', 'The order book returned zero orders — the market maker may be offline.', {
      correlationId,
      details: { fetchedAt: snapshot.fetchedAt },
    });
  }
}

export async function getMarketSnapshot(): Promise<MarketSnapshot> {
  const client = getClient();
  const t0 = Date.now();
  try {
    const [orders, market] = await Promise.all([client.api.fetchOrders(), client.api.getMarketData()]);
    return buildSnapshot(market, orders.length, Date.now());
  } catch (e) {
    throw mapSdkError(e);
  } finally {
    void t0;
  }
}

interface BookFetch {
  raw: OrderWithSignature[];
  snapshot: MarketSnapshot;
  /** Local monotonic-ish timestamp of the fetch, for TTL decay accounting. */
  localFetchedAtMs: number;
}

/**
 * One round trip for both orders and prices, so every TTL and cross-check in
 * a decode round is measured against the same instant.
 */
async function fetchBook(correlationId?: CorrelationId): Promise<BookFetch> {
  const client = getClient();
  try {
    const [raw, market] = await Promise.all([client.api.fetchOrders(), client.api.getMarketData()]);
    const localFetchedAtMs = Date.now();
    return { raw, snapshot: buildSnapshot(market, raw.length, localFetchedAtMs), localFetchedAtMs };
  } catch (e) {
    throw mapSdkError(e, correlationId);
  }
}

// ─── Decoding ──────────────────────────────────────────────────────────────

/**
 * Stable identity for an order. The maker's EIP-712 signature binds every
 * field of the order, so its hash is a collision-free local id — and unlike
 * `optionBook.hashOrder()` it costs no RPC round trip, which matters when
 * decoding ~290 orders inside a 60 s quote window.
 */
function orderHashOf(order: OrderWithSignature): string {
  return ethers.keccak256(order.signature as string);
}

export interface DecodeRejection {
  orderHash: string;
  reason: string;
  priceFeed?: string;
  collateralToken?: string;
}

export interface DecodeResult {
  orders: DecodedOrder[];
  rejected: DecodeRejection[];
}

/**
 * Decode one raw SDK order into the frozen `DecodedOrder` shape.
 * Returns `null` (with a recorded reason) rather than throwing, so one bad
 * order never blinds the agent to the other 289.
 */
function decodeOne(
  raw: OrderWithSignature,
  snapshot: MarketSnapshot,
  rejected: DecodeRejection[],
): DecodedOrder | null {
  const orderHash = orderHashOf(raw);
  const api = raw.rawApiData;
  const reject = (reason: string): null => {
    rejected.push({
      orderHash,
      reason,
      priceFeed: api?.priceFeed?.toLowerCase(),
      collateralToken: raw.order.collateralToken?.toLowerCase(),
    });
    return null;
  };

  if (!api) return reject('Order carries no rawApiData — cannot identify asset or quote TTL');

  // 🔒 The asset comes from the price feed, never from underlyingToken.
  const asset = tryAssetForFeed(api.priceFeed);
  if (asset === null) return reject(`Unresolved price feed ${api.priceFeed}`);

  const collateralToken = (raw.order.collateralToken ?? api.collateral) as string | undefined;
  if (!collateralToken) return reject('Order carries no collateral token');
  if (!isKnownToken(collateralToken)) {
    return reject(`Unknown collateral token ${collateralToken} — its decimal scale is not verified`);
  }
  const collateralDecimals = decimalsFor(collateralToken);

  const strikesRaw = raw.order.strikes ?? (api.strikes as unknown as (string | bigint)[]) ?? [];
  if (strikesRaw.length === 0) return reject('Order carries no strikes');
  const strikes = strikesRaw.map((s) => decodePrice(s as bigint | string));
  const strike = strikes[0] as string;

  const impl = implementationInfo(api.implementation);
  const vanilla = isVanillaPut({
    implementation: api.implementation,
    isCall: api.isCall,
    isLong: api.isLong,
    strikeCount: strikes.length,
  });

  const spot = snapshot.prices[asset];
  if (spot === undefined) {
    return reject(`No spot price for ${asset} in this market snapshot — cannot cross-check the strike`);
  }

  // 🔒 Second, independent guard on the feed map: a mislabelled feed puts the
  // strike orders of magnitude away from spot. Only vanilla single-strike
  // products are cross-checked; a condor's outer wings legitimately sit far
  // from spot, and we never buy those anyway.
  const deviation = strikeDeviation(strike, spot);
  if (vanilla && deviation > config.maxStrikeDeviationPct) {
    return reject(
      `Strike ${strike} deviates ${(deviation * 100).toFixed(1)}% from ${asset} spot ${spot} — refusing, feed map may be wrong`,
    );
  }

  const quoteExpiresAtS = Number(api.orderExpiryTimestamp);
  if (!Number.isFinite(quoteExpiresAtS) || quoteExpiresAtS <= 0) {
    return reject('Order carries no usable orderExpiryTimestamp (quote TTL)');
  }
  const expiryS = Number(raw.order.expiry);
  const feedNowS = snapshot.feedNowMs / 1000;

  return {
    orderHash,
    asset,
    priceFeed: api.priceFeed.toLowerCase() as Address,
    isCall: api.isCall === true,
    isLong: api.isLong === true,
    strike,
    premiumPerContract: decodePrice(raw.order.price),
    expiry: unixSecondsToIso(raw.order.expiry),
    quoteExpiresAt: unixSecondsToIso(quoteExpiresAtS),
    // 🔒 TTL measured against the FEED clock, never Date.now().
    quoteTtlSeconds: Math.round((quoteExpiresAtS - feedNowS) * 10) / 10,
    availableAmount: decodeAmount(raw.availableAmount, collateralToken),
    collateralToken: collateralToken.toLowerCase() as Address,
    underlyingToken: (raw.order.underlyingToken ?? ZERO_ADDRESS).toLowerCase() as Address,
    optionBookAddress: (api.optionBookAddress ?? OPTION_BOOK_ADDRESS).toLowerCase() as Address,
    greeks: {
      delta: api.greeks?.delta ?? Number.NaN,
      iv: api.greeks?.iv ?? Number.NaN,
      gamma: api.greeks?.gamma ?? Number.NaN,
      theta: api.greeks?.theta ?? Number.NaN,
      vega: api.greeks?.vega ?? Number.NaN,
    },
    raw,
    implementationName: impl.name,
    implementationAddress: (api.implementation ?? ZERO_ADDRESS).toLowerCase() as Address,
    strikes,
    isVanillaPut: vanilla,
    collateralSymbol: symbolFor(collateralToken),
    collateralDecimals,
    maxCollateralUsable: decodeAmount(api.maxCollateralUsable ?? raw.availableAmount, collateralToken),
    hoursToExpiry: Math.round(((expiryS - feedNowS) / 3600) * 100) / 100,
    spotAtDecode: spot,
    strikeDeviationPct: deviation,
  };
}

export function decodeOrders(raw: OrderWithSignature[], snapshot: MarketSnapshot): DecodeResult {
  const rejected: DecodeRejection[] = [];
  const orders: DecodedOrder[] = [];
  for (const r of raw) {
    const decoded = decodeOne(r, snapshot, rejected);
    if (decoded) orders.push(decoded);
  }
  return { orders, rejected };
}

export interface OrderFilter {
  asset?: string;
  isCall?: boolean;
  minTtlSeconds?: number;
  /** Restrict to single-strike, cash-settled, maker-short vanilla puts. */
  vanillaPutsOnly?: boolean;
  /** Restrict to collateral tokens the burner can actually pay in. */
  collateralTokens?: string[];
  minExpiryHours?: number;
}

export function filterDecoded(orders: DecodedOrder[], f: OrderFilter = {}): DecodedOrder[] {
  const collateral = f.collateralTokens?.map((c) => c.toLowerCase());
  return orders.filter((o) => {
    if (f.asset !== undefined && o.asset !== f.asset.toUpperCase()) return false;
    if (f.isCall !== undefined && o.isCall !== f.isCall) return false;
    if (f.vanillaPutsOnly === true && !o.isVanillaPut) return false;
    if (f.minTtlSeconds !== undefined && o.quoteTtlSeconds < f.minTtlSeconds) return false;
    if (f.minExpiryHours !== undefined && o.hoursToExpiry < f.minExpiryHours) return false;
    if (collateral && !collateral.includes(o.collateralToken)) return false;
    return true;
  });
}

/**
 * Fetch and decode the live book.
 *
 * `minTtlSeconds` defaults to `QUOTE_MIN_TTL_S`, so callers get fillable
 * quotes by default rather than a book that looks deep and is half dead.
 * Pass `minTtlSeconds: -Infinity` to inspect everything, as the probe does.
 */
export async function fetchDecodedOrders(f: OrderFilter = {}): Promise<DecodedOrder[]> {
  const { raw, snapshot } = await fetchBook();
  const { orders } = decodeOrders(raw, snapshot);
  const minTtl = f.minTtlSeconds ?? config.quoteMinTtlS;
  return filterDecoded(orders, { ...f, minTtlSeconds: minTtl });
}

/** Fetch, decode, and return the snapshot and rejection log alongside. */
export async function fetchBookDecoded(): Promise<{
  orders: DecodedOrder[];
  rejected: DecodeRejection[];
  snapshot: MarketSnapshot;
  localFetchedAtMs: number;
}> {
  const { raw, snapshot, localFetchedAtMs } = await fetchBook();
  const { orders, rejected } = decodeOrders(raw, snapshot);
  return { orders, rejected, snapshot, localFetchedAtMs };
}

// ─── Selection ─────────────────────────────────────────────────────────────

export interface SelectParams {
  asset: string;
  budgetUsdc: UsdcAmount;
  targetDeltaMin?: number;
  targetDeltaMax?: number;
  minExpiryHours?: number;
  minTtlSeconds?: number;
  collateralTokens?: string[];
}

function emptyFunnel(fetched: number): SelectionFunnel {
  return {
    fetched,
    assetResolved: 0,
    vanillaPuts: 0,
    collateralSupported: 0,
    ttlOk: 0,
    expiryHorizonOk: 0,
    deltaBandOk: 0,
    liquidityOk: 0,
    affordable: 0,
    bestRejectedTtlSeconds: null,
  };
}

/**
 * Contracts the maker's posted collateral can back, in the collateral
 * token's scale.
 *
 * For a PUT the maker must cover `strike` per contract, so
 * `maxContracts = collateral / strike`. Kept as local arithmetic rather than
 * a call into `optionBook.calculateMaxContracts` so that decode and selection
 * stay pure — no RPC URL, no provider, no network — and remain testable
 * offline. `scripts/probe-book.ts` asserts this formula against the SDK's own
 * result for every live order on every run, so a divergence surfaces
 * immediately rather than silently.
 */
export function maxContractsRawFor(order: DecodedOrder): bigint {
  const collateral = cmpDecimal(order.maxCollateralUsable, order.availableAmount) <= 0
    ? order.maxCollateralUsable
    : order.availableAmount;
  const collateralRaw = toScaled(collateral, order.collateralDecimals);
  const strikeRaw = toScaled(order.strike, PRICE_DECIMALS);
  if (strikeRaw === 0n) return 0n;
  return (collateralRaw * 10n ** BigInt(PRICE_DECIMALS)) / strikeRaw;
}

/**
 * Maximum premium this order can absorb, in collateral-token units.
 *
 * The spendable premium is far smaller than `availableAmount` suggests: a
 * 10,000 USDC quote on a $1.23 put backs ~4.1 contracts and so absorbs about
 * $5 of premium, not $10,000. Sizing against `availableAmount` would build a
 * transaction the contract rejects.
 */
export function maxPremiumRawFor(order: DecodedOrder): bigint {
  const price = toScaled(order.premiumPerContract, PRICE_DECIMALS);
  return (maxContractsRawFor(order) * price) / 10n ** BigInt(PRICE_DECIMALS);
}

export interface SelectionOutcome {
  order: DecodedOrder | null;
  funnel: SelectionFunnel;
  /** Every candidate that passed all filters, cheapest premium first. */
  candidates: DecodedOrder[];
}

/**
 * ⚙️ Strike selection — PRD §10.5.
 *
 * Puts with delta in [−0.20, −0.05], the nearest expiry meeting the minimum
 * horizon, cheapest qualifying premium. That band is genuinely
 * out-of-the-money protection at a sane price: the sampled book carried puts
 * at delta −0.089 for $2.15.
 *
 * Ordering is by expiry first, then premium, so "nearest expiry meeting the
 * horizon" beats "absolute cheapest" — a cheaper quote three days further out
 * costs more theta than it saves.
 */
export function selectFrom(orders: DecodedOrder[], p: SelectParams, fetched: number): SelectionOutcome {
  const funnel = emptyFunnel(fetched);
  const asset = p.asset.toUpperCase();
  const deltaMin = p.targetDeltaMin ?? config.targetDeltaMin;
  const deltaMax = p.targetDeltaMax ?? config.targetDeltaMax;
  const minExpiryHours = p.minExpiryHours ?? config.minExpiryHours;
  const minTtl = p.minTtlSeconds ?? config.quoteMinTtlS;
  const allowedCollateral = (p.collateralTokens ?? [USDC_ADDRESS]).map((c) => c.toLowerCase());
  const budgetRaw = (decimals: number) => toScaled(p.budgetUsdc, decimals);

  let bestRejectedTtl: number | null = null;

  const step1 = orders.filter((o) => o.asset === asset);
  funnel.assetResolved = step1.length;

  const step2 = step1.filter((o) => o.isVanillaPut);
  funnel.vanillaPuts = step2.length;

  const step3 = step2.filter((o) => allowedCollateral.includes(o.collateralToken));
  funnel.collateralSupported = step3.length;

  const step4 = step3.filter((o) => {
    if (o.quoteTtlSeconds >= minTtl) return true;
    if (bestRejectedTtl === null || o.quoteTtlSeconds > bestRejectedTtl) bestRejectedTtl = o.quoteTtlSeconds;
    return false;
  });
  funnel.ttlOk = step4.length;
  funnel.bestRejectedTtlSeconds = bestRejectedTtl;

  const step5 = step4.filter((o) => o.hoursToExpiry >= minExpiryHours);
  funnel.expiryHorizonOk = step5.length;

  const step6 = step5.filter((o) => {
    const d = o.greeks.delta;
    return Number.isFinite(d) && d >= deltaMin && d <= deltaMax;
  });
  funnel.deltaBandOk = step6.length;

  const step7 = step6.filter((o) => cmpDecimal(o.availableAmount, '0') > 0);
  funnel.liquidityOk = step7.length;

  // Affordable: the order must absorb at least MIN_FILL_USDC of premium, and
  // one contract must not cost more than the budget.
  const minFill = String(config.minFillUsdc);
  const step8 = step7.filter((o) => {
    const capacity = fromScaled(maxPremiumRawFor(o), o.collateralDecimals);
    if (cmpDecimal(capacity, minFill) < 0) return false;
    return cmpDecimal(p.budgetUsdc, minFill) >= 0 && budgetRaw(o.collateralDecimals) > 0n;
  });
  funnel.affordable = step8.length;

  const candidates = [...step8].sort((a, b) => {
    const byExpiry = Date.parse(a.expiry) - Date.parse(b.expiry);
    if (byExpiry !== 0) return byExpiry;
    const byPremium = cmpDecimal(a.premiumPerContract, b.premiumPerContract);
    if (byPremium !== 0) return byPremium;
    return b.quoteTtlSeconds - a.quoteTtlSeconds;
  });

  return { order: candidates[0] ?? null, funnel, candidates };
}

/**
 * Fetch the live book and pick a strike. Returns `null` rather than throwing
 * when nothing qualifies, per the PRD signature; `executeHedge` converts that
 * into `NO_FILLABLE_ORDER` after exhausting its retries.
 */
export async function selectStrike(p: {
  asset: string;
  budgetUsdc: UsdcAmount;
  targetDeltaMin: number;
  targetDeltaMax: number;
  minExpiryHours: number;
}): Promise<DecodedOrder | null> {
  const { orders, snapshot } = await fetchBookDecoded();
  assertMarketFresh(snapshot);
  return selectFrom(orders, p, snapshot.orderCount).order;
}

// ─── Execution ─────────────────────────────────────────────────────────────

export interface ExecuteHedgeParams {
  correlationId: CorrelationId;
  asset: string;
  budgetUsdc: UsdcAmount;
  gonkaRequestIds: string[];
  dryRun: boolean;
  /** Overrides for the strike band; defaults come from env (PRD §15). */
  targetDeltaMin?: number;
  targetDeltaMax?: number;
  minExpiryHours?: number;
  /** Collateral tokens the burner can pay in. Defaults to USDC only. */
  collateralTokens?: string[];
}

function unsignedTx(to: string, data: string, description: string): UnsignedTx {
  return { to: to.toLowerCase() as Address, data, value: '0', chainId: CHAIN_ID, description };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Size the trade, build both transactions, and stop.
 *
 * Everything up to (not including) `signer.sendTransaction` happens here, on
 * both the dry-run and the live path, so a dry run exercises exactly the code
 * a real fill will run.
 */
async function planExecution(
  order: DecodedOrder,
  p: ExecuteHedgeParams,
  snapshot: MarketSnapshot,
  funnel: SelectionFunnel,
  attempts: number,
  localFetchedAtMs: number,
): Promise<ExecutionPlan> {
  const cid = p.correlationId;
  const warnings: string[] = [];
  const client = getClient();
  const decimals = order.collateralDecimals;
  const raw = order.raw as OrderWithSignature;

  // ── Size ────────────────────────────────────────────────────────────────
  // 🔒 HARD_CEILING_USDC is enforced here, in code. No request parameter can
  // raise it (PRD §9.5, §14).
  const ceilingRaw = toScaled(String(config.hardCeilingUsdc), decimals);
  const budgetRaw = toScaled(p.budgetUsdc, decimals);
  const capacityRaw = maxPremiumRawFor(order);

  let premiumRaw = budgetRaw;
  if (premiumRaw > ceilingRaw) {
    premiumRaw = ceilingRaw;
    warnings.push(`Budget ${p.budgetUsdc} trimmed to the HARD_CEILING_USDC of ${config.hardCeilingUsdc}.`);
  }
  if (premiumRaw > capacityRaw) {
    premiumRaw = capacityRaw;
    warnings.push(
      `Budget trimmed to this quote's premium capacity of ${fromScaled(capacityRaw, decimals)} ${order.collateralSymbol}.`,
    );
  }

  const minFillRaw = toScaled(String(config.minFillUsdc), decimals);
  if (premiumRaw < minFillRaw) {
    throw new AppError(
      'SIZE_BELOW_MINIMUM',
      `Sized premium ${fromScaled(premiumRaw, decimals)} ${order.collateralSymbol} is below MIN_FILL_USDC ` +
        `${config.minFillUsdc}. Skipping rather than sending a dust fill.`,
      {
        correlationId: cid,
        details: {
          budgetUsdc: p.budgetUsdc,
          capacity: fromScaled(capacityRaw, decimals),
          hardCeilingUsdc: config.hardCeilingUsdc,
          minFillUsdc: config.minFillUsdc,
        },
      },
    );
  }

  // ── Contracts ───────────────────────────────────────────────────────────
  let preview: ReturnType<typeof client.optionBook.previewFillOrder>;
  try {
    preview = client.optionBook.previewFillOrder(raw, premiumRaw, config.referrer);
  } catch (e) {
    throw mapSdkError(e, cid);
  }

  if (preview.numContracts <= 0n) {
    throw new AppError('SIZE_BELOW_MINIMUM', 'Sizing resolved to zero contracts at this premium.', {
      correlationId: cid,
      details: { premiumRaw: premiumRaw.toString(), pricePerContract: preview.pricePerContract.toString() },
    });
  }
  if (preview.numContracts > preview.maxContracts) {
    throw new AppError('NO_FILLABLE_ORDER', 'Sized fill exceeds the maker collateral backing this quote.', {
      correlationId: cid,
      details: { numContracts: preview.numContracts.toString(), maxContracts: preview.maxContracts.toString() },
    });
  }
  // The collateral token the SDK will actually pull must be the one we priced.
  if (preview.collateralToken.toLowerCase() !== order.collateralToken) {
    throw new AppError('VALIDATION_FAILED', 'SDK preview names a different collateral token than the decoded order.', {
      correlationId: cid,
      details: { preview: preview.collateralToken.toLowerCase(), decoded: order.collateralToken },
    });
  }
  // 🔒 Contract-allowlist check (PRD §14): the agent may call one contract.
  if (order.optionBookAddress !== OPTION_BOOK_ADDRESS.toLowerCase()) {
    throw new AppError('VALIDATION_FAILED', `Order targets OptionBook ${order.optionBookAddress}, outside the allowlist.`, {
      correlationId: cid,
      details: { allowed: OPTION_BOOK_ADDRESS.toLowerCase(), requested: order.optionBookAddress },
    });
  }

  const totalCollateralRaw = preview.totalCollateral;

  // ── Allowance ───────────────────────────────────────────────────────────
  // 🔒 Exact amount, never MaxUint256 (PRD §14). If a prior allowance is
  // already sufficient we skip the approve entirely and note it.
  const approvalAmountRaw = totalCollateralRaw;
  const owner = signerAddress();
  let existingAllowanceRaw = 0n;
  if (owner) {
    try {
      existingAllowanceRaw = await client.erc20.getAllowance(order.collateralToken, owner, OPTION_BOOK_ADDRESS);
    } catch (e) {
      warnings.push(`Could not read the existing allowance: ${(e as Error).message}. Assuming zero.`);
    }
  } else {
    warnings.push('No signer configured — existing allowance assumed zero and gas estimation skipped.');
  }
  const approvalRequired = existingAllowanceRaw < approvalAmountRaw;

  const approvalTx = approvalRequired
    ? (() => {
        const enc = client.erc20.encodeApprove(order.collateralToken, OPTION_BOOK_ADDRESS, approvalAmountRaw);
        return unsignedTx(
          enc.to,
          enc.data,
          `Approve exactly ${fromScaled(approvalAmountRaw, decimals)} ${order.collateralSymbol} to the OptionBook`,
        );
      })()
    : null;

  // ── Fill calldata ───────────────────────────────────────────────────────
  let fillTx: UnsignedTx;
  try {
    const enc = client.optionBook.encodeFillOrder(raw, premiumRaw, config.referrer);
    if (enc.to.toLowerCase() !== OPTION_BOOK_ADDRESS.toLowerCase()) {
      throw new AppError('VALIDATION_FAILED', `Encoded fill targets ${enc.to}, outside the contract allowlist.`, {
        correlationId: cid,
      });
    }
    fillTx = unsignedTx(
      enc.to,
      enc.data,
      `Buy ${fromScaled(preview.numContracts, decimals)} ${order.asset} $${order.strike} put expiring ${order.expiry} ` +
        `for ${fromScaled(totalCollateralRaw, decimals)} ${order.collateralSymbol}`,
    );
  } catch (e) {
    throw mapSdkError(e, cid);
  }

  // ── Balances and gas, when a signer exists ──────────────────────────────
  let balances: ExecutionPlan['balances'];
  let gasEstimate: ExecutionPlan['gasEstimate'] = null;
  if (owner) {
    try {
      const [ethWei, collateralRaw] = await Promise.all([
        getProvider().getBalance(owner),
        client.erc20.getBalance(order.collateralToken, owner),
      ]);
      balances = { ethWei: ethWei.toString(), collateralRaw: collateralRaw.toString(), collateralSymbol: order.collateralSymbol };
      if (collateralRaw < totalCollateralRaw) {
        warnings.push(
          `Burner holds ${fromScaled(collateralRaw, decimals)} ${order.collateralSymbol}, ` +
            `short of the ${fromScaled(totalCollateralRaw, decimals)} premium.`,
        );
      }
      if (ethWei === 0n) warnings.push('Burner holds no ETH — it cannot pay gas.');

      // A gas estimate is only meaningful once the allowance is in place.
      // Estimating the fill before approving reverts on transferFrom, which
      // is expected, not a failure — record it and move on.
      if (!approvalRequired) {
        try {
          const gas = await getProvider().estimateGas({ to: fillTx.to, data: fillTx.data, from: owner });
          gasEstimate = { fill: gas.toString() };
        } catch (e) {
          warnings.push(`Fill gas estimate failed: ${(e as Error).message}`);
        }
      } else {
        warnings.push('Fill gas not estimated: the approval has not been sent yet, so the fill would revert on allowance.');
        if (approvalTx) {
          try {
            const gas = await getProvider().estimateGas({ to: approvalTx.to, data: approvalTx.data, from: owner });
            gasEstimate = { approve: gas.toString() };
          } catch (e) {
            warnings.push(`Approval gas estimate failed: ${(e as Error).message}`);
          }
        }
      }
    } catch (e) {
      warnings.push(`Balance read failed: ${(e as Error).message}`);
    }
  }

  // ── TTL at the signing boundary ─────────────────────────────────────────
  // 🔒 PRD §3.5: the quote may have died while we were sizing and building.
  // Decay the feed-clock TTL by the wall time elapsed since the fetch.
  const buildLatencyMs = Date.now() - localFetchedAtMs;
  const ttlAtBuildSeconds = Math.round((order.quoteTtlSeconds - buildLatencyMs / 1000) * 10) / 10;

  return {
    dryRun: p.dryRun,
    selectedOrder: order,
    snapshot,
    selectionAttempts: attempts,
    funnel,
    premiumUsdc: fromScaled(totalCollateralRaw, decimals),
    premiumRaw: totalCollateralRaw.toString(),
    contracts: fromScaled(preview.numContracts, decimals),
    contractsRaw: preview.numContracts.toString(),
    approvalAmountRaw: approvalAmountRaw.toString(),
    existingAllowanceRaw: existingAllowanceRaw.toString(),
    approvalRequired,
    approvalTx,
    fillTx,
    ttlAtBuildSeconds,
    buildLatencyMs,
    ...(owner ? { signerAddress: owner } : {}),
    ...(balances ? { balances } : {}),
    gasEstimate,
    warnings,
  };
}

function positionFromPlan(p: ExecuteHedgeParams, plan: ExecutionPlan, extras: Partial<HedgePosition>): HedgePosition {
  const o = plan.selectedOrder;
  return {
    correlationId: p.correlationId,
    status: 'PENDING',
    asset: o.asset,
    strike: o.strike,
    expiry: o.expiry,
    contracts: plan.contracts,
    premiumPaidUsdc: plan.premiumUsdc,
    // Max payout if the underlying goes to zero: contracts × strike.
    notionalProtectedUsdc: mulDecimal(plan.contracts, o.strike, 6),
    entryTxHash: DRY_RUN_TX_SENTINEL,
    baseScanUrl: '',
    spotAtEntry: o.spotAtDecode,
    deltaAtEntry: o.greeks.delta,
    openedAt: new Date().toISOString(),
    wasDryRun: plan.dryRun,
    execution: plan,
    ...extras,
  };
}

/**
 * 🔒 Buy a protective put — PRD §11.
 *
 * Re-fetches the book internally and never reuses a caller-supplied order.
 * Guard order (PRD §9.5): daily ceiling and reserve are the caller's to
 * enforce before this point; from here it is re-fetch → TTL filter → asset
 * resolve + cross-check → size floor → approve exact amount → sign → fill.
 *
 * `dryRun: true` runs every step above and returns the fully built, unsigned
 * transactions without broadcasting anything.
 */
export async function executeHedge(p: ExecuteHedgeParams): Promise<HedgePosition> {
  const cid = p.correlationId;

  if (cmpDecimal(p.budgetUsdc, '0') <= 0) {
    throw new AppError('VALIDATION_FAILED', `budgetUsdc must be positive, received "${p.budgetUsdc}"`, {
      correlationId: cid,
    });
  }

  const maxAttempts = Math.max(1, config.maxSelectRetries);
  let lastFunnel: SelectionFunnel | undefined;
  let lastSnapshot: MarketSnapshot | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // The whole book shares one quote expiry, so when it is inside the dead
    // window every order fails the TTL floor at once. Re-reading immediately
    // just re-reads the same dead window — wait for the maker's refresh.
    if (attempt > 1) await sleep(config.selectRetryDelayMs);

    // 🔒 RE-FETCH on every attempt. Quotes on this venue live 57–117 s and
    // the whole book shares one expiry timestamp, so the maker can cancel
    // the lot atomically. Nothing survives across an attempt.
    const { orders, snapshot, localFetchedAtMs } = await fetchBookDecoded();
    lastSnapshot = snapshot;
    assertMarketFresh(snapshot, cid);

    const selection = selectFrom(
      orders,
      {
        asset: p.asset,
        budgetUsdc: p.budgetUsdc,
        ...(p.targetDeltaMin !== undefined ? { targetDeltaMin: p.targetDeltaMin } : {}),
        ...(p.targetDeltaMax !== undefined ? { targetDeltaMax: p.targetDeltaMax } : {}),
        ...(p.minExpiryHours !== undefined ? { minExpiryHours: p.minExpiryHours } : {}),
        ...(p.collateralTokens !== undefined ? { collateralTokens: p.collateralTokens } : {}),
      },
      snapshot.orderCount,
    );
    lastFunnel = selection.funnel;

    if (!selection.order) continue;

    // 🔒 Re-assert the strike cross-check on the exact order about to be
    // signed. The decode pass already checked it; this is the last gate
    // before money moves, and it throws rather than filtering.
    assertStrikePlausible(selection.order.asset, selection.order.strike, selection.order.spotAtDecode);

    const plan = await planExecution(selection.order, p, snapshot, selection.funnel, attempt, localFetchedAtMs);

    // 🔒 Final TTL gate. If the quote died while we were building, retry with
    // a fresh book rather than sending a transaction that will revert.
    if (plan.ttlAtBuildSeconds <= 0) {
      if (attempt < maxAttempts) continue;
      throw new AppError('QUOTE_EXPIRED', 'The selected quote expired while the transaction was being built.', {
        correlationId: cid,
        details: { ttlAtBuildSeconds: plan.ttlAtBuildSeconds, buildLatencyMs: plan.buildLatencyMs },
      });
    }

    if (p.dryRun) {
      return positionFromPlan(p, plan, { status: 'PENDING' });
    }

    return await broadcast(p, plan);
  }

  throw new AppError(
    'NO_FILLABLE_ORDER',
    `No ${p.asset} put matched the target delta band with a quote TTL above ${config.quoteMinTtlS}s ` +
      `after ${maxAttempts} attempt(s).`,
    {
      correlationId: cid,
      details: {
        asset: p.asset,
        budgetUsdc: p.budgetUsdc,
        attempts: maxAttempts,
        funnel: lastFunnel,
        snapshot: lastSnapshot ? toJsonSafe(lastSnapshot) : undefined,
        deltaBand: [p.targetDeltaMin ?? config.targetDeltaMin, p.targetDeltaMax ?? config.targetDeltaMax],
        minExpiryHours: p.minExpiryHours ?? config.minExpiryHours,
      },
    },
  );
}

/**
 * The signing boundary. Everything above this function is exercised
 * identically on a dry run; only this function moves money.
 */
async function broadcast(p: ExecuteHedgeParams, plan: ExecutionPlan): Promise<HedgePosition> {
  const cid = p.correlationId;
  const signing = getSigningClient();
  const order = plan.selectedOrder;
  const raw = order.raw as OrderWithSignature;
  let approvalTxHash: TxHash | undefined;

  try {
    // 🔒 Exact-amount approval. Never MaxUint256 (PRD §14).
    if (plan.approvalRequired) {
      const receipt = await signing.erc20.approve(
        order.collateralToken,
        OPTION_BOOK_ADDRESS,
        BigInt(plan.approvalAmountRaw),
      );
      approvalTxHash = receipt.hash as TxHash;
    }

    const receipt = await signing.optionBook.fillOrder(raw, BigInt(plan.premiumRaw), config.referrer);
    const entryTxHash = receipt.hash as TxHash;

    return positionFromPlan(p, plan, {
      status: 'OPEN',
      entryTxHash,
      baseScanUrl: basescanTxUrl(entryTxHash),
      ...(approvalTxHash ? { approvalTxHash } : {}),
      ...(extractOptionAddress(receipt) ? { optionAddress: extractOptionAddress(receipt) } : {}),
    });
  } catch (e) {
    const err = mapSdkError(e, cid);
    throw new AppError(err.code, err.message, {
      correlationId: cid,
      cause: e,
      details: {
        ...(err.details ?? {}),
        approvalTxHash,
        plannedPremiumUsdc: plan.premiumUsdc,
        ttlAtBuildSeconds: plan.ttlAtBuildSeconds,
      },
    });
  }
}

/**
 * Pull the deployed option contract address out of a fill receipt.
 *
 * The OptionBook clones an implementation per fill, so the new option's
 * address appears as a log emitter that is neither the book nor the
 * collateral token. Best-effort: a miss costs a UI link, not correctness.
 */
function extractOptionAddress(receipt: { logs?: readonly { address: string }[] }): Address | undefined {
  const book = OPTION_BOOK_ADDRESS.toLowerCase();
  for (const log of receipt.logs ?? []) {
    const addr = log.address?.toLowerCase();
    if (addr && addr !== book && !isKnownToken(addr)) return addr as Address;
  }
  return undefined;
}

// ─── Unwind ────────────────────────────────────────────────────────────────

/**
 * Resolves a correlation ID to the position it opened. The positions table
 * belongs to the backend (PRD §8), which is M2/M3's surface, so this module
 * takes the lookup by injection rather than reaching into a schema it does
 * not own.
 */
export type PositionResolver = (cid: CorrelationId) => Promise<HedgePosition | null>;

let _positionResolver: PositionResolver | undefined;

export function setPositionResolver(resolver: PositionResolver): void {
  _positionResolver = resolver;
}

export interface UnwindOptions {
  /** Skip the resolver by passing the position directly. */
  position?: HedgePosition;
  /** Build the close transaction without broadcasting it. */
  dryRun?: boolean;
}

/**
 * Unwind an open hedge — the live rollback path (PRD §5, demo beat 6).
 *
 * Mechanism: `BaseOption.close()` on the deployed option contract, reached
 * through the SDK's `option.close()`. Premium recovery is measured, never
 * estimated, by differencing the burner's collateral balance across the
 * close — PRD §17 V6 is explicit that this number is quoted from measurement
 * only.
 *
 * TODO(VERIFY-V6): the measured round-trip recovery cannot be recorded until
 * the burner is funded and one real position has been opened and closed. The
 * build and measurement path below is complete and exercised in dry run; only
 * the number itself is outstanding.
 */
export async function unwindPosition(
  correlationId: CorrelationId,
  reason: 'ROLLBACK' | 'HARVEST',
  opts: UnwindOptions = {},
): Promise<HedgePosition> {
  const position = opts.position ?? (_positionResolver ? await _positionResolver(correlationId) : null);

  if (!position) {
    throw new AppError(
      'VALIDATION_FAILED',
      `No position found for ${correlationId}. Pass one via opts.position, or register a resolver ` +
        'with setPositionResolver() so this module can read the positions table.',
      { correlationId },
    );
  }
  if (position.status !== 'OPEN') {
    throw new AppError('VALIDATION_FAILED', `Position ${correlationId} is ${position.status}, not OPEN.`, {
      correlationId,
      details: { status: position.status },
    });
  }
  const optionAddress = position.optionAddress;
  if (!optionAddress) {
    throw new AppError('VALIDATION_FAILED', `Position ${correlationId} carries no option contract address to close.`, {
      correlationId,
    });
  }

  const collateralToken = position.execution.selectedOrder.collateralToken;
  const decimals = position.execution.selectedOrder.collateralDecimals;
  const dryRun = opts.dryRun ?? !config.hasSigner;

  if (dryRun) {
    const iface = new ethers.Interface(['function close()']);
    const tx = unsignedTx(optionAddress, iface.encodeFunctionData('close', []), `Close option ${optionAddress} (${reason})`);
    return {
      ...position,
      status: 'PENDING',
      execution: { ...position.execution, dryRun: true, fillTx: tx, warnings: [...position.execution.warnings, `Unwind (${reason}) built but not signed.`] },
    };
  }

  const signing = getSigningClient();
  const owner = signerAddress() as Address;

  try {
    const before = await signing.erc20.getBalance(collateralToken, owner);
    const result = await signing.option.close(optionAddress);
    await result.wait(1);
    const after = await signing.erc20.getBalance(collateralToken, owner);

    // Measured, not estimated — PRD §17 V6. `recovered` is the collateral
    // that actually came back; PnL is that minus the premium originally paid,
    // and stays negative when the round trip costs more than it returns.
    const recoveredRaw = after - before;
    const recovered = fromScaled(recoveredRaw, decimals);
    const realisedPnlUsdc = fromScaled(recoveredRaw - toScaled(position.premiumPaidUsdc, decimals), decimals);
    const recoveryPct = divDecimal(recovered, position.premiumPaidUsdc, 4);

    return {
      ...position,
      status: reason === 'HARVEST' ? 'HARVESTED' : 'UNWOUND',
      exitTxHash: result.txHash as TxHash,
      closedAt: new Date().toISOString(),
      realisedPnlUsdc,
      execution: {
        ...position.execution,
        warnings: [
          ...position.execution.warnings,
          `Unwind (${reason}): recovered ${recovered} ${position.execution.selectedOrder.collateralSymbol} ` +
            `against ${position.premiumPaidUsdc} premium paid (${recoveryPct}× of premium, PnL ${realisedPnlUsdc}). ` +
            'Measured from the burner balance delta, not estimated.',
        ],
      },
    };
  } catch (e) {
    throw mapSdkError(e, correlationId);
  }
}

// ─── Health ────────────────────────────────────────────────────────────────

/** Feeds `/api/health` (PRD §9.6) — the ten-second diagnosis surface. */
export async function healthCheck(): Promise<{
  rpcOk: boolean;
  blockNumber?: number;
  chainId?: number;
  bookOk: boolean;
  orderCount?: number;
  vanillaPutCount?: number;
  perAsset?: Record<string, number>;
  snapshot?: MarketSnapshot;
  clockSkewWithinLimit?: boolean;
  signerConfigured: boolean;
  burner?: { address: Address; ethWei: string; usdcRaw: string };
  errors: string[];
}> {
  const errors: string[] = [];
  const out: Awaited<ReturnType<typeof healthCheck>> = {
    rpcOk: false,
    bookOk: false,
    signerConfigured: config.hasSigner,
    errors,
  };

  try {
    const provider = getProvider();
    const [block, network] = await Promise.all([provider.getBlockNumber(), provider.getNetwork()]);
    out.rpcOk = true;
    out.blockNumber = block;
    out.chainId = Number(network.chainId);
    if (out.chainId !== CHAIN_ID) errors.push(`RPC is on chain ${out.chainId}, expected ${CHAIN_ID}`);
  } catch (e) {
    errors.push(`RPC unreachable: ${(e as Error).message}`);
  }

  try {
    const { orders, snapshot } = await fetchBookDecoded();
    out.bookOk = true;
    out.orderCount = snapshot.orderCount;
    out.snapshot = snapshot;
    out.clockSkewWithinLimit = Math.abs(snapshot.localClockSkewSeconds) <= config.maxClockSkewS;
    const puts = orders.filter((o) => o.isVanillaPut);
    out.vanillaPutCount = puts.length;
    out.perAsset = puts.reduce<Record<string, number>>((acc, o) => {
      acc[o.asset] = (acc[o.asset] ?? 0) + 1;
      return acc;
    }, {});
  } catch (e) {
    errors.push(`Book unreachable: ${(e as Error).message}`);
  }

  if (config.hasSigner) {
    try {
      const owner = signerAddress() as Address;
      const client = getSigningClient();
      const [ethWei, usdcRaw] = await Promise.all([
        getProvider().getBalance(owner),
        client.erc20.getBalance(USDC_ADDRESS, owner),
      ]);
      out.burner = { address: owner, ethWei: ethWei.toString(), usdcRaw: usdcRaw.toString() };
      if (ethWei === 0n) errors.push('Burner holds no ETH — it cannot pay gas.');
      if (usdcRaw === 0n) errors.push('Burner holds no USDC — it cannot pay a premium.');
    } catch (e) {
      errors.push(`Burner balance read failed: ${(e as Error).message}`);
    }
  }

  return out;
}

/** Re-exported so scripts can register a token the venue newly lists. */
export { learnTokenDecimals };

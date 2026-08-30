/**
 * Book decode and strike selection — PRD §3.3, §3.5, §10.5.
 *
 * Offline: these drive `decodeOrders` and `selectFrom` with fabricated books
 * built from the golden fixture, so every filter can be exercised
 * deterministically. The live-book behaviour is verified separately by
 * `scripts/probe-book.ts` and `scripts/dry-run-hedge.ts`.
 */

import { describe, expect, it } from 'vitest';
import type { OrderWithSignature } from '@thetanuts-finance/thetanuts-client';
import golden from '../fixtures/order.eth-put-2400.json';
import { decodeOrders, filterDecoded, selectFrom } from '../lib/thetanuts';
import type { MarketSnapshot } from '../types/index';

const PUT = '0x7355EB92dfb0503DB558a70c10843618932ab290';
const PUT_SPREAD = '0x02Fe0d9635e0139DBB3768a5d5Db404Fd84d9134';
const PHYSICAL_PUT = '0x6aD53DD058bea004829cCf58a282C21a7Df02DcA';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const aBasUSDC = '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB';
const SOL_FEED = '0x975043adBb80fc32276CbF9Bbcfd4A601a12462D';

// A real measured metadata.currentTime, rounded to a whole second so TTL
// arithmetic in these tests is exact. The decoder keeps sub-second precision
// (see the fractional-millisecond case below).
const FEED_NOW_MS = 1788062165000;
const FEED_NOW_S = FEED_NOW_MS / 1000;

function snapshot(overrides: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    prices: { ETH: '2443', BTC: '78125.26', SOL: '105.09', XRP: '1.3925', BNB: '694.91', AVAX: '7.291' },
    lastUpdated: new Date(FEED_NOW_MS).toISOString(),
    clockSkewSeconds: 0,
    orderCount: 1,
    fetchedAt: new Date(FEED_NOW_MS).toISOString(),
    feedNow: new Date(FEED_NOW_MS).toISOString(),
    feedAgeSeconds: 0,
    localClockSkewSeconds: 0,
    feedNowMs: FEED_NOW_MS,
    ...overrides,
  };
}

let sigCounter = 0;

/** Build a raw SDK-shaped order from the golden fixture with overrides. */
function makeOrder(o: {
  feed?: string;
  implementation?: string;
  isCall?: boolean;
  isLong?: boolean;
  strike?: string;
  price?: string;
  delta?: number;
  ttlSeconds?: number;
  expiryHours?: number;
  collateral?: string;
  available?: string;
  strikeCount?: number;
} = {}): OrderWithSignature {
  const strike = o.strike ?? '240000000000';
  const strikes = Array.from({ length: o.strikeCount ?? 1 }, (_, i) =>
    i === 0 ? strike : String(BigInt(strike) - BigInt(i) * 10_000_000_000n),
  );
  // Each order needs a distinct signature: the decoder derives its identity
  // from the signature hash.
  const signature = `0x${(++sigCounter).toString(16).padStart(130, '0')}`;

  return {
    order: {
      ...golden.order,
      price: BigInt(o.price ?? '215059967'),
      numContracts: 0n,
      nonce: BigInt(golden.order.nonce),
      expiry: BigInt(FEED_NOW_S + Math.round((o.expiryHours ?? 24) * 3600)),
      deadline: BigInt(FEED_NOW_S + 86400),
      strikes: strikes.map(BigInt),
      strikePrice: BigInt(strike),
      collateralToken: o.collateral ?? USDC,
    },
    signature,
    availableAmount: BigInt(o.available ?? '10000000000'),
    makerAddress: golden.makerAddress,
    rawApiData: {
      ...golden.rawApiData,
      collateral: o.collateral ?? USDC,
      priceFeed: o.feed ?? golden.rawApiData.priceFeed,
      implementation: o.implementation ?? PUT,
      strikes,
      isCall: o.isCall ?? false,
      isLong: o.isLong ?? false,
      orderExpiryTimestamp: FEED_NOW_S + (o.ttlSeconds ?? 90),
      greeks: { ...golden.rawApiData.greeks, delta: o.delta ?? -0.0887 },
    },
  } as unknown as OrderWithSignature;
}

const SELECT = { asset: 'ETH', budgetUsdc: '3.00' };

describe('decoding the golden fixture through the real decoder', () => {
  const { orders, rejected } = decodeOrders([makeOrder()], snapshot());
  const o = orders[0]!;

  it('decodes exactly one order with no rejections', () => {
    expect(orders).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it('resolves the asset from the price feed', () => {
    expect(o.asset).toBe('ETH');
    expect(o.priceFeed).toBe(golden.rawApiData.priceFeed.toLowerCase());
  });

  it('decodes strike and premium at 8dp', () => {
    expect(o.strike).toBe('2400');
    expect(o.premiumPerContract).toBe('2.15059967');
  });

  it('decodes availableAmount at the collateral token scale', () => {
    expect(o.availableAmount).toBe('10000');
    expect(o.collateralDecimals).toBe(6);
    expect(o.collateralSymbol).toBe('USDC');
  });

  it('flags it as a vanilla put and names the implementation', () => {
    expect(o.isVanillaPut).toBe(true);
    expect(o.implementationName).toBe('PUT');
  });

  it('measures quote TTL against the FEED clock, not Date.now()', () => {
    expect(o.quoteTtlSeconds).toBe(90);
  });

  it('keeps sub-second precision in the TTL, since the feed clock carries millis', () => {
    // The live feed's currentTime is a millisecond value, so TTL is
    // fractional. The decoder keeps one decimal — enough to see a quote
    // dying, without pretending to millisecond accuracy over a network hop.
    const { orders: sub } = decodeOrders([makeOrder()], snapshot({ feedNowMs: FEED_NOW_MS + 917 }));
    expect(sub[0]!.quoteTtlSeconds).toBe(89.1);
  });

  it('keeps the untouched SDK object for signing', () => {
    expect(o.raw).toBeDefined();
    expect((o.raw as OrderWithSignature).signature).toBeTruthy();
  });

  it('carries no bigint anywhere except inside `raw`', () => {
    const { raw, ...rest } = o;
    expect(() => JSON.stringify(rest)).not.toThrow();
    void raw;
  });
});

describe('decode rejects rather than guessing', () => {
  it('rejects an unresolved price feed', () => {
    const { orders, rejected } = decodeOrders([makeOrder({ feed: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' })], snapshot());
    expect(orders).toHaveLength(0);
    expect(rejected[0]?.reason).toMatch(/Unresolved price feed/);
  });

  it('rejects an unknown collateral token instead of assuming 18 decimals', () => {
    const { orders, rejected } = decodeOrders(
      [makeOrder({ collateral: '0x1111111111111111111111111111111111111111' })],
      snapshot(),
    );
    expect(orders).toHaveLength(0);
    expect(rejected[0]?.reason).toMatch(/Unknown collateral token/);
  });

  it('rejects a vanilla put whose strike is implausible for its asset', () => {
    // An ETH-priced strike carrying the SOL feed: the mislabelled-map case.
    const { orders, rejected } = decodeOrders([makeOrder({ feed: SOL_FEED })], snapshot());
    expect(orders).toHaveLength(0);
    expect(rejected[0]?.reason).toMatch(/deviates/);
  });

  it('one bad order never blinds the decoder to the good ones', () => {
    const { orders, rejected } = decodeOrders(
      [makeOrder({ feed: '0xdead' }), makeOrder(), makeOrder({ collateral: '0x1111111111111111111111111111111111111111' })],
      snapshot(),
    );
    expect(orders).toHaveLength(1);
    expect(rejected).toHaveLength(2);
  });

  it('accepts a non-vanilla product for display but never marks it vanilla', () => {
    const { orders } = decodeOrders([makeOrder({ implementation: PUT_SPREAD, strikeCount: 2 })], snapshot());
    expect(orders[0]?.isVanillaPut).toBe(false);
    expect(orders[0]?.implementationName).toBe('PUT_SPREAD');
    expect(orders[0]?.strikes).toHaveLength(2);
  });
});

describe('filtering', () => {
  const { orders } = decodeOrders(
    [
      makeOrder(),
      makeOrder({ isCall: true }),
      makeOrder({ implementation: PUT_SPREAD, strikeCount: 2 }),
      makeOrder({ ttlSeconds: 10 }),
    ],
    snapshot(),
  );

  it('filters to vanilla puts only', () => {
    expect(filterDecoded(orders, { vanillaPutsOnly: true })).toHaveLength(2);
  });

  it('filters on TTL', () => {
    expect(filterDecoded(orders, { minTtlSeconds: 60 })).toHaveLength(3);
  });

  it('filters on asset', () => {
    expect(filterDecoded(orders, { asset: 'ETH' })).toHaveLength(4);
    expect(filterDecoded(orders, { asset: 'BTC' })).toHaveLength(0);
  });
});

describe('strike selection — PRD §10.5', () => {
  function select(raws: OrderWithSignature[], p = SELECT) {
    const { orders } = decodeOrders(raws, snapshot());
    return selectFrom(orders, p, raws.length);
  }

  it('picks a put inside the delta band', () => {
    const out = select([makeOrder({ delta: -0.0887 })]);
    expect(out.order).not.toBeNull();
    expect(out.funnel.deltaBandOk).toBe(1);
  });

  it('excludes a put outside the delta band on either side', () => {
    expect(select([makeOrder({ delta: -0.45 })]).order).toBeNull(); // too deep ITM
    expect(select([makeOrder({ delta: -0.001 })]).order).toBeNull(); // too far OTM
  });

  it('🔒 excludes an order whose quote TTL is below the floor, and reports the best rejected TTL', () => {
    const out = select([makeOrder({ ttlSeconds: 12 })]);
    expect(out.order).toBeNull();
    expect(out.funnel.ttlOk).toBe(0);
    expect(out.funnel.bestRejectedTtlSeconds).toBeCloseTo(12, 0);
  });

  it('🔒 excludes a PUT_SPREAD even though isCall is false', () => {
    const out = select([makeOrder({ implementation: PUT_SPREAD, strikeCount: 2 })]);
    expect(out.order).toBeNull();
    expect(out.funnel.vanillaPuts).toBe(0);
  });

  it('🔒 excludes a PHYSICAL_PUT — it settles in the underlying', () => {
    const out = select([makeOrder({ implementation: PHYSICAL_PUT, isLong: true })]);
    expect(out.order).toBeNull();
    expect(out.funnel.vanillaPuts).toBe(0);
  });

  it('excludes a call', () => {
    expect(select([makeOrder({ isCall: true })]).order).toBeNull();
  });

  it('excludes collateral the burner cannot pay in', () => {
    const out = select([makeOrder({ collateral: aBasUSDC })]);
    expect(out.order).toBeNull();
    expect(out.funnel.vanillaPuts).toBe(1);
    expect(out.funnel.collateralSupported).toBe(0);
  });

  it('accepts non-USDC collateral when the caller explicitly allows it', () => {
    const { orders } = decodeOrders([makeOrder({ collateral: aBasUSDC })], snapshot());
    const out = selectFrom(orders, { ...SELECT, collateralTokens: [aBasUSDC] }, 1);
    expect(out.order).not.toBeNull();
  });

  it('excludes an expiry inside the minimum horizon', () => {
    const out = selectFrom(
      decodeOrders([makeOrder({ expiryHours: 1 })], snapshot()).orders,
      { ...SELECT, minExpiryHours: 168 },
      1,
    );
    expect(out.order).toBeNull();
    expect(out.funnel.expiryHorizonOk).toBe(0);
  });

  it('prefers the nearest qualifying expiry, then the cheaper premium', () => {
    const out = select([
      makeOrder({ expiryHours: 52, price: '100000000' }), // $1.00, further out
      makeOrder({ expiryHours: 28, price: '400000000' }), // $4.00, nearer
      makeOrder({ expiryHours: 28, price: '200000000' }), // $2.00, nearer and cheaper
    ]);
    expect(out.order?.premiumPerContract).toBe('2');
    expect(out.order?.hoursToExpiry).toBeCloseTo(28, 0);
  });

  it('excludes an order whose premium capacity is below MIN_FILL_USDC', () => {
    // 1 USDC of maker collateral against a $2400 strike backs ~0.0004
    // contracts, so the quote can absorb well under a cent of premium.
    const out = select([makeOrder({ available: '1000000' })]);
    expect(out.order).toBeNull();
    expect(out.funnel.affordable).toBe(0);
  });

  it('records the full funnel so NO_FILLABLE_ORDER is explainable', () => {
    const out = select([
      makeOrder({ feed: '0xdead' }),
      makeOrder({ isCall: true }),
      makeOrder({ implementation: PUT_SPREAD, strikeCount: 2 }),
      makeOrder({ collateral: aBasUSDC }),
      makeOrder({ ttlSeconds: 5 }),
      makeOrder({ delta: -0.9 }),
      makeOrder({ delta: -0.1 }),
    ]);
    expect(out.funnel.fetched).toBe(7);
    expect(out.funnel.assetResolved).toBe(6); // the bad feed never decoded
    expect(out.funnel.vanillaPuts).toBe(4);
    expect(out.funnel.collateralSupported).toBe(3);
    expect(out.funnel.ttlOk).toBe(2);
    expect(out.funnel.deltaBandOk).toBe(1);
    expect(out.order).not.toBeNull();
  });

  it('returns null, never throws, when nothing qualifies', () => {
    expect(() => select([])).not.toThrow();
    expect(select([]).order).toBeNull();
  });
});

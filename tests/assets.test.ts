/**
 * 🔒 AssetRegistry tests — PRD §3.4, §3.4.1.
 *
 * Hedging the wrong asset is the single most damaging bug available here, and
 * the one that looks most like working software. These tests assert that the
 * registry refuses rather than guesses, on both of its independent guards.
 */

import { describe, expect, it } from 'vitest';
import golden from '../fixtures/order.eth-put-2400.json';
import {
  PRICE_FEED_TO_ASSET,
  VANILLA_PUT_IMPLEMENTATION,
  assertStrikePlausible,
  assetForFeed,
  feedFor,
  implementationInfo,
  isVanillaPut,
  registrySummary,
  strikeDeviation,
  supportedAssets,
  tryAssetForFeed,
} from '../lib/assets';
import { AppError } from '../lib/errors';

const ETH_FEED = '0x71041dddad3595F9CEd3DcCFBe3D1F4b0a16Bb70';
const BTC_FEED = '0x64c911996D3c6aC71f9b455B1E8E7266BcbD848F';
const WETH = '0x4200000000000000000000000000000000000006';
const ZERO = '0x0000000000000000000000000000000000000000';

// Implementations observed on the live book — PRD §3.1 plus SDK chain config.
const PUT = '0x7355EB92dfb0503DB558a70c10843618932ab290';
const PUT_SPREAD = '0x02Fe0d9635e0139DBB3768a5d5Db404Fd84d9134';
const PUT_FLY = '0x4fd2C6D271cC6FF3EbD2027da9815a0608d03AA3';
const PHYSICAL_PUT = '0x6aD53DD058bea004829cCf58a282C21a7Df02DcA';
const RANGER = '0x9980ec85bc6fE07340adb36c76FA093bb6D4FcBc';

describe('the verified feed map — PRD §3.4.1', () => {
  it('resolves all six PRD-verified feeds', () => {
    expect(assetForFeed(ETH_FEED)).toBe('ETH');
    expect(assetForFeed(BTC_FEED)).toBe('BTC');
    expect(assetForFeed('0x975043adBb80fc32276CbF9Bbcfd4A601a12462D')).toBe('SOL');
    expect(assetForFeed('0x9f0C1dD78C4CBdF5b9cf923a549A201EdC676D34')).toBe('XRP');
    expect(assetForFeed('0x4b7836916781CAAfbb7Bd1E5FDd20ED544B453b1')).toBe('BNB');
    expect(assetForFeed('0xE70f2D34Fd04046aaEC26a198A35dD8F2dF5cd92')).toBe('AVAX');
  });

  it('is case-insensitive — the PRD map keys are lowercased', () => {
    expect(assetForFeed(ETH_FEED.toLowerCase())).toBe('ETH');
    expect(Object.keys(PRICE_FEED_TO_ASSET).every((k) => k === k.toLowerCase())).toBe(true);
  });

  it('REFUSES an unknown feed rather than guessing', () => {
    expect(() => assetForFeed('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toThrow(AppError);
    try {
      assetForFeed('0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef');
    } catch (e) {
      expect((e as AppError).code).toBe('ASSET_UNRESOLVED');
    }
  });

  it('REFUSES an order that carries no price feed at all', () => {
    expect(() => assetForFeed(undefined)).toThrow(AppError);
    expect(() => assetForFeed('')).toThrow(AppError);
  });

  it('offers a non-throwing form for bulk decode', () => {
    expect(tryAssetForFeed(ETH_FEED)).toBe('ETH');
    expect(tryAssetForFeed('0xdead')).toBeNull();
    expect(tryAssetForFeed(null)).toBeNull();
  });

  it('maps asset back to feed', () => {
    expect(feedFor('ETH')).toBe(ETH_FEED.toLowerCase());
    expect(feedFor('eth')).toBe(ETH_FEED.toLowerCase());
    expect(feedFor('DOES_NOT_EXIST')).toBeUndefined();
  });

  it('covers at least the PRD six, and agrees with the shipped SDK config', () => {
    for (const asset of ['ETH', 'BTC', 'SOL', 'XRP', 'BNB', 'AVAX']) {
      expect(supportedAssets()).toContain(asset);
    }
    // Loading the module cross-checks PRD against SDK and throws on conflict,
    // so reaching this line at all proves the two sources agree.
    expect(registrySummary().feedCount).toBeGreaterThanOrEqual(6);
  });
});

describe('underlyingToken is NOT the discriminator — PRD §3.4', () => {
  it('the golden ETH put carries WETH as underlying, but ETH comes from the feed', () => {
    expect(golden.order.underlyingToken).toBe(WETH);
    expect(assetForFeed(golden.rawApiData.priceFeed)).toBe('ETH');
  });

  it('a zero-address underlying still resolves, because the feed decides', () => {
    // Cash-settled synthetics (SOL, XRP, BNB, AVAX) all carry underlying 0x0.
    expect(ZERO).toBe('0x0000000000000000000000000000000000000000');
    expect(assetForFeed('0x975043adBb80fc32276CbF9Bbcfd4A601a12462D')).toBe('SOL');
  });
});

describe('the strike cross-check — the second, independent guard', () => {
  it('accepts a strike near spot and returns the deviation', () => {
    const dev = assertStrikePlausible('ETH', '2400', '2443');
    expect(dev).toBeCloseTo(0.0176, 3);
  });

  it('accepts the PRD resolution run, whose worst genuine match was 2.4%', () => {
    expect(assertStrikePlausible('ETH', '2400', '2458.60')).toBeLessThan(0.025);
    expect(assertStrikePlausible('BTC', '78000', '78130.96')).toBeLessThan(0.025);
    expect(assertStrikePlausible('AVAX', '7.3', '7.294')).toBeLessThan(0.025);
  });

  it('REFUSES a strike that is off by an order of magnitude — the mislabelled-feed case', () => {
    // An ETH strike checked against SOL spot: what a swapped feed map produces.
    expect(() => assertStrikePlausible('SOL', '2400', '105.22')).toThrow(AppError);
    try {
      assertStrikePlausible('SOL', '2400', '105.22');
    } catch (e) {
      expect((e as AppError).code).toBe('ASSET_UNRESOLVED');
    }
  });

  it('REFUSES when there is no usable spot price', () => {
    expect(() => assertStrikePlausible('ETH', '2400', '0')).toThrow(AppError);
    expect(() => assertStrikePlausible('ETH', '2400', 'not-a-number')).toThrow(AppError);
  });

  it('REFUSES an implausible strike', () => {
    expect(() => assertStrikePlausible('ETH', '0', '2443')).toThrow(AppError);
  });

  it('reports infinite deviation for an unusable spot rather than NaN', () => {
    expect(strikeDeviation('2400', '0')).toBe(Number.POSITIVE_INFINITY);
    expect(strikeDeviation('2400', '2400')).toBe(0);
  });
});

describe('isCall === false does NOT mean vanilla put', () => {
  it('accepts the one instrument we buy', () => {
    expect(isVanillaPut({ implementation: PUT, isCall: false, isLong: false, strikeCount: 1 })).toBe(true);
    expect(isVanillaPut({ implementation: PUT.toLowerCase(), isCall: false, isLong: false, strikeCount: 1 })).toBe(true);
  });

  it('rejects a PUT_SPREAD — 21 live on the book, and it caps the protection', () => {
    expect(isVanillaPut({ implementation: PUT_SPREAD, isCall: false, isLong: false, strikeCount: 2 })).toBe(false);
  });

  it('rejects a PUT_FLY — not downside protection at all', () => {
    expect(isVanillaPut({ implementation: PUT_FLY, isCall: false, isLong: false, strikeCount: 3 })).toBe(false);
  });

  it('rejects a PHYSICAL_PUT — settles in the underlying, which a USDC burner cannot deliver', () => {
    expect(isVanillaPut({ implementation: PHYSICAL_PUT, isCall: false, isLong: true, strikeCount: 1 })).toBe(false);
  });

  it('rejects a RANGER', () => {
    expect(isVanillaPut({ implementation: RANGER, isCall: true, isLong: false, strikeCount: 4 })).toBe(false);
  });

  it('rejects a call, and rejects the maker-long side', () => {
    expect(isVanillaPut({ implementation: PUT, isCall: true, isLong: false, strikeCount: 1 })).toBe(false);
    expect(isVanillaPut({ implementation: PUT, isCall: false, isLong: true, strikeCount: 1 })).toBe(false);
  });

  it('rejects an unknown implementation — the safe direction', () => {
    expect(isVanillaPut({ implementation: ZERO, isCall: false, isLong: false, strikeCount: 1 })).toBe(false);
    expect(isVanillaPut({ implementation: null, isCall: false, isLong: false, strikeCount: 1 })).toBe(false);
  });

  it('accepts the golden fixture, which is a genuine vanilla put', () => {
    expect(
      isVanillaPut({
        implementation: golden.rawApiData.implementation,
        isCall: golden.rawApiData.isCall,
        isLong: golden.rawApiData.isLong,
        strikeCount: golden.order.strikes.length,
      }),
    ).toBe(true);
  });
});

describe('implementation resolution', () => {
  it('names every implementation observed on the live book', () => {
    expect(implementationInfo(PUT).name).toBe('PUT');
    expect(implementationInfo(PUT_SPREAD).name).toBe('PUT_SPREAD');
    expect(implementationInfo(PUT_FLY).name).toBe('PUT_FLY');
    expect(implementationInfo(PHYSICAL_PUT).name).toBe('PHYSICAL_PUT');
    expect(implementationInfo(RANGER).name).toBe('RANGER');
  });

  it('returns UNKNOWN rather than throwing for an address it does not know', () => {
    expect(implementationInfo('0x1234567890123456789012345678901234567890').name).toBe('UNKNOWN');
    expect(implementationInfo(undefined).name).toBe('UNKNOWN');
  });

  it('pins the vanilla PUT implementation to the PRD §3.1 address', () => {
    expect(VANILLA_PUT_IMPLEMENTATION).toBe(PUT.toLowerCase());
  });
});

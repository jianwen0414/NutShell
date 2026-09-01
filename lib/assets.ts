/**
 * 🔒 AssetRegistry — PRD §3.4, §3.4.1.
 *
 * The single most damaging bug available in this codebase is hedging the
 * wrong asset, because it looks exactly like working software. This module
 * exists to make that impossible.
 *
 * Two facts drive the design:
 *
 * 1. **The asset cannot be derived from `underlyingToken`.** It takes only
 *    three values across the whole book, and one of them is the zero address
 *    (measured: 100 WETH / 116 WBTC / 74 zero-address out of 290 orders).
 *    The zero-address bucket is cash-settled synthetics — SOL, XRP, BNB,
 *    AVAX — not corrupt data. The discriminator is `rawApiData.priceFeed`.
 *
 * 2. **`isCall === false` does not mean "vanilla put".** Measured against the
 *    live book, orders with `isCall: false` span five implementations: PUT,
 *    PUT_SPREAD, PUT_FLY, PHYSICAL_PUT, and (via `isCall: true`) RANGER.
 *    A put spread or a butterfly is not protective downside cover, and a
 *    PHYSICAL_PUT settles in the underlying rather than cash. Selecting on
 *    direction alone would buy the wrong instrument. The discriminator is
 *    `rawApiData.implementation`.
 *
 * Both resolutions refuse rather than guess.
 */

import { buildPriceFeedSymbolMap, getOptionImplementationInfo } from '@thetanuts-finance/thetanuts-client';
import { AppError } from './errors';
import { CHAIN_ID, PUT_IMPLEMENTATION_ADDRESS, config } from './config';
import type { Address } from '../types/index';

/**
 * 🔒 The verified feed map — PRD §3.4.1.
 *
 * All six feeds were resolved by clustering each feed's strikes against
 * `getMarketData()` spot prices; every match landed within 2.4%, with each
 * runner-up an order of magnitude further away. Keys are LOWERCASED.
 */
export const PRICE_FEED_TO_ASSET: Record<string, string> = {
  '0x71041dddad3595f9ced3dccfbe3d1f4b0a16bb70': 'ETH',
  '0x64c911996d3c6ac71f9b455b1e8e7266bcbd848f': 'BTC',
  '0x975043adbb80fc32276cbf9bbcfd4a601a12462d': 'SOL',
  '0x9f0c1dd78c4cbdf5b9cf923a549a201edc676d34': 'XRP',
  '0x4b7836916781caafbb7bd1e5fdd20ed544b453b1': 'BNB',
  '0xe70f2d34fd04046aaec26a198a35dd8f2df5cd92': 'AVAX',
};

/** 🔒 The vanilla, cash-settled PUT implementation — the only one we buy. */
export const VANILLA_PUT_IMPLEMENTATION = PUT_IMPLEMENTATION_ADDRESS.toLowerCase();

/**
 * The effective feed→asset map: the PRD's six verified feeds, plus any
 * additional feed the SDK's chain config declares (currently DOGE and PAXG).
 *
 * The two sources are cross-checked at module load. A DISAGREEMENT on a
 * shared key is fatal: it means either the PRD measurement or the shipped SDK
 * config is wrong, and trading through that ambiguity is exactly the
 * wrong-asset failure this module exists to prevent.
 */
function buildRegistry(): { map: Record<string, string>; sdkOnly: string[]; prdOnly: string[] } {
  const sdkMap = buildPriceFeedSymbolMap(CHAIN_ID);
  const map: Record<string, string> = {};
  const sdkOnly: string[] = [];
  const prdOnly: string[] = [];

  for (const [feed, asset] of Object.entries(PRICE_FEED_TO_ASSET)) {
    const key = feed.toLowerCase();
    const sdkAsset = sdkMap[key];
    if (sdkAsset !== undefined && sdkAsset !== asset) {
      throw new AppError(
        'ASSET_UNRESOLVED',
        `Price-feed map conflict for ${key}: PRD §3.4.1 says ${asset}, SDK chain config says ${sdkAsset}. ` +
          'Refusing to load — one source is wrong and a wrong map hedges the wrong asset.',
        { details: { feed: key, prd: asset, sdk: sdkAsset } },
      );
    }
    if (sdkAsset === undefined) prdOnly.push(key);
    map[key] = asset;
  }

  for (const [feed, asset] of Object.entries(sdkMap)) {
    const key = feed.toLowerCase();
    if (map[key] === undefined) {
      map[key] = asset;
      sdkOnly.push(key);
    }
  }

  return { map, sdkOnly, prdOnly };
}

const { map: FEED_MAP, sdkOnly: SDK_ONLY_FEEDS, prdOnly: PRD_ONLY_FEEDS } = buildRegistry();

/** Feeds the SDK declares that the PRD's verified table does not carry. */
export const SDK_EXTRA_FEEDS = SDK_ONLY_FEEDS.map((f) => ({ feed: f, asset: FEED_MAP[f] as string }));
/** Feeds the PRD verified that the shipped SDK config does not declare. */
export const PRD_EXTRA_FEEDS = PRD_ONLY_FEEDS.map((f) => ({ feed: f, asset: FEED_MAP[f] as string }));

/** Every asset this registry can resolve, sorted. */
export function supportedAssets(): string[] {
  return [...new Set(Object.values(FEED_MAP))].sort();
}

export function feedFor(asset: string): Address | undefined {
  const wanted = asset.toUpperCase();
  const hit = Object.entries(FEED_MAP).find(([, a]) => a === wanted);
  return hit ? (hit[0] as Address) : undefined;
}

/**
 * 🔒 Resolve an order's asset from its price feed.
 *
 * Throws `ASSET_UNRESOLVED` for any feed absent from the map. Never guesses,
 * never falls back to `underlyingToken`.
 */
export function assetForFeed(priceFeed: string | undefined | null): string {
  if (!priceFeed) {
    throw new AppError('ASSET_UNRESOLVED', 'Order carries no rawApiData.priceFeed — cannot identify its asset');
  }
  const asset = FEED_MAP[priceFeed.toLowerCase()];
  if (asset === undefined) {
    throw new AppError('ASSET_UNRESOLVED', `Price feed ${priceFeed} is not in the verified registry`, {
      details: { priceFeed: priceFeed.toLowerCase(), known: Object.keys(FEED_MAP) },
    });
  }
  return asset;
}

/** Non-throwing form, for bulk decode paths that count rejects rather than aborting. */
export function tryAssetForFeed(priceFeed: string | undefined | null): string | null {
  if (!priceFeed) return null;
  return FEED_MAP[priceFeed.toLowerCase()] ?? null;
}

/**
 * 🔒 Runtime cross-check: does this order's strike sit within a plausible
 * band of the resolved asset's current spot price?
 *
 * This is the second, independent guard on the feed map. If the map were
 * wrong — an ETH feed labelled SOL, say — the strike would be off by orders
 * of magnitude and this check would catch it. The PRD's resolution run
 * measured every genuine match within 2.4%; the default 60% band is a wide
 * margin that still catches a mislabel by a factor of 10.
 *
 * @returns the deviation as a fraction (0.024 = 2.4%)
 * @throws ASSET_UNRESOLVED when the strike is implausible for the asset
 */
export function assertStrikePlausible(
  asset: string,
  strike: string,
  spot: string,
  maxDeviationPct = config.maxStrikeDeviationPct,
): number {
  const strikeNum = Number(strike);
  const spotNum = Number(spot);

  if (!Number.isFinite(spotNum) || spotNum <= 0) {
    throw new AppError('ASSET_UNRESOLVED', `No usable spot price for ${asset} — cannot cross-check strike ${strike}`, {
      details: { asset, strike, spot },
    });
  }
  if (!Number.isFinite(strikeNum) || strikeNum <= 0) {
    throw new AppError('ASSET_UNRESOLVED', `Implausible strike ${strike} for ${asset}`, {
      details: { asset, strike, spot },
    });
  }

  const deviation = Math.abs(strikeNum - spotNum) / spotNum;
  if (deviation > maxDeviationPct) {
    throw new AppError(
      'ASSET_UNRESOLVED',
      `Strike ${strike} deviates ${(deviation * 100).toFixed(1)}% from ${asset} spot ${spot}, ` +
        `beyond the ${(maxDeviationPct * 100).toFixed(0)}% band. Refusing to trade — the feed map may be wrong.`,
      { details: { asset, strike, spot, deviation, maxDeviationPct } },
    );
  }
  return deviation;
}

/** Non-throwing form of the cross-check. */
export function strikeDeviation(strike: string, spot: string): number {
  const s = Number(spot);
  if (!Number.isFinite(s) || s <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(Number(strike) - s) / s;
}

export interface ImplementationInfo {
  name: string;
  type: string;
  numStrikes: number;
}

/**
 * Resolve an option implementation address to its product name. An address
 * the chain config does not know returns `UNKNOWN` — and `isVanillaPut()`
 * will then reject it, which is the safe direction.
 */
export function implementationInfo(address: string | undefined | null): ImplementationInfo {
  if (!address) return { name: 'UNKNOWN', type: 'UNKNOWN', numStrikes: 0 };
  const info = getOptionImplementationInfo(CHAIN_ID, address);
  if (!info) return { name: 'UNKNOWN', type: 'UNKNOWN', numStrikes: 0 };
  return { name: info.name, type: info.type, numStrikes: info.numStrikes };
}

/**
 * 🔒 Is this order a single-strike, cash-settled, maker-short vanilla put —
 * the one instrument we buy?
 *
 * Every clause matters, and each was derived from the live book rather than
 * assumed:
 *
 *  · `implementation === PUT` excludes PUT_SPREAD (21 live), PUT_FLY (6),
 *    and PHYSICAL_PUT (39). A spread caps the protection; a butterfly is not
 *    protection at all; a physical put settles in the underlying, which a
 *    USDC-funded burner cannot deliver.
 *  · `strikes.length === 1` is a belt-and-braces check on the same thing.
 *  · `isCall === false` — a put, not a call.
 *  · `isLong === false` — the MAKER is short, so the taker (us) takes the
 *    long side. PRD §3.7. Note PHYSICAL_PUT quotes carry `isLong: true`,
 *    a different direction convention, so this clause is not redundant.
 */
export function isVanillaPut(params: {
  implementation?: string | null;
  isCall?: boolean | null;
  isLong?: boolean | null;
  strikeCount: number;
}): boolean {
  const impl = params.implementation?.toLowerCase();
  return (
    impl === VANILLA_PUT_IMPLEMENTATION &&
    params.strikeCount === 1 &&
    params.isCall === false &&
    params.isLong === false
  );
}

/**
 * Full registry state, for `/api/health` and for the probe scripts. Nothing
 * here should ever surprise an operator at 3am.
 */
export function registrySummary() {
  return {
    chainId: CHAIN_ID,
    assets: supportedAssets(),
    feedCount: Object.keys(FEED_MAP).length,
    feeds: FEED_MAP,
    prdVerifiedFeeds: Object.keys(PRICE_FEED_TO_ASSET).length,
    sdkOnlyFeeds: SDK_EXTRA_FEEDS,
    prdOnlyFeeds: PRD_EXTRA_FEEDS,
    vanillaPutImplementation: VANILLA_PUT_IMPLEMENTATION,
    maxStrikeDeviationPct: config.maxStrikeDeviationPct,
  };
}

import type { MappingRule } from "@/types";

/**
 * Which asset does this alert actually concern?
 *
 * Nothing else in the system answers this. The models return a score and a
 * severity; they are never asked to name an asset, and they should not be:
 * adding an extraction task to the scoring prompt would confound the two, and
 * the identical-prompt rule exists to keep the scores comparable.
 *
 * So the mapping is done here, deterministically, from a table. The requirement is
 * the answer to be "a visible design rule, not an improvisation", because
 * someone will ask why a depeg on asset X led to buying an ETH put. A table
 * can be read out loud. A model's guess cannot.
 */

/** The six the venue actually lists Nothing else is tradeable. */
export const TRADEABLE_ASSETS = ['ETH', 'BTC', 'SOL', 'XRP', 'BNB', 'AVAX'] as const;
export type TradeableAsset = (typeof TRADEABLE_ASSETS)[number];

/**
 * Names that ARE the asset. A Solana validator exploit hits SOL directly.
 * Matched on word boundaries so "based" does not match "base".
 */
const DIRECT_ALIASES: Record<TradeableAsset, string[]> = {
  ETH: ['eth', 'ether', 'ethereum', 'weth'],
  BTC: ['btc', 'bitcoin', 'wbtc', 'cbbtc'],
  SOL: ['sol', 'solana'],
  XRP: ['xrp', 'ripple'],
  BNB: ['bnb', 'binance', 'bsc', 'binance smart chain'],
  AVAX: ['avax', 'avalanche'],
};

/**
 * Names that RIDE ON an asset without being it. An exploit on Base is not an
 * exploit of ETH, but ETH is the honest instrument to hedge it with, and the
 * decision must be labelled CONTAGION so nobody reads it as a direct hit.
 */
const PROXY_ALIASES: Record<string, TradeableAsset> = {
  base: 'ETH',
  arbitrum: 'ETH',
  optimism: 'ETH',
  'op mainnet': 'ETH',
  polygon: 'ETH',
  zksync: 'ETH',
  scroll: 'ETH',
  linea: 'ETH',
  blast: 'ETH',
  lido: 'ETH',
  eigenlayer: 'ETH',
  uniswap: 'ETH',
  aave: 'ETH',
  ronin: 'ETH',
  // Base protocols that lib/entities.ts can already investigate. Without them
  // stage 02 resolves a target, measures it, and then this abstains for want
  // of an instrument, which reads as the system finding evidence and ignoring
  // it. They settle on ETH for the same reason Aave and Uniswap do.
  aerodrome: 'ETH',
  morpho: 'ETH',
  moonwell: 'ETH',
  compound: 'ETH',
  balancer: 'ETH',
};

/**
 * Which major absorbs a systemic event that names no listed asset.
 * ETH, because the venue's deepest book is ETH (100 of 323 orders) and
 * a hedge that cannot be filled protects nothing.
 */
const CONTAGION_PROXY: TradeableAsset = 'ETH';

/** Severity at or above which an unlisted asset may be hedged by proxy. */
const CONTAGION_MIN_SEVERITY = 4;

export interface AssetMapping {
  asset: TradeableAsset | null;
  rule: MappingRule;
  /** Every listed asset the text mentioned, in order of first appearance. */
  candidates: TradeableAsset[];
  /** Human-readable, shown in the UI and on the decision record. */
  reason: string;
}

const boundary = (alias: string) =>
  new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');

/** First index at which any alias appears, or -1. */
function firstHit(text: string, aliases: string[]): number {
  let best = -1;
  for (const alias of aliases) {
    const m = boundary(alias).exec(text);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

/**
 * @param severity the consensus severity, which gates CONTAGION. A contained
 *   incident in an unlisted asset never justifies a proxy trade.
 */
export function mapEventToAsset(rawText: string, severity: number): AssetMapping {
  const text = rawText.toLowerCase();

  // 1. DIRECT — the crisis asset is one of the six.
  const hits: Array<{ asset: TradeableAsset; at: number }> = [];
  for (const asset of TRADEABLE_ASSETS) {
    const at = firstHit(text, DIRECT_ALIASES[asset]);
    if (at >= 0) hits.push({ asset, at });
  }
  hits.sort((a, b) => a.at - b.at);
  const candidates = hits.map((h) => h.asset);

  if (hits.length > 0) {
    // Multiple listed assets can appear ("Binance halts SOL withdrawals").
    // Take the first mentioned: in a news lede the subject leads. Record the
    // rest so the choice is auditable rather than invisible.
    const chosen = hits[0]!.asset;
    return {
      asset: chosen,
      rule: 'DIRECT',
      candidates,
      reason:
        candidates.length > 1
          ? `Names ${candidates.join(', ')}; hedged ${chosen} as the first-named subject.`
          : `Names ${chosen} directly.`,
    };
  }

  // 2. PROXY — an ecosystem or L2 that is not itself listed.
  let proxyHit: { asset: TradeableAsset; at: number; name: string } | null = null;
  for (const [name, asset] of Object.entries(PROXY_ALIASES)) {
    const at = firstHit(text, [name]);
    if (at >= 0 && (proxyHit === null || at < proxyHit.at)) proxyHit = { asset, at, name };
  }
  if (proxyHit) {
    return {
      asset: proxyHit.asset,
      rule: 'CONTAGION',
      candidates: [proxyHit.asset],
      reason: `Names ${proxyHit.name}, which settles on ${proxyHit.asset}. Hedged by proxy.`,
    };
  }

  // 3. CONTAGION — unlisted, but systemic enough to transmit through a major.
  if (severity >= CONTAGION_MIN_SEVERITY) {
    return {
      asset: CONTAGION_PROXY,
      rule: 'CONTAGION',
      candidates: [],
      reason:
        `No listed asset named, but severity ${severity} is systemic. ` +
        `Hedged via ${CONTAGION_PROXY} on the rationale that systemic crises transmit through majors.`,
    };
  }

  // 4. ABSTAIN — unlisted and contained. Never place a loosely related trade.
  return {
    asset: null,
    rule: 'ABSTAIN',
    candidates: [],
    reason: `No listed asset named and severity ${severity} is below the systemic threshold of ${CONTAGION_MIN_SEVERITY}.`,
  };
}

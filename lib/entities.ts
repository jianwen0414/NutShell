/**
 * Entity resolution for Stage 02 — turning an alert's text into things that
 * can actually be measured on Base.
 *
 * ## Why this exists
 *
 * An alert arrives as prose: "a cross-chain bridge on Base has been drained".
 * You cannot call `balanceOf` on a sentence. Something has to decide WHICH
 * contract, WHICH pool and WHICH protocol the claim is about before any
 * on-chain check can run, and that decision must be deterministic — a model
 * guessing at contract addresses would reintroduce exactly the hallucination
 * risk the whole investigation stage exists to remove.
 *
 * So: literal matching against a small registry of entities whose addresses
 * were each verified against Base mainnet, plus address extraction for claims
 * that name one directly.
 *
 * ## The refusal rule
 *
 * 🔒 If nothing resolves, this returns an empty list and the investigation
 * says so. It never falls back to "probably ETH". A claim that names nothing
 * checkable is a claim with no falsifiable specifics, and PRD §10.2's own
 * rubric already treats that as evidence of low reliability. Reporting the
 * absence honestly is worth more than a confident guess about the wrong
 * contract.
 *
 * ## On registry rot
 *
 * Every address below was confirmed live on 2 Sep 2026 — `getCode` non-empty
 * plus a characteristic call. `npm run probe:evidence` re-checks all of them
 * against the chain, and the DEX pools are not listed at all: they are derived
 * from the factories at runtime, so a new pool cannot make this file stale.
 */

import { ethers } from 'ethers';
import type { Address, ResolvedTarget } from '../types/index';

// ─── Verified Base mainnet addresses ──────────────────────────────────────
// Confirmed 2 Sep 2026 at block 50,786,078. Byte sizes are from `getCode`.

/** Uniswap v3 factory. `getPool(tokenA, tokenB, fee)` — 24,535 B. */
export const UNISWAP_V3_FACTORY = '0x33128a8fC17869897dcE68Ed026d694621f6FDfD' as Address;

/** Aerodrome factory. `getPool(tokenA, tokenB, stable)` — 3,516 B, 28,713 pools. */
export const AERODROME_FACTORY = '0x420DD381b31aEf6683db6B902084cB0FFECe40Da' as Address;

export const WETH_ADDRESS = '0x4200000000000000000000000000000000000006' as Address;
export const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
export const CBBTC_ADDRESS = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' as Address;

/**
 * A named entity we know how to measure.
 *
 * `custodial` is the load-bearing flag. It says whether this address actually
 * HOLDS the assets it is associated with, which decides whether a balance
 * delta on it means anything.
 *
 * Measured, and the reason the flag exists: Aave's v3 Pool held 114 USDC
 * while reporting billions in TVL, because v3 reserves sit in aTokens rather
 * than on the Pool. A balance check there would have reported "no drain" with
 * total confidence on an address that never holds the money. Morpho Blue, by
 * contrast, custodies directly — 215.5M USDC on the singleton — so a delta on
 * it is real. One flag, two completely different conclusions.
 */
export interface RegistryEntry {
  name: string;
  /** Lowercase substrings only this entity goes by. Matching one is EXACT. */
  aliases: string[];
  /**
   * Catch-all words that identify the KIND of thing, not this instance.
   * Matching one resolves a checkable target but marks it BROAD, which stops
   * a healthy reading from being reported as contradicting the claim.
   */
  broadAliases?: string[];
  address?: Address;
  /** Verified to resolve on api.llama.fi. Absent when the protocol is unlisted. */
  defillamaSlug?: string;
  asset?: string;
  kind: ResolvedTarget['kind'];
  custodial?: boolean;
  /** Why this entry is shaped the way it is, when that is not obvious. */
  note?: string;
}

/**
 * 🔒 The registry. Small on purpose.
 *
 * Every entry earns its place by being both nameable in a crisis report and
 * measurable from a Base RPC or DeFiLlama. Adding an entry whose address we
 * have not verified would be worse than omitting it: an unresolved target
 * produces an honest "nothing to check", while a wrong address produces a
 * confident measurement of the wrong contract.
 */
export const ENTITY_REGISTRY: RegistryEntry[] = [
  // ── Bridges ─────────────────────────────────────────────────────────────
  {
    name: 'Base Bridge',
    aliases: ['base bridge', 'base native bridge', 'canonical bridge', 'l2standardbridge', 'base l2 bridge'],
    // A crisis report rarely names the contract — the measured scenario says
    // "a cross-chain bridge on Base" and nothing more. Resolving nothing would
    // waste the one check (DeFiLlama, which sees the L1 escrow) that can speak
    // to it at all. But "a bridge" is not "this bridge", so these match BROAD:
    // the canonical bridge sitting at $2.65B intact cannot be reported as
    // contradicting a claim about some other bridge.
    broadAliases: ['cross-chain bridge', 'cross chain bridge', 'bridge'],
    address: '0x4200000000000000000000000000000000000010' as Address,
    defillamaSlug: 'base-bridge',
    kind: 'PROTOCOL',
    custodial: false,
    note:
      'The L2 side is a mint/burn endpoint and custodies nothing — measured 2,055 B of code and no ' +
      'meaningful balance. The $2.65B it is credited with sits in the L1 escrow on Ethereum, which a ' +
      'Base RPC cannot see at all. DeFiLlama can, which is precisely why that check is not circular.',
  },
  {
    name: 'Base Cross-Domain Messenger',
    aliases: ['crossdomainmessenger', 'cross-domain messenger', 'l2crossdomainmessenger'],
    address: '0x4200000000000000000000000000000000000007' as Address,
    kind: 'PROTOCOL',
    custodial: false,
  },

  // ── DEXs. Pools are derived from the factories, never hardcoded. ────────
  {
    name: 'Aerodrome',
    aliases: ['aerodrome', 'aero '],
    defillamaSlug: 'aerodrome',
    kind: 'PROTOCOL',
    note: 'Pools resolved at runtime via factory.getPool(); no pool address is stored here.',
  },
  {
    name: 'Uniswap',
    aliases: ['uniswap', 'uni v3', 'uniswap v3', 'univ3'],
    defillamaSlug: 'uniswap',
    kind: 'PROTOCOL',
  },
  {
    name: 'PancakeSwap',
    aliases: ['pancakeswap', 'pancake swap'],
    defillamaSlug: 'pancakeswap',
    kind: 'PROTOCOL',
  },
  {
    name: 'Balancer',
    aliases: ['balancer'],
    defillamaSlug: 'balancer',
    kind: 'PROTOCOL',
  },

  // ── Lending ─────────────────────────────────────────────────────────────
  {
    name: 'Aave v3',
    aliases: ['aave'],
    address: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5' as Address,
    defillamaSlug: 'aave-v3',
    kind: 'PROTOCOL',
    custodial: false,
    note:
      'Pool at 0xA238…d1c5 (1,933 B, ADDRESSES_PROVIDER 0xe20f…d64D). Held 114 USDC when measured: ' +
      'v3 keeps reserves in aTokens, so a balance delta here is meaningless. TVL is the right instrument.',
  },
  {
    name: 'Morpho',
    aliases: ['morpho', 'morpho blue'],
    address: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as Address,
    defillamaSlug: 'morpho-blue',
    kind: 'PROTOCOL',
    custodial: true,
    note: 'Singleton custodies directly — 215.5M USDC measured on the contract, so a delta is real.',
  },
  {
    name: 'Moonwell',
    aliases: ['moonwell'],
    address: '0xfBb21d0380beE3312B33c4353c8936a0F13EF26C' as Address,
    defillamaSlug: 'moonwell',
    kind: 'PROTOCOL',
    custodial: false,
    note: 'Comptroller (1,412 B). Collateral sits in the mTokens, not here.',
  },
  {
    name: 'Compound v3',
    aliases: ['compound'],
    defillamaSlug: 'compound-v3',
    kind: 'PROTOCOL',
  },

  // ── Options venue we trade on ───────────────────────────────────────────
  {
    name: 'Thetanuts OptionBook',
    aliases: ['thetanuts', 'optionbook'],
    address: '0x1bDff855d6811728acaDC00989e79143a2bdfDed' as Address,
    kind: 'PROTOCOL',
    custodial: false,
    note: 'Not listed on DeFiLlama — /tvl/thetanuts returns 400. On-chain checks only.',
  },

  // ── Tokens. These DO custody, and `paused()` is real on USDC. ───────────
  {
    name: 'USDC',
    aliases: ['usdc', 'circle', 'usd coin'],
    address: USDC_BASE_ADDRESS,
    asset: 'USDC',
    kind: 'TOKEN',
    custodial: true,
    note: 'Implements paused() — measured false. One of the few Base contracts that does.',
  },
  {
    name: 'USDT',
    aliases: ['usdt', 'tether'],
    // Bridged USDT on Base. Listed for peg checks; not a hedge target.
    address: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2' as Address,
    asset: 'USDT',
    kind: 'TOKEN',
    custodial: true,
  },
  {
    name: 'DAI',
    aliases: ['dai', 'makerdao'],
    address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb' as Address,
    asset: 'DAI',
    kind: 'TOKEN',
    custodial: true,
  },
  {
    name: 'WETH',
    aliases: ['weth', 'wrapped eth'],
    address: WETH_ADDRESS,
    asset: 'ETH',
    kind: 'TOKEN',
    custodial: true,
  },
  {
    name: 'cbBTC',
    aliases: ['cbbtc', 'coinbase wrapped btc'],
    address: CBBTC_ADDRESS,
    asset: 'BTC',
    kind: 'TOKEN',
    custodial: true,
  },
];

/**
 * 🔒 Chainlink stablecoin feeds on Base. Verified live 2 Sep 2026 — each
 * answers `description()` with its pair and returns 8-decimal prices:
 *
 *   USDC/USD 0x7e86…bc6B  $0.99975132   DAI/USD 0x591e…C78F  $0.99959089
 *   USDT/USD 0xf19d…21F9  $0.99938000
 *
 * These are NOT in `PRICE_FEED_TO_ASSET`, which lists only the six assets the
 * options book prices. A stablecoin is never a hedge target — you cannot buy a
 * USDC put on this venue — but "USDC depegged" is one of the product's core
 * scenarios, and without these it was unanswerable.
 *
 * Note on staleness: these feeds update on a deviation threshold rather than a
 * heartbeat, so a stale answer is itself informative — it means the peg has not
 * moved far enough to trigger an update. Measured ages at rest were 70–98
 * minutes, which is normal here and would be alarming on ETH/USD.
 */
export const STABLECOIN_FEEDS: Record<string, Address> = {
  USDC: '0x7e860098F58bBFC8648a4311b374B1D669a2bc6B' as Address,
  DAI: '0x591e79239a7d679378eC8c847e5038150364C78F' as Address,
  USDT: '0xf19d560eB8d2ADf07BD6D13ed03e1D11215721F9' as Address,
};

export function isStablecoin(asset: string): boolean {
  return asset in STABLECOIN_FEEDS;
}

/**
 * Asset mentions → the six assets the book actually trades (PRD §3.4.1).
 *
 * Ordered longest-alias-first at match time so "avalanche" is not shadowed by
 * a substring of another entry.
 */
export const ASSET_ALIASES: Record<string, string[]> = {
  ETH: ['ethereum', 'ether', 'weth', 'eth'],
  BTC: ['bitcoin', 'wbtc', 'cbbtc', 'btc'],
  SOL: ['solana', 'sol'],
  XRP: ['ripple', 'xrp'],
  BNB: ['binance coin', 'bnb'],
  AVAX: ['avalanche', 'avax'],
  // Stablecoins are not hedge targets — the book prices no USDC put — but a
  // depeg is one of the scenarios this product exists to catch, so they are
  // resolvable here purely so the peg check can run against them.
  //
  // 🔒 This map decides what stage 02 INVESTIGATES. It does not decide what the
  // agent HEDGES: that is `TRADEABLE_ASSETS` and `mapEventToAsset` in
  // lib/event-mapping.ts, which are untouched and still list only the six the
  // venue prices. Nothing here can put a stablecoin in front of the executor.
  USDC: ['usdc', 'usd coin'],
  USDT: ['usdt', 'tether'],
  DAI: ['dai'],
};

/**
 * Word-boundary match that does not fire inside a longer word.
 *
 * Needed because the short aliases are dangerous: a bare `includes('eth')`
 * matches "method", "ethics" and "together", and `includes('sol')` matches
 * "solution" and "insolvent" — the last of which appears verbatim in one of
 * the simulator's own scenarios. Getting this wrong would resolve the wrong
 * asset from ordinary English, which is the failure mode PRD §3.4 calls the
 * most damaging bug available in this codebase.
 */
function mentions(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b does not fire between a space and a '$' or similar, so bound on
  // non-alphanumerics explicitly.
  const re = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
  return re.test(haystack);
}

const ADDRESS_RE = /0x[a-fA-F0-9]{40}/g;

/**
 * What the claim actually asserts, so a check cannot argue outside its subject.
 *
 * 🔒 This exists because of a measured over-claim. The bridge scenario asserts
 * "12,400 WETH (~$40M) drained". The oracle check found Base DEX spot and
 * Chainlink agreeing to 0.14% and reported CONTRADICTS; both models then scored
 * the claim FAKE and cited exactly that, taking the verdict from HEDGE_SMALL to
 * REJECT.
 *
 * The measurement was correct and the inference was not. $40M is roughly 0.014%
 * of ETH's market capitalisation — a drain of that size need not move the price
 * at all, so price agreement is not evidence that no drain occurred. A check may
 * only contradict a claim about the thing it measures: a price reading can
 * refute a price claim, and a balance reading can refute a custody claim.
 *
 * Corroboration is deliberately not gated this way. Finding real distress is
 * worth surfacing whatever the claim's wording, because it is information the
 * models should weigh; wrongly ruling a true claim out is the expensive error.
 */
export type ClaimAspect = 'PRICE' | 'CUSTODY' | 'HALT';

const ASPECT_TERMS: Record<ClaimAspect, string[]> = {
  // Claims about what something is worth.
  PRICE: [
    'depeg', 'de-peg', 'depegged', 'peg', 'price', 'crash', 'crashed', 'plunge',
    'plunged', 'dump', 'dumped', 'dumping', 'collapse', 'collapsed', 'sell-off',
    'selloff', 'tanked', 'slippage', 'liquidity', 'spread', 'trading down', 'fell to',
  ],
  // Claims about funds moving or being taken.
  CUSTODY: [
    'drain', 'drained', 'draining', 'exploit', 'exploited', 'hack', 'hacked',
    'stolen', 'steal', 'theft', 'attacker', 'breach', 'siphon', 'siphoned',
    'rug', 'rugged', 'insolvent', 'insolvency', 'missing funds', 'outflow',
    'withdrawn', 'migration', 'moved',
  ],
  // Claims that something has been stopped.
  HALT: [
    'pause', 'paused', 'freeze', 'frozen', 'froze', 'halt', 'halted', 'suspend',
    'suspended', 'disabled', 'locked', 'withdrawals stopped', 'shut down',
  ],
};

/** Every aspect the claim touches. Empty when it asserts nothing specific. */
export function claimAspects(rawText: string): ClaimAspect[] {
  const text = rawText.toLowerCase();
  const found: ClaimAspect[] = [];
  for (const [aspect, terms] of Object.entries(ASPECT_TERMS) as [ClaimAspect, string[]][]) {
    if (terms.some((t) => mentions(text, t))) found.push(aspect);
  }
  return found;
}

/**
 * Extract every checkable entity named in the alert.
 *
 * Order matters for the caller: registry hits come first, then bare addresses,
 * then assets. The checks run against the most specific target available.
 */
export function resolveTargets(rawText: string): ResolvedTarget[] {
  const text = rawText.toLowerCase();
  const targets: ResolvedTarget[] = [];
  const seen = new Set<string>();

  const push = (t: ResolvedTarget) => {
    const key = `${t.kind}:${(t.address ?? t.name).toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push(t);
  };

  // 1. Named entities from the registry. An exact name always beats a
  //    catch-all, so a claim naming "Base Bridge" outright is not demoted to
  //    BROAD just because it also contains the word "bridge".
  for (const entry of ENTITY_REGISTRY) {
    const exact = entry.aliases.find((a) => mentions(text, a.trim()));
    const broad = exact ? undefined : entry.broadAliases?.find((a) => mentions(text, a.trim()));
    const hit = exact ?? broad;
    if (!hit) continue;
    push({
      kind: entry.kind,
      name: entry.name,
      ...(entry.address ? { address: entry.address } : {}),
      ...(entry.defillamaSlug ? { defillamaSlug: entry.defillamaSlug } : {}),
      ...(entry.asset ? { asset: entry.asset } : {}),
      ...(entry.custodial !== undefined ? { custodial: entry.custodial } : {}),
      confidence: exact ? 'EXACT' : 'BROAD',
      matchedOn: hit.trim(),
    });
  }

  // 2. Any literal address in the text. A claim that names one is handing us
  //    the most checkable thing it possibly could, so it outranks prose.
  //    Validated through ethers so a malformed 40-hex run is not treated as an
  //    address, and checksummed so the audit trail shows a canonical form.
  for (const match of rawText.match(ADDRESS_RE) ?? []) {
    if (!ethers.isAddress(match)) continue;
    const address = ethers.getAddress(match) as Address;
    const known = ENTITY_REGISTRY.find(
      (e) => e.address?.toLowerCase() === address.toLowerCase(),
    );
    push({
      kind: known ? known.kind : 'ADDRESS',
      name: known?.name ?? address,
      address,
      ...(known?.defillamaSlug ? { defillamaSlug: known.defillamaSlug } : {}),
      ...(known?.asset ? { asset: known.asset } : {}),
      // An address we do not recognise gets checked, but we make no claim
      // about whether it is supposed to hold anything.
      ...(known?.custodial !== undefined ? { custodial: known.custodial } : {}),
      // A literal address is the least ambiguous thing a claim can contain.
      confidence: 'EXACT',
      matchedOn: match,
    });
  }

  // 3. Tradeable assets named in the text.
  for (const [asset, aliases] of Object.entries(ASSET_ALIASES)) {
    const hit = aliases.find((a) => mentions(text, a));
    if (!hit) continue;
    push({ kind: 'ASSET', name: asset, asset, confidence: 'EXACT', matchedOn: hit });
  }

  return targets;
}

/** The first target carrying an address we can call. */
export function primaryAddressTarget(targets: ResolvedTarget[]): ResolvedTarget | undefined {
  return targets.find((t) => t.address !== undefined);
}

/** The first target that both has an address and actually custodies assets. */
export function custodialTarget(targets: ResolvedTarget[]): ResolvedTarget | undefined {
  return targets.find((t) => t.address !== undefined && t.custodial === true);
}

/**
 * The target a balance delta can legitimately be run against.
 *
 * 🔒 Token contracts are excluded, and the exclusion is the whole point of
 * this function. Measured: the bridge-exploit scenario names "12,400 WETH", so
 * WETH resolves as a target; running a balance delta on the WETH contract then
 * reports its own $594M of backing as "essentially unchanged" and returns
 * CONTRADICTS — a confident, arithmetically correct measurement of something
 * the claim was never about, pushing a legitimate report's score DOWN.
 *
 * A token's balance moves when people wrap and unwrap. It says nothing about
 * whether a bridge was drained. Only protocol and bare-address targets are
 * places where "did the money leave?" is a meaningful question.
 */
export function balanceDeltaTarget(targets: ResolvedTarget[]): ResolvedTarget | undefined {
  return targets.find(
    (t) => t.address !== undefined && t.kind !== 'TOKEN' && t.custodial !== false,
  );
}

/**
 * Which token's transfer rate to sample.
 *
 * A named token is the right thing to watch; otherwise USDC, whose flow is the
 * broadest single proxy for activity on Base.
 */
export function activityTarget(targets: ResolvedTarget[]): ResolvedTarget | undefined {
  return targets.find((t) => t.kind === 'TOKEN' && t.address !== undefined)
    ?? targets.find((t) => t.address !== undefined);
}

/** The asset to price-check: an explicit asset mention, else a token's asset. */
export function primaryAsset(targets: ResolvedTarget[]): string | undefined {
  return targets.find((t) => t.asset !== undefined)?.asset;
}

/**
 * The hedgeable asset to run the DEX and oracle checks against.
 *
 * 🔒 Separate from `primaryAsset` because that one returns whatever matched
 * first, which is registry order, not relevance. Measured: the claim
 * "liquidity is draining from ETH/USDC pools on Base" resolved USDC first, took
 * the stablecoin branch, and checked only the USDC peg — the ETH liquidity
 * check the claim was actually about never ran at all. A claim naming both must
 * check both.
 */
export function tradeableAssetTarget(targets: ResolvedTarget[]): string | undefined {
  return targets.find(
    (t) => t.asset !== undefined && !isStablecoin(t.asset) && TRADEABLE.has(t.asset),
  )?.asset;
}

/** Every stablecoin named in the claim, deduplicated. Each gets a peg check. */
export function stablecoinAssets(targets: ResolvedTarget[]): string[] {
  const seen = new Set<string>();
  for (const t of targets) {
    if (t.asset && isStablecoin(t.asset)) seen.add(t.asset);
  }
  return [...seen];
}

/**
 * The six the OptionBook prices, as a set for lookup.
 *
 * Deliberately a local copy of `TRADEABLE_ASSETS` from lib/event-mapping.ts
 * rather than an import: entities.ts is the resolution layer and must not pull
 * in the policy layer's mapping rules. The test suite asserts the two agree.
 */
const TRADEABLE = new Set(['ETH', 'BTC', 'SOL', 'XRP', 'BNB', 'AVAX']);

/** The first DeFiLlama-listed protocol named in the alert. */
export function primarySlug(targets: ResolvedTarget[]): ResolvedTarget | undefined {
  return targets.find((t) => t.defillamaSlug !== undefined);
}

/**
 * Regenerate PRICE_FEED_TO_ASSET — PRD §3.4.1.
 *
 * Resolves each price feed on the live book by clustering that feed's strikes
 * against `getMarketData()` spot prices. A feed is only assigned when the
 * match is unambiguous:
 *
 *   · within 30% of the candidate asset's spot, AND
 *   · at least 3× closer than the runner-up.
 *
 * Anything else is FLAGGED, never silently assigned. Getting this map wrong
 * means the agent hedges the wrong asset, which looks exactly like working
 * software — so the script refuses rather than guesses.
 *
 *   npx tsx scripts/build-asset-map.ts
 *   npx tsx scripts/build-asset-map.ts --emit    # print a paste-ready TS map
 */

import { loadEnv } from '../lib/env';
import { buildPriceFeedSymbolMap } from '@thetanuts-finance/thetanuts-client';
import { PRICE_FEED_TO_ASSET } from '../lib/assets';
import { CHAIN_ID } from '../lib/config';
import { decodePrice } from '../lib/decimals';
import { getClient } from '../lib/thetanuts';

loadEnv();

const WITHIN_PCT = 0.3;
const RUNNER_UP_FACTOR = 3;
const emit = process.argv.includes('--emit');

interface Resolution {
  feed: string;
  orders: number;
  medianStrike: number;
  strikeRange: string;
  best: string;
  bestSpot: number;
  errorPct: number;
  runnerUp: string;
  runnerUpErrorPct: number;
  verdict: 'RESOLVED' | 'FLAGGED';
  note: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : (((s[m - 1] as number) + (s[m] as number)) / 2);
};

async function main(): Promise<void> {
  const client = getClient();
  const [orders, market] = await Promise.all([client.api.fetchOrders(), client.api.getMarketData()]);

  const spots = Object.entries(market.prices).filter(([, v]) => typeof v === 'number' && v > 0) as [string, number][];
  console.log(`${orders.length} live orders · ${spots.length} spot prices: ${spots.map(([a, p]) => `${a} ${p}`).join(', ')}\n`);

  // Group every strike by the feed that priced it.
  const byFeed = new Map<string, number[]>();
  for (const o of orders) {
    const feed = o.rawApiData?.priceFeed?.toLowerCase();
    if (!feed) continue;
    const strikes = (o.order.strikes ?? []).map((s) => Number(decodePrice(s as bigint)));
    if (strikes.length === 0) continue;
    // Cluster on the FIRST strike only. A spread or condor's outer legs sit
    // deliberately far from spot and would smear the cluster.
    byFeed.set(feed, [...(byFeed.get(feed) ?? []), strikes[0] as number]);
  }

  const results: Resolution[] = [];
  for (const [feed, strikes] of [...byFeed.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const mid = median(strikes);
    const ranked = spots
      .map(([asset, spot]) => ({ asset, spot, err: Math.abs(mid - spot) / spot }))
      .sort((a, b) => a.err - b.err);

    const best = ranked[0]!;
    const runnerUp = ranked[1] ?? { asset: '(none)', spot: 0, err: Number.POSITIVE_INFINITY };

    const withinBand = best.err <= WITHIN_PCT;
    const clearlyBetter = runnerUp.err >= best.err * RUNNER_UP_FACTOR;
    const resolved = withinBand && clearlyBetter;

    results.push({
      feed,
      orders: strikes.length,
      medianStrike: mid,
      strikeRange: `${Math.min(...strikes)} – ${Math.max(...strikes)}`,
      best: best.asset,
      bestSpot: best.spot,
      errorPct: Math.round(best.err * 10000) / 100,
      runnerUp: runnerUp.asset,
      runnerUpErrorPct: Math.round(runnerUp.err * 10000) / 100,
      verdict: resolved ? 'RESOLVED' : 'FLAGGED',
      note: resolved
        ? ''
        : !withinBand
          ? `best match is ${(best.err * 100).toFixed(1)}% away, beyond the ${WITHIN_PCT * 100}% band`
          : `runner-up ${runnerUp.asset} is only ${(runnerUp.err / best.err).toFixed(1)}× further, under the ${RUNNER_UP_FACTOR}× margin`,
    });
  }

  console.table(
    results.map((r) => ({
      feed: `${r.feed.slice(0, 10)}…`,
      orders: r.orders,
      strikes: r.strikeRange,
      asset: r.best,
      spot: r.bestSpot,
      'err%': r.errorPct,
      runnerUp: r.runnerUp,
      'runnerUp%': r.runnerUpErrorPct,
      verdict: r.verdict,
    })),
  );

  for (const r of results.filter((x) => x.verdict === 'FLAGGED')) {
    console.log(`⚠ ${r.feed}: ${r.note} — NOT assigned. Resolve by hand before trading it.`);
  }

  // ── Agreement with the two maps already in the codebase ────────────────
  const sdkMap = buildPriceFeedSymbolMap(CHAIN_ID);
  const disagreements: string[] = [];
  console.log('\n═══ AGREEMENT ═══');
  for (const r of results) {
    const prd = PRICE_FEED_TO_ASSET[r.feed];
    const sdk = sdkMap[r.feed];
    const marks = [
      prd === undefined ? 'PRD —' : prd === r.best ? 'PRD ✓' : `PRD ✗(${prd})`,
      sdk === undefined ? 'SDK —' : sdk === r.best ? 'SDK ✓' : `SDK ✗(${sdk})`,
    ];
    if ((prd !== undefined && prd !== r.best) || (sdk !== undefined && sdk !== r.best)) {
      disagreements.push(`${r.feed}: clustering says ${r.best}, PRD says ${prd}, SDK says ${sdk}`);
    }
    console.log(`  ${r.feed}  →  ${r.best.padEnd(5)}  ${marks.join('  ')}  ${r.verdict === 'FLAGGED' ? '⚠' : ''}`);
  }

  const missing = Object.keys(PRICE_FEED_TO_ASSET).filter((f) => !byFeed.has(f));
  if (missing.length) {
    console.log(`\n  note: ${missing.length} PRD-verified feed(s) quoted nothing this poll: ${missing.join(', ')}`);
    console.log('        Absence from one poll is not a contradiction — the map keeps them.');
  }

  if (emit) {
    console.log('\n═══ PASTE-READY MAP ═══');
    console.log('export const PRICE_FEED_TO_ASSET: Record<string, string> = {');
    for (const r of results.filter((x) => x.verdict === 'RESOLVED')) {
      console.log(`  '${r.feed}': '${r.best}',`);
    }
    console.log('};');
  }

  console.log('');
  if (disagreements.length) {
    console.log('✗ DISAGREEMENT between live clustering and a committed map:');
    for (const d of disagreements) console.log(`   ${d}`);
    console.log('  Do not trade until this is resolved — one of the maps hedges the wrong asset.');
    process.exitCode = 1;
  } else {
    console.log('✓ live clustering agrees with both the PRD map and the SDK chain config');
  }
}

main().catch((e) => {
  console.error('build-asset-map failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

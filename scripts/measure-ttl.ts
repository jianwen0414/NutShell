/**
 * Quote-TTL and clock-skew measurement harness — PRD §3.5, §3.6.
 *
 * The PRD's TTL and skew numbers came from two samples. Two samples cannot
 * distinguish a sawtooth from drift, and that distinction changes what
 * "clock skew" means and which timestamp the deadline math should use. This
 * polls for a chosen span and reports the distribution.
 *
 *   npx tsx scripts/measure-ttl.ts                    # 16 min, 12s interval
 *   npx tsx scripts/measure-ttl.ts --minutes 5 --interval 10
 *   npx tsx scripts/measure-ttl.ts --out artifacts/ttl.jsonl
 *
 * Raw samples are appended as JSONL so a run can be re-analysed later.
 */

import 'dotenv/config';
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../lib/config';
import { fetchBookDecoded } from '../lib/thetanuts';

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const minutes = Number(flag('minutes') ?? 16);
const intervalS = Number(flag('interval') ?? 12);
const outPath = flag('out') ?? 'artifacts/ttl-samples.jsonl';

interface Sample {
  n: number;
  wallClock: string;
  fetchMs: number;
  orderCount: number;
  decodedCount: number;
  vanillaPuts: number;
  distinctQuoteExpiries: number;
  distinctNonces: number;
  ttlMin: number;
  ttlMax: number;
  lastUpdatedMs: number;
  currentTimeMs: number;
  /** currentTime − lastUpdated. Negative because lastUpdated is forward-dated. */
  feedAgeS: number;
  /** The PRD §3.6 formula, retained for comparability. */
  prdSkewS: number;
  /** The real clock skew: feed server time vs this host. */
  localSkewS: number;
  perAsset: Record<string, { total: number; vanillaPut: number }>;
  prices: Record<string, string>;
}

const stat = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.floor((s.length - 1) * p)] as number;
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    n: s.length,
    min: r(s[0] as number),
    p05: r(q(0.05)),
    p50: r(q(0.5)),
    p95: r(q(0.95)),
    max: r(s[s.length - 1] as number),
    mean: r(s.reduce((a, b) => a + b, 0) / s.length),
  };
};

async function main(): Promise<void> {
  mkdirSync(dirname(outPath), { recursive: true });
  console.log(`Polling the live book for ${minutes} min every ${intervalS}s → ${outPath}\n`);

  const samples: Sample[] = [];
  const errors: string[] = [];
  const deadline = Date.now() + minutes * 60_000;
  let n = 0;

  while (Date.now() < deadline) {
    const t0 = Date.now();
    try {
      const { orders, snapshot } = await fetchBookDecoded();
      const fetchMs = Date.now() - t0;
      const ttls = orders.map((o) => o.quoteTtlSeconds);
      const puts = orders.filter((o) => o.isVanillaPut);

      const perAsset: Sample['perAsset'] = {};
      for (const o of orders) {
        perAsset[o.asset] ??= { total: 0, vanillaPut: 0 };
        perAsset[o.asset]!.total++;
        if (o.isVanillaPut) perAsset[o.asset]!.vanillaPut++;
      }

      const s: Sample = {
        n: ++n,
        wallClock: new Date().toISOString(),
        fetchMs,
        orderCount: snapshot.orderCount,
        decodedCount: orders.length,
        vanillaPuts: puts.length,
        distinctQuoteExpiries: new Set(orders.map((o) => o.quoteExpiresAt)).size,
        distinctNonces: new Set(orders.map((o) => String((o.raw as { order: { nonce: bigint } }).order.nonce))).size,
        ttlMin: Math.min(...ttls),
        ttlMax: Math.max(...ttls),
        lastUpdatedMs: Date.parse(snapshot.lastUpdated),
        currentTimeMs: snapshot.feedNowMs,
        feedAgeS: snapshot.feedAgeSeconds,
        prdSkewS: snapshot.clockSkewSeconds,
        localSkewS: snapshot.localClockSkewSeconds,
        perAsset,
        prices: snapshot.prices,
      };
      samples.push(s);
      appendFileSync(outPath, `${JSON.stringify(s)}\n`);
      console.log(
        `#${String(n).padStart(3)} orders=${s.orderCount} puts=${s.vanillaPuts} ` +
          `ttl=${s.ttlMin.toFixed(1)}s localSkew=${s.localSkewS.toFixed(2)}s prdSkew=${s.prdSkewS.toFixed(2)}s`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(msg);
      console.log(`#${++n} ERROR ${msg}`);
    }
    const wait = intervalS * 1000 - (Date.now() - t0);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }

  if (samples.length === 0) {
    console.error('No samples collected.');
    process.exit(1);
  }

  console.log(`\n═══ RESULTS — ${samples.length} samples, ${errors.length} errors ═══`);
  console.log(`span: ${samples[0]!.wallClock} → ${samples[samples.length - 1]!.wallClock}`);

  console.log('\nQUOTE TTL (s), measured on the feed clock:');
  console.table({ perPollMin: stat(samples.map((s) => s.ttlMin)), perPollMax: stat(samples.map((s) => s.ttlMax)) });
  const below = samples.filter((s) => s.ttlMin < config.quoteMinTtlS).length;
  console.log(
    `polls with the whole book below QUOTE_MIN_TTL_S (${config.quoteMinTtlS}s): ${below}/${samples.length} ` +
      `(${((below / samples.length) * 100).toFixed(1)}%)`,
  );
  console.log(`distinct quote expiries per poll: ${[...new Set(samples.map((s) => s.distinctQuoteExpiries))].join(', ')}`);

  console.log('\nCLOCK:');
  console.table({
    'local skew (currentTime − Date.now())': stat(samples.map((s) => s.localSkewS)),
    'PRD §3.6 (lastUpdated − currentTime)': stat(samples.map((s) => s.prdSkewS)),
  });

  // The hypothesis that reframes the PRD's "drift" as a quote-cycle sawtooth.
  const residual = samples.map((s) => s.ttlMin - s.prdSkewS);
  const exact = samples.filter((s) => Math.abs(s.lastUpdatedMs / 1000 + 60 - (s.currentTimeMs / 1000 + s.ttlMin)) < 0.02);
  console.log('\nHYPOTHESIS: orderExpiryTimestamp === lastUpdated/1000 + 60');
  console.log(`  ttlMin − prdSkew (expect a constant 60):`, stat(residual));
  console.log(`  exact matches: ${exact.length}/${samples.length}`);
  console.log(
    exact.length === samples.length
      ? '  ✓ CONFIRMED — lastUpdated is a forward-dated quote-cycle anchor, not a staleness marker.\n' +
          '    The PRD §3.6 "skew" is the cycle phase (TTL − 60), so it sawtooths rather than drifts.\n' +
          '    Use metadata.currentTime as "now" for all deadline math.'
      : '  ✗ not confirmed on this run — re-examine before relying on currentTime.',
  );

  console.log('\nORDER COUNTS:');
  console.table({
    total: stat(samples.map((s) => s.orderCount)),
    vanillaPuts: stat(samples.map((s) => s.vanillaPuts)),
    distinctNonces: stat(samples.map((s) => s.distinctNonces)),
    fetchMs: stat(samples.map((s) => s.fetchMs)),
  });

  const assets = [...new Set(samples.flatMap((s) => Object.keys(s.perAsset)))].sort();
  const table: Record<string, Record<string, number>> = {};
  for (const a of assets) {
    const t = stat(samples.map((s) => s.perAsset[a]?.total ?? 0));
    const v = stat(samples.map((s) => s.perAsset[a]?.vanillaPut ?? 0));
    table[a] = { ordersMin: t.min, ordersMed: t.p50, ordersMax: t.max, putsMin: v.min, putsMed: v.p50, putsMax: v.max };
  }
  console.log('\nPER-ASSET ORDER COUNTS:');
  console.table(table);
}

main().catch((e) => {
  console.error('measure-ttl failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

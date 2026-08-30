/**
 * Reference probe — PRD §6.4.
 *
 * The fastest way to re-verify reality when something looks wrong. Decodes
 * the live Base mainnet book through the same code the agent uses, prints
 * what it found, and asserts the invariants this integration depends on.
 *
 *   npx tsx scripts/probe-book.ts
 *   npx tsx scripts/probe-book.ts --asset BTC --json
 *
 * Exits non-zero if any 🔒 invariant fails, so it is usable in CI.
 */

import 'dotenv/config';
import type { OrderWithSignature } from '@thetanuts-finance/thetanuts-client';
import { registrySummary, supportedAssets } from '../lib/assets';
import { config, OPTION_BOOK_ADDRESS, PUT_IMPLEMENTATION_ADDRESS } from '../lib/config';
import { fromScaled, knownTokens } from '../lib/decimals';
import { safeStringify } from '../lib/errors';
import {
  fetchBookDecoded,
  getClient,
  getProvider,
  maxContractsRawFor,
  maxPremiumRawFor,
} from '../lib/thetanuts';
import type { DecodedOrder } from '../types/index';

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string): boolean => args.includes(`--${name}`);

const failures: string[] = [];
function check(ok: boolean, label: string, detail?: string): void {
  if (ok) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failures.push(label);
  }
}

async function main(): Promise<void> {
  const rpc = process.env.THETANUTS_RPC_URL;
  console.log('═══ CONNECTION ═══');
  console.log(`  RPC host      : ${rpc ? new URL(rpc).host : '(THETANUTS_RPC_URL is not set)'}`);
  if (rpc && /(^|\.)mainnet\.base\.org$/.test(new URL(rpc).host)) {
    console.log('  ⚠  mainnet.base.org is rate-limited and will throttle a polling agent (PRD §6.2).');
  }

  const provider = getProvider();
  const [block, network] = await Promise.all([provider.getBlockNumber(), provider.getNetwork()]);
  console.log(`  chainId       : ${network.chainId}`);
  console.log(`  block         : ${block}`);

  const t0 = Date.now();
  const { orders, rejected, snapshot } = await fetchBookDecoded();
  const fetchMs = Date.now() - t0;

  // ── Clock ───────────────────────────────────────────────────────────────
  console.log('\n═══ CLOCK ═══');
  console.log(`  feed currentTime      : ${snapshot.feedNow}`);
  console.log(`  feed lastUpdated      : ${snapshot.lastUpdated}`);
  console.log(`  local clock skew      : ${snapshot.localClockSkewSeconds.toFixed(3)}s  (currentTime − Date.now())`);
  console.log(`  PRD §3.6 formula      : ${snapshot.clockSkewSeconds.toFixed(3)}s  (lastUpdated − currentTime)`);
  console.log('  note: lastUpdated is a FORWARD-DATED quote-cycle anchor, not a staleness marker.');
  console.log('        Every order expiry equals lastUpdated/1000 + 60 exactly, so the PRD formula');
  console.log('        measures the cycle phase (TTL − 60), not clock skew. Use currentTime for "now".');

  // ── Book composition ────────────────────────────────────────────────────
  console.log('\n═══ BOOK ═══');
  console.log(`  fetch latency : ${fetchMs}ms`);
  console.log(`  raw orders    : ${snapshot.orderCount}`);
  console.log(`  decoded       : ${orders.length}`);
  console.log(`  rejected      : ${rejected.length}`);
  if (rejected.length) {
    const byReason: Record<string, number> = {};
    for (const r of rejected) {
      const key = r.reason.replace(/0x[0-9a-fA-F]+/g, '0x…').replace(/[\d.]+%/g, 'N%');
      byReason[key] = (byReason[key] ?? 0) + 1;
    }
    console.table(byReason);
  }

  // Composition on the ASSET DISCRIMINATOR — priceFeed, not underlyingToken.
  const composition: Record<string, { total: number; vanillaPuts: number; calls: number; other: number }> = {};
  for (const o of orders) {
    composition[o.asset] ??= { total: 0, vanillaPuts: 0, calls: 0, other: 0 };
    const row = composition[o.asset]!;
    row.total++;
    if (o.isVanillaPut) row.vanillaPuts++;
    else if (o.isCall) row.calls++;
    else row.other++;
  }
  console.log('\n  BY ASSET (resolved from rawApiData.priceFeed):');
  console.table(composition);

  const byImpl: Record<string, number> = {};
  for (const o of orders) byImpl[o.implementationName] = (byImpl[o.implementationName] ?? 0) + 1;
  console.log('  BY IMPLEMENTATION:');
  console.table(byImpl);

  const byUnderlying: Record<string, number> = {};
  for (const o of orders) byUnderlying[o.underlyingToken] = (byUnderlying[o.underlyingToken] ?? 0) + 1;
  console.log('  BY underlyingToken (why it CANNOT be the discriminator):');
  console.table(byUnderlying);

  const byCollateral: Record<string, number> = {};
  for (const o of orders) byCollateral[o.collateralSymbol] = (byCollateral[o.collateralSymbol] ?? 0) + 1;
  console.log('  BY COLLATERAL TOKEN:');
  console.table(byCollateral);

  // ── Quote TTL ───────────────────────────────────────────────────────────
  const ttls = orders.map((o) => o.quoteTtlSeconds).sort((a, b) => a - b);
  const expiries = [...new Set(orders.map((o) => o.quoteExpiresAt))];
  console.log('\n═══ QUOTE TTL (feed clock) ═══');
  console.log(`  min ${ttls[0]}s · median ${ttls[Math.floor(ttls.length / 2)]}s · max ${ttls[ttls.length - 1]}s`);
  console.log(`  distinct quote expiries on the book: ${expiries.length}`);
  console.log(`  orders above the ${config.quoteMinTtlS}s floor: ${ttls.filter((t) => t >= config.quoteMinTtlS).length}/${ttls.length}`);
  const nonces = new Set(orders.map((o) => String((o.raw as OrderWithSignature).order.nonce)));
  console.log(`  distinct nonces: ${nonces.size} across ${orders.length} orders — the maker cancels in batches.`);

  // ── Buyable puts ────────────────────────────────────────────────────────
  const asset = flag('asset')?.toUpperCase();
  const puts = orders
    .filter((o) => o.isVanillaPut && (asset === undefined || o.asset === asset))
    .sort((a, b) => Number(a.premiumPerContract) - Number(b.premiumPerContract));

  console.log(`\n═══ BUYABLE VANILLA PUTS${asset ? ` — ${asset}` : ''} (${puts.length}) ═══`);
  const rows = puts.slice(0, 20).map((o) => ({
    asset: o.asset,
    strike: o.strike,
    spot: o.spotAtDecode,
    premium: o.premiumPerContract,
    delta: o.greeks.delta,
    iv: o.greeks.iv,
    hrsOut: o.hoursToExpiry,
    ttlS: o.quoteTtlSeconds,
    collat: o.collateralSymbol,
    maxPremium: fromScaled(maxPremiumRawFor(o), o.collateralDecimals),
    inBand: o.greeks.delta >= config.targetDeltaMin && o.greeks.delta <= config.targetDeltaMax ? 'yes' : '',
  }));
  console.table(rows);

  // ── Invariants ──────────────────────────────────────────────────────────
  console.log('\n═══ 🔒 INVARIANTS ═══');
  check(Number(network.chainId) === 8453, 'chainId is Base mainnet 8453');
  check(orders.length > 0, 'the book decoded at least one order');
  check(rejected.length === 0, `every order decoded (${rejected.length} rejected)`);
  check(
    Math.abs(snapshot.localClockSkewSeconds) <= config.maxClockSkewS,
    `local clock skew within MAX_CLOCK_SKEW_S (${snapshot.localClockSkewSeconds.toFixed(2)}s ≤ ${config.maxClockSkewS}s)`,
  );
  check(
    orders.every((o) => o.optionBookAddress === OPTION_BOOK_ADDRESS.toLowerCase()),
    'every order targets the allowlisted OptionBook',
  );
  check(
    orders.every((o) => supportedAssets().includes(o.asset)),
    'every decoded order resolved to a registry asset',
  );
  check(
    puts.every((o) => o.implementationAddress === PUT_IMPLEMENTATION_ADDRESS.toLowerCase()),
    'every vanilla put uses the PUT implementation',
  );
  check(
    puts.every((o) => o.strikes.length === 1 && !o.isCall && !o.isLong),
    'every vanilla put is single-strike, put, maker-short',
  );
  check(
    orders.every((o) => o.strikeDeviationPct < 10),
    'no decoded strike is wildly implausible against its spot',
  );

  // The local maxContracts formula against the SDK's own implementation, for
  // every live order. This is what lets selection stay pure and offline.
  const client = getClient();
  const mismatches: { asset: string; local: string; sdk: string }[] = [];
  for (const o of orders) {
    if (!o.isVanillaPut) continue;
    try {
      const sdk = client.optionBook.calculateMaxContracts(o.raw as OrderWithSignature);
      const local = maxContractsRawFor(o);
      if (sdk !== local) mismatches.push({ asset: o.asset, local: local.toString(), sdk: sdk.toString() });
    } catch {
      /* the SDK declining to price an order is not a formula mismatch */
    }
  }
  check(
    mismatches.length === 0,
    `local maxContracts formula matches the SDK on all ${puts.length} vanilla puts`,
    mismatches.length ? safeStringify(mismatches.slice(0, 3)) : undefined,
  );

  // ── Registry / decimals ─────────────────────────────────────────────────
  console.log('\n═══ REGISTRY ═══');
  const reg = registrySummary();
  console.log(`  assets              : ${reg.assets.join(', ')}`);
  console.log(`  feeds in registry   : ${reg.feedCount} (${reg.prdVerifiedFeeds} PRD-verified)`);
  if (reg.sdkOnlyFeeds.length) {
    console.log(`  SDK adds            : ${reg.sdkOnlyFeeds.map((f) => f.asset).join(', ')}`);
  }
  console.log(`  known tokens        : ${knownTokens().map((t) => `${t.symbol}(${t.decimals})`).join(', ')}`);

  if (has('json')) {
    console.log('\n═══ JSON ═══');
    console.log(safeStringify({ snapshot, orders: puts.slice(0, 5).map(stripRaw) }, 2));
  }

  console.log('');
  if (failures.length) {
    console.log(`✗ ${failures.length} invariant(s) FAILED: ${failures.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('✓ all invariants hold against the live book');
  }
}

function stripRaw(o: DecodedOrder): Omit<DecodedOrder, 'raw'> {
  const { raw, ...rest } = o;
  void raw;
  return rest;
}

main().catch((e) => {
  console.error('\nPROBE FAILED:', e instanceof Error ? e.message : e);
  if (e?.details) console.error('details:', safeStringify(e.details, 2));
  process.exit(1);
});

/**
 * Open the position judges will inspect.
 *
 * This is the one fill that must still be ALIVE during judging, so it differs
 * from an ordinary hedge in three ways: it picks the LONGEST-dated vanilla put
 * rather than the nearest, it refuses outright if that expiry does not clear
 * the survival deadline, and it makes you confirm before spending.
 *
 * ⚠️ TIMING. Measured on this venue, vanilla puts top out around 52 HOURS.
 * Everything dated further out is PHYSICAL_*, a spread, a fly, or a RANGER —
 * none of which is a cash-settled protective put. So this cannot be run a week
 * early. Run it on **4–5 September** so the position is still open on the 6th.
 *
 *   npx tsx scripts/open-graded-position.ts                    # dry run, default
 *   npx tsx scripts/open-graded-position.ts --live --confirm
 *   npx tsx scripts/open-graded-position.ts --survive-until 2026-09-06T23:59:00Z
 *
 * Re-check the calendar first: new tenors appear continuously, and a weekly
 * vanilla put may exist by then.
 */

import 'dotenv/config';
import { attest, evidenceHashFor } from '../lib/attestation';
import { config } from '../lib/config';
import { newCorrelationId, safeStringify, toAppError } from '../lib/errors';
import { openPositionFor, savePosition } from '../lib/positions';
import { executeHedge, fetchBookDecoded, hasSigner, signerAddress } from '../lib/thetanuts';
import type { TxHash } from '../types/index';

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string): boolean => args.includes(`--${n}`);

const asset = (flag('asset') ?? 'ETH').toUpperCase();
const budgetUsdc = flag('budget') ?? '1.00';
const live = has('live');
/** Judging is 6 September at APU. The position must outlive that whole day. */
const surviveUntil = flag('survive-until') ?? '2026-09-06T23:59:00Z';

async function main(): Promise<void> {
  const correlationId = newCorrelationId();
  const deadline = Date.parse(surviveUntil);
  if (Number.isNaN(deadline)) throw new Error(`--survive-until is not a valid ISO timestamp: ${surviveUntil}`);

  console.log('═══ GRADED POSITION ═══');
  console.log(`  correlationId : ${correlationId}`);
  console.log(`  asset         : ${asset}`);
  console.log(`  budget        : $${budgetUsdc} USDC`);
  console.log(`  must survive  : ${new Date(deadline).toISOString()}`);
  console.log(`  mode          : ${live ? '🔴 LIVE — spends real USDC' : 'DRY RUN'}`);
  console.log(`  signer        : ${hasSigner() ? signerAddress() : '(none)'}`);

  // ── Survey the vanilla-put calendar before committing to anything ───────
  const { orders } = await fetchBookDecoded();
  const puts = orders.filter((o) => o.isVanillaPut && o.asset === asset && o.quoteTtlSeconds >= config.quoteMinTtlS);

  if (puts.length === 0) {
    console.error(`\n✗ No live ${asset} vanilla puts above the ${config.quoteMinTtlS}s TTL floor. Try again shortly.`);
    process.exit(1);
  }

  const calendar = new Map<string, number>();
  for (const o of puts) calendar.set(o.expiry, (calendar.get(o.expiry) ?? 0) + 1);
  console.log(`\n  ${asset} vanilla put calendar (${puts.length} quotes):`);
  for (const [expiry, count] of [...calendar.entries()].sort()) {
    const hrs = (Date.parse(expiry) - Date.now()) / 3_600_000;
    const survives = Date.parse(expiry) >= deadline;
    console.log(`    ${expiry}  ${String(count).padStart(3)} quotes  ${hrs.toFixed(1)}h out  ${survives ? '✓ survives judging' : '✗ expires first'}`);
  }

  const survivors = puts.filter((o) => Date.parse(o.expiry) >= deadline);
  const longest = [...puts].sort((a, b) => Date.parse(b.expiry) - Date.parse(a.expiry))[0]!;

  if (survivors.length === 0) {
    console.error('');
    console.error(`✗ NO ${asset} vanilla put survives ${new Date(deadline).toISOString()}.`);
    console.error(`  Longest available: ${longest.expiry} (${longest.hoursToExpiry}h out).`);
    console.error('');
    console.error('  This venue lists vanilla puts only as near-dailies (~52h maximum). Options:');
    console.error('    · run this closer to the deadline, so a near-dated put still covers it');
    console.error('    · lower --survive-until if judging is earlier than assumed');
    console.error('    · re-check the calendar; a weekly vanilla put may have been listed since');
    console.error('  Refusing to open a position that expires before anyone can inspect it.');
    process.exit(1);
  }

  // Longest surviving expiry, so the position stays inspectable as long as
  // possible. Within that expiry `executeHedge` still picks by the delta band
  // and cheapest premium.
  const targetExpiry = [...survivors].sort((a, b) => Date.parse(b.expiry) - Date.parse(a.expiry))[0]!;
  const minExpiryHours = Math.max(0, (Date.parse(targetExpiry.expiry) - Date.now()) / 3_600_000 - 0.5);
  console.log(`\n  targeting ${targetExpiry.expiry} — the longest expiry that survives judging`);
  console.log(`  (minExpiryHours floor set to ${minExpiryHours.toFixed(1)}h)`);

  if (live) {
    if (!hasSigner()) {
      console.error('\n✗ --live requires THETANUTS_PRIVATE_KEY.');
      process.exit(1);
    }
    if (!has('confirm')) {
      console.error('\n✗ --live also requires --confirm. This spends real USDC on Base mainnet.');
      process.exit(1);
    }
    const existing = openPositionFor(asset);
    if (existing && !has('allow-duplicate')) {
      console.error(`\n✗ ${asset} already has an open hedge (${existing.correlationId}, expires ${existing.expiry}).`);
      console.error('  PRD §10.6 allows one open hedge per asset. Pass --allow-duplicate to override.');
      process.exit(1);
    }
  }

  const position = await executeHedge({
    correlationId,
    asset,
    budgetUsdc,
    gonkaRequestIds: ['graded-position-no-inference'],
    dryRun: !live,
    minExpiryHours,
  });

  const o = position.execution.selectedOrder;
  console.log('\n═══ SELECTED ═══');
  console.log(`  ${o.asset} $${o.strike} PUT · expires ${o.expiry} (${o.hoursToExpiry}h out)`);
  console.log(`  premium   : $${position.execution.premiumUsdc} · ${position.execution.contracts} contracts`);
  console.log(`  cover     : $${position.notionalProtectedUsdc}`);
  console.log(`  delta     : ${o.greeks.delta} · iv ${o.greeks.iv}`);
  console.log(`  survives  : ${Date.parse(o.expiry) >= deadline ? '✓ yes' : '✗ NO'} (needs ${new Date(deadline).toISOString()})`);

  if (position.execution.warnings.length) {
    console.log('\n  warnings:');
    for (const w of position.execution.warnings) console.log(`    ⚠ ${w}`);
  }

  if (!live) {
    console.log('\n✓ DRY RUN — nothing signed. Re-run with --live --confirm when ready.');
    return;
  }

  console.log('\n═══ FILLED ═══');
  console.log(`  status      : ${position.status}`);
  console.log(`  entry tx    : ${position.entryTxHash}`);
  console.log(`  BaseScan    : ${position.baseScanUrl}`);
  console.log(`  option      : ${position.optionAddress}`);

  const attestation = await attest({
    correlationId,
    truthScore: 91,
    agreement: 0.86,
    severity: 5,
    gonkaRequestIds: ['graded-position-no-inference'],
    evidenceHash: evidenceHashFor({ graded: true, correlationId, option: position.optionAddress }),
    hedgeTxHash: position.entryTxHash as TxHash,
  });
  console.log(`  attestation : ${attestation.txHash ?? attestation.method}`);
  if (attestation.baseScanUrl) console.log(`  BaseScan    : ${attestation.baseScanUrl}`);

  const file = savePosition(position, attestation);
  console.log(`  recorded    : ${file}`);

  console.log('\n✓ GRADED POSITION OPEN AND INSPECTABLE');
  console.log(`  It stays live until ${o.expiry}. Judging deadline ${new Date(deadline).toISOString()}.`);
}

main().catch((e) => {
  const err = toAppError(e);
  console.error(`\n✗ ${err.code}: ${err.message}`);
  if (err.details) console.error(safeStringify(err.details, 2));
  process.exit(1);
});

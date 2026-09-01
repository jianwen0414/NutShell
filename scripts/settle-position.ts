/**
 * Settle an expired position and MEASURE what actually came back.
 *
 * PRD §17 V6 says the round-trip number must be measured once and then quoted
 * from measurement, never estimated. This is the instrument that measures it:
 * it reads the burner's collateral balance, settles, reads it again, and
 * reports the difference.
 *
 * Before doing anything it static-calls every exit path, so the settlement
 * MECHANISM is discovered for zero gas rather than assumed. That matters
 * because pre-expiry the mechanism is known: `close()` reverts with "Buyer and
 * seller same to close". Whether that check relaxes after expiry is a question
 * only the chain can answer, and only once the option has expired.
 *
 *   npx tsx scripts/settle-position.ts                     # list what is settleable
 *   npx tsx scripts/settle-position.ts nsh_… --probe       # probe exits, no spend
 *   npx tsx scripts/settle-position.ts nsh_… --live --confirm
 */

import { loadEnv } from '../lib/env';
import { ethers } from 'ethers';
import { OPTION_ABI } from '@thetanuts-finance/thetanuts-client';
import { basescanAddressUrl, basescanTxUrl } from '../lib/config';
import { fromScaled } from '../lib/decimals';
import { safeStringify, toAppError } from '../lib/errors';
import { listPositions, loadPosition, savePosition, settleablePositions } from '../lib/positions';
import { getProvider, getSigningClient, settlePosition, signerAddress } from '../lib/thetanuts';

loadEnv();

const args = process.argv.slice(2);
const has = (n: string): boolean => args.includes(`--${n}`);
const cid = args.find((a) => a.startsWith('nsh_'));

async function listAll(): Promise<void> {
  const all = listPositions();
  if (all.length === 0) {
    console.log('No positions in the store.');
    return;
  }
  console.log(`═══ POSITIONS (${all.length}) ═══`);
  for (const p of all) {
    const hrs = (Date.parse(p.expiry) - Date.now()) / 3_600_000;
    console.log(
      `  ${p.correlationId}  ${p.status.padEnd(9)} ${p.asset} $${p.strike} ` +
        `${p.contracts} contracts  premium $${p.premiumPaidUsdc}  ` +
        `${hrs > 0 ? `expires in ${hrs.toFixed(1)}h` : `EXPIRED ${(-hrs).toFixed(1)}h ago`}` +
        `${p.wasDryRun ? '  (dry run)' : ''}`,
    );
  }
  const ready = settleablePositions();
  console.log(`\n  settleable now: ${ready.length ? ready.map((p) => p.correlationId).join(', ') : 'none'}`);
}

async function probe(optionAddress: string): Promise<void> {
  const me = signerAddress();
  if (!me) {
    console.log('  (no signer — cannot probe)');
    return;
  }
  const provider = getProvider();
  const r = new ethers.Contract(optionAddress, OPTION_ABI as ethers.InterfaceAbi, provider);
  const w = new ethers.Contract(optionAddress, OPTION_ABI as ethers.InterfaceAbi, getSigningClient().requireSigner());

  const expiryTs = Number(await r.expiryTimestamp!());
  const settled = await r.optionSettled!();
  const past = Date.now() / 1000 > expiryTs;

  console.log(`  expiry        : ${new Date(expiryTs * 1000).toISOString()} (${past ? 'PASSED' : 'not yet'})`);
  console.log(`  optionSettled : ${settled}`);

  let twap: string | null = null;
  try {
    const t = await r.getTWAP!();
    twap = fromScaled(t as bigint, 8);
    console.log(`  settlement TWAP: $${twap}`);
    const payout = await r.calculatePayout!(t);
    console.log(`  calculatePayout: ${fromScaled(payout as bigint, 6)} USDC`);
  } catch (e) {
    console.log(`  settlement TWAP: unavailable (${(e as Error).message.slice(0, 70)})`);
  }

  const attempt = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      console.log(`  ✓ ${label} → would SUCCEED`);
    } catch (e) {
      const m = (e as Error).message;
      const reason =
        /reason="([^"]+)"/.exec(m)?.[1] ??
        /reverted with reason string '([^']+)'/.exec(m)?.[1] ??
        m.split('\n')[0]?.slice(0, 110);
      console.log(`  ✗ ${label} → would REVERT: ${reason}`);
    }
  };

  console.log('\n  exit paths (static-called, nothing broadcast):');
  await attempt('close()', () => w.close!.staticCall());
  await attempt('returnExcessCollateral()', () => w.returnExcessCollateral!.staticCall());
  await attempt('reclaimCollateral(this)', () => w.reclaimCollateral!.staticCall(optionAddress));
}

async function main(): Promise<void> {
  if (!cid) {
    await listAll();
    console.log('\nPass a correlation id to probe or settle one: settle-position.ts nsh_… --probe');
    return;
  }

  const position = loadPosition(cid);
  if (!position) throw new Error(`No position ${cid} in the store`);
  if (!position.optionAddress) throw new Error(`Position ${cid} carries no option address`);

  console.log('═══ POSITION ═══');
  console.log(`  correlationId : ${position.correlationId}`);
  console.log(`  instrument    : ${position.asset} $${position.strike} PUT`);
  console.log(`  contracts     : ${position.contracts}`);
  console.log(`  premium paid  : $${position.premiumPaidUsdc}`);
  console.log(`  cover         : $${position.notionalProtectedUsdc}`);
  console.log(`  option        : ${basescanAddressUrl(position.optionAddress)}`);
  console.log(`  entry tx      : ${position.baseScanUrl}`);
  console.log(`  status        : ${position.status}`);

  console.log('\n═══ ON-CHAIN STATE ═══');
  await probe(position.optionAddress);

  if (!has('record')) {
    console.log('\n(probe only — pass --record to measure settlement and write the result)');
    return;
  }

  // Settlement on this venue is automatic: the option settles itself against a
  // Chainlink TWAP and the buyer sends nothing. So measuring costs no gas and
  // needs no --live gate. If a future in-the-money position turns out to need
  // a claim transaction, settlePosition() says so rather than sending one.
  console.log('\n═══ MEASURING SETTLEMENT ═══');
  const settled = await settlePosition(cid, { position });
  const s = settled.execution?.settlement;

  if (s) {
    console.log(`  settlement price : $${s.settlementPrice}`);
    console.log(`  strike           : $${settled.strike}`);
    console.log(`  outcome          : ${s.inTheMoney ? 'IN THE MONEY' : 'OUT OF THE MONEY'}`);
    console.log(`  payout owed      : ${s.payoutOwed} USDC`);
    console.log(`  optionSettled    : ${s.optionSettled}`);
    console.log(`  recovered        : ${s.recovered} USDC (measured balance delta)`);
    console.log(`  tx required      : ${s.transactionRequired}`);
  }
  console.log(`  status           : ${settled.status}`);
  console.log(`  realised PnL     : ${settled.realisedPnlUsdc} USDC`);
  if (settled.exitTxHash) console.log(`  exit tx          : ${basescanTxUrl(settled.exitTxHash)}`);
  for (const w of (settled.execution?.warnings ?? []).slice(-3)) console.log(`\n  ${w}`);

  savePosition(settled);
  console.log('\n✓ recorded — this is the MEASURED round-trip number for PRD §17 V6.');
}

main().catch((e) => {
  const err = toAppError(e);
  console.error(`\n✗ ${err.code}: ${err.message}`);
  if (err.details) console.error(safeStringify(err.details, 2));
  process.exit(1);
});

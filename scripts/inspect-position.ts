/**
 * Inspect a deployed option position and probe its lifecycle exits.
 *
 * Reads the option contract's own state, then STATIC-CALLS each exit path so
 * the mechanics are discovered for zero gas and zero risk before anything is
 * broadcast. This is how PRD §17 V6 (round-trip cost) gets answered by
 * measurement rather than estimate.
 *
 *   npx tsx scripts/inspect-position.ts 0x<option address>
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { OPTION_ABI } from '@thetanuts-finance/thetanuts-client';
import { basescanAddressUrl } from '../lib/config';
import { fromScaled, symbolFor } from '../lib/decimals';
import { getProvider, getSigningClient, signerAddress } from '../lib/thetanuts';

const optionAddress = process.argv[2];
if (!optionAddress || !ethers.isAddress(optionAddress)) {
  console.error('usage: npx tsx scripts/inspect-position.ts 0x<option address>');
  process.exit(1);
}

async function main(): Promise<void> {
  const provider = getProvider();
  const me = signerAddress();
  const c = new ethers.Contract(optionAddress!, OPTION_ABI as ethers.InterfaceAbi, provider);

  console.log('═══ OPTION CONTRACT ═══');
  console.log(`  address  : ${optionAddress}`);
  console.log(`  explorer : ${basescanAddressUrl(optionAddress!)}`);
  console.log(`  viewer   : ${me ?? '(no signer)'}`);

  const read = async (name: string, fn: () => Promise<unknown>): Promise<unknown> => {
    try {
      const v = await fn();
      return v;
    } catch (e) {
      return `(reverted: ${(e as Error).message.slice(0, 60)})`;
    }
  };

  const [buyer, seller, numContracts, collateralToken, collateralAmount, expiry, expired, settled, strikes] =
    await Promise.all([
      read('getBuyer', () => c.getBuyer!()),
      read('getSeller', () => c.getSeller!()),
      read('getNumContracts', () => c.getNumContracts!()),
      read('getCollateralToken', () => c.getCollateralToken!()),
      read('getCollateralAmount', () => c.getCollateralAmount!()),
      read('getExpiry', () => c.getExpiry!()),
      read('isExpired', () => c.isExpired!()),
      read('optionSettled', () => c.optionSettled!()),
      read('getStrikes', () => c.getStrikes!()),
    ]);

  const colAddr = typeof collateralToken === 'string' && ethers.isAddress(collateralToken) ? collateralToken : undefined;
  const colSym = colAddr ? symbolFor(colAddr) : '?';
  const colDec = colSym === 'USDC' || colSym === 'aBasUSDC' || colSym === 'cbXRP' ? 6 : colSym === 'WETH' || colSym === 'aBasWETH' ? 18 : 8;

  console.log('\n═══ STATE ═══');
  console.log(`  buyer            : ${buyer}${me && String(buyer).toLowerCase() === me.toLowerCase() ? '   ← us' : ''}`);
  console.log(`  seller           : ${seller}${me && String(seller).toLowerCase() === me.toLowerCase() ? '   ← us' : ''}`);
  console.log(`  numContracts     : ${numContracts}  = ${typeof numContracts === 'bigint' ? fromScaled(numContracts, colDec) : '?'}`);
  console.log(`  strikes          : ${Array.isArray(strikes) ? strikes.map((s) => fromScaled(s as bigint, 8)).join(', ') : strikes}`);
  console.log(`  collateralToken  : ${collateralToken} (${colSym})`);
  console.log(`  collateralAmount : ${collateralAmount} = ${typeof collateralAmount === 'bigint' ? fromScaled(collateralAmount, colDec) : '?'} ${colSym}`);
  console.log(`  expiry           : ${typeof expiry === 'bigint' ? new Date(Number(expiry) * 1000).toISOString() : expiry}`);
  console.log(`  isExpired        : ${expired}`);
  console.log(`  optionSettled    : ${settled}`);

  if (typeof expiry === 'bigint') {
    const hrs = (Number(expiry) - Date.now() / 1000) / 3600;
    console.log(`  time to expiry   : ${hrs.toFixed(2)}h`);
  }

  const heldBalance = colAddr && me ? await new ethers.Contract(colAddr, ['function balanceOf(address) view returns (uint256)'], provider).balanceOf!(me) : null;
  if (heldBalance !== null) {
    console.log(`\n  our ${colSym} balance : ${fromScaled(heldBalance as bigint, colDec)}`);
  }

  // ── Probe the exit paths, for zero gas ──────────────────────────────────
  if (!me) {
    console.log('\n(no signer configured — cannot probe exit paths)');
    return;
  }

  console.log('\n═══ EXIT PATHS (static-called, nothing broadcast) ═══');
  const signer = getSigningClient().requireSigner();
  const w = new ethers.Contract(optionAddress!, OPTION_ABI as ethers.InterfaceAbi, signer);

  const probe = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      const result = await fn();
      console.log(`  ✓ ${label} — would SUCCEED${result === undefined || result === null ? '' : ` → ${result}`}`);
    } catch (e) {
      const msg = (e as Error).message;
      const reason =
        /reason="([^"]+)"/.exec(msg)?.[1] ??
        /reverted with reason string '([^']+)'/.exec(msg)?.[1] ??
        /custom error '([^']+)'/.exec(msg)?.[1] ??
        msg.split('\n')[0]?.slice(0, 140);
      console.log(`  ✗ ${label} — would REVERT: ${reason}`);
    }
  };

  await probe('close()', () => w.close!.staticCall());
  await probe('payout()', () => w.payout!.staticCall());
  if (typeof collateralAmount === 'bigint') {
    await probe('split(collateralAmount/2)', () => w.split!.staticCall(collateralAmount / 2n));
  }
  await probe('transfer(isBuyer=true, self)', () => w.transfer!.staticCall(true, me));
  await probe('reclaimCollateral(self-option)', () => w.reclaimCollateral!.staticCall(optionAddress));

  console.log('\n  Interpretation:');
  console.log('   · close() typically requires the caller to hold BOTH sides (buyer and seller),');
  console.log('     which annihilates the position and returns collateral. A long-only holder cannot.');
  console.log('   · payout() is the post-expiry settlement path, not an early exit.');
  console.log('   · If both revert, there is no early unwind on this venue and the honest');
  console.log('     rollback story is "let it expire", not "sell it back".');
}

main().catch((e) => {
  console.error('inspect-position failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

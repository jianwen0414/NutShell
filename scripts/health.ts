/**
 * Operator health check — PRD §9.6.
 *
 * "It is how a failure gets diagnosed in ten seconds instead of three
 * minutes." Same data the `/api/health` route will serve, runnable from a
 * terminal without the app.
 *
 *   npx tsx scripts/health.ts
 *   npx tsx scripts/health.ts --expect-address 0x…   # assert the burner identity
 *
 * Exits non-zero if any check fails, so it gates a live run.
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { OPTION_BOOK_ADDRESS, USDC_ADDRESS, basescanAddressUrl, config } from '../lib/config';
import { safeStringify } from '../lib/errors';
import { getProvider, healthCheck, signerAddress } from '../lib/thetanuts';

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const problems: string[] = [];
function check(ok: boolean, label: string, detail?: string): void {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) problems.push(label);
}

/** Rough USD value of a gas budget, for operator-facing cost lines. */
function usd(wei: bigint, ethUsd: number): string {
  return `$${(Number(ethers.formatEther(wei)) * ethUsd).toFixed(5)}`;
}

async function main(): Promise<void> {
  const h = await healthCheck();

  console.log('═══ RPC ═══');
  check(h.rpcOk, 'RPC reachable', h.rpcOk ? `block ${h.blockNumber}` : undefined);
  check(h.chainId === 8453, `chainId is Base mainnet 8453`, `got ${h.chainId}`);

  console.log('\n═══ BOOK ═══');
  check(h.bookOk, 'order book reachable', `${h.orderCount} orders`);
  check((h.vanillaPutCount ?? 0) > 0, 'vanilla puts available', `${h.vanillaPutCount} across ${Object.keys(h.perAsset ?? {}).length} assets`);
  if (h.perAsset) console.table(h.perAsset);

  console.log('\n═══ CLOCK ═══');
  if (h.snapshot) {
    console.log(`  feed currentTime : ${h.snapshot.feedNow}`);
    console.log(`  local skew       : ${h.snapshot.localClockSkewSeconds.toFixed(3)}s (limit ±${config.maxClockSkewS}s)`);
    console.log(`  cycle phase      : ${h.snapshot.clockSkewSeconds.toFixed(2)}s  (PRD §3.6 formula = TTL − 60)`);
  }
  check(h.clockSkewWithinLimit === true, 'local clock within MAX_CLOCK_SKEW_S');

  console.log('\n═══ BURNER ═══');
  check(h.signerConfigured, 'THETANUTS_PRIVATE_KEY configured');

  if (h.burner) {
    const expected = flag('expect-address');
    const addr = h.burner.address;
    const ethBal = BigInt(h.burner.ethWei);
    const usdcBal = BigInt(h.burner.usdcRaw);

    console.log(`  address : ${addr}`);
    console.log(`  explorer: ${basescanAddressUrl(addr)}`);
    console.log(`  ETH     : ${ethers.formatEther(ethBal)}`);
    console.log(`  USDC    : ${ethers.formatUnits(usdcBal, 6)}`);

    if (expected) {
      check(addr.toLowerCase() === expected.toLowerCase(), 'burner address matches --expect-address', `derived ${addr}`);
    }

    // Gas headroom. A fill is the expensive leg; approve and the attestation
    // self-transaction are trivial beside it.
    const fee = await getProvider().getFeeData();
    const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
    const ethUsd = Number(process.env.ETH_USD_HINT ?? 2457);
    console.log(`\n  gas price : ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
    const legs: [string, bigint][] = [
      ['approve', 60_000n],
      ['fillOrder', 1_200_000n],
      ['attestation self-tx', 35_000n],
      ['unwind close()', 300_000n],
    ];
    let total = 0n;
    for (const [label, gas] of legs) {
      const wei = gas * gasPrice;
      total += wei;
      console.log(`  ${label.padEnd(20)} ≤${gas} gas  ≈ ${ethers.formatEther(wei)} ETH  ${usd(wei, ethUsd)}`);
    }
    console.log(`  ${'FULL ROUND TRIP'.padEnd(20)}            ≈ ${ethers.formatEther(total)} ETH  ${usd(total, ethUsd)}`);

    check(ethBal > 0n, 'burner holds ETH for gas');
    check(ethBal > total * 3n, 'ETH covers a full round trip with 3× headroom', `have ${ethers.formatEther(ethBal)}, need ~${ethers.formatEther(total * 3n)}`);
    check(usdcBal > 0n, 'burner holds USDC for premium');
    check(
      usdcBal >= BigInt(Math.round(config.minFillUsdc * 1e6)),
      `USDC covers MIN_FILL_USDC (${config.minFillUsdc})`,
      `have ${ethers.formatUnits(usdcBal, 6)}`,
    );

    // Standing allowance to the OptionBook. Anything above zero here is a
    // live spend authorisation and should be understood before trading.
    const { getSigningClient } = await import('../lib/thetanuts');
    const allowance = await getSigningClient().erc20.getAllowance(USDC_ADDRESS, addr, OPTION_BOOK_ADDRESS);
    console.log(`\n  standing USDC allowance to OptionBook: ${ethers.formatUnits(allowance, 6)}`);
    check(allowance < ethers.MaxUint256 / 2n, 'no unlimited approval outstanding');
  }

  if (h.errors.length) {
    console.log('\n═══ ERRORS ═══');
    for (const e of h.errors) console.log(`  ✗ ${e}`);
    problems.push(...h.errors);
  }

  console.log('');
  if (problems.length) {
    console.log(`✗ ${problems.length} problem(s): ${problems.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('✓ all health checks green — safe to trade');
  }
}

main().catch((e) => {
  console.error('health check failed:', e instanceof Error ? e.message : e);
  if ((e as { details?: unknown })?.details) console.error(safeStringify((e as { details: unknown }).details, 2));
  process.exit(1);
});

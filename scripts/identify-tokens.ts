/**
 * Resolve token symbols and decimals on-chain — PRD §6.5.
 *
 * Reads `symbol()` and `decimals()` for every token appearing on the live
 * book and cross-checks them against the committed decimals table. A
 * mismatch is a hard failure: `availableAmount` is decoded at the collateral
 * token's scale, so a wrong entry is off by orders of magnitude.
 *
 *   npx tsx scripts/identify-tokens.ts
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { decimalsFor, isKnownToken, knownTokens, symbolFor } from '../lib/decimals';
import { fetchBookDecoded, getProvider } from '../lib/thetanuts';

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
];

async function readToken(address: string) {
  const c = new ethers.Contract(address, ERC20_ABI, getProvider());
  const [symbol, decimals, name] = await Promise.all([
    c.symbol!().catch(() => '(no symbol)'),
    c.decimals!().catch(() => null),
    c.name!().catch(() => '(no name)'),
  ]);
  return { symbol: String(symbol), decimals: decimals === null ? null : Number(decimals), name: String(name) };
}

async function main(): Promise<void> {
  const { orders } = await fetchBookDecoded();

  // Every token the book actually references, plus everything we claim to know.
  const onBook = new Map<string, { asCollateral: number; asUnderlying: number }>();
  for (const o of orders) {
    const c = o.collateralToken;
    onBook.set(c, { asCollateral: (onBook.get(c)?.asCollateral ?? 0) + 1, asUnderlying: onBook.get(c)?.asUnderlying ?? 0 });
    const u = o.underlyingToken;
    if (u !== '0x0000000000000000000000000000000000000000') {
      onBook.set(u, { asCollateral: onBook.get(u)?.asCollateral ?? 0, asUnderlying: (onBook.get(u)?.asUnderlying ?? 0) + 1 });
    }
  }

  const addresses = [...new Set([...onBook.keys(), ...knownTokens().map((t) => t.address)])].sort();
  console.log(`Reading ${addresses.length} tokens on-chain (${onBook.size} appear on the live book)…\n`);

  const rows: Record<string, unknown>[] = [];
  const mismatches: string[] = [];

  for (const address of addresses) {
    const chain = await readToken(address);
    const known = isKnownToken(address);
    const tableDecimals = known ? decimalsFor(address) : null;
    const tableSymbol = known ? symbolFor(address) : null;
    const usage = onBook.get(address);

    let verdict = 'ok';
    if (!known) {
      verdict = 'UNKNOWN — not in the decimals table';
      if (usage) mismatches.push(`${address} (${chain.symbol}) is on the book but absent from TOKEN_DECIMALS`);
    } else if (chain.decimals !== null && chain.decimals !== tableDecimals) {
      verdict = `DECIMALS MISMATCH — chain ${chain.decimals}, table ${tableDecimals}`;
      mismatches.push(`${address} (${chain.symbol}): chain says ${chain.decimals}, table says ${tableDecimals}`);
    } else if (tableSymbol && chain.symbol !== tableSymbol) {
      verdict = `symbol differs — chain "${chain.symbol}", table "${tableSymbol}"`;
    }

    rows.push({
      address: `${address.slice(0, 10)}…${address.slice(-4)}`,
      chainSymbol: chain.symbol,
      chainDec: chain.decimals,
      tableSymbol: tableSymbol ?? '—',
      tableDec: tableDecimals ?? '—',
      collateralOrders: usage?.asCollateral ?? 0,
      underlyingOrders: usage?.asUnderlying ?? 0,
      verdict,
    });
  }

  console.table(rows);

  console.log('\nFull addresses:');
  for (const a of addresses) console.log(`  ${a}  ${symbolFor(a)}`);

  console.log('');
  if (mismatches.length) {
    console.log('✗ TOKEN TABLE PROBLEMS — do not trade until these are resolved:');
    for (const m of mismatches) console.log(`   ${m}`);
    console.log('  availableAmount is decoded at the collateral token scale; a wrong entry is a wrong trade.');
    process.exitCode = 1;
  } else {
    console.log('✓ every token on the live book is in the decimals table, at the scale the chain reports');
  }
}

main().catch((e) => {
  console.error('identify-tokens failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

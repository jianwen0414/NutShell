/**
 * Inspect a fill or attestation transaction on Base mainnet.
 *
 * Reads the receipt, decodes the OptionBook's `OrderFilled` event, and — for
 * an attestation — decodes the calldata back to its canonical `NSHv1|…` line
 * and re-parses it. This is the verifier a judge could run: given only a
 * transaction hash, it reproduces the claim.
 *
 *   npx tsx scripts/inspect-tx.ts 0x<fill hash>
 *   npx tsx scripts/inspect-tx.ts 0x<attestation hash>
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { OPTION_BOOK_ABI } from '@thetanuts-finance/thetanuts-client';
import { parseCanonicalLine, verifyOnChain } from '../lib/attestation';
import { OPTION_BOOK_ADDRESS, basescanTxUrl } from '../lib/config';
import { fromScaled, symbolFor } from '../lib/decimals';
import { getProvider } from '../lib/thetanuts';

const hash = process.argv[2];
if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
  console.error('usage: npx tsx scripts/inspect-tx.ts 0x<32-byte tx hash>');
  process.exit(1);
}

async function main(): Promise<void> {
  const provider = getProvider();
  const [tx, receipt] = await Promise.all([provider.getTransaction(hash!), provider.getTransactionReceipt(hash!)]);

  if (!tx || !receipt) {
    console.error(`Transaction ${hash} not found on Base mainnet.`);
    process.exit(1);
  }

  console.log('═══ TRANSACTION ═══');
  console.log(`  hash      : ${tx.hash}`);
  console.log(`  explorer  : ${basescanTxUrl(tx.hash)}`);
  console.log(`  status    : ${receipt.status === 1 ? 'SUCCESS' : 'FAILED'}`);
  console.log(`  block     : ${receipt.blockNumber}`);
  console.log(`  from      : ${tx.from}`);
  console.log(`  to        : ${tx.to}`);
  console.log(`  value     : ${ethers.formatEther(tx.value)} ETH`);
  console.log(`  gasUsed   : ${receipt.gasUsed}`);
  console.log(`  gasPrice  : ${ethers.formatUnits(receipt.gasPrice ?? 0n, 'gwei')} gwei`);
  const feeWei = (receipt.gasUsed ?? 0n) * (receipt.gasPrice ?? 0n);
  console.log(`  tx fee    : ${ethers.formatEther(feeWei)} ETH`);
  console.log(`  calldata  : ${tx.data.length > 2 ? `${(tx.data.length - 2) / 2} bytes, selector ${tx.data.slice(0, 10)}` : '(none)'}`);

  // ── OrderFilled, if this was a fill ─────────────────────────────────────
  const iface = new ethers.Interface(OPTION_BOOK_ABI as ethers.InterfaceAbi);
  let sawFill = false;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== OPTION_BOOK_ADDRESS.toLowerCase()) continue;
    let parsed: ethers.LogDescription | null = null;
    try {
      parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
    } catch {
      continue;
    }
    if (parsed?.name !== 'OrderFilled') continue;
    sawFill = true;
    console.log('\n═══ OrderFilled (authoritative) ═══');
    console.log(`  optionAddress   : ${parsed.args.optionAddress}`);
    console.log(`  buyer           : ${parsed.args.buyer}`);
    console.log(`  seller          : ${parsed.args.seller}`);
    console.log(`  nonce           : ${parsed.args.nonce}`);
    console.log(`  premiumAmount   : ${parsed.args.premiumAmount} raw = ${fromScaled(parsed.args.premiumAmount, 6)} USDC`);
    console.log(`  feeCollected    : ${parsed.args.feeCollected} raw = ${fromScaled(parsed.args.feeCollected, 6)} USDC`);
    console.log(`  referralFeePaid : ${parsed.args.referralFeePaid}`);
    console.log(`  sellerWasMaker  : ${parsed.args.sellerWasMaker}`);
  }

  // ── ERC-20 transfers, so the money movement is visible ──────────────────
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const erc20 = new ethers.Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
  const transfers = receipt.logs.filter((l) => l.topics[0] === transferTopic);
  if (transfers.length) {
    console.log('\n═══ TOKEN TRANSFERS ═══');
    for (const log of transfers) {
      try {
        const p = erc20.parseLog({ topics: [...log.topics], data: log.data });
        if (!p) continue;
        const sym = symbolFor(log.address);
        const decimals = sym === 'USDC' || sym === 'aBasUSDC' ? 6 : 18;
        console.log(`  ${sym.padEnd(10)} ${fromScaled(p.args.value, decimals).padStart(14)}  ${p.args.from} → ${p.args.to}`);
      } catch {
        /* not a standard Transfer */
      }
    }
  }

  // ── Attestation, if the calldata carries one ────────────────────────────
  if (tx.data.length > 2 && tx.from.toLowerCase() === tx.to?.toLowerCase()) {
    console.log('\n═══ ATTESTATION ═══');
    const v = await verifyOnChain(hash!);
    console.log(`  self-transaction : ${v.selfTransaction}`);
    if (v.line) {
      console.log(`  decoded line     : ${v.line}`);
      const payload = parseCanonicalLine(v.line);
      if (payload) {
        console.log('  ✓ parses as a valid NSHv1 payload:');
        console.log(`      correlationId : ${payload.cid}`);
        console.log(`      truthScore    : ${payload.truthScore}`);
        console.log(`      agreement     : ${payload.agreement}`);
        console.log(`      severity      : ${payload.severity}`);
        console.log(`      gonkaIds      : ${payload.gonkaRequestIds.join(', ')}`);
        console.log(`      evidenceHash  : ${payload.evidenceHash}`);
        console.log(`      hedgeTxHash   : ${payload.hedgeTxHash}`);
        console.log(`      → the hedge it attests: ${basescanTxUrl(payload.hedgeTxHash)}`);
      } else {
        console.log('  ✗ calldata decoded, but it is not an NSHv1 payload');
      }
    } else if (v.error) {
      console.log(`  ✗ ${v.error}`);
    }
  } else if (!sawFill) {
    console.log('\n(no OrderFilled event and not a self-transaction — nothing further to decode)');
  }
}

main().catch((e) => {
  console.error('inspect-tx failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

/**
 * Reconstruct a position record from an on-chain fill.
 *
 * Given only a fill transaction hash, reads the `OrderFilled` event and the
 * deployed option contract, rebuilds the `HedgePosition`, and writes it to the
 * position store. Two uses:
 *
 *   · crash recovery — a fill that landed but whose record was lost
 *   · backfill — importing a fill made before the store existed
 *
 *   npx tsx scripts/import-position.ts 0x<fill hash> --cid nsh_…
 *   npx tsx scripts/import-position.ts 0x<fill hash> --cid nsh_… --attestation 0x<hash>
 *
 * The chain is the source of truth for every number written.
 */

import 'dotenv/config';
import { ethers } from 'ethers';
import { OPTION_ABI, OPTION_BOOK_ABI } from '@thetanuts-finance/thetanuts-client';
import { assetForFeed, implementationInfo } from '../lib/assets';
import { parseCanonicalLine, verifyOnChain } from '../lib/attestation';
import { OPTION_BOOK_ADDRESS, basescanTxUrl } from '../lib/config';
import { decodePrice, fromScaled, mulDecimal, symbolFor, decimalsFor } from '../lib/decimals';
import { savePosition } from '../lib/positions';
import { getProvider, fetchBookDecoded } from '../lib/thetanuts';
import type { Address, Attestation, DecodedOrder, HedgePosition, TxHash } from '../types/index';

const args = process.argv.slice(2);
const hash = args[0];
const flag = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) {
  console.error('usage: npx tsx scripts/import-position.ts 0x<fill hash> --cid nsh_… [--attestation 0x…]');
  process.exit(1);
}

async function main(): Promise<void> {
  const provider = getProvider();
  const receipt = await provider.getTransactionReceipt(hash!);
  if (!receipt) throw new Error(`Fill transaction ${hash} not found`);
  if (receipt.status !== 1) throw new Error(`Transaction ${hash} did not succeed`);

  // ── OrderFilled ─────────────────────────────────────────────────────────
  const bookIface = new ethers.Interface(OPTION_BOOK_ABI as ethers.InterfaceAbi);
  let filled: ethers.LogDescription | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== OPTION_BOOK_ADDRESS.toLowerCase()) continue;
    try {
      const p = bookIface.parseLog({ topics: [...log.topics], data: log.data });
      if (p?.name === 'OrderFilled') {
        filled = p;
        break;
      }
    } catch {
      /* not ours */
    }
  }
  if (!filled) throw new Error('No OrderFilled event in that transaction — is it a fill?');

  const optionAddress = String(filled.args.optionAddress).toLowerCase() as Address;
  const opt = new ethers.Contract(optionAddress, OPTION_ABI as ethers.InterfaceAbi, provider);

  const [buyer, seller, numContracts, collateralToken, collateralAmount, expiryTs, strikes, feed, impl, settled] =
    await Promise.all([
      opt.buyer!(),
      opt.seller!(),
      opt.numContracts!(),
      opt.collateralToken!(),
      opt.collateralAmount!(),
      opt.expiryTimestamp!(),
      opt.getStrikes!(),
      opt.chainlinkPriceFeed!(),
      opt.getImplementation!(),
      opt.optionSettled!(),
    ]);

  const collateral = String(collateralToken);
  const decimals = decimalsFor(collateral);
  const asset = assetForFeed(String(feed));
  const strike = decodePrice((strikes as bigint[])[0] as bigint);
  const contracts = fromScaled(numContracts as bigint, decimals);
  const premiumPaid = fromScaled(filled.args.premiumAmount as bigint, decimals);
  const block = await provider.getBlock(receipt.blockNumber);
  const openedAt = new Date((block?.timestamp ?? 0) * 1000).toISOString();

  // Spot at entry is not recorded on chain. Use the current book price and say
  // so, rather than inventing a historical number.
  const { snapshot } = await fetchBookDecoded();
  const spotNow = snapshot.prices[asset] ?? '0';

  console.log('═══ RECONSTRUCTED FROM CHAIN ═══');
  console.log(`  option        : ${optionAddress}`);
  console.log(`  asset         : ${asset}  (feed ${String(feed).toLowerCase()})`);
  console.log(`  implementation: ${implementationInfo(String(impl)).name}`);
  console.log(`  strike        : $${strike}`);
  console.log(`  contracts     : ${contracts}`);
  console.log(`  premium paid  : ${premiumPaid} ${symbolFor(collateral)}`);
  console.log(`  fee collected : ${fromScaled(filled.args.feeCollected as bigint, decimals)} ${symbolFor(collateral)}`);
  console.log(`  collateral esc: ${fromScaled(collateralAmount as bigint, decimals)} ${symbolFor(collateral)}`);
  console.log(`  buyer         : ${buyer}`);
  console.log(`  seller        : ${seller}`);
  console.log(`  expiry        : ${new Date(Number(expiryTs) * 1000).toISOString()}`);
  console.log(`  settled       : ${settled}`);
  console.log(`  opened at     : ${openedAt}`);

  // ── Correlation id: from the attestation if given, else required ────────
  let cid = flag('cid');
  let attestation: Attestation | undefined;
  const attHash = flag('attestation');
  if (attHash) {
    const v = await verifyOnChain(attHash);
    const payload = v.line ? parseCanonicalLine(v.line) : null;
    if (!payload) throw new Error(`${attHash} does not decode to an NSHv1 attestation`);
    if (payload.hedgeTxHash.toLowerCase() !== hash!.toLowerCase()) {
      throw new Error(`Attestation attests ${payload.hedgeTxHash}, not this fill ${hash}`);
    }
    cid ??= payload.cid;
    console.log(`\n  attestation   : ${attHash} → cid ${payload.cid} ✓ links to this fill`);
    attestation = {
      correlationId: payload.cid,
      method: 'SELF_TX',
      txHash: attHash as TxHash,
      baseScanUrl: basescanTxUrl(attHash),
      payload,
      createdAt: openedAt,
      canonicalLine: v.line!,
      payloadHex: '',
      payloadHash: '',
      ladderAttempts: [{ method: 'SELF_TX', ok: true }],
      wasDryRun: false,
    };
  }
  if (!cid) throw new Error('Pass --cid nsh_… (or --attestation, which carries it)');

  // A reconstructed order: every field the chain could tell us. `raw` is
  // deliberately null — the original signed quote is long dead and must never
  // be re-signed from a stored record.
  const order: DecodedOrder = {
    orderHash: `reconstructed:${hash}`,
    asset,
    priceFeed: String(feed).toLowerCase() as Address,
    isCall: false,
    isLong: false,
    strike,
    premiumPerContract: Number(contracts) > 0 ? String(Number(premiumPaid) / Number(contracts)) : '0',
    expiry: new Date(Number(expiryTs) * 1000).toISOString(),
    quoteExpiresAt: openedAt,
    quoteTtlSeconds: 0,
    availableAmount: fromScaled(collateralAmount as bigint, decimals),
    collateralToken: collateral.toLowerCase() as Address,
    underlyingToken: '0x0000000000000000000000000000000000000000' as Address,
    optionBookAddress: OPTION_BOOK_ADDRESS.toLowerCase() as Address,
    greeks: { delta: Number.NaN, iv: Number.NaN, gamma: Number.NaN, theta: Number.NaN, vega: Number.NaN },
    raw: null,
    implementationName: implementationInfo(String(impl)).name,
    implementationAddress: String(impl).toLowerCase() as Address,
    strikes: (strikes as bigint[]).map((s) => decodePrice(s)),
    isVanillaPut: implementationInfo(String(impl)).name === 'PUT' && (strikes as bigint[]).length === 1,
    collateralSymbol: symbolFor(collateral),
    collateralDecimals: decimals,
    maxCollateralUsable: fromScaled(collateralAmount as bigint, decimals),
    hoursToExpiry: (Number(expiryTs) - Date.now() / 1000) / 3600,
    spotAtDecode: spotNow,
    strikeDeviationPct: Number.NaN,
  };

  const position: HedgePosition = {
    correlationId: cid,
    status: settled ? 'EXPIRED' : 'OPEN',
    asset,
    strike,
    expiry: order.expiry,
    contracts,
    premiumPaidUsdc: premiumPaid,
    notionalProtectedUsdc: mulDecimal(contracts, strike, 6),
    entryTxHash: hash as TxHash,
    baseScanUrl: basescanTxUrl(hash!),
    spotAtEntry: spotNow,
    deltaAtEntry: Number.NaN,
    openedAt,
    wasDryRun: false,
    optionAddress,
    execution: {
      dryRun: false,
      selectedOrder: order,
      snapshot,
      selectionAttempts: 0,
      funnel: {
        fetched: 0,
        assetResolved: 0,
        vanillaPuts: 0,
        collateralSupported: 0,
        ttlOk: 0,
        expiryHorizonOk: 0,
        deltaBandOk: 0,
        liquidityOk: 0,
        affordable: 0,
        bestRejectedTtlSeconds: null,
      },
      premiumUsdc: premiumPaid,
      premiumRaw: String(filled.args.premiumAmount),
      contracts,
      contractsRaw: String(numContracts),
      approvalAmountRaw: String(filled.args.premiumAmount),
      existingAllowanceRaw: '0',
      approvalRequired: false,
      approvalTx: null,
      fillTx: { to: OPTION_BOOK_ADDRESS.toLowerCase() as Address, data: '0x', value: '0', chainId: 8453, description: 'reconstructed from chain' },
      ttlAtBuildSeconds: 0,
      buildLatencyMs: 0,
      buildStartedAtMs: Date.parse(openedAt),
      onChain: {
        optionAddress,
        premiumPaidRaw: String(filled.args.premiumAmount),
        feeCollectedRaw: String(filled.args.feeCollected),
        referralFeePaidRaw: String(filled.args.referralFeePaid),
        gasUsed: String(receipt.gasUsed),
        effectiveGasPriceWei: String(receipt.gasPrice ?? 0n),
        blockNumber: receipt.blockNumber,
      },
      warnings: [
        'Reconstructed from chain. Greeks, spot-at-entry and the selection funnel were not recorded on chain; ' +
          'spot shown is the CURRENT book price, not the price at entry.',
        '🔒 selectedOrder.raw is null — the original signed quote is dead and must never be re-signed.',
      ],
    },
  };

  const file = savePosition(position, attestation);
  console.log(`\n✓ written to ${file}`);
  console.log(`  correlationId: ${cid}`);
  console.log(`  status       : ${position.status}`);
  console.log(`  notional     : $${position.notionalProtectedUsdc}`);
}

main().catch((e) => {
  console.error('import-position failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});

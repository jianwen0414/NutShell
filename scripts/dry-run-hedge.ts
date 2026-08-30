/**
 * End-to-end hedge rehearsal against the live Base mainnet book.
 *
 * Runs the real `executeHedge` in dry-run mode: re-fetch → filter → resolve
 * asset → cross-check strike → select → size → compute the exact approval →
 * build both transactions → STOP at the signing boundary. Nothing is
 * broadcast and no key is required.
 *
 *   npx tsx scripts/dry-run-hedge.ts
 *   npx tsx scripts/dry-run-hedge.ts --asset SOL --budget 2.50
 *   npx tsx scripts/dry-run-hedge.ts --asset ETH --min-expiry-hours 168
 *   npx tsx scripts/dry-run-hedge.ts --live        # requires a funded burner
 *
 * `--live` is the ONLY difference between this rehearsal and a real trade.
 */

import 'dotenv/config';
import { attest, evidenceHashFor } from '../lib/attestation';
import { config } from '../lib/config';
import { newCorrelationId, safeStringify, toAppError } from '../lib/errors';
import { executeHedge, hasSigner, signerAddress } from '../lib/thetanuts';
import type { HedgePosition, TxHash } from '../types/index';

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (n: string): boolean => args.includes(`--${n}`);

const asset = (flag('asset') ?? 'ETH').toUpperCase();
const budgetUsdc = flag('budget') ?? String(config.hardCeilingUsdc);
const live = has('live');

function money(v: string): string {
  return `$${v}`;
}

async function main(): Promise<void> {
  const correlationId = newCorrelationId();

  console.log('═══ NUTSHELL HEDGE REHEARSAL ═══');
  console.log(`  correlationId : ${correlationId}`);
  console.log(`  asset         : ${asset}`);
  console.log(`  budget        : ${money(budgetUsdc)} USDC`);
  console.log(`  mode          : ${live ? '🔴 LIVE — this will spend real USDC on Base mainnet' : 'DRY RUN — nothing is signed'}`);
  console.log(`  signer        : ${hasSigner() ? signerAddress() : '(none configured — read-only)'}`);
  console.log(`  limits        : ceiling ${money(String(config.hardCeilingUsdc))} · min fill ${money(String(config.minFillUsdc))} · TTL floor ${config.quoteMinTtlS}s · retries ${config.maxSelectRetries}`);
  console.log(`  delta band    : [${config.targetDeltaMin}, ${config.targetDeltaMax}] · min expiry ${flag('min-expiry-hours') ?? config.minExpiryHours}h`);

  if (live && !hasSigner()) {
    console.error('\n✗ --live requires THETANUTS_PRIVATE_KEY. Refusing.');
    process.exit(1);
  }

  const minExpiryHours = flag('min-expiry-hours');
  const t0 = Date.now();

  let position: HedgePosition;
  try {
    position = await executeHedge({
      correlationId,
      asset,
      budgetUsdc,
      // Real Gonka IDs arrive from the verification layer (M2). In a
      // rehearsal there is no inference, so the payload is labelled as such
      // rather than fabricating an ID that would look real in an attestation.
      gonkaRequestIds: ['rehearsal-no-inference'],
      dryRun: !live,
      ...(minExpiryHours ? { minExpiryHours: Number(minExpiryHours) } : {}),
    });
  } catch (e) {
    const err = toAppError(e, correlationId);
    console.error(`\n✗ ${err.code}: ${err.message}`);
    if (err.details) console.error(safeStringify(err.details, 2));
    process.exit(1);
  }

  const elapsed = Date.now() - t0;
  const plan = position.execution;
  const o = plan.selectedOrder;

  console.log('\n═══ SELECTION ═══');
  console.log(`  attempts        : ${plan.selectionAttempts}`);
  console.log('  funnel          :');
  for (const [k, v] of Object.entries(plan.funnel)) console.log(`      ${k.padEnd(22)} ${v}`);

  console.log('\n═══ SELECTED ORDER ═══');
  console.log(`  ${o.asset} $${o.strike} PUT · expires ${o.expiry} (${o.hoursToExpiry}h out)`);
  console.log(`  orderHash       : ${o.orderHash}`);
  console.log(`  implementation  : ${o.implementationName} @ ${o.implementationAddress}`);
  console.log(`  priceFeed       : ${o.priceFeed}  ← the asset discriminator`);
  console.log(`  underlyingToken : ${o.underlyingToken}  (NOT used to identify the asset)`);
  console.log(`  spot at decode  : ${money(o.spotAtDecode)}`);
  console.log(`  strike deviation: ${(o.strikeDeviationPct * 100).toFixed(2)}% from spot (band ${(config.maxStrikeDeviationPct * 100).toFixed(0)}%)`);
  console.log(`  premium/contract: ${money(o.premiumPerContract)}`);
  console.log(`  greeks          : delta ${o.greeks.delta} · iv ${o.greeks.iv} · theta ${o.greeks.theta}`);
  console.log(`  collateral      : ${o.collateralSymbol} (${o.collateralDecimals}dp) · available ${o.availableAmount} · maxCollateralUsable ${o.maxCollateralUsable}`);
  console.log(`  quote TTL       : ${o.quoteTtlSeconds}s at fetch, ${plan.ttlAtBuildSeconds}s at build (built in ${plan.buildLatencyMs}ms)`);

  console.log('\n═══ SIZING ═══');
  console.log(`  premium         : ${money(plan.premiumUsdc)} ${o.collateralSymbol}  (raw ${plan.premiumRaw})`);
  console.log(`  contracts       : ${plan.contracts}  (raw ${plan.contractsRaw})`);
  console.log(`  notional cover  : ${money(position.notionalProtectedUsdc)}  = contracts × strike, the max payout`);
  const costPct = (Number(plan.premiumUsdc) / Number(position.notionalProtectedUsdc)) * 100;
  console.log(`  cost of cover   : ${costPct.toFixed(3)}% of notional`);

  console.log('\n═══ APPROVAL (🔒 exact amount, never MaxUint256) ═══');
  console.log(`  required        : ${plan.approvalRequired}`);
  console.log(`  existing allow. : ${plan.existingAllowanceRaw}`);
  console.log(`  approve exactly : ${plan.approvalAmountRaw}  (= the premium, to the wei)`);
  if (plan.approvalTx) {
    console.log(`  → to   : ${plan.approvalTx.to}`);
    console.log(`  → data : ${plan.approvalTx.data}`);
    console.log(`  → ${plan.approvalTx.description}`);
  }

  console.log('\n═══ FILL TRANSACTION (unsigned) ═══');
  console.log(`  to              : ${plan.fillTx.to}`);
  console.log(`  selector        : ${plan.fillTx.data.slice(0, 10)}`);
  console.log(`  calldata bytes  : ${(plan.fillTx.data.length - 2) / 2}`);
  console.log(`  value           : ${plan.fillTx.value}`);
  console.log(`  chainId         : ${plan.fillTx.chainId}`);
  console.log(`  ${plan.fillTx.description}`);
  if (has('calldata')) console.log(`  data            : ${plan.fillTx.data}`);

  if (plan.balances) {
    console.log('\n═══ BURNER ═══');
    console.log(`  address         : ${plan.signerAddress}`);
    console.log(`  ETH (wei)       : ${plan.balances.ethWei}`);
    console.log(`  ${plan.balances.collateralSymbol.padEnd(15)} : ${plan.balances.collateralRaw} (raw)`);
  }
  if (plan.gasEstimate) console.log(`  gas estimate    : ${safeStringify(plan.gasEstimate)}`);

  if (plan.warnings.length) {
    console.log('\n═══ WARNINGS ═══');
    for (const w of plan.warnings) console.log(`  ⚠ ${w}`);
  }

  console.log('\n═══ POSITION ═══');
  console.log(`  status          : ${position.status}`);
  console.log(`  wasDryRun       : ${position.wasDryRun}`);
  console.log(`  entryTxHash     : ${position.entryTxHash || '(none — stopped before signing)'}`);
  if (position.baseScanUrl) console.log(`  BaseScan        : ${position.baseScanUrl}`);

  // ── Attestation rehearsal ───────────────────────────────────────────────
  console.log('\n═══ ATTESTATION (PRD §12) ═══');
  const attestation = await attest({
    correlationId,
    truthScore: 88.5,
    agreement: 0.82,
    severity: 4,
    gonkaRequestIds: ['rehearsal-no-inference'],
    evidenceHash: evidenceHashFor({ rehearsal: true, correlationId, order: o.orderHash }),
    hedgeTxHash: position.entryTxHash as TxHash,
    dryRun: !live,
  });
  console.log(`  method          : ${attestation.method}`);
  console.log(`  canonical line  : ${attestation.canonicalLine}`);
  console.log(`  payload hex     : ${attestation.payloadHex.slice(0, 66)}…`);
  console.log(`  payload sha256  : ${attestation.payloadHash}`);
  console.log(`  ladder          : ${attestation.ladderAttempts.map((a) => `${a.method}${a.ok ? '✓' : '✗'}`).join(' → ')}`);
  for (const a of attestation.ladderAttempts.filter((x) => !x.ok)) console.log(`      ${a.method}: ${a.error}`);
  if (attestation.txHash) console.log(`  txHash          : ${attestation.txHash}  ${attestation.baseScanUrl}`);

  console.log(`\n✓ ${live ? 'LIVE FILL COMPLETE' : 'DRY RUN COMPLETE'} in ${elapsed}ms — ${live ? 'position is open' : 'nothing was signed or broadcast'}`);
  if (!live) {
    console.log('  Everything above ran against the real Base mainnet book. Flipping --live is the only change needed.');
  }
}

main().catch((e) => {
  const err = toAppError(e);
  console.error(`\n✗ ${err.code}: ${err.message}`);
  if (err.details) console.error(safeStringify(err.details, 2));
  process.exit(1);
});

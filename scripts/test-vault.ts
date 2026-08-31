/**
 * Vault checks.
 *
 *   npm run test:vault
 *
 * The requirement is: state derives from the ledger and is never a stored mutable
 * balance, principal is never debited by any code path, and isSimulated is
 * surfaced. The middle one is the important test: it is the entire basis of
 * the "yield-funded" claim.
 */
import assert from 'node:assert/strict';
import {
  InMemoryLedgerStore,
  SimulatedVaultDriver,
  SIMULATED_VAULT_BANNER,
  deriveState,
  type LedgerEntry,
  type VaultConfig,
} from '../lib/vault.js';

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`      ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    });
}

const CFG: VaultConfig = {
  principalUsdc: '1000.00',
  apyBps: 500,
  dailyCapPct: 5,
  openingAccrualUsdc: '12.00',
};

const NOW = '2026-08-31T12:00:00.000Z';
const clock = () => NOW;

const entry = (
  entryType: LedgerEntry['entryType'],
  amountUsdc: string,
  createdAt = NOW,
): LedgerEntry => ({ entryType, amountUsdc, createdAt });

async function main() {
  console.log('\nderived state');

  await check('an empty ledger yields a zero reserve, not an error', () => {
    const s = deriveState([], CFG, NOW);
    assert.equal(s.premiumReserveUsdc, '0');
    assert.equal(s.accruedYieldUsdc, '0');
    assert.equal(s.principalUsdc, '1000');
  });

  await check('reserve is accruals plus recoveries plus harvests, minus spends', () => {
    // 12 + 2 + 1 − 5 = 10
    const s = deriveState(
      [
        entry('YIELD_ACCRUAL', '12.00'),
        entry('PREMIUM_SPEND', '5.00'),
        entry('PREMIUM_RECOVERY', '2.00'),
        entry('HARVEST', '1.00'),
      ],
      CFG,
      NOW,
    );
    assert.equal(s.premiumReserveUsdc, '10');
    assert.equal(s.accruedYieldUsdc, '12');
  });

  await check('daily cap is a percentage of principal', () => {
    // 1000 × 5% = 50
    assert.equal(deriveState([], CFG, NOW).dailyCapUsdc, '50');
  });

  await check('daily spend is gross, so a rollback does not refund the allowance', () => {
    const s = deriveState(
      [entry('YIELD_ACCRUAL', '12.00'), entry('PREMIUM_SPEND', '2.00'), entry('PREMIUM_RECOVERY', '1.80')],
      CFG,
      NOW,
    );
    assert.equal(s.dailySpentUsdc, '2', 'recovery must not restore the daily budget');
    assert.equal(s.premiumReserveUsdc, '11.8', 'but it does return to the reserve');
  });

  await check('spends older than 24h leave the daily window', () => {
    const s = deriveState(
      [entry('YIELD_ACCRUAL', '12.00'), entry('PREMIUM_SPEND', '3.00', '2026-08-29T12:00:00.000Z')],
      CFG,
      NOW,
    );
    assert.equal(s.dailySpentUsdc, '0');
    assert.equal(s.premiumReserveUsdc, '9', 'but it still left the reserve permanently');
  });

  await check('a negative ledger amount is rejected, not absorbed', () => {
    assert.throws(() => deriveState([entry('YIELD_ACCRUAL', '-5.00')], CFG, NOW), /negative/i);
  });

  console.log('\nprincipal is never debited');

  await check('spending everything available leaves principal untouched', async () => {
    const v = new SimulatedVaultDriver(new InMemoryLedgerStore(), CFG, clock);
    await v.reservePremium('12.00', 'nsh_a');
    const s = await v.getState();
    assert.equal(s.premiumReserveUsdc, '0');
    assert.equal(s.principalUsdc, '1000', 'principal moved');
  });

  await check('a spend beyond the reserve is refused', async () => {
    const v = new SimulatedVaultDriver(new InMemoryLedgerStore(), CFG, clock);
    await assert.rejects(() => v.reservePremium('12.01', 'nsh_b'), /INSUFFICIENT_RESERVE|exceeds/i);
  });

  await check('a refused spend writes nothing to the ledger', async () => {
    const store = new InMemoryLedgerStore();
    const v = new SimulatedVaultDriver(store, CFG, clock);
    await v.getState();
    const before = (await store.list()).length;
    await v.reservePremium('999.00', 'nsh_c').catch(() => {});
    assert.equal((await store.list()).length, before, 'a rejected spend left a ledger entry');
  });

  await check('no sequence of spends can reach principal', async () => {
    const v = new SimulatedVaultDriver(new InMemoryLedgerStore(), CFG, clock);
    for (let i = 0; i < 20; i++) await v.reservePremium('1.00', `nsh_${i}`).catch(() => {});
    const s = await v.getState();
    assert.equal(s.principalUsdc, '1000');
    assert.ok(Number(s.premiumReserveUsdc) >= 0, 'reserve went negative');
  });

  await check('zero and negative amounts are rejected', async () => {
    const v = new SimulatedVaultDriver(new InMemoryLedgerStore(), CFG, clock);
    await assert.rejects(() => v.reservePremium('0', 'nsh_d'), /positive/i);
    await assert.rejects(() => v.recoverPremium('-1', 'nsh_e'), /positive/i);
  });

  console.log('\ndriver behaviour');

  await check('opening balance is seeded once, as a visible ledger entry', async () => {
    const store = new InMemoryLedgerStore();
    const v = new SimulatedVaultDriver(store, CFG, clock);
    await v.getState();
    await v.getState();
    const entries = await store.list();
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.entryType, 'YIELD_ACCRUAL');
    assert.match(entries[0]!.note ?? '', /opening/i);
  });

  await check('accrueYield adds one day of interest at the configured rate', async () => {
    const store = new InMemoryLedgerStore();
    const v = new SimulatedVaultDriver(store, CFG, clock);
    await v.accrueYield();
    // 1000 × 500bps = 50/yr ÷ 365 = 0.136986
    const accrual = (await store.list()).find((e) => e.note?.includes('daily accrual'));
    assert.equal(accrual?.amountUsdc, '0.136986');
  });

  await check('recovery returns to the reserve after an unwind', async () => {
    const v = new SimulatedVaultDriver(new InMemoryLedgerStore(), CFG, clock);
    await v.reservePremium('2.15', 'nsh_f');
    assert.equal((await v.getState()).premiumReserveUsdc, '9.85');
    await v.recoverPremium('1.80', 'nsh_f');
    assert.equal((await v.getState()).premiumReserveUsdc, '11.65');
  });

  await check('every spend is attributable to a correlation id', async () => {
    const store = new InMemoryLedgerStore();
    const v = new SimulatedVaultDriver(store, CFG, clock);
    await v.reservePremium('1.00', 'nsh_trace123');
    const spend = (await store.list()).find((e) => e.entryType === 'PREMIUM_SPEND');
    assert.equal(spend?.correlationId, 'nsh_trace123');
  });

  console.log('\nhonesty');

  await check('isSimulated is true and the driver names itself', async () => {
    const s = await new SimulatedVaultDriver(new InMemoryLedgerStore(), CFG, clock).getState();
    assert.equal(s.isSimulated, true);
    assert.equal(s.driver, 'SIMULATED');
  });

  await check('the banner says modelled yield AND real premiums', () => {
    assert.match(SIMULATED_VAULT_BANNER, /simulated vault/i);
    assert.match(SIMULATED_VAULT_BANNER, /modelled/i);
    assert.match(SIMULATED_VAULT_BANNER, /real USDC on Base mainnet/i);
  });

  console.log('\nconfig sanity');

  await check('the burner balance would make the daily cap unusable', () => {
    // The burner holds about 5 USDC. 5% of that is 0.25, under the 0.50
    // MIN_FILL floor, so nothing could ever trade. The vault models the
    // portfolio, not the wallet. This test exists so nobody "fixes" the
    // principal down to the burner balance and silently kills every trade.
    const burner = deriveState([], { ...CFG, principalUsdc: '5.00' }, NOW);
    assert.ok(Number(burner.dailyCapUsdc) < 0.5, 'assumption changed, revisit the config note');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

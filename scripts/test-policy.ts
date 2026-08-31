/**
 * Policy engine checks: the tier matrix, sizing, deduplication and asset mapping.
 *
 *   npm run test:policy
 *
 * The requirement is a unit test for every matrix row, sizing that respects all four
 * caps, bindingCap always populated, SIZE_BELOW_MINIMUM skipping cleanly, and
 * the one-open-hedge-per-asset invariant holding. Every expected number was
 * worked out by hand from the formulas.
 */
import assert from 'node:assert/strict';
import {
  cooldownRemainingMs,
  decide,
  fromMicros,
  selectTier,
  sizeHedge,
  toMicros,
  type PolicyState,
  type Thresholds,
} from '../lib/policy';
import { mapEventToAsset } from '../lib/event-mapping';
import type { AlertEvent, ConsensusMetrics, VerificationResult } from "@/types";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}`);
    console.log(`      ${e instanceof Error ? e.message.split('\n')[0] : e}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// Fixed thresholds so the tests never depend on whatever is in .env.
const T: Thresholds = {
  truthHedge: 70,
  truthFull: 85,
  agreement: 0.6,
  agreementFull: 0.75,
  hardCeilingUsdc: '3.00',
  minFillUsdc: '0.50',
  cooldownMinutes: 30,
};

const NOW = '2026-08-31T12:00:00.000Z';

const state = (over: Partial<PolicyState> = {}): PolicyState => ({
  premiumReserveUsdc: '10.00',
  dailyCapUsdc: '5.00',
  dailySpentUsdc: '0',
  openHedges: [],
  clusterHistory: [],
  now: NOW,
  ...over,
});

const consensus = (over: Partial<ConsensusMetrics> = {}): ConsensusMetrics => ({
  truthScore: 90,
  severity: 4,
  agreement: 0.9,
  spread: 5,
  concordance: 1,
  conviction: 0.81,
  debateTriggered: false,
  modelsResponded: 3,
  ...over,
});

const alert = (rawText: string, clusterKey = 'c1'): AlertEvent => ({
  id: 'nsh_test0000000001',
  source: 'SIMULATOR',
  rawText,
  receivedAt: NOW,
  clusterKey,
});

const verification = (c: ConsensusMetrics): VerificationResult => ({
  correlationId: 'nsh_test0000000001',
  alertId: 'nsh_test0000000001',
  verdicts: [],
  consensus: c,
  reasoningTrace: [],
  gonkaRequestIds: [],
  idChainResolvable: false,
  verifiedAt: NOW,
  totalLatencyMs: 1,
});

// ── Money helpers ─────────────────────────────────────────────────────────
section('decimal money (no floats)');

check('round trips without precision loss', () => {
  assert.equal(fromMicros(toMicros('2.15')), '2.15');
  assert.equal(fromMicros(toMicros('0.000001')), '0.000001');
  assert.equal(fromMicros(toMicros('3.00')), '3');
  assert.equal(toMicros('1.5'), 1_500_000n);
});

check('0.1 + 0.2 does not drift', () => {
  assert.equal(fromMicros(toMicros('0.1') + toMicros('0.2')), '0.3');
});

// ── the matrix, one test per row ─────────────────────────────────────────
section('matrix rows');

check('truth < 40 → REJECT', () => {
  assert.equal(selectTier(39, 1.0, 5, T).tier, 'REJECT');
});

check('truth 40-69 → WATCH', () => {
  assert.equal(selectTier(40, 1.0, 5, T).tier, 'WATCH');
  assert.equal(selectTier(69, 1.0, 5, T).tier, 'WATCH');
});

check('truth ≥70 with agreement < 0.60 → ESCALATE', () => {
  assert.equal(selectTier(70, 0.59, 5, T).tier, 'ESCALATE');
  assert.equal(selectTier(99, 0.1, 5, T).tier, 'ESCALATE');
});

check('truth ≥70, agreement ≥0.60, severity 1-2 → WATCH', () => {
  assert.equal(selectTier(90, 0.9, 1, T).tier, 'WATCH');
  assert.equal(selectTier(90, 0.9, 2, T).tier, 'WATCH');
});

check('truth ≥70, agreement ≥0.60, severity 3 → HEDGE_SMALL', () => {
  assert.equal(selectTier(70, 0.6, 3, T).tier, 'HEDGE_SMALL');
});

check('truth ≥85, agreement ≥0.75, severity 4-5 → HEDGE_FULL', () => {
  assert.equal(selectTier(85, 0.75, 4, T).tier, 'HEDGE_FULL');
  assert.equal(selectTier(100, 1.0, 5, T).tier, 'HEDGE_FULL');
});

check('GAP: truth 70-84, severity 4-5 → HEDGE_SMALL, not silence', () => {
  // The measured demo fixture: truth ~75, agreement ~0.9, severity 4.
  // The table as written matches no row here.
  assert.equal(selectTier(75, 0.9, 4, T).tier, 'HEDGE_SMALL');
  assert.equal(selectTier(84, 0.74, 5, T).tier, 'HEDGE_SMALL');
});

check('DEGRADED PANEL: 2 of 3 responding cannot reach HEDGE_FULL', () => {
  // Same inputs that give HEDGE_FULL on a full panel.
  assert.equal(selectTier(95, 0.95, 5, T, 3).tier, 'HEDGE_FULL');
  assert.equal(selectTier(95, 0.95, 5, T, 2).tier, 'HEDGE_SMALL');
});

check('a degraded panel still hedges, it just does not max out', () => {
  const r = selectTier(95, 0.95, 5, T, 2);
  assert.equal(r.tier, 'HEDGE_SMALL');
  assert.match(r.reason, /2 of 3/);
});

check('decide() reads modelsResponded from the consensus', () => {
  const two = decide(
    alert('Solana exploit draining validator funds'),
    verification(consensus({ truthScore: 95, agreement: 0.95, severity: 5, modelsResponded: 2 })),
    state(),
    T,
  );
  const three = decide(
    alert('Solana exploit draining validator funds'),
    verification(consensus({ truthScore: 95, agreement: 0.95, severity: 5, modelsResponded: 3 })),
    state(),
    T,
  );
  assert.equal(two.tier, 'HEDGE_SMALL');
  assert.equal(three.tier, 'HEDGE_FULL');
  // And the size difference is real, not cosmetic.
  assert.notEqual(two.targetSizeUsdc, three.targetSizeUsdc);
});

check('severity never lowers protection at equal confidence', () => {
  // Monotonicity: the whole justification for how the gap was filled.
  const order = { REJECT: 0, WATCH: 1, ESCALATE: 1, HEDGE_SMALL: 2, HEDGE_FULL: 3 };
  for (let s = 3; s <= 5; s++) {
    const here = order[selectTier(80, 0.8, s, T).tier];
    const below = order[selectTier(80, 0.8, s - 1, T).tier];
    assert.ok(here >= below, `severity ${s} protected less than ${s - 1}`);
  }
});

// ── sizing ───────────────────────────────────────────────────────────────
section('sizing and bindingCap');

check('CEILING binds when reserve is plentiful', () => {
  // min(10.00, 5.00, 3.00) = 3.00 · 3.00 × 1.0 × 0.81 = 2.43
  const s = sizeHedge('HEDGE_FULL', 0.81, state(), T);
  assert.equal(s.budgetUsdc, '3');
  assert.equal(s.bindingCap, 'CEILING');
  assert.equal(s.sizeUsdc, '2.43');
});

check('RESERVE binds when the vault is nearly empty', () => {
  // min(1.00, 5.00, 3.00) = 1.00 · × 1.0 × 0.81 = 0.81
  const s = sizeHedge('HEDGE_FULL', 0.81, state({ premiumReserveUsdc: '1.00' }), T);
  assert.equal(s.bindingCap, 'RESERVE');
  assert.equal(s.sizeUsdc, '0.81');
});

check('DAILY binds on remaining allowance, not the cap', () => {
  // 5.00 cap − 4.00 spent = 1.00 remaining, below the 3.00 ceiling
  const s = sizeHedge('HEDGE_FULL', 1.0, state({ dailySpentUsdc: '4.00' }), T);
  assert.equal(s.bindingCap, 'DAILY');
  assert.equal(s.sizeUsdc, '1');
});

check('LIQUIDITY binds when the book is thin', () => {
  const s = sizeHedge('HEDGE_FULL', 1.0, state({ bookLiquidityUsdc: '0.90' }), T);
  assert.equal(s.bindingCap, 'LIQUIDITY');
  assert.equal(s.sizeUsdc, '0.9');
});

check('TIER binds when a per-tier cap is set', () => {
  const s = sizeHedge('HEDGE_FULL', 1.0, state({ tierCapUsdc: '0.75' }), T);
  assert.equal(s.bindingCap, 'TIER');
});

check('HEDGE_SMALL commits 0.3 of budget', () => {
  // 3.00 × 0.3 × 1.0 = 0.90
  const s = sizeHedge('HEDGE_SMALL', 1.0, state(), T);
  assert.equal(s.sizeUsdc, '0.9');
});

check('bindingCap is always populated', () => {
  for (const st of [state(), state({ dailySpentUsdc: '5.00' }), state({ premiumReserveUsdc: '0' })]) {
    const s = sizeHedge('HEDGE_FULL', 0.5, st, T);
    assert.ok(s.bindingCap.length > 0, 'bindingCap empty');
  }
});

check('a spent daily cap yields zero, not a negative size', () => {
  const s = sizeHedge('HEDGE_FULL', 1.0, state({ dailySpentUsdc: '9.00' }), T);
  assert.equal(s.sizeUsdc, '0');
  assert.equal(s.belowMinimum, true);
});

// ── asset mapping ────────────────────────────────────────────────────────
section('event to instrument');

check('DIRECT on a listed asset', () => {
  const m = mapEventToAsset('Solana validator set compromised in an exploit', 4);
  assert.equal(m.asset, 'SOL');
  assert.equal(m.rule, 'DIRECT');
});

check('DIRECT picks the first-named subject when several appear', () => {
  const m = mapEventToAsset('Binance halts SOL and BTC withdrawals after an incident', 4);
  assert.equal(m.asset, 'BNB');
  assert.deepEqual(m.candidates, ['BNB', 'SOL', 'BTC']);
});

check('CONTAGION via an L2 that settles on ETH', () => {
  const m = mapEventToAsset('A bridge on Base was drained of $40M', 4);
  assert.equal(m.asset, 'ETH');
  assert.equal(m.rule, 'CONTAGION');
});

check('CONTAGION for an unlisted asset when systemic', () => {
  const m = mapEventToAsset('Major stablecoin depeg spreading across lending markets', 5);
  assert.equal(m.asset, 'ETH');
  assert.equal(m.rule, 'CONTAGION');
});

check('ABSTAIN when unlisted and contained', () => {
  const m = mapEventToAsset('A small NFT marketplace paused withdrawals', 2);
  assert.equal(m.asset, null);
  assert.equal(m.rule, 'ABSTAIN');
});

check('word boundaries: "based" is not "Base"', () => {
  const m = mapEventToAsset('A based approach to NFT trading was announced', 2);
  assert.equal(m.rule, 'ABSTAIN');
});

// ── dedupe, cooldown, one open hedge ─────────────────────────────────────
section('deduplication');

check('cooldown suppresses a repeat inside 30 minutes', () => {
  const st = state({
    clusterHistory: [{ clusterKey: 'c1', lastExecutedAt: '2026-08-31T11:45:00.000Z' }],
  });
  assert.equal(cooldownRemainingMs('c1', st, T), 15 * 60_000);
  const d = decide(alert('Solana exploit draining funds'), verification(consensus()), st, T);
  assert.equal(d.tier, 'WATCH');
  assert.match(d.reason, /cooldown/i);
});

check('cooldown expires after the window', () => {
  const st = state({
    clusterHistory: [{ clusterKey: 'c1', lastExecutedAt: '2026-08-31T11:29:00.000Z' }],
  });
  assert.equal(cooldownRemainingMs('c1', st, T), 0);
});

check('a different cluster is unaffected by the cooldown', () => {
  const st = state({
    clusterHistory: [{ clusterKey: 'other', lastExecutedAt: NOW }],
  });
  assert.equal(cooldownRemainingMs('c1', st, T), 0);
});

check('second signal increases an open hedge, never duplicates it', () => {
  const st = state({
    openHedges: [{ asset: 'SOL', correlationId: 'nsh_prev', sizeUsdc: '1.00' }],
  });
  const d = decide(alert('Solana exploit escalating'), verification(consensus()), st, T);
  // Indicated 2.43, already holding 1.00, so the top-up is 1.43.
  assert.equal(d.tier, 'HEDGE_FULL');
  assert.equal(d.targetSizeUsdc, '1.43');
  assert.match(d.reason, /increasing/i);
});

check('no duplicate when the open hedge already covers it', () => {
  const st = state({
    openHedges: [{ asset: 'SOL', correlationId: 'nsh_prev', sizeUsdc: '5.00' }],
  });
  const d = decide(alert('Solana exploit escalating'), verification(consensus()), st, T);
  assert.equal(d.tier, 'WATCH');
  assert.equal(d.targetSizeUsdc, '0');
});

// ── End to end ────────────────────────────────────────────────────────────
section('decide() end to end');

check('SIZE_BELOW_MINIMUM skips cleanly rather than throwing', () => {
  const st = state({ premiumReserveUsdc: '0.20' });
  const d = decide(alert('Solana exploit'), verification(consensus()), st, T);
  assert.equal(d.tier, 'WATCH');
  assert.match(d.reason, /SIZE_BELOW_MINIMUM/);
  assert.equal(d.bindingCap, 'RESERVE');
});

check('an unmappable alert is downgraded however credible', () => {
  const d = decide(
    alert('A small NFT marketplace paused withdrawals'),
    verification(consensus({ severity: 3 })),
    state(),
    T,
  );
  assert.equal(d.tier, 'WATCH');
  assert.equal(d.mappingRule, 'ABSTAIN');
});

check('mappingRule is recorded on every decision', () => {
  for (const [text, sev] of [
    ['Solana exploit', 4],
    ['A bridge on Base drained', 4],
    ['Small NFT market paused', 1],
  ] as const) {
    const d = decide(alert(text), verification(consensus({ severity: sev })), state(), T);
    assert.ok(d.mappingRule, 'mappingRule missing');
  }
});

check('the measured demo fixture produces a real trade', () => {
  // truth 75, agreement 0.9, severity 4, conviction 0.675 — the numbers
  // diag-variance actually reports. 3.00 × 0.3 × 0.675 = 0.6075
  const d = decide(
    alert('Exploit against a cross-chain bridge on Base, $41M drained'),
    verification(consensus({ truthScore: 75, agreement: 0.9, severity: 4, conviction: 0.675 })),
    state(),
    T,
  );
  assert.equal(d.tier, 'HEDGE_SMALL');
  assert.equal(d.targetAsset, 'ETH');
  assert.equal(d.mappingRule, 'CONTAGION');
  assert.equal(d.targetSizeUsdc, '0.6075');
  assert.equal(d.bindingCap, 'CEILING');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

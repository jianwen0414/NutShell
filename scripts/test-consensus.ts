/**
 * Hand-computed checks for the aggregation math.
 *
 *   npm run test:consensus
 *
 * Every expected number below was worked out on paper from the formulas, not
 * hand-computed cases". Every expected number below was worked out on paper
 * from the formulas, not copied from a program run — a test that records what
 * the code already does cannot catch the code being wrong.
 *
 *   truthScore  = mean(claimScore)
 *   severity    = median(severity)
 *   spread      = max − min
 *   concordance = |modal stance| / n
 *   agreement   = concordance × (1 − min(spread,100)/100)
 *   conviction  = (truthScore/100) × agreement
 */
import assert from 'node:assert/strict';
import { computeConsensus } from '../lib/consensus';
import type { ModelVerdict, Stance } from "@/types";

let passed = 0;
let failed = 0;

function verdict(claimScore: number, severity: number, stance: Stance): ModelVerdict {
  return {
    modelId: `m${claimScore}`,
    role: 'ANALYST',
    claimScore,
    severity: severity as ModelVerdict['severity'],
    stance,
    keyEvidence: [],
    redFlags: [],
    gonkaRequestId: 'devshard-test',
    responseHash: 'x'.repeat(64),
    latencyMs: 1,
    parseRepaired: false,
  };
}

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

console.log('\naggregation math\n');

// ── Case 1: three models, unanimous stance ────────────────────────────────
// scores 80,90,85 → mean 85 · spread 10 · concordance 3/3 = 1
// agreement 1 × (1 − 0.10) = 0.90 · conviction 0.85 × 0.90 = 0.765
// severities 4,4,5 → median 4
check('unanimous REAL, tight spread', () => {
  const c = computeConsensus([
    verdict(80, 4, 'REAL'),
    verdict(90, 4, 'REAL'),
    verdict(85, 5, 'REAL'),
  ]);
  assert.equal(c.truthScore, 85);
  assert.equal(c.severity, 4);
  assert.equal(c.spread, 10);
  assert.equal(c.concordance, 1);
  assert.equal(c.agreement, 0.9);
  assert.equal(c.conviction, 0.765);
  assert.equal(c.modelsResponded, 3);
});

// ── Case 2: three-way stance split ────────────────────────────────────────
// scores 90,20,55 → mean 55 · spread 70
// every stance distinct → modal count 1 → concordance 1/3 = 0.3333
// agreement 0.3333 × (1 − 0.70) = 0.1 · conviction 0.55 × 0.1 = 0.055
// severities 5,2,3 → median 3
check('three-way split collapses agreement', () => {
  const c = computeConsensus([
    verdict(90, 5, 'REAL'),
    verdict(20, 2, 'FAKE'),
    verdict(55, 3, 'UNCERTAIN'),
  ]);
  assert.equal(c.truthScore, 55);
  assert.equal(c.severity, 3);
  assert.equal(c.spread, 70);
  assert.equal(c.concordance, 0.3333);
  assert.equal(c.agreement, 0.1);
  assert.equal(c.conviction, 0.055);
});

// ── Case 3: 2 of 3, the everyday case while Kimi is unreliable ────────────
// scores 70,80 → mean 75 · spread 10 · concordance 2/2 = 1
// agreement 0.90 · conviction 0.75 × 0.90 = 0.675
// severities 4,5 → even count → midpoint 4.5 → rounds half UP to 5
check('quorum of 2, even-count median rounds up', () => {
  const c = computeConsensus([verdict(70, 4, 'REAL'), verdict(80, 5, 'REAL')]);
  assert.equal(c.truthScore, 75);
  assert.equal(c.severity, 5);
  assert.equal(c.agreement, 0.9);
  assert.equal(c.conviction, 0.675);
  assert.equal(c.modelsResponded, 2);
});

// ── Case 4: quorum floor — never trade on one opinion ──────────────────
check('one verdict raises GONKA_QUORUM_FAILED', () => {
  assert.throws(() => computeConsensus([verdict(95, 5, 'REAL')]), /GONKA_QUORUM_FAILED|quorum/i);
});

check('zero verdicts raises GONKA_QUORUM_FAILED', () => {
  assert.throws(() => computeConsensus([]), /GONKA_QUORUM_FAILED|quorum/i);
});

// ── Case 5: maximum spread wipes agreement out entirely ───────────────────
// scores 0,100 → spread 100 → (1 − 100/100) = 0 → agreement 0 whatever
// the stances are. conviction 0.50 × 0 = 0.
check('full spread drives agreement to zero', () => {
  const c = computeConsensus([verdict(0, 1, 'REAL'), verdict(100, 5, 'REAL')]);
  assert.equal(c.truthScore, 50);
  assert.equal(c.spread, 100);
  assert.equal(c.concordance, 1);
  assert.equal(c.agreement, 0);
  assert.equal(c.conviction, 0);
});

// ── Case 6: 2 of 3 disagreeing — no majority exists ───────────────────────
// concordance 1/2 = 0.5 · spread 40 → agreement 0.5 × 0.60 = 0.3
check('two models, opposite stances, no modal winner', () => {
  const c = computeConsensus([verdict(70, 4, 'REAL'), verdict(30, 2, 'FAKE')]);
  assert.equal(c.truthScore, 50);
  assert.equal(c.spread, 40);
  assert.equal(c.concordance, 0.5);
  assert.equal(c.agreement, 0.3);
});

// ── Case 7: the synthesizer must never reach the arithmetic ───────────────
// A SYNTHESIZER verdict in the array would corrupt every number. This is
// this : truthScore stays mechanical and cannot be argued away.
check('non-ANALYST roles are excluded from the maths', () => {
  const synth = { ...verdict(10, 1, 'FAKE'), role: 'SYNTHESIZER' as const };
  const c = computeConsensus([verdict(80, 4, 'REAL'), verdict(90, 4, 'REAL'), synth]);
  assert.equal(c.truthScore, 85, 'synthesizer leaked into truthScore');
  assert.equal(c.modelsResponded, 2);
});

// ── Case 8: fixture-derived regression guard ──────────────────────────────
// The measured REAL result on 30 Aug: 72 / 78 both REAL.
// mean 75 · spread 6 · concordance 1 · agreement 1 × 0.94 = 0.94
// This is the number the demo depends on clearing the 70 threshold.
check('measured REAL fixture reproduces 75 / 0.94', () => {
  const c = computeConsensus([verdict(72, 3, 'REAL'), verdict(78, 4, 'REAL')]);
  assert.equal(c.truthScore, 75);
  assert.equal(c.agreement, 0.94);
});

console.log(`\n${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('NOTE: these formulas are frozen. If a case fails, the code is wrong —');
  console.log('      do not "fix" it by editing the expected value.\n');
  process.exit(1);
}

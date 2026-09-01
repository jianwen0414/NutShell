/**
 * The rollback beat, in its honest form: **the agent declines to spend.**
 *
 * The original demo beat — "inject a debunk, the agent unwinds, show the
 * measured premium recovery" — is not implementable. Measured on mainnet,
 * a long vanilla put has NO early exit on this venue: `close()` needs one
 * address holding both sides, `reclaimCollateral()` is seller-only, and 0 of
 * the live vanilla PUT quotes bid for puts. Early recovery is 0%. Claiming a
 * recovery that cannot happen would be the kind of overclaim PRD §13.2 exists
 * to prevent.
 *
 * What IS live, honest, and dramatic is the decision the AI gate makes BEFORE
 * money moves. This script prices the exact protection the agent would buy
 * right now against the real book, then shows the policy gate refusing it
 * when model agreement collapses. The measured number is the premium that
 * never left the wallet.
 *
 *   npx tsx scripts/decline-demo.ts
 *   npx tsx scripts/decline-demo.ts --asset ETH --budget 3.00
 *
 * Nothing is ever signed by this script. It is a read-only comparison.
 */

import { loadEnv } from '../lib/env';
import { config } from '../lib/config';
import { newCorrelationId, toAppError } from '../lib/errors';
import { executeHedge } from '../lib/thetanuts';
import type { ActionTier, ExecutedPosition } from '../types/index';

loadEnv();

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const asset = (flag('asset') ?? 'ETH').toUpperCase();
const budgetUsdc = flag('budget') ?? String(config.hardCeilingUsdc);

/**
 * PRD §10.4 policy matrix.
 *
 * ⚠️ STAND-IN. The policy engine is `lib/policy.ts`, which is M2's surface.
 * This is the matrix transcribed so the beat is runnable today; it must be
 * replaced by a call into the real engine, not duplicated permanently.
 */
function tierFor(truthScore: number, agreement: number, severity: number): { tier: ActionTier; reason: string } {
  if (truthScore < 40) return { tier: 'REJECT', reason: `Truth score ${truthScore} is below 40 — logged, no action.` };
  if (truthScore < 70) return { tier: 'WATCH', reason: `Truth score ${truthScore} is in the 40–69 band — radar only.` };
  if (agreement < Number(process.env.AGREEMENT_THRESHOLD ?? 0.6)) {
    return {
      tier: 'ESCALATE',
      reason:
        `Truth score ${truthScore} clears the bar, but the models only agree ${(agreement * 100).toFixed(0)}% ` +
        `— below the ${(Number(process.env.AGREEMENT_THRESHOLD ?? 0.6) * 100).toFixed(0)}% floor. ` +
        'Escalate; degrade to WATCH if debate mode is unavailable.',
    };
  }
  if (severity <= 2) return { tier: 'WATCH', reason: `Severity ${severity} is contained — no hedge.` };
  if (truthScore >= Number(process.env.TRUTH_THRESHOLD_FULL ?? 85) && agreement >= Number(process.env.AGREEMENT_THRESHOLD_FULL ?? 0.75) && severity >= 4) {
    return { tier: 'HEDGE_FULL', reason: `Truth ${truthScore}, agreement ${(agreement * 100).toFixed(0)}%, severity ${severity} — full hedge.` };
  }
  return { tier: 'HEDGE_SMALL', reason: `Truth ${truthScore}, agreement ${(agreement * 100).toFixed(0)}%, severity ${severity} — small hedge.` };
}

const TIER_MULTIPLIER: Record<ActionTier, number> = {
  REJECT: 0,
  WATCH: 0,
  ESCALATE: 0,
  HEDGE_SMALL: 0.3,
  HEDGE_FULL: 1.0,
};

interface Scenario {
  label: string;
  headline: string;
  truthScore: number;
  agreement: number;
  severity: number;
  note: string;
}

// Two readings of the SAME event. Only the consensus metrics differ — which
// is precisely the point: the trigger is the AI's confidence, not the news.
const SCENARIOS: Scenario[] = [
  {
    label: 'SIGNAL',
    headline: 'BREAKING: major Base bridge drained, >$40M moved to a fresh address',
    truthScore: 91,
    agreement: 0.86,
    severity: 5,
    note: 'All three models agree, with specific on-chain detail cited. High conviction.',
  },
  {
    label: 'DEBUNK',
    headline: 'Same claim, after a community note: the "drain" was a scheduled treasury migration',
    truthScore: 91,
    agreement: 0.31,
    severity: 5,
    note: 'Truth score barely moves — but the models now sharply DISAGREE. Agreement collapses.',
  },
];

async function priceProtection(correlationId: string, sizeUsdc: string): Promise<ExecutedPosition | null> {
  try {
    return await executeHedge({
      correlationId,
      asset,
      budgetUsdc: sizeUsdc,
      gonkaRequestIds: ['decline-demo-no-inference'],
      dryRun: true, // 🔒 never signs — this script only prices
    });
  } catch (e) {
    console.log(`      (could not price protection right now: ${toAppError(e).code})`);
    return null;
  }
}

async function main(): Promise<void> {
  console.log('═══ THE AI GATE, LIVE ═══');
  console.log(`  asset  : ${asset}`);
  console.log(`  budget : $${budgetUsdc} USDC`);
  console.log('  Both readings are priced against the SAME live Base mainnet book.');
  console.log('  Nothing in this script is ever signed.\n');

  let wouldHaveSpent = '0';
  let actuallySpent = '0';

  for (const s of SCENARIOS) {
    const { tier, reason } = tierFor(s.truthScore, s.agreement, s.severity);
    const multiplier = TIER_MULTIPLIER[tier];
    const size = (Number(budgetUsdc) * multiplier).toFixed(6);

    console.log(`─── ${s.label} ───`);
    console.log(`  "${s.headline}"`);
    console.log(`  truth ${s.truthScore}/100 · agreement ${(s.agreement * 100).toFixed(0)}% · severity ${s.severity}`);
    console.log(`  ${s.note}`);
    console.log(`  → tier ${tier}`);
    console.log(`    ${reason}`);

    if (multiplier === 0) {
      console.log(`  → PROTECTION NOT BOUGHT. $0.00 leaves the wallet.`);
      // Price what it WOULD have cost, so the refusal has a number attached.
      const counterfactual = await priceProtection(newCorrelationId(), budgetUsdc);
      if (counterfactual) {
        wouldHaveSpent = counterfactual.execution.premiumUsdc;
        const o = counterfactual.execution.selectedOrder;
        console.log(`    Counterfactual, priced live: ${o.asset} $${o.strike} put expiring ${o.expiry}`);
        console.log(`    would have cost $${counterfactual.execution.premiumUsdc} for $${counterfactual.notionalProtectedUsdc} of cover.`);
      }
    } else {
      const position = await priceProtection(newCorrelationId(), size);
      if (position) {
        actuallySpent = position.execution.premiumUsdc;
        const o = position.execution.selectedOrder;
        console.log(`  → WOULD EXECUTE: ${o.asset} $${o.strike} put expiring ${o.expiry}`);
        console.log(`    premium $${position.execution.premiumUsdc} · ${position.execution.contracts} contracts`);
        console.log(`    cover   $${position.notionalProtectedUsdc} · delta ${o.greeks.delta}`);
        console.log(`    quote TTL ${o.quoteTtlSeconds}s · built in ${position.execution.buildLatencyMs}ms`);
        console.log(`    (dry run — nothing signed)`);
      }
    }
    console.log('');
  }

  console.log('═══ WHAT THE GATE IS WORTH ═══');
  console.log(`  On the high-agreement reading, the agent commits  $${actuallySpent}.`);
  console.log(`  On the collapsed-agreement reading, it commits    $0.00.`);
  console.log(`  Premium NOT spent because the models disagreed:   $${wouldHaveSpent}.`);
  console.log('');
  console.log('  Note what did NOT change: the truth score. Both readings score 91.');
  console.log('  What changed is AGREEMENT — and agreement alone flipped the decision.');
  console.log('  That is the difference between a consensus system and an averaging one.');
  console.log('');
  console.log('  Honesty note: once a put is bought, its premium is unrecoverable on this');
  console.log('  venue — there is no early exit and no bid to sell into (measured, see');
  console.log('  docs/M1-WEB3-EXECUTION.md). So the saving is real only because the gate');
  console.log('  runs BEFORE the money moves. That is the whole argument for the AI gate.');
}

main().catch((e) => {
  const err = toAppError(e);
  console.error(`\n✗ ${err.code}: ${err.message}`);
  process.exit(1);
});

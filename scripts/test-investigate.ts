/**
 * A/B the verification layer with and without stage 02.
 *
 * Answers the two questions that decide whether the investigation stage is
 * safe to ship:
 *
 *   1. Does the extra prompt context push layer 1 past its timeout, or make it
 *      spend its completion budget on reasoning and never reach the JSON?
 *   2. Does the evidence actually move the scores, and in the right direction?
 *
 * Runs each scenario twice against the real Gonka network — evidence off, then
 * on — and prints latency, parse repairs, drop reasons and scores side by side.
 *
 *   npm run test:investigate
 *   npm run test:investigate -- "some claim text"
 *
 * The two runs are deliberately sequential with a pause between them. Measured
 * on 1 Sep 2026, Gonka's own nodes return 429 "too many concurrent requests"
 * well below the advertised limit, and firing both arms at once would measure
 * that rather than the thing under test.
 */

import { loadEnv } from '../lib/env';
loadEnv();

import { investigate, evidenceHeadline } from '../lib/investigate';
import { verifyThreat, renderAlert } from '../lib/gonka';
import { SIMULATOR_SCENARIOS } from '../lib/simulator';
import { newCorrelationId } from '../lib/ids';
import { decide, thresholdsFromEnv } from '../lib/policy';
import type { AlertEvent, EvidencePacket, VerificationResult } from '../types/index';

const BAR = '═'.repeat(78);
const PAUSE_MS = Number(process.env.AB_PAUSE_MS ?? 8000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alertFor(text: string, clusterKey: string): AlertEvent {
  return {
    id: newCorrelationId(),
    source: 'SIMULATOR',
    rawText: text,
    receivedAt: new Date().toISOString(),
    clusterKey,
  };
}

interface Arm {
  label: string;
  result?: VerificationResult;
  error?: string;
  wallMs: number;
  promptChars: number;
}

async function runArm(label: string, alert: AlertEvent, evidence?: EvidencePacket): Promise<Arm> {
  const promptChars = renderAlert(alert, undefined, evidence).length;
  const t = Date.now();
  try {
    const result = await verifyThreat(alert, evidence ? { evidence } : {});
    return { label, result, wallMs: Date.now() - t, promptChars };
  } catch (e) {
    return { label, error: e instanceof Error ? e.message : String(e), wallMs: Date.now() - t, promptChars };
  }
}

function printArm(arm: Arm) {
  console.log(`\n  ── ${arm.label} ${'─'.repeat(Math.max(0, 60 - arm.label.length))}`);
  console.log(`     prompt: ${arm.promptChars} chars · wall: ${(arm.wallMs / 1000).toFixed(1)}s`);
  if (arm.error) {
    console.log(`     ✗ FAILED: ${arm.error.slice(0, 300)}`);
    return;
  }
  const r = arm.result!;
  console.log(
    `     truthScore ${r.consensus.truthScore} · agreement ${r.consensus.agreement.toFixed(3)} · ` +
    `severity ${r.consensus.severity} · conviction ${r.consensus.conviction.toFixed(3)} · ` +
    `${r.consensus.modelsResponded}/3 models`,
  );
  for (const v of r.verdicts) {
    const short = v.modelId.split('/').pop() ?? v.modelId;
    console.log(
      `       ${short.padEnd(26)} ${String(v.claimScore).padStart(3)} ${v.stance.padEnd(9)} ` +
      `sev ${v.severity} ${(v.latencyMs / 1000).toFixed(1)}s${v.parseRepaired ? ' REPAIRED' : ''}`,
    );
    if (v.keyEvidence[0]) console.log(`         evidence: "${v.keyEvidence[0].slice(0, 100)}"`);
  }
  for (const f of r.failures ?? []) {
    console.log(`       ${f.modelId.split('/').pop()} DROPPED: ${f.code} after ${(f.latencyMs / 1000).toFixed(1)}s`);
  }
  console.log(`     trace: ${r.reasoningTrace[0]?.slice(0, 140) ?? '(none)'}`);
}

/** Where the policy engine would land, which is what actually matters. */
function tierFor(alert: AlertEvent, r: VerificationResult | undefined): string {
  if (!r) return 'n/a';
  try {
    return decide(
      alert, r,
      {
        premiumReserveUsdc: '50', dailyCapUsdc: '5', dailySpentUsdc: '0',
        openHedges: [], clusterHistory: [], now: new Date().toISOString(),
      },
      thresholdsFromEnv(),
    ).tier;
  } catch (e) {
    return `error: ${e instanceof Error ? e.message.slice(0, 40) : String(e)}`;
  }
}

async function main() {
  const custom = process.argv.slice(2).join(' ').trim();
  const cases = custom
    ? [{ name: 'custom claim', rawText: custom, clusterKey: 'ab', expectedTier: '?' }]
    : SIMULATOR_SCENARIOS.map((s) => ({
        name: s.name, rawText: s.rawText, clusterKey: s.clusterKey, expectedTier: s.expectedTier,
      }));

  const summary: Array<{ name: string; offScore: string; onScore: string; offTier: string; onTier: string; offMs: number; onMs: number; expected: string }> = [];

  for (const c of cases) {
    console.log(`\n${BAR}`);
    console.log(`SCENARIO: ${c.name}   (measured expectation before stage 02: ${c.expectedTier})`);
    console.log(BAR);

    const alert = alertFor(c.rawText, c.clusterKey);

    // Stage 02 once; both arms are then the same claim, differing only in
    // whether the models are shown what the chain says.
    const evidence = await investigate(alert);
    console.log(`  stage 02: ${evidenceHeadline(evidence)} in ${evidence.totalLatencyMs}ms · ` +
      `targets ${evidence.targets.map((t) => `${t.name}[${t.confidence}]`).join(', ') || 'none'}`);

    const off = await runArm('EVIDENCE OFF (current shipped behaviour)', alert);
    printArm(off);

    await sleep(PAUSE_MS);

    const on = await runArm('EVIDENCE ON (stage 02 wired in)', alert, evidence);
    printArm(on);

    const offTier = tierFor(alert, off.result);
    const onTier = tierFor(alert, on.result);
    console.log(`\n     tier: ${offTier} → ${onTier}`);

    summary.push({
      name: c.name,
      offScore: off.result ? String(off.result.consensus.truthScore) : 'FAILED',
      onScore: on.result ? String(on.result.consensus.truthScore) : 'FAILED',
      offTier, onTier,
      offMs: off.wallMs, onMs: on.wallMs,
      expected: c.expectedTier,
    });

    await sleep(PAUSE_MS);
  }

  console.log(`\n${BAR}`);
  console.log('SUMMARY');
  console.log(BAR);
  console.log(
    'scenario'.padEnd(30) + 'score off→on'.padEnd(16) + 'tier off→on'.padEnd(30) + 'wall off→on',
  );
  for (const s of summary) {
    console.log(
      s.name.slice(0, 29).padEnd(30) +
      `${s.offScore} → ${s.onScore}`.padEnd(16) +
      `${s.offTier} → ${s.onTier}`.padEnd(30) +
      `${(s.offMs / 1000).toFixed(1)}s → ${(s.onMs / 1000).toFixed(1)}s`,
    );
  }
  const deltas = summary.filter((s) => s.offScore !== 'FAILED' && s.onScore !== 'FAILED');
  if (deltas.length) {
    const avgOff = deltas.reduce((a, s) => a + s.offMs, 0) / deltas.length / 1000;
    const avgOn = deltas.reduce((a, s) => a + s.onMs, 0) / deltas.length / 1000;
    console.log(`\nmean wall clock: ${avgOff.toFixed(1)}s without evidence, ${avgOn.toFixed(1)}s with ` +
      `(${(avgOn - avgOff >= 0 ? '+' : '')}${(avgOn - avgOff).toFixed(1)}s)`);
  }
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });

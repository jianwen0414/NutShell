/**
 * What does the stage 02 evidence block actually cost layer 1?
 *
 * The A/B in `test-investigate.ts` runs the whole panel, which means its
 * numbers are contaminated by Gonka's own 429s — measured repeatedly, the
 * router returns "too many concurrent requests" well below its advertised
 * limit, and that dominates any effect the prompt has. This script removes
 * that variable: one model at a time, one call at a time, generous spacing,
 * alternating between the two prompt sizes.
 *
 * It reports the two things that decide whether the evidence block is safe:
 *
 *   latency        — does a bigger prompt take longer, and by enough to push
 *                    a call past the 45 s timeout?
 *   finish_reason  — do the extra input tokens make a model reason for longer
 *                    and run out of its 2,048-token completion budget before
 *                    it reaches the JSON? That failure mode shows up as
 *                    finish_reason "length" and costs a vote.
 *
 *   npm run measure:evidence
 *   npm run measure:evidence -- 5      # trials per arm per model
 */

import { loadEnv } from '../lib/env';
loadEnv();

import { ANALYST_PROMPT, chat, renderAlert, resolveModels, extractJson } from '../lib/gonka';
import { investigate } from '../lib/investigate';
import { SIMULATOR_SCENARIOS } from '../lib/simulator';
import { newCorrelationId } from '../lib/ids';
import type { AlertEvent } from '../types/index';

const TRIALS = Number(process.argv[2] ?? 3);
const GAP_MS = Number(process.env.MEASURE_GAP_MS ?? 6000);
const TIMEOUT_MS = 45_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Sample {
  model: string;
  arm: 'off' | 'on';
  promptChars: number;
  ok: boolean;
  latencyMs: number;
  completionTokens: number;
  finishReason: string;
  parsed: boolean;
  error?: string;
}

function stats(xs: number[]) {
  if (!xs.length) return { n: 0, min: 0, med: 0, max: 0, mean: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return {
    n: s.length,
    min: s[0]!,
    med: s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2,
    max: s[s.length - 1]!,
    mean: s.reduce((a, b) => a + b, 0) / s.length,
  };
}

async function main() {
  const scenario = SIMULATOR_SCENARIOS.find((s) => s.id === 'scen_bridge_exploit')!;
  const alert: AlertEvent = {
    id: newCorrelationId(),
    source: 'SIMULATOR',
    rawText: scenario.rawText,
    receivedAt: new Date().toISOString(),
    clusterKey: scenario.clusterKey,
  };

  console.log('Gathering evidence once, so both arms use the identical block…');
  const evidence = await investigate(alert);

  const promptOff = renderAlert(alert);
  const promptOn = renderAlert(alert, undefined, evidence);
  console.log(`  prompt off: ${promptOff.length} chars`);
  console.log(`  prompt on:  ${promptOn.length} chars  (+${promptOn.length - promptOff.length})`);
  console.log(`  evidence:   ${evidence.checks.length} checks, ${evidence.promptBlock.length} chars\n`);

  const models = await resolveModels();
  console.log(`models: ${models.join(', ')}`);
  console.log(`${TRIALS} trials per arm per model, ${GAP_MS}ms apart, strictly sequential.\n`);

  const samples: Sample[] = [];

  for (const model of models) {
    for (let trial = 0; trial < TRIALS; trial++) {
      // Alternate arms within a trial so any drift in node health over the run
      // hits both arms roughly equally rather than loading onto one of them.
      for (const arm of ['off', 'on'] as const) {
        // Cache-buster. Measured without it, repeated identical prompts came
        // back in 137-206ms having "generated" 1,161 tokens, and the token
        // count was identical across all three trials — the router was serving
        // a cached completion, not running the model. That measures the cache,
        // not the cost of the prompt. A unique trailing comment makes every
        // request distinct while changing nothing the model is asked to judge.
        const nonce = `\n\n<!-- measurement ${newCorrelationId()} -->`;
        const prompt = (arm === 'off' ? promptOff : promptOn) + nonce;
        const t = Date.now();
        try {
          const call = await chat(
            model,
            [
              { role: 'system', content: ANALYST_PROMPT },
              { role: 'user', content: prompt },
            ],
            TIMEOUT_MS,
          );
          const sample: Sample = {
            model, arm, promptChars: prompt.length, ok: true,
            latencyMs: Date.now() - t,
            completionTokens: call.completionTokens,
            finishReason: call.finishReason,
            parsed: extractJson(call.content) !== null,
          };
          samples.push(sample);
          console.log(
            `  ${model.split('/').pop()!.padEnd(26)} ${arm.padEnd(3)} ` +
            `${String(sample.latencyMs).padStart(6)}ms  tokens=${String(sample.completionTokens).padStart(4)}  ` +
            `finish=${sample.finishReason.padEnd(6)} json=${sample.parsed ? 'ok' : 'NO'}`,
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          samples.push({
            model, arm, promptChars: prompt.length, ok: false,
            latencyMs: Date.now() - t, completionTokens: 0, finishReason: 'error',
            parsed: false, error: msg,
          });
          console.log(
            `  ${model.split('/').pop()!.padEnd(26)} ${arm.padEnd(3)} ` +
            `${String(Date.now() - t).padStart(6)}ms  FAILED: ${msg.slice(0, 70)}`,
          );
        }
        await sleep(GAP_MS);
      }
    }
  }

  console.log('\n' + '═'.repeat(78));
  console.log('LATENCY BY MODEL AND ARM (successful calls only)');
  console.log('═'.repeat(78));
  console.log('model'.padEnd(28) + 'arm'.padEnd(5) + 'n'.padEnd(4) + 'min'.padEnd(9) + 'median'.padEnd(9) + 'max'.padEnd(9) + 'mean');
  for (const model of models) {
    for (const arm of ['off', 'on'] as const) {
      const xs = samples.filter((s) => s.model === model && s.arm === arm && s.ok).map((s) => s.latencyMs);
      const st = stats(xs);
      console.log(
        model.split('/').pop()!.slice(0, 27).padEnd(28) + arm.padEnd(5) + String(st.n).padEnd(4) +
        `${(st.min / 1000).toFixed(1)}s`.padEnd(9) + `${(st.med / 1000).toFixed(1)}s`.padEnd(9) +
        `${(st.max / 1000).toFixed(1)}s`.padEnd(9) + `${(st.mean / 1000).toFixed(1)}s`,
      );
    }
  }

  console.log('\n' + '═'.repeat(78));
  console.log('THE TWO FAILURE MODES THIS IS LOOKING FOR');
  console.log('═'.repeat(78));
  for (const arm of ['off', 'on'] as const) {
    const arms = samples.filter((s) => s.arm === arm);
    const okArm = arms.filter((s) => s.ok);
    const lengthCapped = okArm.filter((s) => s.finishReason === 'length');
    const unparsed = okArm.filter((s) => !s.parsed);
    const timeouts = arms.filter((s) => !s.ok && /timed out|timeout/i.test(s.error ?? ''));
    const rateLimited = arms.filter((s) => !s.ok && /429|rate limit/i.test(s.error ?? ''));
    const tk = stats(okArm.map((s) => s.completionTokens));
    console.log(
      `  ${arm.toUpperCase().padEnd(4)} calls=${arms.length} ok=${okArm.length} ` +
      `timeouts=${timeouts.length} rate-limited=${rateLimited.length} ` +
      `finish_reason=length: ${lengthCapped.length} · unparseable JSON: ${unparsed.length} · ` +
      `completion tokens med=${tk.med} max=${tk.max}`,
    );
  }

  const offOk = samples.filter((s) => s.arm === 'off' && s.ok).map((s) => s.latencyMs);
  const onOk = samples.filter((s) => s.arm === 'on' && s.ok).map((s) => s.latencyMs);
  const d = stats(onOk).med - stats(offOk).med;
  console.log(
    `\n  median latency across all models: ${(stats(offOk).med / 1000).toFixed(1)}s off → ` +
    `${(stats(onOk).med / 1000).toFixed(1)}s on  (${d >= 0 ? '+' : ''}${(d / 1000).toFixed(1)}s)`,
  );
  console.log(`  timeout budget is ${TIMEOUT_MS / 1000}s; headroom on the slowest ON call: ` +
    `${((TIMEOUT_MS - stats(onOk).max) / 1000).toFixed(1)}s`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });

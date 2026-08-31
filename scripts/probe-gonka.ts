/**
 * Probe the GonkaRouter before building on it.
 *
 *   npm run probe:gonka
 *
 * Answers, with measurements rather than assumptions:
 *   V5   which model ids this key actually sees, and what the families match to
 *   V3   what shape the request id takes, and whether anything looks chain-resolvable
 *   p50/p95 latency — over 90s and per-model streaming stops being optional
 *   how often the models need a JSON repair retry
 *   whether the consensus math separates a hoax from a real report
 */
import { performance } from 'node:perf_hooks';
import OpenAI from 'openai';
import type { AlertEvent } from '../types/index.js';
import { resolveModels, verifyThreat, renderAlert, MODEL_FAMILIES } from '../lib/gonka.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* no .env — rely on the ambient environment */
}

const BASE_URL = process.env.GONKA_BASE_URL ?? 'https://api.gonkarouter.io/v1';

// ── Fixtures ──────────────────────────────────────────────────────────────
// Deliberately spread across the rubric. A working pipeline must rank these
// HOAX < THIN < REAL on truthScore. If it does not, the rubric is not biting.

const now = () => new Date().toISOString();

const FIXTURES: Array<{ label: string; expect: string; alert: AlertEvent }> = [
  {
    label: 'HOAX',
    expect: 'low truthScore, stance FAKE',
    alert: {
      id: 'nsh_probe0000000001',
      source: 'SIMULATOR',
      rawText:
        'BREAKING!!! Vitalik just announced Ethereum is shutting down permanently at midnight. ' +
        'All ETH will be converted to Dogecoin. Sources say Elon confirmed. SELL EVERYTHING NOW!!!',
      receivedAt: now(),
      clusterKey: 'probe-hoax',
      metadata: { handle: '@CryptoInsider_Real', followers: '412' },
    },
  },
  {
    label: 'REAL',
    expect: 'high truthScore, stance REAL, severity 4-5',
    alert: {
      id: 'nsh_probe0000000002',
      source: 'SIMULATOR',
      rawText:
        'Security researchers at BlockSec report an active exploit against a cross-chain bridge on Base. ' +
        'The attacker contract 0x9f2a...c41d has drained approximately 12,400 WETH (~$41M) across 7 ' +
        'transactions between 14:02 and 14:19 UTC, exploiting an unchecked return value in the ' +
        'withdrawal verifier. Funds are being routed through Tornado-style mixers. The bridge team has ' +
        'paused deposits and acknowledged the incident on their status page.',
      receivedAt: now(),
      clusterKey: 'probe-real',
      metadata: { handle: '@BlockSecTeam', followers: '184000' },
    },
  },
  {
    // Held out on purpose. The prompt's calibration anchors are a validator-key
    // compromise and an exchange-insolvency hoax; this is an oracle attack in a
    // different shape. If REAL scores well but this does not, the models are
    // pattern-matching the examples rather than applying the rubric.
    label: 'REAL2 (held out)',
    expect: 'high truthScore — must generalise beyond the prompt examples',
    alert: {
      id: 'nsh_probe0000000004',
      source: 'SIMULATOR',
      rawText:
        'A lending market on Base has been drained of roughly $8.2M after an attacker manipulated ' +
        'a thinly-traded collateral pair. The attacker took a flash loan of 3,100 WETH, pushed the ' +
        'pool price up over four blocks starting at block 24,881,402, borrowed against the inflated ' +
        'collateral, and let the position liquidate. The protocol has paused new borrows and says a ' +
        'post-mortem will follow. The oracle in question used a 30-minute TWAP with a single venue.',
      receivedAt: now(),
      clusterKey: 'probe-real2',
      metadata: { handle: '@peckshield', followers: '312000' },
    },
  },
  {
    label: 'THIN',
    expect: 'mid-low truthScore, stance UNCERTAIN, redFlags cite missing specifics',
    alert: {
      id: 'nsh_probe0000000003',
      source: 'SIMULATOR',
      rawText: 'Hearing something big is happening with a major exchange. Not looking good.',
      receivedAt: now(),
      clusterKey: 'probe-thin',
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────

const pct = (xs: number[], p: number) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

const line = (c = '─') => console.log(c.repeat(74));

function h(title: string) {
  console.log('');
  line();
  console.log(title);
  line();
}

// ── 1. Discovery ──────────────────────────────────────────────────────────

async function discovery(): Promise<string[]> {
  h('1. GET /v1/models  —  resolves V5');

  const raw = await new OpenAI({
    apiKey: process.env.GONKA_API_KEY!,
    baseURL: BASE_URL,
  }).models.list();

  console.log(`Base URL      ${BASE_URL}`);
  console.log(`Models listed ${raw.data.length}`);
  for (const m of raw.data) console.log(`  · ${m.id}`);

  const resolved = await resolveModels(true);
  console.log('');
  console.log('Family match:');
  for (const f of MODEL_FAMILIES) {
    const hit = resolved.find((id) => id.toLowerCase().includes(f));
    console.log(`  ${hit ? '✓' : '✗'} ${f.padEnd(10)} → ${hit ?? 'NOT AVAILABLE'}`);
  }
  if (resolved.length < 3) {
    console.log('');
    console.log(`  ⚠  Only ${resolved.length} families resolved. Quorum floor is 2, but the`);
    console.log('     three-model consensus claim needs 3. Check MODEL_FAMILIES.');
  }
  return resolved;
}

// ── 2. Single raw call — what does the body actually look like? ───────────

async function rawShape(modelId: string) {
  h(`2. Raw response shape  —  ${modelId}`);

  const client = new OpenAI({ apiKey: process.env.GONKA_API_KEY!, baseURL: BASE_URL });
  const t0 = performance.now();
  const res = await client.chat.completions.create({
    model: modelId,
    messages: [
      { role: 'system', content: 'Return ONLY a JSON object, no prose, no code fences.' },
      { role: 'user', content: renderAlert(FIXTURES[0]!.alert) },
    ],
    max_tokens: 2048,
    temperature: 0.2,
  });
  const ms = Math.round(performance.now() - t0);

  console.log(`id            ${res.id}`);
  console.log(`model         ${res.model}`);
  console.log(`latency       ${ms}ms`);
  console.log(`usage         ${JSON.stringify(res.usage ?? {})}`);
  console.log(`top-level     ${Object.keys(res).join(', ')}`);

  const extra = Object.keys(res).filter(
    (k) => !['id', 'object', 'created', 'model', 'choices', 'usage', 'system_fingerprint'].includes(k),
  );
  console.log(`non-standard  ${extra.length ? extra.join(', ') : '(none)'}`);
  console.log('');
  console.log('V3 read: an id of the form "chatcmpl-…" with no chain field means');
  console.log('         GONKA_ID_CHAIN_RESOLVABLE stays false and we show the hash.');
  console.log('');
  console.log('--- raw content (first 600 chars) ---');
  console.log((res.choices[0]?.message?.content ?? '').slice(0, 600));
  console.log('--- end ---');
}

// ── 3. Full pipeline over the fixtures ────────────────────────────────────

async function pipeline() {
  h('3. Full verifyThreat() over fixtures  —  these must separate cleanly');

  const latencies: number[] = [];
  let repairs = 0;
  let calls = 0;

  for (const { label, expect, alert } of FIXTURES) {
    console.log('');
    console.log(`▸ ${label}  (expect: ${expect})`);
    try {
      // Print each verdict the moment it lands so the run never looks frozen.
      const r = await verifyThreat(alert, {
        onStage: (stage) =>
          console.log(
            stage === 'layer1'
              ? '    …asking 3 models in parallel'
              : stage === 'retry'
                ? '    …below quorum, retrying the models that dropped'
                : '    …models done, writing the summary',
          ),
        onVerdict: (v, modelId) => {
          if (!v) {
            console.log(`    ${modelId.padEnd(26)} NO VALID VERDICT (missing vote)`);
            return;
          }
          calls++;
          latencies.push(v.latencyMs);
          if (v.parseRepaired) repairs++;
          console.log(
            `    ${v.modelId.padEnd(26)} score ${String(v.claimScore).padStart(3)}  ` +
              `sev ${v.severity}  ${v.stance.padEnd(9)} ${String(v.latencyMs).padStart(6)}ms` +
              `${v.parseRepaired ? '  [repaired]' : ''}`,
          );
        },
      });
      const c = r.consensus;

      console.log(
        `    → truth ${c.truthScore}  agreement ${c.agreement}  spread ${c.spread}  ` +
          `concord ${c.concordance}  conviction ${c.conviction}  sev ${c.severity}`,
      );
      console.log(`    → total ${r.totalLatencyMs}ms · ${c.modelsResponded}/3 responded`);
      console.log(`    → trace: ${r.reasoningTrace[0] ?? '(none)'}`);
    } catch (e) {
      console.log(`    ✗ ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  h('4. Measurements  —  record these, do not estimate them');
  console.log(`layer-1 calls     ${calls}`);
  console.log(`p50 latency       ${pct(latencies, 50)}ms`);
  console.log(`p95 latency       ${pct(latencies, 95)}ms`);
  console.log(`max latency       ${Math.max(...latencies, 0)}ms`);
  console.log(`repair rate       ${repairs}/${calls}`);
  console.log('');
  console.log(
    pct(latencies, 95) > 90_000
      ? '⚠  p95 over 90s — per-model streaming in the UI is MANDATORY,'
      : '✓  p95 under 90s — per-model streaming stays optional,',
  );
  console.log('   and the router closes idle streams at 90s regardless.');
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.GONKA_API_KEY) {
    console.error('GONKA_API_KEY is not set. Put it in .env (which is git-ignored).');
    process.exit(1);
  }
  const models = await discovery();
  await rawShape(models[0]!);
  await pipeline();
  console.log('');
}

main().catch((e) => {
  console.error('');
  console.error('PROBE FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});

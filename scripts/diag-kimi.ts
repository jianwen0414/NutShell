/**
 * Current Kimi availability. Run it again any time to see if it has recovered.
 *
 *   npx tsx scripts/diag-kimi.ts
 *
 * Six sequential calls at the pipeline's real 45s timeout, every prompt unique
 * so nothing comes from the router's cache, plus two DeepSeek calls as a
 * same-moment control.
 */
import OpenAI from 'openai';
import { ANALYST_PROMPT, renderAlert, resolveModels } from '../lib/gonka.js';
import type { AlertEvent } from '../types/index.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* ambient env */
}

const client = new OpenAI({
  apiKey: process.env.GONKA_API_KEY!,
  baseURL: process.env.GONKA_BASE_URL ?? 'https://api.gonkarouter.io/v1',
  maxRetries: 0,
});

const alert = (n: string): AlertEvent => ({
  id: 'nsh_kimicheck0001',
  source: 'SIMULATOR',
  rawText:
    `Security researchers report an active exploit against a cross-chain bridge on Base. ` +
    `The attacker contract 0x9f2a...c41d drained ~12,400 WETH across 7 transactions. ` +
    `Incident reference ${n}.`,
  receivedAt: new Date().toISOString(),
  clusterKey: 'kimicheck',
});

async function call(model: string, n: number): Promise<boolean> {
  const nonce = Math.random().toString(36).slice(2, 10);
  const t0 = Date.now();
  try {
    const r = await client.chat.completions.create(
      {
        model,
        messages: [
          { role: 'system', content: ANALYST_PROMPT },
          { role: 'user', content: renderAlert(alert(nonce)) },
        ],
        max_tokens: 2048,
        temperature: 0.2,
      },
      { timeout: 45_000 },
    );
    console.log(
      `  #${n}  ok      ${String(Date.now() - t0).padStart(6)}ms  ` +
        `tokens=${r.usage?.completion_tokens}  id=${r.id}`,
    );
    return true;
  } catch (e: any) {
    console.log(`  #${n}  FAILED  ${String(Date.now() - t0).padStart(6)}ms  ${e?.message}`);
    return false;
  }
}

// Wrapped in main() rather than top-level await: that would need
// "type": "module" in package.json, which the Next.js app does not set.
async function main() {
  const models = await resolveModels();
  const kimi = models.find((m) => m.toLowerCase().includes('kimi'))!;
  const deepseek = models.find((m) => m.toLowerCase().includes('deepseek'))!;

  console.log(new Date().toISOString());
  console.log(`\n=== ${kimi} — 6 calls, 45s timeout ===`);
  let ok = 0;
  for (let i = 1; i <= 6; i++) if (await call(kimi, i)) ok++;

  console.log(`\n=== ${deepseek} — control ===`);
  let dsOk = 0;
  for (let i = 1; i <= 2; i++) if (await call(deepseek, i)) dsOk++;

  console.log('');
  console.log(`Kimi     ${ok}/6 succeeded`);
  console.log(`DeepSeek ${dsOk}/2 succeeded`);
}

main().catch((e) => {
  console.error('DIAG FAILED:', e instanceof Error ? e.message : e);
  process.exit(1);
});

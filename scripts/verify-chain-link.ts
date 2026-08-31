/**
 * Prove the chain link works, end to end, right now.
 *
 *   npm run verify:chain
 *
 * Makes a fresh inference, pulls the shard id out of the response, fetches the
 * on-chain record, and checks the model recorded on chain is the model we
 * actually asked for. That match is the whole claim: it is what makes the link
 * evidence rather than decoration.
 *
 * Run this before the demo. If it fails, do not show the link.
 */
import OpenAI from 'openai';
import { chainUrlForShard, parseShardId, resolveModels } from '../lib/gonka.js';

try {
  process.loadEnvFile('.env');
} catch {
  /* ambient env */
}

const CHAIN = process.env.GONKA_CHAIN_API ?? 'https://node1.gonka.ai:8443/chain-api';

/** Human-facing explorers, checked for a devshard view we could link instead. */
const EXPLORERS = [
  ['gonka.gg', (id: number) => `https://gonka.gg/devshard/${id}`],
  ['gonkascan', (id: number) => `https://gonkascan.com/devshard/${id}`],
  ['gonkalab', (id: number) => `https://gonkalab.ai/devshard/${id}`],
] as const;

async function main() {
  const client = new OpenAI({
    apiKey: process.env.GONKA_API_KEY!,
    baseURL: process.env.GONKA_BASE_URL ?? 'https://api.gonkarouter.io/v1',
    maxRetries: 0,
  });

  const models = await resolveModels();
  let ok = 0;
  let tried = 0;

  for (const model of models) {
    tried++;
    console.log(`\n─── ${model}`);
    let id: string;
    try {
      const res = await client.chat.completions.create(
        {
          model,
          messages: [{ role: 'user', content: `Reply with just: pong. Ref ${Date.now()}` }],
          max_tokens: 50,
          temperature: 0,
        },
        { timeout: 60_000 },
      );
      id = res.id;
    } catch (e: any) {
      console.log(`  request failed: ${e?.message} — skipping`);
      continue;
    }

    const shard = parseShardId(id);
    console.log(`  request id    ${id}`);
    if (shard === undefined) {
      console.log('  ✗ could not parse a shard id — the router changed its format');
      continue;
    }

    const url = chainUrlForShard(shard);
    console.log(`  chain url     ${url}`);

    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) {
        console.log(`  ✗ chain returned HTTP ${r.status}`);
        continue;
      }
      const body = (await r.json()) as { escrow?: Record<string, any> };
      const e = body.escrow;
      if (!e) {
        console.log('  ✗ no escrow record in the response');
        continue;
      }
      const match = e.model_id === model;
      console.log(`  on-chain model ${e.model_id}`);
      console.log(`  epoch          ${e.epoch_index}   settled: ${e.settled}`);
      console.log(`  serving nodes  ${new Set(e.slots ?? []).size} distinct across ${(e.slots ?? []).length} slots`);
      console.log(
        match
          ? '  ✓ LINK VALID — the chain record names the model we called'
          : `  ✗ MISMATCH — chain says ${e.model_id}, we called ${model}`,
      );
      if (match) ok++;
    } catch (e: any) {
      console.log(`  ✗ chain query failed: ${e?.message}`);
    }
  }

  // The API url returns JSON, which is fine for a developer and poor for a
  // judge watching a screen. Check whether a human-readable page exists.
  console.log('\n─── human-facing explorer pages');
  for (const [name, build] of EXPLORERS) {
    const url = build(66853);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      const text = await r.text();
      const looksReal = r.ok && /66853/.test(text);
      console.log(`  ${String(r.status).padEnd(4)} ${name.padEnd(11)} ${looksReal ? 'shows the id' : 'no devshard page'}  ${url}`);
    } catch {
      console.log(`  ---  ${name.padEnd(11)} unreachable  ${url}`);
    }
  }

  console.log(`\n${ok}/${tried} links verified\n`);
  if (ok === 0) {
    console.log('No link verified. Set GONKA_ID_CHAIN_RESOLVABLE=false and use the');
    console.log('response hash wording instead of claiming on-chain provenance.\n');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

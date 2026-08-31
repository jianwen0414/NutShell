/**
 * Offline checks for lib/gonka.ts helpers.
 *
 *   npm run test:gonka
 *
 * V3 now depends on this regex, so it gets a test. If the router ever changes
 * its id format these fail loudly instead of silently dropping the chain link.
 */
import assert from 'node:assert/strict';
import { chainUrlForShard, extractJson, parseShardId } from '../lib/gonka';

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.log(`  ✗ ${name}`); console.log(`      ${e instanceof Error ? e.message.split('\n')[0] : e}`); }
}

console.log('\nV3: devshard id parsing');

check('parses the escrow id out of a real request id', () => {
  // Ids measured 31 Aug 2026, each verified to resolve on chain.
  assert.equal(parseShardId('devshard-66853-81'), 66853);
  assert.equal(parseShardId('devshard-66204-1330'), 66204);
  assert.equal(parseShardId('devshard-66767-256'), 66767);
});

check('tolerates surrounding whitespace', () => {
  assert.equal(parseShardId('  devshard-66612-142  '), 66612);
});

check('returns undefined rather than guessing on an unknown format', () => {
  for (const id of ['chatcmpl-abc123', '', 'devshard-', 'devshard-abc-1', 'devshard-1', 'x-66853-81']) {
    assert.equal(parseShardId(id), undefined, `should not parse ${JSON.stringify(id)}`);
  }
});

check('never guesses a radix on a non-decimal id', () => {
  // A hex-looking id must NOT silently become a decimal shard number. If the
  // router ever emits one, we want no link rather than a link to the wrong
  // shard. Update parseShardId only after confirming the radix on chain.
  for (const id of ['devshard-7a4f-31b2', 'devshard-abc-def', 'devshard-0x10-1']) {
    assert.equal(parseShardId(id), undefined, `must not parse ${id}`);
  }
});

check('builds the public chain query url', () => {
  const url = chainUrlForShard(66853);
  assert.match(url, /devshard_escrow\/66853$/);
  assert.match(url, /^https:\/\//);
});

console.log('\nparse-and-repair');

check('finds JSON after a reasoning preamble', () => {
  const raw = '<think>Let me analyze.\nThe claim says...</think>\n\n{"claimScore": 72}';
  assert.equal(extractJson(raw), '{"claimScore": 72}');
});

check('strips code fences', () => {
  assert.equal(extractJson('```json\n{"a":1}\n```'), '{"a":1}');
});

check('handles nested objects and braces inside strings', () => {
  const raw = '{"a":{"b":2},"note":"a } brace in text"}';
  assert.equal(extractJson(raw), raw);
});

check('returns null when there is no object at all', () => {
  assert.equal(extractJson('I cannot answer that.'), null);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

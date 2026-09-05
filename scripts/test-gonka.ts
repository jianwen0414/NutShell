/**
 * Offline checks for lib/gonka.ts helpers.
 *
 *   npm run test:gonka
 *
 * V3 now depends on this regex, so it gets a test. If the router ever changes
 * its id format these fail loudly instead of silently dropping the chain link.
 */
import assert from 'node:assert/strict';
import { chainUrlForShard, extractJson, isModelUnavailable, parseShardId } from '../lib/gonka';

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

console.log('\nModel-unavailable classification');

// The two bodies below are verbatim from the router, captured 5 Sep 2026.
// If either stops being recognised, a dead model silently re-enters the panel
// and burns a vote on every verification.

check('recognises the 503 no-channel refusal', () => {
  assert.equal(
    isModelUnavailable({
      status: 503,
      code: 'model_not_found',
      message:
        'No available channel for model moonshotai/Kimi-K2.6 under group default (distributor) (request id: 202609050400184693874718268d9d608Ih1Y7w)',
    }),
    true,
  );
});

check('recognises it from the nested body when the SDK does not hoist the code', () => {
  assert.equal(
    isModelUnavailable({
      status: 503,
      error: {
        code: 'model_not_found',
        type: 'new_api_error',
        message: 'No available channel for model moonshotai/Kimi-K2.6 under group default (distributor)',
      },
    }),
    true,
  );
});

check('recognises the 400 invalid_model refusal', () => {
  assert.equal(
    isModelUnavailable({
      status: 400,
      code: 'invalid_model',
      message: 'model not available for your channel',
    }),
    true,
  );
});

check('recognises the older unsupported-model wording', () => {
  // Observed 4 Sep 2026: the catalogue listed Kimi while inference answered
  // 400 naming the two models it would actually serve.
  assert.equal(
    isModelUnavailable({ status: 400, message: 'unsupported model "moonshotai/Kimi-K2.6"' }),
    true,
  );
});

check('does NOT park a model for a rate limit', () => {
  // 429 is our own concurrency, and parking a healthy model over it would
  // shrink the panel for ten minutes because we asked too fast.
  assert.equal(
    isModelUnavailable({ status: 429, code: 'rate_limit_exceeded', message: 'too many concurrent requests' }),
    false,
  );
});

check('does NOT park a model for a timeout', () => {
  assert.equal(
    isModelUnavailable({ name: 'APIConnectionTimeoutError', message: 'Request timed out.' }),
    false,
  );
});

check('does NOT park a model for our own bad request', () => {
  assert.equal(
    isModelUnavailable({
      status: 400,
      code: 'invalid_request_error',
      message: "Invalid value for 'max_tokens': must be a positive integer",
    }),
    false,
  );
});

check('does NOT park a model for an unrelated 503', () => {
  assert.equal(
    isModelUnavailable({ status: 503, message: 'upstream connect error, transient overload' }),
    false,
  );
});

check('survives junk without throwing', () => {
  for (const junk of [null, undefined, 'boom', 0, {}]) {
    assert.equal(isModelUnavailable(junk), false, `should not park on ${JSON.stringify(junk)}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);

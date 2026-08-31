/**
 * Worker checks
 *
 *   npm run test:worker
 *
 * The requirement is: the full chain completes end to end, every stage persists
 * before advancing, a crash mid-pipeline leaves recoverable state, every stage
 * emits an SSE frame, and the correlation ID threads through every record.
 *
 * The verifier is injected, so none of this touches the network.
 */
import assert from 'node:assert/strict';
import {
  classifyStale,
  newJob,
  runJob,
  type Attestor,
  type Executor,
  type Job,
  type PipelineDeps,
  type PipelineEvent,
} from '../worker/pipeline';
import { InMemoryJobStore, EventBus } from '../worker/index';
import { InMemoryLedgerStore, SimulatedVaultDriver, type VaultConfig } from '../lib/vault';
import type { Thresholds } from '../lib/policy';
import type {
  AlertEvent,
  Attestation,
  ConsensusMetrics,
  HedgeDecision,
  HedgePosition,
  VerificationResult,
} from "@/types";

let passed = 0;
let failed = 0;

function check(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      failed++;
      console.log(`  ✗ ${name}`);
      console.log(`      ${e instanceof Error ? e.message.split('\n')[0] : e}`);
    });
}

const NOW = '2026-08-31T12:00:00.000Z';
const CID = 'nsh_worker00000001';

const T: Thresholds = {
  truthHedge: 70,
  truthFull: 85,
  agreement: 0.6,
  agreementFull: 0.75,
  hardCeilingUsdc: '3.00',
  minFillUsdc: '0.50',
  cooldownMinutes: 30,
};

const VCFG: VaultConfig = {
  principalUsdc: '1000.00',
  apyBps: 500,
  dailyCapPct: 5,
  openingAccrualUsdc: '12.00',
};

const alert = (over: Partial<AlertEvent> = {}): AlertEvent => ({
  id: CID,
  source: 'MANUAL',
  rawText: 'Exploit against a cross-chain bridge on Base, $41M drained across 7 transactions',
  receivedAt: NOW,
  clusterKey: 'w1',
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

/** Stands in for the Gonka round trip. */
const fakeVerify =
  (c: ConsensusMetrics = consensus()) =>
  async (a: AlertEvent, opts: any = {}): Promise<VerificationResult> => {
    const verdict = {
      modelId: 'fake/model', role: 'ANALYST' as const, claimScore: c.truthScore,
      severity: c.severity, stance: 'REAL' as const, keyEvidence: [], redFlags: [],
      gonkaRequestId: 'devshard-1-1', responseHash: 'h'.repeat(64), latencyMs: 1,
      parseRepaired: false,
    };
    opts.onStage?.('layer1');
    opts.onVerdict?.(verdict, verdict.modelId);
    return {
      correlationId: a.id, alertId: a.id, verdicts: [verdict], consensus: c,
      reasoningTrace: ['t'], gonkaRequestIds: ['devshard-1-1'], idChainResolvable: false,
      verifiedAt: NOW, totalLatencyMs: 1,
    };
  };

const position = (d: HedgeDecision): HedgePosition => ({
  correlationId: d.correlationId, status: 'OPEN', asset: d.targetAsset, strike: '2400',
  expiry: '2026-09-07T08:00:00.000Z', contracts: '1', premiumPaidUsdc: d.targetSizeUsdc,
  notionalProtectedUsdc: '2443.00', entryTxHash: `0x${'a'.repeat(64)}`,
  baseScanUrl: 'https://basescan.org/tx/0xaaa', spotAtEntry: '2443.00',
  deltaAtEntry: -0.0887, openedAt: NOW, wasDryRun: true,
});

const okExecutor = (): Executor => ({ execute: async (d) => position(d) });
const okAttestor = (): Attestor => ({
  attest: async (_v, d): Promise<Attestation> => ({
    correlationId: d.correlationId, method: 'SELF_TX', txHash: `0x${'b'.repeat(64)}`,
    baseScanUrl: 'https://basescan.org/tx/0xbbb',
    payload: { v: 1, cid: d.correlationId, truthScore: 90, agreement: 0.9, severity: 4,
      gonkaRequestIds: ['devshard-1-1'], evidenceHash: 'e'.repeat(64),
      hedgeTxHash: `0x${'a'.repeat(64)}` },
    createdAt: NOW,
  }),
});

function harness(over: Partial<PipelineDeps> = {}) {
  const store = new InMemoryJobStore();
  const saves: string[] = [];
  const events: PipelineEvent[] = [];
  const wrapped = {
    save: async (j: Job) => { saves.push(j.status); await store.save(j); },
    get: (id: string) => store.get(id),
    claimNext: () => store.claimNext(),
    findStale: (ms: number) => store.findStale(ms),
  };
  const vault = new SimulatedVaultDriver(new InMemoryLedgerStore(), VCFG, () => NOW);
  const deps: PipelineDeps = {
    store: wrapped, vault, verify: fakeVerify(), thresholds: T, now: () => NOW,
    emit: (_id, ev) => events.push(ev),
    ...over,
  };
  return { deps, saves, events, vault, store };
}

async function main() {
  console.log('\nfull chain');

  await check('alert → verify → decide → execute → attest completes', async () => {
    const h = harness({ executor: okExecutor(), attestor: okAttestor() });
    const job = await runJob(newJob(alert(), { dryRun: true }), h.deps);
    assert.equal(job.status, 'ATTESTED');
    assert.ok(job.verification, 'no verification');
    assert.ok(job.decision, 'no decision');
    assert.ok(job.position, 'no position');
    assert.ok(job.attestation, 'no attestation');
  });

  await check('every stage persists before the next begins', async () => {
    const h = harness({ executor: okExecutor(), attestor: okAttestor() });
    await runJob(newJob(alert(), { dryRun: true }), h.deps);
    // The order of writes IS the recoverability guarantee.
    assert.deepEqual(h.saves, [
      'VERIFYING', 'VERIFIED', 'DECIDED', 'SELECTING', 'EXECUTING', 'EXECUTED', 'ATTESTED',
    ]);
  });

  await check('one correlation ID threads every record', async () => {
    const h = harness({ executor: okExecutor(), attestor: okAttestor() });
    const job = await runJob(newJob(alert(), { dryRun: true }), h.deps);
    assert.equal(job.jobId, CID);
    assert.equal(job.verification!.correlationId, CID);
    assert.equal(job.decision!.correlationId, CID);
    assert.equal(job.position!.correlationId, CID);
    assert.equal(job.attestation!.correlationId, CID);
  });

  console.log('\nSSE frames');

  await check('every stage emits a frame, in order', async () => {
    const h = harness({ executor: okExecutor(), attestor: okAttestor() });
    await runJob(newJob(alert(), { dryRun: true }), h.deps);
    const kinds = h.events.map((e) => e.event);
    const required: PipelineEvent['event'][] = [
      'status', 'verdict', 'consensus', 'decision', 'position', 'attestation', 'done',
    ];
    for (const k of required) {
      assert.ok(kinds.includes(k), `missing ${k} frame`);
    }
    assert.ok(kinds.indexOf('verdict') < kinds.indexOf('consensus'), 'consensus before verdict');
    assert.ok(kinds.indexOf('consensus') < kinds.indexOf('decision'), 'decision before consensus');
    assert.equal(kinds[kinds.length - 1], 'done');
  });

  await check('a failure emits an error envelope, not a bare throw', async () => {
    const h = harness({
      executor: { execute: async () => { throw new Error('book empty'); } },
    });
    const job = await runJob(newJob(alert(), { dryRun: true }), h.deps);
    assert.equal(job.status, 'FAILED');
    const err = h.events.find((e) => e.event === 'error');
    assert.ok(err, 'no error frame');
    assert.equal((err as any).data.error.correlationId, CID);
  });

  await check('a late subscriber receives the frames it missed', () => {
    const bus = new EventBus();
    bus.emit('j1', { event: 'status', data: { status: 'VERIFYING' } });
    bus.emit('j1', { event: 'done', data: { status: 'ATTESTED' } });
    const seen: string[] = [];
    bus.subscribe('j1', (ev) => seen.push(ev.event));
    assert.deepEqual(seen, ['status', 'done']);
  });

  console.log('\nthe public path never trades');

  await check('a USER_PASTE alert is verified but never executed', async () => {
    let executed = false;
    const h = harness({
      executor: { execute: async (d) => { executed = true; return position(d); } },
    });
    const job = await runJob(newJob(alert({ source: 'USER_PASTE' })), h.deps);
    assert.equal(executed, false, 'the public paste box reached the book');
    assert.ok(job.verification, 'it should still verify');
    assert.ok(job.decision, 'and still show a decision');
    assert.equal(job.position, undefined);
  });

  await check('operator and webhook alerts stay eligible', () => {
    for (const source of ['MANUAL', 'WEBHOOK', 'SIMULATOR'] as const) {
      assert.equal(newJob(alert({ source })).tradeEligible, true, source);
    }
    assert.equal(newJob(alert({ source: 'USER_PASTE' })).tradeEligible, false);
  });

  await check('dryRun defaults to true when not stated', () => {
    assert.equal(newJob(alert()).dryRun, true);
  });

  console.log('\nnon-hedge outcomes');

  await check('a rejected verdict ends REJECTED without touching the executor', async () => {
    let executed = false;
    const h = harness({
      verify: fakeVerify(consensus({ truthScore: 10, severity: 1 })),
      executor: { execute: async (d) => { executed = true; return position(d); } },
    });
    const job = await runJob(newJob(alert()), h.deps);
    assert.equal(job.status, 'REJECTED');
    assert.equal(executed, false);
  });

  await check('a WATCH verdict stops at DECIDED', async () => {
    const h = harness({
      verify: fakeVerify(consensus({ truthScore: 50 })),
      executor: okExecutor(),
    });
    const job = await runJob(newJob(alert()), h.deps);
    assert.equal(job.decision!.tier, 'WATCH');
    assert.equal(job.status, 'DECIDED');
  });

  console.log('\nvault interaction');

  await check('a live run debits the reserve before filling', async () => {
    const h = harness({ executor: okExecutor(), attestor: okAttestor() });
    const before = (await h.vault.getState()).premiumReserveUsdc;
    const job = await runJob(newJob(alert(), { dryRun: false }), h.deps);
    const after = (await h.vault.getState()).premiumReserveUsdc;
    assert.equal(before, '12');
    assert.notEqual(after, before, 'reserve untouched on a live run');
    assert.equal(after, String(12 - Number(job.decision!.targetSizeUsdc)));
  });

  await check('a dry run leaves the reserve alone', async () => {
    const h = harness({ executor: okExecutor(), attestor: okAttestor() });
    await runJob(newJob(alert(), { dryRun: true }), h.deps);
    assert.equal((await h.vault.getState()).premiumReserveUsdc, '12');
  });

  console.log('\na failed attestation never fails the hedge');

  await check('the position survives an attestation failure', async () => {
    const h = harness({
      executor: okExecutor(),
      attestor: { attest: async () => { throw new Error('EAS down'); } },
    });
    const job = await runJob(newJob(alert(), { dryRun: true }), h.deps);
    assert.equal(job.status, 'EXECUTED', 'a failed attestation must not fail the job');
    assert.ok(job.position, 'position lost');
    assert.equal(job.attestation, undefined);
  });

  console.log('\ncrash recovery');

  await check('a job stuck in EXECUTING is never auto-retried', () => {
    const job = { ...newJob(alert()), status: 'EXECUTING' as const };
    const [r] = classifyStale([job]);
    assert.equal(r!.action, 'MANUAL_RECONCILIATION');
    assert.match(r!.reason, /transaction may be in flight/i);
  });

  await check('earlier stages are computation only and safe to repeat', () => {
    for (const status of ['VERIFYING', 'VERIFIED', 'DECIDED', 'SELECTING'] as const) {
      const [r] = classifyStale([{ ...newJob(alert()), status }]);
      assert.equal(r!.action, 'RETRY', `${status} should be retryable`);
    }
  });

  await check('the store finds only genuinely stalled jobs', async () => {
    // Relative to the real clock: findStale reads Date.now(), so fixed
    // timestamps would pass or fail depending on what day it is run.
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    const store = new InMemoryJobStore();
    await store.save({ ...newJob(alert({ id: 'nsh_old' })), status: 'VERIFYING',
      updatedAt: ago(30 * 60_000) });
    await store.save({ ...newJob(alert({ id: 'nsh_new' })), status: 'VERIFYING',
      updatedAt: ago(1_000) });
    await store.save({ ...newJob(alert({ id: 'nsh_done' })), status: 'ATTESTED',
      updatedAt: ago(30 * 60_000) });
    const stale = await store.findStale(5 * 60_000);
    assert.deepEqual(
      stale.map((j) => j.jobId),
      ['nsh_old'],
      'should skip the fresh job and the finished one',
    );
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

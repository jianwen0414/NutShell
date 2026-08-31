import type { ISO8601 } from '../types/index.js';
import { SimulatedVaultDriver } from '../lib/vault.js';
import { resolveModels } from '../lib/gonka.js';
import {
  classifyStale,
  runJob,
  type Job,
  type JobStore,
  type PipelineDeps,
  type PipelineEvent,
} from './pipeline.js';

/**
 * The agent loop.
 *
 * A long-lived process, not a serverless function. It owns the poll loop, the
 * whole Gonka pipeline, and eventually all transaction signing. Next.js routes
 * create jobs and stream status; they never do the work.
 *
 *   npm run worker
 */

// ── In-memory store, until lib/db.ts exists ───────────────────────────────
// Deliberately behind the same interface the Postgres one will implement, so
// swapping it in is a constructor argument rather than a rewrite. Jobs do not
// survive a restart here, which is exactly why the real store is required
// before this is anything but a development harness.

export class InMemoryJobStore implements JobStore {
  private jobs = new Map<string, Job>();
  private claimed = new Set<string>();

  async save(job: Job): Promise<void> {
    this.jobs.set(job.jobId, { ...job });
  }

  async get(jobId: string): Promise<Job | null> {
    return this.jobs.get(jobId) ?? null;
  }

  async claimNext(): Promise<Job | null> {
    for (const job of this.jobs.values()) {
      if (job.status === 'QUEUED' && !this.claimed.has(job.jobId)) {
        this.claimed.add(job.jobId);
        return { ...job };
      }
    }
    return null;
  }

  async findStale(olderThanMs: number): Promise<Job[]> {
    const cutoff = Date.now() - olderThanMs;
    const inFlight = new Set(['VERIFYING', 'VERIFIED', 'DECIDED', 'SELECTING', 'EXECUTING']);
    return [...this.jobs.values()].filter(
      (j) => inFlight.has(j.status) && Date.parse(j.updatedAt) < cutoff,
    );
  }

  /** Test and API helper: enqueue work for the loop to find. */
  async enqueue(job: Job): Promise<void> {
    await this.save(job);
  }
}

// ── Event fan-out for the SSE routes ──────────────────────────────────────

type Listener = (ev: PipelineEvent) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  /** Replayed to a client that connects mid-job, so it never misses a frame. */
  private history = new Map<string, PipelineEvent[]>();

  emit(jobId: string, ev: PipelineEvent): void {
    const log = this.history.get(jobId) ?? [];
    log.push(ev);
    this.history.set(jobId, log);
    for (const l of this.listeners.get(jobId) ?? []) l(ev);
  }

  subscribe(jobId: string, listener: Listener): () => void {
    for (const past of this.history.get(jobId) ?? []) listener(past);
    const set = this.listeners.get(jobId) ?? new Set();
    set.add(listener);
    this.listeners.set(jobId, set);
    return () => set.delete(listener);
  }

  replay(jobId: string): PipelineEvent[] {
    return [...(this.history.get(jobId) ?? [])];
  }
}

// ── The loop ──────────────────────────────────────────────────────────────

export interface WorkerOptions {
  pollIntervalMs?: number;
  staleAfterMs?: number;
  /** Stops the loop. Injected so tests do not run forever. */
  signal?: AbortSignal;
  deps?: Partial<PipelineDeps>;
  log?: (msg: string) => void;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      resolve();
    }, { once: true });
  });

export function createWorker(store: InMemoryJobStore, bus: EventBus, opts: WorkerOptions = {}) {
  const log = opts.log ?? ((m: string) => console.log(`[worker] ${m}`));
  const pollIntervalMs = opts.pollIntervalMs ?? 2_000;
  const staleAfterMs = opts.staleAfterMs ?? 5 * 60_000;

  const deps: PipelineDeps = {
    store,
    vault: new SimulatedVaultDriver(),
    emit: (jobId, ev) => bus.emit(jobId, ev),
    ...opts.deps,
  };

  /**
   * Runs once at boot. Jobs interrupted mid-flight are triaged, never blindly
   * restarted: anything stuck in EXECUTING may have a transaction in the air.
   */
  async function recover(): Promise<void> {
    const stale = await store.findStale(staleAfterMs);
    if (stale.length === 0) return;
    for (const { job, action, reason } of classifyStale(stale)) {
      if (action === 'MANUAL_RECONCILIATION') {
        log(`⚠ ${reason}`);
        continue;
      }
      log(reason);
      job.status = 'QUEUED';
      await store.save(job);
    }
  }

  async function tick(): Promise<boolean> {
    const job = await store.claimNext();
    if (!job) return false;
    log(`${job.jobId} claimed (${job.alert.source}, dryRun=${job.dryRun})`);
    const done = await runJob(job, deps);
    log(`${job.jobId} finished as ${done.status}`);
    return true;
  }

  async function start(): Promise<void> {
    // Fail loudly at boot rather than on the first alert. There is no
    // non-Gonka fallback, so an unreachable router is fatal by design.
    const models = await resolveModels();
    log(`models: ${models.join(', ')}`);
    await recover();
    log('polling');

    while (!opts.signal?.aborted) {
      try {
        const worked = await tick();
        if (!worked) await sleep(pollIntervalMs, opts.signal);
      } catch (e) {
        // A failed job is recorded on the job itself. The loop must survive it.
        log(`loop error, continuing: ${e instanceof Error ? e.message : String(e)}`);
        await sleep(pollIntervalMs, opts.signal);
      }
    }
    log('stopped');
  }

  return { start, tick, recover };
}

// ── Entrypoint ────────────────────────────────────────────────────────────

const isEntrypoint =
  typeof process !== 'undefined' && process.argv[1]?.replace(/\\/g, '/').endsWith('worker/index.ts');

if (isEntrypoint) {
  try {
    process.loadEnvFile('.env');
  } catch {
    /* ambient env */
  }
  const store = new InMemoryJobStore();
  const bus = new EventBus();
  const controller = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      console.log(`[worker] ${sig}, draining`);
      controller.abort();
    });
  }
  createWorker(store, bus, { signal: controller.signal })
    .start()
    .catch((e) => {
      console.error('[worker] fatal:', e instanceof Error ? e.message : e);
      process.exit(1);
    });
}

export type { ISO8601 };

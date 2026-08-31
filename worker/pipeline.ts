import type {
  Attestation,
  ConsensusMetrics,
  ErrorEnvelope,
  HedgeDecision,
  HedgePosition,
  ISO8601,
  JobStatus,
  JobView,
  ModelVerdict,
  VerificationResult,
} from '../types/index.js';
import { AppError, asAppError } from '../lib/errors.js';
import { verifyThreat } from '../lib/gonka.js';
import { decide, thresholdsFromEnv, type PolicyState, type Thresholds } from '../lib/policy.js';
import type { VaultDriver } from '../lib/vault.js';

/**
 * alert → verify → decide → execute → attest.
 *
 * This runs in the long-lived worker, never in a Next.js route. A four
 * call LLM pipeline plus a Base transaction blows straight through Vercel's
 * 10s Hobby limit, and that is named as the most likely cause of a live
 * failure.
 *
 * The backend is the single source of truth for every state
 * transition. The frontend renders the JobStatus it receives and never infers
 * its own, so each stage persists BEFORE the next begins.
 */

// ── Job record ────────────────────────────────────────────────────────────

/** JobView plus what the worker needs to run it. */
export interface Job extends JobView {
  /** Forced true for anything not operator-authenticated. */
  dryRun: boolean;
  /**
   * Verification from the public paste box NEVER triggers a trade.
   * Only operator-injected and webhook alerts are eligible.
   */
  tradeEligible: boolean;
  attempts: number;
  updatedAt: ISO8601;
}

export function newJob(
  alert: JobView['alert'],
  opts: { dryRun?: boolean } = {},
): Job {
  return {
    jobId: alert.id,
    status: 'QUEUED',
    alert,
    // A pasted claim is verified and displayed; it never reaches the book.
    tradeEligible: alert.source !== 'USER_PASTE',
    dryRun: opts.dryRun ?? true,
    attempts: 0,
    updatedAt: alert.receivedAt,
  };
}

// ── Boundaries the worker does not own ────────────────────────────────────

export interface JobStore {
  save(job: Job): Promise<void>;
  get(jobId: string): Promise<Job | null>;
  /** Oldest QUEUED job, marked in-progress so two workers cannot claim it. */
  claimNext(): Promise<Job | null>;
  /** Jobs left mid-flight by a crash. Must stay recoverable. */
  findStale(olderThanMs: number): Promise<Job[]>;
}

/** M1's `lib/thetanuts.ts`. Interfaced so the pipeline is testable without a chain. */
export interface Executor {
  execute(decision: HedgeDecision, opts: { dryRun: boolean }): Promise<HedgePosition>;
}

/** M1's `lib/attestation.ts`. */
export interface Attestor {
  attest(
    verification: VerificationResult,
    decision: HedgeDecision,
    position: HedgePosition,
  ): Promise<Attestation>;
}

/** SSE frames The UI renders these verbatim and invents no states. */
export type PipelineEvent =
  | { event: 'status'; data: { status: JobStatus; step?: string; modelsTotal?: number } }
  | { event: 'verdict'; data: ModelVerdict }
  | { event: 'consensus'; data: ConsensusMetrics }
  | { event: 'decision'; data: HedgeDecision }
  | { event: 'position'; data: HedgePosition }
  | { event: 'attestation'; data: Attestation }
  | { event: 'done'; data: { status: JobStatus } }
  | { event: 'error'; data: ErrorEnvelope };

/** Layer 1 + 2. Injected so the pipeline is testable without the network. */
export type Verifier = typeof verifyThreat;

export interface PipelineDeps {
  store: JobStore;
  vault: VaultDriver;
  verify?: Verifier;
  executor?: Executor;
  attestor?: Attestor;
  emit?: (jobId: string, ev: PipelineEvent) => void;
  thresholds?: Thresholds;
  openHedges?: () => Promise<PolicyState['openHedges']>;
  clusterHistory?: () => Promise<PolicyState['clusterHistory']>;
  now?: () => ISO8601;
}

/**
 * Statuses that must never be auto-retried after a crash.
 *
 * EXECUTING means a transaction may already be in flight. Re-running it could
 * buy a second position with real money against the same alert. A stuck
 * execution is a job for a human with a block explorer, not for a retry loop.
 * Everything before it is pure computation and safe to repeat.
 */
export const UNSAFE_TO_RETRY: ReadonlySet<JobStatus> = new Set<JobStatus>(['EXECUTING']);

// ── The pipeline ──────────────────────────────────────────────────────────

export async function runJob(job: Job, deps: PipelineDeps): Promise<Job> {
  const now = deps.now ?? (() => new Date().toISOString());
  const t = deps.thresholds ?? thresholdsFromEnv();

  // Persist before advancing. Every transition is written before the work
  // that follows it starts, so a crash leaves a status that says exactly how
  // far it got rather than a job that silently rewinds.
  const advance = async (status: JobStatus, patch: Partial<Job> = {}) => {
    Object.assign(job, patch, { status, updatedAt: now() });
    await deps.store.save(job);
    deps.emit?.(job.jobId, { event: 'status', data: { status } });
    return job;
  };

  const fail = async (e: unknown) => {
    const err = asAppError(e);
    const envelope = err.toEnvelope(job.jobId);
    Object.assign(job, { status: 'FAILED' as JobStatus, error: envelope, updatedAt: now() });
    await deps.store.save(job);
    deps.emit?.(job.jobId, { event: 'error', data: envelope });
    return job;
  };

  try {
    job.attempts += 1;

    // ── 1. Verify ─────────────────────────────────────────────────────────
    await advance('VERIFYING');
    deps.emit?.(job.jobId, {
      event: 'status',
      data: { status: 'VERIFYING', step: 'layer1', modelsTotal: 3 },
    });

    const verify = deps.verify ?? verifyThreat;
    const verification = await verify(job.alert, {
      // Each verdict reaches the UI as it lands rather than all at the end.
      onVerdict: (v) => v && deps.emit?.(job.jobId, { event: 'verdict', data: v }),
      onStage: (stage) =>
        deps.emit?.(job.jobId, { event: 'status', data: { status: 'VERIFYING', step: stage } }),
    });

    await advance('VERIFIED', { verification });
    deps.emit?.(job.jobId, { event: 'consensus', data: verification.consensus });

    // ── 2. Decide ─────────────────────────────────────────────────────────
    const vaultState = await deps.vault.getState();
    const policyState: PolicyState = {
      premiumReserveUsdc: vaultState.premiumReserveUsdc,
      dailyCapUsdc: vaultState.dailyCapUsdc,
      dailySpentUsdc: vaultState.dailySpentUsdc,
      openHedges: (await deps.openHedges?.()) ?? [],
      clusterHistory: (await deps.clusterHistory?.()) ?? [],
      now: now(),
    };

    const decision = decide(job.alert, verification, policyState, t);
    await advance('DECIDED', { decision });
    deps.emit?.(job.jobId, { event: 'decision', data: decision });

    // ── 3. Stop here unless this is a real, eligible hedge ────────────────
    if (!job.tradeEligible) {
      // Not a failure: the public path is verification only, and the
      // verdict it produced is the whole deliverable.
      return finish(job, deps, decision.tier === 'REJECT' ? 'REJECTED' : 'VERIFIED', now);
    }
    if (decision.tier === 'REJECT') {
      return finish(job, deps, 'REJECTED', now);
    }
    if (decision.tier !== 'HEDGE_SMALL' && decision.tier !== 'HEDGE_FULL') {
      return finish(job, deps, 'DECIDED', now);
    }
    if (!deps.executor) {
      throw new AppError(
        'INTERNAL',
        'Decision calls for a hedge but no executor is wired. M1 supplies lib/thetanuts.ts.',
        { tier: decision.tier, asset: decision.targetAsset },
      );
    }

    // ── 4. Execute ────────────────────────────────────────────────────────
    // The reserve is debited BEFORE the fill. If the fill then fails, the
    // ledger holds a spend that did not happen, which a reconciliation can
    // see and correct. The reverse order risks spending money the vault never
    // agreed to release.
    await advance('SELECTING');
    if (!job.dryRun) {
      await deps.vault.reservePremium(decision.targetSizeUsdc, decision.correlationId);
    }

    await advance('EXECUTING');
    const position = await deps.executor.execute(decision, { dryRun: job.dryRun });
    await advance('EXECUTED', { position });
    deps.emit?.(job.jobId, { event: 'position', data: position });

    // ── 5. Attest ─────────────────────────────────────────────────────────
    // A failed attestation never fails the hedge. The position is real
    // and open; the attestation is a record of why it was opened.
    if (deps.attestor) {
      try {
        const attestation = await deps.attestor.attest(verification, decision, position);
        await advance('ATTESTED', { attestation });
        deps.emit?.(job.jobId, { event: 'attestation', data: attestation });
      } catch {
        await advance('EXECUTED');
      }
    }

    deps.emit?.(job.jobId, { event: 'done', data: { status: job.status } });
    return job;
  } catch (e) {
    return fail(e);
  }
}

async function finish(
  job: Job,
  deps: PipelineDeps,
  status: JobStatus,
  now: () => ISO8601,
): Promise<Job> {
  Object.assign(job, { status, updatedAt: now() });
  await deps.store.save(job);
  deps.emit?.(job.jobId, { event: 'status', data: { status } });
  deps.emit?.(job.jobId, { event: 'done', data: { status } });
  return job;
}

// ── Crash recovery ──────────────────────────────────────────────────

export interface Recovery {
  job: Job;
  action: 'RETRY' | 'MANUAL_RECONCILIATION';
  reason: string;
}

/**
 * What to do with jobs a crash left mid-flight.
 *
 * Anything before EXECUTING is pure computation and can simply run again.
 * EXECUTING is different: a transaction may have been submitted, so retrying
 * could open a second position with real money. Those are handed to a human.
 */
export function classifyStale(jobs: Job[]): Recovery[] {
  return jobs.map((job) => {
    if (UNSAFE_TO_RETRY.has(job.status)) {
      return {
        job,
        action: 'MANUAL_RECONCILIATION',
        reason:
          `Job ${job.jobId} was interrupted while EXECUTING. A transaction may be in flight. ` +
          `Check BaseScan for the burner before doing anything: retrying could open a second position.`,
      };
    }
    return {
      job,
      action: 'RETRY',
      reason: `Job ${job.jobId} stalled at ${job.status}, which is computation only and safe to repeat.`,
    };
  });
}

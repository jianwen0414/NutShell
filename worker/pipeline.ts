import type {
  Attestation,
  ConsensusMetrics,
  ErrorEnvelope,
  EvidencePacket,
  HedgeDecision,
  HedgePosition,
  ISO8601,
  InvestigationCheck,
  JobStatus,
  JobView,
  ModelVerdict,
  VerificationResult,
} from "@/types";
import { AppError, asAppError } from '../lib/errors';
import { verifyThreat } from '../lib/gonka';
import { evidenceHeadline, investigate } from '../lib/investigate';
import { decide, thresholdsFromEnv, type PolicyState, type Thresholds } from '../lib/policy';
import type { VaultDriver } from '../lib/vault';
import { getControlState } from '../lib/control-state';
import { sendTelegramAlert } from '../lib/telegram';
import { persistJobToDb } from '../lib/postgres';

/**
 * alert → investigate → verify → decide → execute → attest.
 *
 * Investigation is stage 02 and runs before the models, so the claim is scored
 * against measured chain state rather than against its own wording alone. It
 * is strictly additive: it never throws, and when it produces nothing the
 * verification prompt is byte-identical to the build that preceded it.
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
  /**
   * True when this run deliberately skipped stage 02.
   *
   * Recorded on the job, not just passed to the pipeline, because the UI has to
   * be able to tell "we did not look" apart from "we looked and found nothing".
   * Those produce the same empty evidence and mean opposite things.
   */
  investigationSkipped?: boolean;
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
  /** Stage 02, one frame per check as it lands, then the assembled packet. */
  | { event: 'check'; data: InvestigationCheck }
  | { event: 'evidence'; data: EvidencePacket }
  | { event: 'verdict'; data: ModelVerdict }
  | { event: 'consensus'; data: ConsensusMetrics }
  | { event: 'decision'; data: HedgeDecision }
  | { event: 'position'; data: HedgePosition }
  | { event: 'attestation'; data: Attestation }
  | { event: 'done'; data: { status: JobStatus } }
  | { event: 'error'; data: ErrorEnvelope };

/** Layer 1 + 2. Injected so the pipeline is testable without the network. */
export type Verifier = typeof verifyThreat;

/** Stage 02. Injected so the pipeline stays testable without a chain. */
export type Investigator = typeof investigate;

export interface PipelineDeps {
  store: JobStore;
  vault: VaultDriver;
  investigator?: Investigator;
  /**
   * Skip stage 02 entirely. Set for A/B measurement against the pre-evidence
   * behaviour; the verification path is byte-identical when evidence is absent.
   */
  skipInvestigation?: boolean;
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

  /**
   * 🔒 Emitting is presentation. It must never fail the pipeline.
   *
   * Measured, and the reason this wrapper exists: the first run to reach
   * EXECUTING through the SSE route threw "Do not know how to serialize a
   * BigInt" while encoding the `position` frame — the HedgePosition carries the
   * raw SDK order, which is full of bigints. The throw propagated out of
   * `deps.emit`, was caught by the outer handler, and marked the job FAILED
   * *after* the decision had been made and the position built.
   *
   * A display bug must not be able to do that. If money has moved, the record
   * of it matters more than the animation.
   */
  const emit = (ev: PipelineEvent) => {
    try {
      deps.emit?.(job.jobId, ev);
    } catch (e) {
      console.error(
        `[pipeline] ${job.jobId} could not emit '${ev.event}' frame; continuing: ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  // Persist before advancing. Every transition is written before the work
  // that follows it starts, so a crash leaves a status that says exactly how
  // far it got rather than a job that silently rewinds.
  const advance = async (status: JobStatus, patch: Partial<Job> = {}) => {
    Object.assign(job, patch, { status, updatedAt: now() });
    await deps.store.save(job);
    emit({ event: 'status', data: { status } });
    return job;
  };

  const fail = async (e: unknown) => {
    const err = asAppError(e);
    const envelope = err.toEnvelope(job.jobId);
    Object.assign(job, { status: 'FAILED' as JobStatus, error: envelope, updatedAt: now() });
    await deps.store.save(job);
    emit({ event: 'error', data: envelope });
    return job;
  };

  try {
    job.attempts += 1;

    // ── 1. Investigate ────────────────────────────────────────────────────
    // Stage 02 runs BEFORE the models so its findings can be scored alongside
    // the claim rather than bolted on afterwards.
    //
    // 🔒 It cannot fail this job. `investigate` never throws, and the catch
    // below covers even a programming error inside it: the pipeline then
    // proceeds with `evidence` undefined, which makes the analyst prompt
    // byte-identical to the pre-stage-02 build. Evidence is an upgrade to
    // verification, never a precondition for it.
    //
    // No new JobStatus. PRD §7 freezes that union and `lib/state-machine.ts`
    // enumerates the legal transitions, so this reports as a step inside
    // VERIFYING rather than inventing an INVESTIGATING state the UI and the
    // state machine would both have to learn.
    await advance('VERIFYING');

    let evidence: EvidencePacket | undefined;
    if (deps.skipInvestigation) {
      // Say so on the wire. A bypassed run must never be mistaken for one that
      // investigated and turned up nothing.
      job.investigationSkipped = true;
      emit({
        event: 'status',
        data: { status: 'VERIFYING', step: 'investigation-skipped' },
      });
    } else {
      emit({
        event: 'status',
        data: { status: 'VERIFYING', step: 'investigating' },
      });
      try {
        const run = deps.investigator ?? investigate;
        evidence = await run(job.alert, {
          onCheck: (check) => emit({ event: 'check', data: check }),
        });
        job.evidence = evidence;
        await deps.store.save(job);
        emit({ event: 'evidence', data: evidence });
        console.info(
          `[pipeline] ${job.jobId} investigated in ${evidence.totalLatencyMs}ms — ${evidenceHeadline(evidence)}`,
        );
      } catch (e) {
        // Belt and braces over `investigate`'s own guarantee.
        console.warn(
          `[pipeline] ${job.jobId} investigation threw, continuing without evidence: ` +
            `${e instanceof Error ? e.message : String(e)}`,
        );
        evidence = undefined;
      }
    }

    // ── 2. Verify ─────────────────────────────────────────────────────────
    emit({
      event: 'status',
      data: { status: 'VERIFYING', step: 'layer1', modelsTotal: 3 },
    });

    const verify = deps.verify ?? verifyThreat;
    const verification = await verify(job.alert, {
      ...(evidence ? { evidence } : {}),
      // Each verdict reaches the UI as it lands rather than all at the end.
      onVerdict: (v) => v && emit({ event: 'verdict', data: v }),
      onStage: (stage) =>
        emit({ event: 'status', data: { status: 'VERIFYING', step: stage } }),
    });

    await advance('VERIFIED', { verification });
    emit({ event: 'consensus', data: verification.consensus });

    // ── 3. Decide ─────────────────────────────────────────────────────────
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
    emit({ event: 'decision', data: decision });

    // ── 3.5. Monitor Only Override ────────────────────────────────────────
    // If the operator has configured MONITOR_ONLY mode, do not commit vault
    // reserves or execute on-chain options. Instead, dispatch an instant
    // Telegram push alert if suspicion reaches Truth Score >= 40.
    if (getControlState().mode === 'MONITOR_ONLY') {
      const truthScore = verification.consensus?.truthScore ?? 0;
      if (truthScore >= 40 || decision.tier === 'HEDGE_SMALL' || decision.tier === 'HEDGE_FULL') {
        try {
          await sendTelegramAlert({
            jobId: job.jobId,
            alert: job.alert,
            evidence: job.evidence,
            verification,
            decision,
          });
          emit({
            event: 'status',
            data: { status: 'DECIDED', step: 'monitor-alert-sent' },
          });
        } catch (e) {
          console.error('[pipeline] Failed to send Telegram alert:', e);
        }
      }
      return finish(job, deps, 'DECIDED', now, emit);
    }

    // ── 4. Stop here unless this is a real, eligible hedge ────────────────
    if (!job.tradeEligible) {
      // Not a failure: the public path is verification only, and the
      // verdict it produced is the whole deliverable.
      return finish(job, deps, decision.tier === 'REJECT' ? 'REJECTED' : 'VERIFIED', now, emit);
    }
    if (decision.tier === 'REJECT') {
      return finish(job, deps, 'REJECTED', now, emit);
    }
    if (decision.tier !== 'HEDGE_SMALL' && decision.tier !== 'HEDGE_FULL') {
      return finish(job, deps, 'DECIDED', now, emit);
    }
    if (!deps.executor) {
      throw new AppError(
        'INTERNAL',
        'Decision calls for a hedge but no executor is wired. M1 supplies lib/thetanuts.ts.',
        { tier: decision.tier, asset: decision.targetAsset },
      );
    }

    // ── 5. Execute ────────────────────────────────────────────────────────
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
    emit({ event: 'position', data: position });

    // ── 6. Attest ─────────────────────────────────────────────────────────
    // A failed attestation never fails the hedge. The position is real
    // and open; the attestation is a record of why it was opened.
    if (deps.attestor) {
      try {
        const attestation = await deps.attestor.attest(verification, decision, position);
        await advance('ATTESTED', { attestation });
        emit({ event: 'attestation', data: attestation });
      } catch {
        await advance('EXECUTED');
      }
    }

    await persistJobToDb(job).catch((err) => {
      console.error('[pipeline] Failed to persist job to database:', err);
    });

    emit({ event: 'done', data: { status: job.status } });
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
  /** The caller's guarded emitter, so a display failure cannot fail the job. */
  emit: (ev: PipelineEvent) => void,
): Promise<Job> {
  Object.assign(job, { status, updatedAt: now() });
  await deps.store.save(job);
  await persistJobToDb(job).catch((err) => {
    console.error('[pipeline] Failed to persist job to database in finish():', err);
  });
  emit({ event: 'status', data: { status } });
  emit({ event: 'done', data: { status } });
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

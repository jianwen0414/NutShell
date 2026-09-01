/**
 * The seam between the worker pipeline (M2) and the chain (M1).
 *
 * `worker/pipeline.ts` deliberately depends on two narrow interfaces —
 * `Executor` and `Attestor` — rather than on `lib/thetanuts.ts` directly, so
 * the pipeline stays testable without a chain. This module implements both
 * against the real Base mainnet integration, and is the ONLY place the two
 * halves meet.
 *
 * 🔒 Everything here runs in the worker process. It needs
 * `THETANUTS_PRIVATE_KEY` to sign, and PRD §5.1 forbids that key from ever
 * reaching a Next.js route.
 */

import type { Attestor, Executor } from '../worker/pipeline';
import type {
  Attestation,
  ExecutedPosition,
  HedgeDecision,
  HedgePosition,
  VerificationResult,
} from '../types/index';

import { attest, evidenceHashFor } from './attestation';
import { AppError } from './errors';
import { openPositionFor, savePosition } from './positions';
import { config } from './config';
import { executeHedge, hasSigner } from './thetanuts';

/**
 * Buy the put the decision calls for.
 *
 * The decision carries an asset and a size; `executeHedge` does everything
 * else, including re-fetching the book itself. 🔒 It never accepts a
 * caller-supplied order — measured quote TTL on this venue is 57–117s, which
 * is shorter than one verification round, so anything selected before the
 * models finished is already dead (PRD §3.5).
 */
export class ChainExecutor implements Executor {
  async execute(decision: HedgeDecision, opts: { dryRun: boolean }): Promise<HedgePosition> {
    // 🔒 One open hedge per asset — PRD §10.6. The policy engine checks this
    // too, from the state it is handed; this is the last gate before money
    // moves and it reads the position store directly.
    if (!opts.dryRun) {
      const existing = openPositionFor(decision.targetAsset);
      if (existing) {
        throw new AppError(
          'DUPLICATE_REQUEST',
          `${decision.targetAsset} already has an open hedge (${existing.correlationId}, expires ` +
            `${existing.expiry}). A second signal may only increase size, never open a duplicate.`,
          { correlationId: decision.correlationId, details: { existing: existing.correlationId } },
        );
      }
      if (!hasSigner()) {
        throw new AppError(
          'UNAUTHORIZED',
          'A live hedge was requested but this process holds no signing key. Run it in the worker, ' +
            'or leave dryRun on.',
          { correlationId: decision.correlationId },
        );
      }
    }

    const position: ExecutedPosition = await executeHedge({
      correlationId: decision.correlationId,
      asset: decision.targetAsset,
      budgetUsdc: decision.targetSizeUsdc,
      // The attestation carries the Gonka ids; the fill itself does not need
      // them, and PRD §12 forbids embedding anything in the fill's calldata.
      gonkaRequestIds: [],
      dryRun: opts.dryRun,
    });

    // Persist before returning. An unrecorded fill cannot be settled,
    // attested against, or shown in the UI, and the only way back is
    // reconstructing it from chain.
    if (!position.wasDryRun) savePosition(position);

    return position;
  }
}

/**
 * Write the attestation linking a trade to the reasoning that caused it.
 *
 * 🔒 A failed attestation never fails the hedge (PRD §12). This method still
 * throws on a hard failure, and the pipeline catches it and leaves the job at
 * EXECUTED — but the ladder inside `attest()` falls through to
 * OFFCHAIN_ONLY first, which cannot fail.
 */
export class ChainAttestor implements Attestor {
  async attest(
    verification: VerificationResult,
    decision: HedgeDecision,
    position: HedgePosition,
  ): Promise<Attestation> {
    // The evidence hash makes the verdict tamper-evident: it binds the exact
    // model output that produced this trade, so the attestation is checkable
    // even where the Gonka request id itself is not.
    const evidenceHash = evidenceHashFor({
      correlationId: verification.correlationId,
      verdicts: verification.verdicts.map((v) => ({
        modelId: v.modelId,
        claimScore: v.claimScore,
        severity: v.severity,
        stance: v.stance,
        gonkaRequestId: v.gonkaRequestId,
        responseHash: v.responseHash,
      })),
      consensus: verification.consensus,
      decision: { tier: decision.tier, asset: decision.targetAsset, size: decision.targetSizeUsdc },
    });

    const attestation = await attest({
      correlationId: decision.correlationId,
      truthScore: verification.consensus.truthScore,
      agreement: verification.consensus.agreement,
      severity: verification.consensus.severity,
      gonkaRequestIds: verification.gonkaRequestIds,
      evidenceHash,
      hedgeTxHash: position.entryTxHash,
      // A dry-run fill has no real transaction to attest, so nothing is
      // broadcast for it either. Attesting a rehearsal on-chain would put a
      // permanent record of a trade that never happened.
      dryRun: position.wasDryRun,
    });

    // Keep the attestation alongside the position it attests.
    if (!position.wasDryRun) savePosition(position, attestation);

    return attestation;
  }
}

/**
 * Open hedges, in the shape the policy engine expects.
 *
 * Feeds `PolicyState.openHedges`, which enforces the one-hedge-per-asset
 * invariant during the decision rather than at the signing boundary.
 */
export async function openHedgesForPolicy(): Promise<
  { asset: string; correlationId: string; sizeUsdc: string }[]
> {
  const { listPositions } = await import('./positions');
  return listPositions({ status: 'OPEN' })
    .filter((p) => !p.wasDryRun)
    .map((p) => ({
      asset: p.asset,
      correlationId: p.correlationId,
      sizeUsdc: p.premiumPaidUsdc,
    }));
}

/**
 * The executor and attestor, or nothing.
 *
 * Returns `{}` when no signing key is configured, so a dev machine or a
 * Next.js process wires a pipeline that verifies and decides but cannot
 * trade — which is the correct behaviour there, not a degraded one.
 */
export function chainDeps(): { executor?: Executor; attestor?: Attestor } {
  if (!hasSigner()) return {};
  return { executor: new ChainExecutor(), attestor: new ChainAttestor() };
}

/** True when this process is able to place a real trade. */
export function canTradeLive(): boolean {
  return hasSigner() && config.hardCeilingUsdc > 0;
}

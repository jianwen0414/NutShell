"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Attestation,
  ConsensusMetrics,
  EvidencePacket,
  HedgeDecision,
  HedgePosition,
  InvestigationCheck,
  JobStatus,
  ModelVerdict,
} from "@/types";

/**
 * One place that knows how to watch a verification job.
 *
 * There used to be three of these — the dashboard, the control page and the
 * manual hedge page each opened their own EventSource and each assembled a
 * slightly different shape out of the frames. They drifted, and the drift was
 * not cosmetic: the control page's copy dropped gonkaRequestId entirely, so
 * the one screen a judge is invited to paste into was the one screen that
 * failed the request-id requirement.
 *
 * The pipeline's frame contract lives in worker/pipeline.ts. Everything it can
 * emit is accumulated here, so a consumer never has to reach past this hook to
 * find a field.
 */

export interface LiveRun {
  jobId: string | null;
  status: JobStatus | null;
  /** Sub-stage label from the pipeline: "investigating", "layer1", and so on. */
  step: string | null;
  checks: InvestigationCheck[];
  evidence: EvidencePacket | null;
  verdicts: ModelVerdict[];
  consensus: ConsensusMetrics | null;
  decision: HedgeDecision | null;
  position: HedgePosition | null;
  attestation: Attestation | null;
  /** Narrative from the synthesizer, when layer 2 ran. */
  reasoningTrace: string[];
  /**
   * PRD 13.2 — request ids may be presented as chain records only when they
   * actually resolve. Carried on the run so every card renders the same way.
   */
  idChainResolvable: boolean;
  /** True when stage 02 was deliberately skipped for this run. */
  investigationSkipped: boolean;
  error: string | null;
  /** Terminal: the stream sent done or error. */
  finished: boolean;
}

export const EMPTY_RUN: LiveRun = {
  jobId: null,
  status: null,
  step: null,
  checks: [],
  evidence: null,
  verdicts: [],
  consensus: null,
  decision: null,
  position: null,
  attestation: null,
  reasoningTrace: [],
  idChainResolvable: false,
  investigationSkipped: false,
  error: null,
  finished: false,
};

/** Where a run sits in the six-stage story, derived rather than tracked. */
export type Stage =
  | "IDLE"
  | "01_DETECT"
  | "02_INVESTIGATE"
  | "03_ANALYZE"
  | "04_CHALLENGE"
  | "05_DECIDE"
  | "06_PROTECT"
  | "COMPLETE";

export const STAGE_ORDER: Stage[] = [
  "IDLE",
  "01_DETECT",
  "02_INVESTIGATE",
  "03_ANALYZE",
  "04_CHALLENGE",
  "05_DECIDE",
  "06_PROTECT",
  "COMPLETE",
];

/**
 * Which stage a run is showing.
 *
 * Derived from what has arrived rather than driven by a timer, so a slow model
 * looks slow and a stalled pipeline stops where it stalled rather than
 * marching on to a stage it never reached.
 */
export function stageOf(run: LiveRun): Stage {
  if (!run.jobId) return "IDLE";
  if (run.finished) return "COMPLETE";
  if (run.position || run.attestation || run.decision) return "06_PROTECT";
  if (run.consensus) return "05_DECIDE";
  if (run.step === "synthesizing") return "04_CHALLENGE";
  if (run.verdicts.length > 0 || run.step === "layer1") return "03_ANALYZE";
  if (run.evidence || run.checks.length > 0 || run.step === "investigating") {
    return "02_INVESTIGATE";
  }
  return "01_DETECT";
}

export interface StartOptions {
  /** Public verification of pasted text. Never trades — PRD 9.3. */
  text?: string;
  sourceUrl?: string;
  /** Operator scenario injection. Requires a token. */
  scenarioId?: string;
  skipInvestigation?: boolean;
  dryRun?: boolean;
  operatorToken?: string;
}

const ACTIVE_JOB_KEY = "nutshell_active_job";

export function useVerificationStream(options?: { persist?: boolean }) {
  const persist = options?.persist ?? false;
  const [run, setRun] = useState<LiveRun>(EMPTY_RUN);
  const sourceRef = useRef<EventSource | null>(null);

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const forget = useCallback(() => {
    if (persist && typeof window !== "undefined") {
      sessionStorage.removeItem(ACTIVE_JOB_KEY);
    }
  }, [persist]);

  const reset = useCallback(() => {
    closeStream();
    forget();
    setRun(EMPTY_RUN);
  }, [closeStream, forget]);

  const attach = useCallback(
    (jobId: string, seed?: Partial<LiveRun>) => {
      closeStream();
      if (persist && typeof window !== "undefined") {
        sessionStorage.setItem(ACTIVE_JOB_KEY, jobId);
      }
      setRun({ ...EMPTY_RUN, ...seed, jobId });

      const es = new EventSource(`/api/verify/${jobId}/stream`);
      sourceRef.current = es;

      es.addEventListener("status", (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as {
          status: JobStatus;
          step?: string;
        };
        setRun((prev) => ({
          ...prev,
          status: d.status ?? prev.status,
          step: d.step ?? prev.step,
          investigationSkipped:
            d.step === "investigation-skipped" ? true : prev.investigationSkipped,
        }));
      });

      es.addEventListener("check", (ev) => {
        const c = JSON.parse((ev as MessageEvent).data) as InvestigationCheck;
        setRun((prev) => ({ ...prev, checks: [...prev.checks, c] }));
      });

      es.addEventListener("evidence", (ev) => {
        const e = JSON.parse((ev as MessageEvent).data) as EvidencePacket;
        // The packet carries the full audit copy of the checks, a superset of
        // the frames streamed one at a time. Prefer it.
        setRun((prev) => ({ ...prev, evidence: e, checks: e.checks ?? prev.checks }));
      });

      es.addEventListener("verdict", (ev) => {
        const v = JSON.parse((ev as MessageEvent).data) as ModelVerdict;
        setRun((prev) => ({
          ...prev,
          // Replace rather than append: a model that answers twice (layer 2
          // revising layer 1) should update its card, not grow a second one.
          verdicts: [...prev.verdicts.filter((old) => old.modelId !== v.modelId), v],
          idChainResolvable: prev.idChainResolvable || Boolean(v.chainUrl),
        }));
      });

      es.addEventListener("consensus", (ev) => {
        const c = JSON.parse((ev as MessageEvent).data) as ConsensusMetrics;
        setRun((prev) => ({ ...prev, consensus: c }));
      });

      es.addEventListener("decision", (ev) => {
        const d = JSON.parse((ev as MessageEvent).data) as HedgeDecision;
        setRun((prev) => ({ ...prev, decision: d }));
      });

      es.addEventListener("position", (ev) => {
        const p = JSON.parse((ev as MessageEvent).data) as HedgePosition;
        setRun((prev) => ({ ...prev, position: p }));
      });

      es.addEventListener("attestation", (ev) => {
        const a = JSON.parse((ev as MessageEvent).data) as Attestation;
        setRun((prev) => ({ ...prev, attestation: a }));
      });

      es.addEventListener("done", () => {
        setRun((prev) => ({ ...prev, finished: true }));
        closeStream();
        forget();
      });

      es.addEventListener("error", (ev) => {
        const raw = (ev as MessageEvent).data;
        if (raw) {
          let message = "Verification failed.";
          try {
            message = JSON.parse(raw)?.error?.message ?? message;
          } catch {
            /* keep the default */
          }
          setRun((prev) => ({ ...prev, error: message, finished: true }));
          closeStream();
          forget();
          return;
        }
        // No payload means a transport-level close rather than a pipeline
        // error. Only treat it as terminal once the browser has given up.
        if (es.readyState === EventSource.CLOSED) {
          closeStream();
          forget();
          setRun((prev) =>
            prev.consensus
              ? { ...prev, finished: true }
              : { ...prev, error: "Connection to the pipeline was lost.", finished: true },
          );
        }
      });
    },
    [closeStream, forget, persist],
  );

  /**
   * Hydrate from a stored job, then attach if it is still running.
   *
   * Used on mount to survive a tab switch or a refresh, and after a server
   * restart to clear a job id that no longer exists rather than leaving a
   * spinner running against nothing.
   */
  const restore = useCallback(
    async (jobId: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/verify/${jobId}`);
        if (!res.ok) {
          forget();
          return false;
        }
        const job = await res.json();
        const seed: Partial<LiveRun> = {
          status: job.status,
          evidence: job.evidence ?? null,
          checks: job.evidence?.checks ?? [],
          verdicts: job.verification?.verdicts ?? [],
          consensus: job.verification?.consensus ?? null,
          decision: job.decision ?? null,
          position: job.position ?? null,
          attestation: job.attestation ?? null,
          reasoningTrace: job.verification?.reasoningTrace ?? [],
          idChainResolvable: job.verification?.idChainResolvable ?? false,
          investigationSkipped: job.investigationSkipped === true,
        };

        const terminal =
          job.status === "EXECUTED" ||
          job.status === "ATTESTED" ||
          job.status === "REJECTED" ||
          job.status === "FAILED";

        if (terminal) {
          forget();
          setRun({ ...EMPTY_RUN, ...seed, jobId, finished: true });
          return true;
        }

        attach(jobId, seed);
        return true;
      } catch {
        forget();
        return false;
      }
    },
    [attach, forget],
  );

  const start = useCallback(
    async (opts: StartOptions): Promise<string | null> => {
      closeStream();
      const operator = opts.operatorToken?.trim();
      const authed = Boolean(operator);

      setRun({
        ...EMPTY_RUN,
        investigationSkipped: opts.skipInvestigation === true,
      });

      try {
        const res = await fetch(authed ? "/api/simulate/inject" : "/api/verify", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authed ? { authorization: `Bearer ${operator}` } : {}),
          },
          body: JSON.stringify(
            authed
              ? {
                  scenarioId: opts.scenarioId ?? "scen_bridge_exploit",
                  skipInvestigation: opts.skipInvestigation ?? false,
                  dryRun: opts.dryRun ?? true,
                }
              : { text: opts.text ?? "", sourceUrl: opts.sourceUrl || undefined },
          ),
        });
        const body = await res.json();
        if (!res.ok || !body?.jobId) {
          throw new Error(body?.error?.message ?? "Could not start verification.");
        }
        attach(body.jobId, { investigationSkipped: opts.skipInvestigation === true });
        return body.jobId as string;
      } catch (e) {
        setRun({
          ...EMPTY_RUN,
          error: e instanceof Error ? e.message : String(e),
          finished: true,
        });
        return null;
      }
    },
    [attach, closeStream],
  );

  useEffect(() => closeStream, [closeStream]);

  return {
    run,
    stage: stageOf(run),
    isRunning: Boolean(run.jobId) && !run.finished,
    start,
    attach,
    restore,
    reset,
    setRun,
    activeJobKey: ACTIVE_JOB_KEY,
  };
}

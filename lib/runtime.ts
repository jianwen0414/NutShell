import { EventBus, InMemoryJobStore } from "@/worker/index";
import { newJob, runJob, type Job, type PipelineEvent } from "@/worker/pipeline";
import { SimulatedVaultDriver } from "./vault";
import { chainDeps, openHedgesForPolicy } from "./execution-bridge";
import { loadEnv } from "./env";
import type { AlertEvent } from "@/types";

/**
 * One shared store and event bus for the API routes.
 *
 * `next dev` runs every route in a single Node process, so a module-level
 * singleton is genuinely shared between the route that creates a job and the
 * route that streams it. Next.js clears the module registry on hot reload, so
 * the instances hang off globalThis to survive that.
 *
 * This is a development and demo arrangement, not the deployed one. On Vercel
 * each route can land in a separate lambda with no shared memory, and the long
 * pipeline would exceed the function timeout anyway. The deployed path is the
 * standalone worker plus a real database, which is why the store already sits
 * behind an interface.
 */
declare global {
  // eslint-disable-next-line no-var
  var __nutshell:
    | { store: InMemoryJobStore; bus: EventBus; vault: SimulatedVaultDriver }
    | undefined;
}

function runtime() {
  if (!globalThis.__nutshell) {
    // The key lives in one file at the repo root. Next only reads .env from
    // its own directory, so load it here before anything needs it.
    loadEnv();
    globalThis.__nutshell = {
      store: new InMemoryJobStore(),
      bus: new EventBus(),
      vault: new SimulatedVaultDriver(),
    };
  }
  return globalThis.__nutshell;
}

export const jobStore = () => runtime().store;
export const eventBus = () => runtime().bus;
export const vault = () => runtime().vault;

/**
 * Create a job and start it. Returns as soon as the job exists, so the caller
 * can hand back a 202 and a stream URL rather than holding the request open
 * for the length of the pipeline.
 */
export async function startVerification(
  alert: AlertEvent,
  opts: {
    dryRun?: boolean;
    /**
     * Skip stage 02 and score the claim on its text alone.
     *
     * Operator-only, and off by default. It exists so the pre-investigation
     * behaviour stays reachable: the on-chain evidence is truthful about the
     * real chain, so a scripted scenario describing an event that is not
     * happening will be measured as not happening, and the verdict reflects
     * that. Bypassing is how you demonstrate the verification layer on its own.
     *
     * Anything using this MUST say so in the UI. A run that skipped the
     * evidence and a run that gathered none look identical otherwise, and
     * presenting the first as the second would overclaim.
     */
    skipInvestigation?: boolean;
  } = {},
): Promise<Job> {
  const { store, bus, vault: v } = runtime();
  const job = newJob(alert, { dryRun: opts.dryRun ?? true });
  job.investigationSkipped = opts.skipInvestigation === true;
  await store.save(job);

  void runJob(job, {
    store,
    vault: v,
    ...(opts.skipInvestigation ? { skipInvestigation: true } : {}),
    emit: (jobId, ev: PipelineEvent) => bus.emit(jobId, ev),
    openHedges: openHedgesForPolicy,
    // Present only when this process holds a signing key. In `next dev` that
    // is normally the case, which is what lets the operator panel drive a
    // real fill; on Vercel it is not, and the pipeline correctly stops at
    // DECIDED rather than pretending to trade.
    ...chainDeps(),
  }).catch(() => {
    // runJob records its own failure on the job and emits an error frame.
    // Nothing further to do here; the catch only stops an unhandled rejection.
  });

  return job;
}

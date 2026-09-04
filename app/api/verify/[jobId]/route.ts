import { errorJson, json } from "@/lib/api";
import { loadJobFromDb } from "@/lib/postgres";
import { jobStore } from "@/lib/runtime";

/**
 * Poll a job. The stream is better, but polling has to work without one.
 *
 * Two sources, in the order they can answer. The in-memory store holds
 * everything about a job that is still running, including the stage 02
 * evidence packet that nothing persists. The Postgres archive holds what
 * survived the process that ran it.
 *
 * Before the fallback existed this returned a flat 404 for any job older than
 * the current server, which is what made an incident from an earlier run
 * render with its verdicts blank while the rows sat intact in the database.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = await jobStore().get(jobId);

  if (job) {
    // Only the shape the UI renders. dryRun and attempts are worker bookkeeping.
    return json(
      {
        jobId: job.jobId,
        status: job.status,
        alert: job.alert,
        evidence: job.evidence,
        // Distinguishes "we did not look" from "we looked and found nothing".
        investigationSkipped: job.investigationSkipped === true,
        verification: job.verification,
        decision: job.decision,
        position: job.position,
        attestation: job.attestation,
        error: job.error,
      },
      jobId,
    );
  }

  const archived = await loadJobFromDb(jobId).catch(() => null);
  if (archived) {
    return json(
      {
        jobId: archived.jobId,
        status: archived.status,
        alert: archived.alert,
        // 🔒 Null because no table stores it, not because the stage found
        // nothing. `evidenceUnavailable` is what tells the two apart, and the
        // incident page renders them differently.
        evidence: null,
        investigationSkipped: false,
        evidenceUnavailable: true,
        restoredFromDb: true,
        verification: archived.verification ?? null,
        decision: archived.decision ?? null,
        position: archived.position ?? null,
        attestation: archived.attestation ?? null,
        error: null,
      },
      jobId,
    );
  }

  return errorJson(
    "VALIDATION_FAILED",
    `No job ${jobId} in memory or in the archive.`,
    jobId,
  );
}

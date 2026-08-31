import { errorJson, json } from "@/lib/api";
import { jobStore } from "@/lib/runtime";

/** Poll a job. The stream is better, but polling has to work without one. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = await jobStore().get(jobId);

  if (!job) {
    return errorJson(
      "VALIDATION_FAILED",
      `No job ${jobId}. It may have expired, or the server restarted.`,
      jobId,
    );
  }

  // Only the shape the UI renders. dryRun and attempts are worker bookkeeping.
  return json(
    {
      jobId: job.jobId,
      status: job.status,
      alert: job.alert,
      verification: job.verification,
      decision: job.decision,
      position: job.position,
      attestation: job.attestation,
      error: job.error,
    },
    jobId,
  );
}

import { json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { jobStore } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/**
 * Counters for the dashboard header.
 *
 * These come from the job store, so they are real but they reset when the
 * server restarts: there is no database yet, and the in-memory store lives for
 * the life of the process. A fresh start honestly reads zero rather than
 * showing an impressive number nobody earned.
 */
export async function GET() {
  const correlationId = newCorrelationId();
  const jobs = await jobStore().all();

  const processed = jobs.length;
  const rejected = jobs.filter(
    (j) => j.status === "REJECTED" || j.decision?.tier === "WATCH" || j.decision?.tier === "REJECT",
  ).length;
  const active = jobs.filter(
    (j) => !["ATTESTED", "EXECUTED", "REJECTED", "VERIFIED", "DECIDED", "FAILED"].includes(j.status),
  ).length;

  return json({ processed, rejected, active }, correlationId);
}

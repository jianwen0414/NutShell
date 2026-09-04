import { Navigation } from "@/components/navigation";
import { IncidentView, type IncidentSeed } from "@/components/incident/incident-view";
import { loadRecord } from "@/lib/positions";
import { jobStore } from "@/lib/runtime";
import { toJsonSafe } from "@/lib/errors";

/**
 * One incident, end to end, under one correlation id.
 *
 * This replaces two pages that each told half the story. `/position/[cid]`
 * rendered a fill and an attestation with no sight of the reasoning that
 * caused them; `/hedge/[jobId]` rendered a decision awaiting approval with no
 * sight of the evidence behind it. Neither was reachable from the navigation,
 * and the Telegram alert linked to both.
 *
 * PRD §18 asks for a single correlation id threading alert → verdicts →
 * decision → fill → attestation. That is one page or it is not really a
 * thread, so this is that page.
 *
 * Two sources, because they fail differently. The job store is in memory and
 * dies with the process; the position store is on disk and outlives it. A
 * position opened yesterday still renders after a restart, with whatever
 * reasoning survived alongside it.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const job = await jobStore()
    .get(id)
    .catch(() => null);

  // Malformed ids throw rather than returning null, since the store builds a
  // filesystem path from them.
  let record = null;
  try {
    record = loadRecord(id);
  } catch {
    record = null;
  }

  const seed: IncidentSeed = toJsonSafe({
    id,
    found: Boolean(job || record),
    status: job?.status ?? (record ? record.position.status : null),
    alert: job?.alert ?? null,
    evidence: job?.evidence ?? null,
    investigationSkipped: job?.investigationSkipped === true,
    verification: job?.verification ?? null,
    decision: job?.decision ?? null,
    // The disk record wins for the position: it is what was actually written
    // after the fill settled, and it survives a restart.
    position: record?.position ?? job?.position ?? null,
    attestation: record?.attestation ?? job?.attestation ?? null,
    error: job?.error ?? null,
  });

  return (
    <>
      <Navigation />
      <IncidentView seed={seed} />
    </>
  );
}

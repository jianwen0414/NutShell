import { json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { toJsonSafe } from "@/lib/errors";
import { listPositions } from "@/lib/positions";
import type { HedgePosition, PositionStatus } from "@/types";

/**
 * Real positions the agent has opened, from the position store.
 *
 *   /api/positions?status=OPEN&asset=ETH&includeDryRuns=true
 *
 * 🔒 `execution.selectedOrder.raw` holds the untouched SDK object and its
 * bigints; the whole payload goes through `toJsonSafe`, and `raw` is dropped
 * because a browser has no use for a signing payload.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: ReadonlySet<string> = new Set<PositionStatus>([
  "PENDING",
  "OPEN",
  "UNWOUND",
  "HARVESTED",
  "EXPIRED",
  "FAILED",
]);

/** Drop the signing payload; keep everything a UI could want to show. */
function forDisplay(p: HedgePosition) {
  if (!p.execution) return p;
  const { raw, ...order } = p.execution.selectedOrder;
  void raw;
  return { ...p, execution: { ...p.execution, selectedOrder: order } };
}

export async function GET(request: Request) {
  const correlationId = newCorrelationId();
  const url = new URL(request.url);

  const statusParam = url.searchParams.get("status");
  const asset = url.searchParams.get("asset") ?? undefined;
  // Rehearsals are hidden by default: a dry run is not a position, and
  // showing one beside a real fill invites mistaking it for one.
  const includeDryRuns = url.searchParams.get("includeDryRuns") === "true";

  const status = statusParam && STATUSES.has(statusParam) ? (statusParam as PositionStatus) : undefined;

  const positions = listPositions({
    ...(status ? { status } : {}),
    ...(asset ? { asset } : {}),
  }).filter((p) => includeDryRuns || !p.wasDryRun);

  return json(
    toJsonSafe(
      positions.map((p) => ({
        ...forDisplay(p),
        // Convenience for the UI so it does not re-derive lifecycle state.
        isExpired: Date.parse(p.expiry) <= Date.now(),
        hoursToExpiry: (Date.parse(p.expiry) - Date.now()) / 3_600_000,
      })),
    ),
    correlationId,
  );
}

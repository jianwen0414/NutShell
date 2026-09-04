import { errorJson, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { selectTier } from "@/lib/policy";
import { thresholdsFromSettings } from "@/lib/settings";

/**
 * What would the gate do with these numbers?
 *
 * Public, read-only, and it moves nothing. It exists so the claim that
 * agreement changes the outcome can be checked rather than asserted — PRD §18
 * asks for the agreement metric to be "computed, displayed, and demonstrably
 * changes the outcome", and the first two are visible on any verdict while the
 * third had no surface at all.
 *
 * It calls the real `selectTier` against the operator's live thresholds.
 * `scripts/decline-demo.ts` makes the same point in a terminal, but it does it
 * against a hand-transcribed copy of the policy matrix — its own comment says
 * that copy "must be replaced by a call into the real engine, not duplicated
 * permanently". This is that call. A transcription can agree with the engine on
 * the day it is written and quietly stop agreeing the day a threshold moves,
 * which is precisely the demonstration failing in the least visible way.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);

export async function GET(request: Request) {
  const correlationId = newCorrelationId();
  const url = new URL(request.url);

  const truthScore = Number(url.searchParams.get("truth"));
  const agreement = Number(url.searchParams.get("agreement"));
  const severity = Number(url.searchParams.get("severity") ?? 4);

  if (!Number.isFinite(truthScore) || !Number.isFinite(agreement)) {
    return errorJson(
      "VALIDATION_FAILED",
      "Expected numeric truth and agreement parameters.",
      correlationId,
    );
  }

  const t = thresholdsFromSettings();
  const outcome = selectTier(
    clamp(Math.round(truthScore), 0, 100),
    clamp(agreement, 0, 1),
    clamp(Math.round(severity), 1, 5) as 1 | 2 | 3 | 4 | 5,
    t,
  );

  return json(
    {
      ...outcome,
      thresholds: {
        truthHedge: t.truthHedge,
        truthFull: t.truthFull,
        agreement: t.agreement,
        agreementFull: t.agreementFull,
      },
    },
    correlationId,
  );
}

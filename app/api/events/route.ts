import { json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { ingestHistory } from "@/lib/ingest";
import type { AlertSourceType } from "@/types";

/**
 * What stage 01 has actually seen, newest first.
 *
 * The shape is the one in the API contract: a bare array of signals carrying
 * `rawText`, a structured `source` and `receivedAt`. The screening fields are
 * added alongside rather than replacing anything, so a consumer written
 * against the contract keeps working and one that wants the triage reasoning
 * can read it.
 *
 * The rejections are included on purpose. A feed of only the headlines that
 * passed is indistinguishable from a feed that found nothing, and it hides the
 * part that is worth auditing: why each item was dismissed.
 *
 * Counters live on GET /api/ingest, since the contract fixes this response as
 * an array and there is nowhere in it for them to go.
 *
 * `credibilityScore` is absent. The contract lists it, but nothing here
 * measures the trustworthiness of a publisher, and inventing a number that
 * looks authoritative is worse than omitting the field.
 */
export async function GET(request: Request) {
  const correlationId = newCorrelationId();
  const url = new URL(request.url);

  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 300);
  const keptOnly = url.searchParams.get("kept") === "true";

  const items = ingestHistory(300)
    .filter((i) => (keptOnly ? i.verdict.keep : true))
    .slice(0, limit);

  return json(
    items.map((i) => ({
      // Contract fields.
      id: i.id,
      rawText: i.summary ? `${i.title}. ${i.summary}` : i.title,
      source: {
        type: "NEWS" as AlertSourceType,
        name: i.sourceName,
        url: i.url,
      },
      receivedAt: i.publishedAt,

      // Screening detail, additive.
      title: i.title,
      summary: i.summary,
      url: i.url,
      publishedAt: i.publishedAt,
      ingestedAt: i.ingestedAt,
      kept: i.verdict.keep,
      reason: i.verdict.reason,
      asset: i.verdict.asset,
      jobId: i.jobId ?? null,
    })),
    correlationId,
  );
}

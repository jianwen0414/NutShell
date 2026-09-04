import { errorJson, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { alreadySeen, clusterKeyFor, ingestItem } from "@/lib/ingest";
import type { FeedItem } from "@/lib/feeds";
import type { AlertSourceType } from "@/types";

/**
 * The front door for anything outside this process that wants to raise an
 * alert: the news poller, a social listener, an exchange webhook, a colleague
 * with curl.
 *
 * Separate from the operator inject route on purpose. Inject replays a scripted
 * scenario for a demo; this accepts a claim the system has never seen. They
 * authenticate differently because they are different powers: the operator
 * token drives the machine, this one only feeds it.
 *
 * An accepted alert is trade eligible, since the pipeline excludes only
 * USER_PASTE. It still runs dry unless the process was started with live
 * trading on, so holding this secret is not by itself the ability to spend.
 */

const ALLOWED_SOURCES: AlertSourceType[] = ["WEBHOOK", "NEWS", "SOCIAL", "ON_CHAIN"];

function authorised(request: Request): boolean {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return false;
  const header = request.headers.get("x-webhook-secret");
  const bearer = request.headers.get("authorization");
  return header === secret || bearer === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  const correlationId = newCorrelationId();

  if (!authorised(request)) {
    return errorJson(
      "UNAUTHORIZED",
      "Webhook secret required. Set WEBHOOK_SECRET and send it as X-Webhook-Secret.",
      correlationId,
    );
  }

  const body = await request.json().catch(() => null);

  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const summary = typeof body?.summary === "string" ? body.summary.trim() : "";
  const text = title || (typeof body?.text === "string" ? body.text.trim() : "");
  if (!text) {
    return errorJson("VALIDATION_FAILED", "Expected a title or text field.", correlationId);
  }

  const sourceType: AlertSourceType = ALLOWED_SOURCES.includes(body?.source)
    ? body.source
    : "WEBHOOK";

  // The sender's own id when it has one, so a retry or an at-least-once
  // delivery does not verify the same story twice. Falling back to a hash of
  // the text means a resend of identical content is also caught.
  const externalId =
    typeof body?.id === "string" && body.id.trim()
      ? body.id.trim()
      : `sha:${clusterKeyFor(text)}`;

  if (alreadySeen(externalId)) {
    return json(
      { accepted: false, reason: "Already ingested.", id: externalId },
      correlationId,
      { status: 200 },
    );
  }

  const item: FeedItem = {
    id: externalId,
    title: title || text.slice(0, 200),
    summary: summary || (title ? "" : text),
    url: typeof body?.url === "string" ? body.url : "",
    publishedAt:
      typeof body?.publishedAt === "string" && !Number.isNaN(Date.parse(body.publishedAt))
        ? new Date(body.publishedAt).toISOString()
        : new Date().toISOString(),
    sourceId: typeof body?.sourceId === "string" ? body.sourceId : "webhook",
    sourceName: typeof body?.sourceName === "string" ? body.sourceName : "Webhook",
  };

  try {
    const record = await ingestItem(item, { sourceType });
    return json(
      {
        accepted: record.verdict.keep,
        id: record.id,
        jobId: record.jobId ?? null,
        triage: {
          keep: record.verdict.keep,
          reason: record.verdict.reason,
          asset: record.verdict.asset,
          matched: record.verdict.matched,
        },
        // Present only when triage kept it. A screened-out item never becomes
        // a job, so there is nothing to stream.
        streamUrl: record.jobId ? `/api/verify/${record.jobId}/stream` : null,
      },
      correlationId,
      { status: record.verdict.keep ? 202 : 200 },
    );
  } catch (e) {
    return errorJson(
      "INTERNAL",
      e instanceof Error ? e.message : "Could not ingest the alert.",
      correlationId,
    );
  }
}

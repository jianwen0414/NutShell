import { errorJson, hasOperatorToken, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import {
  ingestStats,
  pollOnce,
  resetIngestedItem,
  startPolling,
  stopPolling,
  verifyIngestedItem,
} from "@/lib/ingest";

/**
 * Control for the news poller.
 *
 * Operator gated, because starting the loop makes the process begin spending
 * inference on its own schedule. Reading what it found is public; deciding
 * that it should run is not.
 */
export async function GET() {
  const correlationId = newCorrelationId();
  return json(ingestStats(), correlationId);
}

export async function POST(request: Request) {
  const correlationId = newCorrelationId();

  if (!hasOperatorToken(request)) {
    return errorJson(
      "UNAUTHORIZED",
      "Operator token required. Set OPERATOR_TOKEN and send it as a bearer token.",
      correlationId,
    );
  }

  const body = await request.json().catch(() => null);
  const action = body?.action;

  switch (action) {
    case "start": {
      const r = startPolling();
      return json({ ...r, stats: ingestStats() }, correlationId);
    }
    case "stop": {
      const stopped = stopPolling();
      return json({ stopped, stats: ingestStats() }, correlationId);
    }
    case "poll": {
      // One pass, now, without starting the timer. This is what the demo uses
      // when waiting a minute for the next tick is not an option.
      //
      // Forced past the pause switch: the operator asking for a scan is not
      // the timer running unattended, and reading the news is not acting on it.
      const result = await pollOnce({ force: true });
      return json({ result, stats: ingestStats() }, correlationId);
    }
    case "verify": {
      // Send one already-screened headline through the pipeline. The seeding
      // pass records the back catalogue without verifying it, so without this
      // a promoted headline from before the server started is a dead end no
      // operator can rescue.
      if (typeof body?.id !== "string" || !body.id.trim()) {
        return errorJson(
          "VALIDATION_FAILED",
          "Expected the feed item id to verify.",
          correlationId,
        );
      }
      const outcome = await verifyIngestedItem(body.id.trim());
      if ("error" in outcome) {
        return errorJson("VALIDATION_FAILED", outcome.error, correlationId);
      }
      return json({ ...outcome, stats: ingestStats() }, correlationId);
    }
    case "reset": {
      // Detach a headline from the job that verified it, so it can be sent
      // through again. Clears the pointer only — the verification it ran is
      // untouched and still reachable at /incident/<jobId>.
      if (typeof body?.id !== "string" || !body.id.trim()) {
        return errorJson(
          "VALIDATION_FAILED",
          "Expected the feed item id to reset.",
          correlationId,
        );
      }
      const outcome = resetIngestedItem(body.id.trim());
      if ("error" in outcome) {
        return errorJson("VALIDATION_FAILED", outcome.error, correlationId);
      }
      return json({ ...outcome, stats: ingestStats() }, correlationId);
    }
    default:
      return errorJson(
        "VALIDATION_FAILED",
        'Expected action to be "start", "stop", "poll", "verify" or "reset".',
        correlationId,
      );
  }
}

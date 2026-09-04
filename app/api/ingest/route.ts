import { errorJson, hasOperatorToken, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { ingestStats, pollOnce, startPolling, stopPolling } from "@/lib/ingest";

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
      const result = await pollOnce();
      return json({ result, stats: ingestStats() }, correlationId);
    }
    default:
      return errorJson(
        "VALIDATION_FAILED",
        'Expected action to be "start", "stop" or "poll".',
        correlationId,
      );
  }
}

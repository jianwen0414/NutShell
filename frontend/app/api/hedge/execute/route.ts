import { errorJson, hasOperatorToken, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { makePosition } from "@/lib/mock-data";

export async function POST(request: Request) {
  const correlationId = newCorrelationId();
  const idempotencyKey = request.headers.get("idempotency-key");

  if (!idempotencyKey) {
    return errorJson("VALIDATION_FAILED", "Idempotency-Key is required.", correlationId);
  }

  const body = await request.json().catch(() => ({}));
  const cid = typeof body.correlationId === "string" ? body.correlationId : correlationId;
  const position = makePosition(cid);
  position.wasDryRun = !hasOperatorToken(request) || body.dryRun !== false;

  return json(position, cid);
}

import { errorJson, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";

export async function POST(request: Request) {
  const correlationId = newCorrelationId();
  const body = await request.json().catch(() => null);

  if (!body || typeof body.text !== "string" || !body.text.trim()) {
    return errorJson("VALIDATION_FAILED", "Expected non-empty text.", correlationId);
  }

  return json(
    {
      jobId: correlationId,
      status: "QUEUED",
      streamUrl: `/api/verify/${correlationId}/stream`,
    },
    correlationId,
    { status: 202 },
  );
}

import { errorJson, hasOperatorToken, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";

export async function POST(request: Request) {
  const correlationId = newCorrelationId();

  if (!hasOperatorToken(request)) {
    return errorJson("UNAUTHORIZED", "Operator token required.", correlationId);
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

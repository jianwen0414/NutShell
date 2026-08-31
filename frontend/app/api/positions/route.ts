import { json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { makePosition } from "@/lib/mock-data";

export async function GET() {
  const correlationId = newCorrelationId();
  return json([makePosition(correlationId)], correlationId);
}

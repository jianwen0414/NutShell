import { json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";

export async function GET() {
  const correlationId = newCorrelationId();
  return json(
    {
      status: "stub",
      gonka: "not_configured",
      rpc: "not_configured",
      clockSkewSeconds: null,
      burner: { eth: null, usdc: null },
      bookDepth: null,
    },
    correlationId,
  );
}

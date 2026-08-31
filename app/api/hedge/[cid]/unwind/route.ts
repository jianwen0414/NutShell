import { errorJson, hasOperatorToken, json } from "@/lib/api";
import { makePosition } from "@/lib/mock-data";

export async function POST(request: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;

  if (!hasOperatorToken(request)) {
    return errorJson("UNAUTHORIZED", "Operator token required.", cid);
  }

  const position = makePosition(cid);
  position.status = "UNWOUND";
  position.closedAt = new Date().toISOString();
  position.exitTxHash =
    "0x2222222222222222222222222222222222222222222222222222222222222222";
  position.realisedPnlUsdc = "-0.20";

  return json(position, cid);
}

import { json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { decodedOrders, marketSnapshot } from "@/lib/mock-data";

export async function GET() {
  const correlationId = newCorrelationId();
  return json({ orders: decodedOrders(), market: marketSnapshot() }, correlationId);
}

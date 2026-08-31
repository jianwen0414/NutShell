import { json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { vault } from "@/lib/runtime";

/**
 * Real vault state from the ledger, not a fixture.
 *
 * `isSimulated` comes back true and the UI must show the banner beside it:
 * the yield is modelled, the premiums are real.
 */
export async function GET() {
  const correlationId = newCorrelationId();
  return json(await vault().getState(), correlationId);
}

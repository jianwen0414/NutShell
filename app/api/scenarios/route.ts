import { json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { SIMULATOR_SCENARIOS } from "@/lib/simulator";

/**
 * The scripted claims, for anyone who wants one to paste.
 *
 * Public and read-only. The texts are not secrets — they are the exact strings
 * the models are asked to score, and handing them over is the point: a visitor
 * can run the same claim we run and get their own answer, or edit a word and
 * watch the score move.
 *
 * Starting a scenario as an operator injection still needs a token. This route
 * only hands over the text; what the visitor does with it goes through the
 * public verify path like any other paste, and cannot trade.
 */
export const dynamic = "force-static";

export async function GET() {
  const correlationId = newCorrelationId();
  return json(
    SIMULATOR_SCENARIOS.map((s) => ({
      id: s.id,
      name: s.name,
      rawText: s.rawText,
      /** What this exact wording actually produced against the live network. */
      expectedTier: s.expectedTier,
    })),
    correlationId,
  );
}

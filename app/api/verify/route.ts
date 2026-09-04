import { createHash } from "node:crypto";
import { errorJson, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { startVerification } from "@/lib/runtime";
import type { AlertEvent, AlertSourceType } from "@/types";

/**
 * Public verification. No auth, no wallet.
 *
 * A claim pasted here is verified and displayed and never reaches the book.
 * That is enforced when the job is created, not checked later: `newJob` marks
 * a USER_PASTE alert ineligible to trade, so no downstream change can turn a
 * public paste into a position.
 *
 * 🔒 Deliberately NOT gated on the agent's pause switch, though it used to be.
 * Pausing stops the agent acting on its own; it does not stop a person asking
 * a question, and this route cannot act on anything. Gating it meant the
 * mandatory public deliverable (PRD §2) went dark the moment an operator hit
 * pause — which is exactly what an operator does before a demo. Same reasoning
 * the ingest route already applies to an operator-forced scan.
 */
export async function POST(request: Request) {
  const correlationId = newCorrelationId();

  const body = await request.json().catch(() => null);

  if (!body || typeof body.text !== "string" || !body.text.trim()) {
    return errorJson("VALIDATION_FAILED", "Expected non-empty text.", correlationId);
  }

  const text: string = body.text.trim();
  if (text.length > 4000) {
    return errorJson("VALIDATION_FAILED", "Claim is longer than 4000 characters.", correlationId);
  }

  // Anything arriving here is public, whatever the body claims.
  const source: AlertSourceType = "USER_PASTE";

  const alert: AlertEvent = {
    id: correlationId,
    source,
    rawText: text,
    ...(typeof body.sourceUrl === "string" ? { sourceUrl: body.sourceUrl } : {}),
    receivedAt: new Date().toISOString(),
    // Groups alerts about the same event so a crisis firing many of them does
    // not trigger many hedges.
    clusterKey: createHash("sha256").update(text.toLowerCase()).digest("hex").slice(0, 16),
  };

  try {
    await startVerification(alert, { dryRun: true });
  } catch (e) {
    return errorJson(
      "INTERNAL",
      e instanceof Error ? e.message : "Could not start verification.",
      correlationId,
    );
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

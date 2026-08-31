import { createHash } from "node:crypto";
import { errorJson, hasOperatorToken, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { startVerification } from "@/lib/runtime";
import { SIMULATOR_SCENARIOS } from "@/lib/simulator";
import type { AlertEvent } from "@/types";

/**
 * Operator injection.
 *
 * This is the only path that can reach the book. A claim pasted into the
 * public box is verified and shown and never trades, by design, so a real
 * hedge has to be triggered from here.
 *
 * Accepts a preset scenario id or free text. Presets come from the scenario
 * list so the operator panel and the pipeline cannot drift apart.
 */
export async function POST(request: Request) {
  const correlationId = newCorrelationId();

  if (!hasOperatorToken(request)) {
    return errorJson(
      "UNAUTHORIZED",
      "Operator token required. Set OPERATOR_TOKEN and send it as a bearer token.",
      correlationId,
    );
  }

  const body = await request.json().catch(() => null);

  let claimText = "";
  let clusterKey: string | undefined;
  let scenarioName: string | undefined;

  if (body?.scenarioId) {
    const scenario = SIMULATOR_SCENARIOS.find((s) => s.id === body.scenarioId);
    if (!scenario) {
      return errorJson(
        "VALIDATION_FAILED",
        `Unknown scenario ${body.scenarioId}. Known: ${SIMULATOR_SCENARIOS.map((s) => s.id).join(", ")}`,
        correlationId,
      );
    }
    claimText = scenario.rawText;
    // Preset clusters are deliberate: the debunk shares a key with the exploit
    // so injecting it lands on the same cluster and can unwind that position.
    clusterKey = scenario.clusterKey;
    scenarioName = scenario.name;
  } else if (typeof body?.text === "string" && body.text.trim()) {
    claimText = body.text.trim();
  } else {
    return errorJson(
      "VALIDATION_FAILED",
      "Expected either scenarioId or non-empty text.",
      correlationId,
    );
  }

  const alert: AlertEvent = {
    id: correlationId,
    // MANUAL, not USER_PASTE: an operator injection is eligible to trade.
    source: "MANUAL",
    rawText: claimText,
    receivedAt: new Date().toISOString(),
    clusterKey:
      clusterKey ?? createHash("sha256").update(claimText.toLowerCase()).digest("hex").slice(0, 16),
    ...(scenarioName ? { metadata: { scenario: scenarioName } } : {}),
  };

  try {
    // Live trades stay opt-in. Nothing reaches the book unless the caller
    // asks for it explicitly.
    await startVerification(alert, { dryRun: body?.dryRun !== false });
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
      scenario: scenarioName ?? null,
      dryRun: body?.dryRun !== false,
      streamUrl: `/api/verify/${correlationId}/stream`,
    },
    correlationId,
    { status: 202 },
  );
}

/** The presets the operator panel offers. */
export async function GET() {
  const correlationId = newCorrelationId();
  return json(
    SIMULATOR_SCENARIOS.map((s) => ({
      id: s.id,
      name: s.name,
      expectedTier: s.expectedTier,
      rawText: s.rawText,
    })),
    correlationId,
  );
}

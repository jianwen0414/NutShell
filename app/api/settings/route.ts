import { errorJson, hasOperatorToken, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { getSettings, matchesPreset, updateSettings, TIER_PRESETS } from "@/lib/settings";

/**
 * The policy the agent is actually running.
 *
 * Reading is public: what an autonomous agent is permitted to do with money is
 * exactly the thing an observer should be able to check without asking. Writing
 * is operator-gated, because these numbers decide when it spends.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const correlationId = newCorrelationId();
  const settings = getSettings();
  return json(
    {
      ...settings,
      /** False once a value has been hand-edited away from its profile. */
      matchesPreset: matchesPreset(settings),
      presets: TIER_PRESETS,
    },
    correlationId,
  );
}

export async function POST(request: Request) {
  const correlationId = newCorrelationId();

  if (!hasOperatorToken(request)) {
    return errorJson(
      "UNAUTHORIZED",
      "Operator token required to change policy.",
      correlationId,
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return errorJson("VALIDATION_FAILED", "Expected a JSON object.", correlationId);
  }

  const settings = updateSettings(body);
  return json({ ...settings, matchesPreset: matchesPreset(settings) }, correlationId);
}

import { errorJson, hasOperatorToken, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { config } from "@/lib/config";
import { toAppError, toJsonSafe } from "@/lib/errors";
import { canTradeLive } from "@/lib/execution-bridge";
import { openPositionFor, savePosition } from "@/lib/positions";
import { executeHedge } from "@/lib/thetanuts";
import { supportedAssets } from "@/lib/assets";

/**
 * PRD §9.5 — operator only, `Idempotency-Key` required.
 *
 * 🔒 Guard order, all server-side and all in this file:
 *   auth → idempotency → force dryRun if unauthenticated → asset allowlist →
 *   size floor → global hard ceiling → one-hedge-per-asset → re-fetch book →
 *   TTL filter → asset resolve + cross-check → approve exact amount → sign.
 *
 * The last six live inside `executeHedge`, which re-fetches the book itself
 * and never accepts a caller-supplied order.
 *
 * "A public URL that can spend real money is an open till." An unauthenticated
 * caller gets `dryRun: true` forced regardless of what the body says, and
 * `HARD_CEILING_USDC` cannot be raised by a request parameter.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Idempotency replays, in memory.
 *
 * PRD §8 gives this a table; until that exists, a module-level map at least
 * stops a double-click from buying two positions inside one process. It is
 * NOT sufficient across replicas, which is one more reason the deployed
 * trading path is the single worker rather than serverless routes.
 */
const seen = new Map<string, { correlationId: string; body: unknown; at: number }>();
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  const fallbackId = newCorrelationId();

  // ── auth ────────────────────────────────────────────────────────────────
  const authenticated = hasOperatorToken(request);

  // ── idempotency ─────────────────────────────────────────────────────────
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return errorJson("VALIDATION_FAILED", "Idempotency-Key is required on /api/hedge/execute.", fallbackId);
  }
  for (const [k, v] of seen) if (Date.now() - v.at > IDEMPOTENCY_TTL_MS) seen.delete(k);
  const replay = seen.get(idempotencyKey);
  if (replay) {
    return json(replay.body, replay.correlationId, { headers: { "Idempotent-Replay": "true" } });
  }

  const body = await request.json().catch(() => ({}));
  const correlationId = typeof body.correlationId === "string" ? body.correlationId : fallbackId;

  // 🔒 Unauthenticated callers can rehearse, never trade. The body cannot
  // override this.
  const dryRun = !authenticated || body.dryRun !== false;

  // ── validation ──────────────────────────────────────────────────────────
  const asset = typeof body.asset === "string" ? body.asset.toUpperCase() : "";
  if (!asset) {
    return errorJson("VALIDATION_FAILED", "asset is required.", correlationId);
  }
  if (!supportedAssets().includes(asset)) {
    return errorJson(
      "ASSET_UNRESOLVED",
      `${asset} is not in the verified price-feed registry. Supported: ${supportedAssets().join(", ")}.`,
      correlationId,
    );
  }

  const sizeUsdc = typeof body.sizeUsdc === "string" ? body.sizeUsdc : String(body.sizeUsdc ?? "");
  const size = Number(sizeUsdc);
  if (!Number.isFinite(size) || size <= 0) {
    return errorJson("VALIDATION_FAILED", `sizeUsdc must be a positive decimal string, got "${sizeUsdc}".`, correlationId);
  }
  if (size < config.minFillUsdc) {
    return errorJson(
      "SIZE_BELOW_MINIMUM",
      `sizeUsdc ${sizeUsdc} is below MIN_FILL_USDC ${config.minFillUsdc}.`,
      correlationId,
    );
  }
  // 🔒 Enforced here AND inside executeHedge. No parameter can raise it.
  const cappedSize = Math.min(size, config.hardCeilingUsdc);

  if (!dryRun) {
    if (!canTradeLive()) {
      return errorJson(
        "UNAUTHORIZED",
        "This process holds no signing key, so it cannot place a live trade. Trading runs in the worker (PRD §5.1).",
        correlationId,
      );
    }
    // 🔒 One open hedge per asset — PRD §10.6.
    const existing = openPositionFor(asset);
    if (existing) {
      return errorJson(
        "DUPLICATE_REQUEST",
        `${asset} already has an open hedge (${existing.correlationId}, expires ${existing.expiry}). ` +
          "A second signal may only increase size, never open a duplicate.",
        correlationId,
        { existing: existing.correlationId },
      );
    }
  }

  // ── execute ─────────────────────────────────────────────────────────────
  try {
    const position = await executeHedge({
      correlationId,
      asset,
      budgetUsdc: String(cappedSize),
      gonkaRequestIds: [],
      dryRun,
    });

    if (!position.wasDryRun) savePosition(position);

    const { raw, ...order } = position.execution.selectedOrder;
    void raw;
    const payload = toJsonSafe({
      ...position,
      execution: { ...position.execution, selectedOrder: order },
      // Make the guard outcome visible rather than implied.
      guards: {
        authenticated,
        dryRunForced: !authenticated,
        requestedSizeUsdc: sizeUsdc,
        cappedSizeUsdc: String(cappedSize),
        hardCeilingUsdc: String(config.hardCeilingUsdc),
      },
    });

    seen.set(idempotencyKey, { correlationId, body: payload, at: Date.now() });
    return json(payload, correlationId);
  } catch (e) {
    const err = toAppError(e, correlationId);
    return errorJson(err.code, err.message, correlationId, err.details);
  }
}

import { errorJson, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { config } from "@/lib/config";
import { toAppError, toJsonSafe } from "@/lib/errors";
import { fetchBookDecoded, filterDecoded } from "@/lib/thetanuts";
import type { DecodedOrder } from "@/types";

/**
 * PRD §9.6 — decoded orders plus the market snapshot, from the live Base
 * mainnet book. Read-only, no signer, no wallet.
 *
 *   /api/book/quotes?asset=ETH&type=put&minTtl=60&vanillaOnly=true
 *
 * 🔒 Never expose raw bigints. `DecodedOrder.raw` holds the untouched SDK
 * object, whose fields are `bigint`, so `JSON.stringify` on an order THROWS.
 * The `raw` field is stripped here: it exists to be signed, and a browser has
 * no use for it. Everything else goes through `toJsonSafe`.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cache 10s, per PRD §9.6 — the book churns but not per-request. */
export const revalidate = 0;

type PublicOrder = Omit<DecodedOrder, "raw">;

function strip(order: DecodedOrder): PublicOrder {
  const { raw, ...rest } = order;
  void raw;
  return rest;
}

export async function GET(request: Request) {
  const correlationId = newCorrelationId();
  const url = new URL(request.url);

  const asset = url.searchParams.get("asset") ?? undefined;
  const type = url.searchParams.get("type");
  const minTtlParam = url.searchParams.get("minTtl");
  const vanillaOnly = url.searchParams.get("vanillaOnly") !== "false";
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100) || 100, 500);

  const minTtlSeconds = minTtlParam === null ? config.quoteMinTtlS : Number(minTtlParam);
  if (!Number.isFinite(minTtlSeconds)) {
    return errorJson("VALIDATION_FAILED", `minTtl must be a number, got "${minTtlParam}"`, correlationId);
  }

  try {
    const { orders, rejected, snapshot } = await fetchBookDecoded();

    const filtered = filterDecoded(orders, {
      ...(asset ? { asset } : {}),
      ...(type === "put" ? { isCall: false } : type === "call" ? { isCall: true } : {}),
      minTtlSeconds,
      vanillaPutsOnly: vanillaOnly,
    })
      .sort((a, b) => Number(a.premiumPerContract) - Number(b.premiumPerContract))
      .slice(0, limit);

    return json(
      toJsonSafe({
        orders: filtered.map(strip),
        market: snapshot,
        meta: {
          totalOnBook: snapshot.orderCount,
          decoded: orders.length,
          // Non-zero here means the book listed something this build cannot
          // safely price — an unknown price feed or collateral token.
          rejected: rejected.length,
          returned: filtered.length,
          filters: { asset: asset ?? null, type: type ?? null, minTtlSeconds, vanillaOnly },
        },
      }),
      correlationId,
      { headers: { "Cache-Control": "public, max-age=10, stale-while-revalidate=20" } },
    );
  } catch (e) {
    const err = toAppError(e, correlationId);
    return errorJson(err.code, err.message, correlationId, err.details);
  }
}

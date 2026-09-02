import { errorJson, json } from "@/lib/api";
import { newCorrelationId } from "@/lib/ids";
import { config } from "@/lib/config";
import { toJsonSafe } from "@/lib/errors";
import { healthCheck } from "@/lib/thetanuts";
import { registrySummary } from "@/lib/assets";
import { investigationHealth, investigationConfig, LOG_WINDOW_BLOCKS } from "@/lib/investigate";

/**
 * PRD §9.6 — "how a failure gets diagnosed in ten seconds instead of three
 * minutes." Real reads against Base mainnet and the live order book.
 *
 * Read-only: it never constructs a signer, so it is safe in a Next.js route.
 * Burner balances appear only when this process happens to hold the key,
 * which on Vercel it must not (PRD §5.1).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const correlationId = newCorrelationId();

  try {
    // Stage 02's dependencies are checked alongside the book's, and
    // deliberately do NOT gate `status`. A degraded investigation costs the
    // verification some evidence; it never stops a hedge, so reporting the
    // whole system as down because DeFiLlama is slow would be wrong.
    const [h, inv] = await Promise.all([
      healthCheck(),
      investigationHealth().catch((e) => ({
        archiveReads: false, logWindow: false, defillama: false,
        errors: [`investigation health check threw: ${e instanceof Error ? e.message : String(e)}`],
      })),
    ]);
    const skewOk = h.clockSkewWithinLimit === true;
    const ok = h.rpcOk && h.bookOk && skewOk && h.errors.length === 0;

    return json(
      toJsonSafe({
        status: ok ? "ok" : h.rpcOk && h.bookOk ? "degraded" : "down",
        checkedAt: new Date().toISOString(),
        rpc: {
          reachable: h.rpcOk,
          chainId: h.chainId ?? null,
          expectedChainId: 8453,
          blockNumber: h.blockNumber ?? null,
        },
        book: {
          reachable: h.bookOk,
          orderCount: h.orderCount ?? null,
          vanillaPutCount: h.vanillaPutCount ?? null,
          perAsset: h.perAsset ?? null,
        },
        clock: {
          withinLimit: skewOk,
          // The real skew: our host against the feed's server clock.
          localSkewSeconds: h.snapshot?.localClockSkewSeconds ?? null,
          maxClockSkewSeconds: config.maxClockSkewS,
          feedNow: h.snapshot?.feedNow ?? null,
          // `lastUpdated` is a forward-dated quote-cycle anchor, not a
          // staleness marker: every order expiry is lastUpdated/1000 + 60.
          quoteCyclePhaseSeconds: h.snapshot?.clockSkewSeconds ?? null,
        },
        burner: h.burner
          ? {
              address: h.burner.address,
              ethWei: h.burner.ethWei,
              usdcRaw: h.burner.usdcRaw,
              canSign: true,
            }
          : { address: null, ethWei: null, usdcRaw: null, canSign: false },
        limits: {
          hardCeilingUsdc: String(config.hardCeilingUsdc),
          minFillUsdc: String(config.minFillUsdc),
          quoteMinTtlSeconds: config.quoteMinTtlS,
        },
        registry: {
          assets: registrySummary().assets,
          feedCount: registrySummary().feedCount,
        },
        investigation: {
          // Stage 02. Degraded here means the models get less evidence, not
          // that the pipeline stops.
          status:
            inv.archiveReads && inv.logWindow && inv.defillama
              ? "ok"
              : inv.archiveReads || inv.logWindow || inv.defillama
                ? "degraded"
                : "down",
          archiveReads: inv.archiveReads,
          logWindowBlocks: LOG_WINDOW_BLOCKS + 1,
          logWindowAccepted: inv.logWindow,
          defillamaReachable: inv.defillama,
          budgetMs: investigationConfig.budgetMs,
          errors: inv.errors,
        },
        errors: h.errors,
      }),
      correlationId,
    );
  } catch (e) {
    return errorJson(
      "RPC_UNAVAILABLE",
      `Health check could not reach the chain or the book: ${e instanceof Error ? e.message : String(e)}`,
      correlationId,
    );
  }
}

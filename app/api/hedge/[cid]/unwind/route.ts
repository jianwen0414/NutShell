import { errorJson, hasOperatorToken, json } from "@/lib/api";
import { toAppError, toJsonSafe } from "@/lib/errors";
import { loadPosition, savePosition } from "@/lib/positions";
import { abandonPosition, settlePosition } from "@/lib/thetanuts";

/**
 * Close out a position — operator only.
 *
 * 🔒 There is NO early unwind for a long put on this venue. Measured on
 * mainnet against a real open position:
 *
 *   close()                 reverts "Buyer and seller same to close"
 *   reclaimCollateral()     reverts "Only seller can reclaim"
 *   returnExcessCollateral() succeeds, returns 0
 *
 * `close()` annihilates a position only when ONE address holds BOTH sides;
 * we hold the long side alone. And there is nobody to sell to: 0 of the live
 * vanilla PUT quotes carry `isLong: true`, so the market maker never bids for
 * puts and no secondary market exists. **Measured premium recovery on an
 * early exit is 0%.**
 *
 * So this route does one of two honest things and never invents a recovery:
 *
 *   · before expiry → record the decision to stop protecting. No transaction,
 *     because none is possible. Realised PnL is the whole premium.
 *   · after expiry  → measure what settlement actually returned. Settlement
 *     is automatic on this venue, so this costs no gas either.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;

  if (!hasOperatorToken(request)) {
    return errorJson("UNAUTHORIZED", "Operator token required.", cid);
  }

  const body = await request.json().catch(() => ({}));
  const reason = body.reason === "HARVEST" ? "HARVEST" : "ROLLBACK";

  const position = loadPosition(cid);
  if (!position) {
    return errorJson("VALIDATION_FAILED", `No position recorded for ${cid}.`, cid);
  }
  if (position.status !== "OPEN") {
    return errorJson(
      "VALIDATION_FAILED",
      `Position ${cid} is ${position.status}, not OPEN.`,
      cid,
      { status: position.status },
    );
  }

  const expired = Date.parse(position.expiry) <= Date.now();

  try {
    const closed = expired
      ? await settlePosition(cid, { position })
      : await abandonPosition(
          cid,
          `Operator ${reason.toLowerCase()} before expiry`,
          { position },
        );

    savePosition(closed);

    const { raw, ...order } = closed.execution?.selectedOrder ?? ({} as { raw?: unknown });
    void raw;

    return json(
      toJsonSafe({
        ...closed,
        ...(closed.execution
          ? { execution: { ...closed.execution, selectedOrder: order } }
          : {}),
        outcome: {
          reason,
          settledAtExpiry: expired,
          /**
           * 🔒 Stated, not implied. Before expiry nothing is recoverable on
           * this venue; after expiry the number is measured from the burner's
           * balance delta. Never estimated, never presented as a recovery
           * that did not happen.
           */
          recoveredUsdc: closed.execution?.settlement?.recovered ?? "0",
          transactionSent: Boolean(closed.exitTxHash),
          note: expired
            ? "Settled at expiry. Settlement is automatic on this venue, so no transaction was required."
            : "No transaction sent: a long put has no early exit here and no bid to sell into. " +
              "The premium is unrecoverable and the position will lapse at expiry.",
        },
      }),
      cid,
    );
  } catch (e) {
    const err = toAppError(e, cid);
    return errorJson(err.code, err.message, cid, err.details);
  }
}

import { errorJson, hasOperatorToken, json } from "@/lib/api";
import { cmpDecimal } from "@/lib/decimals";
import { isAgentPaused } from "@/lib/control-state";
import { toAppError } from "@/lib/errors";
import { newCorrelationId } from "@/lib/ids";
import { thresholdsFromSettings } from "@/lib/settings";
import { savePosition } from "@/lib/positions";
import { persistJobToDb } from "@/lib/postgres";
import { eventBus, jobStore } from "@/lib/runtime";
import { executeHedge, hasSigner } from "@/lib/thetanuts";

/**
 * Human-in-the-loop execution — operator only.
 *
 * This is the approval half of APPROVAL_REQUIRED: the pipeline stops at
 * DECIDED, the operator is alerted, and this route is what they reach for
 * when they agree with the decision.
 *
 * 🔒 It signs and broadcasts on Base mainnet, so it carries the same gates as
 * every other route that can move money:
 *
 *   · operator token, checked in constant time
 *   · refuses while the agent is paused — the emergency stop has to mean
 *     something, and an operator who wants to trade can resume first
 *   · HARD_CEILING_USDC enforced here, because this path deliberately skips
 *     the policy sizing that normally enforces it (PRD §14)
 *
 * The route reached production once without an authorization check while its
 * URL was being printed into Telegram messages. That combination is why the
 * gates above are written out rather than assumed.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const correlationId = newCorrelationId();

  if (!hasOperatorToken(request)) {
    return errorJson(
      "UNAUTHORIZED",
      "Operator token required. Send it as a bearer token.",
      correlationId,
    );
  }

  if (isAgentPaused()) {
    return errorJson(
      "AGENT_PAUSED",
      "The agent is paused. Resume it before executing a hedge.",
      correlationId,
    );
  }

  const body = await request.json().catch(() => null);
  const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
  if (!jobId) {
    return errorJson("VALIDATION_FAILED", "Expected a jobId.", correlationId);
  }

  const store = jobStore();
  const job = await store.get(jobId);

  const asset = String(body?.asset ?? job?.decision?.targetAsset ?? "ETH").toUpperCase();
  const budgetUsdc = String(body?.budgetUsdc ?? job?.decision?.targetSizeUsdc ?? "1.00").trim();

  if (!/^\d+(\.\d+)?$/.test(budgetUsdc) || cmpDecimal(budgetUsdc, "0") <= 0) {
    return errorJson(
      "VALIDATION_FAILED",
      `budgetUsdc must be a positive decimal, received "${budgetUsdc}".`,
      correlationId,
    );
  }

  // 🔒 PRD §14. The policy engine caps autonomous sizing; this path bypasses
  // it by design, so the ceiling is re-applied here rather than trusted to a
  // number that arrived in a request body.
  // From the operator settings, not the environment: an operator who drops
  // the ceiling on the console expects it to bind the approval button too.
  const ceiling = thresholdsFromSettings().hardCeilingUsdc;
  if (cmpDecimal(budgetUsdc, ceiling) > 0) {
    return errorJson(
      "VALIDATION_FAILED",
      `budgetUsdc ${budgetUsdc} exceeds the hard ceiling of ${ceiling} USDC per trade.`,
      correlationId,
      { budgetUsdc, hardCeilingUsdc: ceiling },
    );
  }

  // Never let a request body turn a dry run into a real one on a process that
  // has no signer; and never let it force a real fill silently, either.
  const shouldDryRun = body?.dryRun !== undefined ? Boolean(body.dryRun) : !hasSigner();

  try {
    const position = await executeHedge({
      correlationId: jobId,
      asset,
      budgetUsdc,
      dryRun: shouldDryRun,
      gonkaRequestIds: job?.verification?.gonkaRequestIds ?? [],
    });

    if (job) {
      job.position = position;
      job.status = "EXECUTED";
      job.updatedAt = new Date().toISOString();
      await store.save(job);
      await persistJobToDb(job).catch((e) => {
        console.error("[manual-hedge] could not persist job:", e);
      });

      const bus = eventBus();
      bus.emit(jobId, { event: "position", data: position });
      bus.emit(jobId, { event: "status", data: { status: "EXECUTED" } });
      bus.emit(jobId, { event: "done", data: { status: "EXECUTED" } });
    }

    if (!position.wasDryRun) savePosition(position);

    return json({ ok: true, jobId, position, wasDryRun: position.wasDryRun }, correlationId);
  } catch (e) {
    const err = toAppError(e, correlationId);
    console.error("[manual-hedge] execution failed:", err.message);
    return errorJson(err.code, err.message, correlationId);
  }
}

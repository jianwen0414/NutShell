import { NextRequest, NextResponse } from "next/server";
import { executeHedge, hasSigner } from "@/lib/thetanuts";
import { jobStore, eventBus } from "@/lib/runtime";
import { savePosition } from "@/lib/positions";
import { persistJobToDb } from "@/lib/postgres";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { jobId, asset: reqAsset, budgetUsdc: reqBudget, dryRun } = body;

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId in request body." }, { status: 400 });
    }

    const store = jobStore();
    const job = await store.get(jobId);

    const asset = (reqAsset || job?.decision?.targetAsset || "ETH").toUpperCase();
    const budgetUsdc = reqBudget || job?.decision?.targetSizeUsdc || "50.00";
    const shouldDryRun = dryRun !== undefined ? Boolean(dryRun) : !hasSigner();

    console.info(
      `[manual-hedge] Executing manual hedge for job ${jobId}: ${asset}, budget $${budgetUsdc} USDC (dryRun: ${shouldDryRun})`,
    );

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

      // Persist to Supabase
      await persistJobToDb(job).catch((e) => {
        console.error("[manual-hedge] Failed to persist job to database:", e);
      });

      // Notify SSE subscribers
      const bus = eventBus();
      bus.emit(jobId, { event: "position", data: position });
      bus.emit(jobId, { event: "status", data: { status: "EXECUTED" } });
      bus.emit(jobId, { event: "done", data: { status: "EXECUTED" } });
    }

    if (!position.wasDryRun) {
      savePosition(position);
    }

    return NextResponse.json({
      ok: true,
      jobId,
      position,
      wasDryRun: position.wasDryRun,
    });
  } catch (error) {
    console.error("[manual-hedge] Failed to execute hedge:", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}

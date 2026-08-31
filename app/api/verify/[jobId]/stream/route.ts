import { eventBus, jobStore } from "@/lib/runtime";
import type { PipelineEvent } from "@/worker/pipeline";

/** Streaming needs a long-lived Node process, not the edge runtime. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL = new Set(["done", "error"]);

/**
 * Live pipeline events for one job.
 *
 * Frames already emitted are replayed first, so a client that connects after
 * the pipeline started still sees the verdicts it missed rather than an empty
 * stream. A comment heartbeat keeps proxies from closing an idle connection
 * during the long wait while the models think.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const encoder = new TextEncoder();
  const bus = eventBus();

  const job = await jobStore().get(jobId);
  if (!job) {
    return new Response(
      `event: error\ndata: ${JSON.stringify({
        error: {
          code: "VALIDATION_FAILED",
          message: `No job ${jobId}. It may have expired, or the server restarted.`,
          retryable: false,
          correlationId: jobId,
        },
      })}\n\n`,
      {
        status: 404,
        headers: { "Content-Type": "text/event-stream", "X-Correlation-Id": jobId },
      },
    );
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      // Declared before subscribing. A job that has already finished replays
      // its entire history synchronously inside subscribe(), so `finish` can
      // run before these are assigned unless they exist first.
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let unsubscribe: (() => void) | undefined;
      let expiry: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (expiry) clearTimeout(expiry);
        unsubscribe?.();
        controller.close();
      };

      const send = (ev: PipelineEvent) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`),
        );
        if (TERMINAL.has(ev.event)) finish();
      };

      // Replays history, then attaches for anything still to come.
      unsubscribe = bus.subscribe(jobId, send);
      if (closed) return;

      heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(":ka\n\n"));
      }, 15_000);

      // A pipeline that dies without a terminal frame must not hold the
      // connection open forever.
      expiry = setTimeout(finish, 5 * 60_000);
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Correlation-Id": jobId,
    },
  });
}

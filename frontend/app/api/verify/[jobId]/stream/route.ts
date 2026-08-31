import { makeJob } from "@/lib/mock-data";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = makeJob(jobId);
  const encoder = new TextEncoder();
  const frames = [
    ["status", { status: "VERIFYING", step: "layer1", modelsTotal: 3 }],
    ...job.verification!.verdicts.map((verdict) => ["verdict", verdict] as const),
    ["consensus", job.verification!.consensus],
    ["decision", job.decision],
    ["position", job.position],
    ["attestation", job.attestation],
    ["done", { status: job.status }],
  ] as const;

  return new Response(
    new ReadableStream({
      start(controller) {
        for (const [event, data] of frames) {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        }
        controller.close();
      },
    }),
    {
      headers: {
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream",
        "X-Correlation-Id": jobId,
      },
    },
  );
}

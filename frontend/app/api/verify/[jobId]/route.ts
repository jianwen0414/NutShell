import { json } from "@/lib/api";
import { makeJob } from "@/lib/mock-data";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  return json(makeJob(jobId), jobId);
}

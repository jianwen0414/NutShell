import { Navigation } from "@/components/navigation";
import { makeJob } from "@/lib/mock-data";

export default async function PositionPage({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const job = makeJob(cid);
  const agreement = Math.round((job.verification?.consensus.agreement ?? 0) * 100);

  return (
    <>
      <Navigation />
      <main className="mx-auto w-full max-w-4xl px-5 py-8">
        <h1 className="text-3xl font-semibold tracking-tight">{cid}</h1>

        <div className="mt-6 space-y-4">
          {[
            ["Alert", job.alert.rawText],
            ["Consensus", `${job.verification?.consensus.truthScore}/100 truth, ${agreement}% agreement`],
            ["Decision", `${job.decision?.tier} via ${job.decision?.mappingRule}, cap ${job.decision?.bindingCap}`],
            ["Fill", `$${job.position?.premiumPaidUsdc} premium for ${job.position?.asset} ${job.position?.strike} put`],
            ["Attestation", job.attestation?.method ?? "Pending"],
          ].map(([label, value]) => (
            <section key={label} className="rounded-lg border border-zinc-200 bg-white p-5">
              <h2 className="text-sm font-medium uppercase tracking-[0.14em] text-zinc-500">
                {label}
              </h2>
              <p className="mt-3 text-zinc-800">{value}</p>
            </section>
          ))}
        </div>
      </main>
    </>
  );
}

import { Navigation } from "@/components/navigation";
import { basescanAddressUrl, basescanTxUrl } from "@/lib/config";
import { loadRecord } from "@/lib/positions";
import { makeJob } from "@/lib/mock-data";

/**
 * PRD §13.1 — the full lifecycle for one correlation id:
 * alert → verdicts → consensus → decision with its binding cap → fill →
 * attestation, with both transaction links.
 *
 * Reads the real position store first. A correlation id with no recorded
 * position falls back to the scripted sample and says so, rather than
 * rendering a fabricated fill that looks real.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-sm font-medium uppercase tracking-[0.14em] text-zinc-500">{label}</h2>
      <div className="mt-3 text-zinc-800">{children}</div>
    </section>
  );
}

export default async function PositionPage({ params }: { params: Promise<{ cid: string }> }) {
  const { cid } = await params;
  const record = loadRecord(cid);

  if (!record) {
    // Nothing recorded under this id. Show the scripted sample, clearly badged.
    const job = makeJob(cid);
    const agreement = Math.round((job.verification?.consensus.agreement ?? 0) * 100);
    return (
      <>
        <Navigation />
        <main className="mx-auto w-full max-w-4xl px-5 py-8">
          <h1 className="text-3xl font-semibold tracking-tight">{cid}</h1>
          <p className="mt-2 inline-block rounded bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
            Scripted sample — no position is recorded under this correlation id
          </p>
          <div className="mt-6 space-y-4">
            <Row label="Alert">{job.alert.rawText}</Row>
            <Row label="Consensus">
              {job.verification?.consensus.truthScore}/100 truth, {agreement}% agreement
            </Row>
            <Row label="Decision">
              {job.decision?.tier} via {job.decision?.mappingRule}, cap {job.decision?.bindingCap}
            </Row>
          </div>
        </main>
      </>
    );
  }

  const p = record.position;
  const a = record.attestation;
  const plan = p.execution;
  const order = plan?.selectedOrder;
  const settlement = plan?.settlement;
  const expired = Date.parse(p.expiry) <= Date.now();

  return (
    <>
      <Navigation />
      <main className="mx-auto w-full max-w-4xl px-5 py-8">
        <h1 className="text-3xl font-semibold tracking-tight">
          {p.asset} ${p.strike} put
        </h1>
        <p className="mt-1 font-mono text-sm text-zinc-500">{p.correlationId}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
          <span className="rounded bg-zinc-900 px-2 py-1 text-white">{p.status}</span>
          {p.wasDryRun && (
            <span className="rounded bg-amber-100 px-2 py-1 text-amber-900">
              Dry run — nothing was signed
            </span>
          )}
          {!p.wasDryRun && (
            <span className="rounded bg-emerald-100 px-2 py-1 text-emerald-900">
              Real fill on Base mainnet
            </span>
          )}
        </div>

        <div className="mt-6 space-y-4">
          <Row label="Instrument">
            {p.contracts} contracts of a cash-settled {p.asset} ${p.strike} put, expiring{" "}
            {new Date(p.expiry).toISOString()}
            {expired ? " (expired)" : ""}.
            {order && (
              <div className="mt-2 text-sm text-zinc-600">
                Identified as {order.asset} from price feed{" "}
                <span className="font-mono text-xs">{order.priceFeed}</span> — not from
                underlyingToken, which is{" "}
                <span className="font-mono text-xs">{order.underlyingToken}</span>.
                Implementation {order.implementationName}. Strike sits{" "}
                {(order.strikeDeviationPct * 100).toFixed(2)}% from the ${order.spotAtDecode} spot
                at decode.
              </div>
            )}
          </Row>

          <Row label="Economics">
            <div className="grid gap-1 sm:grid-cols-2">
              <div>Premium paid: ${p.premiumPaidUsdc}</div>
              <div>Cover: ${p.notionalProtectedUsdc}</div>
              <div>Spot at entry: ${p.spotAtEntry}</div>
              <div>Delta at entry: {p.deltaAtEntry}</div>
              {plan?.onChain && (
                <div>
                  Protocol fee: {Number(plan.onChain.feeCollectedRaw) / 1e6} USDC (
                  {(
                    (Number(plan.onChain.feeCollectedRaw) / Number(plan.onChain.premiumPaidRaw)) *
                    100
                  ).toFixed(1)}
                  % of premium)
                </div>
              )}
              {p.realisedPnlUsdc && <div>Realised PnL: {p.realisedPnlUsdc} USDC</div>}
            </div>
          </Row>

          {plan && (
            <Row label="Execution">
              <div className="grid gap-1 text-sm sm:grid-cols-2">
                <div>Selection attempts: {plan.selectionAttempts}</div>
                <div>Quote TTL at build: {plan.ttlAtBuildSeconds}s</div>
                <div>Built in: {plan.buildLatencyMs}ms</div>
                <div>
                  Approval: exactly {plan.approvalAmountRaw} raw — never MaxUint256
                </div>
              </div>
              {plan.warnings.length > 0 && (
                <ul className="mt-3 space-y-1 text-sm text-zinc-600">
                  {plan.warnings.map((w, i) => (
                    <li key={i}>· {w}</li>
                  ))}
                </ul>
              )}
            </Row>
          )}

          {settlement && (
            <Row label="Settlement">
              Settled at ${settlement.settlementPrice} against the ${p.strike} strike —{" "}
              {settlement.inTheMoney ? "in the money" : "out of the money"}. Payout owed{" "}
              {settlement.payoutOwed} USDC; recovered {settlement.recovered} USDC.
              {!settlement.transactionRequired &&
                " Settlement is automatic on this venue, so no transaction and no gas were required."}
            </Row>
          )}

          <Row label="Transactions">
            <div className="space-y-1 text-sm">
              {p.approvalTxHash && (
                <div>
                  Approval:{" "}
                  <a className="underline" href={basescanTxUrl(p.approvalTxHash)} target="_blank" rel="noreferrer">
                    {p.approvalTxHash}
                  </a>
                </div>
              )}
              {p.entryTxHash && p.entryTxHash !== "0x" ? (
                <div>
                  Fill:{" "}
                  <a className="underline" href={basescanTxUrl(p.entryTxHash)} target="_blank" rel="noreferrer">
                    {p.entryTxHash}
                  </a>
                </div>
              ) : (
                <div>Fill: none — this was a rehearsal and nothing was signed.</div>
              )}
              {p.optionAddress && (
                <div>
                  Option contract:{" "}
                  <a className="underline" href={basescanAddressUrl(p.optionAddress)} target="_blank" rel="noreferrer">
                    {p.optionAddress}
                  </a>
                </div>
              )}
              {p.exitTxHash && (
                <div>
                  Exit:{" "}
                  <a className="underline" href={basescanTxUrl(p.exitTxHash)} target="_blank" rel="noreferrer">
                    {p.exitTxHash}
                  </a>
                </div>
              )}
            </div>
          </Row>

          <Row label="Attestation">
            {a ? (
              <div className="space-y-2 text-sm">
                <div>Method: {a.method}</div>
                {a.canonicalLine && (
                  <pre className="overflow-x-auto rounded bg-zinc-50 p-3 font-mono text-xs">
                    {a.canonicalLine}
                  </pre>
                )}
                <div>Truth {a.payload.truthScore}/100 · agreement {Math.round(a.payload.agreement * 100)}% · severity {a.payload.severity}</div>
                {a.payload.gonkaRequestIds.length > 0 && (
                  <div className="font-mono text-xs">
                    Gonka request IDs: {a.payload.gonkaRequestIds.join(", ")}
                  </div>
                )}
                {a.txHash && (
                  <div>
                    On-chain:{" "}
                    <a className="underline" href={basescanTxUrl(a.txHash)} target="_blank" rel="noreferrer">
                      {a.txHash}
                    </a>
                  </div>
                )}
              </div>
            ) : (
              "No attestation recorded for this position."
            )}
          </Row>
        </div>
      </main>
    </>
  );
}

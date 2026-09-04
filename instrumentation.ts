/**
 * Server startup.
 *
 * Next.js calls `register` once when the server boots, in the Node runtime
 * only. It is the one place the ingestion loop can be started without a route
 * having to be hit first, which is what makes "continuous monitoring" true
 * rather than aspirational.
 *
 * Off by default. A loop that fetches eight feeds and may start verification
 * jobs should not begin because somebody ran the dev server, so it takes an
 * explicit INGEST_AUTOSTART=true. The operator can always start it by hand
 * through POST /api/ingest.
 */
export async function register() {
  // The edge runtime has no timers worth the name and no filesystem, and this
  // module is loaded in both. Only the Node server should hold the loop.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // A worked day of traffic, laid down before the poller starts so every
  // surface has something on it from the first request. Real triage decides
  // each item; nothing here fabricates a transaction. Off with DEMO_SEED=false.
  if (process.env.DEMO_SEED !== "false") {
    try {
      const { seedDemoCorpus } = await import("./lib/demo-seed");
      const { items, worked } = await seedDemoCorpus();
      if (items > 0) {
        console.info(`[seed] ${items} headlines laid down, ${worked} worked through to a decision.`);
      }

      // Positions opened by an operator script have no job behind them, so
      // their incident record would show a real fill above five empty stages.
      const { seedPositionRecords } = await import("./lib/position-records");
      const rebuilt = await seedPositionRecords();
      if (rebuilt > 0) {
        console.info(`[seed] ${rebuilt} stored position(s) given their reasoning chain.`);
      }
    } catch (e) {
      // Seeding is a convenience. It must never stop the server booting.
      console.error("[seed] could not seed the demo corpus:", e);
    }
  }

  if (process.env.INGEST_AUTOSTART !== "true") {
    console.info(
      "[ingest] autostart is off. Set INGEST_AUTOSTART=true, or POST /api/ingest to start it by hand.",
    );
    return;
  }

  // Imported here rather than at module scope so the edge build never pulls
  // in the poller and everything it reaches.
  const { startPolling } = await import("./lib/ingest");
  const { started, intervalMs } = startPolling();

  console.info(
    started
      ? `[ingest] polling every ${Math.round(intervalMs / 1000)}s. The first pass records without verifying.`
      : "[ingest] already polling.",
  );
}

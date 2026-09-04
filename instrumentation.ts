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

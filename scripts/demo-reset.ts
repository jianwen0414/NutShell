/**
 * Make the screened headlines runnable again, between demo takes.
 *
 * A headline can only be sent through the pipeline once — after that the row
 * carries its verdict and the "Run the pipeline on this" button is gone. That
 * is right for the product and wrong for rehearsing, where the same beat has
 * to work on the third take as well as the first.
 *
 * So this detaches the pointer from the job. It does not delete anything: each
 * verification stays where it was, reachable at /incident/<jobId>, and this
 * prints the ids so you can still open them.
 *
 * By default it leaves the seeded corpus alone, because those three carry the
 * HEDGED and WATCHED badges the funnel beat is built around — resetting them
 * empties the page of outcomes. Pass --all to include them.
 *
 *   npx tsx scripts/demo-reset.ts
 *   npx tsx scripts/demo-reset.ts --all
 *   npx tsx scripts/demo-reset.ts --base http://localhost:3000
 */
import { loadEnv } from "../lib/env";

loadEnv();

const args = process.argv.slice(2);
const flag = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const BASE = flag("base") ?? "http://localhost:3000";
const includeSeeded = args.includes("--all");
const TOKEN = process.env.OPERATOR_TOKEN ?? "";

interface EventRow {
  id: string;
  title: string;
  kept: boolean;
  jobId: string | null;
  outcome: { tier: string; truthScore: number } | null;
}

async function main() {
  if (!TOKEN) throw new Error("OPERATOR_TOKEN is not set");

  const res = await fetch(`${BASE}/api/events?kept=true&limit=60`);
  if (!res.ok) throw new Error(`GET /api/events failed: ${res.status}`);
  const rows: EventRow[] = await res.json();

  const candidates = rows.filter(
    (r) => r.jobId && (includeSeeded || !r.id.startsWith("seed-")),
  );

  if (candidates.length === 0) {
    console.log("Nothing to reset — every kept headline is already runnable.");
    return;
  }

  for (const row of candidates) {
    const r = await fetch(`${BASE}/api/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ action: "reset", id: row.id }),
    });
    const body = await r.json();
    if (!r.ok) {
      console.error(`  ✗ ${row.title.slice(0, 50)} — ${body?.error?.message ?? r.status}`);
      continue;
    }
    console.log(
      `  ✓ ${row.title.slice(0, 50)}\n    was ${row.outcome?.tier ?? "running"}, record kept at /incident/${body.detachedFrom}`,
    );
  }

  console.log(
    `\n${candidates.length} headline(s) runnable again.` +
      (includeSeeded ? "" : "  Seeded rows left alone; pass --all to include them."),
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

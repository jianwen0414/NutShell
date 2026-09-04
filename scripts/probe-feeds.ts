/**
 * What stage 01 would do with the news, right now.
 *
 *   npm run probe:feeds
 *   npm run probe:feeds -- --all      show every rejection, not just near misses
 *
 * Fetches the live feeds, runs triage over them, and prints what survives and
 * why the rest did not. No inference, no chain calls, nothing is verified: this
 * is the filter alone, so it costs nothing to run repeatedly while tuning it.
 *
 * Run it before a demo. A kept count of zero is the normal result on a calm
 * day and is not a failure, but it does tell you the live feed will not
 * produce a hedge on its own and the injected scenario is carrying the demo.
 */
import { fetchAllFeeds } from '../lib/feeds';
import { triageAll } from '../lib/triage';
import { loadEnv } from '../lib/env';

loadEnv();

const showAll = process.argv.includes('--all');
const line = () => console.log('─'.repeat(76));

async function main() {
  const started = Date.now();
  const { items, results } = await fetchAllFeeds();

  line();
  console.log('Feeds');
  line();
  for (const r of results) {
    const status = r.error ? `FAILED  ${r.error}` : `${String(r.items.length).padStart(3)} items`;
    console.log(`  ${r.source.name.padEnd(16)} ${String(r.latencyMs).padStart(5)}ms  ${status}`);
  }

  const triaged = triageAll(items);
  const kept = triaged.filter((t) => t.verdict.keep);
  const rejected = triaged.filter((t) => !t.verdict.keep);

  line();
  console.log(`Kept ${kept.length} of ${items.length}`);
  line();
  if (kept.length === 0) {
    console.log('  Nothing. On a calm day this is the right answer.');
  }
  for (const { item, verdict } of kept) {
    console.log(`  ${item.title}`);
    console.log(`    ${item.sourceName} · ${item.publishedAt}`);
    console.log(`    ${verdict.reason}`);
    console.log(`    ${item.url}`);
    console.log();
  }

  // Grouped so a gate that is rejecting everything is obvious at a glance.
  const buckets = new Map<string, number>();
  for (const { verdict } of rejected) {
    const key = verdict.reason
      .replace(/\(".*?"\)/, '(...)')
      .replace(/Published \d+h ago[^.]*\./, 'Older than the freshness window.')
      .replace(/Reports [^;]+;.*/, 'Kept.');
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  line();
  console.log('Rejected, by gate');
  line();
  for (const [reason, n] of [...buckets].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${reason}`);
  }

  // Items carrying threat vocabulary that still did not make it. This is where
  // a filter that is too aggressive shows up, so it is worth reading each time.
  const near = rejected.filter((r) => r.verdict.matched.length > 0);
  line();
  console.log(`Near misses (${near.length}) — threat words present, still dropped`);
  line();
  for (const { item, verdict } of showAll ? near : near.slice(0, 10)) {
    console.log(`  ${item.title.slice(0, 70)}`);
    console.log(`    ${verdict.reason}`);
  }
  if (!showAll && near.length > 10) {
    console.log(`  ... ${near.length - 10} more, pass --all to see them`);
  }

  line();
  console.log(`${((Date.now() - started) / 1000).toFixed(1)}s`);
  line();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

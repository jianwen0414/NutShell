/**
 * Which jobs are recoverable from the archive?
 *
 * Lists the correlation ids that carry a persisted verification, so a restored
 * incident record can be checked against a real row rather than a guess.
 *
 *   npx tsx scripts/diag-archived.ts
 */
import { loadEnv } from '../lib/env';
import { getDbPool, loadJobFromDb } from '../lib/postgres';

loadEnv();

async function main() {
  const pool = getDbPool();
  if (!pool) {
    console.log('no DATABASE_URL configured');
    return;
  }

  const rows = await pool.query(
    `SELECT a.id, a.status, v.truth_score, v.models_responded, d.tier
       FROM alerts a
       LEFT JOIN verifications v ON v.correlation_id = a.id
       LEFT JOIN decisions   d ON d.correlation_id = a.id
      WHERE v.truth_score IS NOT NULL
      ORDER BY a.received_at DESC
      LIMIT 5`,
  );

  console.log('\n═══ RESTORABLE FROM THE ARCHIVE ═══');
  for (const r of rows.rows) {
    console.log(
      `  ${r.id}  ${String(r.status).padEnd(10)} truth ${String(r.truth_score).padEnd(6)} panel ${r.models_responded}  ${r.tier ?? '-'}`,
    );
  }

  const first = rows.rows[0];
  if (first) {
    console.log('\n═══ ROUND TRIP THROUGH loadJobFromDb ═══');
    const job = await loadJobFromDb(first.id);
    if (!job) {
      console.log('  restore returned null');
    } else {
      console.log(`  jobId       ${job.jobId}`);
      console.log(`  status      ${job.status}`);
      console.log(`  claim       ${job.alert.rawText.slice(0, 70)}…`);
      console.log(`  verdicts    ${job.verification?.verdicts.length ?? 0}`);
      for (const v of job.verification?.verdicts ?? []) {
        console.log(
          `    ${v.modelId.split('/').pop()?.padEnd(24)} ${v.claimScore} ${v.stance}  req ${v.gonkaRequestId}`,
        );
      }
      const c = job.verification?.consensus;
      if (c) console.log(`  consensus   truth ${c.truthScore} agreement ${c.agreement} panel ${c.modelsResponded}`);
      console.log(`  decision    ${job.decision?.tier ?? '-'} ${job.decision?.targetSizeUsdc ?? ''} cap ${job.decision?.bindingCap ?? '-'}`);
      console.log(`  evidence    ${job.evidenceUnavailable ? 'not stored by any table (expected)' : 'present'}`);
    }
  }

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

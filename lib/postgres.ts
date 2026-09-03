/**
 * PostgreSQL / Supabase Database Persistence Client
 *
 * Implements persistent recording of all pipeline events:
 * - alerts
 * - verifications
 * - model_verdicts
 * - decisions
 * - positions
 *
 * Backed by DATABASE_URL from .env with connection pooling.
 */

import { Pool, PoolConfig } from "pg";
import type { Job } from "@/worker/pipeline";

declare global {
  // eslint-disable-next-line no-var
  var __nutshell_pg_pool: Pool | undefined;
}

export function getDbPool(): Pool | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    return null;
  }

  if (!globalThis.__nutshell_pg_pool) {
    const config: PoolConfig = {
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    };

    // Supabase requires SSL for external connections
    if (!connectionString.includes("localhost") && !connectionString.includes("127.0.0.1")) {
      config.ssl = { rejectUnauthorized: false };
    }

    const pool = new Pool(config);

    pool.on("error", (err) => {
      console.error("[postgres] Unexpected error on idle client:", err);
    });

    globalThis.__nutshell_pg_pool = pool;
  }

  return globalThis.__nutshell_pg_pool;
}

/**
 * Persists a completed Job record to Supabase PostgreSQL.
 * Designed to never throw or disrupt the pipeline if the database is unreachable.
 */
export async function persistJobToDb(job: Job): Promise<boolean> {
  const pool = getDbPool();
  if (!pool) {
    return false;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Ingested Alert
    const alert = job.alert;
    await client.query(
      `INSERT INTO alerts (id, source, raw_text, source_url, cluster_key, status, metadata, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         metadata = EXCLUDED.metadata;`,
      [
        job.jobId,
        alert.source,
        alert.rawText,
        alert.sourceUrl ?? null,
        alert.clusterKey,
        job.status,
        JSON.stringify(alert.metadata ?? {}),
        alert.receivedAt,
      ],
    );

    // 2. Verification Consensus
    const ver = job.verification;
    if (ver && ver.consensus) {
      await client.query(
        `INSERT INTO verifications (
           correlation_id, truth_score, severity, agreement, spread, concordance,
           conviction, models_responded, debate_triggered, reasoning_trace,
           gonka_request_ids, id_chain_resolvable, total_latency_ms, verified_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         ON CONFLICT (correlation_id) DO UPDATE SET
           truth_score = EXCLUDED.truth_score,
           severity = EXCLUDED.severity,
           agreement = EXCLUDED.agreement,
           spread = EXCLUDED.spread,
           concordance = EXCLUDED.concordance,
           conviction = EXCLUDED.conviction,
           models_responded = EXCLUDED.models_responded,
           reasoning_trace = EXCLUDED.reasoning_trace;`,
        [
          job.jobId,
          ver.consensus.truthScore,
          ver.consensus.severity,
          ver.consensus.agreement,
          ver.consensus.spread,
          ver.consensus.concordance,
          ver.consensus.conviction,
          ver.consensus.modelsResponded,
          ver.consensus.debateTriggered ?? false,
          JSON.stringify(ver.reasoningTrace ?? []),
          JSON.stringify(ver.gonkaRequestIds ?? []),
          ver.idChainResolvable ?? false,
          ver.totalLatencyMs ?? 0,
          ver.verifiedAt,
        ],
      );

      // 3. Individual Model Verdicts
      if (ver.verdicts && ver.verdicts.length > 0) {
        // Clear previous verdicts for this correlationId to allow clean idempotency
        await client.query(`DELETE FROM model_verdicts WHERE correlation_id = $1`, [job.jobId]);

        for (const v of ver.verdicts) {
          await client.query(
            `INSERT INTO model_verdicts (
               correlation_id, model_id, role, claim_score, severity, stance,
               key_evidence, red_flags, gonka_request_id, response_hash, latency_ms, parse_repaired
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [
              job.jobId,
              v.modelId,
              v.role,
              v.claimScore,
              v.severity,
              v.stance,
              JSON.stringify(v.keyEvidence ?? []),
              JSON.stringify(v.redFlags ?? []),
              v.gonkaRequestId,
              v.responseHash,
              v.latencyMs ?? 0,
              v.parseRepaired ?? false,
            ],
          );
        }
      }
    }

    // 4. Policy Decision
    const dec = job.decision;
    if (dec) {
      await client.query(
        `INSERT INTO decisions (
           correlation_id, tier, reason, target_asset, mapping_rule,
           target_size_usdc, binding_cap, decided_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (correlation_id) DO UPDATE SET
           tier = EXCLUDED.tier,
           reason = EXCLUDED.reason,
           target_asset = EXCLUDED.target_asset,
           target_size_usdc = EXCLUDED.target_size_usdc,
           binding_cap = EXCLUDED.binding_cap;`,
        [
          job.jobId,
          dec.tier,
          dec.reason,
          dec.targetAsset,
          dec.mappingRule,
          dec.targetSizeUsdc,
          dec.bindingCap,
          dec.decidedAt,
        ],
      );
    }

    // 5. Option Positions (if executed)
    const pos = job.position;
    if (pos) {
      await client.query(
        `INSERT INTO positions (
           correlation_id, status, asset, strike, expiry, contracts,
           premium_paid_usdc, notional_protected_usdc, entry_tx_hash,
           spot_at_entry, delta_at_entry, was_dry_run, opened_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (correlation_id) DO UPDATE SET
           status = EXCLUDED.status,
           entry_tx_hash = EXCLUDED.entry_tx_hash;`,
        [
          job.jobId,
          pos.status,
          pos.asset,
          pos.strike,
          pos.expiry,
          pos.contracts,
          pos.premiumPaidUsdc,
          pos.notionalProtectedUsdc,
          pos.entryTxHash,
          pos.spotAtEntry ?? 0,
          pos.deltaAtEntry ?? 0,
          pos.wasDryRun ?? false,
          pos.openedAt,
        ],
      );
    }

    // 6. Attestations (if attested)
    const att = job.attestation;
    if (att) {
      await client.query(
        `INSERT INTO attestations (correlation_id, method, tx_hash, payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (correlation_id) DO UPDATE SET
           tx_hash = EXCLUDED.tx_hash,
           payload = EXCLUDED.payload;`,
        [job.jobId, att.method, att.txHash ?? null, JSON.stringify(att.payload ?? {})],
      );
    }

    await client.query("COMMIT");
    console.info(`[postgres] Successfully persisted job ${job.jobId} to database.`);
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`[postgres] Failed to persist job ${job.jobId}:`, err);
    return false;
  } finally {
    client.release();
  }
}

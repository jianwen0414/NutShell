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
import type {
  Attestation,
  ConsensusMetrics,
  HedgeDecision,
  HedgePosition,
  JobStatus,
  ModelVerdict,
  VerificationResult,
} from "@/types";
import { basescanTxUrl } from "./config";
import { chainUrlForShard, parseShardId } from "./gonka";

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

// ── Reading it back ────────────────────────────────────────────────────────

/**
 * Everything written above, in the shape the UI already renders.
 *
 * The archive was write-only: six INSERTs, no SELECT anywhere. So a job that
 * had scrolled out of the in-memory store — or that predated a server restart —
 * rendered with its verdicts and consensus blank on `/incident/[id]`, while
 * the rows sat intact in Supabase. This is the read path that closes that.
 *
 * 🔒 One honest gap, and it is structural rather than an oversight here: there
 * is no evidence table. Stage 02's packet is never persisted by
 * `persistJobToDb`, so a job restored from the database carries no on-chain
 * checks and the incident page says the stage was not recorded rather than
 * implying it found nothing. Those are different claims and the UI must not
 * conflate them.
 */
export interface RestoredJob {
  jobId: string;
  status: JobStatus;
  alert: {
    id: string;
    source: unknown;
    rawText: string;
    sourceUrl?: string;
    clusterKey: string;
    receivedAt: string;
    metadata?: Record<string, string>;
  };
  verification?: VerificationResult;
  decision?: HedgeDecision;
  position?: HedgePosition;
  attestation?: Attestation;
  /** Always true. Lets a caller label the record as reconstructed. */
  restoredFromDb: true;
  /** Stage 02 is not persisted by any schema, so it can never be restored. */
  evidenceUnavailable: true;
}

/** `jsonb` arrives parsed on some drivers and as text on others. */
function asJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

/** `numeric` comes back as a string from pg; every score here is a number. */
const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** numeric(x,6) reads back as "0.000000"; trim to how the app writes money. */
function trimDecimal(v: unknown): string {
  const raw = String(v ?? "0");
  if (!raw.includes(".")) return raw;
  const trimmed = raw.replace(/0+$/, "").replace(/.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}

const iso = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : typeof v === "string" ? v : new Date(0).toISOString();

/**
 * Reconstruct one job from the archive.
 *
 * Returns null when there is no database configured or no alert row, so a
 * caller can fall through to whatever it would otherwise have shown. Never
 * throws: a page that renders from memory must not fail because Supabase is
 * unreachable.
 */
export async function loadJobFromDb(jobId: string): Promise<RestoredJob | null> {
  const pool = getDbPool();
  if (!pool) return null;

  try {
    // 🔒 pool.query, not a checked-out client. A pg Client executes one query
    // at a time — issuing six concurrently on a single client is deprecated in
    // pg 8 and removed in 9, and the responses can interleave. The pool hands
    // each query its own client, which is what makes Promise.all correct here.
    // There is no transaction to hold, so nothing is lost by not checking one
    // out; these are six independent reads of an append-only archive.
    const [alerts, vers, verdicts, decisions, positions, attestations] = await Promise.all([
      pool.query(`SELECT * FROM alerts WHERE id = $1 LIMIT 1`, [jobId]),
      pool.query(`SELECT * FROM verifications WHERE correlation_id = $1 LIMIT 1`, [jobId]),
      pool.query(
        `SELECT * FROM model_verdicts WHERE correlation_id = $1 ORDER BY claim_score DESC`,
        [jobId],
      ),
      pool.query(`SELECT * FROM decisions WHERE correlation_id = $1 LIMIT 1`, [jobId]),
      pool.query(`SELECT * FROM positions WHERE correlation_id = $1 LIMIT 1`, [jobId]),
      pool.query(`SELECT * FROM attestations WHERE correlation_id = $1 LIMIT 1`, [jobId]),
    ]);

    const a = alerts.rows[0];
    if (!a) return null;

    const restored: RestoredJob = {
      jobId,
      status: (a.status as JobStatus) ?? "VERIFIED",
      alert: {
        id: jobId,
        // Written as either a bare string or the structured source object,
        // depending on which path raised the alert. Both are handed back as
        // they were stored; the UI already accepts either.
        source: asJson<unknown>(a.source, a.source),
        rawText: a.raw_text ?? "",
        ...(a.source_url ? { sourceUrl: a.source_url as string } : {}),
        clusterKey: a.cluster_key ?? "",
        receivedAt: iso(a.received_at),
        metadata: asJson<Record<string, string>>(a.metadata, {}),
      },
      restoredFromDb: true,
      evidenceUnavailable: true,
    };

    const v = vers.rows[0];
    if (v) {
      const consensus: ConsensusMetrics = {
        truthScore: num(v.truth_score),
        severity: (num(v.severity, 3) || 3) as ConsensusMetrics["severity"],
        agreement: num(v.agreement),
        spread: num(v.spread),
        concordance: num(v.concordance),
        conviction: num(v.conviction),
        debateTriggered: Boolean(v.debate_triggered),
        modelsResponded: num(v.models_responded),
      };

      const models: ModelVerdict[] = verdicts.rows.map((r) => {
        const requestId = r.gonka_request_id ?? "";
        // No column holds the chain link, and none needs to: the shard id is
        // carried inside the request id, and `parseShardId` derives it the
        // same way the live call path does. Without this a restored verdict
        // rendered its request id as plain text — the card falls back to
        // "auditable request reference" when `chainUrl` is absent — so a
        // restart quietly downgraded the one thing PRD §13.2 asks to be
        // presented as an on-chain record. Same id, same derivation, so the
        // restored link is the link the live run showed.
        const shardId = parseShardId(requestId);
        return {
          modelId: r.model_id,
          role: r.role,
          claimScore: num(r.claim_score),
          severity: (num(r.severity, 3) || 3) as ModelVerdict["severity"],
          stance: r.stance,
          keyEvidence: asJson<string[]>(r.key_evidence, []),
          redFlags: asJson<string[]>(r.red_flags, []),
          gonkaRequestId: requestId,
          ...(shardId !== undefined
            ? { chainShardId: shardId, chainUrl: chainUrlForShard(shardId) }
            : {}),
          responseHash: r.response_hash ?? "",
          latencyMs: num(r.latency_ms),
          parseRepaired: Boolean(r.parse_repaired),
        };
      });

      restored.verification = {
        correlationId: jobId,
        alertId: jobId,
        verdicts: models,
        consensus,
        reasoningTrace: asJson<string[]>(v.reasoning_trace, []),
        gonkaRequestIds: asJson<string[]>(v.gonka_request_ids, []),
        idChainResolvable: Boolean(v.id_chain_resolvable),
        verifiedAt: iso(v.verified_at),
        totalLatencyMs: num(v.total_latency_ms),
      };
    }

    const d = decisions.rows[0];
    if (d) {
      restored.decision = {
        correlationId: jobId,
        tier: d.tier,
        reason: d.reason ?? "",
        targetAsset: d.target_asset ?? "",
        mappingRule: d.mapping_rule,
        // numeric(x,6) reads back as "0.000000"; every other money string in
        // the app is trimmed, so match them rather than leaking the column type.
        targetSizeUsdc: trimDecimal(d.target_size_usdc),
        bindingCap: d.binding_cap,
        decidedAt: iso(d.decided_at),
      };
    }

    const p = positions.rows[0];
    if (p) {
      restored.position = {
        correlationId: jobId,
        status: p.status,
        asset: p.asset,
        strike: String(p.strike),
        expiry: iso(p.expiry),
        contracts: String(p.contracts),
        premiumPaidUsdc: String(p.premium_paid_usdc),
        notionalProtectedUsdc: String(p.notional_protected_usdc),
        entryTxHash: p.entry_tx_hash,
        // Not a stored column — derived from the hash, so the link is right
        // whichever explorer the config points at.
        baseScanUrl: p.entry_tx_hash ? basescanTxUrl(p.entry_tx_hash) : "",
        spotAtEntry: String(p.spot_at_entry ?? "0"),
        deltaAtEntry: num(p.delta_at_entry),
        openedAt: iso(p.opened_at),
        wasDryRun: Boolean(p.was_dry_run),
      } as HedgePosition;
    }

    const at = attestations.rows[0];
    if (at) {
      restored.attestation = {
        correlationId: jobId,
        method: at.method,
        ...(at.tx_hash ? { txHash: at.tx_hash, baseScanUrl: basescanTxUrl(at.tx_hash) } : {}),
        payload: asJson(at.payload, {}),
        createdAt: iso(at.created_at ?? a.received_at),
      } as Attestation;
    }

    return restored;
  } catch (e) {
    console.error(`[postgres] could not restore job ${jobId}:`, e);
    return null;
  }
}

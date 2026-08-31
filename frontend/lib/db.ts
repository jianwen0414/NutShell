/**
 * Database Schema and Setup (PRD §8)
 * Single source of truth for all persisted pipeline states.
 */

export const schemaSql = `
-- 1. Ingested Alerts
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  source_url TEXT,
  cluster_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED',
  metadata JSONB,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Multi-Model Verification Consensus
CREATE TABLE IF NOT EXISTS verifications (
  correlation_id TEXT PRIMARY KEY REFERENCES alerts(id),
  truth_score NUMERIC(5,2) NOT NULL,
  severity SMALLINT NOT NULL,
  agreement NUMERIC(4,3) NOT NULL,
  spread NUMERIC(5,2) NOT NULL,
  concordance NUMERIC(4,3) NOT NULL,
  conviction NUMERIC(4,3) NOT NULL,
  models_responded SMALLINT NOT NULL,
  debate_triggered BOOLEAN NOT NULL DEFAULT false,
  reasoning_trace JSONB NOT NULL,
  gonka_request_ids JSONB NOT NULL,
  id_chain_resolvable BOOLEAN NOT NULL DEFAULT false,
  total_latency_ms INTEGER NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Individual Model Verdicts
CREATE TABLE IF NOT EXISTS model_verdicts (
  id BIGSERIAL PRIMARY KEY,
  correlation_id TEXT NOT NULL REFERENCES alerts(id),
  model_id TEXT NOT NULL,
  role TEXT NOT NULL,
  claim_score NUMERIC(5,2) NOT NULL,
  severity SMALLINT NOT NULL,
  stance TEXT NOT NULL,
  key_evidence JSONB NOT NULL,
  red_flags JSONB NOT NULL,
  gonka_request_id TEXT NOT NULL,
  response_hash TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  parse_repaired BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_model_verdicts_cid ON model_verdicts (correlation_id);

-- 4. Policy Decisions
CREATE TABLE IF NOT EXISTS decisions (
  correlation_id TEXT PRIMARY KEY REFERENCES alerts(id),
  tier TEXT NOT NULL,
  reason TEXT NOT NULL,
  target_asset TEXT NOT NULL,
  mapping_rule TEXT NOT NULL,
  target_size_usdc NUMERIC(20,6) NOT NULL,
  binding_cap TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Open & Historical Option Positions
CREATE TABLE IF NOT EXISTS positions (
  correlation_id TEXT PRIMARY KEY REFERENCES alerts(id),
  status TEXT NOT NULL,
  asset TEXT NOT NULL,
  strike NUMERIC(30,8) NOT NULL,
  expiry TIMESTAMPTZ NOT NULL,
  contracts NUMERIC(40,18) NOT NULL,
  premium_paid_usdc NUMERIC(20,6) NOT NULL,
  notional_protected_usdc NUMERIC(20,6) NOT NULL,
  entry_tx_hash TEXT NOT NULL,
  exit_tx_hash TEXT,
  spot_at_entry NUMERIC(30,8) NOT NULL,
  delta_at_entry NUMERIC(6,4) NOT NULL,
  realised_pnl_usdc NUMERIC(20,6),
  was_dry_run BOOLEAN NOT NULL DEFAULT false,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions (status, asset);

-- 6. Self-Transaction Attestations
CREATE TABLE IF NOT EXISTS attestations (
  correlation_id TEXT PRIMARY KEY REFERENCES alerts(id),
  method TEXT NOT NULL,
  tx_hash TEXT,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. Vault Accounting Ledger (Derived State)
CREATE TABLE IF NOT EXISTS vault_ledger (
  id BIGSERIAL PRIMARY KEY,
  entry_type TEXT NOT NULL, -- YIELD_ACCRUAL | PREMIUM_SPEND | PREMIUM_RECOVERY | HARVEST
  amount_usdc NUMERIC(20,6) NOT NULL,
  correlation_id TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vault_ledger_time ON vault_ledger (created_at DESC);

-- 8. Idempotency Key Guard
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

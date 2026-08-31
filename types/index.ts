// Shared contracts. Every module reads and writes these shapes, so renaming
// or repurposing a field breaks somebody else. Adding fields is safe.
// All money is a decimal string. No bigint crosses a JSON boundary.

// ─── Primitives ────────────────────────────────────────────────────────────
export type ISO8601        = string;
export type UsdcAmount     = string;              // "2.15", max 6dp
export type UsdPrice       = string;              // "2443.00", max 8dp
export type Address        = `0x${string}`;
export type TxHash         = `0x${string}`;
export type CorrelationId  = string;              // "nsh_" + 16 hex

export type JobStatus =
  | 'QUEUED' | 'VERIFYING' | 'VERIFIED' | 'DECIDED'
  | 'SELECTING' | 'EXECUTING' | 'EXECUTED'
  | 'ATTESTED' | 'REJECTED' | 'FAILED';

// ─── Alerts ────────────────────────────────────────────────────────────────
export type AlertSource = 'SIMULATOR' | 'USER_PASTE' | 'WEBHOOK' | 'MANUAL';

export interface AlertEvent {
  id: CorrelationId;
  source: AlertSource;
  rawText: string;
  sourceUrl?: string;
  sourceUrlFetched?: boolean;
  receivedAt: ISO8601;
  clusterKey: string;                 // dedupe key
  metadata?: Record<string, string>;
}

// ─── Verification ──────────────────────────────────────────────────────────
export type Stance = 'REAL' | 'FAKE' | 'UNCERTAIN';
export type ModelRole = 'ANALYST' | 'PROSECUTOR' | 'SKEPTIC' | 'JUDGE' | 'SYNTHESIZER';

export interface ModelVerdict {
  modelId: string;                    // resolved at runtime
  role: ModelRole;
  claimScore: number;                 // 0–100
  severity: 1 | 2 | 3 | 4 | 5;
  stance: Stance;
  keyEvidence: string[];
  redFlags: string[];
  gonkaRequestId: string;             // "devshard-<escrowId>-<nonce>"
  /** On-chain DevshardEscrow id parsed from gonkaRequestId. Resolvable. */
  chainShardId?: number;
  /** Public chain URL for that escrow record. */
  chainUrl?: string;
  responseHash: string;               // sha256 of raw body
  latencyMs: number;
  parseRepaired: boolean;             // true if JSON needed repair
}

export interface ConsensusMetrics {
  truthScore: number;                 // 0–100, mean of layer-1 claimScores
  severity: 1 | 2 | 3 | 4 | 5;        // median
  agreement: number;                  // 0–1
  spread: number;                     // max − min claimScore
  concordance: number;                // fraction sharing modal stance
  conviction: number;                 // (truthScore/100) × agreement
  debateTriggered: boolean;
  modelsResponded: number;
}

/** Why a model produced no usable vote. Additive permits new fields. */
export interface VoteFailure {
  modelId: string;
  code: Extract<
    ErrorCode,
    'GONKA_TIMEOUT' | 'GONKA_UNAVAILABLE' | 'GONKA_MALFORMED_JSON' | 'RATE_LIMITED'
  >;
  detail: string;
  latencyMs: number;
}

export interface VerificationResult {
  correlationId: CorrelationId;
  alertId: CorrelationId;
  verdicts: ModelVerdict[];
  consensus: ConsensusMetrics;
  reasoningTrace: string[];
  gonkaRequestIds: string[];
  idChainResolvable: boolean;
  verifiedAt: ISO8601;
  totalLatencyMs: number;
  /** Models that returned nothing usable. Surfaced so a degraded run is visible. */
  failures?: VoteFailure[];
}

// ─── Policy ────────────────────────────────────────────────────────────────
export type ActionTier =
  | 'REJECT' | 'WATCH' | 'ESCALATE' | 'HEDGE_SMALL' | 'HEDGE_FULL';

export type BindingCap =
  | 'RESERVE' | 'DAILY' | 'CEILING' | 'LIQUIDITY' | 'TIER' | 'NONE';

export type MappingRule = 'DIRECT' | 'CONTAGION' | 'ABSTAIN';

export interface HedgeDecision {
  correlationId: CorrelationId;
  tier: ActionTier;
  reason: string;                     // human-readable, shown in UI
  targetAsset: string;                // "ETH"
  mappingRule: MappingRule;
  targetSizeUsdc: UsdcAmount;
  bindingCap: BindingCap;
  decidedAt: ISO8601;
}

// ─── Market data — always decoded, never raw ───────────────────────────────
export interface DecodedOrder {
  orderHash: string;
  asset: string;
  priceFeed: Address;                 // the asset discriminator
  isCall: boolean;
  isLong: boolean;
  strike: UsdPrice;
  premiumPerContract: UsdPrice;
  expiry: ISO8601;
  quoteExpiresAt: ISO8601;
  quoteTtlSeconds: number;            // negative means dead
  availableAmount: UsdcAmount;
  collateralToken: Address;
  underlyingToken: Address;
  optionBookAddress: Address;
  greeks: { delta: number; iv: number; gamma: number; theta: number; vega: number };
  raw: unknown;                       // untouched SDK object — required for signing
}

export interface MarketSnapshot {
  prices: Record<string, UsdPrice>;
  lastUpdated: ISO8601;
  clockSkewSeconds: number;           // feed − local
  orderCount: number;
  fetchedAt: ISO8601;
}

// ─── Execution ─────────────────────────────────────────────────────────────
export type PositionStatus =
  | 'PENDING' | 'OPEN' | 'UNWOUND' | 'HARVESTED' | 'EXPIRED' | 'FAILED';

export interface HedgePosition {
  correlationId: CorrelationId;
  status: PositionStatus;
  asset: string;
  strike: UsdPrice;
  expiry: ISO8601;
  contracts: string;
  premiumPaidUsdc: UsdcAmount;
  notionalProtectedUsdc: UsdcAmount;
  entryTxHash: TxHash;
  exitTxHash?: TxHash;
  baseScanUrl: string;
  spotAtEntry: UsdPrice;
  deltaAtEntry: number;
  openedAt: ISO8601;
  closedAt?: ISO8601;
  realisedPnlUsdc?: UsdcAmount;
  wasDryRun: boolean;
}

// ─── Attestation ───────────────────────────────────────────────────────────
export type AttestationMethod = 'SELF_TX' | 'EAS' | 'REGISTRY' | 'OFFCHAIN_ONLY';

export interface AttestationPayload {
  v: 1;
  cid: CorrelationId;
  truthScore: number;
  agreement: number;
  severity: number;
  gonkaRequestIds: string[];
  evidenceHash: string;
  hedgeTxHash: TxHash;
}

export interface Attestation {
  correlationId: CorrelationId;
  method: AttestationMethod;
  txHash?: TxHash;
  baseScanUrl?: string;
  payload: AttestationPayload;
  createdAt: ISO8601;
}

// ─── Vault ─────────────────────────────────────────────────────────────────
export interface VaultState {
  driver: 'SIMULATED' | 'AAVE_V3' | 'MOONWELL';
  isSimulated: boolean;               // drives the honesty banner
  principalUsdc: UsdcAmount;          // never spent
  accruedYieldUsdc: UsdcAmount;
  premiumReserveUsdc: UsdcAmount;     // spendable
  dailySpentUsdc: UsdcAmount;
  dailyCapUsdc: UsdcAmount;
  apyBps: number;
  asOf: ISO8601;
}

// ─── Errors ────────────────────────────────────────────────────────────────
export type ErrorCode =
  | 'VALIDATION_FAILED' | 'UNAUTHORIZED' | 'RATE_LIMITED'
  | 'GONKA_UNAVAILABLE' | 'GONKA_TIMEOUT' | 'GONKA_MALFORMED_JSON' | 'GONKA_QUORUM_FAILED'
  | 'RPC_UNAVAILABLE' | 'MARKET_DATA_STALE'
  | 'NO_FILLABLE_ORDER' | 'QUOTE_EXPIRED' | 'ASSET_UNRESOLVED'
  | 'INSUFFICIENT_RESERVE' | 'DAILY_CAP_EXCEEDED' | 'SIZE_BELOW_MINIMUM'
  | 'TX_REVERTED' | 'INSUFFICIENT_GAS'
  | 'DUPLICATE_REQUEST' | 'POLICY_REJECTED' | 'INTERNAL';

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    correlationId: CorrelationId;
    details?: Record<string, unknown>;
  };
}

// ─── Job envelope — what the UI polls ──────────────────────────────────────
export interface JobView {
  jobId: CorrelationId;
  status: JobStatus;
  alert: AlertEvent;
  verification?: VerificationResult;
  decision?: HedgeDecision;
  position?: HedgePosition;
  attestation?: Attestation;
  error?: ErrorEnvelope;
}

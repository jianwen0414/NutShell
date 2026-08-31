export type ISO8601 = string;
export type UsdcAmount = string;
export type UsdPrice = string;
export type Address = `0x${string}`;
export type TxHash = `0x${string}`;
export type CorrelationId = string;

export type JobStatus =
  | "QUEUED"
  | "VERIFYING"
  | "VERIFIED"
  | "DECIDED"
  | "SELECTING"
  | "EXECUTING"
  | "EXECUTED"
  | "ATTESTED"
  | "REJECTED"
  | "FAILED";

export type AlertSourceType = "SIMULATOR" | "USER_PASTE" | "WEBHOOK" | "MANUAL" | "ON_CHAIN" | "SOCIAL" | "NEWS";

/** Normalise `AlertEvent.source`, which may be a bare string or an object. */
export function alertSourceType(
  source: AlertSourceType | AlertSourceInfo,
): AlertSourceType {
  return typeof source === "string" ? source : source.type;
}

export interface AlertSourceInfo {
  type: AlertSourceType;
  name: string;
  url?: string;
  credibilityScore?: number;
}

export type AlertSource = AlertSourceType;

export interface AlertEvent {
  id: CorrelationId;
  source: AlertSourceType | AlertSourceInfo;
  rawText: string;
  sourceUrl?: string;
  sourceUrlFetched?: boolean;
  receivedAt: ISO8601;
  clusterKey: string;
  metadata?: Record<string, string>;
}

export type Stance = "REAL" | "FAKE" | "UNCERTAIN";
export type ModelRole = "ANALYST" | "PROSECUTOR" | "SKEPTIC" | "JUDGE" | "SYNTHESIZER";

export interface ModelVerdict {
  modelId: string;
  role: ModelRole;
  claimScore: number;
  severity: 1 | 2 | 3 | 4 | 5;
  stance: Stance;
  keyEvidence: string[];
  redFlags: string[];
  gonkaRequestId: string;
  /** On-chain shard id parsed from the request id. Resolvable, see chainUrl. */
  chainShardId?: number;
  /** Public chain URL for that shard record. Absent if the id did not parse. */
  chainUrl?: string;
  responseHash: string;
  latencyMs: number;
  parseRepaired: boolean;
}

/** Why a model produced no usable vote. Surfaced so a degraded run is visible. */
export interface VoteFailure {
  modelId: string;
  code: Extract<
    ErrorCode,
    "GONKA_TIMEOUT" | "GONKA_UNAVAILABLE" | "GONKA_MALFORMED_JSON" | "RATE_LIMITED"
  >;
  detail: string;
  latencyMs: number;
}

export interface ConsensusMetrics {
  truthScore: number;
  severity: 1 | 2 | 3 | 4 | 5;
  agreement: number;
  spread: number;
  concordance: number;
  conviction: number;
  debateTriggered: boolean;
  modelsResponded: number;
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
  /** Models that returned nothing usable. Empty or absent on a clean run. */
  failures?: VoteFailure[];
}

export type ActionTier = "REJECT" | "WATCH" | "ESCALATE" | "HEDGE_SMALL" | "HEDGE_FULL";
export type BindingCap = "RESERVE" | "DAILY" | "CEILING" | "LIQUIDITY" | "TIER" | "NONE";
export type MappingRule = "DIRECT" | "CONTAGION" | "ABSTAIN";

export interface HedgeDecision {
  correlationId: CorrelationId;
  tier: ActionTier;
  reason: string;
  targetAsset: string;
  mappingRule: MappingRule;
  targetSizeUsdc: UsdcAmount;
  bindingCap: BindingCap;
  decidedAt: ISO8601;
}

export interface DecodedOrder {
  orderHash: string;
  asset: string;
  priceFeed: Address;
  isCall: boolean;
  isLong: boolean;
  strike: UsdPrice;
  premiumPerContract: UsdPrice;
  expiry: ISO8601;
  quoteExpiresAt: ISO8601;
  quoteTtlSeconds: number;
  availableAmount: UsdcAmount;
  collateralToken: Address;
  underlyingToken: Address;
  optionBookAddress: Address;
  greeks: { delta: number; iv: number; gamma: number; theta: number; vega: number };
  raw: unknown;
}

export interface MarketSnapshot {
  prices: Record<string, UsdPrice>;
  lastUpdated: ISO8601;
  clockSkewSeconds: number;
  orderCount: number;
  fetchedAt: ISO8601;
}

export type PositionStatus = "PENDING" | "OPEN" | "UNWOUND" | "HARVESTED" | "EXPIRED" | "FAILED";

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

export type AttestationMethod = "SELF_TX" | "EAS" | "REGISTRY" | "OFFCHAIN_ONLY";

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

export interface VaultState {
  driver: "SIMULATED" | "AAVE_V3" | "MOONWELL";
  isSimulated: boolean;
  principalUsdc: UsdcAmount;
  accruedYieldUsdc: UsdcAmount;
  premiumReserveUsdc: UsdcAmount;
  dailySpentUsdc: UsdcAmount;
  dailyCapUsdc: UsdcAmount;
  apyBps: number;
  asOf: ISO8601;
}

export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "GONKA_UNAVAILABLE"
  | "GONKA_TIMEOUT"
  | "GONKA_MALFORMED_JSON"
  | "GONKA_QUORUM_FAILED"
  | "RPC_UNAVAILABLE"
  | "MARKET_DATA_STALE"
  | "NO_FILLABLE_ORDER"
  | "QUOTE_EXPIRED"
  | "ASSET_UNRESOLVED"
  | "INSUFFICIENT_RESERVE"
  | "DAILY_CAP_EXCEEDED"
  | "SIZE_BELOW_MINIMUM"
  | "TX_REVERTED"
  | "INSUFFICIENT_GAS"
  | "DUPLICATE_REQUEST"
  | "POLICY_REJECTED"
  | "INTERNAL";

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    correlationId: CorrelationId;
    details?: Record<string, unknown>;
  };
}

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

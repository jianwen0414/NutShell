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
  /**
   * The untouched SDK order object, required for signing.
   *
   * ⚠️ This holds `bigint` values. `JSON.stringify` on a DecodedOrder THROWS.
   * Every API route must pass the order through `toJsonSafe()` from
   * `lib/errors.ts` before serialising it.
   */
  raw: unknown;

  // ── M1 additions (PRD §7 permits additions) ─────────────────────────────
  /**
   * Resolved option implementation: 'PUT', 'PUT_SPREAD', 'PHYSICAL_PUT',
   * 'RANGER', … The live book carries nine, so `isCall === false` alone does
   * NOT mean "vanilla put". See `isVanillaPut()` in lib/assets.ts.
   */
  implementationName: string;
  implementationAddress: Address;
  /** All strikes, 8dp. Length 1 = vanilla, 2 = spread, 3 = fly, 4 = condor. */
  strikes: UsdPrice[];
  /** True only for a single-strike, cash-settled, maker-short vanilla put. */
  isVanillaPut: boolean;
  collateralSymbol: string;
  /** Decimals of `collateralToken` — the scale `availableAmount` uses. */
  collateralDecimals: number;
  /** Bounds the contracts the maker can back, so it bounds the premium. */
  maxCollateralUsable: UsdcAmount;
  hoursToExpiry: number;
  /** Spot at decode time, used for the strike cross-check. */
  spotAtDecode: UsdPrice;
  /** |strike − spot| / spot. Drives the ASSET_UNRESOLVED cross-check. */
  strikeDeviationPct: number;
}

export interface MarketSnapshot {
  prices: Record<string, UsdPrice>;
  lastUpdated: ISO8601;
  clockSkewSeconds: number;
  orderCount: number;
  fetchedAt: ISO8601;

  // ── M1 additions ────────────────────────────────────────────────────────
  /**
   * `metadata.currentTime` — the feed's own clock, and the authoritative
   * "now" for all TTL and deadline math. Never `Date.now()`.
   *
   * Measured: `lastUpdated` is NOT a staleness marker. It is a forward-dated
   * quote-cycle anchor — every order's expiry equals `lastUpdated/1000 + 60`
   * exactly — so it sits in the FUTURE by up to 55s.
   */
  feedNow: ISO8601;
  /** currentTime − lastUpdated, seconds. Negative by design (see above). */
  feedAgeSeconds: number;
  /** currentTime − Date.now(), seconds. The real clock skew; measured ~0.5s. */
  localClockSkewSeconds: number;
  feedNowMs: number;
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

  // ── M1 additions ────────────────────────────────────────────────────────
  /** Deployed option contract, read from the fill's `OrderFilled` event. */
  optionAddress?: Address;
  /** Approval tx, when this fill needed one. */
  approvalTxHash?: TxHash;
  /**
   * Everything the executor selected, sized, and built — the audit trail.
   *
   * Optional because a position reconstructed from chain, or a fixture, has
   * no plan behind it. Anything `executeHedge()` returns always carries one.
   */
  execution?: ExecutionPlan;
}

/**
 * A position that definitely carries its execution plan — what
 * `executeHedge()` always returns.
 *
 * `HedgePosition.execution` is optional because a fixture, or a position
 * reconstructed from chain, honestly has no plan behind it. Anything the
 * executor produces does, so the executor returns this narrower type and
 * callers get the plan without a non-null assertion.
 */
export type ExecutedPosition = HedgePosition & { execution: ExecutionPlan };

/**
 * The inspectable record of what the executor did. Populated identically on a
 * dry run and a live fill: on a dry run it IS the deliverable, on a live fill
 * it is the audit trail.
 */
export interface ExecutionPlan {
  dryRun: boolean;
  selectedOrder: DecodedOrder;
  snapshot: MarketSnapshot;
  /** How many fetch→select rounds ran before an order qualified. */
  selectionAttempts: number;
  /** Candidates surviving each filter — explains a NO_FILLABLE_ORDER. */
  funnel: SelectionFunnel;
  premiumUsdc: UsdcAmount;
  premiumRaw: string;
  contracts: string;
  contractsRaw: string;
  /** 🔒 Exact allowance granted. Never MaxUint256 — PRD §14. */
  approvalAmountRaw: string;
  existingAllowanceRaw: string;
  approvalRequired: boolean;
  approvalTx: UnsignedTx | null;
  fillTx: UnsignedTx;
  /** Quote TTL when the transaction was built, on the feed clock. */
  ttlAtBuildSeconds: number;
  /** TTL at the moment of the fill, after the approval confirmed. */
  ttlAtSignSeconds?: number;
  buildLatencyMs: number;
  buildStartedAtMs: number;
  signerAddress?: Address;
  balances?: { ethWei: string; collateralRaw: string; collateralSymbol: string };
  gasEstimate?: { approve?: string; fill?: string } | null;
  /** What the chain reported, from `OrderFilled`. Authoritative over ours. */
  onChain?: {
    optionAddress: Address;
    premiumPaidRaw: string;
    feeCollectedRaw: string;
    referralFeePaidRaw: string;
    gasUsed: string;
    effectiveGasPriceWei: string;
    blockNumber: number;
  };
  /** What settlement did, read from the option contract after expiry. */
  settlement?: {
    settlementPrice: UsdPrice;
    payoutOwed: UsdcAmount;
    inTheMoney: boolean;
    optionSettled: boolean;
    recovered: UsdcAmount;
    /** Measured false: settlement is automatic and costs the buyer nothing. */
    transactionRequired: boolean;
  };
  warnings: string[];
}

export interface UnsignedTx {
  to: Address;
  data: string;
  value: string;
  chainId: number;
  description: string;
}

/** Candidate counts after each successive selection filter. */
export interface SelectionFunnel {
  fetched: number;
  assetResolved: number;
  vanillaPuts: number;
  collateralSupported: number;
  ttlOk: number;
  expiryHorizonOk: number;
  deltaBandOk: number;
  liquidityOk: number;
  affordable: number;
  bestRejectedTtlSeconds: number | null;
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

  // ── M1 additions ────────────────────────────────────────────────────────
  /** Canonical `NSHv1|…` line, exactly as encoded into calldata — PRD §12. */
  canonicalLine?: string;
  /** Hex of `canonicalLine`; the tx `data` for SELF_TX. */
  payloadHex?: string;
  /** sha256 of `canonicalLine` — the receipt hash for OFFCHAIN_ONLY. */
  payloadHash?: string;
  /** Methods tried before this one succeeded, with why each failed. */
  ladderAttempts?: { method: AttestationMethod; ok: boolean; error?: string }[];
  /** True when nothing was broadcast (dry run, or no signer). */
  wasDryRun?: boolean;
  unsignedTx?: UnsignedTx;
}

/**
 * An attestation produced by `attest()`, which always fills the M1 fields.
 * The base `Attestation` leaves them optional so a fixture or an imported
 * record can omit them honestly.
 */
export type CompleteAttestation = Attestation &
  Required<Pick<Attestation, 'canonicalLine' | 'payloadHex' | 'payloadHash' | 'ladderAttempts' | 'wasDryRun'>>;

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

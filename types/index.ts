/**
 * 🔒 FROZEN SHARED CONTRACTS — PRD §7.
 *
 * Every module reads and writes these shapes. Fields may be ADDED; existing
 * fields must never be renamed or repurposed.
 *
 * Two invariants:
 *   1. All money is a decimal STRING, never a float.
 *   2. No `bigint` ever crosses a JSON boundary.
 */

// ─── Primitives ────────────────────────────────────────────────────────────
export type ISO8601 = string;
export type UsdcAmount = string; // "2.15", max 6dp
export type UsdPrice = string; // "2443.00", max 8dp
export type Address = `0x${string}`;
export type TxHash = `0x${string}`;
export type CorrelationId = string; // "nsh_" + 16 hex

export type JobStatus =
  | 'QUEUED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'DECIDED'
  | 'SELECTING'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'ATTESTED'
  | 'REJECTED'
  | 'FAILED';

// ─── Alerts ────────────────────────────────────────────────────────────────
export type AlertSource = 'SIMULATOR' | 'USER_PASTE' | 'WEBHOOK' | 'MANUAL';

export interface AlertEvent {
  id: CorrelationId;
  source: AlertSource;
  rawText: string;
  sourceUrl?: string;
  sourceUrlFetched?: boolean;
  receivedAt: ISO8601;
  clusterKey: string; // dedupe key — PRD §10.6
  metadata?: Record<string, string>;
}

// ─── Verification ──────────────────────────────────────────────────────────
export type Stance = 'REAL' | 'FAKE' | 'UNCERTAIN';
export type ModelRole = 'ANALYST' | 'PROSECUTOR' | 'SKEPTIC' | 'JUDGE' | 'SYNTHESIZER';

export interface ModelVerdict {
  modelId: string; // resolved at runtime — never hardcoded
  role: ModelRole;
  claimScore: number; // 0–100
  severity: 1 | 2 | 3 | 4 | 5;
  stance: Stance;
  keyEvidence: string[];
  redFlags: string[];
  gonkaRequestId: string;
  responseHash: string; // sha256 of raw body
  latencyMs: number;
  parseRepaired: boolean; // PRD §10.8
}

export interface ConsensusMetrics {
  truthScore: number; // 0–100, mean of layer-1 claimScores
  severity: 1 | 2 | 3 | 4 | 5; // median
  agreement: number; // 0–1 — PRD §10.3
  spread: number; // max − min claimScore
  concordance: number; // fraction sharing modal stance
  conviction: number; // (truthScore/100) × agreement
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
}

// ─── Policy ────────────────────────────────────────────────────────────────
export type ActionTier = 'REJECT' | 'WATCH' | 'ESCALATE' | 'HEDGE_SMALL' | 'HEDGE_FULL';

export type BindingCap = 'RESERVE' | 'DAILY' | 'CEILING' | 'LIQUIDITY' | 'TIER' | 'NONE';

export type MappingRule = 'DIRECT' | 'CONTAGION' | 'ABSTAIN';

export interface HedgeDecision {
  correlationId: CorrelationId;
  tier: ActionTier;
  reason: string; // human-readable, shown in UI
  targetAsset: string; // "ETH"
  mappingRule: MappingRule; // PRD §10.7
  targetSizeUsdc: UsdcAmount;
  bindingCap: BindingCap;
  decidedAt: ISO8601;
}

// ─── Market data — always decoded, never raw ───────────────────────────────
export interface DecodedOrder {
  orderHash: string;
  asset: string;
  priceFeed: Address; // 🔒 the asset discriminator — PRD §3.4
  isCall: boolean;
  isLong: boolean;
  strike: UsdPrice;
  premiumPerContract: UsdPrice;
  expiry: ISO8601;
  quoteExpiresAt: ISO8601;
  quoteTtlSeconds: number; // negative means dead
  availableAmount: UsdcAmount;
  collateralToken: Address;
  underlyingToken: Address;
  optionBookAddress: Address;
  greeks: { delta: number; iv: number; gamma: number; theta: number; vega: number };
  raw: unknown; // untouched SDK object — required for signing

  // ── Added fields (PRD §7 permits additions) ──────────────────────────────
  /**
   * Resolved option implementation name from the SDK chain config: 'PUT',
   * 'PUT_SPREAD', 'PHYSICAL_PUT', 'RANGER', … The live book carries nine
   * distinct implementations, so `isCall === false` alone does NOT mean
   * "vanilla put". See lib/assets.ts VANILLA_PUT_IMPLEMENTATION.
   */
  implementationName: string;
  implementationAddress: Address;
  /** All strikes, 8dp-decoded. Length 1 = vanilla, 2 = spread, 3 = fly, 4 = condor. */
  strikes: UsdPrice[];
  /** True only for a single-strike, cash-settled, maker-short vanilla put. */
  isVanillaPut: boolean;
  /** ERC-20 symbol of `collateralToken`, resolved from chain config. */
  collateralSymbol: string;
  /** Decimals of `collateralToken` — the scale `availableAmount` is expressed in. */
  collateralDecimals: number;
  /**
   * `rawApiData.maxCollateralUsable`, decoded at the collateral token's
   * scale. Bounds the contracts the maker can back, and so bounds the premium
   * this quote can absorb — which is far less than `availableAmount` implies.
   */
  maxCollateralUsable: UsdcAmount;
  /** Hours from the market feed's clock to option expiry. */
  hoursToExpiry: number;
  /** Spot price of `asset` at decode time, used for the strike cross-check. */
  spotAtDecode: UsdPrice;
  /** |strike − spot| / spot at decode time. Drives the ASSET_UNRESOLVED cross-check. */
  strikeDeviationPct: number;
}

export interface MarketSnapshot {
  prices: Record<string, UsdPrice>;
  lastUpdated: ISO8601;
  clockSkewSeconds: number; // feed − local — PRD §3.6
  orderCount: number;
  fetchedAt: ISO8601;

  // ── Added fields ─────────────────────────────────────────────────────────
  /**
   * `metadata.currentTime` — the feed's own wall clock. All freshness and
   * deadline math derives from the feed clock, never from `Date.now()`.
   */
  feedNow: ISO8601;
  /** (currentTime − lastUpdated) in seconds: how stale the quoted prices are. */
  feedAgeSeconds: number;
  /** (currentTime − Date.now()) in seconds: our host clock vs the feed's. */
  localClockSkewSeconds: number;
  /** Unix ms of `metadata.currentTime`; the authoritative "now" for TTL math. */
  feedNowMs: number;
}

// ─── Execution ─────────────────────────────────────────────────────────────
export type PositionStatus = 'PENDING' | 'OPEN' | 'UNWOUND' | 'HARVESTED' | 'EXPIRED' | 'FAILED';

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

  // ── Added fields ─────────────────────────────────────────────────────────
  /** Deployed option contract address, read from the fill receipt. */
  optionAddress?: Address;
  /** Approval transaction hash, when an approval was required for this fill. */
  approvalTxHash?: TxHash;
  /** Everything the executor selected, sized, and built — audit and dry-run record. */
  execution: ExecutionPlan;
}

/**
 * The full, inspectable record of what the executor selected, sized, and
 * built. Populated identically on a dry run and a live fill: on a dry run it
 * IS the deliverable, on a live fill it is the audit trail.
 */
export interface ExecutionPlan {
  dryRun: boolean;
  /** The order the selector chose, fully decoded. */
  selectedOrder: DecodedOrder;
  /** Market snapshot from the re-fetch that produced `selectedOrder`. */
  snapshot: MarketSnapshot;
  /** How many fetch→select rounds ran before an order qualified. */
  selectionAttempts: number;
  /** Candidates surviving each successive filter — explains NO_FILLABLE_ORDER. */
  funnel: SelectionFunnel;
  /** Premium committed, in collateral-token units, as a decimal string. */
  premiumUsdc: UsdcAmount;
  /** Premium in the collateral token's smallest unit, as a decimal string. */
  premiumRaw: string;
  /** Contracts bought, decoded to the collateral token's decimals. */
  contracts: string;
  /** Contracts in smallest units, as a decimal string. */
  contractsRaw: string;
  /** Exact allowance the approval grants. 🔒 Never MaxUint256 — PRD §14. */
  approvalAmountRaw: string;
  /** Allowance already held by the burner before this trade. */
  existingAllowanceRaw: string;
  /** True when the existing allowance is short of the premium. */
  approvalRequired: boolean;
  /** Built, unsigned ERC-20 approve calldata — null when no approval is required. */
  approvalTx: UnsignedTx | null;
  /** Built, unsigned OptionBook fillOrder calldata. */
  fillTx: UnsignedTx;
  /** Quote TTL remaining when the transaction was built, on the feed clock. */
  ttlAtBuildSeconds: number;
  /**
   * Quote TTL remaining at the moment of the fill, after the approval has
   * confirmed. This is the number that actually decides whether the fill
   * lands; `ttlAtBuildSeconds` precedes the approval's block time.
   */
  ttlAtSignSeconds?: number;
  /** Time from re-fetch to built transaction. Must stay well inside the TTL. */
  buildLatencyMs: number;
  /** Local wall clock when the book was fetched — the basis for TTL decay. */
  buildStartedAtMs: number;
  /**
   * What the chain actually reported, read from the `OrderFilled` event.
   * Authoritative over this module's own arithmetic; a divergence is logged
   * as a warning rather than silently reconciled.
   */
  onChain?: {
    optionAddress: Address;
    premiumPaidRaw: string;
    feeCollectedRaw: string;
    referralFeePaidRaw: string;
    gasUsed: string;
    effectiveGasPriceWei: string;
    blockNumber: number;
  };
  /** Address the transactions would be sent from, when a signer is configured. */
  signerAddress?: Address;
  /** Burner balances at build time, when a signer is configured. */
  balances?: { ethWei: string; collateralRaw: string; collateralSymbol: string };
  /** Populated when a live gas estimate ran; null on a signer-less dry run. */
  gasEstimate?: { approve?: string; fill?: string } | null;
  /** Non-fatal advisories — skipped gas estimate, low balance, and similar. */
  warnings: string[];
  /**
   * What settlement actually did, read from the option contract after expiry.
   * Settlement on this venue is automatic and costs the buyer nothing, so
   * `transactionRequired` is false for every case measured so far.
   */
  settlement?: {
    /** Chainlink TWAP the option settled against, 8dp decimal string. */
    settlementPrice: UsdPrice;
    /** `calculatePayout(settlementPrice)` — what the buyer is owed. */
    payoutOwed: UsdcAmount;
    inTheMoney: boolean;
    /** The contract's own `optionSettled` flag. */
    optionSettled: boolean;
    /** Measured collateral delta on the burner across settlement. */
    recovered: UsdcAmount;
    /** Whether the buyer had to send anything. Measured false. */
    transactionRequired: boolean;
  };
}

export interface UnsignedTx {
  to: Address;
  data: string;
  value: string; // decimal string of wei, "0" for these calls
  chainId: number;
  /** What this transaction does, in one line, for UI and logs. */
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
  /** Best TTL seen among orders rejected only by the TTL filter. */
  bestRejectedTtlSeconds: number | null;
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

  // ── Added fields ─────────────────────────────────────────────────────────
  /** Canonical `NSHv1|…` line, exactly as encoded into calldata — PRD §12. */
  canonicalLine: string;
  /** Hex encoding of `canonicalLine`; the tx `data` field for SELF_TX. */
  payloadHex: string;
  /** sha256 of `canonicalLine` — the receipt hash for OFFCHAIN_ONLY. */
  payloadHash: string;
  /** Methods attempted before this one succeeded, with the reason each failed. */
  ladderAttempts: { method: AttestationMethod; ok: boolean; error?: string }[];
  /** True when nothing was broadcast (dry run, or no signer configured). */
  wasDryRun: boolean;
  /** Built, unsigned attestation transaction. Present even on a dry run. */
  unsignedTx?: UnsignedTx;
}

// ─── Vault ─────────────────────────────────────────────────────────────────
export interface VaultState {
  driver: 'SIMULATED' | 'AAVE_V3' | 'MOONWELL';
  isSimulated: boolean; // drives the honesty banner — PRD §13.2
  principalUsdc: UsdcAmount; // never spent
  accruedYieldUsdc: UsdcAmount;
  premiumReserveUsdc: UsdcAmount; // spendable
  dailySpentUsdc: UsdcAmount;
  dailyCapUsdc: UsdcAmount;
  apyBps: number;
  asOf: ISO8601;
}

// ─── Errors ────────────────────────────────────────────────────────────────
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'GONKA_UNAVAILABLE'
  | 'GONKA_TIMEOUT'
  | 'GONKA_MALFORMED_JSON'
  | 'GONKA_QUORUM_FAILED'
  | 'RPC_UNAVAILABLE'
  | 'MARKET_DATA_STALE'
  | 'NO_FILLABLE_ORDER'
  | 'QUOTE_EXPIRED'
  | 'ASSET_UNRESOLVED'
  | 'INSUFFICIENT_RESERVE'
  | 'DAILY_CAP_EXCEEDED'
  | 'SIZE_BELOW_MINIMUM'
  | 'TX_REVERTED'
  | 'INSUFFICIENT_GAS'
  | 'DUPLICATE_REQUEST'
  | 'POLICY_REJECTED'
  | 'INTERNAL';

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

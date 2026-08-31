import type {
  ActionTier,
  AlertEvent,
  BindingCap,
  CorrelationId,
  HedgeDecision,
  ISO8601,
  UsdcAmount,
  VerificationResult,
} from "@/types";
import { mapEventToAsset } from './event-mapping';

/**
 * Turns a verdict into a decision,
 * matrix, sizing, deduplication and asset mapping.
 *
 * Pure. Every piece of state it needs is passed in, so each matrix row can be
 * tested without a database, a clock, or a network. The requirement is a unit test
 * per row; that is only cheap if this function stays free of side effects.
 */

// ── Money ─────────────────────────────────────────────────────────────────
// Money is a decimal string, never a float. All arithmetic happens in
// integer micro-USDC (6dp, USDC's own scale) and converts back at the edge.

const MICROS = 1_000_000n;

export function toMicros(v: UsdcAmount): bigint {
  const [whole = '0', frac = ''] = v.trim().split('.');
  const sign = whole.startsWith('-') ? -1n : 1n;
  const w = BigInt(whole.replace('-', '') || '0');
  const f = BigInt(frac.padEnd(6, '0').slice(0, 6) || '0');
  return sign * (w * MICROS + f);
}

export function fromMicros(v: bigint): UsdcAmount {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const frac = (abs % MICROS).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${abs / MICROS}${frac ? '.' + frac : ''}`;
}

// ── Thresholds — all from env so they tune without a redeploy ─────

const num = (key: string, fallback: number) => {
  const raw = process.env[key];
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export interface Thresholds {
  truthHedge: number;
  truthFull: number;
  agreement: number;
  agreementFull: number;
  hardCeilingUsdc: UsdcAmount;
  minFillUsdc: UsdcAmount;
  cooldownMinutes: number;
}

export function thresholdsFromEnv(): Thresholds {
  return {
    truthHedge: num('TRUTH_THRESHOLD_HEDGE', 70),
    truthFull: num('TRUTH_THRESHOLD_FULL', 85),
    agreement: num('AGREEMENT_THRESHOLD', 0.6),
    agreementFull: num('AGREEMENT_THRESHOLD_FULL', 0.75),
    hardCeilingUsdc: process.env.HARD_CEILING_USDC ?? '3.00',
    minFillUsdc: process.env.MIN_FILL_USDC ?? '0.50',
    cooldownMinutes: num('CLUSTER_COOLDOWN_MINUTES', 30),
  };
}

/** How much of the budget each tier commits */
const TIER_MULTIPLIER: Record<ActionTier, number> = {
  REJECT: 0,
  WATCH: 0,
  ESCALATE: 0,
  HEDGE_SMALL: 0.3,
  HEDGE_FULL: 1.0,
};

// ── The matrix ────────────────────────────────────────────────────

/** The panel size the product claims. Fewer responders means less confidence. */
const FULL_PANEL = 3;

/**
 * Two decisions live here that the tier table alone does not settle.
 *
 * 1. THE GAP. There is no row for truth 70-84 with severity 4-5: HEDGE_SMALL
 *    requires severity exactly 3, HEDGE_FULL requires truth 85+. The measured
 *    demo fixture lands in that hole (truth ~75, severity 4). Filled by
 *    treating severity 3-5 alike at the HEDGE_SMALL level, so a MORE severe
 *    event never receives LESS protection than a less severe one at identical
 *    confidence. The alternative reading is that the agent sees a severe,
 *    credible, agreed threat and does nothing, which is the failure this
 *    product exists to prevent.
 *
 * 2. THE DEGRADED PANEL. The definition is concordance as |modal stance| / n,
 *    where n is however many models answered. That is FIXED and right as
 *    written, but it means two models agreeing scores exactly 1.00, identical
 *    to three agreeing. With Kimi timing out roughly five calls in six,
 *    two-model runs are the common case, so the agreement number quietly
 *    flatters every degraded run. The maths cannot change: it is frozen and
 *    every consumer depends on it. This layer is a DEFAULT, so the correction
 *    belongs here. A panel that lost a member can still hedge, because two
 *    independent models agreeing is real evidence, but it never commits the
 *    full budget.
 *
 * Both are flagged for team sign-off. Neither overrides a stated row.
 */


export function selectTier(
  truthScore: number,
  agreement: number,
  severity: number,
  t: Thresholds = thresholdsFromEnv(),
  modelsResponded: number = FULL_PANEL,
): { tier: ActionTier; reason: string } {
  if (truthScore < 40) {
    return { tier: 'REJECT', reason: `Truth ${truthScore} below 40. Logged, no action.` };
  }
  if (truthScore < t.truthHedge) {
    return { tier: 'WATCH', reason: `Truth ${truthScore} below the ${t.truthHedge} hedge threshold.` };
  }
  if (agreement < t.agreement) {
    return {
      tier: 'ESCALATE',
      reason:
        `Truth ${truthScore} is high but agreement ${agreement} is below ${t.agreement}. ` +
        `The models conflict, so this escalates rather than trades.`,
    };
  }
  if (severity <= 2) {
    return { tier: 'WATCH', reason: `Severity ${severity} is contained. Radar only.` };
  }
  if (truthScore >= t.truthFull && agreement >= t.agreementFull && severity >= 4) {
    if (modelsResponded < FULL_PANEL) {
      return {
        tier: 'HEDGE_SMALL',
        reason:
          `Truth ${truthScore}, agreement ${agreement}, severity ${severity} would justify full ` +
          `protection, but only ${modelsResponded} of ${FULL_PANEL} models responded. Agreement ` +
          `across a reduced panel is measured over fewer opinions, so this is capped at partial.`,
      };
    }
    return {
      tier: 'HEDGE_FULL',
      reason: `Truth ${truthScore}, agreement ${agreement}, severity ${severity}. Full protection.`,
    };
  }
  return {
    tier: 'HEDGE_SMALL',
    reason:
      `Truth ${truthScore}, agreement ${agreement}, severity ${severity}. ` +
      `Partial protection at ${TIER_MULTIPLIER.HEDGE_SMALL} of budget.`,
  };
}

// ── State the decision needs ──────────────────────────────────────────────

export interface OpenHedge {
  asset: string;
  correlationId: CorrelationId;
  sizeUsdc: UsdcAmount;
}

export interface PolicyState {
  premiumReserveUsdc: UsdcAmount;
  dailyCapUsdc: UsdcAmount;
  dailySpentUsdc: UsdcAmount;
  /** At most one open hedge per asset. */
  openHedges: OpenHedge[];
  /** Last execution per cluster, for the cooldown. */
  clusterHistory: Array<{ clusterKey: string; lastExecutedAt: ISO8601 }>;
  /** Fillable depth for the chosen asset, if known. Binds as LIQUIDITY. */
  bookLiquidityUsdc?: UsdcAmount;
  /** Per-tier absolute cap. Unset means the tier never binds on its own. */
  tierCapUsdc?: UsdcAmount;
  /** Injected so tests never depend on the wall clock. */
  now?: ISO8601;
}

// ── Sizing ────────────────────────────────────────────────────────

export interface Sizing {
  sizeUsdc: UsdcAmount;
  budgetUsdc: UsdcAmount;
  bindingCap: BindingCap;
  belowMinimum: boolean;
}

/**
 * budget   = min(reserve, dailyRemaining, ceiling, tierCap, liquidity)
 * size     = budget × tierMultiplier × conviction
 *
 * `bindingCap` records WHICH limit bound the trade, and is always populated.
 * "We wanted $8 of protection but the daily cap allowed $3" is a far more
 * credible statement than an unexplained number.
 */
export function sizeHedge(
  tier: ActionTier,
  conviction: number,
  state: PolicyState,
  t: Thresholds = thresholdsFromEnv(),
): Sizing {
  const dailyRemaining = toMicros(state.dailyCapUsdc) - toMicros(state.dailySpentUsdc);

  const limits: Array<{ cap: BindingCap; micros: bigint }> = [
    { cap: 'RESERVE', micros: toMicros(state.premiumReserveUsdc) },
    { cap: 'DAILY', micros: dailyRemaining > 0n ? dailyRemaining : 0n },
    { cap: 'CEILING', micros: toMicros(t.hardCeilingUsdc) },
  ];
  if (state.tierCapUsdc !== undefined) {
    limits.push({ cap: 'TIER', micros: toMicros(state.tierCapUsdc) });
  }
  if (state.bookLiquidityUsdc !== undefined) {
    limits.push({ cap: 'LIQUIDITY', micros: toMicros(state.bookLiquidityUsdc) });
  }

  // The smallest limit is the binding one. Ties resolve to the first listed,
  // which keeps the label stable across runs instead of flapping.
  let binding = limits[0]!;
  for (const l of limits) if (l.micros < binding.micros) binding = l;
  const budget = binding.micros < 0n ? 0n : binding.micros;

  // conviction and the tier multiplier are fractions; scale to integers so no
  // float ever touches a money value.
  const factor = BigInt(Math.round(TIER_MULTIPLIER[tier] * conviction * 1_000_000));
  const size = (budget * factor) / 1_000_000n;

  const minFill = toMicros(t.minFillUsdc);
  return {
    sizeUsdc: fromMicros(size),
    budgetUsdc: fromMicros(budget),
    // NONE only when nothing actually constrained us, which cannot happen while
    // CEILING is always in the list — kept for completeness of the union.
    bindingCap: budget === 0n && binding.cap === 'DAILY' ? 'DAILY' : binding.cap,
    belowMinimum: size < minFill,
  };
}

// ── Deduplication ─────────────────────────────────────────────────

/**
 * A real crisis emits dozens of alerts within minutes. Without this the agent
 * fires N hedges and empties the reserve on a single event.
 */
export function cooldownRemainingMs(
  clusterKey: string,
  state: PolicyState,
  t: Thresholds = thresholdsFromEnv(),
): number {
  const entry = state.clusterHistory.find((c) => c.clusterKey === clusterKey);
  if (!entry) return 0;
  const now = state.now ? Date.parse(state.now) : Date.now();
  const elapsed = now - Date.parse(entry.lastExecutedAt);
  const window = t.cooldownMinutes * 60_000;
  return elapsed >= window ? 0 : window - elapsed;
}

// ── The decision ──────────────────────────────────────────────────────────

export function decide(
  alert: AlertEvent,
  verification: VerificationResult,
  state: PolicyState,
  t: Thresholds = thresholdsFromEnv(),
): HedgeDecision {
  const c = verification.consensus;
  const decidedAt = state.now ?? new Date().toISOString();

  const base = {
    correlationId: verification.correlationId,
    decidedAt,
    targetSizeUsdc: '0',
    bindingCap: 'NONE' as BindingCap,
  };

  // 1. Which asset, and by which rule.
  const mapping = mapEventToAsset(alert.rawText, c.severity);

  // 2. Tier from the matrix.
  const { tier, reason } = selectTier(
    c.truthScore,
    c.agreement,
    c.severity,
    t,
    c.modelsResponded,
  );

  const isHedge = tier === 'HEDGE_SMALL' || tier === 'HEDGE_FULL';
  if (!isHedge) {
    return {
      ...base,
      tier,
      reason,
      targetAsset: mapping.asset ?? '',
      mappingRule: mapping.rule,
    };
  }

  // 3. An unmappable alert cannot be hedged however credible it is.
  if (mapping.asset === null) {
    return {
      ...base,
      tier: 'WATCH',
      reason: `${reason} Downgraded: ${mapping.reason}`,
      targetAsset: '',
      mappingRule: 'ABSTAIN',
    };
  }

  // 4. Cooldown.
  const cooling = cooldownRemainingMs(alert.clusterKey, state, t);
  if (cooling > 0) {
    return {
      ...base,
      tier: 'WATCH',
      reason:
        `${reason} Suppressed: this cluster executed ${Math.ceil(cooling / 60_000)} minute(s) ` +
        `inside the ${t.cooldownMinutes}-minute cooldown.`,
      targetAsset: mapping.asset,
      mappingRule: mapping.rule,
    };
  }

  // 5. Sizing.
  const sizing = sizeHedge(tier, c.conviction, state, t);

  // 6. One open hedge per asset. A second signal may only INCREASE size,
  //    never open a duplicate — so the size is the top-up, not the full amount.
  const open = state.openHedges.find((h) => h.asset === mapping.asset);
  if (open) {
    const delta = toMicros(sizing.sizeUsdc) - toMicros(open.sizeUsdc);
    if (delta <= 0n) {
      return {
        ...base,
        tier: 'WATCH',
        reason:
          `${reason} Suppressed: ${mapping.asset} already hedged at ${open.sizeUsdc} USDC ` +
          `(${open.correlationId}), which is not less than the ${sizing.sizeUsdc} indicated here.`,
        targetAsset: mapping.asset,
        mappingRule: mapping.rule,
      };
    }
    const topUp = fromMicros(delta);
    if (delta < toMicros(t.minFillUsdc)) {
      return {
        ...base,
        tier: 'WATCH',
        reason:
          `${reason} SIZE_BELOW_MINIMUM: top-up of ${topUp} USDC on the existing ` +
          `${mapping.asset} hedge is under the ${t.minFillUsdc} floor.`,
        targetAsset: mapping.asset,
        mappingRule: mapping.rule,
      };
    }
    return {
      correlationId: verification.correlationId,
      tier,
      reason:
        `${reason} ${mapping.reason} Increasing the open ${mapping.asset} hedge by ` +
        `${topUp} USDC. Bound by ${sizing.bindingCap}.`,
      targetAsset: mapping.asset,
      mappingRule: mapping.rule,
      targetSizeUsdc: topUp,
      bindingCap: sizing.bindingCap,
      decidedAt,
    };
  }

  // 7. Below the fill floor is a clean skip, never a throw.
  if (sizing.belowMinimum) {
    return {
      ...base,
      tier: 'WATCH',
      reason:
        `${reason} SIZE_BELOW_MINIMUM: ${sizing.sizeUsdc} USDC is under the ` +
        `${t.minFillUsdc} floor. Bound by ${sizing.bindingCap}.`,
      targetAsset: mapping.asset,
      mappingRule: mapping.rule,
      bindingCap: sizing.bindingCap,
    };
  }

  return {
    correlationId: verification.correlationId,
    tier,
    reason: `${reason} ${mapping.reason} Bound by ${sizing.bindingCap}.`,
    targetAsset: mapping.asset,
    mappingRule: mapping.rule,
    targetSizeUsdc: sizing.sizeUsdc,
    bindingCap: sizing.bindingCap,
    decidedAt,
  };
}

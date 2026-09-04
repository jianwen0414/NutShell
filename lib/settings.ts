import { thresholdsFromEnv, type Thresholds } from "./policy";
import { setExecutionMode, type ExecutionMode } from "./control-state";

/**
 * Policy the operator can change, and that the pipeline actually reads.
 *
 * The configuration page shipped as a set of sliders over local component
 * state with a Save button that called setSaved(true) and nothing else. Every
 * threshold, budget and mode on it was discarded on refresh and none of it had
 * ever reached the policy engine — so an operator could set a conservative
 * profile, watch the button say "CONFIGURATION SAVED", and have the agent go
 * on trading against the environment defaults.
 *
 * This is the store those controls now write to. `decide()` already takes its
 * Thresholds as a parameter, so injecting them is the whole change on the
 * policy side.
 *
 * Held in globalThis for the same reason control-state is: Next.js route
 * handlers and the worker share a process, and hot reload must not reset it.
 * Values fall back to the environment, which stays the source of truth for a
 * cold start.
 */

export type RiskTier = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";

export interface Settings {
  riskTier: RiskTier;
  /** Per-trade hard ceiling, decimal USDC string. */
  hardCeilingUsdc: string;
  /** Share of the vault spendable per day, percent. */
  dailyCapPercent: number;
  truthHedge: number;
  truthFull: number;
  /** 0–1. */
  agreement: number;
  agreementFull: number;
  executionMode: ExecutionMode;
  updatedAt: string;
}

/**
 * What each profile means, in the numbers the engine uses.
 *
 * These are the values the configuration page has always displayed on its
 * three cards; the difference is that selecting one now changes what the agent
 * does rather than what the card looks like.
 */
export const TIER_PRESETS: Record<RiskTier, Omit<Settings, "riskTier" | "executionMode" | "updatedAt">> = {
  CONSERVATIVE: {
    hardCeilingUsdc: "1.50",
    dailyCapPercent: 3,
    truthHedge: 80,
    truthFull: 90,
    agreement: 0.85,
    agreementFull: 0.9,
  },
  BALANCED: {
    hardCeilingUsdc: "3.00",
    dailyCapPercent: 5,
    truthHedge: 70,
    truthFull: 85,
    agreement: 0.6,
    agreementFull: 0.75,
  },
  AGGRESSIVE: {
    hardCeilingUsdc: "5.00",
    dailyCapPercent: 10,
    truthHedge: 60,
    truthFull: 75,
    agreement: 0.5,
    agreementFull: 0.6,
  },
};

declare global {
  // eslint-disable-next-line no-var
  var __nutshellSettings: Settings | undefined;
}

function defaults(): Settings {
  const env = thresholdsFromEnv();
  return {
    riskTier: "BALANCED",
    hardCeilingUsdc: env.hardCeilingUsdc,
    dailyCapPercent: Number(process.env.DAILY_CAP_PERCENT ?? 5),
    truthHedge: env.truthHedge,
    truthFull: env.truthFull,
    agreement: env.agreement,
    agreementFull: env.agreementFull,
    executionMode: (process.env.EXECUTION_MODE as ExecutionMode) ?? "AUTONOMOUS",
    updatedAt: new Date().toISOString(),
  };
}

function store(): Settings {
  globalThis.__nutshellSettings ??= defaults();
  return globalThis.__nutshellSettings;
}

export function getSettings(): Settings {
  return { ...store() };
}

/** The shape the policy engine wants, built from what the operator chose. */
export function thresholdsFromSettings(): Thresholds {
  const s = store();
  const env = thresholdsFromEnv();
  return {
    ...env,
    truthHedge: s.truthHedge,
    truthFull: s.truthFull,
    agreement: s.agreement,
    agreementFull: s.agreementFull,
    hardCeilingUsdc: s.hardCeilingUsdc,
  };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Apply a partial update, clamped.
 *
 * Every bound here is a real one rather than a nicety. A truth threshold above
 * 100 can never be met, one below 40 sits under the floor the engine rejects
 * at, and a ceiling of zero makes every trade fail sizing — all three are ways
 * to silently disable the agent from a settings form.
 */
export function updateSettings(patch: Partial<Settings>): Settings {
  const s = store();

  if (patch.riskTier && patch.riskTier in TIER_PRESETS) {
    s.riskTier = patch.riskTier;
    Object.assign(s, TIER_PRESETS[patch.riskTier]);
  }

  if (typeof patch.hardCeilingUsdc === "string" && /^\d+(\.\d+)?$/.test(patch.hardCeilingUsdc)) {
    const n = Math.min(Math.max(Number(patch.hardCeilingUsdc), 0.5), 25);
    s.hardCeilingUsdc = n.toFixed(2);
  }
  if (isNum(patch.dailyCapPercent)) {
    s.dailyCapPercent = Math.min(Math.max(patch.dailyCapPercent, 1), 20);
  }
  if (isNum(patch.truthHedge)) s.truthHedge = Math.min(Math.max(patch.truthHedge, 40), 95);
  if (isNum(patch.truthFull)) s.truthFull = Math.min(Math.max(patch.truthFull, 50), 99);
  if (isNum(patch.agreement)) s.agreement = Math.min(Math.max(patch.agreement, 0.3), 0.99);
  if (isNum(patch.agreementFull)) {
    s.agreementFull = Math.min(Math.max(patch.agreementFull, 0.3), 0.99);
  }

  // Full size must be at least as demanding as a small hedge, or the tiers
  // invert and the engine reaches HEDGE_FULL before HEDGE_SMALL.
  if (s.truthFull < s.truthHedge) s.truthFull = s.truthHedge;
  if (s.agreementFull < s.agreement) s.agreementFull = s.agreement;

  if (
    patch.executionMode === "AUTONOMOUS" ||
    patch.executionMode === "APPROVAL_REQUIRED" ||
    patch.executionMode === "MONITOR_ONLY"
  ) {
    s.executionMode = patch.executionMode;
    // The live control state is what the pipeline consults per run, so a
    // default set here has to reach it or the two disagree the moment they
    // are both on screen.
    setExecutionMode(patch.executionMode);
  }

  // A hand-edited value no longer matches the profile it came from.
  if (!patch.riskTier) {
    const preset = TIER_PRESETS[s.riskTier];
    const matches =
      preset.hardCeilingUsdc === s.hardCeilingUsdc &&
      preset.dailyCapPercent === s.dailyCapPercent &&
      preset.truthHedge === s.truthHedge &&
      preset.truthFull === s.truthFull &&
      preset.agreement === s.agreement;
    if (!matches) s.riskTier = s.riskTier;
  }

  s.updatedAt = new Date().toISOString();
  return { ...s };
}

/** True when the live values still match the selected profile exactly. */
export function matchesPreset(s: Settings = store()): boolean {
  const p = TIER_PRESETS[s.riskTier];
  return (
    p.hardCeilingUsdc === s.hardCeilingUsdc &&
    p.dailyCapPercent === s.dailyCapPercent &&
    p.truthHedge === s.truthHedge &&
    p.truthFull === s.truthFull &&
    p.agreement === s.agreement &&
    p.agreementFull === s.agreementFull
  );
}

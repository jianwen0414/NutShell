import type { CorrelationId, ISO8601, UsdcAmount, VaultState } from "@/types";
import { AppError } from './errors';
import { fromMicros, toMicros } from './policy';

/**
 * Premium funding.
 *
 * State is DERIVED from the ledger, never stored as a mutable balance.
 * Every figure the UI shows is a sum over immutable entries, so a premium spend
 * is auditable and the balance cannot drift out of step with what happened.
 *
 * Principal is never debited by any code path. Only accrued yield is
 * spendable. That is the whole "yield-funded protection" claim: the position
 * pays for its own insurance and the capital is untouched. If principal could
 * be spent, the product would just be a wallet with extra steps.
 */

// ── Ledger vault_ledger ──────────────────────────────────────────────

export type LedgerEntryType =
  | 'YIELD_ACCRUAL'
  | 'PREMIUM_SPEND'
  | 'PREMIUM_RECOVERY'
  | 'HARVEST';

export interface LedgerEntry {
  entryType: LedgerEntryType;
  /** Always positive. The entry type carries the direction, not the sign. */
  amountUsdc: UsdcAmount;
  correlationId?: CorrelationId;
  note?: string;
  createdAt: ISO8601;
}

/**
 * Storage boundary. In-memory today; Braiden's `lib/db.ts` will provide a
 * Postgres implementation against the real table. The driver never touches
 * storage directly, so swapping one in is a constructor argument.
 */
export interface LedgerStore {
  append(entry: LedgerEntry): Promise<void>;
  list(): Promise<LedgerEntry[]>;
}

export class InMemoryLedgerStore implements LedgerStore {
  private entries: LedgerEntry[] = [];
  async append(entry: LedgerEntry): Promise<void> {
    this.entries.push(entry);
  }
  async list(): Promise<LedgerEntry[]> {
    return [...this.entries];
  }
}

// ── Driver interface ────────────────────────────────────────────────

export interface VaultDriver {
  getState(): Promise<VaultState>;
  accrueYield(): Promise<void>;
  reservePremium(amount: UsdcAmount, cid: CorrelationId): Promise<void>;
  recoverPremium(amount: UsdcAmount, cid: CorrelationId): Promise<void>;
}

// ── Config ────────────────────────────────────────────────────────────────

export interface VaultConfig {
  /**
   * The modelled portfolio being protected. NOT the burner wallet.
   *
   * ⚠️ These two numbers must be read together. `DAILY_CAP_PCT` of 5 against
   * the burner's ~5 USDC gives a 0.25 daily cap, which is below the
   * 0.50 `MIN_FILL_USDC` floor, so no trade could ever clear it. The vault
   * models the portfolio a user would actually hold; the burner only holds
   * the premium money. `HARD_CEILING_USDC` is what keeps real spend tiny.
   */
  principalUsdc: UsdcAmount;
  apyBps: number;
  dailyCapPct: number;
  /**
   * Yield credited when the vault is first read, so a fresh demo has a
   * reserve instead of waiting days for interest. Logged as a normal ledger
   * entry with a note, never hidden.
   */
  openingAccrualUsdc: UsdcAmount;
}

export function vaultConfigFromEnv(): VaultConfig {
  const n = (k: string, d: number) => {
    const v = Number(process.env[k]);
    return Number.isFinite(v) ? v : d;
  };
  return {
    principalUsdc: process.env.VAULT_PRINCIPAL_USDC ?? '1000.00',
    apyBps: n('VAULT_APY_BPS', 500),
    dailyCapPct: n('DAILY_CAP_PCT', 5),
    openingAccrualUsdc: process.env.VAULT_OPENING_ACCRUAL_USDC ?? '12.00',
  };
}

// ── Derivation — the only place state comes from ──────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * Fold the ledger into a state. Pure, so it is testable without storage and
 * gives the same answer for the same entries every time.
 *
 * spendable = accruals + recoveries + harvests − spends
 * Principal appears in the state for display and in the daily cap, and in no
 * other calculation. There is deliberately no path from principal to spend.
 */
export function deriveState(
  entries: LedgerEntry[],
  cfg: VaultConfig,
  now: ISO8601 = new Date().toISOString(),
): VaultState {
  const nowMs = Date.parse(now);
  let accrued = 0n;
  let spent = 0n;
  let recovered = 0n;
  let harvested = 0n;
  let spentToday = 0n;

  for (const e of entries) {
    const amt = toMicros(e.amountUsdc);
    if (amt < 0n) {
      throw new AppError(
        'INTERNAL',
        `Ledger entry ${e.entryType} has a negative amount. Direction comes from the type.`,
      );
    }
    switch (e.entryType) {
      case 'YIELD_ACCRUAL':
        accrued += amt;
        break;
      case 'PREMIUM_SPEND':
        spent += amt;
        // Gross, not netted against recoveries. A buy that was later unwound
        // still consumed the day's risk budget; letting a rollback refund the
        // allowance would let a loop trade without limit.
        if (nowMs - Date.parse(e.createdAt) < MS_PER_DAY) spentToday += amt;
        break;
      case 'PREMIUM_RECOVERY':
        recovered += amt;
        break;
      case 'HARVEST':
        harvested += amt;
        break;
    }
  }

  const reserve = accrued + recovered + harvested - spent;
  const principal = toMicros(cfg.principalUsdc);
  const dailyCap = (principal * BigInt(Math.round(cfg.dailyCapPct * 100))) / 10_000n;

  return {
    driver: 'SIMULATED',
    isSimulated: true,
    principalUsdc: fromMicros(principal),
    accruedYieldUsdc: fromMicros(accrued),
    // Clamped at zero: a negative reserve would be a bug, and surfacing it as
    // spendable-in-the-negative would let sizing produce nonsense.
    premiumReserveUsdc: fromMicros(reserve > 0n ? reserve : 0n),
    dailySpentUsdc: fromMicros(spentToday),
    dailyCapUsdc: fromMicros(dailyCap),
    apyBps: cfg.apyBps,
    asOf: now,
  };
}

// ── Simulated driver ──────────────────────────────────────────────────────

/**
 * `isSimulated` is always true here and drives the honesty banner.
 * The banner text is not negotiable:
 *
 *   "Simulated vault — yield accounting is modelled. Hedge premiums are paid
 *    with real USDC on Base mainnet."
 *
 * The yield is modelled. The premiums are real. Saying both is what makes the
 * demo credible rather than a mockup with a disclaimer.
 */
export const SIMULATED_VAULT_BANNER =
  'Simulated vault — yield accounting is modelled. ' +
  'Hedge premiums are paid with real USDC on Base mainnet.';

export class SimulatedVaultDriver implements VaultDriver {
  private seeded = false;

  constructor(
    private readonly store: LedgerStore = new InMemoryLedgerStore(),
    private readonly cfg: VaultConfig = vaultConfigFromEnv(),
    /** Injected so tests never depend on the wall clock. */
    private readonly clock: () => ISO8601 = () => new Date().toISOString(),
  ) {}

  private async seed(): Promise<void> {
    if (this.seeded) return;
    this.seeded = true;
    const existing = await this.store.list();
    if (existing.length > 0) return;
    if (toMicros(this.cfg.openingAccrualUsdc) <= 0n) return;
    await this.store.append({
      entryType: 'YIELD_ACCRUAL',
      amountUsdc: this.cfg.openingAccrualUsdc,
      note: 'Opening simulated yield balance',
      createdAt: this.clock(),
    });
  }

  async getState(): Promise<VaultState> {
    await this.seed();
    return deriveState(await this.store.list(), this.cfg, this.clock());
  }

  /** One day of simulated interest on principal. Never compounds into it. */
  async accrueYield(): Promise<void> {
    await this.seed();
    const principal = toMicros(this.cfg.principalUsdc);
    const daily = (principal * BigInt(this.cfg.apyBps)) / 10_000n / 365n;
    if (daily <= 0n) return;
    await this.store.append({
      entryType: 'YIELD_ACCRUAL',
      amountUsdc: fromMicros(daily),
      note: `Simulated daily accrual at ${this.cfg.apyBps} bps`,
      createdAt: this.clock(),
    });
  }

  /**
   * The guard that makes "principal is never debited" true rather than
   * aspirational. A spend larger than accrued yield is refused outright, so no
   * code path can reach into capital even by accident.
   */
  async reservePremium(amount: UsdcAmount, cid: CorrelationId): Promise<void> {
    await this.seed();
    const amt = toMicros(amount);
    if (amt <= 0n) {
      throw new AppError('VALIDATION_FAILED', `reservePremium needs a positive amount, got ${amount}`);
    }
    const state = await this.getState();
    if (amt > toMicros(state.premiumReserveUsdc)) {
      throw new AppError(
        'INSUFFICIENT_RESERVE',
        `Premium ${amount} exceeds the reserve of ${state.premiumReserveUsdc}. ` +
          `Principal of ${state.principalUsdc} is not spendable.`,
        { requested: amount, available: state.premiumReserveUsdc },
      );
    }
    await this.store.append({
      entryType: 'PREMIUM_SPEND',
      amountUsdc: amount,
      correlationId: cid,
      createdAt: this.clock(),
    });
  }

  /** Unwind proceeds returning to the reserve. The rollback path. */
  async recoverPremium(amount: UsdcAmount, cid: CorrelationId): Promise<void> {
    await this.seed();
    const amt = toMicros(amount);
    if (amt <= 0n) {
      throw new AppError('VALIDATION_FAILED', `recoverPremium needs a positive amount, got ${amount}`);
    }
    await this.store.append({
      entryType: 'PREMIUM_RECOVERY',
      amountUsdc: amount,
      correlationId: cid,
      createdAt: this.clock(),
    });
  }
}

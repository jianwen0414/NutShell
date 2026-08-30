/**
 * Environment and risk limits — PRD §15.
 *
 * Every value is read lazily so that importing a module never throws for a
 * variable that call site does not need. Read paths work with only
 * `THETANUTS_RPC_URL` set; the signing path additionally needs
 * `THETANUTS_PRIVATE_KEY`, and asks for it only at the moment it signs.
 */

import { AppError } from './errors';
import type { Address } from '../types/index';

// ─── Chain constants — PRD §15 "Known addresses" ───────────────────────────
export const CHAIN_ID = 8453 as const;
export const BASESCAN_URL = 'https://basescan.org';

/** 🔒 The one contract the agent is permitted to call — PRD §14 allowlist. */
export const OPTION_BOOK_ADDRESS = '0x1bDff855d6811728acaDC00989e79143a2bdfDed' as Address;

/** 🔒 Vanilla cash-settled PUT implementation — PRD §3.1, confirmed against SDK config. */
export const PUT_IMPLEMENTATION_ADDRESS = '0x7355EB92dfb0503DB558a70c10843618932ab290' as Address;

export const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new AppError('VALIDATION_FAILED', `Missing required environment variable ${name}`);
  }
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new AppError('VALIDATION_FAILED', `Environment variable ${name} is not a number: ${v}`);
  }
  return n;
}

function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return v === 'true' || v === '1';
}

/** Risk limits and market-safety thresholds. Read at call time so tests can override. */
export const config = {
  /** 🔒 Never `https://mainnet.base.org` — it throttles a polling agent. PRD §6.2. */
  get rpcUrl(): string {
    return str('THETANUTS_RPC_URL');
  },
  /** Present only in the worker process. Absent means read-only / dry-run only. */
  get privateKey(): string | undefined {
    const v = process.env.THETANUTS_PRIVATE_KEY;
    return v === undefined || v === '' ? undefined : v;
  },
  get hasSigner(): boolean {
    return this.privateKey !== undefined;
  },
  /** Optional referrer for OptionBook fee sharing. Zero address when unset. */
  get referrer(): string | undefined {
    const v = process.env.THETANUTS_REFERRER;
    return v === undefined || v === '' ? undefined : v;
  },

  // ── Risk limits — PRD §15 ────────────────────────────────────────────────
  /** 🔒 Per-trade ceiling. Enforced in code; a request parameter cannot raise it. */
  get hardCeilingUsdc(): number {
    return num('HARD_CEILING_USDC', 3.0);
  },
  get minFillUsdc(): number {
    return num('MIN_FILL_USDC', 0.5);
  },
  get dailyCapPct(): number {
    return num('DAILY_CAP_PCT', 5);
  },

  // ── Market safety — PRD §3.5, §3.6 ───────────────────────────────────────
  /** Reject any quote with less than this much life left, on the feed clock. */
  get quoteMinTtlS(): number {
    return num('QUOTE_MIN_TTL_S', 60);
  },
  get maxSelectRetries(): number {
    return num('MAX_SELECT_RETRIES', 3);
  },
  /**
   * Pause between selection attempts.
   *
   * Measured over 78 consecutive polls: the whole book shares one
   * `orderExpiryTimestamp`, which sawtooths from ~117 s down to ~57 s on a
   * 60-second cycle. So for roughly 3 s in every 60 the entire book sits
   * below a 60 s TTL floor and NOTHING is fillable. Retrying instantly just
   * re-reads the same dead window; a few seconds' pause lands after the
   * maker's refresh. 4 s covers the measured dead window with margin while
   * staying far inside one quote's life.
   */
  get selectRetryDelayMs(): number {
    return num('SELECT_RETRY_DELAY_MS', 4000);
  },
  get maxClockSkewS(): number {
    return num('MAX_CLOCK_SKEW_S', 60);
  },

  // ── Strike selection — PRD §10.5 ─────────────────────────────────────────
  get targetDeltaMin(): number {
    return num('TARGET_DELTA_MIN', -0.2);
  },
  get targetDeltaMax(): number {
    return num('TARGET_DELTA_MAX', -0.05);
  },
  get minExpiryHours(): number {
    return num('MIN_EXPIRY_HOURS', 2);
  },
  /**
   * 🔒 Refuse an order whose strike sits further than this from the resolved
   * asset's spot price. Guards against a wrong feed→asset mapping silently
   * hedging the wrong asset — PRD §3.4.1.
   */
  get maxStrikeDeviationPct(): number {
    return num('MAX_STRIKE_DEVIATION_PCT', 0.6);
  },

  // ── Attestation — PRD §12 ────────────────────────────────────────────────
  get attestationMethod(): string {
    return str('ATTESTATION_METHOD', 'SELF_TX');
  },

  // ── Gonka (owned by M2; the flag is read here for the attestation payload) ─
  get gonkaIdChainResolvable(): boolean {
    return bool('GONKA_ID_CHAIN_RESOLVABLE', false);
  },
} as const;

export function basescanTxUrl(txHash: string): string {
  return `${BASESCAN_URL}/tx/${txHash}`;
}

export function basescanAddressUrl(address: string): string {
  return `${BASESCAN_URL}/address/${address}`;
}

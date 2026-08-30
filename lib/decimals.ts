/**
 * 🔒 Decimal decoding — PRD §3.3, §6.6.
 *
 * Do not inline decimal arithmetic anywhere else. Table-to-code translation
 * is precisely where a silent 100× error enters, and a 100× error here is a
 * financially wrong trade.
 *
 * Three scales are in play on the live book:
 *   · `order.strikePrice` and `order.price` — always 8 decimals
 *   · `availableAmount` / `maxCollateralUsable` — decimals of `collateralToken`
 *   · `expiry` / `orderExpiryTimestamp` — unix SECONDS (market metadata is ms)
 */

import { getChainConfigById } from '@thetanuts-finance/thetanuts-client';
import { AppError } from './errors';
import { CHAIN_ID } from './config';

/** 🔒 `strikePrice` AND `price` are both 8dp — PRD §3.3, confirmed by SDK `DECIMALS.PRICE`. */
export const PRICE_DECIMALS = 8;

/**
 * 🔒 Verified token decimals — PRD §6.6 and §15.
 *
 * Seeded from the PRD's measured table, then extended with every token the
 * SDK's Base chain config declares. Keys are lowercased; normalise before
 * lookup.
 *
 * `availableAmount` is NOT fixed at 18 decimals. The observed maximum on the
 * book was 4088290726530145000 — 4.088 WETH, the same ~$10k notional in an
 * 18-decimal token. Always divide by the decimals of `order.collateralToken`.
 */
const SEED_TOKEN_DECIMALS: Record<string, number> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 6, // USDC
  '0x4200000000000000000000000000000000000006': 18, // WETH
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 8, // cbBTC
  '0x0555e30da8f98308edb960aa94c0db47230d2b9c': 8, // WBTC
  '0x4e65fe4dba92790696d040ac24aa414708f5c0ab': 6, // aBasUSDC — Aave Base USDC
  '0xd4a0e0b9149bcee3c920d2e00b5de09138fd8bb7': 18, // aBasWETH — Aave Base WETH
};

const SEED_TOKEN_SYMBOLS: Record<string, string> = {
  '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913': 'USDC',
  '0x4200000000000000000000000000000000000006': 'WETH',
  '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 'cbBTC',
  '0x0555e30da8f98308edb960aa94c0db47230d2b9c': 'WBTC',
  '0x4e65fe4dba92790696d040ac24aa414708f5c0ab': 'aBasUSDC',
  '0xd4a0e0b9149bcee3c920d2e00b5de09138fd8bb7': 'aBasWETH',
};

const TOKEN_DECIMALS: Record<string, number> = { ...SEED_TOKEN_DECIMALS };
const TOKEN_SYMBOLS: Record<string, string> = { ...SEED_TOKEN_SYMBOLS };

// Merge the SDK's chain config. It ships aBascbBTC, cbDOGE, and cbXRP, which
// the PRD table predates. A conflict with a PRD-verified value is a hard
// error rather than a silent overwrite: the PRD values are measured, and a
// mismatch means one of the two sources is wrong and a human must look.
{
  const chainTokens = getChainConfigById(CHAIN_ID).tokens;
  for (const [symbol, token] of Object.entries(chainTokens)) {
    const key = token.address.toLowerCase();
    const seeded = SEED_TOKEN_DECIMALS[key];
    if (seeded !== undefined && seeded !== token.decimals) {
      throw new AppError(
        'ASSET_UNRESOLVED',
        `Token decimals conflict for ${symbol} (${key}): PRD table says ${seeded}, SDK chain config says ${token.decimals}. ` +
          'One of the two is wrong — resolve before trading.',
      );
    }
    TOKEN_DECIMALS[key] = token.decimals;
    TOKEN_SYMBOLS[key] = symbol;
  }
}

/** Every token address this process can decode, lowercased. */
export function knownTokens(): { address: string; symbol: string; decimals: number }[] {
  return Object.keys(TOKEN_DECIMALS).map((address) => ({
    address,
    symbol: TOKEN_SYMBOLS[address] ?? 'UNKNOWN',
    decimals: TOKEN_DECIMALS[address] as number,
  }));
}

/**
 * 🔒 Decimals of a collateral or underlying token.
 *
 * Synchronous and total: an unknown token raises `ASSET_UNRESOLVED` rather
 * than guessing 18. Guessing here decodes `availableAmount` off by up to
 * 10^12. If the venue lists a token this map does not carry, call
 * `learnTokenDecimals()` first (it reads `decimals()` on-chain) — never
 * relax this function.
 */
export function decimalsFor(token: string): number {
  const d = TOKEN_DECIMALS[token.toLowerCase()];
  if (d === undefined) {
    throw new AppError('ASSET_UNRESOLVED', `Unknown token ${token} — cannot decode its decimal scale`, {
      details: { token, known: Object.keys(TOKEN_DECIMALS) },
    });
  }
  return d;
}

export function symbolFor(token: string): string {
  return TOKEN_SYMBOLS[token.toLowerCase()] ?? token;
}

export function isKnownToken(token: string): boolean {
  return TOKEN_DECIMALS[token.toLowerCase()] !== undefined;
}

/**
 * Register a token discovered at runtime — typically from an on-chain
 * `decimals()` read when the venue lists something new. Re-registering a
 * known token with a different value throws rather than corrupting the map.
 */
export function learnTokenDecimals(token: string, decimals: number, symbol?: string): void {
  const key = token.toLowerCase();
  const existing = TOKEN_DECIMALS[key];
  if (existing !== undefined && existing !== decimals) {
    throw new AppError(
      'ASSET_UNRESOLVED',
      `Refusing to overwrite decimals for ${key}: known ${existing}, received ${decimals}`,
    );
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new AppError('ASSET_UNRESOLVED', `Implausible decimals ${decimals} for token ${key}`);
  }
  TOKEN_DECIMALS[key] = decimals;
  if (symbol) TOKEN_SYMBOLS[key] = symbol;
}

/**
 * Coerce the several shapes the SDK and its JSON fixtures use for one
 * integer: `bigint`, a decimal string, a `"123n"`-suffixed string (what a
 * BigInt-safe stringify emits), or a safe-integer `number`.
 *
 * A non-integer `number` throws: it means a float slipped in upstream, and
 * silently truncating it is how a wrong amount reaches a signer.
 */
export function toBigIntStrict(v: bigint | string | number): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) {
      throw new AppError('VALIDATION_FAILED', `Expected an integer scaled value, received float ${v}`);
    }
    if (!Number.isSafeInteger(v)) {
      throw new AppError('VALIDATION_FAILED', `Scaled value ${v} exceeds Number.MAX_SAFE_INTEGER — pass a string or bigint`);
    }
    return BigInt(v);
  }
  const s = v.trim().replace(/n$/, '');
  if (!/^-?\d+$/.test(s)) {
    throw new AppError('VALIDATION_FAILED', `Expected an integer scaled value, received "${v}"`);
  }
  return BigInt(s);
}

/**
 * 🔒 bigint | string | number → fixed-point decimal string.
 * Never returns a float, so no value ever loses precision on the way to the
 * database, the API, or the UI.
 */
export function fromScaled(v: bigint | string | number, decimals: number): string {
  const s = toBigIntStrict(v);
  const neg = s < 0n;
  const abs = neg ? -s : s;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
}

/**
 * 🔒 Decimal string → scaled bigint. Truncates toward zero beyond `decimals`,
 * which is the correct DeFi behaviour: never round a spend amount UP.
 */
export function toScaled(v: string, decimals: number): bigint {
  const trimmed = v.trim();
  if (!/^-?\d*(\.\d*)?$/.test(trimmed) || trimmed === '' || trimmed === '.' || trimmed === '-') {
    throw new AppError('VALIDATION_FAILED', `Not a decimal string: "${v}"`);
  }
  const neg = trimmed.startsWith('-');
  const body = neg ? trimmed.slice(1) : trimmed;
  const [w = '', f = ''] = body.split('.');
  const whole = w === '' ? '0' : w;
  const scaled = BigInt(whole + f.padEnd(decimals, '0').slice(0, decimals));
  return neg ? -scaled : scaled;
}

/** 🔒 `order.strikePrice` and `order.price` — always 8dp. */
export const decodePrice = (v: bigint | string | number): string => fromScaled(v, PRICE_DECIMALS);

/** 🔒 `availableAmount` / `maxCollateralUsable` — decimals of the COLLATERAL token. */
export const decodeAmount = (v: bigint | string | number, collateralToken: string): string =>
  fromScaled(v, decimalsFor(collateralToken));

export const encodePrice = (v: string): bigint => toScaled(v, PRICE_DECIMALS);
export const encodeAmount = (v: string, collateralToken: string): bigint =>
  toScaled(v, decimalsFor(collateralToken));

/** Unix SECONDS (order timestamps) → ISO 8601. */
export function unixSecondsToIso(v: bigint | string | number): string {
  return new Date(Number(toBigIntStrict(v)) * 1000).toISOString();
}

/** Unix MILLISECONDS (market-data metadata) → ISO 8601. */
export function unixMillisToIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Multiply two decimal strings exactly, at `outDecimals` precision, with no
 * float step. Used for notional (contracts × strike) and premium totals,
 * where a float round-trip would show a user "$3972.5299999999997".
 */
export function mulDecimal(a: string, b: string, outDecimals: number): string {
  const SCALE = 18;
  const product = toScaled(a, SCALE) * toScaled(b, SCALE); // 36 dp
  const drop = 10n ** BigInt(2 * SCALE - outDecimals);
  return fromScaled(product / drop, outDecimals);
}

/**
 * Divide two decimal strings at `outDecimals` precision, truncating toward
 * zero. Division by zero throws rather than yielding Infinity.
 */
export function divDecimal(a: string, b: string, outDecimals: number): string {
  const SCALE = 18;
  const denominator = toScaled(b, SCALE);
  if (denominator === 0n) {
    throw new AppError('VALIDATION_FAILED', `Division by zero: ${a} / ${b}`);
  }
  const numerator = toScaled(a, SCALE) * 10n ** BigInt(outDecimals);
  return fromScaled(numerator / denominator, outDecimals);
}

/** Compare two decimal strings exactly. Returns -1, 0, or 1. */
export function cmpDecimal(a: string, b: string): -1 | 0 | 1 {
  const SCALE = 18;
  const x = toScaled(a, SCALE);
  const y = toScaled(b, SCALE);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Smaller of two decimal strings. */
export function minDecimal(a: string, b: string): string {
  return cmpDecimal(a, b) <= 0 ? a : b;
}

/**
 * Render a decimal string for display at a fixed precision, truncating
 * rather than rounding. Presentation only — never feed the result back into
 * arithmetic or into a transaction.
 */
export function formatDecimal(v: string, places: number): string {
  const [w = '0', f = ''] = v.split('.');
  return places === 0 ? w : `${w}.${f.padEnd(places, '0').slice(0, places)}`;
}

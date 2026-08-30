/**
 * 🔒 Decoder tests against the golden fixture — PRD §6.6.
 *
 * These four assertions are the PRD's own acceptance criteria. If any of them
 * fails, a trade built by this codebase is financially wrong.
 */

import { describe, expect, it } from 'vitest';
import golden from '../fixtures/order.eth-put-2400.json';
import {
  PRICE_DECIMALS,
  cmpDecimal,
  decimalsFor,
  decodeAmount,
  decodePrice,
  divDecimal,
  formatDecimal,
  fromScaled,
  isKnownToken,
  learnTokenDecimals,
  minDecimal,
  mulDecimal,
  symbolFor,
  toBigIntStrict,
  toScaled,
  unixSecondsToIso,
} from '../lib/decimals';
import { AppError } from '../lib/errors';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const WETH = '0x4200000000000000000000000000000000000006';
const WBTC = '0x0555E30da8f98308EdB960aa94C0Db47230d2B9c';
const aBasUSDC = '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB';
const aBasWETH = '0xD4a0e0b9149BCee3C920d2E00b5dE09138fd8bb7';

describe('PRD §6.6 acceptance criteria', () => {
  it('decodePrice("240000000000") === "2400"', () => {
    expect(decodePrice('240000000000')).toBe('2400');
  });

  it('decodePrice("215059967") === "2.15059967"', () => {
    expect(decodePrice('215059967')).toBe('2.15059967');
  });

  it('decodeAmount("10000000000", USDC) === "10000"', () => {
    expect(decodeAmount('10000000000', USDC)).toBe('10000');
  });

  it('decodeAmount("4088290726530145000", WETH) === "4.088290726530145"', () => {
    expect(decodeAmount('4088290726530145000', WETH)).toBe('4.088290726530145');
  });
});

describe('golden fixture — order.eth-put-2400.json', () => {
  it('decodes the strike to exactly $2,400.00', () => {
    expect(decodePrice(golden.order.strikePrice)).toBe('2400');
    expect(decodePrice(golden.order.strikes[0] as string)).toBe('2400');
  });

  it('decodes the premium to exactly $2.15059967', () => {
    expect(decodePrice(golden.order.price)).toBe('2.15059967');
  });

  it('decodes availableAmount against the ORDER collateral token, not a fixed 18dp', () => {
    expect(decodeAmount(golden.availableAmount, golden.order.collateralToken)).toBe('10000');
    // The same integer read at 18dp would be off by 10^12 — the exact silent
    // error the collateral-keyed lookup exists to prevent.
    expect(fromScaled(golden.availableAmount, 18)).toBe('0.00000001');
  });

  it('decodes maxCollateralUsable identically to availableAmount', () => {
    expect(decodeAmount(golden.rawApiData.maxCollateralUsable, golden.rawApiData.collateral)).toBe('10000');
  });

  it('reads expiry as unix SECONDS', () => {
    expect(unixSecondsToIso(golden.order.expiry)).toBe('2026-08-30T08:00:00.000Z');
  });

  it('keeps orderExpiryTimestamp (quote TTL) distinct from option expiry', () => {
    expect(Number(golden.rawApiData.orderExpiryTimestamp)).toBeLessThan(Number(golden.order.expiry));
    expect(Number(golden.order.expiry) - Number(golden.rawApiData.orderExpiryTimestamp)).toBe(60420);
  });

  it('parses cleanly with no BigInt replacer — the fixture is JSON-safe', () => {
    expect(() => JSON.stringify(golden)).not.toThrow();
  });
});

describe('token decimals registry', () => {
  it('carries every PRD §6.6 token at its verified scale', () => {
    expect(decimalsFor(USDC)).toBe(6);
    expect(decimalsFor(WETH)).toBe(18);
    expect(decimalsFor(WBTC)).toBe(8);
    expect(decimalsFor('0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf')).toBe(8); // cbBTC
    expect(decimalsFor(aBasUSDC)).toBe(6);
    expect(decimalsFor(aBasWETH)).toBe(18);
  });

  it('is case-insensitive on the address', () => {
    expect(decimalsFor(USDC.toLowerCase())).toBe(6);
    expect(decimalsFor(USDC.toUpperCase().replace('0X', '0x'))).toBe(6);
  });

  it('carries the aTokens the market maker collateralises in — PRD §3.8', () => {
    expect(symbolFor(aBasUSDC)).toBe('aBasUSDC');
    expect(symbolFor(aBasWETH)).toBe('aBasWETH');
  });

  it('REFUSES an unknown token rather than assuming 18 decimals', () => {
    expect(() => decimalsFor('0x1111111111111111111111111111111111111111')).toThrow(AppError);
    try {
      decimalsFor('0x1111111111111111111111111111111111111111');
    } catch (e) {
      expect((e as AppError).code).toBe('ASSET_UNRESOLVED');
    }
  });

  it('accepts a runtime-learned token but refuses to silently redefine one', () => {
    const novel = '0x2222222222222222222222222222222222222222';
    expect(isKnownToken(novel)).toBe(false);
    learnTokenDecimals(novel, 9, 'NOVEL');
    expect(decimalsFor(novel)).toBe(9);
    expect(() => learnTokenDecimals(novel, 18)).toThrow(AppError);
  });
});

describe('fromScaled / toScaled', () => {
  it('never returns a float, at any magnitude', () => {
    expect(fromScaled('1', 18)).toBe('0.000000000000000001');
    expect(fromScaled('1000000000000000000000000', 18)).toBe('1000000');
    expect(fromScaled(0n, 6)).toBe('0');
  });

  it('handles the "123n" suffix a BigInt-safe stringify emits', () => {
    expect(fromScaled('215059967n', 8)).toBe('2.15059967');
    expect(toBigIntStrict('240000000000n')).toBe(240000000000n);
  });

  it('handles negatives', () => {
    expect(fromScaled(-2150599670n, 8)).toBe('-21.5059967');
    expect(toScaled('-2.5', 6)).toBe(-2500000n);
  });

  it('truncates toward zero rather than rounding a spend amount up', () => {
    expect(toScaled('1.9999999', 6)).toBe(1999999n);
    expect(toScaled('0.0000009', 6)).toBe(0n);
  });

  it('round-trips every price on the live delta band', () => {
    for (const v of ['2400', '2.15059967', '1.228435', '0.00000001', '78125.26']) {
      expect(fromScaled(toScaled(v, PRICE_DECIMALS), PRICE_DECIMALS)).toBe(v);
    }
  });

  it('rejects a float where a scaled integer is required', () => {
    expect(() => toBigIntStrict(2.5)).toThrow(AppError);
    expect(() => toBigIntStrict('2.5')).toThrow(AppError);
    expect(() => toBigIntStrict('not a number')).toThrow(AppError);
  });

  it('rejects a number past MAX_SAFE_INTEGER instead of losing precision', () => {
    expect(() => toBigIntStrict(2 ** 53)).toThrow(AppError);
  });

  it('rejects malformed decimal strings', () => {
    for (const bad of ['', '.', '-', 'abc', '1.2.3']) {
      expect(() => toScaled(bad, 6)).toThrow(AppError);
    }
  });
});

describe('exact decimal arithmetic', () => {
  it('computes notional as contracts × strike with no float drift', () => {
    // 1.628087 contracts × $2,440 — the float path yields 3972.5322799999997.
    expect(mulDecimal('1.628087', '2440', 6)).toBe('3972.53228');
  });

  it('computes contracts as premium ÷ price', () => {
    expect(divDecimal('2', '1.228435', 6)).toBe('1.628087');
  });

  it('refuses division by zero rather than returning Infinity', () => {
    expect(() => divDecimal('1', '0', 6)).toThrow(AppError);
  });

  it('compares and takes minima exactly', () => {
    expect(cmpDecimal('2.15', '2.150')).toBe(0);
    expect(cmpDecimal('2.15', '2.16')).toBe(-1);
    expect(cmpDecimal('10', '9.99999999')).toBe(1);
    expect(minDecimal('3.00', '2.15')).toBe('2.15');
  });

  it('formats for display by truncating, never rounding', () => {
    expect(formatDecimal('2.15059967', 2)).toBe('2.15');
    expect(formatDecimal('2.19999999', 2)).toBe('2.19');
    expect(formatDecimal('2400', 2)).toBe('2400.00');
    expect(formatDecimal('2400.5', 0)).toBe('2400');
  });
});

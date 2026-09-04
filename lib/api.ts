import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { CorrelationId, ErrorCode, ErrorEnvelope } from "@/types";

const RETRYABLE = new Set<ErrorCode>([
  "RATE_LIMITED",
  "GONKA_UNAVAILABLE",
  "GONKA_TIMEOUT",
  "GONKA_MALFORMED_JSON",
  "GONKA_QUORUM_FAILED",
  "RPC_UNAVAILABLE",
  "MARKET_DATA_STALE",
  "NO_FILLABLE_ORDER",
  "QUOTE_EXPIRED",
  "TX_REVERTED",
]);

const STATUS: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHORIZED: 401,
  RATE_LIMITED: 429,
  INSUFFICIENT_GAS: 402,
  NO_FILLABLE_ORDER: 409,
  QUOTE_EXPIRED: 409,
  INSUFFICIENT_RESERVE: 409,
  DAILY_CAP_EXCEEDED: 409,
  SIZE_BELOW_MINIMUM: 409,
  GONKA_TIMEOUT: 504,
  GONKA_UNAVAILABLE: 502,
  GONKA_MALFORMED_JSON: 502,
  GONKA_QUORUM_FAILED: 502,
  RPC_UNAVAILABLE: 502,
  TX_REVERTED: 502,
  MARKET_DATA_STALE: 503,
  ASSET_UNRESOLVED: 500,
  AGENT_PAUSED: 423,
  INTERNAL: 500,
};

export function json<T>(body: T, correlationId: CorrelationId, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("X-Correlation-Id", correlationId);
  return NextResponse.json(body, { ...init, headers });
}

export function errorJson(
  code: ErrorCode,
  message: string,
  correlationId: CorrelationId,
  details?: Record<string, unknown>,
) {
  const body: ErrorEnvelope = {
    error: { code, message, retryable: RETRYABLE.has(code), correlationId, details },
  };
  return json(body, correlationId, { status: STATUS[code] ?? 500 });
}

/**
 * Constant-time string comparison.
 *
 * `===` on a secret leaks its prefix through timing. The tokens here guard a
 * burner holding a few USDC, so this is not the difference between safe and
 * unsafe — but the routes it protects can sign mainnet transactions, and a
 * comparison that is correct by construction costs nothing.
 */
function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // timingSafeEqual throws on a length mismatch, which would reintroduce the
  // leak it exists to close. Compare a fixed-width digest instead.
  const ha = createHash("sha256").update(left).digest();
  const hb = createHash("sha256").update(right).digest();
  return timingSafeEqual(ha, hb);
}

export function hasOperatorToken(request: Request) {
  const token = process.env.OPERATOR_TOKEN;
  if (!token) return false;
  const header = request.headers.get("authorization");
  if (!header) return false;
  return secretsMatch(header, `Bearer ${token}`);
}

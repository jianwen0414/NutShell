/**
 * 🔒 Error codes, HTTP mapping, and the envelope helper — PRD §9.1, §9.2.
 *
 * Every non-2xx response in this system carries the `ErrorEnvelope` shape.
 * No bare strings, ever.
 */

import { randomBytes } from 'node:crypto';
import type { CorrelationId, ErrorCode, ErrorEnvelope } from '../types/index';

/** 🔒 The error registry from PRD §9.2 — HTTP status and retryability per code. */
export const ERROR_REGISTRY: Record<ErrorCode, { http: number; retryable: boolean }> = {
  VALIDATION_FAILED: { http: 400, retryable: false },
  UNAUTHORIZED: { http: 401, retryable: false },
  RATE_LIMITED: { http: 429, retryable: true },
  GONKA_UNAVAILABLE: { http: 502, retryable: true },
  GONKA_TIMEOUT: { http: 504, retryable: true },
  GONKA_MALFORMED_JSON: { http: 502, retryable: true },
  GONKA_QUORUM_FAILED: { http: 502, retryable: true },
  RPC_UNAVAILABLE: { http: 502, retryable: true },
  MARKET_DATA_STALE: { http: 503, retryable: true },
  NO_FILLABLE_ORDER: { http: 409, retryable: true },
  QUOTE_EXPIRED: { http: 409, retryable: true },
  ASSET_UNRESOLVED: { http: 500, retryable: false },
  INSUFFICIENT_RESERVE: { http: 409, retryable: false },
  DAILY_CAP_EXCEEDED: { http: 409, retryable: false },
  SIZE_BELOW_MINIMUM: { http: 409, retryable: false },
  TX_REVERTED: { http: 502, retryable: true },
  INSUFFICIENT_GAS: { http: 402, retryable: false },
  // Not failures: idempotency replay and a policy REJECT/WATCH both return 200.
  DUPLICATE_REQUEST: { http: 200, retryable: false },
  POLICY_REJECTED: { http: 200, retryable: false },
  INTERNAL: { http: 500, retryable: false },
};

/** 🔒 Correlation ID format — PRD §7: "nsh_" + 16 hex characters. */
export function newCorrelationId(): CorrelationId {
  return `nsh_${randomBytes(8).toString('hex')}`;
}

const CORRELATION_ID_RE = /^nsh_[0-9a-f]{16}$/;

export function isCorrelationId(value: unknown): value is CorrelationId {
  return typeof value === 'string' && CORRELATION_ID_RE.test(value);
}

/**
 * The single error type this codebase throws. Carries the wire code, so any
 * layer can turn a caught error into a correct HTTP response without a
 * translation table of its own.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly http: number;
  readonly retryable: boolean;
  readonly correlationId: CorrelationId;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { correlationId?: CorrelationId; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'AppError';
    this.code = code;
    const entry = ERROR_REGISTRY[code];
    this.http = entry.http;
    this.retryable = entry.retryable;
    this.correlationId = opts.correlationId ?? newCorrelationId();
    this.details = opts.details;
    Error.captureStackTrace?.(this, AppError);
  }

  toEnvelope(): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        correlationId: this.correlationId,
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }

  /** JSON-safe form for logging. Never includes the stack in production output. */
  toLogLine(): Record<string, unknown> {
    return {
      level: 'error',
      code: this.code,
      correlationId: this.correlationId,
      message: this.message,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/**
 * Normalise any thrown value into an AppError. Unknown throws become
 * INTERNAL rather than leaking a raw message shape to callers.
 */
export function toAppError(e: unknown, correlationId?: CorrelationId): AppError {
  if (isAppError(e)) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new AppError('INTERNAL', message, { correlationId, cause: e });
}

/** Build an envelope directly, for call sites that respond without throwing. */
export function errorEnvelope(
  code: ErrorCode,
  message: string,
  correlationId: CorrelationId,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  return new AppError(code, message, { correlationId, details }).toEnvelope();
}

/**
 * BigInt-safe JSON stringify. 🔒 PRD §6.4 / §16: plain `JSON.stringify`
 * THROWS on SDK order objects, many of whose fields are `bigint`.
 */
export function safeStringify(value: unknown, space?: number): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v), space);
}

/**
 * Deep-clone a value into plain JSON with every `bigint` rendered as a
 * decimal string (no `n` suffix). Use this before any value crosses a JSON
 * boundary — PRD §7 invariant 2.
 */
export function toJsonSafe<T = unknown>(value: unknown): T {
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))) as T;
}

/**
 * Map a Thetanuts SDK error onto our registry. The SDK throws its own typed
 * errors (`ThetanutsError` with a `code` field); translating them here keeps
 * SDK vocabulary out of the API surface.
 *
 * Matches on the SDK's documented `ThetanutsErrorCode` values first, then
 * falls back to message inspection for provider-level failures that surface
 * as plain ethers errors.
 */
export function mapSdkError(e: unknown, correlationId?: CorrelationId): AppError {
  if (isAppError(e)) return e;

  const sdkCode = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
  const message = e instanceof Error ? e.message : String(e);
  const opts = { correlationId, cause: e, details: { sdkCode: sdkCode || undefined } };

  switch (sdkCode) {
    case 'ORDER_EXPIRED':
      return new AppError('QUOTE_EXPIRED', `Order expired before the fill landed: ${message}`, opts);
    case 'ORDER_NOT_FOUND':
    case 'INVALID_ORDER':
    case 'SIZE_EXCEEDED':
      return new AppError('NO_FILLABLE_ORDER', message, opts);
    case 'INSUFFICIENT_BALANCE':
    case 'INSUFFICIENT_ALLOWANCE':
      return new AppError('INSUFFICIENT_RESERVE', message, opts);
    case 'CONTRACT_REVERT':
      return new AppError('TX_REVERTED', message, opts);
    case 'SLIPPAGE_EXCEEDED':
      return new AppError('QUOTE_EXPIRED', `Price moved past the slippage bound: ${message}`, opts);
    case 'RATE_LIMIT':
      return new AppError('RATE_LIMITED', message, opts);
    case 'HTTP_ERROR':
    case 'NOT_FOUND':
    case 'WEBSOCKET_ERROR':
      return new AppError('RPC_UNAVAILABLE', message, opts);
    case 'INVALID_PARAMS':
    case 'BAD_REQUEST':
      return new AppError('VALIDATION_FAILED', message, opts);
    case 'NETWORK_UNSUPPORTED':
      return new AppError('VALIDATION_FAILED', `Unsupported network: ${message}`, opts);
    case 'SIGNER_REQUIRED':
      return new AppError('UNAUTHORIZED', `No signer configured: ${message}`, opts);
  }

  // ethers / provider-level failures arrive without an SDK code.
  const lower = message.toLowerCase();
  if (/insufficient funds/.test(lower)) {
    return new AppError('INSUFFICIENT_GAS', `Burner cannot cover gas: ${message}`, opts);
  }
  if (/\b(network|timeout|econnrefused|enotfound|etimedout|fetch failed|socket hang up)\b/.test(lower)) {
    return new AppError('RPC_UNAVAILABLE', message, opts);
  }
  if (/revert|execution reverted|call_exception/.test(lower)) {
    return new AppError('TX_REVERTED', message, opts);
  }

  return new AppError('INTERNAL', message, opts);
}

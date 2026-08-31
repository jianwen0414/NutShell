import type { ErrorCode, ErrorEnvelope, CorrelationId } from '../types/index.js';

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'GONKA_UNAVAILABLE',
  'GONKA_TIMEOUT',
  'GONKA_MALFORMED_JSON',
  'RPC_UNAVAILABLE',
  'MARKET_DATA_STALE',
  'QUOTE_EXPIRED',
  'RATE_LIMITED',
]);

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }

  toEnvelope(correlationId: CorrelationId): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        correlationId,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

/** Any thrown value -> AppError. Unknown failures become INTERNAL. */
export function asAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  return new AppError('INTERNAL', e instanceof Error ? e.message : String(e));
}

export function newCorrelationId(): CorrelationId {
  const hex = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return `nsh_${hex}`;
}

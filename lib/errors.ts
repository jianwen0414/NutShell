import type { CorrelationId, ErrorCode, ErrorEnvelope } from "@/types";

const RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  "RATE_LIMITED",
  "GONKA_UNAVAILABLE",
  "GONKA_TIMEOUT",
  "GONKA_MALFORMED_JSON",
  "RPC_UNAVAILABLE",
  "MARKET_DATA_STALE",
  "QUOTE_EXPIRED",
]);

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly correlationId?: CorrelationId,
  ) {
    super(message);
    this.name = "AppError";
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

/** Any thrown value to an AppError. Unknown failures become INTERNAL. */
export function asAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  return new AppError("INTERNAL", e instanceof Error ? e.message : String(e));
}

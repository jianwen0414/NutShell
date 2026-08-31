import type { CorrelationId, ErrorCode } from "@/types";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly correlationId?: CorrelationId,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

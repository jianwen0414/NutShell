import type { CorrelationId } from "@/types";

export function newCorrelationId(): CorrelationId {
  return `nsh_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

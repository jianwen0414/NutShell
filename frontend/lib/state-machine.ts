import type { JobStatus } from "@/types";
import { AppError } from "./errors";

export const JOB_STATUS_ORDER: JobStatus[] = [
  "QUEUED",
  "VERIFYING",
  "VERIFIED",
  "DECIDED",
  "SELECTING",
  "EXECUTING",
  "EXECUTED",
  "ATTESTED",
];

const VALID_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  QUEUED: ["VERIFYING", "FAILED"],
  VERIFYING: ["VERIFIED", "REJECTED", "FAILED"],
  VERIFIED: ["DECIDED", "REJECTED", "FAILED"],
  DECIDED: ["SELECTING", "REJECTED", "FAILED"],
  SELECTING: ["EXECUTING", "FAILED"],
  EXECUTING: ["EXECUTED", "FAILED"],
  EXECUTED: ["ATTESTED", "FAILED"],
  ATTESTED: [], // Terminal success
  REJECTED: [], // Terminal rejection
  FAILED: [],   // Terminal failure
};

/**
 * Checks whether transitioning from `from` to `to` status is allowed.
 */
export function isValidTransition(from: JobStatus, to: JobStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Asserts a valid transition or throws an AppError.
 */
export function assertValidTransition(from: JobStatus, to: JobStatus): void {
  if (!isValidTransition(from, to)) {
    throw new AppError(
      "VALIDATION_FAILED",
      `Invalid job state transition from ${from} to ${to}`,
    );
  }
}

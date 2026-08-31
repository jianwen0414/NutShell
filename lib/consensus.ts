import type { ConsensusMetrics, ModelVerdict, Stance } from "@/types";
import { AppError } from './errors';

/** Quorum is 2 of 3. Never trade on a single model's opinion. */
export const QUORUM_MIN = 2;

type Severity = 1 | 2 | 3 | 4 | 5;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/**
 * Median. There is no agreed tie rule for an even count, so we take the
 * arithmetic midpoint and round half up, which biases toward the more severe
 * reading. Only reachable at quorum = 2. See NOTE-A in the probe output.
 */
function medianSeverity(xs: Severity[]): Severity {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length / 2;
  const raw =
    s.length % 2 === 1
      ? s[Math.floor(mid)]!
      : (s[mid - 1]! + s[mid]!) / 2;
  return Math.min(5, Math.max(1, Math.round(raw))) as Severity;
}

/**
 * Fraction of models sharing the modal stance.
 * With n=3 this is 1.0, 0.667 or 0.333. With n=2 it is 1.0 or 0.5 — a two-way
 * split has no true mode, and 0.5 is the honest reading of "no majority".
 */
function concordanceOf(stances: Stance[]): number {
  const counts = new Map<Stance, number>();
  for (const s of stances) counts.set(s, (counts.get(s) ?? 0) + 1);
  const top = Math.max(...counts.values());
  return top / stances.length;
}

/**
 * Mechanical. The synthesizer never touches these numbers.
 * @param verdicts layer-1 ANALYST verdicts only — never include the synthesizer.
 */
export function computeConsensus(
  verdicts: ModelVerdict[],
  opts: { debateTriggered?: boolean } = {},
): ConsensusMetrics {
  const analysts = verdicts.filter((v) => v.role === 'ANALYST');

  if (analysts.length < QUORUM_MIN) {
    throw new AppError(
      'GONKA_QUORUM_FAILED',
      `Only ${analysts.length} of 3 models returned a valid verdict; quorum is ${QUORUM_MIN}.`,
      { modelsResponded: analysts.length },
    );
  }

  const scores = analysts.map((v) => v.claimScore);
  const truthScore = mean(scores);
  const spread = Math.max(...scores) - Math.min(...scores);
  const concordance = concordanceOf(analysts.map((v) => v.stance));
  const agreement = concordance * (1 - Math.min(spread, 100) / 100);

  return {
    truthScore: round2(truthScore),
    severity: medianSeverity(analysts.map((v) => v.severity)),
    agreement: round4(agreement),
    spread,
    concordance: round4(concordance),
    conviction: round4((truthScore / 100) * agreement),
    debateTriggered: opts.debateTriggered ?? false,
    modelsResponded: analysts.length,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

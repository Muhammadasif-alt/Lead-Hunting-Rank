export interface BackoffPolicy {
  baseMs: number;
  factor: number;
  maxMs: number;
}

/** Default for jobs: 5 s, 20 s, 80 s, ~5 min, ~21 min, capped at 30 min. */
export const JOB_BACKOFF: BackoffPolicy = { baseMs: 5_000, factor: 4, maxMs: 30 * 60_000 };

/** Outbox publishing only fails when Redis is unreachable: retry quickly, then settle at 1 min. */
export const OUTBOX_BACKOFF: BackoffPolicy = { baseMs: 1_000, factor: 2, maxMs: 60_000 };

/**
 * Exponential backoff with "equal jitter" (docs/07 §53): half the delay is fixed, half random, so retries
 * spread out instead of hammering a recovering provider in lockstep. `attempt` is 1-based.
 */
export function backoffDelay(attempt: number, policy: BackoffPolicy = JOB_BACKOFF, random: () => number = Math.random): number {
  const exp = Math.min(policy.maxMs, policy.baseMs * policy.factor ** Math.max(0, attempt - 1));
  return Math.round(exp / 2 + random() * (exp / 2));
}

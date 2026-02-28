import type { DeterministicRandom } from "../plan/templating.js";

export interface RetryPolicy {
  maxAttempts: number;
  backoffMs: number[];
  jitter: boolean;
  retryOn: {
    statuses: number[];
    timeouts: boolean;
    networkErrors: boolean;
  };
}

export type AttemptOutcome = "success" | "http_error" | "network_error" | "timeout";

export function shouldRetry(
  outcome: AttemptOutcome,
  statusCode: number | undefined,
  attempt: number,
  policy: RetryPolicy
): boolean {
  if (attempt >= policy.maxAttempts) {
    return false;
  }
  if (outcome === "timeout" && policy.retryOn.timeouts) return true;
  if (outcome === "network_error" && policy.retryOn.networkErrors) return true;
  if (outcome === "http_error" && statusCode !== undefined && policy.retryOn.statuses.includes(statusCode)) {
    return true;
  }
  return false;
}

export function computeBackoffMs(attempt: number, policy: RetryPolicy, random: DeterministicRandom): number {
  const idx = Math.max(0, attempt - 1);
  const base = policy.backoffMs[idx] ?? policy.backoffMs[policy.backoffMs.length - 1] ?? 0;
  if (!policy.jitter || base === 0) return base;
  return Math.floor(base * (0.5 + random.float()));
}

import type { HistogramSnapshot } from "../metrics/histogram.js";

export interface ReportStats {
  name: string;
  successes: number;
  httpErrors: number;
  networkErrors: number;
  timeouts: number;
  retries: number;
  clientDrops: number;
  totalLatencyMs: number;
  completed: number;
  avgLatencyMs: number;
  errorRatePct: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  histogram: HistogramSnapshot;
}

export interface LoadBuddyReport {
  metadata: {
    startTime: string;
    durationSec: number;
    seed: number;
    baseUrl: string;
    nodeVersion: string;
    thresholds?: {
      p95LatencyMs?: number;
      errorRatePct?: number;
    };
    thresholdsViolated?: boolean;
  };
  perPhase: ReportStats[];
  overall: ReportStats;
  perEndpoint: ReportStats[];
}

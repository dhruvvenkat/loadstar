import { Histogram, type HistogramSnapshot } from "./histogram.js";

export interface MetricCounters {
  successes: number;
  httpErrors: number;
  networkErrors: number;
  timeouts: number;
  retries: number;
  clientDrops: number;
  totalLatencyMs: number;
  completed: number;
}

export interface StatsSnapshot {
  achievedRps: number;
  inFlight: number;
  counters: Omit<MetricCounters, "totalLatencyMs"> & { avgLatencyMs: number; errorRatePct: number };
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
}

export interface EndpointSummary extends MetricCounters {
  name: string;
  avgLatencyMs: number;
  errorRatePct: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  histogram: HistogramSnapshot;
}

export interface PhaseSummary extends EndpointSummary {}

interface BucketedStats {
  counters: MetricCounters;
  histogram: Histogram;
}

function createCounters(): MetricCounters {
  return {
    successes: 0,
    httpErrors: 0,
    networkErrors: 0,
    timeouts: 0,
    retries: 0,
    clientDrops: 0,
    totalLatencyMs: 0,
    completed: 0
  };
}

function updateCount(counters: MetricCounters, kind: "success" | "http_error" | "network_error" | "timeout"): void {
  if (kind === "success") counters.successes += 1;
  if (kind === "http_error") counters.httpErrors += 1;
  if (kind === "network_error") counters.networkErrors += 1;
  if (kind === "timeout") counters.timeouts += 1;
  counters.completed += 1;
}

export class MetricsAggregator {
  private readonly overall: BucketedStats = { counters: createCounters(), histogram: new Histogram() };

  private readonly perEndpoint = new Map<string, BucketedStats>();

  private readonly perPhase = new Map<string, BucketedStats>();

  private lastSnapshotCompleted = 0;

  recordAttempt(
    endpointName: string,
    phaseName: string,
    outcome: "success" | "http_error" | "network_error" | "timeout",
    latencyMs: number
  ): void {
    const endpoint = this.getOrCreate(this.perEndpoint, endpointName);
    const phase = this.getOrCreate(this.perPhase, phaseName);

    this.overall.histogram.record(latencyMs);
    endpoint.histogram.record(latencyMs);
    phase.histogram.record(latencyMs);

    this.overall.counters.totalLatencyMs += latencyMs;
    endpoint.counters.totalLatencyMs += latencyMs;
    phase.counters.totalLatencyMs += latencyMs;

    updateCount(this.overall.counters, outcome);
    updateCount(endpoint.counters, outcome);
    updateCount(phase.counters, outcome);
  }

  recordRetry(endpointName: string, phaseName: string): void {
    const endpoint = this.getOrCreate(this.perEndpoint, endpointName);
    const phase = this.getOrCreate(this.perPhase, phaseName);
    this.overall.counters.retries += 1;
    endpoint.counters.retries += 1;
    phase.counters.retries += 1;
  }

  recordClientDrop(endpointName: string, phaseName: string): void {
    const endpoint = this.getOrCreate(this.perEndpoint, endpointName);
    const phase = this.getOrCreate(this.perPhase, phaseName);
    this.overall.counters.clientDrops += 1;
    endpoint.counters.clientDrops += 1;
    phase.counters.clientDrops += 1;
  }

  snapshot(inFlight: number, intervalSec: number): StatsSnapshot {
    const completed = this.overall.counters.completed;
    const delta = completed - this.lastSnapshotCompleted;
    this.lastSnapshotCompleted = completed;
    const avgLatencyMs = completed > 0 ? this.overall.counters.totalLatencyMs / completed : 0;
    const errors = this.overall.counters.httpErrors + this.overall.counters.networkErrors + this.overall.counters.timeouts;
    const errorRatePct = completed > 0 ? (errors / completed) * 100 : 0;

    return {
      achievedRps: delta / intervalSec,
      inFlight,
      counters: {
        successes: this.overall.counters.successes,
        httpErrors: this.overall.counters.httpErrors,
        networkErrors: this.overall.counters.networkErrors,
        timeouts: this.overall.counters.timeouts,
        retries: this.overall.counters.retries,
        clientDrops: this.overall.counters.clientDrops,
        completed,
        avgLatencyMs,
        errorRatePct
      },
      p50LatencyMs: this.overall.histogram.percentile(50),
      p95LatencyMs: this.overall.histogram.percentile(95),
      p99LatencyMs: this.overall.histogram.percentile(99)
    };
  }

  overallSummary(): EndpointSummary {
    return this.toSummary("overall", this.overall);
  }

  endpointSummaries(): EndpointSummary[] {
    return [...this.perEndpoint.entries()].map(([name, stats]) => this.toSummary(name, stats));
  }

  phaseSummaries(): PhaseSummary[] {
    return [...this.perPhase.entries()].map(([name, stats]) => this.toSummary(name, stats));
  }

  private getOrCreate(map: Map<string, BucketedStats>, key: string): BucketedStats {
    const existing = map.get(key);
    if (existing) return existing;
    const created: BucketedStats = { counters: createCounters(), histogram: new Histogram() };
    map.set(key, created);
    return created;
  }

  private toSummary(name: string, stats: BucketedStats): EndpointSummary {
    const { counters, histogram } = stats;
    const errorCount = counters.httpErrors + counters.networkErrors + counters.timeouts;
    const avgLatencyMs = counters.completed > 0 ? counters.totalLatencyMs / counters.completed : 0;
    const errorRatePct = counters.completed > 0 ? (errorCount / counters.completed) * 100 : 0;
    return {
      name,
      ...counters,
      avgLatencyMs,
      errorRatePct,
      p50LatencyMs: histogram.percentile(50),
      p95LatencyMs: histogram.percentile(95),
      p99LatencyMs: histogram.percentile(99),
      histogram: histogram.snapshot()
    };
  }
}

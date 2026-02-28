import pino from "pino";
import type { LoadPlan } from "../plan/loadPlan.js";
import { createPrng, expandJsonTemplate, expandTemplate, type DeterministicRandom } from "../plan/templating.js";
import { MetricsAggregator } from "../metrics/aggregator.js";
import { HttpClient, type RequestResult } from "./httpClient.js";
import { computeBackoffMs, shouldRetry } from "./retry.js";
import { PoissonScheduler, type ScheduledTask } from "./scheduler.js";
import type { LoadBuddyReport } from "../report/reportTypes.js";

interface RunnerOptions {
  seed: number;
  quiet: boolean;
}

export interface RunnerResult {
  report: LoadBuddyReport;
  thresholdsViolated: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function renderBody(
  endpoint: LoadPlan["endpoints"][number],
  random: DeterministicRandom
): string | undefined {
  if (!endpoint.body) return undefined;
  if (endpoint.body.text !== undefined) {
    return expandTemplate(endpoint.body.text, random);
  }
  if (endpoint.body.json !== undefined) {
    return JSON.stringify(expandJsonTemplate(endpoint.body.json, random));
  }
  return undefined;
}

function renderHeaders(
  endpoint: LoadPlan["endpoints"][number],
  random: DeterministicRandom
): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(endpoint.headers ?? {})) {
    headers[k] = expandTemplate(v, random);
  }
  if (endpoint.body?.json !== undefined) {
    headers["content-type"] = headers["content-type"] ?? "application/json";
  }
  return headers;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function renderDashboard(
  logger: pino.Logger,
  phase: { name: string; elapsedSec: number; remainingSec: number; targetRps: number } | null,
  snapshot: ReturnType<MetricsAggregator["snapshot"]>,
  topLatency: ReturnType<MetricsAggregator["endpointSummaries"]>,
  topErrors: ReturnType<MetricsAggregator["endpointSummaries"]>
): void {
  const lines = [
    `Phase: ${phase?.name ?? "completed"} | elapsed: ${formatNumber(phase?.elapsedSec ?? 0)}s | remaining: ${formatNumber(phase?.remainingSec ?? 0)}s`,
    `Target RPS: ${formatNumber(phase?.targetRps ?? 0)} | Achieved RPS: ${formatNumber(snapshot.achievedRps)} | In-flight: ${snapshot.inFlight}`,
    `Latency ms p50/p95/p99: ${snapshot.p50LatencyMs}/${snapshot.p95LatencyMs}/${snapshot.p99LatencyMs} | avg: ${formatNumber(snapshot.counters.avgLatencyMs)}`,
    `Errors: ${formatNumber(snapshot.counters.errorRatePct)}% | timeouts: ${snapshot.counters.timeouts} | retries: ${snapshot.counters.retries} | drops: ${snapshot.counters.clientDrops}`,
    `Top latency endpoints: ${topLatency.slice(0, 3).map((e) => `${e.name}(${formatNumber(e.avgLatencyMs)}ms)`).join(", ") || "-"}`,
    `Top error endpoints: ${topErrors.slice(0, 3).map((e) => `${e.name}(${formatNumber(e.errorRatePct)}%)`).join(", ") || "-"}`
  ];
  logger.info("\n" + lines.join("\n"));
}

async function executeTask(
  task: ScheduledTask,
  plan: LoadPlan,
  endpointByName: Map<string, LoadPlan["endpoints"][number]>,
  client: HttpClient,
  aggregator: MetricsAggregator,
  random: DeterministicRandom
): Promise<void> {
  const endpoint = endpointByName.get(task.endpointName);
  if (!endpoint) {
    aggregator.recordClientDrop(task.endpointName, task.phaseName);
    return;
  }
  const timeoutMs = endpoint.timeoutMs ?? plan.timeouts.requestMs;
  const retries = plan.retries ?? {
    maxAttempts: 1,
    backoffMs: [],
    jitter: false,
    retryOn: { statuses: [], timeouts: false, networkErrors: false }
  };
  let attempt = 1;
  let lastResult: RequestResult | undefined;
  while (attempt <= retries.maxAttempts) {
    const path = expandTemplate(endpoint.path, random);
    const headers = renderHeaders(endpoint, random);
    const body = renderBody(endpoint, random);
    const result = await client.send({
      method: endpoint.method,
      url: `${plan.baseUrl}${path}`,
      headers,
      body,
      timeoutMs
    });
    lastResult = result;
    aggregator.recordAttempt(endpoint.name, task.phaseName, result.outcome, result.latencyMs);
    const retryable = shouldRetry(result.outcome, result.statusCode, attempt, retries);
    if (!retryable) {
      return;
    }
    aggregator.recordRetry(endpoint.name, task.phaseName);
    const delay = computeBackoffMs(attempt, retries, random);
    if (delay > 0) {
      await sleep(delay);
    }
    attempt += 1;
  }
  if (!lastResult) {
    aggregator.recordClientDrop(endpoint.name, task.phaseName);
  }
}

function isThresholdsViolated(plan: LoadPlan, overall: ReturnType<MetricsAggregator["overallSummary"]>): boolean {
  if (!plan.thresholds) return false;
  if (plan.thresholds.p95LatencyMs !== undefined && overall.p95LatencyMs > plan.thresholds.p95LatencyMs) return true;
  if (plan.thresholds.errorRatePct !== undefined && overall.errorRatePct > plan.thresholds.errorRatePct) return true;
  return false;
}

export async function runPlan(plan: LoadPlan, options: RunnerOptions): Promise<RunnerResult> {
  const startedAt = new Date();
  const startMs = startedAt.getTime();
  const random = createPrng(options.seed);
  const scheduler = new PoissonScheduler(startMs, plan, random);
  const client = new HttpClient(plan.concurrency.maxConnections);
  const endpointByName = new Map(plan.endpoints.map((e) => [e.name, e]));
  const aggregator = new MetricsAggregator();
  const logger = pino({
    transport: options.quiet
      ? undefined
      : {
          target: "pino-pretty",
          options: { colorize: true, singleLine: false, ignore: "pid,hostname,time" }
        }
  });

  const backlog: ScheduledTask[] = [];
  const maxBacklog = Math.max(plan.concurrency.maxInFlight * 10, 1000);
  let inFlight = 0;
  let nextTask = scheduler.nextTask();
  let lastDashboard = Date.now();
  const intervalSec = 1;
  const activePromises = new Set<Promise<void>>();

  while (true) {
    const now = Date.now();
    while (nextTask && nextTask.plannedTimeMs <= now) {
      if (backlog.length >= maxBacklog) {
        aggregator.recordClientDrop(nextTask.endpointName, nextTask.phaseName);
      } else {
        backlog.push(nextTask);
      }
      nextTask = scheduler.nextTask();
    }

    while (inFlight < plan.concurrency.maxInFlight && backlog.length > 0) {
      const task = backlog.shift();
      if (!task) break;
      inFlight += 1;
      const promise = executeTask(task, plan, endpointByName, client, aggregator, random)
        .catch(() => {
          aggregator.recordClientDrop(task.endpointName, task.phaseName);
        })
        .finally(() => {
          inFlight -= 1;
          activePromises.delete(promise);
        });
      activePromises.add(promise);
    }

    if (!options.quiet && now - lastDashboard >= intervalSec * 1000) {
      const snapshot = aggregator.snapshot(inFlight, intervalSec);
      const phase = scheduler.getCurrentPhase(now);
      const endpoints = aggregator.endpointSummaries();
      const topLatency = [...endpoints].sort((a, b) => b.avgLatencyMs - a.avgLatencyMs);
      const topErrors = [...endpoints].sort((a, b) => b.errorRatePct - a.errorRatePct);
      process.stdout.write("\u001b[H\u001b[J");
      renderDashboard(logger, phase, snapshot, topLatency, topErrors);
      lastDashboard = now;
    }

    if (!nextTask && backlog.length === 0 && inFlight === 0) {
      break;
    }
    await sleep(10);
  }

  await Promise.allSettled([...activePromises]);
  await client.close();

  const overall = aggregator.overallSummary();
  const durationSec = (Date.now() - startMs) / 1000;
  const report: LoadBuddyReport = {
    metadata: {
      startTime: startedAt.toISOString(),
      durationSec,
      seed: options.seed,
      baseUrl: plan.baseUrl,
      nodeVersion: process.version
    },
    perPhase: aggregator.phaseSummaries(),
    overall,
    perEndpoint: aggregator.endpointSummaries()
  };

  return { report, thresholdsViolated: isThresholdsViolated(plan, overall) };
}

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { LoadBuddyReport } from "../src/report/reportTypes.js";
import { renderHtmlReport } from "../src/report/writeHtmlReport.js";
import { writeReport } from "../src/report/writeReport.js";

const tempDirs: string[] = [];

function sampleReport(): LoadBuddyReport {
  return {
    metadata: {
      startTime: "2026-03-05T12:00:00.000Z",
      durationSec: 45.2,
      seed: 42,
      baseUrl: "https://api.example.com",
      nodeVersion: "v24.11.1",
      thresholds: {
        p95LatencyMs: 800,
        errorRatePct: 2
      },
      thresholdsViolated: true
    },
    overall: {
      name: "overall",
      successes: 820,
      httpErrors: 150,
      networkErrors: 20,
      timeouts: 10,
      retries: 44,
      clientDrops: 3,
      totalLatencyMs: 143000,
      completed: 1000,
      avgLatencyMs: 143,
      errorRatePct: 18,
      p50LatencyMs: 100,
      p95LatencyMs: 1200,
      p99LatencyMs: 3000,
      histogram: {
        boundsMs: [10, 25, 50, 100, 200, 400, 800, 1500, 3000, 6000, 10000],
        counts: [5, 20, 80, 300, 410, 110, 40, 22, 8, 4, 1, 0],
        total: 1000
      }
    },
    perPhase: [
      {
        name: "warmup",
        successes: 320,
        httpErrors: 12,
        networkErrors: 4,
        timeouts: 1,
        retries: 8,
        clientDrops: 0,
        totalLatencyMs: 42000,
        completed: 337,
        avgLatencyMs: 125,
        errorRatePct: 5.04,
        p50LatencyMs: 100,
        p95LatencyMs: 400,
        p99LatencyMs: 800,
        histogram: {
          boundsMs: [10, 25, 50, 100, 200, 400, 800, 1500, 3000, 6000, 10000],
          counts: [1, 8, 22, 110, 150, 34, 10, 2, 0, 0, 0, 0],
          total: 337
        }
      },
      {
        name: "peak",
        successes: 500,
        httpErrors: 138,
        networkErrors: 16,
        timeouts: 9,
        retries: 36,
        clientDrops: 3,
        totalLatencyMs: 101000,
        completed: 663,
        avgLatencyMs: 152,
        errorRatePct: 24.59,
        p50LatencyMs: 100,
        p95LatencyMs: 1500,
        p99LatencyMs: 3000,
        histogram: {
          boundsMs: [10, 25, 50, 100, 200, 400, 800, 1500, 3000, 6000, 10000],
          counts: [4, 12, 58, 190, 260, 76, 30, 20, 8, 4, 1, 0],
          total: 663
        }
      }
    ],
    perEndpoint: [
      {
        name: "search",
        successes: 520,
        httpErrors: 40,
        networkErrors: 8,
        timeouts: 5,
        retries: 18,
        clientDrops: 1,
        totalLatencyMs: 76000,
        completed: 573,
        avgLatencyMs: 133,
        errorRatePct: 9.25,
        p50LatencyMs: 100,
        p95LatencyMs: 800,
        p99LatencyMs: 1500,
        histogram: {
          boundsMs: [10, 25, 50, 100, 200, 400, 800, 1500, 3000, 6000, 10000],
          counts: [3, 12, 45, 170, 250, 62, 20, 9, 2, 0, 0, 0],
          total: 573
        }
      },
      {
        name: "checkout",
        successes: 300,
        httpErrors: 110,
        networkErrors: 12,
        timeouts: 5,
        retries: 26,
        clientDrops: 2,
        totalLatencyMs: 67000,
        completed: 427,
        avgLatencyMs: 157,
        errorRatePct: 29.74,
        p50LatencyMs: 100,
        p95LatencyMs: 1500,
        p99LatencyMs: 3000,
        histogram: {
          boundsMs: [10, 25, 50, 100, 200, 400, 800, 1500, 3000, 6000, 10000],
          counts: [2, 8, 35, 130, 160, 48, 20, 13, 7, 3, 1, 0],
          total: 427
        }
      }
    ]
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("HTML report", () => {
  it("renders a readable stakeholder-focused summary", () => {
    const html = renderHtmlReport(sampleReport(), { rawReportHref: "loadstar-report.json" });

    expect(html).toContain("API load test summary");
    expect(html).toContain("Outside target");
    expect(html).toContain("Outcome mix");
    expect(html).toContain("Phase breakdown");
    expect(html).toContain("Endpoint breakdown");
    expect(html).toContain("checkout");
    expect(html).toContain("Open the raw JSON report");
  });

  it("writes both JSON and HTML artifacts", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "loadstar-report-"));
    tempDirs.push(dir);

    const artifacts = await writeReport(sampleReport(), path.join(dir, "report.json"));
    const html = await readFile(artifacts.htmlPath, "utf-8");
    const json = await readFile(artifacts.jsonPath, "utf-8");

    expect(artifacts.htmlPath.endsWith("report.html")).toBe(true);
    expect(html).toContain("<table>");
    expect(html).toContain("Latency profile");
    expect(json).toContain('"thresholdsViolated": true');
  });
});

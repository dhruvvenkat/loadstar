import { describe, expect, it } from "vitest";
import { PoissonScheduler } from "../src/engine/scheduler.js";
import { createPrng } from "../src/plan/templating.js";
import type { LoadPlan } from "../src/plan/loadPlan.js";

const basePlan: LoadPlan = {
  baseUrl: "http://localhost:3000",
  phases: [
    { name: "warmup", durationSec: 1, targetRps: 10 },
    { name: "spike", durationSec: 1, targetRps: 20 }
  ],
  endpoints: [{ name: "ping", method: "GET", path: "/ping", weight: 1 }],
  timeouts: { requestMs: 2000 },
  concurrency: { maxInFlight: 200, maxConnections: 50 }
};

describe("PoissonScheduler", () => {
  it("produces increasing planned timestamps and phase labels", () => {
    const scheduler = new PoissonScheduler(1000, basePlan, createPrng(99));
    const tasks = Array.from({ length: 10 }, () => scheduler.nextTask()).filter(Boolean);

    expect(tasks.length).toBeGreaterThan(0);
    for (let i = 1; i < tasks.length; i += 1) {
      expect((tasks[i]?.plannedTimeMs ?? 0) >= (tasks[i - 1]?.plannedTimeMs ?? 0)).toBe(true);
    }
    expect(tasks.some((t) => t?.phaseName === "warmup")).toBe(true);
  });
});

import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runPlan } from "../src/engine/runner.js";
import type { LoadPlan } from "../src/plan/loadPlan.js";

let server: http.Server;
let port = 0;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith("/ok")) {
      res.statusCode = 200;
      res.end("ok");
      return;
    }
    res.statusCode = 503;
    res.end("err");
  });
  await new Promise<void>((resolve) => {
    server.listen(0, () => {
      port = (server.address() as { port: number }).port;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe("runner smoke", () => {
  it("executes a short run and returns report data", async () => {
    const plan: LoadPlan = {
      baseUrl: `http://127.0.0.1:${port}`,
      phases: [{ name: "tiny", durationSec: 1, targetRps: 5 }],
      endpoints: [
        { name: "ok", method: "GET", path: "/ok", weight: 2 },
        { name: "fail", method: "GET", path: "/fail", weight: 1 }
      ],
      timeouts: { requestMs: 1000 },
      concurrency: { maxInFlight: 20, maxConnections: 5 }
    };

    const { report } = await runPlan(plan, { seed: 42, quiet: true });
    expect(report.overall.completed).toBeGreaterThan(0);
    expect(report.overall.successes + report.overall.httpErrors).toBeGreaterThan(0);
    expect(report.perEndpoint.length).toBe(2);
  });
});

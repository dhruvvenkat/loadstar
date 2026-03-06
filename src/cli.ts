#!/usr/bin/env node
import { Command } from "commander";
import { resolve } from "node:path";
import { loadPlanFromFile } from "./plan/loadPlan.js";
import { runPlan } from "./engine/runner.js";
import { writeReport } from "./report/writeReport.js";

interface RunCommandOptions {
  out: string;
  seed: string;
  json: boolean;
  quiet: boolean;
}

const program = new Command();
program.name("loadstar").description("Load test HTTP APIs with phased traffic");

program
  .command("run")
  .argument("<planFile>", "Path to YAML/JSON load plan")
  .option("--out <path>", "Path for JSON report", "./loadstar-report.json")
  .option("--seed <int>", "Deterministic random seed", "42")
  .option("--json", "Print final summary as JSON to stdout", false)
  .option("--quiet", "Disable live dashboard output", false)
  .action(async (planFile: string, options: RunCommandOptions) => {
    try {
      const seed = Number(options.seed);
      if (!Number.isInteger(seed)) {
        throw new Error("--seed must be an integer");
      }
      const plan = await loadPlanFromFile(resolve(planFile));
      const result = await runPlan(plan, { seed, quiet: options.quiet });
      const artifacts = await writeReport(result.report, options.out);
      if (options.json) {
        process.stdout.write(`${JSON.stringify(result.report.overall, null, 2)}\n`);
      } else {
        process.stdout.write(
          `Run complete. successes=${result.report.overall.successes} errors=${result.report.overall.httpErrors + result.report.overall.networkErrors + result.report.overall.timeouts} p95=${result.report.overall.p95LatencyMs}ms json=${artifacts.jsonPath} html=${artifacts.htmlPath}\n`
        );
      }
      process.exit(result.thresholdsViolated ? 2 : 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`loadstar runtime failure: ${message}\n`);
      process.exit(1);
    }
  });

void program.parseAsync(process.argv);

import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const methodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const phaseSchema = z.object({
  name: z.string().min(1),
  durationSec: z.number().int().positive(),
  targetRps: z.number().nonnegative()
});

const endpointSchema = z
  .object({
    name: z.string().min(1),
    method: methodSchema,
    path: z.string().min(1),
    weight: z.number().int().min(1),
    headers: z.record(z.string(), z.string()).optional(),
    body: z
      .object({
        json: z.any().optional(),
        text: z.string().optional()
      })
      .optional(),
    timeoutMs: z.number().int().positive().optional()
  })
  .superRefine((endpoint, ctx) => {
    if (endpoint.body?.json !== undefined && endpoint.body?.text !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Endpoint body cannot define both json and text."
      });
    }
  });

const retriesSchema = z.object({
  maxAttempts: z.number().int().min(1).default(1),
  backoffMs: z.array(z.number().int().nonnegative()).default([]),
  jitter: z.boolean().default(false),
  retryOn: z.object({
    statuses: z.array(z.number().int().min(100).max(599)).default([]),
    timeouts: z.boolean().default(false),
    networkErrors: z.boolean().default(false)
  })
});

const thresholdsSchema = z.object({
  p95LatencyMs: z.number().positive().optional(),
  errorRatePct: z.number().min(0).max(100).optional()
});

const planSchema = z.object({
  baseUrl: z.string().url(),
  phases: z.array(phaseSchema).min(1),
  endpoints: z.array(endpointSchema).min(1),
  timeouts: z
    .object({
      requestMs: z.number().int().positive().default(2000)
    })
    .default({ requestMs: 2000 }),
  concurrency: z
    .object({
      maxInFlight: z.number().int().positive().default(200),
      maxConnections: z.number().int().positive().default(50)
    })
    .default({ maxInFlight: 200, maxConnections: 50 }),
  retries: retriesSchema
    .default({
      maxAttempts: 1,
      backoffMs: [],
      jitter: false,
      retryOn: { statuses: [], timeouts: false, networkErrors: false }
    })
    .optional(),
  thresholds: thresholdsSchema.optional()
});

export type LoadPlan = z.infer<typeof planSchema>;
export type EndpointConfig = z.infer<typeof endpointSchema>;

export async function loadPlanFromFile(planFile: string): Promise<LoadPlan> {
  const content = await readFile(planFile, "utf-8");
  const ext = path.extname(planFile).toLowerCase();
  let parsed: unknown;
  try {
    parsed = ext === ".yml" || ext === ".yaml" ? parseYaml(content) : JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse plan file "${planFile}": ${detail}`);
  }

  const result = planSchema.safeParse(parsed);
  if (!result.success) {
    const detail = result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid plan "${planFile}": ${detail}`);
  }
  return result.data;
}

export { planSchema };

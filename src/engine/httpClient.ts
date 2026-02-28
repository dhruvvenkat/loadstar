import { Agent, request } from "undici";

export type RequestOutcome = "success" | "http_error" | "network_error" | "timeout";

export interface RequestResult {
  outcome: RequestOutcome;
  statusCode?: number;
  latencyMs: number;
  errorType?: "dns" | "connection_refused" | "network" | "unknown";
  errorMessage?: string;
}

export interface RequestOptions {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
}

export class HttpClient {
  private readonly agent: Agent;

  constructor(maxConnections: number) {
    this.agent = new Agent({
      keepAliveTimeout: 10_000,
      keepAliveMaxTimeout: 30_000,
      connections: maxConnections
    });
  }

  async send(options: RequestOptions): Promise<RequestResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await request(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        dispatcher: this.agent,
        signal: controller.signal
      });
      await response.body.dump();
      const latencyMs = Date.now() - started;
      if (response.statusCode >= 200 && response.statusCode < 300) {
        return { outcome: "success", statusCode: response.statusCode, latencyMs };
      }
      return { outcome: "http_error", statusCode: response.statusCode, latencyMs };
    } catch (error) {
      const latencyMs = Date.now() - started;
      if (controller.signal.aborted) {
        return { outcome: "timeout", latencyMs, errorType: "unknown", errorMessage: "Request timeout" };
      }
      const code = (error as NodeJS.ErrnoException)?.code ?? "UNKNOWN";
      if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
        return { outcome: "network_error", latencyMs, errorType: "dns", errorMessage: code };
      }
      if (code === "ECONNREFUSED") {
        return {
          outcome: "network_error",
          latencyMs,
          errorType: "connection_refused",
          errorMessage: code
        };
      }
      return { outcome: "network_error", latencyMs, errorType: "network", errorMessage: code };
    } finally {
      clearTimeout(timeout);
    }
  }

  async close(): Promise<void> {
    await this.agent.close();
  }
}

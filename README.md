# loadstar

`loadstar` is a production-oriented API load simulator CLI for phased HTTP traffic testing.

## Stack

- TypeScript (Node 20+)
- `undici` for HTTP + keep-alive pooling
- `commander` for CLI
- `zod` for plan validation
- `pino` for CLI logging
- `vitest` for tests
- `tsup` for build
- `eslint` + `prettier`

## Install

```bash
pnpm install
pnpm build
```

## Run

```bash
node dist/cli.js run examples/steady.yml
```

Options:

- `--out <path>` write JSON report (default `./loadstar-report.json`)
- `--seed <int>` deterministic seed (default `42`)
- `--json` print final summary JSON to stdout
- `--quiet` disable live dashboard

Every run now writes two artifacts side by side:

- a machine-readable JSON report
- a stakeholder-friendly HTML report with summary cards, charts, and tables

## Plan Schema

Plan files can be YAML (`.yml` / `.yaml`) or JSON.

```yaml
baseUrl: "https://example.com"
phases:
  - name: "warmup"
    durationSec: 30
    targetRps: 20
endpoints:
  - name: "users"
    method: "GET" # GET|POST|PUT|PATCH|DELETE
    path: "/users/{{random.int(1,100)}}"
    weight: 3
    headers:
      x-tenant: 't-{{random.choice("a","b")}}'
    body:
      json:
        id: "{{random.uuid}}"
    timeoutMs: 1500
timeouts:
  requestMs: 2000
concurrency:
  maxInFlight: 200
  maxConnections: 50
retries:
  maxAttempts: 3
  backoffMs: [100, 300, 900]
  jitter: true
  retryOn:
    statuses: [429, 500, 502, 503, 504]
    timeouts: true
    networkErrors: true
thresholds:
  p95LatencyMs: 1000
  errorRatePct: 2
```

Template expressions:

- `{{random.int(a,b)}}`
- `{{random.uuid}}`
- `{{random.choice("a","b")}}`
- `{{random.string(n)}}`

## Metrics

Live dashboard updates every second and shows:

- Phase and target/achieved RPS
- In-flight count
- p50/p95/p99 and average latency
- Error rate, timeouts, retries, client drops
- Top 3 slowest and highest-error endpoints

The report JSON includes:

- metadata (`startTime`, run duration, seed, base URL, node version)
- per-phase summary
- overall summary
- per-endpoint summary
- histogram buckets and counts

The HTML report presents the same data in a non-technical format with:

- overall health and threshold status
- executive summary cards
- outcome and latency graphics
- readable phase and endpoint tables

Latency percentile estimates are derived from cumulative histogram buckets:
`0-10, 10-25, 25-50, 50-100, 100-200, 200-400, 400-800, 800-1500, 1500-3000, 3000-6000, 6000-10000, 10000+ ms`.

## Exit Codes

- `0`: success
- `2`: threshold violation
- `1`: runtime/validation failure

## Examples

- [steady.yml](examples/steady.yml)
- [ramp-spike.yml](examples/ramp-spike.yml)
- [retry-storm.yml](examples/retry-storm.yml)

## Caveats

- Local machine CPU/network limits can cap achievable RPS.
- Connection and in-flight limits intentionally protect the local host.
- Open-model scheduling plus bounded backlog may record `clientDrops` under sustained overload.

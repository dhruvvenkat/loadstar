import path from "node:path";
import type { HistogramSnapshot } from "../metrics/histogram.js";
import type { LoadBuddyReport, ReportStats } from "./reportTypes.js";

interface HtmlReportOptions {
  rawReportHref?: string;
}

interface Segment {
  label: string;
  count: number;
  tone: "good" | "warn" | "bad" | "neutral";
  description: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatDecimal(value: number, digits = 1): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  }).format(value);
}

function formatPercent(value: number, digits = 1): string {
  return `${formatDecimal(value, digits)}%`;
}

function formatMs(value: number): string {
  return `${formatInteger(Math.round(value))} ms`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0 sec";
  }
  if (seconds < 60) {
    return `${formatDecimal(seconds, 1)} sec`;
  }
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes} min ${formatInteger(Math.round(remaining))} sec`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function successRate(stats: ReportStats): number {
  if (stats.completed === 0) return 0;
  return (stats.successes / stats.completed) * 100;
}

function problemCount(stats: ReportStats): number {
  return stats.httpErrors + stats.networkErrors + stats.timeouts;
}

function bucketLabels(bounds: number[]): string[] {
  return bounds.map((bound, index) => {
    if (index === 0) return `0-${bound}`;
    return `${bounds[index - 1]}-${bound}`;
  }).concat(`${bounds[bounds.length - 1] ?? 0}+`);
}

function statusTone(report: LoadBuddyReport): "good" | "warn" | "bad" {
  const violations = report.metadata.thresholdsViolated;
  if (violations === true) return "bad";
  if (violations === false) return "good";
  if (report.overall.errorRatePct > 5 || report.overall.clientDrops > 0) return "bad";
  if (report.overall.errorRatePct > 0) return "warn";
  return "good";
}

function statusLabel(report: LoadBuddyReport): string {
  const tone = statusTone(report);
  if (tone === "good") {
    return report.metadata.thresholds ? "Within target" : "Healthy run";
  }
  if (tone === "warn") {
    return "Minor issues";
  }
  return report.metadata.thresholds ? "Outside target" : "Needs attention";
}

function summarySentence(report: LoadBuddyReport): string {
  const overall = report.overall;
  const rps = report.metadata.durationSec > 0 ? overall.completed / report.metadata.durationSec : 0;
  const problems = problemCount(overall);
  const success = successRate(overall);

  if (report.metadata.thresholds && report.metadata.thresholdsViolated) {
    return `This run missed its configured target. ${formatPercent(success)} of finished requests succeeded, and the test averaged ${formatDecimal(rps, 1)} requests per second.`;
  }
  if (problems === 0 && overall.clientDrops === 0) {
    return `This run completed cleanly. ${formatInteger(overall.completed)} requests finished over ${formatDuration(report.metadata.durationSec)}, averaging ${formatDecimal(rps, 1)} requests per second.`;
  }
  if (problems > 0) {
    return `${formatInteger(problems)} finished requests ran into issues. The test averaged ${formatDecimal(rps, 1)} requests per second across ${formatDuration(report.metadata.durationSec)}.`;
  }
  return `The load test finished ${formatInteger(overall.completed)} requests over ${formatDuration(report.metadata.durationSec)}.`;
}

function outcomeSegments(report: LoadBuddyReport): Segment[] {
  const overall = report.overall;
  return [
    {
      label: "Successful responses",
      count: overall.successes,
      tone: "good",
      description: "Requests that returned a 2xx status."
    },
    {
      label: "Server-side problems",
      count: overall.httpErrors,
      tone: "bad",
      description: "Requests that received a non-2xx status."
    },
    {
      label: "Connection issues",
      count: overall.networkErrors,
      tone: "warn",
      description: "Requests that failed before a response arrived."
    },
    {
      label: "Timed out",
      count: overall.timeouts,
      tone: "warn",
      description: "Requests that did not finish before the timeout."
    },
    {
      label: "Client drops",
      count: overall.clientDrops,
      tone: "neutral",
      description: "Requests the load generator skipped because its own queue was full."
    }
  ].filter((segment) => segment.count > 0 || segment.label === "Successful responses");
}

function segmentWidth(count: number, total: number): number {
  if (total <= 0 || count <= 0) return 0;
  return (count / total) * 100;
}

function metricCard(label: string, value: string, detail: string, tone: "good" | "warn" | "bad" | "neutral" = "neutral"): string {
  return `
    <article class="metric-card tone-${tone}">
      <p class="eyebrow">${escapeHtml(label)}</p>
      <p class="metric-value">${escapeHtml(value)}</p>
      <p class="metric-detail">${escapeHtml(detail)}</p>
    </article>
  `;
}

function miniBar(valuePct: number, tone: "good" | "warn" | "bad" | "neutral"): string {
  const clamped = Math.max(0, Math.min(valuePct, 100));
  return `
    <div class="mini-bar">
      <span class="tone-${tone}" style="width: ${clamped}%;"></span>
    </div>
  `;
}

function buildHistogram(histogram: HistogramSnapshot): string {
  const labels = bucketLabels(histogram.boundsMs);
  const max = Math.max(...histogram.counts, 1);

  return `
    <div class="histogram">
      ${histogram.counts
        .map((count, index) => {
          const heightPct = count === 0 ? 4 : Math.max(8, (count / max) * 100);
          return `
            <div class="histogram-column">
              <p class="histogram-count">${escapeHtml(formatInteger(count))}</p>
              <div class="histogram-track">
                <span style="height: ${heightPct}%;"></span>
              </div>
              <p class="histogram-label">${escapeHtml(labels[index] ?? "")}</p>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function thresholdCards(report: LoadBuddyReport): string {
  const thresholds = report.metadata.thresholds;
  if (!thresholds || (thresholds.p95LatencyMs === undefined && thresholds.errorRatePct === undefined)) {
    return `
      <article class="card empty-state">
        <h3>Targets</h3>
        <p>No thresholds were configured for this run, so the report can describe what happened but cannot declare a formal pass or fail.</p>
      </article>
    `;
  }

  const cards: string[] = [];
  if (thresholds.p95LatencyMs !== undefined) {
    const passed = report.overall.p95LatencyMs <= thresholds.p95LatencyMs;
    cards.push(`
      <article class="threshold-card tone-${passed ? "good" : "bad"}">
        <p class="eyebrow">P95 response time target</p>
        <p class="metric-value">${escapeHtml(formatMs(report.overall.p95LatencyMs))}</p>
        <p class="metric-detail">Target: ${escapeHtml(formatMs(thresholds.p95LatencyMs))}</p>
        <span class="pill tone-${passed ? "good" : "bad"}">${passed ? "Pass" : "Fail"}</span>
      </article>
    `);
  }
  if (thresholds.errorRatePct !== undefined) {
    const passed = report.overall.errorRatePct <= thresholds.errorRatePct;
    cards.push(`
      <article class="threshold-card tone-${passed ? "good" : "bad"}">
        <p class="eyebrow">Problem rate target</p>
        <p class="metric-value">${escapeHtml(formatPercent(report.overall.errorRatePct))}</p>
        <p class="metric-detail">Target: ${escapeHtml(formatPercent(thresholds.errorRatePct))}</p>
        <span class="pill tone-${passed ? "good" : "bad"}">${passed ? "Pass" : "Fail"}</span>
      </article>
    `);
  }

  return cards.join("");
}

function highlightCards(report: LoadBuddyReport): string {
  const endpoints = [...report.perEndpoint];
  if (endpoints.length === 0) {
    return `
      <article class="card empty-state">
        <h3>Endpoint highlights</h3>
        <p>No per-endpoint data is available.</p>
      </article>
    `;
  }

  const busiest = [...endpoints].sort((a, b) => b.completed - a.completed)[0];
  const slowest = [...endpoints].sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)[0];
  const noisiest = [...endpoints].sort((a, b) => b.errorRatePct - a.errorRatePct)[0];

  return `
    <article class="card">
      <h3>Endpoint highlights</h3>
      <div class="highlight-list">
        <div class="highlight-item">
          <p class="eyebrow">Busiest endpoint</p>
          <p class="highlight-title">${escapeHtml(busiest?.name ?? "-")}</p>
          <p class="highlight-detail">${escapeHtml(formatInteger(busiest?.completed ?? 0))} finished requests</p>
        </div>
        <div class="highlight-item">
          <p class="eyebrow">Slowest endpoint</p>
          <p class="highlight-title">${escapeHtml(slowest?.name ?? "-")}</p>
          <p class="highlight-detail">${escapeHtml(formatMs(slowest?.avgLatencyMs ?? 0))} average response time</p>
        </div>
        <div class="highlight-item">
          <p class="eyebrow">Most issues</p>
          <p class="highlight-title">${escapeHtml(noisiest?.name ?? "-")}</p>
          <p class="highlight-detail">${escapeHtml(formatPercent(noisiest?.errorRatePct ?? 0))} problem rate</p>
        </div>
      </div>
    </article>
  `;
}

function phaseTableRows(phases: ReportStats[]): string {
  return [...phases]
    .map(
      (phase) => `
        <tr>
          <th scope="row">${escapeHtml(phase.name)}</th>
          <td>${escapeHtml(formatInteger(phase.completed))}</td>
          <td>
            ${miniBar(successRate(phase), "good")}
            <span>${escapeHtml(formatPercent(successRate(phase)))}</span>
          </td>
          <td>
            ${miniBar(phase.errorRatePct, phase.errorRatePct > 5 ? "bad" : phase.errorRatePct > 0 ? "warn" : "good")}
            <span>${escapeHtml(formatPercent(phase.errorRatePct))}</span>
          </td>
          <td>${escapeHtml(formatMs(phase.avgLatencyMs))}</td>
          <td>${escapeHtml(formatMs(phase.p95LatencyMs))}</td>
          <td>${escapeHtml(formatInteger(phase.retries))}</td>
          <td>${escapeHtml(formatInteger(phase.clientDrops))}</td>
        </tr>
      `
    )
    .join("");
}

function endpointTableRows(endpoints: ReportStats[]): string {
  const sorted = [...endpoints].sort((a, b) => b.completed - a.completed);
  const maxCompleted = Math.max(...sorted.map((endpoint) => endpoint.completed), 1);

  return sorted
    .map(
      (endpoint) => `
        <tr>
          <th scope="row">${escapeHtml(endpoint.name)}</th>
          <td>
            <div class="cell-stack">
              <span>${escapeHtml(formatInteger(endpoint.completed))}</span>
              ${miniBar((endpoint.completed / maxCompleted) * 100, "neutral")}
            </div>
          </td>
          <td>${escapeHtml(formatPercent(successRate(endpoint)))}</td>
          <td>${escapeHtml(formatPercent(endpoint.errorRatePct))}</td>
          <td>${escapeHtml(formatMs(endpoint.avgLatencyMs))}</td>
          <td>${escapeHtml(formatMs(endpoint.p95LatencyMs))}</td>
          <td>${escapeHtml(formatInteger(endpoint.retries))}</td>
          <td>${escapeHtml(formatInteger(endpoint.clientDrops))}</td>
        </tr>
      `
    )
    .join("");
}

function methodologyItems(report: LoadBuddyReport): string {
  const items = [
    `P95 response time means 95% of finished requests completed within ${formatMs(report.overall.p95LatencyMs)} or faster.`,
    `Problem rate combines non-2xx responses, connection failures, and timeouts.`,
    `Client drops are requests the load generator could not start because its own backlog limit was reached.`
  ];

  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function rawReportLink(rawReportHref: string | undefined): string {
  if (!rawReportHref) return "";
  return `<a class="subtle-link" href="${escapeHtml(rawReportHref)}">Open the raw JSON report</a>`;
}

export function renderHtmlReport(report: LoadBuddyReport, options: HtmlReportOptions = {}): string {
  const overall = report.overall;
  const problems = problemCount(overall);
  const totalForShare = overall.completed + overall.clientDrops;
  const tone = statusTone(report);
  const rps = report.metadata.durationSec > 0 ? overall.completed / report.metadata.durationSec : 0;
  const segments = outcomeSegments(report);
  const startedAt = formatTimestamp(report.metadata.startTime);
  const baseUrl = report.metadata.baseUrl;
  const rawJsonLabel = options.rawReportHref ? path.basename(options.rawReportHref) : undefined;

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Loadstar report for ${escapeHtml(baseUrl)}</title>
    <style>
      :root {
        --bg: #f7f1e3;
        --bg-2: #efe5d0;
        --panel: rgba(255, 251, 244, 0.94);
        --panel-strong: #fffdf8;
        --ink: #1d2b2f;
        --muted: #5d6b6f;
        --line: rgba(41, 65, 72, 0.14);
        --shadow: 0 20px 40px rgba(31, 42, 45, 0.10);
        --good: #1f7a5a;
        --good-soft: rgba(31, 122, 90, 0.12);
        --warn: #b76a28;
        --warn-soft: rgba(183, 106, 40, 0.14);
        --bad: #b24034;
        --bad-soft: rgba(178, 64, 52, 0.12);
        --neutral: #47718c;
        --neutral-soft: rgba(71, 113, 140, 0.12);
        --accent: #0f766e;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Avenir Next", "Segoe UI", "Helvetica Neue", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at top left, rgba(19, 122, 110, 0.12), transparent 26rem),
          radial-gradient(circle at top right, rgba(183, 106, 40, 0.12), transparent 24rem),
          linear-gradient(180deg, var(--bg), var(--bg-2));
      }

      h1, h2, h3 {
        font-family: "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Georgia, serif;
        margin: 0;
        letter-spacing: -0.02em;
      }

      p {
        margin: 0;
      }

      .page {
        max-width: 1220px;
        margin: 0 auto;
        padding: 28px 18px 56px;
      }

      .hero {
        position: relative;
        overflow: hidden;
        padding: 28px;
        border: 1px solid var(--line);
        border-radius: 28px;
        background: linear-gradient(140deg, rgba(255, 252, 247, 0.96), rgba(244, 250, 249, 0.92));
        box-shadow: var(--shadow);
      }

      .hero::after {
        content: "";
        position: absolute;
        inset: auto -4rem -5rem auto;
        width: 14rem;
        height: 14rem;
        border-radius: 999px;
        background: radial-gradient(circle, rgba(15, 118, 110, 0.18), transparent 72%);
        pointer-events: none;
      }

      .hero-header {
        display: flex;
        flex-wrap: wrap;
        gap: 14px;
        align-items: flex-start;
        justify-content: space-between;
      }

      .hero-copy {
        max-width: 720px;
      }

      .hero-copy h1 {
        font-size: clamp(2rem, 4vw, 3.4rem);
        line-height: 0.95;
        margin-bottom: 12px;
      }

      .hero-copy p {
        max-width: 64ch;
        font-size: 1rem;
        line-height: 1.6;
        color: var(--muted);
      }

      .hero-meta {
        margin-top: 22px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }

      .hero-meta span,
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 9px 12px;
        border-radius: 999px;
        border: 1px solid var(--line);
        background: rgba(255, 255, 255, 0.75);
        font-size: 0.92rem;
        font-weight: 600;
      }

      .status-panel {
        min-width: 260px;
        max-width: 320px;
        padding: 18px;
        border-radius: 22px;
        border: 1px solid var(--line);
        background: var(--panel);
      }

      .status-panel .pill {
        margin-bottom: 14px;
      }

      .tone-good {
        color: var(--good);
        background: var(--good-soft);
      }

      .tone-warn {
        color: var(--warn);
        background: var(--warn-soft);
      }

      .tone-bad {
        color: var(--bad);
        background: var(--bad-soft);
      }

      .tone-neutral {
        color: var(--neutral);
        background: var(--neutral-soft);
      }

      .status-panel p:last-child {
        color: var(--muted);
        line-height: 1.6;
      }

      .grid {
        display: grid;
        gap: 18px;
        margin-top: 18px;
      }

      .metrics-grid {
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      }

      .two-up {
        grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      }

      .three-up {
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      }

      .metric-card,
      .card,
      .threshold-card {
        border: 1px solid var(--line);
        border-radius: 22px;
        background: var(--panel);
        box-shadow: var(--shadow);
      }

      .metric-card {
        padding: 18px;
      }

      .card {
        padding: 22px;
      }

      .threshold-card {
        padding: 20px;
      }

      .metric-value {
        margin-top: 8px;
        font-size: clamp(1.8rem, 3vw, 2.6rem);
        font-weight: 700;
        line-height: 1;
      }

      .metric-detail,
      .body-copy,
      .section-copy,
      .empty-state p {
        margin-top: 8px;
        color: var(--muted);
        line-height: 1.6;
      }

      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 0.78rem;
        font-weight: 700;
      }

      .section-title {
        margin-bottom: 6px;
        font-size: 1.5rem;
      }

      .section-copy {
        max-width: 72ch;
      }

      .stacked-bar {
        overflow: hidden;
        display: flex;
        width: 100%;
        height: 22px;
        margin: 18px 0 16px;
        border-radius: 999px;
        background: rgba(29, 43, 47, 0.08);
      }

      .stacked-bar span {
        display: block;
        height: 100%;
      }

      .legend {
        display: grid;
        gap: 12px;
      }

      .legend-item {
        display: grid;
        grid-template-columns: auto 1fr auto;
        gap: 12px;
        align-items: center;
      }

      .legend-swatch {
        width: 12px;
        height: 12px;
        border-radius: 999px;
      }

      .legend-copy p:last-child {
        margin-top: 4px;
        color: var(--muted);
        font-size: 0.92rem;
        line-height: 1.5;
      }

      .highlight-list {
        display: grid;
        gap: 14px;
        margin-top: 18px;
      }

      .highlight-item {
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.72);
        border: 1px solid rgba(41, 65, 72, 0.08);
      }

      .highlight-title {
        margin-top: 6px;
        font-size: 1.15rem;
        font-weight: 700;
      }

      .highlight-detail {
        margin-top: 4px;
        color: var(--muted);
      }

      .histogram {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(56px, 1fr));
        gap: 12px;
        align-items: end;
        min-height: 260px;
        margin-top: 18px;
      }

      .histogram-column {
        display: grid;
        gap: 8px;
        justify-items: center;
      }

      .histogram-count,
      .histogram-label {
        font-size: 0.8rem;
        color: var(--muted);
      }

      .histogram-track {
        width: 100%;
        height: 180px;
        padding: 6px;
        display: flex;
        align-items: end;
        border-radius: 18px;
        background: linear-gradient(180deg, rgba(15, 118, 110, 0.06), rgba(15, 118, 110, 0.16));
      }

      .histogram-track span {
        display: block;
        width: 100%;
        border-radius: 12px;
        background: linear-gradient(180deg, #1e8c81, #0f766e);
      }

      .mini-bar {
        width: 100%;
        min-width: 120px;
        height: 9px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(29, 43, 47, 0.08);
      }

      .mini-bar span {
        display: block;
        height: 100%;
        border-radius: inherit;
      }

      .cell-stack {
        display: grid;
        gap: 6px;
      }

      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 18px;
      }

      thead th {
        padding: 0 0 12px;
        border-bottom: 1px solid var(--line);
        text-align: left;
        color: var(--muted);
        font-size: 0.78rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }

      tbody th,
      tbody td {
        padding: 14px 10px 14px 0;
        border-bottom: 1px solid rgba(41, 65, 72, 0.08);
        text-align: left;
        vertical-align: top;
      }

      tbody tr:last-child th,
      tbody tr:last-child td {
        border-bottom: none;
      }

      tbody th {
        width: 20%;
      }

      .table-wrap {
        overflow-x: auto;
      }

      .notes {
        padding-left: 18px;
        color: var(--muted);
        line-height: 1.8;
      }

      .footer {
        margin-top: 18px;
        display: flex;
        flex-wrap: wrap;
        gap: 10px 16px;
        align-items: center;
        justify-content: space-between;
        color: var(--muted);
        font-size: 0.92rem;
      }

      .subtle-link {
        color: var(--accent);
        text-decoration: none;
        font-weight: 700;
      }

      .subtle-link:hover,
      .subtle-link:focus {
        text-decoration: underline;
      }

      @media (max-width: 780px) {
        .page {
          padding-inline: 14px;
        }

        .hero,
        .card,
        .metric-card,
        .threshold-card {
          border-radius: 20px;
        }

        .histogram {
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <div class="hero-header">
          <div class="hero-copy">
            <p class="eyebrow">Loadstar HTML report</p>
            <h1>API load test summary</h1>
            <p>${escapeHtml(summarySentence(report))}</p>
            <div class="hero-meta">
              <span>Target: ${escapeHtml(baseUrl)}</span>
              <span>Started: ${escapeHtml(startedAt)}</span>
              <span>Duration: ${escapeHtml(formatDuration(report.metadata.durationSec))}</span>
              <span>Seed: ${escapeHtml(String(report.metadata.seed))}</span>
              <span>Average rate: ${escapeHtml(formatDecimal(rps, 1))} req/sec</span>
            </div>
          </div>
          <aside class="status-panel">
            <span class="pill tone-${tone}">${escapeHtml(statusLabel(report))}</span>
            <p class="metric-value">${escapeHtml(formatPercent(successRate(overall)))}</p>
            <p>Successful finished requests. ${escapeHtml(formatInteger(problems))} problems were recorded across finished requests, with ${escapeHtml(formatInteger(overall.clientDrops))} dropped before sending.</p>
          </aside>
        </div>
      </section>

      <section class="grid metrics-grid">
        ${metricCard("Finished requests", formatInteger(overall.completed), "Requests that reached a response or a timeout.", "neutral")}
        ${metricCard("Successful responses", formatInteger(overall.successes), `${formatPercent(successRate(overall))} of finished requests.`, overall.successes === overall.completed && overall.completed > 0 ? "good" : overall.successes > 0 ? "warn" : "bad")}
        ${metricCard("Problem responses", formatInteger(problems), `${formatPercent(overall.errorRatePct)} of finished requests.`, problems === 0 ? "good" : overall.errorRatePct > 5 ? "bad" : "warn")}
        ${metricCard("P95 response time", formatMs(overall.p95LatencyMs), "95% of finished requests were this fast or faster.", overall.p95LatencyMs > 1000 ? "bad" : overall.p95LatencyMs > 500 ? "warn" : "good")}
        ${metricCard("Average response time", formatMs(overall.avgLatencyMs), "Average across finished requests.", "neutral")}
        ${metricCard("Retries and drops", `${formatInteger(overall.retries)} / ${formatInteger(overall.clientDrops)}`, "Retries show recoverable issues. Drops indicate local overload.", overall.clientDrops > 0 ? "bad" : overall.retries > 0 ? "warn" : "good")}
      </section>

      <section class="grid two-up">
        <article class="card">
          <h2 class="section-title">Outcome mix</h2>
          <p class="section-copy">This view shows how many requests completed successfully versus how many ran into problems. The bar below includes dropped requests so the full operational picture stays visible.</p>
          <div class="stacked-bar">
            ${segments
              .map((segment) => {
                const total = totalForShare > 0 ? totalForShare : 1;
                return `<span class="tone-${segment.tone}" style="width: ${segmentWidth(segment.count, total)}%;"></span>`;
              })
              .join("")}
          </div>
          <div class="legend">
            ${segments
              .map(
                (segment) => `
                  <div class="legend-item">
                    <span class="legend-swatch tone-${segment.tone}"></span>
                    <div class="legend-copy">
                      <p>${escapeHtml(segment.label)}</p>
                      <p>${escapeHtml(segment.description)}</p>
                    </div>
                    <strong>${escapeHtml(formatInteger(segment.count))}</strong>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>

        ${highlightCards(report)}
      </section>

      <section class="grid two-up">
        <article class="card">
          <h2 class="section-title">Targets</h2>
          <p class="section-copy">If thresholds were configured for the run, the cards below show whether the test stayed within them.</p>
          <div class="grid three-up">
            ${thresholdCards(report)}
          </div>
        </article>

        <article class="card">
          <h2 class="section-title">Latency profile</h2>
          <p class="section-copy">These bars show where response times clustered. Taller bars mean more requests landed in that time range.</p>
          ${buildHistogram(overall.histogram)}
        </article>
      </section>

      <section class="card">
        <h2 class="section-title">Phase breakdown</h2>
        <p class="section-copy">Each phase is listed separately so you can see whether the run worsened as traffic changed.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Phase</th>
                <th>Finished</th>
                <th>Success rate</th>
                <th>Problem rate</th>
                <th>Average time</th>
                <th>P95 time</th>
                <th>Retries</th>
                <th>Drops</th>
              </tr>
            </thead>
            <tbody>
              ${phaseTableRows(report.perPhase)}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2 class="section-title">Endpoint breakdown</h2>
        <p class="section-copy">This table ranks endpoints by completed volume so non-technical readers can quickly see where the user experience was strongest or weakest.</p>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Endpoint</th>
                <th>Finished</th>
                <th>Success rate</th>
                <th>Problem rate</th>
                <th>Average time</th>
                <th>P95 time</th>
                <th>Retries</th>
                <th>Drops</th>
              </tr>
            </thead>
            <tbody>
              ${endpointTableRows(report.perEndpoint)}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2 class="section-title">How to read this report</h2>
        <p class="section-copy">These notes are written for stakeholders who care about release risk, responsiveness, and user-facing issues more than protocol details.</p>
        <ul class="notes">
          ${methodologyItems(report)}
        </ul>
        <div class="footer">
          <span>Generated by Loadstar on Node ${escapeHtml(report.metadata.nodeVersion)}</span>
          <span>${rawJsonLabel ? escapeHtml(rawJsonLabel) : ""}</span>
          ${rawReportLink(options.rawReportHref)}
        </div>
      </section>
    </main>
  </body>
</html>
`;
}

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoadBuddyReport } from "./reportTypes.js";
import { renderHtmlReport } from "./writeHtmlReport.js";

export interface ReportArtifactPaths {
  jsonPath: string;
  htmlPath: string;
}

export async function writeReport(report: LoadBuddyReport, outputPath: string): Promise<ReportArtifactPaths> {
  const jsonPath = path.resolve(outputPath);
  const parsed = path.parse(jsonPath);
  const htmlPath = path.join(parsed.dir, `${parsed.name}.html`);
  await mkdir(path.dirname(jsonPath), { recursive: true });

  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8"),
    writeFile(htmlPath, renderHtmlReport(report, { rawReportHref: path.basename(jsonPath) }), "utf-8")
  ]);

  return { jsonPath, htmlPath };
}

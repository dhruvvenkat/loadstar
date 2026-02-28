import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LoadBuddyReport } from "./reportTypes.js";

export async function writeReport(report: LoadBuddyReport, outputPath: string): Promise<void> {
  const resolved = path.resolve(outputPath);
  await mkdir(path.dirname(resolved), { recursive: true });
  await writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
}

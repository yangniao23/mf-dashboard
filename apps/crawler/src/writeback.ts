import { existsSync } from "node:fs";
import path from "node:path";
import { getJstDateParts } from "@mf-dashboard/date-utils";
import { chromium } from "playwright";
import { loginWithAuthState } from "./auth/login.js";
import { createBrowserContext } from "./browser/context.js";
import { isLinkxService } from "@mf-dashboard/meta/urls";
import {
  applyWritebackReport,
  buildWritebackPreview,
  fetchWritebackMonth,
  loadWritebackConfig,
  verifyWritebackReport,
  writeReport,
  type WritebackFilter,
  type WritebackReport,
} from "./category-writeback.js";

const DEFAULT_RULES = path.resolve(import.meta.dirname, "../../../data/category-writeback-rules.json");
const DEFAULT_REPORT = path.resolve(import.meta.dirname, "../../../data/category-writeback-report.json");

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing --${name}=...`);
  return value;
}

function parseMonth(value: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new Error("month must be YYYY-MM");
  return value;
}

function currentMonth(): string {
  const now = getJstDateParts();
  return `${now.year}-${String(now.month).padStart(2, "0")}`;
}

function monthsFromCurrent(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  const now = getJstDateParts();
  const diff = (now.year - year) * 12 + now.month - monthNumber;
  if (diff < 0) throw new Error("Future months are not supported");
  return diff;
}

function buildFilter(): WritebackFilter {
  const month = parseMonth(required(arg("month") ?? currentMonth(), "month"));
  const amount = arg("amount");
  const type = arg("type");
  if (type && type !== "income" && type !== "expense") throw new Error("type must be income or expense");
  return {
    month,
    ...(arg("account") ? { accountName: arg("account") } : {}),
    ...(arg("description") ? { descriptionContains: arg("description") } : {}),
    ...(amount ? { amount: Number(amount) } : {}),
    ...(type ? { type: type as "income" | "expense" } : {}),
    ...(arg("ids") ? { transactionIds: arg("ids")!.split(",").map((id) => id.trim()).filter(Boolean) } : {}),
  };
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));
  } catch {
    // Environment may be supplied by the service manager.
  }
  if (!isLinkxService()) throw new Error("Writeback is allowed only when MF_SERVICE=linkx");
  if (!hasFlag("apply") && hasFlag("confirm-linkx-writeback")) {
    throw new Error("--confirm-linkx-writeback is valid only with --apply");
  }
  if (hasFlag("apply") && !hasFlag("confirm-linkx-writeback")) {
    throw new Error("Refusing apply without --confirm-linkx-writeback");
  }

  const reportPath = path.resolve(arg("report") ?? DEFAULT_REPORT);
  const browser = await chromium.launch({
    headless: process.env.HEADED !== "true",
    ...(process.env.BROWSER_EXECUTABLE_PATH ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH } : {}),
  });
  const context = await createBrowserContext(browser, { useAuthState: true });
  const page = await context.newPage();
  try {
    await loginWithAuthState(page, context);
    if (!hasFlag("apply")) {
      const filter = buildFilter();
      const rules = await loadWritebackConfig(path.resolve(arg("rules") ?? DEFAULT_RULES));
      const report = await buildWritebackPreview(page, filter, rules, monthsFromCurrent(filter.month));
      await writeReport(reportPath, report);
      console.log(`dry-run: ${report.items.length} eligible transaction(s); report saved to ${reportPath}`);
      console.log("No Money Forward update was sent.");
      return;
    }

    if (!existsSync(reportPath)) throw new Error(`Dry-run report not found: ${reportPath}`);
    const report = JSON.parse(await (await import("node:fs/promises")).readFile(reportPath, "utf8")) as WritebackReport;
    const rules = await loadWritebackConfig(path.resolve(arg("rules") ?? DEFAULT_RULES));
    const fresh = await buildWritebackPreview(page, report.filter, rules, monthsFromCurrent(report.filter.month));
    if (fresh.fingerprint !== report.fingerprint) throw new Error("Dry-run report no longer matches current Linkx data");
    const applied = await applyWritebackReport(page, report);
    const verifiedData = await fetchWritebackMonth(page, report.filter.month, monthsFromCurrent(report.filter.month));
    const verified = verifyWritebackReport(applied, verifiedData);
    await writeReport(reportPath, verified);
    const failures = Object.values(verified.results ?? {}).filter((value) => value === "failed").length;
    console.log(`apply: ${report.items.length - failures}/${report.items.length} verified; report saved to ${reportPath}`);
    if (failures > 0) process.exitCode = 2;
  } finally {
    await browser.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Writeback failed");
  process.exitCode = 1;
});

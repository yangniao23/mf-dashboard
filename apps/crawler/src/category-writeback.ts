import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CashFlowItem, CashFlowSummary } from "@mf-dashboard/db/types";
import type { Page } from "playwright";
import { getCsrfToken, updateTransactionCategory } from "./hooks/helpers.js";
import { scrapeCategoryCandidates } from "./scrapers/category-candidates.js";
import { scrapeCashFlowHistory } from "./scrapers/cash-flow-history.js";
import type { CategoryCandidate } from "./category-decision/types.js";

export type WritebackRule = {
  id?: string;
  when: {
    transactionIds?: string[];
    accountName?: string;
    descriptionContains?: string;
    amount?: number;
    type?: "income" | "expense";
  };
  set: { category: string; subCategory: string };
};

export type WritebackConfig = { version: 1; rules: WritebackRule[] };
export type WritebackFilter = {
  month: string;
  accountName?: string;
  descriptionContains?: string;
  amount?: number;
  type?: "income" | "expense";
  transactionIds?: string[];
};

export type WritebackPreviewItem = {
  ruleId: string;
  mfId: string;
  date: string;
  description: string;
  amount: number;
  type: "income" | "expense";
  accountName?: string;
  before: { category: string | null; subCategory: string | null };
  after: { category: string; subCategory: string };
  largeCategoryId: string;
  middleCategoryId: string;
  isTarget: boolean;
};

export type WritebackReport = {
  version: 1;
  service: "linkx";
  filter: WritebackFilter;
  generatedAt: string;
  fingerprint: string;
  items: WritebackPreviewItem[];
  results?: Record<string, "applied" | "skipped" | "failed" | "verified">;
};

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

function ruleMatches(item: CashFlowItem, rule: WritebackRule): boolean {
  const when = rule.when;
  return (
    (!when.transactionIds || when.transactionIds.includes(item.mfId)) &&
    (!when.accountName || item.accountName === when.accountName) &&
    (!when.descriptionContains || item.description.includes(when.descriptionContains)) &&
    (when.amount === undefined || item.amount === when.amount) &&
    (!when.type || item.type === when.type)
  );
}

export function selectWritebackItems(
  cashFlow: CashFlowSummary,
  filter: WritebackFilter,
  rules: WritebackRule[],
  candidates: CategoryCandidate[],
): WritebackPreviewItem[] {
  if (cashFlow.month !== filter.month) throw new Error(`Fetched month mismatch: ${cashFlow.month}`);
  const ids = filter.transactionIds ? new Set(filter.transactionIds) : undefined;
  const selected = cashFlow.items.filter((item) =>
    item.type !== "transfer" &&
    (!ids || ids.has(item.mfId)) &&
    (!filter.accountName || item.accountName === filter.accountName) &&
    (!filter.descriptionContains || item.description.includes(filter.descriptionContains)) &&
    (filter.amount === undefined || item.amount === filter.amount) &&
    (!filter.type || item.type === filter.type),
  );
  const result: WritebackPreviewItem[] = [];
  for (const item of selected) {
    const matches = rules.filter((rule) => ruleMatches(item, rule));
    if (matches.length > 1) throw new Error(`Ambiguous rule match for transaction ${item.mfId}`);
    if (matches.length === 0 || item.mfId.startsWith("unknown")) continue;
    const rule = matches[0];
    const candidateMatches = candidates.filter(
      (candidate) =>
        candidate.largeCategoryName === rule.set.category &&
        candidate.middleCategoryName === rule.set.subCategory &&
        candidate.isIncome === (item.type === "income"),
    );
    if (candidateMatches.length !== 1) {
      throw new Error(`Category is unavailable or ambiguous for rule ${rule.id ?? "unnamed"}`);
    }
    const candidate = candidateMatches[0];
    if (
      item.category === rule.set.category &&
      item.subCategory === rule.set.subCategory
    ) continue;
    result.push({
      ruleId: rule.id ?? `${rule.set.category}:${rule.set.subCategory}`,
      mfId: item.mfId,
      date: item.date,
      description: item.description,
      amount: item.amount,
      type: item.type as "income" | "expense",
      accountName: item.accountName,
      before: { category: item.category, subCategory: item.subCategory },
      after: rule.set,
      largeCategoryId: candidate.largeCategoryId,
      middleCategoryId: candidate.middleCategoryId,
      isTarget: !item.isExcludedFromCalculation,
    });
  }
  return result;
}

export function fingerprintReportItems(items: WritebackPreviewItem[]): string {
  return stableJson(items.map(({ mfId, before, after, ...rest }) => ({ mfId, before, after, ...rest })));
}

export async function loadWritebackConfig(filePath: string): Promise<WritebackConfig> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as WritebackConfig;
  if (parsed.version !== 1 || !Array.isArray(parsed.rules)) throw new Error("Invalid writeback rules");
  return parsed;
}

export async function fetchWritebackMonth(
  page: Page,
  month: string,
  monthsFromCurrent: number,
): Promise<CashFlowSummary> {
  const history = await scrapeCashFlowHistory(page, monthsFromCurrent + 1);
  const found = history.find(({ data }) => data.month === month)?.data;
  if (!found) throw new Error(`Target month was not available: ${month}`);
  return found;
}

export async function buildWritebackPreview(
  page: Page,
  filter: WritebackFilter,
  config: WritebackConfig,
  monthsFromCurrent: number,
): Promise<WritebackReport> {
  const cashFlow = await fetchWritebackMonth(page, filter.month, monthsFromCurrent);
  const candidates = await scrapeCategoryCandidates(page);
  const items = selectWritebackItems(cashFlow, filter, config.rules, candidates);
  return {
    version: 1,
    service: "linkx",
    filter,
    generatedAt: new Date().toISOString(),
    fingerprint: fingerprintReportItems(items),
    items,
  };
}

export async function writeReport(filePath: string, report: WritebackReport): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
}

export async function applyWritebackReport(
  page: Page,
  report: WritebackReport,
  updater = updateTransactionCategory,
): Promise<WritebackReport> {
  const csrfToken = await getCsrfToken(page);
  if (!csrfToken) throw new Error("Linkx CSRF token was not found; stopped before update");
  const results = { ...(report.results ?? {}) };
  for (const item of report.items) {
    if (results[item.mfId] === "applied" || results[item.mfId] === "verified") continue;
    try {
      const response = await updater(page, csrfToken, item.mfId, {
        largeCategoryId: item.largeCategoryId,
        middleCategoryId: item.middleCategoryId,
        isIncome: item.type === "income",
        isTarget: item.isTarget,
      });
      results[item.mfId] = response.ok ? "applied" : "failed";
    } catch {
      results[item.mfId] = "failed";
    }
  }
  return { ...report, results };
}

export function verifyWritebackReport(
  report: WritebackReport,
  cashFlow: CashFlowSummary,
): WritebackReport {
  const byId = new Map(cashFlow.items.map((item) => [item.mfId, item]));
  const results = { ...(report.results ?? {}) };
  for (const item of report.items) {
    const current = byId.get(item.mfId);
    if (!current || current.category !== item.after.category || current.subCategory !== item.after.subCategory) {
      results[item.mfId] = "failed";
    } else {
      results[item.mfId] = "verified";
    }
  }
  return { ...report, results };
}

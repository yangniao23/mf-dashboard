import type { CashFlowItem, CashFlowSummary } from "@mf-dashboard/db/types";
import { describe, expect, test, vi } from "vitest";
vi.mock("./hooks/helpers.js", () => ({
  getCsrfToken: vi.fn().mockResolvedValue("csrf"),
  updateTransactionCategory: vi.fn(),
}));
import {
  applyWritebackReport,
  selectWritebackItems,
  verifyWritebackReport,
  type WritebackReport,
} from "./category-writeback.js";

const candidate = {
  largeCategoryId: "11",
  largeCategoryName: "食費",
  middleCategoryId: "41",
  middleCategoryName: "食料品",
  isIncome: false,
};
function item(overrides: Partial<CashFlowItem> = {}): CashFlowItem {
  return {
    mfId: "tx-1", date: "2026-08-01", description: "会社立替", amount: 1200,
    type: "expense", accountName: "カード", category: "未分類", subCategory: null,
    isTransfer: false, isExcludedFromCalculation: false, ...overrides,
  };
}
function flow(items: CashFlowItem[]): CashFlowSummary {
  return { month: "2026-08", totalIncome: 0, totalExpense: 0, balance: 0, items };
}
const rule = { id: "r1", when: { descriptionContains: "会社立替" }, set: { category: "食費", subCategory: "食料品" } };

describe("category writeback selection and safety", () => {
  test("ルール一致・不一致を選別する", () => {
    const result = selectWritebackItems(flow([item(), item({ mfId: "tx-2", description: "別取引" })]), { month: "2026-08" }, [rule], [candidate]);
    expect(result.map(({ mfId }) => mfId)).toEqual(["tx-1"]);
  });

  test("曖昧一致を拒否する", () => {
    expect(() => selectWritebackItems(flow([item()]), { month: "2026-08" }, [rule, { ...rule, id: "r2" }], [candidate])).toThrow("Ambiguous");
  });

  test("dry-run選定では外部更新を呼ばない", () => {
    const updater = vi.fn();
    selectWritebackItems(flow([item()]), { month: "2026-08" }, [rule], [candidate]);
    expect(updater).not.toHaveBeenCalled();
  });

  test("明示的applyだけがupdaterを呼び、再実行はskipする", async () => {
    const report = { version: 1, service: "linkx", filter: { month: "2026-08" }, generatedAt: "now", fingerprint: "x", items: selectWritebackItems(flow([item()]), { month: "2026-08" }, [rule], [candidate]) } as WritebackReport;
    const updater = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const first = await applyWritebackReport({} as never, report, updater);
    const second = await applyWritebackReport({} as never, first, updater);
    expect(updater).toHaveBeenCalledOnce();
    expect(second.results?.["tx-1"]).toBe("applied");
  });

  test("部分失敗は記録され、成功分は再実行しない", async () => {
    const items = selectWritebackItems(flow([item(), item({ mfId: "tx-2" })]), { month: "2026-08" }, [rule], [candidate]);
    const report = { version: 1, service: "linkx", filter: { month: "2026-08" }, generatedAt: "now", fingerprint: "x", items } as WritebackReport;
    const updater = vi.fn().mockResolvedValueOnce({ ok: true, status: 200 }).mockResolvedValueOnce({ ok: false, status: 500 });
    const first = await applyWritebackReport({} as never, report, updater);
    expect(first.results).toEqual({ "tx-1": "applied", "tx-2": "failed" });
    const retry = await applyWritebackReport({} as never, first, updater);
    expect(updater).toHaveBeenCalledTimes(3);
    expect(retry.results?.["tx-2"]).toBe("failed");
  });

  test("再取得結果を検証する", () => {
    const items = selectWritebackItems(flow([item()]), { month: "2026-08" }, [rule], [candidate]);
    const report = { version: 1, service: "linkx", filter: { month: "2026-08" }, generatedAt: "now", fingerprint: "x", items, results: { "tx-1": "applied" } } as WritebackReport;
    expect(verifyWritebackReport(report, flow([item({ category: "食費", subCategory: "食料品" })])).results?.["tx-1"]).toBe("verified");
  });
});

import { describe, expect, test, vi } from "vitest";
import { getCsrfToken, updateTransactionCategory } from "./helpers.js";

describe("Linkx category request", () => {
  test("CSRF meta tokenを読み、/cf/updateへPUTする", async () => {
    const evaluate = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const page = { locator: () => ({ getAttribute: vi.fn().mockResolvedValue("csrf-token") }), evaluate } as never;
    expect(await getCsrfToken(page)).toBe("csrf-token");
    await updateTransactionCategory(page, "csrf-token", "tx-1", {
      largeCategoryId: "11", middleCategoryId: "41", isIncome: false, isTarget: true,
    });
    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ id: "tx-1", csrf: "csrf-token" }));
  });
});

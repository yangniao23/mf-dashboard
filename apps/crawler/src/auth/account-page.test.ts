import { afterEach, expect, test, vi } from "vitest";
import { ensureAccountPage } from "./account-page.js";

afterEach(() => vi.unstubAllEnvs());

function mockPage(url: string, status = 200, table = true) {
  return {
    goto: vi.fn().mockResolvedValue({ status: () => status }),
    url: () => url,
    locator: () => ({ first: () => ({ waitFor: async () => {
      if (!table) throw new Error("private page contents");
    } }) }),
  };
}

test("accepts the protected Linkx account table", async () => {
  vi.stubEnv("MF_SERVICE", "linkx");
  await expect(ensureAccountPage(mockPage("https://linkx.x.moneyforward.com/accounts") as never)).resolves.toBeUndefined();
});

test.each([
  ["https://linkx.x.moneyforward.com/users/sign_in?secret=hidden", 200, "ACCOUNT_AUTH_REQUIRED"],
  ["https://id.moneyforward.com/", 200, "ACCOUNT_AUTH_REQUIRED"],
  ["https://linkx.x.moneyforward.com/accounts", 403, "ACCOUNT_ACCESS_DENIED"],
  ["https://linkx.x.moneyforward.com/accounts", 503, "ACCOUNT_HTTP_ERROR"],
  ["https://linkx.x.moneyforward.com/accounts", 200, "ACCOUNT_LAYOUT_UNSUPPORTED"],
])("rejects unavailable account page without revealing its contents", async (url, status, code) => {
  vi.stubEnv("MF_SERVICE", "linkx");
  const failure = await ensureAccountPage(mockPage(url, status, false) as never).catch(e => e);
  expect(failure.message).toContain(code);
  expect(failure.message).not.toMatch(/hidden|private page contents|https:/);
});

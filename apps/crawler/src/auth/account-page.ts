import { mfUrls } from "@mf-dashboard/meta/urls";
import type { Page } from "playwright";

export function classifyAccountPage(url: string, status?: number): string {
  const actual = new URL(url);
  const expected = new URL(mfUrls.accounts);
  if (actual.origin !== expected.origin || /sign_in|login|otp|verification|challenge/.test(actual.pathname)) {
    return "ACCOUNT_AUTH_REQUIRED";
  }
  if (status === 401 || status === 403) return "ACCOUNT_ACCESS_DENIED";
  if (status && status >= 400) return "ACCOUNT_HTTP_ERROR";
  return "ACCOUNT_LAYOUT_UNSUPPORTED";
}

/** Verify a protected page without logging URLs, HTML or account contents. */
export async function ensureAccountPage(page: Page): Promise<void> {
  const response = await page.goto(mfUrls.accounts, { waitUntil: "domcontentloaded" });
  try {
    const actual = new URL(page.url());
    if (actual.origin !== new URL(mfUrls.accounts).origin || actual.pathname !== "/accounts" ||
        (response && response.status() >= 400)) throw new Error("Unexpected account page");
    await page.locator("#account-table").first().waitFor({ state: "visible", timeout: 10000 });
  } catch {
    throw new Error(`Account page unavailable (${classifyAccountPage(page.url(), response?.status())}); check Linkx login or page compatibility`);
  }
}

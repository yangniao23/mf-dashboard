import { afterEach, describe, expect, test } from "vitest";
import { getMfService, isLinkxService, mfUrls } from "./urls.js";

describe("Money Forward service URLs", () => {
  const runtime = globalThis as typeof globalThis & {
    process: { env: { MF_SERVICE?: string } };
  };
  const env = runtime.process.env;
  const originalService = env.MF_SERVICE;

  afterEach(() => {
    if (originalService === undefined) {
      delete env.MF_SERVICE;
    } else {
      env.MF_SERVICE = originalService;
    }
  });

  test("uses Money Forward ME by default", () => {
    delete env.MF_SERVICE;

    expect(getMfService()).toBe("me");
    expect(isLinkxService()).toBe(false);
    expect(mfUrls.home).toBe("https://moneyforward.com/");
    expect(mfUrls.auth.signIn).toBe("https://id.moneyforward.com/sign_in");
  });

  test("uses the SOMPO Linkx service when configured", () => {
    env.MF_SERVICE = "linkx";

    expect(getMfService()).toBe("linkx");
    expect(isLinkxService()).toBe(true);
    expect(mfUrls.home).toBe("https://linkx.x.moneyforward.com/");
    expect(mfUrls.auth.signIn).toBe("https://linkx.x.moneyforward.com/users/sign_in");
    expect(mfUrls.cashFlow).toBe("https://linkx.x.moneyforward.com/cf");
    expect(mfUrls.accountDetail("abc", "show_manual")).toBe(
      "https://linkx.x.moneyforward.com/accounts/show_manual/abc",
    );
  });

  test("rejects an unsupported service", () => {
    expect(() => getMfService({ MF_SERVICE: "unknown" })).toThrow("Unsupported MF_SERVICE");
  });
});

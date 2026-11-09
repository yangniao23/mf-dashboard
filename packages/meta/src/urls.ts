export type MfService = "me" | "linkx";
export interface MfEnvironment {
  MF_SERVICE?: string;
}

const ME_BASE_URL = "https://moneyforward.com";
const ID_BASE_URL = "https://id.moneyforward.com";
const LINKX_BASE_URL = "https://linkx.x.moneyforward.com";

/**
 * Select the Money Forward service without reading the environment at module
 * load time. The crawler loads `.env` after its modules are imported.
 */
function getRuntimeEnv(): MfEnvironment {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: MfEnvironment };
  };
  return runtime.process?.env ?? {};
}

export function getMfService(env: MfEnvironment = getRuntimeEnv()): MfService {
  const service = env.MF_SERVICE?.trim().toLowerCase() || "me";
  if (service === "me" || service === "linkx") {
    return service;
  }

  throw new Error(`Unsupported MF_SERVICE: ${service}`);
}

export function isLinkxService(env: MfEnvironment = getRuntimeEnv()): boolean {
  return getMfService(env) === "linkx";
}

function getBaseUrl(): string {
  return isLinkxService() ? LINKX_BASE_URL : ME_BASE_URL;
}

export const mfUrls = {
  /** トップページ */
  get home() {
    return `${getBaseUrl()}/`;
  },
  /** 家計簿（収支詳細） */
  get cashFlow() {
    return `${getBaseUrl()}/cf`;
  },
  /** 家計簿（月次収支） */
  get monthlyCashFlow() {
    return `${getBaseUrl()}/cf/monthly`;
  },
  /** 資産推移 */
  get assetHistory() {
    return `${getBaseUrl()}/bs/history`;
  },
  /** ポートフォリオ */
  get portfolio() {
    return `${getBaseUrl()}/bs/portfolio`;
  },
  /** 負債 */
  get liability() {
    return `${getBaseUrl()}/bs/liability`;
  },
  /** 口座一覧 */
  get accounts() {
    return `${getBaseUrl()}/accounts`;
  },
  /** 予算 */
  get spendingTargets() {
    return `${getBaseUrl()}/spending_targets/edit`;
  },
  /** カテゴリ設定 */
  get categoryRules() {
    return `${getBaseUrl()}/profile/rule`;
  },
  /** ログイン */
  get signIn() {
    return isLinkxService() ? `${getBaseUrl()}/users/sign_in` : `${getBaseUrl()}/sign_in`;
  },

  auth: {
    /** MFID / サービス固有ログインページ */
    get signIn() {
      return isLinkxService() ? `${getBaseUrl()}/users/sign_in` : `${ID_BASE_URL}/sign_in`;
    },
    /** MFID パスワード入力ページ */
    get password() {
      return isLinkxService() ? `${getBaseUrl()}/users/sign_in` : `${ID_BASE_URL}/sign_in/password`;
    },
  },

  /** 口座詳細ページURL を生成 */
  accountDetail(mfId: string, type: "show" | "show_manual" = "show"): string {
    return `${getBaseUrl()}/accounts/${type}/${mfId}`;
  },
} as const;

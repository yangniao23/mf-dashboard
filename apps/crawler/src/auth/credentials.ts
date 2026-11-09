import { execFile } from "node:child_process";
import { createClient, type Client } from "@1password/sdk";
import { debug, error } from "../logger.js";

interface Credentials {
  username: string;
  password: string;
}

interface BitwardenItem {
  login?: {
    username?: unknown;
    password?: unknown;
  };
  fields?: Array<{
    name?: unknown;
    value?: unknown;
  }>;
}

type CredentialProvider = "1password" | "bitwarden";

const BITWARDEN_MAX_BUFFER = 1024 * 1024;

// 1Password SDK client (singleton)
let _opClient: Client | null = null;

function getCredentialProvider(env: NodeJS.ProcessEnv = process.env): CredentialProvider {
  const provider = env.CREDENTIAL_PROVIDER?.trim().toLowerCase() || "1password";
  if (provider === "bitwarden" || provider === "1password") {
    return provider;
  }

  throw new Error(`Unsupported credential provider: ${provider}`);
}

function getBitwardenItemId(env: NodeJS.ProcessEnv = process.env): string {
  const itemId = env.BW_ITEM_ID?.trim();
  if (!itemId) {
    throw new Error("BW_ITEM_ID is not set");
  }
  return itemId;
}

function getBitwardenCliPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BW_CLI_PATH?.trim() || "bw";
}

function runBitwarden(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      getBitwardenCliPath(),
      args,
      {
        env: process.env,
        maxBuffer: BITWARDEN_MAX_BUFFER,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error) {
          // Do not include stderr or command output: Bitwarden output may contain secrets.
          reject(new Error("Bitwarden CLI command failed"));
          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

async function getBitwardenItem(): Promise<BitwardenItem> {
  const itemId = getBitwardenItemId();
  let raw: string;

  try {
    raw = await runBitwarden(["get", "item", itemId]);
  } catch {
    throw new Error("Failed to read the Bitwarden item");
  }

  try {
    return JSON.parse(raw) as BitwardenItem;
  } catch {
    throw new Error("Bitwarden returned invalid item data");
  }
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Bitwarden item field is empty: ${fieldName}`);
  }
  return value;
}

async function getBitwardenCredentials(): Promise<Credentials> {
  const item = await getBitwardenItem();
  return {
    username: requiredString(item.login?.username, "username"),
    password: requiredString(item.login?.password, "password"),
  };
}

async function getBitwardenOtp(): Promise<string> {
  const itemId = getBitwardenItemId();

  try {
    return requiredString(await runBitwarden(["get", "totp", itemId]), "TOTP");
  } catch {
    throw new Error("Bitwarden item has no usable TOTP");
  }
}

/**
 * 1Password SDKクライアントを取得する。
 */
async function getOpClient(): Promise<Client> {
  if (_opClient) {
    return _opClient;
  }

  const token = process.env.OP_SERVICE_ACCOUNT_TOKEN;
  if (!token) {
    error("OP_SERVICE_ACCOUNT_TOKEN が設定されていません");
    process.exit(1);
  }

  debug("1Password SDK クライアントを初期化しています...");
  _opClient = await createClient({
    auth: token,
    integrationName: "mf-dashboard",
    integrationVersion: "1.0.0",
  });

  return _opClient;
}

export async function getCredentials(): Promise<Credentials> {
  if (getCredentialProvider() === "bitwarden") {
    return getBitwardenCredentials();
  }

  const vault = process.env.OP_VAULT || "";
  const item = process.env.OP_ITEM || "";

  const client = await getOpClient();

  debug("1Password から認証情報を取得しています...");
  const [username, password] = await Promise.all([
    client.secrets.resolve(`op://${vault}/${item}/username`),
    client.secrets.resolve(`op://${vault}/${item}/password`),
  ]);

  if (!username || !password) {
    throw new Error("Failed to get credentials from 1Password");
  }

  return { username, password };
}

export async function getOTP(): Promise<string> {
  if (getCredentialProvider() === "bitwarden") {
    return getBitwardenOtp();
  }

  const vault = process.env.OP_VAULT || "";
  const item = process.env.OP_ITEM || "";
  const totpField = process.env.OP_TOTP_FIELD || "";

  if (!totpField) {
    throw new Error("OP_TOTP_FIELD が設定されていません");
  }

  const client = await getOpClient();

  debug("1Password から OTP を取得しています...");
  const otp = await client.secrets.resolve(`op://${vault}/${item}/${totpField}?attribute=totp`);

  if (!otp) {
    throw new Error("OTP の取得に失敗しました");
  }

  return otp;
}

/**
 * テスト用: クライアントをリセット
 */
export function _resetOpClient(): void {
  _opClient = null;
}

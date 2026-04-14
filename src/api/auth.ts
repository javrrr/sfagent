/**
 * Authentication for the Salesforce Models API.
 *
 * Two auth paths:
 *   1. sf CLI — for org operations (deploy, query, org info)
 *   2. Client credentials JWT — for the Models API itself
 *
 * The Models API requires an External Client App with:
 *   - client_credentials flow enabled
 *   - JWT-based access tokens
 *   - Scopes: api, refresh_token/offline_access, sfap_api
 *
 * Credentials (consumer key + secret) are stored in ~/.sfagent/credentials.json
 * after the user runs /setup.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import type { AuthToken, StoredCredentials, SfAgentConfig } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".sfagent");
const CREDENTIALS_PATH = path.join(CONFIG_DIR, "credentials.json");
const TOKEN_CACHE_PATH = path.join(CONFIG_DIR, "token.json");

let cachedToken: AuthToken | null = null;

// ---------------------------------------------------------------------------
// sf CLI helpers
// ---------------------------------------------------------------------------

/** Run sf CLI with args as an array (no shell). */
function sfExec(...args: string[]): string {
  return execFileSync("sf", args, {
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function sfCliAvailable(): boolean {
  try {
    sfExec("--version");
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Org resolution (via sf CLI)
// ---------------------------------------------------------------------------

interface SfOrgListResult {
  result: {
    nonScratchOrgs?: Array<{
      username: string;
      alias?: string;
      isDefaultUsername?: boolean;
      connectedStatus: string;
      instanceUrl: string;
    }>;
    scratchOrgs?: Array<{
      username: string;
      alias?: string;
      isDefaultUsername?: boolean;
      connectedStatus: string;
      instanceUrl: string;
    }>;
  };
}

export interface OrgEntry {
  username: string;
  alias: string;
  instanceUrl: string;
  isDefault: boolean;
}

export function listConnectedOrgs(): OrgEntry[] {
  try {
    const stdout = sfExec("org", "list", "--json");
    const data = JSON.parse(stdout) as SfOrgListResult;
    const allOrgs = [
      ...(data.result.nonScratchOrgs ?? []),
      ...(data.result.scratchOrgs ?? []),
    ].filter((o) => o.connectedStatus === "Connected");

    return allOrgs.map((o) => ({
      username: o.username,
      alias: o.alias ?? "",
      instanceUrl: o.instanceUrl,
      isDefault: o.isDefaultUsername ?? false,
    }));
  } catch {
    return [];
  }
}

function resolveTargetOrg(): string {
  const envOrg = process.env.SF_TARGET_ORG;
  if (envOrg) return envOrg;

  const orgs = listConnectedOrgs();
  const defaultOrg = orgs.find((o) => o.isDefault);
  if (defaultOrg) return defaultOrg.alias || defaultOrg.username;
  if (orgs.length > 0) return orgs[0]!.alias || orgs[0]!.username;

  return "";
}

// ---------------------------------------------------------------------------
// Stored credentials (External Client App consumer key + secret)
// ---------------------------------------------------------------------------

export async function loadCredentials(): Promise<StoredCredentials | null> {
  try {
    const raw = await fs.readFile(CREDENTIALS_PATH, "utf-8");
    return JSON.parse(raw) as StoredCredentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: StoredCredentials): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

// ---------------------------------------------------------------------------
// Client credentials → JWT token exchange
// ---------------------------------------------------------------------------

async function fetchJwtToken(creds: StoredCredentials): Promise<AuthToken> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.consumerKey,
    client_secret: creds.consumerSecret,
  });

  const tokenUrl = `${creds.myDomain}/services/oauth2/token`;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();

    if (res.status === 400 && text.includes("invalid_grant")) {
      throw new Error(
        `Token request failed: invalid_grant.\n` +
          "Check that:\n" +
          `  - My Domain URL is correct: ${creds.myDomain}\n` +
          "  - Client Credentials Flow is enabled on the External Client App\n" +
          "  - A Run As user is configured in the app's Policies tab\n" +
          "  - The app includes these scopes: api, sfap_api, refresh_token\n\n" +
          "Run /setup to reconfigure."
      );
    }

    throw new Error(`Token request failed (${res.status}): ${text}`);
  }

  const token = (await res.json()) as AuthToken;

  // Compute expiry — JWT tokens default to 30 min
  if (!token.expires_at && token.issued_at) {
    token.expires_at = parseInt(token.issued_at, 10) + 1800_000;
  }

  // Cache to disk
  await fs.mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await fs.writeFile(TOKEN_CACHE_PATH, JSON.stringify(token, null, 2), {
    mode: 0o600,
  });

  return token;
}

async function loadCachedToken(): Promise<AuthToken | null> {
  try {
    const raw = await fs.readFile(TOKEN_CACHE_PATH, "utf-8");
    return JSON.parse(raw) as AuthToken;
  } catch {
    return null;
  }
}

function isTokenExpired(token: AuthToken): boolean {
  if (!token.expires_at) return false;
  return Date.now() > token.expires_at - 60_000;
}

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

export async function loadConfig(): Promise<SfAgentConfig> {
  if (!sfCliAvailable()) {
    throw new Error(
      "Salesforce CLI (sf) not found.\n\n" +
        "Install it: npm install -g @salesforce/cli\n"
    );
  }

  const model = process.env.SF_MODEL ?? "";
  const targetOrg = resolveTargetOrg();
  const credentials = await loadCredentials();

  return { credentials, targetOrg, model };
}

// ---------------------------------------------------------------------------
// sf CLI login
// ---------------------------------------------------------------------------

export function loginWithSfCli(alias?: string): void {
  const sfArgs = ["org", "login", "web"];
  if (alias) sfArgs.push("--alias", alias);
  sfArgs.push("--set-default");

  console.log("\nOpening browser for Salesforce login...\n");

  try {
    execFileSync("sf", sfArgs, {
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch {
    throw new Error("sf org login web failed or was cancelled.");
  }
}

// ---------------------------------------------------------------------------
// Models API token
// ---------------------------------------------------------------------------

export async function getModelsApiToken(
  config: SfAgentConfig
): Promise<AuthToken> {
  if (!config.credentials) {
    throw new Error(
      "No API credentials configured.\n" +
        "Run /setup to create an External Client App and store credentials."
    );
  }

  // 1. In-memory cache
  if (cachedToken && !isTokenExpired(cachedToken)) {
    return cachedToken;
  }

  // 2. Disk cache
  const diskToken = await loadCachedToken();
  if (diskToken && !isTokenExpired(diskToken)) {
    cachedToken = diskToken;
    return diskToken;
  }

  // 3. Fresh JWT via client_credentials
  cachedToken = await fetchJwtToken(config.credentials);
  return cachedToken;
}

export function clearCachedToken(): void {
  cachedToken = null;
}

// ---------------------------------------------------------------------------
// Org info (via sf CLI)
// ---------------------------------------------------------------------------

interface SfOrgDisplayResult {
  result: {
    accessToken: string;
    instanceUrl: string;
    username: string;
    alias?: string;
    id: string;
    connectedStatus: string;
    apiVersion: string;
  };
}

export function getOrgInfo(targetOrg?: string): Record<string, string> {
  const sfArgs = ["org", "display", "--json"];
  if (targetOrg) sfArgs.push("--target-org", targetOrg);

  try {
    const stdout = sfExec(...sfArgs);
    const data = JSON.parse(stdout) as SfOrgDisplayResult;
    const org = data.result;
    return {
      username: org.username,
      alias: org.alias ?? "",
      instanceUrl: org.instanceUrl,
      orgId: org.id,
      apiVersion: org.apiVersion,
      status: org.connectedStatus,
    };
  } catch {
    return {};
  }
}

/**
 * Get the My Domain URL for an org via sf CLI.
 */
export function getMyDomain(targetOrg?: string): string | null {
  const sfArgs = ["org", "display", "--json"];
  if (targetOrg) sfArgs.push("--target-org", targetOrg);

  try {
    const stdout = sfExec(...sfArgs);
    const data = JSON.parse(stdout) as SfOrgDisplayResult;
    return data.result.instanceUrl ?? null;
  } catch {
    return null;
  }
}

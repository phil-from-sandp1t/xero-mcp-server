import fs from "node:fs";

import axios, { AxiosError } from "axios";

/**
 * On-disk token store for the refresh-token auth mode.
 *
 * Written by the PKCE bootstrap command (npx -p @xeroapi/xero-mcp-server xero-auth) and then
 * kept current by RefreshTokenXeroClient. Xero rotates the refresh token on
 * every refresh, so the file is the single source of truth and must survive
 * each rotation.
 */
export interface XeroTokenStore {
  access_token?: string;
  refresh_token: string;
  /** Epoch milliseconds at which access_token stops being accepted. */
  expires_at?: number;
  scope?: string;
  saved_at?: string;
  /**
   * Client id these tokens were issued to. Recorded so re-authorisation can
   * reuse it instead of asking for it again — and so it cannot silently drift
   * from the client id the server authenticates with.
   */
  client_id?: string;
}

export interface XeroTokenResponse {
  access_token: string;
  refresh_token?: string;
  /** Lifetime of access_token in seconds, as returned by Xero. */
  expires_in: number;
  scope?: string;
  token_type?: string;
}

/** Xero access tokens live 30 minutes; renew while there is still room to fail. */
export const DEFAULT_REFRESH_MARGIN_MS = 10 * 60 * 1000;

const TOKEN_ENDPOINT = "https://identity.xero.com/connect/token";

export function readTokenStore(file: string): XeroTokenStore {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(
      `Xero token file not found at ${file}. Run 'npm run auth' in the server directory (or 'npx -p @xeroapi/xero-mcp-server xero-auth' if installed from npm)`,
    );
  }

  let parsed: Partial<XeroTokenStore>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Xero token file at ${file} is not valid JSON.`);
  }

  if (!parsed.refresh_token) {
    throw new Error(
      `Xero token file at ${file} has no refresh_token. Re-authorise with 'npm run auth' in the server directory (or 'npx -p @xeroapi/xero-mcp-server xero-auth' if installed from npm)`,
    );
  }

  return parsed as XeroTokenStore;
}

export function writeTokenStore(file: string, store: XeroTokenStore): void {
  // Write-then-rename: a half-written token file costs an interactive re-auth.
  const tmp = `${file}.tmp`;

  // The mode argument only applies when the file is created, so a temp file
  // left behind by an earlier crash would be reused with whatever permissions
  // it already had — and the rename would hand those to the live token file.
  // Remove it, create exclusively, and set the mode on the descriptor.
  fs.rmSync(tmp, { force: true });
  const handle = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.fchmodSync(handle, 0o600);
    fs.writeFileSync(handle, JSON.stringify(store, null, 2));
  } finally {
    fs.closeSync(handle);
  }

  fs.renameSync(tmp, file);
}

export function isExpiring(
  store: XeroTokenStore,
  marginMs: number = DEFAULT_REFRESH_MARGIN_MS,
  now: number = Date.now(),
): boolean {
  if (!store.access_token || !store.expires_at) return true;
  return store.expires_at - now <= marginMs;
}

export function applyTokenResponse(
  previous: XeroTokenStore,
  response: XeroTokenResponse,
  now: number = Date.now(),
): XeroTokenStore {
  return {
    access_token: response.access_token,
    // Xero returns a new refresh token on every refresh; only fall back to the
    // old one if this response did not carry a replacement.
    refresh_token: response.refresh_token || previous.refresh_token,
    expires_at: now + response.expires_in * 1000,
    scope: response.scope ?? previous.scope,
    saved_at: new Date(now).toISOString(),
    client_id: previous.client_id,
  };
}

/**
 * Client id to authenticate the token file with: the environment if set,
 * otherwise the one recorded in the file when it was authorised. Lets a
 * configured server carry only XERO_TOKEN_FILE, and makes a mismatch between
 * the two impossible to introduce by accident.
 */
export function resolveClientId(
  envClientId: string | undefined,
  file: string,
  readStore: (file: string) => XeroTokenStore = readTokenStore,
): string {
  if (envClientId) return envClientId;

  const recorded = readStore(file).client_id;
  if (!recorded) {
    throw new Error(
      `XERO_TOKEN_FILE is set but no client id is available: ${file} predates client id recording. Set XERO_CLIENT_ID, or re-authorise with 'npm run auth' in the server directory (or 'npx -p @xeroapi/xero-mcp-server xero-auth' if installed from npm)`,
    );
  }
  return recorded;
}

/** Injectable so the refresh path can be tested without network access. */
export type TokenPoster = (
  body: string,
  headers: Record<string, string>,
) => Promise<XeroTokenResponse>;

export const postTokenRequest: TokenPoster = async (body, headers) => {
  const response = await axios.post(TOKEN_ENDPOINT, body, { headers });
  return response.data as XeroTokenResponse;
};

/**
 * Present the client on a token request. A confidential app authenticates with
 * basic auth; a public (PKCE) app has no secret and identifies itself in the
 * body. Shared between the authorization-code exchange and the refresh so the
 * two cannot drift apart — a confidential app that works for one must work for
 * the other.
 */
export function applyClientAuth(
  params: URLSearchParams,
  headers: Record<string, string>,
  clientId: string,
  clientSecret?: string,
): void {
  if (clientSecret) {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
    headers.Authorization = `Basic ${credentials}`;
  } else {
    params.set("client_id", clientId);
  }
}

export async function refreshTokenSet(
  args: {
    clientId: string;
    clientSecret?: string;
    refreshToken: string;
  },
  post: TokenPoster = postTokenRequest,
): Promise<XeroTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: args.refreshToken,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  applyClientAuth(params, headers, args.clientId, args.clientSecret);

  try {
    return await post(params.toString(), headers);
  } catch (error) {
    throw new XeroTokenRefreshError(
      `Failed to refresh Xero token: ${describeError(error)}`,
      detectInvalidGrant(error),
    );
  }
}

export class XeroTokenRefreshError extends Error {
  /** Xero rejected the refresh token itself, rather than failing transiently. */
  public readonly invalidGrant: boolean;

  constructor(message: string, invalidGrant: boolean) {
    super(message);
    this.name = "XeroTokenRefreshError";
    this.invalidGrant = invalidGrant;
  }
}

export function isInvalidGrant(error: unknown): boolean {
  return error instanceof XeroTokenRefreshError && error.invalidGrant;
}

function detectInvalidGrant(error: unknown): boolean {
  const data = (error as AxiosError)?.response?.data;
  if (data && typeof data === "object") {
    return (data as { error?: string }).error === "invalid_grant";
  }
  return typeof data === "string" && data.includes("invalid_grant");
}

function describeError(error: unknown): string {
  const axiosError = error as AxiosError;
  const data = axiosError?.response?.data;
  if (data) {
    // Never widen this to the whole response: token endpoint errors are safe to
    // surface, token endpoint successes are not.
    return typeof data === "object" ? JSON.stringify(data) : String(data);
  }
  return axiosError?.message ?? String(error);
}

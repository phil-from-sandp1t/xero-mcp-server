import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";

import axios from "axios";

import {
  XeroTokenResponse,
  XeroTokenStore,
  readTokenStore,
} from "../clients/xero-token-store.js";

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_ENDPOINT = "https://identity.xero.com/connect/token";

/**
 * Scopes used only when there is nothing better to go on — no existing token
 * file and no XERO_SCOPES. Any established setup inherits its own scopes
 * instead, so re-authorising cannot silently narrow or widen access.
 */
export const FALLBACK_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
  "accounting.reports.read",
].join(" ");

export const DEFAULT_AUTH_PORT = 3333;

export interface AuthConfig {
  clientId: string;
  scopes: string;
  tokenFile: string;
  port: number;
  /** Where each value came from, so the CLI can show its working. */
  sources: { clientId: string; scopes: string };
}

export interface AuthEnv {
  XERO_CLIENT_ID?: string;
  XERO_SCOPES?: string;
  XERO_TOKEN_FILE?: string;
  XERO_AUTH_PORT?: string;
}

/**
 * Work out what to authorise for.
 *
 * Precedence is environment, then the existing token file, then a built-in
 * fallback. Inheriting from the token file is the point: re-authorising an
 * established setup should reproduce the scopes and client id already in use,
 * not quietly swap in defaults that differ from them.
 */
export function resolveAuthConfig(
  env: AuthEnv,
  cwd: string,
  readStore: (file: string) => XeroTokenStore = readTokenStore,
): AuthConfig {
  const tokenFile = path.resolve(
    env.XERO_TOKEN_FILE || path.join(cwd, ".xero-tokens.json"),
  );

  let existing: XeroTokenStore | undefined;
  try {
    existing = readStore(tokenFile);
  } catch {
    // No usable token file yet — a first-time bootstrap, so env or fallback.
    existing = undefined;
  }

  const clientId = env.XERO_CLIENT_ID || existing?.client_id;
  if (!clientId) {
    throw new Error(
      `XERO_CLIENT_ID is not set, and no client id is recorded in ${tokenFile}.`,
    );
  }

  const scopes = env.XERO_SCOPES || existing?.scope || FALLBACK_SCOPES;
  if (!scopes.split(/\s+/).includes("offline_access")) {
    throw new Error(
      "Scopes must include offline_access, otherwise Xero issues no refresh token.",
    );
  }

  return {
    clientId,
    scopes,
    tokenFile,
    port: Number(env.XERO_AUTH_PORT || DEFAULT_AUTH_PORT),
    sources: {
      clientId: env.XERO_CLIENT_ID ? "environment" : "token file",
      scopes: env.XERO_SCOPES
        ? "environment"
        : existing?.scope
          ? "token file"
          : "built-in fallback",
    },
  };
}

export interface PkceChallenge {
  verifier: string;
  challenge: string;
  state: string;
}

export function createPkceChallenge(): PkceChallenge {
  const verifier = crypto.randomBytes(64).toString("base64url");
  return {
    verifier,
    challenge: crypto.createHash("sha256").update(verifier).digest("base64url"),
    state: crypto.randomBytes(16).toString("hex"),
  };
}

export function buildAuthorizeUrl(
  config: Pick<AuthConfig, "clientId" | "scopes" | "port">,
  challenge: PkceChallenge,
): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", redirectUri(config.port));
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("state", challenge.state);
  url.searchParams.set("code_challenge", challenge.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function redirectUri(port: number): string {
  return `http://localhost:${port}/callback`;
}

export async function exchangeCodeForTokens(args: {
  code: string;
  clientId: string;
  codeVerifier: string;
  port: number;
}): Promise<XeroTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: redirectUri(args.port),
    client_id: args.clientId,
    code_verifier: args.codeVerifier,
  }).toString();

  const response = await axios.post(TOKEN_ENDPOINT, body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
  });

  return response.data as XeroTokenResponse;
}

export interface CallbackResult {
  code: string;
}

/**
 * Serve the redirect URI until Xero calls back, then hand over the code.
 * Resolves once, and always closes the listener.
 */
export function awaitCallback(
  port: number,
  expectedState: string,
  onListening: () => void,
): Promise<CallbackResult> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const finish = (status: number, html: string, err?: Error) => {
        res.writeHead(status, { "Content-Type": "text/html" });
        res.end(html);
        server.close();
        if (err) reject(err);
      };

      const error = url.searchParams.get("error");
      if (error) {
        const description = url.searchParams.get("error_description") ?? "";
        finish(
          400,
          `<h2>Authorisation failed: ${error}</h2><p>${description}</p>`,
          new Error(`Xero returned ${error}. ${description}`.trim()),
        );
        return;
      }

      if (url.searchParams.get("state") !== expectedState) {
        finish(
          400,
          "<h2>State mismatch. Possible CSRF. Try again.</h2>",
          new Error("State mismatch between request and callback."),
        );
        return;
      }

      const code = url.searchParams.get("code");
      if (!code) {
        finish(
          400,
          "<h2>No authorisation code in callback.</h2>",
          new Error("Callback carried no authorisation code."),
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`
        <html><body style="font-family:sans-serif;max-width:520px;margin:60px auto;text-align:center">
          <h2>Xero authorisation complete</h2>
          <p>Tokens saved. Nothing to restart — the server picks them up on its next call.</p>
          <p style="color:#888;font-size:12px">You can close this tab.</p>
        </body></html>
      `);
      server.close();
      resolve({ code });
    });

    server.on("error", reject);
    server.listen(port, onListening);
  });
}

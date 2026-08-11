import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";

import {
  TokenPoster,
  XeroTokenResponse,
  XeroTokenStore,
  applyClientAuth,
  postTokenRequest,
  readTokenStore,
} from "../clients/xero-token-store.js";

const AUTHORIZE_URL = "https://login.xero.com/identity/connect/authorize";

/**
 * Scopes used only when there is nothing better to go on — no existing token
 * file and no XERO_SCOPES. Any established setup inherits its own scopes
 * instead, so re-authorising cannot silently narrow or widen access.
 *
 * Granular scopes throughout: `accounting.transactions` and
 * `accounting.reports.read` are deprecated in favour of these. No payroll
 * scopes — the Xero Payroll API covers AU, UK and NZ only, so they are dead
 * weight for everyone else; request them explicitly via XERO_SCOPES if needed.
 */
export const FALLBACK_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  // accounting.invoices also covers credit notes, quotes, purchase orders,
  // repeating invoices, linked transactions and items.
  "accounting.invoices",
  "accounting.invoices.read",
  "accounting.payments",
  "accounting.payments.read",
  "accounting.banktransactions",
  "accounting.banktransactions.read",
  "accounting.manualjournals",
  "accounting.reports.balancesheet.read",
  "accounting.reports.profitandloss.read",
  "accounting.reports.trialbalance.read",
  "accounting.reports.aged.read",
  "accounting.reports.taxreports.read",
  "accounting.contacts",
  "accounting.settings",
].join(" ");

export const DEFAULT_AUTH_PORT = 3333;

/**
 * Raised when the flow cannot proceed without a client id the caller must
 * obtain from the user. Distinct from other config errors so a tool can tell
 * "ask the user a question" apart from "something is broken".
 */
export class MissingClientIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MissingClientIdError";
  }
}

export interface AuthConfig {
  clientId: string;
  /** Present only for a confidential app; absent for a public PKCE app. */
  clientSecret?: string;
  scopes: string;
  tokenFile: string;
  port: number;
  /** Where each value came from, so the CLI can show its working. */
  sources: { clientId: string; scopes: string };
}

/**
 * Environment this flow reads. Every field is optional, so `NodeJS.ProcessEnv`
 * satisfies it directly via its index signature — passing `process.env` needs
 * no cast.
 */
export interface AuthEnv {
  XERO_CLIENT_ID?: string;
  XERO_CLIENT_SECRET?: string;
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
    throw new MissingClientIdError(
      `No Xero client id available: XERO_CLIENT_ID is not set and none is recorded in ${tokenFile}. Ask the user for their Xero app's client id — they can find it in the Xero developer portal (my apps, then the app's configuration) — and supply it as the clientId argument or XERO_CLIENT_ID.`,
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
    // Never inherited from the token file: a secret is not stored there.
    clientSecret: env.XERO_CLIENT_SECRET,
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

export async function exchangeCodeForTokens(
  args: {
    code: string;
    clientId: string;
    /** Set for a confidential app; sent as basic auth, never in the body. */
    clientSecret?: string;
    codeVerifier: string;
    port: number;
  },
  post: TokenPoster = postTokenRequest,
): Promise<XeroTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: redirectUri(args.port),
    code_verifier: args.codeVerifier,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  applyClientAuth(params, headers, args.clientId, args.clientSecret);

  return post(params.toString(), headers);
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

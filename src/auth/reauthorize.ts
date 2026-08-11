import { writeTokenStore } from "../clients/xero-token-store.js";
import { ensureError } from "../helpers/ensure-error.js";
import { openBrowser as defaultOpenBrowser } from "./open-browser.js";
import {
  AuthEnv,
  MissingClientIdError,
  awaitCallback,
  buildAuthorizeUrl,
  createPkceChallenge,
  exchangeCodeForTokens,
  redirectUri,
  resolveAuthConfig,
} from "./pkce.js";

export type ReauthorizationState =
  | "authorized"
  | "waiting"
  | "error"
  | "needs client id";

export interface ReauthorizationResult {
  state: ReauthorizationState;
  /** Present while waiting, so the user can open it if no browser appeared. */
  authorizeUrl?: string;
  redirectUri?: string;
  tokenFile?: string;
  scopes?: string[];
  clientIdSource?: string;
  scopesSource?: string;
  error?: string;
}

/**
 * A re-authorisation in progress.
 *
 * Held at module scope because the flow outlives the tool call that starts it:
 * a login takes as long as the person takes, which is far longer than a tool
 * call should block. The first call starts the flow and returns the URL; a
 * later call reports the outcome.
 */
interface PendingFlow {
  authorizeUrl: string;
  redirectUri: string;
  tokenFile: string;
  scopes: string[];
  settled: { state: "authorized" | "error"; error?: string } | null;
  completion: Promise<void>;
}

let pending: PendingFlow | null = null;

/** Test seam: replaces the pieces that touch the network, disk and browser. */
export interface ReauthorizeDeps {
  awaitCallback: typeof awaitCallback;
  exchangeCodeForTokens: typeof exchangeCodeForTokens;
  writeTokenStore: typeof writeTokenStore;
  openBrowser: (url: string) => void;
  now: () => number;
}

const defaultDeps: ReauthorizeDeps = {
  awaitCallback,
  exchangeCodeForTokens,
  writeTokenStore,
  openBrowser: defaultOpenBrowser,
  now: () => Date.now(),
};

/** Exposed for tests; a fresh process starts with no flow in progress. */
export function resetPendingFlow(): void {
  pending = null;
}

function describePending(flow: PendingFlow): ReauthorizationResult {
  return {
    state: "waiting",
    authorizeUrl: flow.authorizeUrl,
    redirectUri: flow.redirectUri,
    tokenFile: flow.tokenFile,
    scopes: flow.scopes,
  };
}

/**
 * Start a re-authorisation, or report on one already running.
 *
 * Waits up to `waitMs` for the login to complete before returning, so a quick
 * login resolves in a single call. Past that it returns `waiting` and leaves
 * the listener up — the flow keeps running, and the next call collects it.
 */
export async function reauthorize(
  options: {
    waitMs?: number;
    openBrowser?: boolean;
    /** Supplied by the caller after asking the user, when none is on record. */
    clientId?: string;
    /** Explicit scope list. Required to widen access: inheritance alone would
     *  reproduce whatever the existing token file already has. */
    scopes?: string;
  } = {},
  env: AuthEnv = process.env,
  cwd: string = process.cwd(),
  deps: ReauthorizeDeps = defaultDeps,
): Promise<ReauthorizationResult> {
  const waitMs = options.waitMs ?? 60_000;

  const effectiveEnv: AuthEnv = {
    ...env,
    ...(options.clientId ? { XERO_CLIENT_ID: options.clientId } : {}),
    ...(options.scopes ? { XERO_SCOPES: options.scopes } : {}),
  };

  const alreadySettled = pending?.settled;
  if (pending && alreadySettled) {
    const finished = pending;
    const settled = alreadySettled;
    pending = null;
    return settled.state === "authorized"
      ? {
          state: "authorized",
          tokenFile: finished.tokenFile,
          scopes: finished.scopes,
        }
      : { state: "error", error: settled.error };
  }

  if (!pending) {
    let config;
    try {
      config = resolveAuthConfig(effectiveEnv, cwd);
    } catch (error) {
      const err = ensureError(error);
      return {
        state: err instanceof MissingClientIdError ? "needs client id" : "error",
        error: err.message,
      };
    }

    const challenge = createPkceChallenge();
    const authorizeUrl = buildAuthorizeUrl(config, challenge);

    const flow: PendingFlow = {
      authorizeUrl,
      redirectUri: redirectUri(config.port),
      tokenFile: config.tokenFile,
      scopes: config.scopes.split(/\s+/),
      settled: null,
      completion: Promise.resolve(),
    };

    flow.completion = deps
      .awaitCallback(config.port, challenge.state, () => {
        if (options.openBrowser !== false) deps.openBrowser(authorizeUrl);
      })
      .then(async ({ code }) => {
        const tokens = await deps.exchangeCodeForTokens({
          code,
          clientId: config.clientId,
          codeVerifier: challenge.verifier,
          port: config.port,
        });

        if (!tokens.refresh_token) {
          throw new Error(
            "Xero returned no refresh token — check that offline_access was requested.",
          );
        }

        deps.writeTokenStore(config.tokenFile, {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: deps.now() + tokens.expires_in * 1000,
          scope: tokens.scope ?? config.scopes,
          saved_at: new Date(deps.now()).toISOString(),
          client_id: config.clientId,
        });

        flow.settled = { state: "authorized" };
      })
      .catch((error: unknown) => {
        flow.settled = { state: "error", error: ensureError(error).message };
      });

    pending = flow;

    const result: ReauthorizationResult = {
      ...describePending(flow),
      clientIdSource: config.sources.clientId,
      scopesSource: config.sources.scopes,
    };

    return settleOrReport(flow, waitMs, result);
  }

  return settleOrReport(pending, waitMs, describePending(pending));
}

async function settleOrReport(
  flow: PendingFlow,
  waitMs: number,
  whileWaiting: ReauthorizationResult,
): Promise<ReauthorizationResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
    timer.unref();
  });

  await Promise.race([flow.completion, timeout]);
  if (timer) clearTimeout(timer);

  if (!flow.settled) return whileWaiting;

  const settled = flow.settled;
  pending = null;

  return settled.state === "authorized"
    ? { state: "authorized", tokenFile: flow.tokenFile, scopes: flow.scopes }
    : { state: "error", error: settled.error };
}

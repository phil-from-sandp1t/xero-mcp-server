import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReauthorizeDeps,
  reauthorize,
  resetPendingFlow,
} from "../reauthorize.js";

const ENV = { XERO_TOKEN_FILE: "/tmp/tokens.json", XERO_CLIENT_ID: "cid", XERO_SCOPES: "openid offline_access" };

function makeDeps(overrides: Partial<ReauthorizeDeps> = {}): ReauthorizeDeps & {
  written: unknown[];
  opened: string[];
} {
  const written: unknown[] = [];
  const opened: string[] = [];

  return {
    awaitCallback: async (_port, _state, onListening) => {
      onListening();
      return { code: "auth-code" };
    },
    exchangeCodeForTokens: async () => ({
      access_token: "a1",
      refresh_token: "r1",
      expires_in: 1800,
      scope: "openid offline_access",
    }),
    writeTokenStore: (file, store) => {
      written.push({ file, store });
    },
    openBrowser: (url) => {
      opened.push(url);
    },
    now: () => 1_000_000,
    written,
    opened,
    ...overrides,
  } as ReauthorizeDeps & { written: unknown[]; opened: string[] };
}

beforeEach(() => resetPendingFlow());

describe("reauthorize", () => {
  it("completes in one call when the login is quick, and persists the tokens", async () => {
    const deps = makeDeps();
    const result = await reauthorize({ waitMs: 1000 }, ENV, "/cwd", deps);

    expect(result.state).toBe("authorized");
    expect(deps.written).toHaveLength(1);
    const { store } = deps.written[0] as { store: Record<string, unknown> };
    expect(store.refresh_token).toBe("r1");
    expect(store.client_id).toBe("cid");
    expect(store.expires_at).toBe(1_000_000 + 1_800_000);
  });

  it("opens the browser with the authorize URL unless told not to", async () => {
    const deps = makeDeps();
    await reauthorize({ waitMs: 1000 }, ENV, "/cwd", deps);
    expect(deps.opened[0]).toContain("login.xero.com");

    resetPendingFlow();
    const quiet = makeDeps();
    await reauthorize({ waitMs: 1000, openBrowser: false }, ENV, "/cwd", quiet);
    expect(quiet.opened).toHaveLength(0);
  });

  it("returns the URL instead of blocking when the login is slow", async () => {
    const deps = makeDeps({
      awaitCallback: (_port, _state, onListening) => {
        onListening();
        return new Promise(() => {
          /* never resolves: user has not signed in yet */
        });
      },
    });

    const result = await reauthorize({ waitMs: 5 }, ENV, "/cwd", deps);

    expect(result.state).toBe("waiting");
    expect(result.authorizeUrl).toContain("code_challenge_method=S256");
    expect(result.redirectUri).toBe("http://localhost:3333/callback");
  });

  it("does not start a second flow while one is in progress", async () => {
    const awaitCallback = vi.fn((_port: number, _state: string, onListening: () => void) => {
      onListening();
      return new Promise<{ code: string }>(() => {});
    });
    const deps = makeDeps({ awaitCallback: awaitCallback as unknown as ReauthorizeDeps["awaitCallback"] });

    const first = await reauthorize({ waitMs: 5 }, ENV, "/cwd", deps);
    const second = await reauthorize({ waitMs: 5 }, ENV, "/cwd", deps);

    expect(awaitCallback).toHaveBeenCalledTimes(1);
    expect(second.authorizeUrl).toBe(first.authorizeUrl);
  });

  it("collects the result on a later call once the user has signed in", async () => {
    let release: (value: { code: string }) => void = () => {};
    const deps = makeDeps({
      awaitCallback: (_port, _state, onListening) => {
        onListening();
        return new Promise<{ code: string }>((resolve) => {
          release = resolve;
        });
      },
    });

    expect((await reauthorize({ waitMs: 5 }, ENV, "/cwd", deps)).state).toBe("waiting");

    release({ code: "auth-code" });
    await new Promise((r) => setTimeout(r, 10));

    expect((await reauthorize({ waitMs: 5 }, ENV, "/cwd", deps)).state).toBe("authorized");
    // The completed flow is cleared, so a later call starts a fresh one.
    expect(deps.written).toHaveLength(1);
  });

  it("reports a failed exchange as an error rather than a silent success", async () => {
    const deps = makeDeps({
      exchangeCodeForTokens: async () => {
        throw new Error("invalid_grant");
      },
    });

    const result = await reauthorize({ waitMs: 1000 }, ENV, "/cwd", deps);

    expect(result.state).toBe("error");
    expect(result.error).toContain("invalid_grant");
    expect(deps.written).toHaveLength(0);
  });

  it("refuses when Xero returns no refresh token", async () => {
    const deps = makeDeps({
      exchangeCodeForTokens: async () => ({ access_token: "a1", expires_in: 1800 }),
    });

    const result = await reauthorize({ waitMs: 1000 }, ENV, "/cwd", deps);

    expect(result.state).toBe("error");
    expect(result.error).toContain("offline_access");
    expect(deps.written).toHaveLength(0);
  });

  it("asks for a client id rather than failing, when none is on record", async () => {
    const awaitCallback = vi.fn();
    const deps = makeDeps({ awaitCallback: awaitCallback as unknown as ReauthorizeDeps["awaitCallback"] });

    const result = await reauthorize({ waitMs: 5 }, { XERO_TOKEN_FILE: "/tmp/absent.json" }, "/cwd", deps);

    expect(result.state).toBe("needs client id");
    expect(result.error).toMatch(/developer portal/);
    expect(awaitCallback).not.toHaveBeenCalled();
  });

  it("accepts a client id supplied by the caller after asking the user", async () => {
    const deps = makeDeps();

    const result = await reauthorize(
      { waitMs: 1000, clientId: "asked-the-user", scopes: "openid offline_access" },
      { XERO_TOKEN_FILE: "/tmp/absent.json" },
      "/cwd",
      deps,
    );

    expect(result.state).toBe("authorized");
    const { store } = deps.written[0] as { store: Record<string, unknown> };
    expect(store.client_id).toBe("asked-the-user");
  });

  it("uses an explicit scope list, which is the only way to widen access", async () => {
    const deps = makeDeps();
    const widened = "openid offline_access accounting.settings accounting.reports.taxreports.read";

    const result = await reauthorize(
      { waitMs: 5, scopes: widened, openBrowser: false },
      { ...ENV, XERO_SCOPES: undefined },
      "/cwd",
      makeDeps({
        awaitCallback: (_p, _s, onListening) => {
          onListening();
          return new Promise(() => {});
        },
      }),
    );

    expect(result.state).toBe("waiting");
    expect(new URL(result.authorizeUrl!).searchParams.get("scope")).toBe(widened);
    expect(deps.written).toHaveLength(0);
  });

  it("surfaces a configuration problem without starting a listener", async () => {
    const awaitCallback = vi.fn();
    const deps = makeDeps({ awaitCallback: awaitCallback as unknown as ReauthorizeDeps["awaitCallback"] });

    // Scopes without offline_access would yield a token that cannot be renewed.
    const result = await reauthorize(
      { waitMs: 5, scopes: "openid accounting.settings" },
      ENV,
      "/cwd",
      deps,
    );

    expect(result.state).toBe("error");
    expect(result.error).toMatch(/offline_access/);
    expect(awaitCallback).not.toHaveBeenCalled();
  });
});

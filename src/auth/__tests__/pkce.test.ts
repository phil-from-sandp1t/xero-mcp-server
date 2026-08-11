import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { XeroTokenStore } from "../../clients/xero-token-store.js";
import {
  FALLBACK_SCOPES,
  buildAuthorizeUrl,
  createPkceChallenge,
  redirectUri,
  resolveAuthConfig,
} from "../pkce.js";

const storeWith = (store: Partial<XeroTokenStore>) => () =>
  ({ refresh_token: "r1", ...store }) as XeroTokenStore;

const noStore = () => {
  throw new Error("no token file");
};

describe("resolveAuthConfig", () => {
  it("inherits client id and scopes from the token file", () => {
    const config = resolveAuthConfig(
      { XERO_TOKEN_FILE: "/tmp/t.json" },
      "/cwd",
      storeWith({ client_id: "from-file", scope: "openid offline_access accounting.invoices" }),
    );

    expect(config.clientId).toBe("from-file");
    expect(config.scopes).toBe("openid offline_access accounting.invoices");
    expect(config.sources).toEqual({ clientId: "token file", scopes: "token file" });
  });

  it("lets the environment override the token file", () => {
    const config = resolveAuthConfig(
      {
        XERO_TOKEN_FILE: "/tmp/t.json",
        XERO_CLIENT_ID: "from-env",
        XERO_SCOPES: "openid offline_access",
      },
      "/cwd",
      storeWith({ client_id: "from-file", scope: "openid offline_access accounting.invoices" }),
    );

    expect(config.clientId).toBe("from-env");
    expect(config.scopes).toBe("openid offline_access");
    expect(config.sources).toEqual({ clientId: "environment", scopes: "environment" });
  });

  it("falls back to built-in scopes only when bootstrapping fresh", () => {
    const config = resolveAuthConfig({ XERO_CLIENT_ID: "cid" }, "/cwd", noStore);

    expect(config.scopes).toBe(FALLBACK_SCOPES);
    expect(config.sources.scopes).toBe("built-in fallback");
  });

  it("refuses to guess a client id when the token file has none", () => {
    expect(() => resolveAuthConfig({}, "/cwd", noStore)).toThrow(/XERO_CLIENT_ID is not set/);
  });

  it("rejects scopes without offline_access, which would yield no refresh token", () => {
    expect(() =>
      resolveAuthConfig({ XERO_CLIENT_ID: "cid", XERO_SCOPES: "openid accounting.settings" }, "/cwd", noStore),
    ).toThrow(/offline_access/);
  });

  it("defaults the token file to the working directory and resolves it absolutely", () => {
    const config = resolveAuthConfig({ XERO_CLIENT_ID: "cid" }, "/cwd", noStore);

    expect(config.tokenFile).toBe("/cwd/.xero-tokens.json");
  });
});

describe("createPkceChallenge", () => {
  it("derives the challenge as the S256 hash of the verifier", () => {
    const { verifier, challenge } = createPkceChallenge();
    const expected = crypto.createHash("sha256").update(verifier).digest("base64url");

    expect(challenge).toBe(expected);
    expect(challenge).not.toBe(verifier);
  });

  it("does not repeat verifier or state across calls", () => {
    const a = createPkceChallenge();
    const b = createPkceChallenge();

    expect(a.verifier).not.toBe(b.verifier);
    expect(a.state).not.toBe(b.state);
  });
});

describe("buildAuthorizeUrl", () => {
  it("carries the PKCE parameters and matches the redirect it will listen on", () => {
    const challenge = createPkceChallenge();
    const url = new URL(
      buildAuthorizeUrl({ clientId: "cid", scopes: "openid offline_access", port: 3333 }, challenge),
    );

    expect(url.origin + url.pathname).toBe("https://login.xero.com/identity/connect/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("cid");
    expect(url.searchParams.get("code_challenge")).toBe(challenge.challenge);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(challenge.state);
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri(3333));
    // The verifier must never travel in the authorize request.
    expect(url.toString()).not.toContain(challenge.verifier);
  });
});

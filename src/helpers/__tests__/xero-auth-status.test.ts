import { describe, expect, it } from "vitest";

import { currentAuthMode, formatAuthStatus } from "../xero-auth-status.js";

describe("currentAuthMode", () => {
  it("prefers the token file, matching the client's own precedence", () => {
    expect(
      currentAuthMode({ XERO_TOKEN_FILE: "/t.json", XERO_CLIENT_BEARER_TOKEN: "b" }),
    ).toBe("refresh token");
  });

  it("reports bearer token when there is no token file", () => {
    expect(currentAuthMode({ XERO_CLIENT_BEARER_TOKEN: "b" })).toBe("bearer token");
  });

  it("falls back to custom connections", () => {
    expect(currentAuthMode({})).toBe("custom connections");
  });
});

describe("formatAuthStatus", () => {
  it("reports a working connection without prompting any action", () => {
    const text = formatAuthStatus({
      ok: true,
      mode: "refresh token",
      tokenFile: "/t.json",
      expiresInMinutes: 24,
      scopes: ["openid", "offline_access"],
      tenantId: "tenant-1",
      organisationName: "ACME Pte Ltd",
    });

    expect(text).toContain("Status: working");
    expect(text).toContain("ACME Pte Ltd");
    expect(text).toContain("expires in: 24 minutes");
    expect(text).toContain("no action needed");
    expect(text).not.toContain("xero-auth");
  });

  it("explains that scopes are fixed, so a scope failure is not read as expiry", () => {
    const text = formatAuthStatus({
      ok: true,
      mode: "refresh token",
      scopes: ["openid", "offline_access"],
      missingScopes: [],
    });

    expect(text).toContain("fixed when this connection was authorised");
    expect(text).toContain("403");
    expect(text).not.toContain("Not granted");
  });

  it("names ungranted scopes and how to add them", () => {
    const text = formatAuthStatus({
      ok: true,
      mode: "refresh token",
      scopes: ["openid", "offline_access"],
      missingScopes: ["accounting.reports.taxreports.read"],
    });

    expect(text).toContain("Not granted (1): accounting.reports.taxreports.read");
    expect(text).toContain("reauthorize-xero");
    expect(text).toContain("replaces rather than extends");
  });

  it("names the fix when refresh-token auth is broken", () => {
    const text = formatAuthStatus({
      ok: false,
      mode: "refresh token",
      tokenFile: "/t.json",
      error: "refresh token was rejected",
    });

    expect(text).toContain("Status: NOT working");
    expect(text).toContain("refresh token was rejected");
    expect(text).toContain("npx -p @xeroapi/xero-mcp-server xero-auth");
  });

  it("points bearer-token setups at their own remedy, not at re-auth", () => {
    const text = formatAuthStatus({ ok: false, mode: "bearer token", error: "401" });

    expect(text).toContain("XERO_TOKEN_FILE");
    expect(text).not.toContain("npx xero-auth");
  });
});

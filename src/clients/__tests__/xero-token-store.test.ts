import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyTokenResponse,
  isExpiring,
  isInvalidGrant,
  readTokenStore,
  refreshTokenSet,
  resolveClientId,
  writeTokenStore,
  XeroTokenRefreshError,
} from "../xero-token-store.js";

function tempFile(): string {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "xero-token-store-")),
    ".xero-tokens.json",
  );
}

describe("readTokenStore", () => {
  it("reads a well-formed store", () => {
    const file = tempFile();
    fs.writeFileSync(file, JSON.stringify({ refresh_token: "r1", access_token: "a1" }));

    expect(readTokenStore(file).refresh_token).toBe("r1");
  });

  it("names the missing file and the way out", () => {
    const file = path.join(os.tmpdir(), "definitely-absent-tokens.json");

    expect(() => readTokenStore(file)).toThrow(/not found/);
    expect(() => readTokenStore(file)).toThrow(/npx xero-auth/);
  });

  it("rejects a store with no refresh token", () => {
    const file = tempFile();
    fs.writeFileSync(file, JSON.stringify({ access_token: "a1" }));

    expect(() => readTokenStore(file)).toThrow(/no refresh_token/);
  });

  it("rejects invalid JSON", () => {
    const file = tempFile();
    fs.writeFileSync(file, "{not json");

    expect(() => readTokenStore(file)).toThrow(/not valid JSON/);
  });
});

describe("writeTokenStore", () => {
  it("round-trips through readTokenStore and leaves no temp file", () => {
    const file = tempFile();
    writeTokenStore(file, { refresh_token: "r1", access_token: "a1", expires_at: 123 });

    expect(readTokenStore(file)).toMatchObject({ refresh_token: "r1", expires_at: 123 });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it("does not inherit permissions from a temp file left by an earlier crash", () => {
    const file = tempFile();
    // A stale temp file, world-readable, as a crashed run might leave behind.
    fs.writeFileSync(`${file}.tmp`, "leftover");
    fs.chmodSync(`${file}.tmp`, 0o666);

    writeTokenStore(file, { refresh_token: "r1" });

    // The rename hands the temp file's permissions to the live token file, so
    // reusing a loose one would quietly expose the refresh token.
    expect(fs.statSync(file).mode & 0o077).toBe(0);
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
  });

  it("keeps the token file private to its owner", () => {
    const file = tempFile();
    writeTokenStore(file, { refresh_token: "r1" });

    expect(fs.statSync(file).mode & 0o077).toBe(0);
  });
});

describe("isExpiring", () => {
  const now = 1_000_000;
  const margin = 10 * 60 * 1000;

  it("is false while the access token has room left", () => {
    expect(isExpiring({ refresh_token: "r", access_token: "a", expires_at: now + margin + 1 }, margin, now)).toBe(false);
  });

  it("is true once inside the margin", () => {
    expect(isExpiring({ refresh_token: "r", access_token: "a", expires_at: now + margin }, margin, now)).toBe(true);
  });

  it("is true when there is no access token or no expiry", () => {
    expect(isExpiring({ refresh_token: "r", expires_at: now + margin + 1 }, margin, now)).toBe(true);
    expect(isExpiring({ refresh_token: "r", access_token: "a" }, margin, now)).toBe(true);
  });
});

describe("applyTokenResponse", () => {
  const now = 1_000_000;
  const previous = { refresh_token: "r1", access_token: "a1", scope: "s1" };

  it("takes the rotated refresh token and derives absolute expiry", () => {
    const next = applyTokenResponse(previous, { access_token: "a2", refresh_token: "r2", expires_in: 1800 }, now);

    expect(next.refresh_token).toBe("r2");
    expect(next.access_token).toBe("a2");
    expect(next.expires_at).toBe(now + 1_800_000);
  });

  it("keeps the previous refresh token and scope when the response omits them", () => {
    const next = applyTokenResponse(previous, { access_token: "a2", expires_in: 1800 }, now);

    expect(next.refresh_token).toBe("r1");
    expect(next.scope).toBe("s1");
  });
});

describe("resolveClientId", () => {
  it("prefers the environment", () => {
    const read = () => ({ refresh_token: "r", client_id: "from-file" });

    expect(resolveClientId("from-env", "/t.json", read)).toBe("from-env");
  });

  it("falls back to the id recorded in the token file", () => {
    const read = () => ({ refresh_token: "r", client_id: "from-file" });

    expect(resolveClientId(undefined, "/t.json", read)).toBe("from-file");
  });

  it("explains the fix when neither is available", () => {
    const read = () => ({ refresh_token: "r" });

    expect(() => resolveClientId(undefined, "/t.json", read)).toThrow(/npx xero-auth/);
  });
});

describe("refreshTokenSet", () => {
  it("sends client_id in the body for a public (PKCE) client", async () => {
    let seen: { body: string; headers: Record<string, string> } | undefined;
    await refreshTokenSet({ clientId: "cid", refreshToken: "r1" }, async (body, headers) => {
      seen = { body, headers };
      return { access_token: "a2", expires_in: 1800 };
    });

    const params = new URLSearchParams(seen!.body);
    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("r1");
    expect(params.get("client_id")).toBe("cid");
    expect(seen!.headers.Authorization).toBeUndefined();
  });

  it("uses basic auth and omits client_id for a confidential client", async () => {
    let seen: { body: string; headers: Record<string, string> } | undefined;
    await refreshTokenSet({ clientId: "cid", clientSecret: "secret", refreshToken: "r1" }, async (body, headers) => {
      seen = { body, headers };
      return { access_token: "a2", expires_in: 1800 };
    });

    expect(new URLSearchParams(seen!.body).get("client_id")).toBeNull();
    expect(seen!.headers.Authorization).toBe(`Basic ${Buffer.from("cid:secret").toString("base64")}`);
  });

  it("flags invalid_grant so callers can tell a dead token from a blip", async () => {
    const rejected = refreshTokenSet({ clientId: "cid", refreshToken: "r1" }, async () => {
      throw { response: { data: { error: "invalid_grant" } } };
    });

    await expect(rejected).rejects.toBeInstanceOf(XeroTokenRefreshError);
    await expect(rejected).rejects.toSatisfy(isInvalidGrant);
  });

  it("does not flag a transient failure as invalid_grant", async () => {
    const rejected = refreshTokenSet({ clientId: "cid", refreshToken: "r1" }, async () => {
      throw { response: { data: { error: "temporarily_unavailable" } } };
    });

    await expect(rejected).rejects.toSatisfy((e: unknown) => !isInvalidGrant(e));
  });
});

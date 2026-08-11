import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The server must start even when the refresh-token setup is broken.
 *
 * check-xero-auth and reauthorize-xero exist to diagnose and repair exactly
 * that state, so anything that aborts at module load takes the recovery tools
 * down with it and leaves no way back.
 */
describe("client construction with a broken token file", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("loads when the token file is missing and no client id is set", async () => {
    vi.stubEnv("XERO_TOKEN_FILE", "/nonexistent/definitely-not-here.json");
    vi.stubEnv("XERO_CLIENT_ID", "");
    vi.stubEnv("XERO_CLIENT_SECRET", "");
    vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "");
    vi.resetModules();

    const module = await import("../xero-client.js");

    expect(module.xeroClient).toBeDefined();
  });

  it("loads when the token file records no client id", async () => {
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");

    // A token file from before client_id was recorded.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "xero-legacy-"));
    const file = path.join(dir, ".xero-tokens.json");
    fs.writeFileSync(file, JSON.stringify({ refresh_token: "r1", access_token: "a1" }));

    vi.stubEnv("XERO_TOKEN_FILE", file);
    vi.stubEnv("XERO_CLIENT_ID", "");
    vi.stubEnv("XERO_CLIENT_SECRET", "");
    vi.stubEnv("XERO_CLIENT_BEARER_TOKEN", "");
    vi.resetModules();

    const module = await import("../xero-client.js");

    expect(module.xeroClient).toBeDefined();
  });
});

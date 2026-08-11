import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The short code is used to build Xero deep links. It belongs to one
 * organisation, so it must not survive anything that can change which
 * organisation is active — otherwise every value in a response is right except
 * the link, which points at another company's records.
 */
describe("organisation-scoped cache", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let client: any;

  beforeEach(async () => {
    vi.stubEnv("XERO_TOKEN_FILE", "/nonexistent/tokens.json");
    vi.stubEnv("XERO_CLIENT_ID", "cid");
    vi.resetModules();
    const module = await import("../xero-client.js");
    client = module.xeroClient;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("drops the cached short code when tenants are invalidated", () => {
    client.shortCode = "OLDORG";

    client.invalidateTenants();

    expect(client.shortCode).toBe("");
  });

  it("drops the cached short code when an organisation is selected", async () => {
    // Pre-load the reachable organisations so selectTenant resolves offline.
    client.setKnownTenants([
      { tenantId: "id-a", tenantName: "A Ltd" },
      { tenantId: "id-b", tenantName: "B Ltd" },
    ]);
    client.listTenants = async () => [
      { tenantId: "id-a", tenantName: "A Ltd" },
      { tenantId: "id-b", tenantName: "B Ltd" },
    ];
    client.shortCode = "OLDORG";

    await client.selectTenant("B Ltd");

    expect(client.shortCode).toBe("");
    expect(client.activeTenant).toMatchObject({ tenantId: "id-b" });
  });

  it("drops the cached short code when authentication resolves a different organisation", () => {
    client.setKnownTenants([{ tenantId: "id-a", tenantName: "A Ltd" }]);
    client.shortCode = "ORG-A";

    // What another process re-authorising to a different grant looks like from
    // here: the same code path, a different organisation.
    client.setKnownTenants([{ tenantId: "id-b", tenantName: "B Ltd" }]);

    expect(client.activeTenant).toMatchObject({ tenantId: "id-b" });
    expect(client.shortCode).toBe("");
  });

  it("keeps the cached short code when the organisation is unchanged", () => {
    client.setKnownTenants([{ tenantId: "id-a", tenantName: "A Ltd" }]);
    client.shortCode = "ORG-A";

    // Re-authenticating against the same organisation must not throw away a
    // perfectly valid cache on every call.
    client.setKnownTenants([{ tenantId: "id-a", tenantName: "A Ltd" }]);

    expect(client.shortCode).toBe("ORG-A");
  });

  it("clears the settled organisation too, so the next call re-resolves", () => {
    client.setKnownTenants([{ tenantId: "id-a", tenantName: "A Ltd" }]);
    expect(client.activeTenant).toMatchObject({ tenantId: "id-a" });

    client.invalidateTenants();

    expect(client.activeTenant).toBeUndefined();
    expect(client.tenantResolution).toBeUndefined();
  });
});

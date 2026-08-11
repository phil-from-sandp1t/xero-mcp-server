import { describe, expect, it } from "vitest";

import {
  UnknownTenantError,
  describeTenants,
  explainUnresolved,
  resolveTenant,
} from "../tenant-selection.js";

const ACTIV8 = { tenantId: "id-activ8", tenantName: "ACTIV-8 Management Pte Ltd" };
const DTCD = { tenantId: "id-dtcd", tenantName: "DTCD Company Pte Ltd" };

describe("resolveTenant", () => {
  it("uses the only organisation when there is no ambiguity", () => {
    const result = resolveTenant([ACTIV8]);

    expect(result).toEqual({ kind: "resolved", tenant: ACTIV8, source: "only organisation" });
  });

  it("refuses to pick between several organisations", () => {
    const result = resolveTenant([ACTIV8, DTCD]);

    // The whole point: no silent default to the first connection.
    expect(result.kind).toBe("ambiguous");
  });

  it("matches a preference by tenant id", () => {
    const result = resolveTenant([ACTIV8, DTCD], "id-dtcd");

    expect(result).toMatchObject({ kind: "resolved", tenant: DTCD });
  });

  it("matches a preference by organisation name, ignoring case and padding", () => {
    const result = resolveTenant([ACTIV8, DTCD], "  dtcd company pte ltd  ");

    expect(result).toMatchObject({ kind: "resolved", tenant: DTCD });
  });

  it("records where the choice came from", () => {
    expect(resolveTenant([ACTIV8, DTCD], "id-dtcd", "selection")).toMatchObject({
      source: "selection",
    });
    expect(resolveTenant([ACTIV8, DTCD], "id-dtcd", "environment")).toMatchObject({
      source: "environment",
    });
  });

  it("rejects a preference the token cannot reach, rather than falling back", () => {
    expect(() => resolveTenant([ACTIV8, DTCD], "Some Other Co")).toThrow(UnknownTenantError);
    // A fallback here would be the dangerous case: naming one org, getting another.
    expect(() => resolveTenant([ACTIV8], "Some Other Co")).toThrow(/No Xero organisation matches/);
  });

  it("names the reachable organisations when rejecting", () => {
    expect(() => resolveTenant([ACTIV8, DTCD], "nope")).toThrow(/ACTIV-8 Management Pte Ltd/);
    expect(() => resolveTenant([ACTIV8, DTCD], "nope")).toThrow(/id-dtcd/);
  });

  it("reports an authorisation that reaches nothing", () => {
    expect(resolveTenant([])).toEqual({ kind: "none" });
    // Even with a preference: there is nothing to match against.
    expect(resolveTenant([], "anything")).toEqual({ kind: "none" });
  });

  it("treats a blank preference as no preference", () => {
    expect(resolveTenant([ACTIV8, DTCD], "   ").kind).toBe("ambiguous");
    expect(resolveTenant([ACTIV8], "").kind).toBe("resolved");
  });
});

describe("explainUnresolved", () => {
  it("explains ambiguity with the options and both ways to fix it", () => {
    const text = explainUnresolved(resolveTenant([ACTIV8, DTCD]));

    expect(text).toContain("2 organisations");
    expect(text).toContain("ACTIV-8 Management Pte Ltd");
    expect(text).toContain("select-xero-tenant");
    expect(text).toContain("XERO_TENANT_ID");
    expect(text).toContain("Refusing to guess");
  });

  it("explains an authorisation with no organisations", () => {
    expect(explainUnresolved({ kind: "none" })).toMatch(/reaches no organisations/);
  });

  it("handles being asked before authentication has happened", () => {
    expect(explainUnresolved(undefined)).toMatch(/authenticate/);
  });
});

describe("describeTenants", () => {
  it("pairs each name with its id, so an ambiguous name is still actionable", () => {
    expect(describeTenants([ACTIV8, DTCD])).toBe(
      "ACTIV-8 Management Pte Ltd [id-activ8], DTCD Company Pte Ltd [id-dtcd]",
    );
  });

  it("copes with an unnamed organisation", () => {
    expect(describeTenants([{ tenantId: "bare" }])).toBe("(unnamed) [bare]");
  });
});

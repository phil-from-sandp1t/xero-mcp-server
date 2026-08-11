import { describe, expect, it } from "vitest";

import { reauthorizationUnsupportedReason } from "../reauthorize-xero.tool.js";

describe("reauthorizationUnsupportedReason", () => {
  it("permits re-authorisation in refresh-token mode", () => {
    expect(reauthorizationUnsupportedReason({ XERO_TOKEN_FILE: "/t.json" })).toBeUndefined();
  });

  it("refuses in bearer-token mode rather than reporting a repair that did nothing", () => {
    const reason = reauthorizationUnsupportedReason({ XERO_CLIENT_BEARER_TOKEN: "b" });

    expect(reason).toContain("bearer token");
    expect(reason).toContain("does not read a token file");
    expect(reason).toContain("XERO_TOKEN_FILE");
  });

  it("refuses in custom-connections mode", () => {
    const reason = reauthorizationUnsupportedReason({});

    expect(reason).toContain("custom connections");
    expect(reason).toContain("restart");
  });
});

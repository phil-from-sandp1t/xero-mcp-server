import { describe, expect, it } from "vitest";

import { isStatusOnlyChange } from "../../helpers/quote-status.js";

/**
 * An INVOICED quote is locked for content but can be moved back to ACCEPTED.
 * Telling those two apart is what decides whether the request is allowed
 * through, so it is worth pinning down on its own.
 */
describe("isStatusOnlyChange", () => {
  it("is true when status is the only field given", () => {
    expect(
      isStatusOnlyChange({
        status: "ACCEPTED",
        lineItems: undefined,
        title: undefined,
        contactId: undefined,
      }),
    ).toBe(true);
  });

  it("is false when content travels with the status change", () => {
    expect(isStatusOnlyChange({ status: "ACCEPTED", title: "New title" })).toBe(false);
    expect(isStatusOnlyChange({ status: "ACCEPTED", lineItems: [] })).toBe(false);
  });

  it("treats a request with nothing in it as status-only", () => {
    // Harmless: with no status either, the caller is asking for nothing and the
    // handler's normal path applies.
    expect(isStatusOnlyChange({ lineItems: undefined, title: undefined })).toBe(true);
  });

  it("does not mistake an explicit falsy value for absence", () => {
    expect(isStatusOnlyChange({ status: "ACCEPTED", reference: "" })).toBe(false);
  });
});

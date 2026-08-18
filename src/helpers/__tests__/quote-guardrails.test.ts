import { LineItem, Quote, QuoteStatusCodes } from "xero-node";
import { describe, expect, it } from "vitest";

import { isStatusOnlyChange } from "../quote-status.js";
import { describeQuoteUpdate, droppedTracking } from "../quote-update-report.js";

describe("isStatusOnlyChange with the quote's own number", () => {
  it("accepts a quote number that matches, since it changes nothing", () => {
    // Callers are told to always send the number to avoid a silent renumber;
    // that habit must not trip the content guard.
    expect(
      isStatusOnlyChange({ status: "ACCEPTED", quoteNumber: "Q240001" }, "Q240001"),
    ).toBe(true);
  });

  it("treats a different number as the content change it is", () => {
    expect(
      isStatusOnlyChange({ status: "ACCEPTED", quoteNumber: "Q999999" }, "Q240001"),
    ).toBe(false);
  });

  it("still counts other fields as content", () => {
    expect(
      isStatusOnlyChange({ status: "ACCEPTED", quoteNumber: "Q240001", title: "x" }, "Q240001"),
    ).toBe(false);
  });
});

const line = (id: string, tracking: LineItem["tracking"]): LineItem => ({
  lineItemID: id,
  description: "Work",
  quantity: 1,
  unitAmount: 100,
  lineAmount: 100,
  tracking,
});

describe("droppedTracking", () => {
  it("names a category the update silently removed", () => {
    const before = [line("a", [{ name: "Budget", option: "SEJ - DOTO" }, { name: "Budget Owner", option: "Aiko" }])];
    const after = [line("a", [{ name: "Budget", option: "SEJ - KFCPH" }])];

    const warning = droppedTracking(before, after);

    expect(warning).toContain("Budget Owner: Aiko");
    expect(warning).toContain("replaces rather than merges");
  });

  it("says nothing when every category survived", () => {
    const before = [line("a", [{ name: "Budget", option: "SEJ - DOTO" }])];
    const after = [line("a", [{ name: "Budget", option: "SEJ - KFCPH" }])];

    expect(droppedTracking(before, after)).toBeNull();
  });

  it("ignores lines that were not part of the update", () => {
    const before = [line("a", [{ name: "Budget", option: "X" }])];
    const after = [line("b", [])];

    expect(droppedTracking(before, after)).toBeNull();
  });
});

describe("describeQuoteUpdate", () => {
  const quote = {
    quoteID: "q1",
    quoteNumber: "Q260017",
    status: QuoteStatusCodes.ACCEPTED,
    total: 25751.25,
    lineItems: [line("a", [{ name: "Budget", option: "SEJ - KFCPH" }])],
  } as unknown as Quote;

  it("shows the resulting lines, so no second call is needed to check", () => {
    const text = describeQuoteUpdate(quote);

    expect(text).toContain("Line Items (1):");
    expect(text).toContain("Tracking: Budget: SEJ - KFCPH");
    expect(text).toContain("Quote Number: Q260017");
  });

  it("warns that un-invoicing left a billed quote reopened", () => {
    const text = describeQuoteUpdate(quote, QuoteStatusCodes.INVOICED);

    expect(text).toContain("Status: INVOICED -> ACCEPTED");
    expect(text).toContain("no longer invoiced");
    expect(text).toContain("set status");
    // The part a caller cannot discover for itself.
    expect(text).toContain("cannot");
    expect(text).toContain("quote-to-invoice link");
  });

  it("does not warn when the quote was not invoiced before", () => {
    const text = describeQuoteUpdate(quote, QuoteStatusCodes.DRAFT);

    expect(text).not.toContain("no longer invoiced");
  });
});

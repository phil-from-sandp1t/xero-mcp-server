import { Quote } from "xero-node";
import { describe, expect, it } from "vitest";

import { formatLineItem, formatLineItems } from "../format-line-item.js";
import { formatQuote } from "../format-quote.js";

// Shaped after a real Xero quote line: no accountCode, no item — the fields an
// invoice line carries but a quote line does not.
const quoteLine = {
  lineItemID: "line-1",
  description: "Pool maintenance, monthly",
  quantity: 1,
  unitAmount: 250,
  lineAmount: 250,
  itemCode: "POOL",
  taxType: "OUTPUT",
  taxAmount: 22.5,
};

const quote = {
  quoteID: "q-1",
  quoteNumber: "A8-Q-260001",
  status: "ACCEPTED",
  total: 250,
  lineItems: [quoteLine],
} as unknown as Quote;

describe("formatQuote", () => {
  it("includes line items when asked", () => {
    const text = formatQuote(quote, true);

    expect(text).toContain("Line Items (1):");
    expect(text).toContain("Pool maintenance, monthly");
    expect(text).toContain("Unit Amount: 250");
  });

  it("omits them otherwise, keeping a listing readable", () => {
    const text = formatQuote(quote, false);

    expect(text).toContain("Quote Number: A8-Q-260001");
    expect(text).not.toContain("Line Items");
    expect(text).not.toContain("Pool maintenance");
  });

  it("says so when line items were asked for but the quote has none", () => {
    const bare = { ...quote, lineItems: [] } as unknown as Quote;

    expect(formatQuote(bare, true)).toContain("Line Items: none");
  });

  it("keeps a zero total visible rather than dropping it", () => {
    const zero = { ...quote, total: 0 } as unknown as Quote;

    expect(formatQuote(zero, false)).toContain("Total: 0");
  });
});

describe("formatLineItem", () => {
  it("omits fields a quote line does not carry, instead of printing undefined", () => {
    const text = formatLineItem(quoteLine);

    expect(text).not.toContain("undefined");
    expect(text).not.toContain("Account Code");
    expect(text).toContain("Description: Pool maintenance, monthly");
    expect(text).toContain("Tax Amount: 22.5");
  });

  it("keeps zero quantities and amounts", () => {
    const text = formatLineItem({ ...quoteLine, quantity: 0, lineAmount: 0 });

    expect(text).toContain("Quantity: 0");
    expect(text).toContain("Line Amount: 0");
  });

  it("renders an item reference and tracking readably, not as [object Object]", () => {
    const text = formatLineItem({
      ...quoteLine,
      item: { itemID: "item-9" },
      tracking: [{ name: "Region", option: "North" }],
    });

    expect(text).toContain("Item ID: item-9");
    expect(text).toContain("Tracking: Region: North");
    expect(text).not.toContain("[object Object]");
  });
});

describe("line item ids", () => {
  it("prints the line item id, which the update tools patch by", () => {
    expect(formatLineItem(quoteLine)).toContain("Line Item ID: line-1");
  });

  it("omits it when a line has none", () => {
    const { lineItemID, ...withoutId } = quoteLine;
    void lineItemID;

    expect(formatLineItem(withoutId)).not.toContain("Line Item ID");
  });
});

describe("formatLineItems", () => {
  it("separates lines so one does not run into the next", () => {
    const text = formatLineItems([quoteLine, { ...quoteLine, description: "Second line" }]);

    expect(text).toContain("Line Items (2):");
    expect(text).toContain("\n\n");
    // The bug this replaces: array interpolation joined with commas.
    expect(text).not.toMatch(/Line Amount: \d+,Description/);
  });

  it("reports absence rather than rendering nothing", () => {
    expect(formatLineItems([])).toBe("Line Items: none");
    expect(formatLineItems(undefined)).toBe("Line Items: none");
  });

  it("emits nothing for an item or tracking entry that carries no information", () => {
    const text = formatLineItems([
      { ...quoteLine, item: {}, tracking: [{}] },
    ]);

    expect(text).not.toContain("undefined");
    // Anchored: "Line Item ID" legitimately contains this substring.
    expect(text).not.toMatch(/^Item ID:/m);
    expect(text).not.toContain("Tracking");
    expect(text).not.toContain("?: ?");
  });

  it("renders multiple tracking categories the way Xero presents them", () => {
    const text = formatLineItems([
      {
        ...quoteLine,
        tracking: [
          { name: "Budget", option: "H3VEA-OMNI" },
          { name: "Budget Owner", option: "Phil" },
        ],
      },
    ]);

    expect(text).toContain("Tracking: Budget: H3VEA-OMNI, Budget Owner: Phil");
  });
});

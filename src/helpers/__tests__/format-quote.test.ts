import { Quote } from "xero-node";
import { describe, expect, it } from "vitest";

import { formatLineItem } from "../format-line-item.js";
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

    expect(formatQuote(bare, true)).toContain("Line Items: none on this quote");
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
    expect(text).toContain("Tracking: Region=North");
    expect(text).not.toContain("[object Object]");
  });
});

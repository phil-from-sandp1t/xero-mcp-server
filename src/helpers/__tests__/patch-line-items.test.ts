import { LineItem, TrackingCategory } from "xero-node";
import { describe, expect, it } from "vitest";

import { patchLineItems } from "../patch-line-items.js";
import { resolveTracking } from "../resolve-tracking.js";

const existing: LineItem[] = [
  { lineItemID: "a", description: "First", quantity: 1, unitAmount: 100, lineAmount: 100, accountCode: "200" },
  { lineItemID: "b", description: "Second", quantity: 2, unitAmount: 50, lineAmount: 100, accountCode: "200" },
];

describe("patchLineItems", () => {
  it("keeps lines the caller did not mention", () => {
    const result = patchLineItems(existing, [{ lineItemID: "a", description: "Renamed" }]);

    expect(result).toHaveLength(2);
    expect(result.find((l) => l.lineItemID === "a")?.description).toBe("Renamed");
    // The line nobody mentioned survives untouched — previously it was deleted.
    expect(result.find((l) => l.lineItemID === "b")?.description).toBe("Second");
  });

  it("does not blank fields the caller omitted", () => {
    const [patched] = patchLineItems(existing, [{ lineItemID: "a", description: "Renamed" }]);

    expect(patched.quantity).toBe(1);
    expect(patched.unitAmount).toBe(100);
    expect(patched.accountCode).toBe("200");
  });

  it("still allows a deliberate wholesale replace", () => {
    const result = patchLineItems(existing, [{ lineItemID: "a", description: "Only one" }], {
      replaceUnlisted: true,
    });

    expect(result).toHaveLength(1);
  });

  it("carries every line's id, so Xero updates rather than recreates", () => {
    const result = patchLineItems(existing, [{ lineItemID: "b", description: "x" }]);

    expect(result.every((l) => l.lineItemID)).toBe(true);
  });

  it("keeps the document's own line order when patching a later line", () => {
    // Xero shows lines in order, so retagging line b must not float it to the top.
    const result = patchLineItems(existing, [{ lineItemID: "b", description: "Retagged" }]);

    expect(result.map((l) => l.lineItemID)).toEqual(["a", "b"]);
    expect(result[1].description).toBe("Retagged");
  });

  it("appends genuinely new lines after the existing ones", () => {
    const result = patchLineItems(existing, [
      { description: "Added", quantity: 1, unitAmount: 5 },
      { lineItemID: "a", description: "Patched" },
    ]);

    expect(result.map((l) => l.lineItemID ?? "new")).toEqual(["a", "b", "new"]);
    expect(result[0].description).toBe("Patched");
  });

  it("uses the supplied order only for a deliberate replace", () => {
    const result = patchLineItems(
      existing,
      [{ lineItemID: "b", description: "Second" }, { lineItemID: "a", description: "First" }],
      { replaceUnlisted: true },
    );

    expect(result.map((l) => l.lineItemID)).toEqual(["b", "a"]);
  });

  it("treats a line with no id as an addition", () => {
    const result = patchLineItems(existing, [{ description: "New line", quantity: 1, unitAmount: 5 }]);

    expect(result).toHaveLength(3);
  });

  it("rejects an id that is not on the document", () => {
    expect(() => patchLineItems(existing, [{ lineItemID: "zzz", description: "x" }])).toThrow(
      /not on this document/,
    );
  });

  describe("when payments have been applied", () => {
    const locked = { lockFinancials: true };

    it("allows tracking and wording changes", () => {
      const result = patchLineItems(
        existing,
        [{ lineItemID: "a", description: "Retagged", tracking: [{ name: "Budget", option: "X" }] }],
        locked,
      );

      expect(result.find((l) => l.lineItemID === "a")?.tracking).toHaveLength(1);
    });

    it("refuses to move money", () => {
      expect(() =>
        patchLineItems(existing, [{ lineItemID: "a", unitAmount: 999 }], locked),
      ).toThrow(/unitAmount/);
      expect(() =>
        patchLineItems(existing, [{ lineItemID: "a", quantity: 7 }], locked),
      ).toThrow(/payments applied/);
    });

    it("refuses new lines", () => {
      expect(() => patchLineItems(existing, [{ description: "New" }], locked)).toThrow(
        /Cannot add a line/,
      );
    });

    it("refuses to delete a line by omitting it from a replace", () => {
      // Replacement drops whatever is not listed — the same money loss the lock
      // is there to prevent, reached by a different route.
      expect(() =>
        patchLineItems(existing, [{ lineItemID: "a", description: "Only this one" }], {
          ...locked,
          replaceUnlisted: true,
        }),
      ).toThrow(/Cannot remove line b/);
    });

    it("allows a replace that keeps every existing line", () => {
      const result = patchLineItems(
        existing,
        [
          { lineItemID: "a", description: "Retagged" },
          { lineItemID: "b", description: "Also retagged" },
        ],
        { ...locked, replaceUnlisted: true },
      );

      expect(result).toHaveLength(2);
    });

    it("permits resending an unchanged amount", () => {
      const result = patchLineItems(
        existing,
        [{ lineItemID: "a", unitAmount: 100, description: "Retagged" }],
        locked,
      );

      expect(result.find((l) => l.lineItemID === "a")?.description).toBe("Retagged");
    });
  });
});

const categories = [
  {
    trackingCategoryID: "cat-budget",
    name: "Budget",
    options: [
      { trackingOptionID: "opt-doto", name: "SEJ - DOTO", status: "ACTIVE" },
      { trackingOptionID: "opt-old", name: "Retired", status: "ARCHIVED" },
    ],
  },
] as unknown as TrackingCategory[];

describe("resolveTracking", () => {
  it("fills in the ids Xero needs, which names alone do not provide", () => {
    const [entry] = resolveTracking([{ name: "Budget", option: "SEJ - DOTO" }], categories)!;

    expect(entry.trackingCategoryID).toBe("cat-budget");
    expect(entry.trackingOptionID).toBe("opt-doto");
  });

  it("matches names case- and whitespace-insensitively", () => {
    const [entry] = resolveTracking([{ name: "budget", option: "  sej - doto " }], categories)!;

    expect(entry.trackingOptionID).toBe("opt-doto");
    // The stored spelling wins, not the caller's.
    expect(entry.option).toBe("SEJ - DOTO");
  });

  it("fails loudly on an unknown option instead of writing nothing", () => {
    expect(() => resolveTracking([{ name: "Budget", option: "SEJ - NOPE" }], categories)).toThrow(
      /Unknown option "SEJ - NOPE"/,
    );
  });

  it("names the available options, so the caller can correct itself", () => {
    expect(() => resolveTracking([{ name: "Budget", option: "x" }], categories)).toThrow(
      /SEJ - DOTO/,
    );
  });

  it("does not offer archived options", () => {
    expect(() => resolveTracking([{ name: "Budget", option: "Retired" }], categories)).toThrow(
      /Unknown option/,
    );
  });

  it("fails loudly on an unknown category", () => {
    expect(() => resolveTracking([{ name: "Nope", option: "x" }], categories)).toThrow(
      /Unknown tracking category "Nope"/,
    );
  });

  it("leaves fully identified entries alone", () => {
    const entry = { trackingCategoryID: "cat-x", trackingOptionID: "opt-y", name: "n", option: "o" };

    expect(resolveTracking([entry], [])).toEqual([entry]);
  });

  it("passes through when there is nothing to resolve", () => {
    expect(resolveTracking(undefined, categories)).toBeUndefined();
    expect(resolveTracking([], categories)).toEqual([]);
  });
});

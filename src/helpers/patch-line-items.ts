import { LineItem } from "xero-node";

/** Fields that move money. Changing any of these on a settled document is refused. */
export const FINANCIAL_FIELDS = [
  "quantity",
  "unitAmount",
  "lineAmount",
  "accountCode",
  "taxType",
] as const;

export interface PatchOptions {
  /**
   * Replace the document's lines with exactly what was supplied, discarding any
   * existing line not listed. This is Xero's own behaviour for a line array and
   * was the previous behaviour here; it is destructive, so it is opt-in.
   */
  replaceUnlisted?: boolean;
  /**
   * Refuse changes that move money — for a document with payments applied,
   * where amounts are settled but tracking and wording are still editable.
   */
  lockFinancials?: boolean;
}

/**
 * Merge supplied lines onto the document's existing lines.
 *
 * Supplied lines are matched by lineItemID and patched in place, so a caller
 * wanting to retag one line does not have to resend the rest perfectly — and
 * cannot silently drop the ones it omitted. Lines with no id are additions.
 *
 * Every returned line carries its lineItemID: without ids Xero treats the array
 * as a wholesale replacement and recreates the lines, losing their identity.
 */
export function patchLineItems(
  existing: LineItem[],
  supplied: LineItem[] | undefined,
  options: PatchOptions = {},
): LineItem[] {
  if (!supplied) return existing;

  const byId = new Map(
    existing.filter((l) => l.lineItemID).map((l) => [l.lineItemID as string, l]),
  );
  const touched = new Set<string>();

  const merged = supplied.map((line) => {
    const current = line.lineItemID ? byId.get(line.lineItemID) : undefined;

    if (!current) {
      if (line.lineItemID) {
        throw new Error(
          `Line item ${line.lineItemID} is not on this document. Omit lineItemID to add a new line.`,
        );
      }
      if (options.lockFinancials) {
        throw new Error(
          "Cannot add a line to a document with payments applied. Only tracking and descriptions can change.",
        );
      }
      return line;
    }

    touched.add(current.lineItemID as string);

    if (options.lockFinancials) {
      const changed = FINANCIAL_FIELDS.filter(
        (field) => line[field] !== undefined && line[field] !== current[field],
      );
      if (changed.length) {
        throw new Error(
          `Cannot change ${changed.join(", ")} on line ${current.lineItemID}: this document has payments applied. Tracking and descriptions can still be changed.`,
        );
      }
    }

    // Supplied values win; anything not supplied keeps its current value, so a
    // partial line cannot blank out fields it did not mention.
    const patched: LineItem = { ...current };
    for (const [key, value] of Object.entries(line)) {
      if (value !== undefined) (patched as Record<string, unknown>)[key] = value;
    }
    return patched;
  });

  if (options.replaceUnlisted) return merged;

  const untouched = existing.filter(
    (l) => !l.lineItemID || !touched.has(l.lineItemID),
  );
  return [...merged, ...untouched];
}

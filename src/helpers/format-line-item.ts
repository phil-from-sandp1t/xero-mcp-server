import { LineItem } from "xero-node";

/**
 * Render one line item.
 *
 * Only fields that are actually present are emitted. Line items differ by
 * document — a quote line carries no account code, an invoice line usually
 * does — and printing `Account Code: undefined` for the absent ones reads as
 * missing data rather than an inapplicable field. Zero is kept: a quantity or
 * amount of 0 is a value, not an absence.
 */
export const formatLineItem = (lineItem: LineItem): string => {
  const item = lineItem.item;
  const tracking = lineItem.tracking ?? [];

  return [
    // `item` is an object; interpolating it directly yields [object Object].
    item ? `Item ID: ${item.itemID ?? item.code ?? item.name}` : null,
    lineItem.itemCode != null ? `Item Code: ${lineItem.itemCode}` : null,
    lineItem.description != null ? `Description: ${lineItem.description}` : null,
    lineItem.quantity != null ? `Quantity: ${lineItem.quantity}` : null,
    lineItem.unitAmount != null ? `Unit Amount: ${lineItem.unitAmount}` : null,
    lineItem.accountCode != null ? `Account Code: ${lineItem.accountCode}` : null,
    lineItem.taxType != null ? `Tax Type: ${lineItem.taxType}` : null,
    lineItem.taxAmount != null ? `Tax Amount: ${lineItem.taxAmount}` : null,
    tracking.length
      ? `Tracking: ${tracking
          .map((t) => `${t.name ?? "?"}=${t.option ?? "?"}`)
          .join(", ")}`
      : null,
    lineItem.lineAmount != null ? `Line Amount: ${lineItem.lineAmount}` : null,
  ]
    .filter(Boolean)
    .join("\n");
};

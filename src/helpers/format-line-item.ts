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
  // `item` is an object; interpolating it directly yields [object Object]. An
  // item with none of these set has nothing to show, so emit nothing rather
  // than the "Item ID: undefined" this function exists to avoid.
  const itemRef =
    lineItem.item?.itemID ?? lineItem.item?.code ?? lineItem.item?.name;

  // A tracking entry with neither name nor option says nothing; drop it rather
  // than rendering "?: ?".
  const tracking = (lineItem.tracking ?? []).filter((t) => t.name || t.option);

  return [
    // The update tools patch by this id, so it has to be reachable from the
    // list tools that callers read first.
    lineItem.lineItemID != null ? `Line Item ID: ${lineItem.lineItemID}` : null,
    itemRef != null ? `Item ID: ${itemRef}` : null,
    lineItem.itemCode != null ? `Item Code: ${lineItem.itemCode}` : null,
    lineItem.description != null ? `Description: ${lineItem.description}` : null,
    lineItem.quantity != null ? `Quantity: ${lineItem.quantity}` : null,
    lineItem.unitAmount != null ? `Unit Amount: ${lineItem.unitAmount}` : null,
    lineItem.accountCode != null ? `Account Code: ${lineItem.accountCode}` : null,
    lineItem.taxType != null ? `Tax Type: ${lineItem.taxType}` : null,
    lineItem.taxAmount != null ? `Tax Amount: ${lineItem.taxAmount}` : null,
    // "Budget: H3VEA-OMNI, Budget Owner: Phil" — category name and the option
    // chosen on this line, which is how Xero itself presents tracking.
    tracking.length
      ? `Tracking: ${tracking
          .map((t) => `${t.name ?? "?"}: ${t.option ?? "?"}`)
          .join(", ")}`
      : null,
    lineItem.lineAmount != null ? `Line Amount: ${lineItem.lineAmount}` : null,
  ]
    .filter(Boolean)
    .join("\n");
};

/**
 * Render a document's line items as one block.
 *
 * Interpolating the mapped array directly (`${lineItems.map(formatLineItem)}`)
 * joins with commas, so the last field of one line runs into the first field of
 * the next — "Line Amount: 19800,Description: ...". That makes per-line
 * attribution, which is the reason to read line items at all, hard to follow.
 * Blank-line separated, with a count so a truncated read is obvious.
 */
export const formatLineItems = (lineItems: LineItem[] | undefined): string => {
  if (!lineItems?.length) return "Line Items: none";

  return `Line Items (${lineItems.length}):\n${lineItems
    .map(formatLineItem)
    .join("\n\n")}`;
};

import { LineItem, Quote, QuoteStatusCodes } from "xero-node";

import { formatLineItems } from "./format-line-item.js";

/**
 * What to tell the caller after a quote update.
 *
 * Two things are not otherwise discoverable without a second call, and both
 * have bitten in practice:
 *
 * - what the lines now look like, so an edit can be checked without anyone
 *   remembering to re-read;
 * - that un-invoicing has opened a window in which a billed quote is not
 *   invoiced, and that the quote-to-invoice link cannot be confirmed from the
 *   API, because a quote record holds no reference to the invoice it produced.
 */
export function describeQuoteUpdate(
  quote: Quote | undefined,
  previousStatus?: QuoteStatusCodes,
  deepLink?: string | null,
  previousLines?: LineItem[],
): string {
  const unInvoiced =
    previousStatus === QuoteStatusCodes.INVOICED &&
    quote?.status !== QuoteStatusCodes.INVOICED;

  return [
    "Quote updated successfully:",
    `ID: ${quote?.quoteID}`,
    `Quote Number: ${quote?.quoteNumber}`,
    `Contact: ${quote?.contact?.name}`,
    `Total: ${quote?.total}`,
    previousStatus && previousStatus !== quote?.status
      ? `Status: ${previousStatus} -> ${quote?.status}`
      : `Status: ${quote?.status}`,
    deepLink ? `Link to view: ${deepLink}` : null,
    "",
    formatLineItems(quote?.lineItems),
    droppedTracking(previousLines, quote?.lineItems),
    unInvoiced ? UN_INVOICED_WARNING : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

export const UN_INVOICED_WARNING = [
  "",
  "NOTE: this quote is no longer invoiced. Edit its lines now, then set status",
  "back to INVOICED — until you do, a quote that has been billed is sitting in",
  "ACCEPTED. A quote record holds no reference to the invoice it produced, so",
  "whether the round trip preserves Xero's internal quote-to-invoice link cannot",
  "be confirmed through the API; check in Xero if that link matters.",
].join("\n");

/**
 * Tracking replaces rather than merges: sending tracking for a line replaces
 * every category on it, so a line tagged Budget and Budget Owner loses the one
 * the caller left out. That loss is silent — the write succeeds — so say it.
 */
export function droppedTracking(
  before: LineItem[] | undefined,
  after: LineItem[] | undefined,
): string | null {
  if (!before?.length || !after?.length) return null;

  const lost: string[] = [];
  for (const line of after) {
    const previous = before.find((l) => l.lineItemID === line.lineItemID);
    if (!previous) continue;

    const kept = new Set((line.tracking ?? []).map((t) => t.name));
    for (const tag of previous.tracking ?? []) {
      if (tag.name && !kept.has(tag.name)) {
        lost.push(`${tag.name}: ${tag.option} (line ${line.lineItemID})`);
      }
    }
  }

  if (!lost.length) return null;

  return [
    "",
    `WARNING: tracking removed by this update — ${lost.join("; ")}.`,
    "Tracking replaces rather than merges, so a category left out of the request",
    "is dropped. Resend it if that was not intended.",
  ].join("\n");
}

import { Quote } from "xero-node";

import { formatLineItems } from "./format-line-item.js";

/**
 * Render a quote for a tool response.
 *
 * Line items are opt-in because a page of quotes with every line expanded is
 * mostly noise; they are what someone asking about a *particular* quote almost
 * always wants. Kept out of the tool file so it can be tested without loading
 * the Xero client.
 */
export function formatQuote(quote: Quote, includeLineItems: boolean): string {
  const lineItems = quote.lineItems ?? [];

  return [
    `Quote ID: ${quote.quoteID}`,
    `Quote Number: ${quote.quoteNumber}`,
    quote.reference ? `Reference: ${quote.reference}` : null,
    `Status: ${quote.status || "Unknown"}`,
    quote.contact ? `Contact: ${quote.contact.name} (${quote.contact.contactID})` : null,
    quote.dateString ? `Quote Date: ${quote.dateString}` : null,
    quote.expiryDateString ? `Expiry Date: ${quote.expiryDateString}` : null,
    quote.title ? `Title: ${quote.title}` : null,
    quote.summary ? `Summary: ${quote.summary}` : null,
    quote.terms ? `Terms: ${quote.terms}` : null,
    quote.lineAmountTypes ? `Line Amount Types: ${quote.lineAmountTypes}` : null,
    quote.subTotal ? `Sub Total: ${quote.subTotal}` : null,
    quote.totalTax ? `Total Tax: ${quote.totalTax}` : null,
    `Total: ${quote.total || 0}`,
    quote.totalDiscount ? `Total Discount: ${quote.totalDiscount}` : null,
    quote.currencyCode ? `Currency: ${quote.currencyCode}` : null,
    quote.currencyRate ? `Currency Rate: ${quote.currencyRate}` : null,
    quote.updatedDateUTC ? `Last Updated: ${quote.updatedDateUTC}` : null,
    // Say so explicitly when they were asked for but are absent, rather than
    // leaving a caller to read silence as "this quote has no lines".
    includeLineItems ? formatLineItems(lineItems) : null,
  ]
    .filter(Boolean)
    .join("\n");
}

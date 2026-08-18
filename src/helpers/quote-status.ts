/**
 * Does this request change nothing but the quote's status?
 *
 * An INVOICED quote is locked for content, but its status can still be moved
 * back — that is what the Xero UI's "Mark as uninvoiced" does, and it is the
 * sanctioned way to reopen a quote for editing. Content edits stay refused
 * until it is actually reopened, so the two steps remain distinct and visible.
 *
 * A quote number equal to the one already on the quote is deliberately not
 * content: it changes nothing. Callers are told (correctly) to always send the
 * number, because omitting it makes Xero assign a new one from the sequence —
 * so counting it as content would punish the very habit that prevents a
 * silent renumbering.
 */
export function isStatusOnlyChange(
  fields: Record<string, unknown>,
  existingQuoteNumber?: string,
): boolean {
  return Object.entries(fields).every(([key, value]) => {
    if (key === "status" || value === undefined) return true;
    return key === "quoteNumber" && value === existingQuoteNumber;
  });
}

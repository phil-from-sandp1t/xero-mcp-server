/**
 * Does this request change nothing but the quote's status?
 *
 * An INVOICED quote is locked for content, but its status can still be moved
 * back — that is what the Xero UI's "Mark as uninvoiced" does, and it is the
 * sanctioned way to reopen a quote for editing. Content edits stay refused
 * until it is actually reopened, so the two steps remain distinct and visible.
 */
export function isStatusOnlyChange(fields: Record<string, unknown>): boolean {
  return Object.entries(fields).every(
    ([key, value]) => key === "status" || value === undefined,
  );
}

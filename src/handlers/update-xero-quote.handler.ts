import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { LineItem, LineItemTracking, Quote, QuoteStatusCodes } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { patchLineItems } from "../helpers/patch-line-items.js";
import { isStatusOnlyChange } from "../helpers/quote-status.js";
import { resolveTracking } from "../helpers/resolve-tracking.js";

/**
 * A line to apply. With a lineItemID this is a patch — only the fields given
 * change — so everything is optional; the tool requires the essentials when
 * adding a new line.
 */
interface QuoteLineItem {
  description?: string;
  quantity?: number;
  unitAmount?: number;
  accountCode?: string;
  taxType?: string;
  itemCode?: string;
  tracking?: LineItemTracking[];
  lineItemID?: string;
}



async function getQuote(quoteId: string): Promise<Quote | undefined> {
  await xeroClient.authenticate();

  const response = await xeroClient.accountingApi.getQuote(
    xeroClient.tenantId,
    quoteId,
    getClientHeaders(),
  );

  return response.body.quotes?.[0];
}

async function getTrackingCategories() {
  const response = await xeroClient.accountingApi.getTrackingCategories(
    xeroClient.tenantId,
    undefined, // where
    undefined, // order
    true, // includeArchived
    getClientHeaders(),
  );
  return response.body.trackingCategories ?? [];
}

async function updateQuote(
  quoteId: string,
  lineItems?: QuoteLineItem[],
  reference?: string,
  terms?: string,
  title?: string,
  summary?: string,
  quoteNumber?: string,
  contactId?: string,
  date?: string,
  expiryDate?: string,
  existingQuote?: Quote,
  replaceUnlistedLineItems?: boolean,
  status?: QuoteStatusCodes,
  statusOnly?: boolean,
  lockAmounts?: boolean,
): Promise<Quote | undefined> {
  // A status-only change carries nothing else: sending line items back to an
  // invoiced quote is what Xero refuses, and the number is kept because
  // omitting it makes Xero assign a new one from the sequence.
  if (statusOnly) {
    const response = await xeroClient.accountingApi.updateQuote(
      xeroClient.tenantId,
      quoteId,
      {
        quotes: [
          {
            quoteID: quoteId,
            quoteNumber: existingQuote?.quoteNumber,
            // Xero validates these on every quote update, including one that
            // changes nothing but the status: without them it answers 400
            // "Contact requires a valid ContactId" and "Date cannot be empty".
            contact: existingQuote?.contact,
            date: existingQuote?.date,
            status,
          },
        ],
      },
      undefined, // idempotencyKey
      getClientHeaders(),
    );

    return response.body.quotes?.[0];
  }

  let resolvedLines: LineItem[] | undefined = lineItems;

  if (lineItems?.length) {
    const categories = lineItems.some((l) => l.tracking?.length)
      ? await getTrackingCategories()
      : [];

    resolvedLines = lineItems.map((line) => ({
      ...line,
      tracking: resolveTracking(line.tracking, categories),
    }));
  }

  const quote: Quote = {
    lineItems: patchLineItems(existingQuote?.lineItems ?? [], resolvedLines, {
      replaceUnlisted: replaceUnlistedLineItems,
      // A quote that has been billed should not have its amounts move during a
      // retagging round trip. update-invoice has always locked amounts once
      // money is applied; a quote reopened from INVOICED deserves the same.
      lockFinancials: lockAmounts,
      lockReason:
        "this quote has left DRAFT, so its amounts are settled; pass allowAmountChanges to reprice it deliberately",
    }),
    reference: reference,
    terms: terms,
    title: title,
    summary: summary,
    // Always send the number. Omitting it makes Xero assign the next one from
    // the sequence, silently renumbering an existing quote.
    quoteNumber: quoteNumber ?? existingQuote?.quoteNumber,
    expiryDate: expiryDate,
    status: status,
  };

  if (contactId) {
    quote.contact = { contactID: contactId };
  } else if (existingQuote?.contact) {
    quote.contact = existingQuote.contact;
  }

  if (date) {
    quote.date = date;
  } else if (existingQuote?.date) {
    quote.date = existingQuote.date;
  }

  // Sending amounts without stating how they are expressed invites Xero to
  // reinterpret them.
  if (existingQuote?.lineAmountTypes) {
    quote.lineAmountTypes = existingQuote.lineAmountTypes;
  }

  const response = await xeroClient.accountingApi.updateQuote(
    xeroClient.tenantId,
    quoteId,
    { quotes: [quote] },
    undefined, // idempotencyKey
    getClientHeaders(),
  );

  return response.body.quotes?.[0];
}

/**
 * What the caller needs to describe the update: the quote as it now stands, and
 * the status it held before, so an un-invoicing can be recognised and reported.
 */
export interface QuoteUpdateResult {
  quote: Quote;
  previousStatus?: QuoteStatusCodes;
  /** Lines as they stood before the update, for reporting what changed. */
  previousLineItems?: LineItem[];
}

/**
 * Update an existing quote in Xero
 */
export async function updateXeroQuote(
  quoteId: string,
  lineItems?: QuoteLineItem[],
  reference?: string,
  terms?: string,
  title?: string,
  summary?: string,
  quoteNumber?: string,
  contactId?: string,
  date?: string,
  expiryDate?: string,
  replaceUnlistedLineItems?: boolean,
  status?: QuoteStatusCodes,
  allowAmountChanges?: boolean,
): Promise<XeroClientResponse<QuoteUpdateResult>> {
  try {
    const existingQuote = await getQuote(quoteId);

    const quoteStatus = existingQuote?.status;

    const statusOnly = isStatusOnlyChange({
      lineItems,
      reference,
      terms,
      title,
      summary,
      quoteNumber,
      contactId,
      date,
      expiryDate,
      status,
    }, existingQuote?.quoteNumber);

    // A different number IS a content change; say which, rather than leaving
    // the caller to guess what counted as content.
    // A quote that has left DRAFT has gone out: it has been sent, accepted or
    // billed. Its amounts should not move as a side effect of retagging. There
    // is no way to tell from the record that a quote was previously invoiced —
    // once un-invoiced it is simply ACCEPTED — so "has left draft" is the
    // determinable line. A caller that genuinely means to reprice says so.
    const lockAmounts =
      quoteStatus !== undefined &&
      quoteStatus !== QuoteStatusCodes.DRAFT &&
      allowAmountChanges !== true;

    const renumbering =
      quoteNumber !== undefined &&
      existingQuote?.quoteNumber !== undefined &&
      quoteNumber !== existingQuote.quoteNumber;

    if (quoteStatus === QuoteStatusCodes.DELETED) {
      return {
        result: null,
        isError: true,
        error: `Cannot update quote with status ${quoteStatus}.`,
      };
    }

    // Invoiced quotes are locked for content but can still be moved back to
    // ACCEPTED, which reopens them for editing.
    if (quoteStatus === QuoteStatusCodes.INVOICED && renumbering) {
      return {
        result: null,
        isError: true,
        error: `Cannot renumber an INVOICED quote: it is ${existingQuote?.quoteNumber}, and the request asked for ${quoteNumber}. Un-invoice it first by setting status to ACCEPTED.`,
      };
    }

    if (quoteStatus === QuoteStatusCodes.INVOICED && !statusOnly) {
      return {
        result: null,
        isError: true,
        error:
          "Cannot change the contents of an INVOICED quote. Set status to ACCEPTED first to un-invoice it, then edit.",
      };
    }

    const updatedQuote = await updateQuote(
      quoteId,
      lineItems,
      reference,
      terms,
      title,
      summary,
      quoteNumber,
      contactId,
      date,
      expiryDate,
      existingQuote,
      replaceUnlistedLineItems,
      status,
      statusOnly && status !== undefined,
      lockAmounts,
    );

    if (!updatedQuote) {
      throw new Error("Quote update failed.");
    }

    return {
      result: {
        quote: updatedQuote,
        previousStatus: quoteStatus,
        previousLineItems: existingQuote?.lineItems,
      },
      isError: false,
      error: null,
    };
  } catch (error) {
    return {
      result: null,
      isError: true,
      error: formatError(error),
    };
  }
}

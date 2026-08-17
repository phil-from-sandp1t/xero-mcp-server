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

/**
 * Statuses Xero will not accept an update for. Everything else — SENT,
 * ACCEPTED, DECLINED — stays editable, which is how a quote gets retagged after
 * it has left draft. Verified against a live ACCEPTED quote: tracking applied,
 * number, status and totals unchanged.
 */
const UNEDITABLE_QUOTE_STATUSES: QuoteStatusCodes[] = [
  QuoteStatusCodes.INVOICED,
  QuoteStatusCodes.DELETED,
];


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
): Promise<XeroClientResponse<Quote>> {
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
    });

    if (quoteStatus === QuoteStatusCodes.DELETED) {
      return {
        result: null,
        isError: true,
        error: `Cannot update quote with status ${quoteStatus}.`,
      };
    }

    // Invoiced quotes are locked for content but can still be moved back to
    // ACCEPTED, which reopens them for editing.
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
    );

    if (!updatedQuote) {
      throw new Error("Quote update failed.");
    }

    return {
      result: updatedQuote,
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

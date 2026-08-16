import { xeroClient } from "../clients/xero-client.js";
import { XeroClientResponse } from "../types/tool-response.js";
import { formatError } from "../helpers/format-error.js";
import { Invoice, LineItem, LineItemTracking } from "xero-node";
import { getClientHeaders } from "../helpers/get-client-headers.js";
import { patchLineItems } from "../helpers/patch-line-items.js";
import { resolveTracking } from "../helpers/resolve-tracking.js";

/**
 * Statuses Xero will not accept an update for. AUTHORISED and PAID stay
 * editable for non-financial fields — verified against a live PAID invoice with
 * two payments: tracking applied, number, status, total and amount paid all
 * unchanged.
 */
const UNEDITABLE_INVOICE_STATUSES: Invoice.StatusEnum[] = [
  Invoice.StatusEnum.VOIDED,
  Invoice.StatusEnum.DELETED,
];

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

/**
 * A line to apply. With a lineItemID this is a patch — only the fields given
 * change — so everything is optional; the tool requires the essentials when
 * adding a new line.
 */
interface InvoiceLineItem {
  description?: string;
  quantity?: number;
  unitAmount?: number;
  accountCode?: string;
  taxType?: string;
  itemCode?: string;
  tracking?: LineItemTracking[];
  /**
   * Identifies an existing line so Xero updates it in place. Without ids the
   * request is a wholesale replacement: every existing line is discarded and
   * recreated, which loses their identity.
   */
  lineItemID?: string;
}

async function getInvoice(invoiceId: string): Promise<Invoice | undefined> {
  await xeroClient.authenticate();

  // First, get the current invoice to check its status
  const response = await xeroClient.accountingApi.getInvoice(
    xeroClient.tenantId,
    invoiceId, // invoiceId
    undefined, // unitdp
    getClientHeaders(), // options
  );

  return response.body.invoices?.[0];
}

async function updateInvoice(
  invoiceId: string,
  lineItems?: InvoiceLineItem[],
  reference?: string,
  dueDate?: string,
  date?: string,
  contactId?: string,
  existingInvoice?: Invoice,
  replaceUnlistedLineItems?: boolean,
): Promise<Invoice | undefined> {
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

  // Amounts are settled once money has been applied; wording and tracking are
  // not. Refuse the former rather than letting Xero reject or, worse, accept it.
  const lockFinancials = (existingInvoice?.amountPaid ?? 0) > 0;

  const invoice: Invoice = {
    lineItems: patchLineItems(existingInvoice?.lineItems ?? [], resolvedLines, {
      replaceUnlisted: replaceUnlistedLineItems,
      lockFinancials,
    }),
    reference: reference,
    dueDate: dueDate,
    date: date,
    contact: contactId ? { contactID: contactId } : undefined,
    // Always send the number: omitting it invites Xero to assign the next from
    // the sequence, which silently renumbers the invoice.
    invoiceNumber: existingInvoice?.invoiceNumber,
    lineAmountTypes: existingInvoice?.lineAmountTypes,
  };

  const response = await xeroClient.accountingApi.updateInvoice(
    xeroClient.tenantId,
    invoiceId, // invoiceId
    {
      invoices: [invoice],
    }, // invoices
    undefined, // unitdp
    undefined, // idempotencyKey
    getClientHeaders(), // options
  );

  return response.body.invoices?.[0];
}

/**
 * Update an existing invoice in Xero
 */
export async function updateXeroInvoice(
  invoiceId: string,
  lineItems?: InvoiceLineItem[],
  reference?: string,
  dueDate?: string,
  date?: string,
  contactId?: string,
  replaceUnlistedLineItems?: boolean,
): Promise<XeroClientResponse<Invoice>> {
  try {
    const existingInvoice = await getInvoice(invoiceId);

    const invoiceStatus = existingInvoice?.status;

    if (invoiceStatus && UNEDITABLE_INVOICE_STATUSES.includes(invoiceStatus)) {
      return {
        result: null,
        isError: true,
        error: `Cannot update invoice with status ${invoiceStatus}.`,
      };
    }

    const updatedInvoice = await updateInvoice(
      invoiceId,
      lineItems,
      reference,
      dueDate,
      date,
      contactId,
      existingInvoice,
      replaceUnlistedLineItems,
    );

    if (!updatedInvoice) {
      throw new Error("Invoice update failed.");
    }

    return {
      result: updatedInvoice,
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

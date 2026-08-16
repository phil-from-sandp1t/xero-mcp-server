import { z } from "zod";
import { updateXeroInvoice } from "../../handlers/update-xero-invoice.handler.js";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { Invoice } from "xero-node";

const trackingSchema = z.object({
  name: z.string().describe("The name of the tracking category. Can be obtained from the list-tracking-categories tool"),
  option: z.string().describe("The name of the tracking option. Can be obtained from the list-tracking-categories tool"),
  trackingCategoryID: z.string().describe("The ID of the tracking category. \
    Optional: the name is resolved to an id automatically. \
    Can be obtained from the list-tracking-categories tool").optional(),
});


// A line identified by lineItemID is a patch: send only what changes. A line
// without one is a new line, and Xero needs the essentials to create it.
const requireEssentialsForNewLines = (
  line: { lineItemID?: string; description?: string; quantity?: number; unitAmount?: number; accountCode?: string; taxType?: string },
  ctx: z.RefinementCtx,
) => {
  if (line.lineItemID) return;
  for (const field of ["description", "quantity", "unitAmount", "accountCode", "taxType"] as const) {
    if (line[field] === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} is required when adding a new line item (no lineItemID given)`,
      });
    }
  }
};

const lineItemSchema = z.object({
  description: z.string().describe("The description of the line item").optional(),
  quantity: z.number().describe("The quantity of the line item").optional(),
  unitAmount: z.number().describe("The price per unit of the line item").optional(),
  accountCode: z.string().describe("The account code of the line item - can be obtained from the list-accounts tool").optional(),
  taxType: z.string().describe("The tax type of the line item - can be obtained from the list-tax-rates tool").optional(),
  itemCode: z.string().describe("The item code of the line item - can be obtained from the list-items tool \
    If the item was not populated in the original invoice, \
    add without an item code unless the user has told you to add an item code.").optional(),
  tracking: z.array(trackingSchema).describe("Up to 2 tracking categories and options can be added to the line item. \
    Can be obtained from the list-tracking-categories tool. \
    Only use if prompted by the user.").optional(),
  lineItemID: z.string().describe("The ID of an existing line item, from list-invoices. \
    Supply it to update that line in place; without it Xero replaces the invoice's lines.").optional(),
}).superRefine(requireEssentialsForNewLines);

const UpdateInvoiceTool = CreateXeroTool(
  "update-invoice",
  "Update an invoice in Xero. Works on any invoice that is not voided or deleted, including AUTHORISED and PAID.\
  Once payments are applied, amounts are locked but tracking and descriptions can still be changed; an attempt to move money is refused.\
  Supply only the line items you are changing, each with its lineItemID from list-invoices; the rest are left untouched.\
  Fields you omit on a supplied line keep their current value.\
 When an invoice is updated, a deep link to the invoice in Xero is returned. \
 This deep link can be used to view the contact in Xero directly. \
 This link should be displayed to the user.",
  {
    invoiceId: z.string().describe("The ID of the invoice to update."),
    lineItems: z.array(lineItemSchema).optional().describe(
      "Only the line items you are changing. Give each one its lineItemID from list-invoices; \
      lines you do not list are left untouched, and fields you omit keep their current value.",
    ),
    reference: z.string().optional().describe("A reference number for the invoice."),
    dueDate: z.string().optional().describe("The due date of the invoice."),
    date: z.string().optional().describe("The date of the invoice."),
    contactId: z.string().optional().describe("The ID of the contact to update the invoice for. \
      Can be obtained from the list-contacts tool."),
    replaceUnlistedLineItems: z.boolean().optional().describe(
      "Replace the invoice's lines with exactly those supplied, deleting any not listed. Destructive; leave unset to patch.",
    ),
  },
  async (
    {
      invoiceId,
      lineItems,
      reference,
      dueDate,
      date,
      contactId,
      replaceUnlistedLineItems,
    },
    //_extra: { signal: AbortSignal },
  ) => {
    const result = await updateXeroInvoice(
      invoiceId,
      lineItems,
      reference,
      dueDate,
      date,
      contactId,
      replaceUnlistedLineItems,
    );
    if (result.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error updating invoice: ${result.error}`,
          },
        ],
      };
    }

    const invoice = result.result;

    const deepLink = invoice.invoiceID
      ? await getDeepLink(
          invoice.type === Invoice.TypeEnum.ACCREC ? DeepLinkType.INVOICE : DeepLinkType.BILL,
          invoice.invoiceID,
        )
      : null;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Invoice updated successfully:",
            `ID: ${invoice?.invoiceID}`,
            `Contact: ${invoice?.contact?.name}`,
            `Type: ${invoice?.type}`,
            `Total: ${invoice?.total}`,
            `Status: ${invoice?.status}`,
            deepLink ? `Link to view: ${deepLink}` : null,
          ].join("\n"),
        },
      ],
    };
  },
);

export default UpdateInvoiceTool;

import { z } from "zod";
import { QuoteStatusCodes } from "xero-node";
import { updateXeroQuote } from "../../handlers/update-xero-quote.handler.js";
import { DeepLinkType, getDeepLink } from "../../helpers/get-deeplink.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const trackingSchema = z.object({
  name: z.string().describe("The name of the tracking category. Can be obtained from the list-tracking-categories tool"),
  option: z.string().describe("The name of the tracking option. Can be obtained from the list-tracking-categories tool"),
  trackingCategoryID: z.string().describe("The ID of the tracking category. \
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
  description: z.string().optional(),
  quantity: z.number().optional(),
  unitAmount: z.number().optional(),
  accountCode: z.string().optional(),
  taxType: z.string().optional(),
  itemCode: z.string().describe("The item code of the line item - can be obtained from the list-items tool").optional(),
  tracking: z.array(trackingSchema).describe("Up to 2 tracking categories and options can be added to the line item. \
    Can be obtained from the list-tracking-categories tool. \
    Only use if prompted by the user.").optional(),
  lineItemID: z.string().describe("The ID of an existing line item, from list-quotes. \
    Supply it to update that line in place; without it Xero replaces the quote's lines.").optional(),
}).superRefine(requireEssentialsForNewLines);

const UpdateQuoteTool = CreateXeroTool(
  "update-quote",
  "Update a quote in Xero. Works on any quote that is not deleted, including SENT and ACCEPTED.\
  An INVOICED quote accepts a status change only: set status ACCEPTED to un-invoice it, then edit its contents.\
  Line items accept tracking categories (e.g. Budget, Budget Owner), same as update-invoice.\
  Supply only the line items you are changing, each with its lineItemID from list-quotes; the rest are left untouched.\
  Fields you omit on a supplied line keep their current value.\
 When a quote is updated, a deep link to the quote in Xero is returned. \
 This deep link can be used to view the quote in Xero directly. \
 This link should be displayed to the user.",
  {
    quoteId: z.string(),
    lineItems: z.array(lineItemSchema).optional().describe(
      "All line items must be provided. Any line items not provided will be removed. Including existing line items. \
      Do not modify line items that have not been specified by the user",
    ),
    reference: z.string().optional(),
    terms: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
    quoteNumber: z.string().optional(),
    contactId: z.string().optional(),
    date: z.string().optional(),
    expiryDate: z.string().optional(),
    status: z.enum(["DRAFT", "SENT", "DECLINED", "ACCEPTED", "INVOICED"]).optional().describe(
      "New status for the quote. ACCEPTED on an INVOICED quote un-invoices it (the UI's 'Mark as uninvoiced'), \
      which reopens it for line and tracking edits; set INVOICED again afterwards to put it back. \
      On an INVOICED quote, status must be the only change.",
    ),
    replaceUnlistedLineItems: z.boolean().optional().describe(
      "Replace the quote's lines with exactly those supplied, deleting any not listed. Destructive; leave unset to patch.",
    ),
  },
  async (
    {
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
      replaceUnlistedLineItems,
      status,
    }
  ) => {
    const result = await updateXeroQuote(
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
      replaceUnlistedLineItems,
      status as QuoteStatusCodes | undefined,
    );
    if (result.isError) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error updating quote: ${result.error}`,
          },
        ],
      };
    }

    const quote = result.result;

    const deepLink = quote.quoteID
      ? await getDeepLink(DeepLinkType.QUOTE, quote.quoteID)
      : null;

    return {
      content: [
        {
          type: "text" as const,
          text: [
            "Quote updated successfully:",
            `ID: ${quote?.quoteID}`,
            `Contact: ${quote?.contact?.name}`,
            `Total: ${quote?.total}`,
            `Status: ${quote?.status}`,
            deepLink ? `Link to view: ${deepLink}` : null,
          ].join("\n"),
        },
      ],
    };
  },
);

export default UpdateQuoteTool; 
import { z } from "zod";
import { listXeroQuotes } from "../../handlers/list-xero-quotes.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatQuote } from "../../helpers/format-quote.js";

const ListQuotesTool = CreateXeroTool(
  "list-quotes",
  `List quotes in Xero, including their line items.
  Ask the user if they want to see quotes for a specific contact before running.
  Line items — description, quantity, unit amount, tax and per-line totals — are returned automatically when you ask for one quote by quoteNumber, and can be requested for any listing with includeLineItems.
  Ask the user if they want the next page of quotes after running this tool if 10 quotes are returned.
  If they do, call this tool again with the page number and the contact provided in the previous call.`,
  {
    page: z.number(),
    contactId: z.string().optional(),
    quoteNumber: z.string().optional(),
    includeLineItems: z
      .boolean()
      .optional()
      .describe(
        "Include each quote's line items. Defaults to true when quoteNumber is given, false otherwise, since a full page of quotes with every line expanded is mostly noise.",
      ),
  },
  async ({ page, contactId, quoteNumber, includeLineItems }) => {
    const response = await listXeroQuotes(page, contactId, quoteNumber);
    if (response.error !== null) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error listing quotes: ${response.error}`,
          },
        ],
      };
    }

    const quotes = response.result;
    const withLineItems = includeLineItems ?? Boolean(quoteNumber);

    return {
      content: [
        {
          type: "text" as const,
          text: `Found ${quotes?.length || 0} quotes:`,
        },
        ...(quotes?.map((quote) => ({
          type: "text" as const,
          text: formatQuote(quote, withLineItems),
        })) || []),
      ],
    };
  },
);

export default ListQuotesTool;

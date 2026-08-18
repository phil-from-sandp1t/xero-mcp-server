import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Sent to clients at initialise and typically injected into the model's
 * context. This is the only place server behaviour can be explained to a
 * session directly — a README cannot reach one.
 */
const INSTRUCTIONS = `Xero accounting data for the connected organisation.

One authorisation can cover several organisations. Where it does, this server
will not pick one for you: calls fail with an explanation until an organisation
is chosen, because guessing would mean writing to the wrong company's ledger and
the result would look entirely normal. Use list-xero-tenants to see what the
connection reaches and which is active, and select-xero-tenant to switch. A
selection lasts for the life of the server process and applies to every caller
using it, so confirm with the user before switching. A server may also be pinned
with XERO_TENANT_ID, which is the safer setup when the organisation is known in
advance.

Authentication renews itself. In refresh-token mode (XERO_TOKEN_FILE) the server
renews the access token from a stored refresh token before each call, so a token
expiring is not a problem and never needs the user's involvement. Do not ask the
user to re-authenticate because time has passed.

Editing a quote that has already been invoiced takes three steps, in order:
un-invoice it (update-quote with status ACCEPTED and nothing else), edit the
lines, then set status back to INVOICED. Between the first and last step a
billed quote is sitting in ACCEPTED, so do one quote at a time and finish it.
If a step fails part way, put the status back before doing anything else.

Never change amounts while retagging. Quantity, unit amount, line amount,
account code and tax type are refused on a quote that has left DRAFT unless
allowAmountChanges is set; only tracking and wording should move.

Tracking replaces, it does not merge. Sending tracking for a line replaces every
category on that line, so a line tagged both Budget and Budget Owner loses the
one you leave out. Read the line first and resend the tags you want to keep.

Patch by lineItemID, which list-quotes and list-invoices print. Lines you do not
list are left alone; fields you omit keep their current value.

Scopes are fixed at the moment of authorisation, and are separate from
authentication. A call can therefore fail for lack of scope while authentication
is perfectly healthy: Xero answers with 403 / AuthorizationUnsuccessful, and
check-xero-auth still reports "working" because the token is valid for what it
was granted. Read such a failure as "this connection was never granted that
access", not as "the credentials expired".

When a Xero call fails and the reason is unclear, call check-xero-auth. It
reports the connected organisation, remaining token life and the granted scopes,
and names the remedy.

Widening access requires the user. reauthorize-xero opens a browser for them to
sign in, so only call it when they have asked, or when check-xero-auth reports a
genuine failure. Re-authorising inherits the existing scope list, which keeps
access stable but means it cannot add anything: to add a scope, pass the full
list you want in the scopes argument, because the request replaces rather than
extends the granted set. Never invent a client id — if the tool reports none is
on record, ask the user for it.`;

export class XeroMcpServer {
  private static instance: McpServer | null = null;

  private constructor() {}

  public static GetServer(): McpServer {
    if (XeroMcpServer.instance === null) {
      XeroMcpServer.instance = new McpServer(
        {
          name: "Xero MCP Server",
          version: "1.0.0",
        },
        { instructions: INSTRUCTIONS },
      );
    }
    return XeroMcpServer.instance;
  }
}

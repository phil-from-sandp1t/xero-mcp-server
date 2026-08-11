import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Sent to clients at initialise and typically injected into the model's
 * context. This is the only place server behaviour can be explained to a
 * session directly — a README cannot reach one.
 */
const INSTRUCTIONS = `Xero accounting data for the connected organisation.

Authentication renews itself. In refresh-token mode (XERO_TOKEN_FILE) the server
renews the access token from a stored refresh token before each call, so a token
expiring is not a problem and never needs the user's involvement. Do not ask the
user to re-authenticate because time has passed.

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

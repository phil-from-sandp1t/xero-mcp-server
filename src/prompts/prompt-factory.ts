import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Prompts exposed by this server. MCP clients surface these as commands —
 * in Claude Code they appear as /mcp__<servername>__<promptname>.
 *
 * This is how re-authorisation ships with the server itself, rather than as a
 * client-side snippet that has to be installed and kept in step separately.
 */
export function PromptFactory(server: McpServer) {
  server.prompt(
    "reauthorize",
    "Re-authorise this Xero connection (opens a browser for Xero login).",
    () => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              "Re-authorise the Xero MCP connection.",
              "",
              "First run the `check-xero-auth` tool. If it reports auth is working, say so and stop — re-authorising is not needed, because the server renews its own access tokens. Only continue if it reports a failure, or if I explicitly asked to re-authorise anyway.",
              "",
              "To re-authorise, run this in the directory of the Xero MCP server installation:",
              "",
              "    npx xero-auth",
              "",
              "Do not pass XERO_CLIENT_ID or XERO_SCOPES: the command inherits both from the existing token file, which is what keeps the granted scopes identical to the ones already in use. Only set them for a first-time setup with no token file.",
              "",
              "The command opens Xero in a browser and waits for the callback on http://localhost:3333/callback, so it needs me to complete a login. Tell me when to expect the browser, and that the command will sit waiting until I do.",
              "",
              "Afterwards, nothing needs restarting — the server reads the token file on its next tool call. Confirm by running `check-xero-auth` again.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

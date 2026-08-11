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
              "To re-authorise, call the `reauthorize-xero` tool. It opens Xero in a browser and returns the sign-in URL; tell me to expect the browser, and pass the URL on in case it did not open.",
              "",
              "If it replies that it is still waiting, do not start another one — call the same tool again after I confirm I have signed in, and it will report the outcome.",
              "",
              "Afterwards, nothing needs restarting: the server reads the refreshed tokens on its next call. Confirm with `check-xero-auth`.",
              "",
              "The equivalent from a terminal, if the tools are unavailable, is `npm run auth` in the server directory (or `npx xero-auth` when installed from npm), with XERO_TOKEN_FILE set to the path the server uses.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}

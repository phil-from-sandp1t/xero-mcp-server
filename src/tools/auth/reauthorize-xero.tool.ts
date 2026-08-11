import { z } from "zod";

import { reauthorize, ReauthorizationResult } from "../../auth/reauthorize.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

export function formatReauthorization(result: ReauthorizationResult): string {
  if (result.state === "authorized") {
    return [
      "Xero re-authorisation complete.",
      result.tokenFile ? `Token file: ${result.tokenFile}` : undefined,
      result.scopes?.length ? `Scopes granted: ${result.scopes.length}` : undefined,
      "Nothing needs restarting — the next Xero call uses the new tokens.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  if (result.state === "error") {
    return `Xero re-authorisation failed: ${result.error ?? "unknown error"}`;
  }

  return [
    "Waiting for you to finish signing in to Xero.",
    "",
    "A browser should have opened. If not, open this URL:",
    result.authorizeUrl ?? "(no URL)",
    "",
    result.tokenFile ? `Token file to be written: ${result.tokenFile}` : undefined,
    result.scopes?.length
      ? `Requesting ${result.scopes.length} scopes, inherited from ${result.scopesSource ?? "configuration"}.`
      : undefined,
    "",
    "The listener stays up after this reply. Once you have signed in, call this tool again to confirm the result.",
  ]
    .filter(Boolean)
    .join("\n");
}

const ReauthorizeXeroTool = CreateXeroTool(
  "reauthorize-xero",
  `Re-authorise this Xero connection by running the interactive login (OAuth PKCE) and replacing the stored tokens.
Opens a browser for the user to sign in to Xero, then writes the refreshed tokens.
Call this ONLY when the user asks to re-authorise, or when check-xero-auth reports that authentication is broken — the server renews its own access tokens, so routine expiry needs no action.
It returns as soon as the sign-in URL is ready; if the user has not finished signing in, call it again to collect the result.`,
  {
    waitSeconds: z
      .number()
      .min(0)
      .max(120)
      .optional()
      .describe(
        "How long to wait for the sign-in to complete before replying (default 60). The flow continues in the background either way.",
      ),
    openBrowser: z
      .boolean()
      .optional()
      .describe(
        "Whether to open the sign-in page automatically (default true). Set false on a headless machine; the URL is returned either way.",
      ),
  },
  async (params: { waitSeconds?: number; openBrowser?: boolean }) => {
    const result = await reauthorize({
      waitMs: (params.waitSeconds ?? 60) * 1000,
      openBrowser: params.openBrowser,
    });

    return {
      content: [{ type: "text" as const, text: formatReauthorization(result) }],
    };
  },
);

export default ReauthorizeXeroTool;

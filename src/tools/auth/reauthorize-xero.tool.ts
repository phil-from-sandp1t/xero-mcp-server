import { z } from "zod";

import { reauthorize, ReauthorizationResult } from "../../auth/reauthorize.js";
import { currentAuthMode } from "../../helpers/xero-auth-status.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

/**
 * Why re-authorising would not help this server, if it would not.
 *
 * Re-authorisation writes a token file, and only refresh-token mode reads one.
 * On a server started in another mode the write would succeed and change
 * nothing — reporting a repair that did not happen is worse than refusing,
 * because the next failure looks unrelated to it.
 */
export function reauthorizationUnsupportedReason(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const mode = currentAuthMode(env);
  if (mode === "refresh token") return undefined;

  return [
    `This server is running in ${mode} mode, which does not read a token file.`,
    "Re-authorising would write one that this server ignores, so nothing would change.",
    "To use refresh-token auth, set XERO_TOKEN_FILE in the server's configuration and restart it, then re-authorise.",
  ].join(" ");
}

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

  if (result.state === "needs client id") {
    return [
      "Cannot start: no Xero client id is on record.",
      "",
      result.error ?? "",
      "",
      "Ask the user for it, then call this tool again with `clientId` set. Do not guess one.",
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
Call this ONLY when the user asks to re-authorise, when check-xero-auth reports that authentication is broken, or to change the granted scopes — the server renews its own access tokens, so routine expiry needs no action.
It returns as soon as the sign-in URL is ready; if the user has not finished signing in, call it again to collect the result.
By default the client id and scopes are inherited from the existing token file. If it reports that no client id is on record, ask the user for it and call again with clientId.`,
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
    clientId: z
      .string()
      .optional()
      .describe(
        "Xero app client id. Only needed for a first-time setup, or if the tool reports that none is on record — ask the user for it rather than guessing.",
      ),
    scopes: z
      .string()
      .optional()
      .describe(
        "Space-separated scopes to request. Omit to keep exactly the scopes already granted. Required to ADD access: without it the existing scope list is reproduced.",
      ),
  },
  async (params: {
    waitSeconds?: number;
    openBrowser?: boolean;
    clientId?: string;
    scopes?: string;
  }) => {
    const unsupported = reauthorizationUnsupportedReason();
    if (unsupported) {
      return { content: [{ type: "text" as const, text: unsupported }] };
    }

    const result = await reauthorize({
      waitMs: (params.waitSeconds ?? 60) * 1000,
      openBrowser: params.openBrowser,
      clientId: params.clientId,
      scopes: params.scopes,
    });

    return {
      content: [{ type: "text" as const, text: formatReauthorization(result) }],
    };
  },
);

export default ReauthorizeXeroTool;

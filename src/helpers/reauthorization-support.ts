import { currentAuthMode } from "./xero-auth-status.js";

/**
 * Why re-authorising would not help this server, if it would not.
 *
 * Re-authorisation writes a token file, and only refresh-token mode reads one.
 * On a server started in another mode the write would succeed and change
 * nothing — reporting a repair that did not happen is worse than refusing,
 * because the next failure looks unrelated to it.
 *
 * Pure, and kept out of the tool module so it can be imported — by tests or
 * anything else — without constructing a Xero client, which needs credentials.
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

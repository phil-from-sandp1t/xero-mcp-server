#!/usr/bin/env node
/**
 * Interactive Xero authorisation (OAuth 2.0 authorization code + PKCE).
 *
 * Creates or replaces the token file that the server's refresh-token auth mode
 * reads. Needed once when setting up, and after that only if the refresh token
 * is revoked or goes 60 days unused — the server renews itself otherwise.
 *
 *   npx -p @xeroapi/xero-mcp-server xero-auth   # inherits client id and scopes from
 *                                       # the existing token file
 *   XERO_CLIENT_ID=... npx -p @xeroapi/xero-mcp-server xero-auth    # first-time bootstrap
 *
 * Environment:
 *   XERO_CLIENT_ID   client id, if there is no token file to inherit from
 *   XERO_TOKEN_FILE  token file path (default: ./.xero-tokens.json)
 *   XERO_SCOPES      override the scopes to request
 *   XERO_AUTH_PORT   local callback port (default: 3333)
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";

import { writeTokenStore } from "../clients/xero-token-store.js";
import { openBrowser } from "./open-browser.js";
import {
  awaitCallback,
  buildAuthorizeUrl,
  createPkceChallenge,
  exchangeCodeForTokens,
  redirectUri,
  resolveAuthConfig,
} from "./pkce.js";

export async function main(): Promise<void> {
  const config = resolveAuthConfig(process.env, process.cwd());

  console.log(`Token file : ${config.tokenFile}`);
  console.log(`Client id  : ${config.clientId} (from ${config.sources.clientId})`);
  console.log(`Scopes     : from ${config.sources.scopes}`);
  console.log(config.scopes.split(/\s+/).map((s) => `  - ${s}`).join("\n"));
  console.log(`\nRedirect URI must be registered on the Xero app: ${redirectUri(config.port)}`);

  const challenge = createPkceChallenge();
  const authorizeUrl = buildAuthorizeUrl(config, challenge);

  const { code } = await awaitCallback(config.port, challenge.state, () => {
    console.log(`\nListening on ${redirectUri(config.port)}`);
    console.log("Opening Xero login in your browser...");
    // Always print it. The launcher cannot report failure usefully — and on a
    // headless or locked-down machine it silently does nothing, leaving the
    // command waiting for a callback the user has no way to trigger.
    console.log(`\nIf no browser opens, visit this URL to sign in:\n${authorizeUrl}\n`);
    openBrowser(authorizeUrl);
  });

  console.log("\nCallback received. Exchanging code for tokens...");
  const tokens = await exchangeCodeForTokens({
    code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    codeVerifier: challenge.verifier,
    port: config.port,
  });

  if (!tokens.refresh_token) {
    throw new Error(
      "Xero returned no refresh token — check that offline_access was requested.",
    );
  }

  writeTokenStore(config.tokenFile, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope ?? config.scopes,
    saved_at: new Date().toISOString(),
    client_id: config.clientId,
  });

  console.log(`\nTokens saved to ${config.tokenFile}`);
  console.log("Nothing to restart — the server reads this file on its next tool call.");
}

/**
 * Was this module run, rather than imported?
 *
 * Importing it must not start an auth flow, so that tooling can inspect it
 * without opening a browser. Comparing the raw argv path is not enough: npm
 * installs a bin as a symlink, so `npx xero-auth` runs with argv[1] pointing at
 * .bin/xero-auth while import.meta.url is the real file — the comparison fails
 * and the command exits silently having done nothing. Both sides are resolved
 * to a real path before comparing, and pathToFileURL handles paths that need
 * escaping.
 */
function invokedDirectly(metaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;

  try {
    return pathToFileURL(fs.realpathSync(entry)).href === metaUrl;
  } catch {
    // argv[1] does not resolve to a file; treat as not a direct run.
    return false;
  }
}

if (invokedDirectly(import.meta.url)) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

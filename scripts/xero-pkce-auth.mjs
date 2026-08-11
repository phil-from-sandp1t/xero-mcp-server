#!/usr/bin/env node
/**
 * Interactive Xero authorisation (OAuth 2.0 authorization code + PKCE).
 *
 * Bootstraps the token file that the server's refresh-token auth mode reads.
 * Run once per machine; after that the server renews access tokens on its own.
 *
 *   XERO_CLIENT_ID=<your app's client id> node scripts/xero-pkce-auth.mjs
 *
 * Environment:
 *   XERO_CLIENT_ID     required — client id of a Xero app with a redirect URI
 *                      of http://localhost:<port>/callback
 *   XERO_TOKEN_FILE    where to write tokens (default: ./.xero-tokens.json)
 *   XERO_SCOPES        space-separated scopes (default: the read/write set below)
 *   XERO_AUTH_PORT     local callback port (default: 3333)
 *
 * Re-run this only if the refresh token is revoked or goes unused for 60 days.
 */

import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";

const CLIENT_ID = process.env.XERO_CLIENT_ID;
const PORT = Number(process.env.XERO_AUTH_PORT || 3333);
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const TOKEN_FILE = path.resolve(
  process.env.XERO_TOKEN_FILE || path.join(process.cwd(), ".xero-tokens.json"),
);

const DEFAULT_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "accounting.transactions",
  "accounting.contacts",
  "accounting.settings",
  "accounting.reports.read",
].join(" ");

const SCOPES = process.env.XERO_SCOPES || DEFAULT_SCOPES;

if (!CLIENT_ID) {
  console.error("XERO_CLIENT_ID is not set.");
  process.exit(1);
}

if (!SCOPES.split(/\s+/).includes("offline_access")) {
  console.error(
    "XERO_SCOPES must include offline_access, otherwise Xero issues no refresh token.",
  );
  process.exit(1);
}

// ── PKCE ──────────────────────────────────────────────────────────────────────
const codeVerifier = crypto.randomBytes(64).toString("base64url");
const codeChallenge = crypto
  .createHash("sha256")
  .update(codeVerifier)
  .digest("base64url");
const state = crypto.randomBytes(16).toString("hex");

// ── Token exchange ────────────────────────────────────────────────────────────
function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: codeVerifier,
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "identity.xero.com",
        path: "/connect/token",
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) resolve(JSON.parse(data));
          else reject(new Error(`Token exchange failed (${res.statusCode}): ${data}`));
        });
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function saveTokens(tokens) {
  const data = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: Date.now() + tokens.expires_in * 1000,
    scope: tokens.scope,
    saved_at: new Date().toISOString(),
  };
  // Write-then-rename, matching the server's own token writes.
  const tmp = `${TOKEN_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, TOKEN_FILE);
  return data;
}

function openBrowser(url) {
  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  execFile(opener, [url], (err) => {
    if (err) console.log("\nOpen this URL in your browser:\n", url);
  });
}

// ── Flow ──────────────────────────────────────────────────────────────────────
const authUrl = new URL("https://login.xero.com/identity/connect/authorize");
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("state", state);
authUrl.searchParams.set("code_challenge", codeChallenge);
authUrl.searchParams.set("code_challenge_method", "S256");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== "/callback") {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const error = url.searchParams.get("error");
  if (error) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end(`<h2>Auth error: ${error}</h2>`);
    server.close();
    console.error("Auth error:", error, url.searchParams.get("error_description") || "");
    process.exitCode = 1;
    return;
  }

  if (url.searchParams.get("state") !== state) {
    res.writeHead(400, { "Content-Type": "text/html" });
    res.end("<h2>State mismatch. Possible CSRF. Try again.</h2>");
    server.close();
    process.exitCode = 1;
    return;
  }

  try {
    console.log("\nCallback received. Exchanging code for tokens...");
    const tokens = await exchangeCodeForTokens(url.searchParams.get("code"));
    if (!tokens.refresh_token) {
      throw new Error("Xero returned no refresh token — was offline_access requested?");
    }
    saveTokens(tokens);

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`
      <html><body style="font-family:sans-serif;max-width:520px;margin:60px auto;text-align:center">
        <h2>Xero authorisation complete</h2>
        <p>Tokens saved. Point the MCP server at this file with XERO_TOKEN_FILE.</p>
        <p style="color:#888;font-size:12px">You can close this tab.</p>
      </body></html>
    `);

    server.close();
    console.log(`\nTokens saved to ${TOKEN_FILE}`);
    console.log("Set XERO_TOKEN_FILE to that path, plus XERO_CLIENT_ID, and start the server.");
  } catch (err) {
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end(`<h2>Token exchange failed</h2><pre>${err.message}</pre>`);
    server.close();
    console.error("Token exchange error:", err.message);
    process.exitCode = 1;
  }
});

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log("Opening Xero login in your browser...\n");
  openBrowser(authUrl.toString());
});

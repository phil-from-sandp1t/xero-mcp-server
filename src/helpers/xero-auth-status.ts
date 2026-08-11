export type AuthMode = "refresh token" | "bearer token" | "custom connections";

export interface XeroAuthStatus {
  ok: boolean;
  mode: AuthMode;
  tokenFile?: string;
  /** Minutes until the stored access token expires; negative once past it. */
  expiresInMinutes?: number;
  scopes?: string[];
  /** Scopes this server would request on a fresh setup but which were not granted. */
  missingScopes?: string[];
  tenantId?: string;
  organisationName?: string;
  /** How the active organisation was chosen, when one is settled. */
  tenantSource?: string;
  /** Every organisation this authorisation reaches, not just the active one. */
  availableTenants?: string[];
  error?: string;
}

/** Mirrors the precedence used when constructing the client in xero-client.ts. */
export function currentAuthMode(env: NodeJS.ProcessEnv = process.env): AuthMode {
  if (env.XERO_TOKEN_FILE) return "refresh token";
  if (env.XERO_CLIENT_BEARER_TOKEN) return "bearer token";
  return "custom connections";
}

export function formatAuthStatus(status: XeroAuthStatus): string {
  const lines = [`Auth mode: ${status.mode}`];

  if (status.tokenFile) lines.push(`Token file: ${status.tokenFile}`);

  if (status.ok) {
    lines.push("Status: working");
    if (status.organisationName) {
      lines.push(
        `Organisation: ${status.organisationName}${status.tenantSource ? ` (chosen by: ${status.tenantSource})` : ""}`,
      );
    }
    if (status.tenantId) lines.push(`Tenant ID: ${status.tenantId}`);
    if (status.availableTenants && status.availableTenants.length > 1) {
      lines.push(
        `This authorisation reaches ${status.availableTenants.length} organisations: ${status.availableTenants.join(", ")}. Calls apply to the active one above; switch with select-xero-tenant.`,
      );
    }
    if (status.expiresInMinutes !== undefined) {
      lines.push(`Access token expires in: ${status.expiresInMinutes} minutes`);
      if (status.mode === "refresh token") {
        lines.push("The server renews this automatically; no action needed.");
      }
    }
    if (status.scopes?.length) {
      lines.push(`Scopes (${status.scopes.length}): ${status.scopes.join(", ")}`);
      lines.push(
        "Scopes were fixed when this connection was authorised. A call can fail for lack of scope (Xero: 403 / AuthorizationUnsuccessful) even though auth is working — that is a different problem from expiry, and time will not fix it.",
      );
    }

    if (status.missingScopes?.length) {
      lines.push(
        `Not granted (${status.missingScopes.length}): ${status.missingScopes.join(", ")}`,
      );
      lines.push(
        "Calls needing those will fail until the user re-authorises. Adding them means calling reauthorize-xero with the full desired list in `scopes`, since the request replaces rather than extends the granted set — and it needs the user to sign in.",
      );
    }

    return lines.join("\n");
  }

  lines.push("Status: NOT working");
  lines.push(`Error: ${status.error ?? "unknown"}`);
  lines.push(
    status.mode === "refresh token"
      ? "Fix: re-authorise with `npm run auth` in the server directory (or `npx xero-auth` if installed from npm) (it inherits the client id and scopes from the token file). Nothing needs restarting afterwards."
      : "Fix: check the credentials in the server's environment. Consider the refresh-token mode (XERO_TOKEN_FILE), which renews itself.",
  );
  return lines.join("\n");
}

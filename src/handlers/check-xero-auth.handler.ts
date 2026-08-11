import { FALLBACK_SCOPES } from "../auth/pkce.js";
import { xeroClient } from "../clients/xero-client.js";
import { explainUnresolved } from "../clients/tenant-selection.js";
import { readTokenStore } from "../clients/xero-token-store.js";
import { ensureError } from "../helpers/ensure-error.js";
import { XeroAuthStatus, currentAuthMode } from "../helpers/xero-auth-status.js";

/**
 * Report whether Xero access is currently working, and on what.
 *
 * Deliberately performs a real authenticate + organisation read rather than
 * only inspecting the token file: the point is to answer "will the next tool
 * call work", which a file alone cannot say.
 */
export async function checkXeroAuth(
  env: NodeJS.ProcessEnv = process.env,
): Promise<XeroAuthStatus> {
  const mode = currentAuthMode(env);
  const status: XeroAuthStatus = { ok: false, mode };

  const readExpiry = (file: string) => {
    const store = readTokenStore(file);
    if (store.expires_at) {
      status.expiresInMinutes = Math.round((store.expires_at - Date.now()) / 60000);
    }
    return store;
  };

  if (mode === "refresh token" && env.XERO_TOKEN_FILE) {
    status.tokenFile = env.XERO_TOKEN_FILE;
    try {
      const store = readExpiry(env.XERO_TOKEN_FILE);
      if (store.scope) {
        status.scopes = store.scope.split(/\s+/);
        // Surface the gap here rather than leaving it to be discovered as a
        // confusing 403 in the middle of unrelated work.
        status.missingScopes = FALLBACK_SCOPES.split(/\s+/).filter(
          (scope) => !status.scopes?.includes(scope),
        );
      }
    } catch (error) {
      status.error = ensureError(error).message;
      return status;
    }
  }

  try {
    // Renews the access token first if it is close to expiry.
    await xeroClient.authenticate();

    // Non-throwing views throughout: an ambiguous connection is exactly what
    // this tool exists to report, so it must not fail on one.
    const tenants = await xeroClient.listTenants();
    status.availableTenants = tenants.map((t) => t.tenantName ?? t.tenantId);

    const active = xeroClient.activeTenant;
    if (!active) {
      // The credentials work — the target does not. Kept distinct so the
      // remedy offered is selecting an organisation, not re-authorising.
      status.needsTenantSelection = true;
      status.error = explainUnresolved(xeroClient.tenantResolution);
      return status;
    }

    status.tenantId = active.tenantId;
    status.tenantSource =
      xeroClient.tenantResolution?.kind === "resolved"
        ? xeroClient.tenantResolution.source
        : undefined;

    const response = await xeroClient.accountingApi.getOrganisations(
      active.tenantId,
    );
    status.organisationName = response.body.organisations?.[0]?.name;
    status.ok = true;

    if (status.tokenFile) {
      // authenticate() may have refreshed; re-read so the figure reported is
      // the one a caller would see now, not the one from before the renewal.
      readExpiry(status.tokenFile);
    }
  } catch (error) {
    status.error = ensureError(error).message;
  }

  return status;
}

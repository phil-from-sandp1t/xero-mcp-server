import axios, { AxiosError } from "axios";
import dotenv from "dotenv";
import {
  IXeroClientConfig,
  Organisation,
  TokenSet,
  XeroClient,
} from "xero-node";

import { ensureError } from "../helpers/ensure-error.js";
import { singleFlight } from "../helpers/single-flight.js";
import {
  TenantResolution,
  XeroTenantSummary,
  explainUnresolved,
  resolveTenant,
} from "./tenant-selection.js";
import {
  applyTokenResponse,
  isExpiring,
  isInvalidGrant,
  readTokenStore,
  refreshTokenSet,
  resolveClientId,
  writeTokenStore,
  XeroTokenStore,
} from "./xero-token-store.js";

dotenv.config();

/** Grace for another process's rotation to reach disk before giving up. */
const ROTATION_SETTLE_MS = 250;

const client_id = process.env.XERO_CLIENT_ID;
const client_secret = process.env.XERO_CLIENT_SECRET;
const bearer_token = process.env.XERO_CLIENT_BEARER_TOKEN;
const token_file = process.env.XERO_TOKEN_FILE;
const grant_type = "client_credentials";

if (!token_file && !bearer_token && (!client_id || !client_secret)) {
  throw Error("Environment Variables not set - please check your .env file");
}

abstract class MCPXeroClient extends XeroClient {
  private shortCode: string;

  /** Settled organisation, or "" while unresolved. */
  private resolvedTenantId = "";
  private resolution?: TenantResolution;
  /** Runtime choice via select-xero-tenant; outranks XERO_TENANT_ID. */
  private selectedTenant?: string;
  /**
   * Organisations this connection reaches.
   *
   * Held here rather than read from the base class's `tenants`, because
   * custom connections never populate that: they read /connections directly
   * and would otherwise have no tenant list to list from or select against.
   */
  private knownTenants: XeroTenantSummary[] = [];

  protected constructor(config?: IXeroClientConfig) {
    super(config);
    this.shortCode = "";
  }

  public abstract authenticate(): Promise<void>;

  /**
   * Throws rather than returning a guess. Every handler reads this before a
   * call, so an ambiguous connection fails with an explanation instead of
   * quietly operating on whichever organisation Xero happened to list first.
   */
  public get tenantId(): string {
    if (!this.resolvedTenantId) {
      throw new Error(explainUnresolved(this.resolution));
    }
    return this.resolvedTenantId;
  }

  public set tenantId(tenantId: string) {
    this.resolvedTenantId = tenantId;
  }

  /** Non-throwing view, for diagnostics that must report rather than fail. */
  public get activeTenant(): XeroTenantSummary | undefined {
    return this.resolution?.kind === "resolved" ? this.resolution.tenant : undefined;
  }

  public get tenantResolution(): TenantResolution | undefined {
    return this.resolution;
  }

  public get tenantPreference(): string | undefined {
    return this.selectedTenant ?? process.env.XERO_TENANT_ID;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  override async updateTenants(fullOrgDetails?: boolean): Promise<any[]> {
    await super.updateTenants(fullOrgDetails);
    this.setKnownTenants(this.tenants ?? []);
    return this.tenants;
  }

  /**
   * Record the reachable organisations and re-apply any preference.
   * Called from both auth paths, since only one of them goes through
   * updateTenants().
   */
  protected setKnownTenants(
    tenants: { tenantId: string; tenantName?: string; tenantType?: string }[],
  ): void {
    this.knownTenants = tenants.map((t) => ({
      tenantId: t.tenantId,
      tenantName: t.tenantName,
      tenantType: t.tenantType,
    }));
    this.applyTenantPreference();
  }

  private applyTenantPreference(): void {
    let resolution: TenantResolution;
    try {
      resolution = resolveTenant(
        this.knownTenants,
        this.tenantPreference,
        this.selectedTenant ? "selection" : "environment",
      );
    } catch (error) {
      // A bad preference must not break authentication itself — otherwise
      // list-xero-tenants, the tool that shows the valid options, is disabled
      // by the very setting the user needs to correct.
      resolution = {
        kind: "preference-error",
        message: ensureError(error).message,
      };
    }

    this.setResolution(resolution);
  }

  /**
   * The single place the active organisation changes.
   *
   * Organisation-scoped caches are cleared here, keyed off the change itself
   * rather than off the callers that can cause one — authentication, an
   * explicit selection, and invalidation can all move it, and remembering to
   * clear at each site is exactly how a stale short code survives into deep
   * links pointing at another company.
   */
  private setResolution(resolution?: TenantResolution): void {
    const previous = this.resolvedTenantId;

    this.resolution = resolution;
    this.resolvedTenantId =
      resolution?.kind === "resolved" ? resolution.tenant.tenantId : "";

    if (this.resolvedTenantId !== previous) {
      this.clearOrganisationScopedState();
    }
  }

  /**
   * Organisations this authorisation can reach, re-read from Xero.
   *
   * Deliberately not cached: re-authorising can add or remove granted
   * organisations without restarting the server, so a cached list would report
   * access that no longer exists — or hide access that now does.
   */
  public async listTenants(): Promise<XeroTenantSummary[]> {
    await this.authenticate();
    return [...this.knownTenants];
  }

  /**
   * Drop what is known about organisations, so the next call re-reads them.
   * Called after re-authorisation, where the granted set may have changed.
   */
  public invalidateTenants(): void {
    this.knownTenants = [];
    this.setResolution(undefined);
    // Unconditional, unlike the change-keyed clearing in setResolution: after
    // invalidation the active organisation is unknown rather than unchanged,
    // so nothing scoped to it can still be trusted.
    this.clearOrganisationScopedState();
  }

  /**
   * Anything cached about the *current* organisation, cleared whenever the
   * active organisation can change. Keeping this in one place is the point:
   * the short code is used to build Xero deep links, and a stale one sends
   * people to a different company's records while every other value is right.
   */
  private clearOrganisationScopedState(): void {
    this.shortCode = "";
  }

  /**
   * Point this server at an organisation for the rest of the process.
   * Throws UnknownTenantError if the token cannot reach it.
   */
  public async selectTenant(preference: string): Promise<XeroTenantSummary> {
    const available = await this.listTenants();

    // Resolve before storing, so a bad preference cannot strand the server.
    const resolution = resolveTenant(available, preference, "selection");
    if (resolution.kind !== "resolved") {
      throw new Error(explainUnresolved(resolution));
    }

    this.selectedTenant = preference;
    this.setResolution(resolution);

    return resolution.tenant;
  }

  private async getOrganisation(): Promise<Organisation> {
    await this.authenticate();

    const organisationResponse = await this.accountingApi.getOrganisations(
      this.tenantId || "",
    );

    const organisation = organisationResponse.body.organisations?.[0];

    if (!organisation) {
      throw new Error("Failed to retrieve organisation");
    }

    return organisation;
  }

  public async getShortCode(): Promise<string | undefined> {
    if (!this.shortCode) {
      try {
        const organisation = await this.getOrganisation();
        this.shortCode = organisation.shortCode ?? "";
      } catch (error: unknown) {
        const err = ensureError(error);

        throw new Error(
          `Failed to get Organisation short code: ${err.message}`,
        );
      }
    }
    return this.shortCode;
  }
}

class CustomConnectionsXeroClient extends MCPXeroClient {
  private readonly clientId: string;
  private readonly clientSecret: string;

  // Legacy scopes (deprecated but still supported for existing apps)
  private readonly XERO_DEFAULT_AUTH_SCOPES_V1 = [
    "accounting.transactions",
    "accounting.contacts",
    "accounting.settings",
    "accounting.reports.read",
    "payroll.settings",
    "payroll.employees",
    "payroll.timesheets",
  ].join(" ");

  // Granular scopes (required for new apps)
  private readonly XERO_DEFAULT_AUTH_SCOPES_V2 = [
    "accounting.invoices",
    "accounting.payments",
    "accounting.banktransactions",
    "accounting.manualjournals",
    "accounting.reports.aged.read",
    "accounting.reports.balancesheet.read",
    "accounting.reports.profitandloss.read",
    "accounting.reports.trialbalance.read",
    "accounting.contacts",
    "accounting.settings",
    "payroll.settings",
    "payroll.employees",
    "payroll.timesheets",
  ].join(" ");

  constructor(config: {
    clientId: string;
    clientSecret: string;
    grantType: string;
  }) {
    super(config);
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
  }

  private formatTokenError(error: unknown, context: string): Error {
    const axiosError = error as AxiosError;
    const data = axiosError.response?.data;
    const message =
      typeof data === "object" ? JSON.stringify(data) : data || axiosError.message;
    return new Error(`Failed to get Xero token${context}: ${message}`);
  }

  public async getClientCredentialsToken(): Promise<TokenSet> {
    // If XERO_SCOPES is set, use that
    if (process.env.XERO_SCOPES) {                                                                                                                                                     
      try {
        return await this.requestToken(process.env.XERO_SCOPES);
      } catch (envError) {
        throw this.formatTokenError(envError, " with XERO_SCOPES");
      }
    }

    // Else if XERO_SCOPES is not set, try V1 scopes first (for existing apps), fallback to V2 scopes (for new apps) only on invalid_scope error
    try {
      return await this.requestToken(this.XERO_DEFAULT_AUTH_SCOPES_V1);
    } catch (error) {
      const axiosError = error as AxiosError;
      const isInvalidScope =
        axiosError.response?.status === 400 &&
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (axiosError.response?.data as any)?.error === "invalid_scope";

      if (!isInvalidScope) {
        throw this.formatTokenError(error, " with V1 scopes");
      }

      try {
        return await this.requestToken(this.XERO_DEFAULT_AUTH_SCOPES_V2);
      } catch (v2Error) {
        throw this.formatTokenError(v2Error, " with V2 scopes");
      }
    }
  }

  private async requestToken(scope: string): Promise<TokenSet> {
    const credentials = Buffer.from(
      `${this.clientId}:${this.clientSecret}`,
    ).toString("base64");

    const response = await axios.post(
      "https://identity.xero.com/connect/token",
      `grant_type=client_credentials&scope=${encodeURIComponent(scope)}`,
      {
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
      },
    );

    // Get the tenant ID from the connections endpoint
    const token = response.data.access_token;
    const connectionsResponse = await axios.get(
      "https://api.xero.com/connections",
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
    );

    // Custom connections never go through updateTenants(), so this is the only
    // place their organisations become known. Record them all and apply the
    // preference, rather than taking the first — otherwise tenant listing and
    // selection are dead in this mode, and XERO_TENANT_ID is ignored.
    this.setKnownTenants(connectionsResponse.data ?? []);

    return response.data;
  }

  public async authenticate() {
    const tokenResponse = await this.getClientCredentialsToken();

    this.setTokenSet({
      access_token: tokenResponse.access_token,
      expires_in: tokenResponse.expires_in,
      token_type: tokenResponse.token_type,
    });
  }
}

class BearerTokenXeroClient extends MCPXeroClient {
  private readonly bearerToken: string;

  constructor(config: { bearerToken: string }) {
    super();
    this.bearerToken = config.bearerToken;
  }

  async authenticate(): Promise<void> {
    this.setTokenSet({
      access_token: this.bearerToken,
    });

    await this.updateTenants();
  }
}

/**
 * Refresh-token auth, for apps authorised interactively (authorization code +
 * PKCE) rather than through a Custom Connection.
 *
 * A bearer token lasts 30 minutes, which is shorter than a working session, so
 * XERO_CLIENT_BEARER_TOKEN alone means the server goes dead part-way through.
 * This client instead reads a token file, and renews the access token from the
 * stored refresh token whenever it is close to expiry. Every tool handler calls
 * authenticate() before its request, so the check happens per call and the
 * server stays usable indefinitely without a restart.
 */
class RefreshTokenXeroClient extends MCPXeroClient {
  /**
   * From the environment only, and optional: the token file records the client
   * id it was authorised with. Resolved when a token is actually needed rather
   * than at construction, so a missing or older token file cannot stop the
   * server starting — the tools that diagnose and repair that state have to be
   * reachable while it is broken.
   */
  private readonly envClientId?: string;
  private readonly clientSecret?: string;
  private readonly tokenFile: string;

  constructor(config: {
    clientId?: string;
    clientSecret?: string;
    tokenFile: string;
  }) {
    super();
    this.envClientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.tokenFile = config.tokenFile;
  }

  private async refreshAndPersist(store: XeroTokenStore): Promise<XeroTokenStore> {
    // Resolve now, from the store already in hand — no second file read, and
    // the failure surfaces as a tool error rather than a dead server.
    const clientId = resolveClientId(this.envClientId, this.tokenFile, () => store);

    const response = await refreshTokenSet({
      clientId,
      clientSecret: this.clientSecret,
      refreshToken: store.refresh_token,
    });

    // Stamp the client id if the file predates it, so re-authorisation can
    // inherit it instead of asking for it again.
    const updated = { ...applyTokenResponse(store, response), client_id: clientId };
    writeTokenStore(this.tokenFile, updated);
    return updated;
  }

  /**
   * One refresh at a time. Two concurrent tool calls would otherwise send the
   * same refresh token: Xero rotates on first use, so the second is rejected
   * as invalid_grant and reads as a dead credential when nothing is wrong.
   */
  private readonly refreshOnce = singleFlight(async () => {
    // Re-read inside the flight: a queued caller must not act on the token it
    // saw before the winner rotated it.
    const store = readTokenStore(this.tokenFile);
    if (!isExpiring(store)) return store;
    return this.refreshTolerantly(store);
  });

  private async currentStore(): Promise<XeroTokenStore> {
    // Read every time rather than trusting the cache: another process sharing
    // this token file (a second MCP client, the bootstrap script) may have
    // rotated the refresh token since the last call.
    const onDisk = readTokenStore(this.tokenFile);

    if (!isExpiring(onDisk)) {
      return onDisk;
    }

    // Concurrent callers share one refresh rather than each sending the same
    // refresh token, which Xero would reject after the first use.
    return this.refreshOnce();
  }

  /**
   * Refresh, tolerating a rotation performed by another process.
   *
   * invalid_grant means this refresh token has already been used. That is a
   * dead credential only if nobody else rotated it — so re-read before
   * concluding it, and once more after a short pause, since the winner's write
   * may not have landed when the rejection arrived.
   */
  private async refreshTolerantly(onDisk: XeroTokenStore): Promise<XeroTokenStore> {
    try {
      return await this.refreshAndPersist(onDisk);
    } catch (error) {
      if (!isInvalidGrant(error)) throw error;

      for (const waitMs of [0, ROTATION_SETTLE_MS]) {
        if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));

        const reread = readTokenStore(this.tokenFile);
        if (reread.refresh_token !== onDisk.refresh_token) {
          return isExpiring(reread) ? this.refreshAndPersist(reread) : reread;
        }
      }

      throw new Error(
        `Xero refresh token was rejected. Re-authorise with 'npm run auth' in the server directory (or 'npx -p @xeroapi/xero-mcp-server xero-auth' if installed from npm)`,
      );
    }
  }

  async authenticate(): Promise<void> {
    const store = await this.currentStore();

    this.setTokenSet({
      access_token: store.access_token,
      refresh_token: store.refresh_token,
    });

    await this.updateTenants();
  }
}

export const xeroClient = token_file
  ? new RefreshTokenXeroClient({
      // Falls back to the client id recorded in the token file, so a server can
      // be configured with XERO_TOKEN_FILE alone.
      clientId: client_id,
      clientSecret: client_secret,
      tokenFile: token_file,
    })
  : bearer_token
    ? new BearerTokenXeroClient({
        bearerToken: bearer_token,
      })
    : new CustomConnectionsXeroClient({
        clientId: client_id!,
        clientSecret: client_secret!,
        grantType: grant_type,
      });

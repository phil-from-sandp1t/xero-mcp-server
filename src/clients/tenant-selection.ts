/**
 * Choosing which Xero organisation a call applies to.
 *
 * One authorisation can cover several organisations, and Xero does not promise
 * an order for them. Picking the first connection is therefore a coin toss
 * between ledgers — the kind of mistake that produces a plausible-looking
 * invoice in the wrong company. This module makes the choice explicit and
 * refuses to guess.
 */

export interface XeroTenantSummary {
  tenantId: string;
  tenantName?: string;
  tenantType?: string;
}

export type TenantResolution =
  | { kind: "resolved"; tenant: XeroTenantSummary; source: TenantSource }
  /** Several organisations and nothing to choose between them. */
  | { kind: "ambiguous"; tenants: XeroTenantSummary[] }
  /** The authorisation reaches no organisations at all. */
  | { kind: "none" };

export type TenantSource = "selection" | "environment" | "only organisation";

/** Raised for a preference that names an organisation the token cannot reach. */
export class UnknownTenantError extends Error {
  constructor(preference: string, tenants: XeroTenantSummary[]) {
    super(
      `No Xero organisation matches "${preference}". This connection reaches: ${describeTenants(tenants)}.`,
    );
    this.name = "UnknownTenantError";
  }
}

export function describeTenants(tenants: XeroTenantSummary[]): string {
  if (tenants.length === 0) return "(none)";
  return tenants
    .map((t) => `${t.tenantName ?? "(unnamed)"} [${t.tenantId}]`)
    .join(", ");
}

/**
 * Match a preference against the reachable organisations.
 *
 * Accepts either a tenant id or an organisation name, because a person
 * configuring this has the name to hand and a uuid is easy to transpose.
 */
export function resolveTenant(
  tenants: XeroTenantSummary[],
  preference?: string,
  source: TenantSource = "environment",
): TenantResolution {
  if (tenants.length === 0) return { kind: "none" };

  const wanted = preference?.trim();
  if (wanted) {
    const match =
      tenants.find((t) => t.tenantId === wanted) ??
      tenants.find(
        (t) => t.tenantName?.toLowerCase() === wanted.toLowerCase(),
      );

    if (!match) throw new UnknownTenantError(wanted, tenants);
    return { kind: "resolved", tenant: match, source };
  }

  if (tenants.length === 1) {
    return { kind: "resolved", tenant: tenants[0], source: "only organisation" };
  }

  return { kind: "ambiguous", tenants };
}

/**
 * What to tell a caller that needs a tenant when none is settled. Deliberately
 * actionable: the failure is a configuration gap, not a transient error.
 */
export function explainUnresolved(resolution: TenantResolution | undefined): string {
  if (!resolution) {
    return "Xero organisation not determined yet — authenticate before making a call.";
  }

  if (resolution.kind === "none") {
    return "This Xero authorisation reaches no organisations. Re-authorise and grant access to at least one, then try again.";
  }

  if (resolution.kind === "ambiguous") {
    return [
      `This Xero authorisation reaches ${resolution.tenants.length} organisations, so the target is ambiguous: ${describeTenants(resolution.tenants)}.`,
      "Refusing to guess, because picking the wrong one would write to the wrong ledger.",
      "Choose with the select-xero-tenant tool, or pin the server with XERO_TENANT_ID (organisation name or tenant id).",
    ].join(" ");
  }

  return "Xero organisation not determined.";
}

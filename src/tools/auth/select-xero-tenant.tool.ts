import { z } from "zod";

import { xeroClient } from "../../clients/xero-client.js";
import { ensureError } from "../../helpers/ensure-error.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const SelectXeroTenantTool = CreateXeroTool(
  "select-xero-tenant",
  `Choose which Xero organisation subsequent calls apply to, by name or tenant id.
Needed when the connection reaches more than one organisation, where the server refuses to guess.
The choice lasts for the life of the server process and affects every caller using it, so confirm the organisation with the user before switching if any doubt exists. Use list-xero-tenants to see the options.`,
  {
    tenant: z
      .string()
      .min(1)
      .describe(
        "Organisation name (as shown by list-xero-tenants) or its tenant id.",
      ),
  },
  async (params: { tenant: string }) => {
    try {
      const selected = await xeroClient.selectTenant(params.tenant);
      return {
        content: [
          {
            type: "text" as const,
            text: [
              `Xero calls now apply to: ${selected.tenantName ?? "(unnamed)"}`,
              `Tenant ID: ${selected.tenantId}`,
              "This holds for the life of the server process, and for every caller using this server.",
            ].join("\n"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Could not select that organisation: ${ensureError(error).message}`,
          },
        ],
      };
    }
  },
);

export default SelectXeroTenantTool;

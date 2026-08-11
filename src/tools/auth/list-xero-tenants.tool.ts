import { xeroClient } from "../../clients/xero-client.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";

const ListXeroTenantsTool = CreateXeroTool(
  "list-xero-tenants",
  `List the Xero organisations this connection can reach.
One authorisation may cover several organisations. Use this to see which are available and which one calls currently apply to, then select-xero-tenant to switch.`,
  {},
  async () => {
    const tenants = await xeroClient.listTenants();
    const active = xeroClient.activeTenant;

    if (tenants.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "This Xero authorisation reaches no organisations. Re-authorise and grant access to at least one.",
          },
        ],
      };
    }

    const lines = tenants.map((t) => {
      const marker = t.tenantId === active?.tenantId ? "  <- active" : "";
      return `- ${t.tenantName ?? "(unnamed)"} [${t.tenantId}]${t.tenantType ? ` (${t.tenantType})` : ""}${marker}`;
    });

    if (!active) {
      lines.push(
        "",
        "No organisation is active: with more than one reachable, the target must be chosen explicitly. Calls will fail until you select one with select-xero-tenant, or the server is pinned with XERO_TENANT_ID.",
      );
    }

    return {
      content: [
        {
          type: "text" as const,
          text: [`Xero organisations (${tenants.length}):`, ...lines].join("\n"),
        },
      ],
    };
  },
);

export default ListXeroTenantsTool;

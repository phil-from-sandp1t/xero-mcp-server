import { checkXeroAuth } from "../../handlers/check-xero-auth.handler.js";
import { CreateXeroTool } from "../../helpers/create-xero-tool.js";
import { formatAuthStatus } from "../../helpers/xero-auth-status.js";

const CheckAuthTool = CreateXeroTool(
  "check-xero-auth",
  `Check whether Xero authentication is currently working.
Reports the auth mode, the connected organisation, how long the access token is still valid, and the granted scopes.
Use this to diagnose a Xero call that failed with an authentication error, before asking the user to do anything.`,
  {},
  async () => {
    const status = await checkXeroAuth();
    return {
      content: [{ type: "text" as const, text: formatAuthStatus(status) }],
    };
  },
);

export default CheckAuthTool;

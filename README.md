# Xero MCP Server

This is a Model Context Protocol (MCP) server implementation for Xero. It provides a bridge between the MCP protocol and Xero's API, allowing for standardized access to Xero's accounting and business features.

## Features

- Xero OAuth2 authentication with custom connections
- Contact management
- Chart of Accounts management
- Invoice creation and management
- MCP protocol compliance

## Prerequisites

- Node.js (v18 or higher)
- npm or pnpm
- A Xero developer account with API credentials

## Docs and Links

- [Xero Public API Documentation](https://developer.xero.com/documentation/api/)
- [Xero API Explorer](https://api-explorer.xero.com/)
- [Xero OpenAPI Specs](https://github.com/XeroAPI/Xero-OpenAPI)
- [Xero-Node Public API SDK Docs](https://xeroapi.github.io/xero-node/accounting)
- [Developer Documentation](https://developer.xero.com/)

## Setup

### Create a Xero Account

If you don't already have a Xero account and organisation already, can create one by signing up [here](https://www.xero.com/au/signup/) using the free trial.

We recommend using a Demo Company to start with because it comes with some pre-loaded sample data. Once you are logged in, switch to it by using the top left-hand dropdown and selecting "Demo Company". You can reset the data on a Demo Company, or change the country, at any time by using the top left-hand dropdown and navigating to [My Xero](https://my.xero.com).

NOTE: To use Payroll-specific queries, the region should be either NZ or UK.

### Authentication

There are 2 modes of authentication supported in the Xero MCP server:

#### 1. Custom Connections

This is a better choice for testing and development which allows you to specify client id and secrets for a specific organisation.
It is also the recommended approach if you are integrating this into 3rd party MCP clients such as Claude Desktop.

##### Configuring your Xero Developer account

Set up a Custom Connection following these instructions: https://developer.xero.com/documentation/guides/oauth2/custom-connections/

##### Required Scopes

Custom connections require different scopes depending on when they were created. **All scopes in the relevant list must be added to your custom connection:**

| Custom Connection Created | Required Scopes |
|---------------------------|-----------------|
| Before Apr 29, 2026 | [SCOPES_V1](src/clients/xero-client.ts#L82-L90) (bundled permissions) |
| From Apr 29, 2026 | [SCOPES_V2](src/clients/xero-client.ts#L93-L112) (granular permissions) |

> **Note:** The MCP server automatically tries V1 scopes first and falls back to V2 if needed.
> 
> You can override these by setting the `XERO_SCOPES` environment variable to a space-separated list of scopes.

##### Integrating the MCP server with Claude Desktop

To add the MCP server to Claude go to Settings > Developer > Edit config and add the following to your claude_desktop_config.json file:

```json
{
  "mcpServers": {
    "xero": {
      "command": "npx",
      "args": ["-y", "@xeroapi/xero-mcp-server@latest"],
      "env": {
        "XERO_CLIENT_ID": "your_client_id_here",
        "XERO_CLIENT_SECRET": "your_client_secret_here",
        "XERO_SCOPES": "accounting.invoices accounting.contacts accounting.settings"
      }
    }
  }
}
```

The `XERO_SCOPES` variable is optional. If omitted, the default scopes listed above will be used.

NOTE: If you are using [Node Version Manager](https://github.com/nvm-sh/nvm) `"command": "npx"` section change it to be the full path to the executable, ie: `your_home_directory/.nvm/versions/node/v22.14.0/bin/npx` on Mac / Linux or `"your_home_directory\\.nvm\\versions\\node\\v22.14.0\\bin\\npx"` on Windows

#### 2. Bearer Token

This is a better choice if you are to support multiple Xero accounts at runtime and allow the MCP client to execute an auth flow (such as PKCE) as required.
In this case, use the following configuration:

```json
{
  "mcpServers": {
    "xero": {
      "command": "npx",
      "args": ["-y", "@xeroapi/xero-mcp-server@latest"],
      "env": {
        "XERO_CLIENT_BEARER_TOKEN": "your_bearer_token"
      }
    }
  }
}
```

NOTE: The `XERO_CLIENT_BEARER_TOKEN` will take precedence over the `XERO_CLIENT_ID` if defined.

##### Required Scopes for Bearer Token

When obtaining a bearer token, you must request the appropriate scopes. The scopes you request should be:

> **Note:** Some scopes are being deprecated in favour of more granular scopes. See the [Xero OAuth 2.0 Scopes documentation](https://developer.xero.com/documentation/guides/oauth2/scopes/) for details on deprecation timelines.

```
accounting.transactions (Deprecated)
accounting.transactions.read (Deprecated)
accounting.invoices
accounting.invoices.read
accounting.payments
accounting.payments.read
accounting.banktransactions
accounting.banktransactions.read
accounting.manualjournals
accounting.manualjournals.read
accounting.reports.read (Deprecated)
accounting.reports.aged.read
accounting.reports.balancesheet.read
accounting.reports.profitandloss.read
accounting.reports.trialbalance.read
accounting.contacts 
accounting.settings 
payroll.settings 
payroll.employees 
payroll.timesheets
```

#### 3. Refresh Token

> Added in this fork.

A Xero access token lasts 30 minutes, which is shorter than a typical working session, so
`XERO_CLIENT_BEARER_TOKEN` leaves the server dead part-way through and needing a restart.

This mode points the server at a token file instead. It renews the access token from the stored
refresh token whenever the token is within 10 minutes of expiry, writes the rotated tokens back, and
carries on — no restart, no reconnect. The check runs before every tool call, so a server left idle
overnight still works in the morning. Use it when you authorised your app interactively
(authorization code + PKCE) rather than through a Custom Connection.

Authorise once to create the token file:

```bash
# from a clone of this repo
XERO_CLIENT_ID=your_client_id XERO_TOKEN_FILE=~/.xero-tokens.json npm run auth

# or, with the package installed from npm
XERO_CLIENT_ID=your_client_id XERO_TOKEN_FILE=~/.xero-tokens.json npx xero-auth
```

That opens Xero in your browser, catches the callback on `http://localhost:3333/callback` (add that
as a redirect URI on your Xero app), and writes the token file with mode `0600`. Include
`offline_access` in your scopes or Xero issues no refresh token; the command refuses to continue
without it.

To re-authorise later, the same command needs no other arguments:

```bash
XERO_TOKEN_FILE=~/.xero-tokens.json npm run auth
```

It inherits the client id and the exact scope list from the existing token file, so re-authorising
reproduces the access you already had rather than silently substituting defaults.

That cuts both ways: **inheritance cannot widen access.** To add a scope, name the full list you
want — the existing one plus the addition — because the request replaces rather than extends:

```bash
XERO_TOKEN_FILE=~/.xero-tokens.json \
XERO_SCOPES="openid profile email offline_access accounting.settings accounting.reports.taxreports.read" \
npm run auth
```

With no token file at all, the command needs `XERO_CLIENT_ID` once (from the Xero developer portal,
under your app's configuration) and falls back to a granular default scope set.

For a **confidential** app, also set `XERO_CLIENT_SECRET`: it is sent as basic auth on both the
authorization-code exchange and every later refresh, never in a request body, and never written to
the token file. A public PKCE app leaves it unset.

Then configure the server:

```json
{
  "mcpServers": {
    "xero": {
      "command": "npx",
      "args": ["-y", "@xeroapi/xero-mcp-server@latest"],
      "env": {
        "XERO_TOKEN_FILE": "/absolute/path/to/.xero-tokens.json"
      }
    }
  }
}
```

`XERO_CLIENT_ID` is optional: the token file records the client id it was authorised with, so the
server reads it from there. Set it only to override, or if the token file predates that recording.

`XERO_CLIENT_SECRET` is also optional: set it for a confidential app (sent as basic auth), leave it
unset for a public PKCE app (the client id goes in the request body instead).

Precedence between the three modes is `XERO_TOKEN_FILE`, then `XERO_CLIENT_BEARER_TOKEN`, then
Custom Connections.

##### Using it with Claude Code

```bash
claude mcp add xero -s user \
  -e XERO_TOKEN_FILE=/absolute/path/to/.xero-tokens.json \
  -- node /absolute/path/to/xero-mcp-server/dist/index.js
```

Re-authorise only if the refresh token is revoked, or goes 60 days unused.

##### Working with more than one organisation

> Added in this fork.

A single Xero authorisation can cover several organisations — the user picks which ones to grant
during consent, and one refresh token then reaches them all.

Upstream resolves this by taking the first connection Xero returns. Xero does not promise an order,
so with more than one organisation that is a coin toss between ledgers, and a write landing in the
wrong company looks entirely normal in the response.

This fork refuses to guess. With one organisation, nothing changes and it is used automatically.
With several, calls fail with an explanation until an organisation is chosen:

- **`XERO_TENANT_ID`** — pin a server to one organisation, by name or tenant id. Best when the
  organisation is known in advance: run one server per organisation (`xero-acme`, `xero-widgets`)
  and there is nothing to get wrong at call time.
- **`list-xero-tenants` tool** — show which organisations the connection reaches, and which is
  active.
- **`select-xero-tenant` tool** — switch at runtime, by name or tenant id. The choice lasts for the
  life of the server process and applies to every caller using it, so it is the weaker option when
  several sessions share one server.

A preference naming an organisation the token cannot reach is an error, never a fallback: being
handed one organisation after asking for another is exactly the failure this prevents.

##### Checking and repairing auth

These ship with the server, so nothing has to be installed client-side:

- **`check-xero-auth` tool** — reports the auth mode, connected organisation, remaining token life
  and granted scopes. An agent that hits an authentication error can call this and diagnose itself
  instead of handing the problem back to you.
- **`reauthorize-xero` tool** — runs the interactive login and replaces the stored tokens, without
  anyone touching a terminal. It returns as soon as the sign-in URL is ready rather than blocking
  for as long as a person takes to log in; call it again afterwards to collect the result. Client
  id and scopes are inherited from the existing token file, so re-authorising cannot change the
  access granted.
- **`reauthorize` prompt** — the same flow as a user-invoked command where clients support prompts
  (in Claude Code, `/mcp__<servername>__reauthorize`). Prompts are a separate surface from tools:
  they appear in a command or composer menu, never in the tool list. The prompt only drives the
  tools above, so nothing depends on a client exposing it.

### Available MCP Commands

- `list-accounts`: Retrieve a list of accounts
- `list-contacts`: Retrieve a list of contacts from Xero
- `list-credit-notes`: Retrieve a list of credit notes
- `list-invoices`: Retrieve a list of invoices
- `list-items`: Retrieve a list of items
- `list-manual-journals`: Retrieve a list of manual journals
- `list-organisation-details`: Retrieve details about an organisation
- `list-profit-and-loss`: Retrieve a profit and loss report
- `list-quotes`: Retrieve a list of quotes
- `list-tax-rates`: Retrieve a list of tax rates
- `list-payments`: Retrieve a list of payments
- `list-trial-balance`: Retrieve a trial balance report
- `list-bank-transactions`: Retrieve a list of bank account transactions
- `list-payroll-employees`: Retrieve a list of Payroll Employees
- `list-report-balance-sheet`: Retrieve a balance sheet report
- `list-payroll-employee-leave`: Retrieve a Payroll Employee's leave records
- `list-payroll-employee-leave-balances`: Retrieve a Payroll Employee's leave balances
- `list-payroll-employee-leave-types`: Retrieve a list of Payroll leave types
- `list-payroll-leave-periods`: Retrieve a list of a Payroll Employee's leave periods
- `list-payroll-leave-types`: Retrieve a list of all available leave types in Xero Payroll
- `list-timesheets`: Retrieve a list of Payroll Timesheets
- `list-aged-receivables-by-contact`: Retrieves aged receivables for a contact
- `list-aged-payables-by-contact`: Retrieves aged payables for a contact
- `list-contact-groups`: Retrieve a list of contact groups
- `list-tracking-categories`: Retrieve a list of tracking categories
- `create-bank-transaction`: Create a new bank transaction
- `create-contact`: Create a new contact
- `create-credit-note`: Create a new credit note
- `create-invoice`: Create a new invoice
- `create-item`: Create a new item
- `create-manual-journal`: Create a new manual journal
- `create-payment`: Create a new payment
- `create-quote`: Create a new quote
- `create-payroll-timesheet`: Create a new Payroll Timesheet
- `create-tracking-category`: Create a new tracking category
- `create-tracking-option`: Create a new tracking option
- `update-bank-transaction`: Update an existing bank transaction
- `update-contact`: Update an existing contact
- `update-invoice`: Update an existing draft invoice
- `update-item`: Update an existing item
- `update-manual-journal`: Update an existing manual journal
- `update-quote`: Update an existing draft quote
- `update-credit-note`: Update an existing draft credit note
- `update-tracking-category`: Update an existing tracking category
- `update-tracking-options`: Update tracking options
- `update-payroll-timesheet-line`: Update a line on an existing Payroll Timesheet
- `approve-payroll-timesheet`: Approve a Payroll Timesheet
- `revert-payroll-timesheet`: Revert an approved Payroll Timesheet
- `add-payroll-timesheet-line`: Add new line on an existing Payroll Timesheet
- `delete-payroll-timesheet`: Delete an existing Payroll Timesheet
- `get-payroll-timesheet`: Retrieve an existing Payroll Timesheet

For detailed API documentation, please refer to the [MCP Protocol Specification](https://modelcontextprotocol.io/).

## For Developers

### Installation

```bash
# Using npm
npm install

# Using pnpm
pnpm install
```

### Run a build

```bash
# Using npm
npm run build

# Using pnpm
pnpm build
```

### Integrating with Claude Desktop

To link your Xero MCP server in development to Claude Desktop go to Settings > Developer > Edit config and add the following to your `claude_desktop_config.json` file:

NOTE: For Windows ensure the `args` path escapes the `\` between folders ie. `"C:\\projects\xero-mcp-server\\dist\\index.js"`

```json
{
  "mcpServers": {
    "xero": {
      "command": "node",
      "args": ["insert-your-file-path-here/xero-mcp-server/dist/index.js"],
      "env": {
        "XERO_CLIENT_ID": "your_client_id_here",
        "XERO_CLIENT_SECRET": "your_client_secret_here"
      }
    }
  }
}
```

## License

MIT

## Security

Please do not commit your `.env` file or any sensitive credentials to version control (it is included in `.gitignore` as a safe default.)

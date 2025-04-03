﻿﻿![CongressMCPServer](assets/logo.svg)

# Congress.gov API MCP Server

This is a Model Context Protocol (MCP) server designed to provide access to the official Congress.gov API (v3) using a hybrid approach:

* **MCP Resources:** For direct lookups of core legislative entities (Bills, Members, Congresses, Committees, general Info) using standardized URIs.
* **MCP Tools:** For more complex operations like searching across collections (`congress_search`) and retrieving related data lists (`congress_getSubResource`).

This server acts as a bridge, allowing MCP clients (like AI assistants or development tools) to easily query and utilize U.S. legislative data.

## Project Structure

* `/src`: Contains all source code.
  * `/config`: Configuration management (`ConfigurationManager.ts`).
  * `/services`: Core logic for interacting with Congress.gov API (`CongressApiService.ts`, `RateLimitService.ts`).
  * `/tools`: MCP tool definitions (`search/`, `subresource/`, `index.ts`).
  * `/types`: TypeScript interfaces and Zod schemas.
  * `/utils`: Shared utility functions (logging, errors, etc.).
  * `resourceHandlers.ts`: Logic for handling core entity resource requests.
  * `createServer.ts`: Server instance creation, resource and tool registration.
  * `server.ts`: Main application entry point.
* `/dist`: Compiled JavaScript output (generated by `npm run build`).
* `/docs`: Project documentation (PRD, Feature Spec, RFCs).
* `package.json`: Project metadata and dependencies.
* `tsconfig.json`: TypeScript compiler options.
* `.eslintrc.json`, `.prettierrc.json`: Linting and formatting rules.
* `.env`: (Not committed) For storing `CONGRESS_GOV_API_KEY`.

## Getting Started

1. **Install Dependencies:**

    ```bash
    npm install
    ```

2. **Set API Key:** Create a `.env` file in the project root and add your Congress.gov API key:

    ```
    CONGRESS_GOV_API_KEY=YOUR_API_KEY_HERE
    ```

    (Get a key from [https://api.data.gov/signup/](https://api.data.gov/signup/))
3. **Build the Server:**

    ```bash
    npm run build
    ```

4. **Run the Server:**

    ```bash
    npm start
    ```

    (This runs `node dist/server.js`)

Alternatively, run in development mode using `npm run dev` (uses `ts-node` and `nodemon`).

## Usage with MCP Client

Connect your MCP client to the running server (e.g., via stdio if running locally).

### Accessing Resources

Use the `access_mcp_resource` command/method with the appropriate URI.

**Examples:**

* **Get Bill H.R. 3076 (117th Congress):**

    ```
    <access_mcp_resource>
    <server_name>congress-server</server_name>
    <uri>congress-gov://bill/117/hr/3076</uri>
    </access_mcp_resource>
    ```

* **Get Member Pelosi:**

    ```
    <access_mcp_resource>
    <server_name>congress-server</server_name>
    <uri>congress-gov://member/P000197</uri>
    </access_mcp_resource>
    ```

* **Get Info about 118th Congress:**

    ```
    <access_mcp_resource>
    <server_name>congress-server</server_name>
    <uri>congress-gov://congress/118</uri>
    </access_mcp_resource>
    ```

* **Get API Overview:**

    ```
    <access_mcp_resource>
    <server_name>congress-server</server_name>
    <uri>congress-gov://info/overview</uri>
    </access_mcp_resource>
    ```

### Using Tools

Use the `use_mcp_tool` command/method.

**!!! CRITICAL TOOL WORKFLOW: Finding Entities & Getting Related Data !!!**

Many common tasks require a **mandatory two-step process** using both tools:

1. **STEP 1: Find the Entity ID using `congress_search`**
    * **Purpose:** Locate the specific bill, member, committee, etc., you need and extract its unique identifier(s) (e.g., `memberId`, or the `congress`, `billType`, `billNumber` for a bill URI).
    * **Tool:** `congress_search`
    * **Example:** Find member "John Kennedy" (might return multiple results requiring selection):

        ```xml
        <use_mcp_tool>
          <server_name>congress-server</server_name>
          <tool_name>congress_search</tool_name>
          <arguments>
            {
              "collection": "member",
              "query": "John Kennedy"
            }
          </arguments>
        </use_mcp_tool>
        ```

    * **Output:** Look for the `memberId` (e.g., `K000393`) or other necessary identifiers in the results.
    * **!!! WARNING !!!** Searching might return multiple results. You **MUST** identify the correct entity and use its specific ID for the next step.
    * **!!! API LIMITATION !!!** Filtering general searches by `congress` using the `filters` parameter is **NOT SUPPORTED** by the underlying API (e.g., for `/v3/bill` or `/v3/member`) and will be ignored. Congress-specific filtering usually requires using specific API paths (e.g., `/v3/bill/117`), which this tool does not construct.

2. **STEP 2: Get Related Data using `congress_getSubResource`**
    * **Purpose:** Use the identifier(s) found in Step 1 to construct the `parentUri` and fetch related details (actions, sponsors, text, etc.).
    * **Tool:** `congress_getSubResource`
    * **Prerequisite:** You **MUST** have the correct `parentUri` (e.g., `congress-gov://member/K000393`) from Step 1.
    * **Example:** Get legislation sponsored by member `K000393`:

        ```xml
        <use_mcp_tool>
          <server_name>congress-server</server_name>
          <tool_name>congress_getSubResource</tool_name>
          <arguments>
            {
              "parentUri": "congress-gov://member/K000393",
              "subResource": "sponsored-legislation",
              "limit": 5
            }
          </arguments>
        </use_mcp_tool>
        ```

    * **!!! GUARANTEED ERROR WARNING !!!** You **MUST** use a `subResource` string that is **STRICTLY VALID** for the `parentUri` type (e.g., `'sponsored-legislation'` for members, `'actions'` for bills). Providing an invalid combination **WILL** cause an error. Check the tool description for valid combinations.

**Following this two-step process is ESSENTIAL for reliably getting related information.**

**Tool Examples:**

* **Search for Bills containing "climate" (limit 5):**

    ```xml
    <use_mcp_tool>
    <server_name>congress-server</server_name>
    <tool_name>congress_search</tool_name>
    <arguments>
    {
      "collection": "bill",
      "query": "climate",
      "limit": 5
    }
    </arguments>
    </use_mcp_tool>
    ```

* **List Members (No Congress Filter Possible Here):**
  * *Note: As mentioned above, filtering by `congress` directly in `congress_search` is not supported by the API for the 'member' collection.*

    ```xml
    <use_mcp_tool>
    <server_name>congress-server</server_name>
    <tool_name>congress_search</tool_name>
    <arguments>
    {
      "collection": "member",
      "limit": 10 
      // Add "query" or other filters like "type" if needed
    }
    </arguments>
    </use_mcp_tool>
    ```

* **Get Actions for Bill H.R. 3076 (117th) (Requires URI from Search or Known Info):**

    ```xml
    <use_mcp_tool>
    <server_name>congress-server</server_name>
    <tool_name>congress_getSubResource</tool_name>
    <arguments>
    {
      "parentUri": "congress-gov://bill/117/hr/3076",
      "subResource": "actions",
      "limit": 10
    }
    </arguments>
    </use_mcp_tool>
    ```

* **Get Legislation Sponsored by Member P000197:**

    ```xml
    <use_mcp_tool>
    <server_name>congress-server</server_name>
    <tool_name>congress_getSubResource</tool_name>
    <arguments>
    {
      "parentUri": "congress-gov://member/P000197",
      "subResource": "sponsored-legislation",
      "limit": 5
    }
    </arguments>
    </use_mcp_tool>
    ```

## Linting and Formatting

* **Lint:** `npm run lint`
* **Format:** `npm run format`

Code will be automatically linted and formatted on commit via Husky and lint-staged.

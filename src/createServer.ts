import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js"; // Import ResourceTemplate
import {
    // ListResourcesRequestSchema, // No longer needed directly here
    // ReadResourceRequestSchema, // No longer needed directly here
    ErrorCode,
    McpError,
    ResourceContents,
    ReadResourceRequest, // Keep for type hints if needed elsewhere, maybe not
    ReadResourceResult, // Needed for callback signatures
    // RequestHandlerExtra, // Needed for callback signatures - Import from specific path
    // Variables // Needed for template callback signatures - Import from specific path
} from "@modelcontextprotocol/sdk/types.js";
// Import potentially internal types from specific paths based on mcp.d.ts
import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { Variables } from "@modelcontextprotocol/sdk/shared/uriTemplate.js";
// import { CommonContext } from "./types/index.js"; // No longer needed as RequestHandlerExtra is not generic
import { ConfigurationManager } from "./config/ConfigurationManager.js";
import { logger } from "./utils/index.js";
// Import custom errors - will be used inside handlers later
import { ResourceNotFoundError, ResourceError, ApiError, RateLimitError } from "./utils/errors.js";
// Import for tool registration
import { registerTools } from "./tools/index.js";
import { CongressApiService } from "./services/CongressApiService.js"; // Import service class
// Resource Handlers (excluding search)
import {
    handleBillResource,
    handleMemberResource,
    handleCongressResource,
    handleCommitteeResource,
    // handleSearchResource, // Removed - functionality moved to tool
    handleInfoOverviewResource,
    handleInfoCurrentCongressResource
} from "./resourceHandlers.js"; // Placeholder import for resource handlers

/**
 * Creates and configures an MCP server instance for the Congress.gov API.
 * This server exposes API data via MCP Resources.
 * @returns {McpServer} The configured MCP server instance
 */
export function createServer(): McpServer {
    logger.info("Creating MCP server instance"); // Updated log message

    // Initialize the server with Resource capabilities
    const server = new McpServer(
        {
            name: "congress-gov-mcp-server",
            version: "1.0.0", // Consider updating version
            description: "MCP Server exposing the Congress.gov API as Resources",
        },
        {
            capabilities: {
                resources: {}, // Keep resource capability
                tools: {}      // Add tool capability back
            },
        }
    );

    // Get configuration
    const configManager = ConfigurationManager.getInstance();
    // Instantiate the service here to pass to handlers
    const congressApiService = new CongressApiService();

// --- Register Resources ---

    // Define read callbacks that accept and pass the service instance
    // Signatures need to match ReadResourceCallback / ReadResourceTemplateCallback

    const readBillCallback = async (uri: URL, variables: Variables, extra: RequestHandlerExtra): Promise<ReadResourceResult> => {
        logger.debug("Handling readBillCallback", { uri: uri.toString(), variables, sessionId: extra.sessionId });
        // Pass the service instance to the handler
        return handleBillResource(uri.toString(), congressApiService);
    };

    const readMemberCallback = async (uri: URL, variables: Variables, extra: RequestHandlerExtra): Promise<ReadResourceResult> => {
        logger.debug("Handling readMemberCallback", { uri: uri.toString(), variables, sessionId: extra.sessionId });
        return handleMemberResource(uri.toString(), congressApiService);
    };

    const readCongressCallback = async (uri: URL, variables: Variables, extra: RequestHandlerExtra): Promise<ReadResourceResult> => {
        logger.debug("Handling readCongressCallback", { uri: uri.toString(), variables, sessionId: extra.sessionId });
        return handleCongressResource(uri.toString(), congressApiService);
    };

    const readCommitteeCallback = async (uri: URL, variables: Variables, extra: RequestHandlerExtra): Promise<ReadResourceResult> => {
        logger.debug("Handling readCommitteeCallback", { uri: uri.toString(), variables, sessionId: extra.sessionId });
        // Note: Committee handler might need congress from variables if URI template changes
        return handleCommitteeResource(uri.toString(), congressApiService);
    };

    // Add callbacks for other specific resources (Amendment, Nomination, etc.) if implemented

    const readInfoOverviewCallback = async (uri: URL, extra: RequestHandlerExtra): Promise<ReadResourceResult> => {
        logger.debug("Handling readInfoOverviewCallback", { uri: uri.toString(), sessionId: extra.sessionId });
        // Static handlers don't need the service instance
        return handleInfoOverviewResource(uri.toString());
    };

    const readInfoCurrentCongressCallback = async (uri: URL, extra: RequestHandlerExtra): Promise<ReadResourceResult> => {
        logger.debug("Handling readInfoCurrentCongressCallback", { uri: uri.toString(), sessionId: extra.sessionId });
        return handleInfoCurrentCongressResource(uri.toString());
    };


    // Register Resource Templates (excluding search)
    server.resource(
        "Bill Information",
        new ResourceTemplate("congress-gov://bill/{congress}/{billType}/{billNumber}", { list: undefined }),
        { description: "Information about a specific bill by Congress, type, and number", mimeType: "application/json" },
        readBillCallback
    );

    server.resource(
        "Member Information",
        new ResourceTemplate("congress-gov://member/{memberId}", { list: undefined }),
        { description: "Information about a specific member of Congress by ID", mimeType: "application/json" },
        readMemberCallback
    );

    server.resource(
        "Congress Information",
        new ResourceTemplate("congress-gov://congress/{congress}", { list: undefined }),
        { description: "Information about a specific Congress by number", mimeType: "application/json" },
        readCongressCallback
    );

    server.resource(
        "Committee Information",
        new ResourceTemplate("congress-gov://committee/{congress}/{chamber}/{committeeCode}", { list: undefined }),
        { description: "Information about a specific committee", mimeType: "application/json" },
        readCommitteeCallback
    );

    // REMOVED search resource registrations


    // Register Static Resources (Based on Feature Spec Section 3.1)
    server.resource(
        "Congress.gov API Overview",
        "congress-gov://info/overview",
        { description: "General information about the Congress.gov API", mimeType: "application/json" },
        readInfoOverviewCallback
    );

    server.resource(
        "Current Congress Information",
        "congress-gov://info/current-congress",
        { description: "Information about the current congressional session", mimeType: "application/json" },
        readInfoCurrentCongressCallback
    );

    // Errors will be handled within the read callbacks by throwing McpError

    // Register Tools (search and subresource)
    registerTools(server);

    logger.info("MCP server instance configured successfully"); // Removed capabilities logging
    return server;
}

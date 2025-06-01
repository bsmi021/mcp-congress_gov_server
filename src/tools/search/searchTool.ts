import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode, CallToolResult } from "@modelcontextprotocol/sdk/types.js"; // Ensure ErrorCode is imported
import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js"; // For handler signature
import { z } from "zod";
import { TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS, CongressSearchParams } from "./searchParams.js";
// Import the service class, not the singleton instance, if we instantiate it here or pass it in
import { CongressApiService } from "../../services/CongressApiService.js";
import { ApiError, NotFoundError, RateLimitError, ValidationError, InvalidParameterError } from "../../utils/errors.js"; // Import custom errors
import { logger } from "../../utils/index.js";
import { SearchParams } from "../../types/index.js"; // Import the SearchParams type, CommonContext no longer needed

/**
 * Registers and defines the handler for the congress_search tool.
 * It validates input using Zod schema defined in searchParams.ts and calls
 * the CongressApiService.searchCollection method.
 */
export const searchTool = (server: McpServer, congressApiService: CongressApiService): void => { // Inject service instance

    // Type assertion for args based on Zod schema
    const processSearchRequest = async (args: CongressSearchParams, extra: RequestHandlerExtra): Promise<CallToolResult> => {
        const { sessionId } = extra; // Assuming sessionId is a property of the non-generic RequestHandlerExtra
        logger.info(`[${TOOL_NAME}] Request received. SessionID: ${sessionId}`, { args });

        try {
            // Directly map validated args to the SearchParams type expected by the service
            const serviceParams: SearchParams = {
                query: args.query,
                filters: args.filters, // Pass the filters object directly
                sort: args.sort,
                limit: args.limit,
                offset: args.offset
            };

            logger.debug(`[${TOOL_NAME}] Calling CongressApiService.searchCollection. SessionID: ${sessionId}`, { collection: args.collection, params: serviceParams });
            const serviceResult = await congressApiService.searchCollection(args.collection, serviceParams);
            // Avoid logging potentially very large full results at info level for routine calls.
            // If needed for deep debugging, enable debug for CongressApiService to see its return.
            logger.debug(`[${TOOL_NAME}] Received result from CongressApiService. SessionID: ${sessionId}`, { collection: args.collection });

            // Reverting to text-based JSON string for safety, as 'json' type support is unconfirmed.
            const mcpResult = {
                content: [{
                    type: "text" as const,
                    text: JSON.stringify(serviceResult, null, 2) // Pretty print JSON
                }]
            };
            logger.info(`[${TOOL_NAME}] Processing complete, returning stringified JSON result. SessionID: ${sessionId}`);
            return mcpResult;

        } catch (error) {
            logger.error(`[${TOOL_NAME}] Error processing request. SessionID: ${sessionId}`, { error: error instanceof Error ? error.message : String(error), args });

            // Map errors to McpError
            if (error instanceof InvalidParameterError) {
                throw new McpError(ErrorCode.InvalidParams, `Invalid parameters for ${TOOL_NAME}: ${error.message}`);
            }
            if (error instanceof ValidationError) {
                throw new McpError(ErrorCode.InvalidParams, `Validation error in ${TOOL_NAME}: ${error.message}`, error.details);
            }
            if (error instanceof NotFoundError) {
                throw new McpError(ErrorCode.InvalidRequest, `Search in ${TOOL_NAME} failed (resource not found): ${error.message}`);
            }
            if (error instanceof RateLimitError) {
                // Reverting to InternalError as ResourceExhausted might not be standard or available.
                // InternalError is a safe fallback for upstream service issues like rate limiting.
                throw new McpError(ErrorCode.InternalError, `Rate limit exceeded during ${TOOL_NAME}: ${error.message}`);
            }
            if (error instanceof ApiError) {
                // Reverting to InternalError as Unavailable might not be standard or available.
                // InternalError is a safe fallback for general upstream API errors.
                throw new McpError(ErrorCode.InternalError, `API error during ${TOOL_NAME}: ${error.message}`, { statusCode: error.statusCode });
            }
            // Generic internal error
            throw new McpError(
                ErrorCode.InternalError,
                error instanceof Error ? error.message : `An unexpected error occurred in ${TOOL_NAME}.`
            );
        }
    };

    server.tool(
        TOOL_NAME,
        TOOL_DESCRIPTION,
        TOOL_PARAMS,
        processSearchRequest as any
    );

    logger.info(`Tool '${TOOL_NAME}' registered.`);
};

// Note: Removed direct import/use of singleton. Service instance should be passed in.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpError, ErrorCode, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { z } from "zod";
import { TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMS, CongressGetSubResourceParams } from "./getSubResourceParams.js";
// Import the service class, not the singleton instance
import { CongressApiService } from "../../services/CongressApiService.js";
import { ApiError, NotFoundError, RateLimitError, ValidationError, ResourceError, InvalidParameterError } from "../../utils/errors.js"; // Added InvalidParameterError
import { logger } from "../../utils/index.js";
import { PaginationParams } from "../../types/index.js"; // Import PaginationParams

/**
 * Parses the parent URI and extracts the base API path segment.
 * e.g., "congress-gov://bill/117/hr/3076" -> "/bill/117/hr/3076"
 * e.g., "congress-gov://member/P000197" -> "/member/P000197"
 * Throws ResourceError if the URI format is invalid.
 */
// Removed getApiPathFromParentUri as the service now handles URI parsing internally

/**
 * Registers and defines the handler for the congress_getSubResource tool.
 */
export const getSubResourceTool = (server: McpServer, congressApiService: CongressApiService): void => { // Inject service instance

    const processGetSubResourceRequest = async (args: CongressGetSubResourceParams, extra: RequestHandlerExtra): Promise<CallToolResult> => {
        const { sessionId } = extra;
        logger.info(`[${TOOL_NAME}] Request received. SessionID: ${sessionId}`, { args });

        try {
            // 1. Prepare pagination parameters
            const servicePaginationParams: PaginationParams = {
                limit: args.limit,
                offset: args.offset
            };

            logger.debug(`[${TOOL_NAME}] Calling CongressApiService.getSubResource. SessionID: ${sessionId}`, {
                parentUri: args.parentUri,
                subResource: args.subResource,
                pagination: servicePaginationParams
            });

            // 2. Call the dedicated service method
            const serviceResult = await congressApiService.getSubResource(
                args.parentUri,
                args.subResource,
                servicePaginationParams
            );
            logger.debug(`[${TOOL_NAME}] Received result from CongressApiService. SessionID: ${sessionId}`, { parentUri: args.parentUri, subResource: args.subResource });

            // 3. Format the successful output - Refined data formatting for LLM consumption
            const mcpResult = {
                content: [{
                    type: "json" as const, // Assuming 'json' type is supported by MCP SDK
                    json: serviceResult    // Pass the JSON object directly
                }]
            };
            logger.info(`[${TOOL_NAME}] Processing complete, returning structured JSON result. SessionID: ${sessionId}`);
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
                throw new McpError(ErrorCode.InvalidRequest, `Sub-resource or parent not found in ${TOOL_NAME}: ${error.message}`);
            }
            if (error instanceof RateLimitError) {
                throw new McpError(ErrorCode.ResourceExhausted, `Rate limit exceeded during ${TOOL_NAME}: ${error.message}`);
            }
            if (error instanceof ApiError) {
                throw new McpError(ErrorCode.Unavailable, `API error during ${TOOL_NAME}: ${error.message}`, { statusCode: error.statusCode });
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
        processGetSubResourceRequest as any
    );

    logger.info(`Tool '${TOOL_NAME}' registered.`);
};

// Note: Removed direct import/use of singleton. Service instance should be passed in.

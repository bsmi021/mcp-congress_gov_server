/**
 * MCP Test Client
 *
 * This script provides a command-line interface to send `callTool` requests to an
 * MCP (Model Context Protocol) server and displays the server's response.
 * It's useful for testing MCP tool implementations.
 *
 * Usage:
 * node scripts/mcp-test-client.js --serverUrl <url> --toolName <name> --paramsJson '{...}' [--sessionId <sid>]
 *
 * Example:
 * npm run test:client -- --serverUrl http://localhost:8080 --toolName congress_search --paramsJson '{"collection":"member","query":"Smith"}'
 * npm run test:client -- --serverUrl http://localhost:8080 --toolName congress_getSubResource --paramsJson '{"parentUri":"congress-gov://member/S000148", "subResource":"sponsored-legislation"}' --sessionId my-test-session
 */
import axios, { AxiosError } from 'axios';
import { CallTool, CallToolResponse, McpErrorBody } from '@modelcontextprotocol/sdk/types.js';

interface Args {
    serverUrl: string;
    toolName: string;
    paramsJson: string;
    sessionId?: string;
}

function parseArgs(): Args | null {
    const args = process.argv.slice(2); // Skip node executable and script path
    let serverUrl: string | undefined;
    let toolName: string | undefined;
    let paramsJson: string | undefined;
    let sessionId: string | undefined;

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--serverUrl':
                serverUrl = args[++i];
                break;
            case '--toolName':
                toolName = args[++i];
                break;
            case '--paramsJson':
                paramsJson = args[++i];
                break;
            case '--sessionId':
                sessionId = args[++i];
                break;
            default:
                if (args[i].startsWith('--')) {
                    console.error(`Unknown option: ${args[i]}`);
                    return null;
                }
        }
    }

    if (!serverUrl || !toolName || !paramsJson) {
        console.error('Missing required arguments: --serverUrl, --toolName, --paramsJson');
        console.log('Usage: node scripts/mcp-test-client.js --serverUrl <url> --toolName <name> --paramsJson \'{...}\' [--sessionId <sid>]');
        return null;
    }

    return { serverUrl, toolName, paramsJson, sessionId: sessionId ?? `test-client-session-${Date.now()}` };
}

async function main() {
    const parsedArgs = parseArgs();
    if (!parsedArgs) {
        process.exit(1);
    }

    const { serverUrl, toolName, paramsJson, sessionId } = parsedArgs;
    let params: any;

    try {
        params = JSON.parse(paramsJson);
    } catch (error) {
        console.error('Error parsing paramsJson:', error instanceof Error ? error.message : String(error));
        process.exit(1);
    }

    const requestBody: CallTool = {
        type: 'callTool',
        id: `test-client-req-${Date.now()}`,
        tool: toolName,
        parameters: params,
        context: {
            sessionId: sessionId,
        }
    };

    console.log(`Sending CallTool request to ${serverUrl}/mcp:`);
    console.log(JSON.stringify(requestBody, null, 2));

    try {
        const response = await axios.post<CallToolResponse | McpErrorBody>(`${serverUrl}/mcp`, requestBody, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        console.log('\nServer Response:');
        console.log(`Status: ${response.status}`);
        console.log('Data:');
        console.log(JSON.stringify(response.data, null, 2));

    } catch (error) {
        console.error('\nError sending request or processing response:');
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<McpErrorBody>;
            console.error(`Message: ${axiosError.message}`);
            if (axiosError.response) {
                console.error(`Status: ${axiosError.response.status}`);
                console.error('Data:', JSON.stringify(axiosError.response.data, null, 2));
            } else {
                console.error('No response received from server.');
            }
        } else {
            console.error(String(error));
        }
        process.exit(1);
    }
}

main().catch(err => {
    console.error("Unhandled error in main:", err);
    process.exit(1);
});

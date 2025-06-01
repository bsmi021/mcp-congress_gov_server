import axios, { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import { logger } from '../utils/index.js';
import { ConfigurationManager } from '../config/ConfigurationManager.js';
import { CongressGovConfig } from '../types/configTypes.js';
import {
    BillResourceParams, MemberResourceParams, CongressResourceParams, CommitteeResourceParams,
    AmendmentResourceParams, // Assuming these exist or will be created
    PaginationParams, SearchParams // Define these types
    // Add other specific param types as needed: NominationResourceParams, TreatyResourceParams, etc.
} from '../types/index.js'; // Import needed param types
import { ApiError, RateLimitError, NotFoundError, InvalidParameterError } from '../utils/errors.js'; // Import custom errors
import { RateLimitService } from './RateLimitService.js'; // Import RateLimitService

// Define supported query parameters for LIST endpoints (RFC-003)
// Based on https://github.com/LibraryOfCongress/api.congress.gov/blob/main/Documentation/Parameters.md
// And testing/Swagger review. NOTE: 'congress' and 'type' often part of PATH, not query params for lists.
const SUPPORTED_QUERY_PARAMS: Record<string, string[]> = {
    'bill': ['fromDateTime', 'toDateTime', 'sort'],
    'amendment': ['fromDateTime', 'toDateTime', 'sort'],
    'committee-report': ['fromDateTime', 'toDateTime', 'sort'],
    'committee': ['fromDateTime', 'toDateTime'], // No sort documented
    'committee-print': ['fromDateTime', 'toDateTime', 'sort'],
    'congressional-record': ['fromDateTime', 'toDateTime'], // No sort documented
    'daily-congressional-record': ['fromDateTime', 'toDateTime'], // No sort documented
    'bound-congressional-record': ['fromDateTime', 'toDateTime'], // No sort documented
    'house-communication': ['fromDateTime', 'toDateTime', 'sort'],
    'senate-communication': ['fromDateTime', 'toDateTime', 'sort'],
    'nomination': ['fromDateTime', 'toDateTime', 'sort'],
    'treaty': ['fromDateTime', 'toDateTime', 'sort'],
    'member': ['fromDateTime', 'toDateTime', 'currentMember'], // No sort documented
    // Add others like 'summaries', 'committee-meeting' if needed
};

// Define collections that support a general 'q=' query parameter (based on docs/testing)
const QUERY_SUPPORTED_COLLECTIONS: string[] = [
    // Primarily seems to be for full-text search collections, not basic lists
    // Example: 'crs-report' (if added), potentially others. Check API docs.
    // Most list endpoints rely on specific filters, not a general 'q'.
];

/**
 * Service responsible for handling communication with the Congress.gov API.
 * It configures Axios with the base URL and API key, integrates rate limiting,
 * provides methods for specific API endpoints and sub-resources, handles dynamic
 * query parameter construction for searches, and throws custom errors.
 */
export class CongressApiService {
    private readonly axiosInstance: AxiosInstance;
    private readonly config: Required<CongressGovConfig>;
    private readonly rateLimitService: RateLimitService;

    // Make constructor accept config and rate limiter for testability, but default to singletons
    constructor(
        config?: Partial<CongressGovConfig>,
        rateLimitService?: RateLimitService
    ) {
        const configManager = ConfigurationManager.getInstance();
        this.config = { ...configManager.getCongressGovConfig(), ...config };

        if (!this.config.apiKey) {
            const errorMsg = `FATAL: Missing required Congress.gov API key. Set CONGRESS_GOV_API_KEY environment variable.`;
            logger.error(errorMsg);
            // Throwing here will prevent the server from starting, which is desired.
            throw new Error(errorMsg); // Use standard Error for startup failure
        }

        this.rateLimitService = rateLimitService ?? new RateLimitService(); // Use injected or create new

        this.axiosInstance = axios.create({
            baseURL: this.config.baseUrl,
            params: {
                api_key: this.config.apiKey,
                format: 'json', // Default to JSON format
            },
            timeout: this.config.timeout,
        });

        // Simplified interceptor: just log, throw custom errors from executeRequest
        this.axiosInstance.interceptors.response.use(
            (response: AxiosResponse) => response,
            (error: AxiosError) => {
                // Log the raw error here if needed, but executeRequest handles specific error throwing
                const redactedUrl = error.config?.url?.replace(this.config.apiKey, '[REDACTED]');
                logger.error(`Raw Congress API Error: ${error.message}`, {
                    url: redactedUrl,
                    status: error.response?.status,
                    // data: error.response?.data, // Avoid logging potentially large/sensitive data by default
                });
                // Let executeRequest handle throwing specific custom errors based on response
                return Promise.reject(error);
            }
        );

        logger.info('CongressApiService initialized', { baseUrl: this.config.baseUrl, timeout: this.config.timeout });
    }

    // --- Internal Helper Methods ---

    /** Checks if a filter query parameter is supported for a given collection's LIST endpoint */
    private isFilterSupported(collection: string, filterName: string): boolean {
        return SUPPORTED_QUERY_PARAMS[collection]?.includes(filterName) ?? false;
    }

    /** Checks if the 'sort' query parameter is supported for a given collection's LIST endpoint */
    private isSortSupported(collection: string): boolean {
        // Assumes 'sort' is listed in SUPPORTED_QUERY_PARAMS if supported
        return this.isFilterSupported(collection, 'sort');
    }

    /** Checks if a general 'q=' query parameter is supported for a given collection's LIST endpoint */
    private isQuerySupported(collection: string): boolean {
        return QUERY_SUPPORTED_COLLECTIONS.includes(collection);
    }

    /**
     * Executes a request to the Congress.gov API, handling rate limits and errors.
     *
     * @param endpoint - API endpoint path (without base URL)
     * @param params - Optional query parameters
     * @returns Response data as JSON
     * @throws {ApiError} If the API request fails for non-404 reasons.
     * @throws {NotFoundError} If the API returns a 404 status.
     * @throws {RateLimitError} If rate limits are exceeded before making the call.
     */
    private async executeRequest(methodName: string, endpoint: string, params: Record<string, string | number | boolean> = {}): Promise<any> {
        logger.debug(`[${methodName}] Rate limit check for endpoint: ${endpoint}`);
        if (!this.rateLimitService.canMakeRequest()) {
            logger.warn(`[${methodName}] Rate limit pre-check failed for endpoint: ${endpoint}. Current requests in window: ${this.rateLimitService.getRemainingRequests() - this.config.maxRequests}, Max: ${this.config.maxRequests}`);
            throw new RateLimitError("Congress.gov API rate limit exceeded (pre-check)");
        }

        // Create a copy of params for logging to avoid modifying the original object passed to axios
        const logParams = { ...params };
        if ('api_key' in logParams) { // Should not happen as api_key is in default params
            delete (logParams as { api_key?: any }).api_key;
        }

        logger.info(`[${methodName}] Executing API request to endpoint: ${endpoint}`, { params: logParams });

        try {
            const response = await this.axiosInstance.get(endpoint, { params });
            logger.debug(`[${methodName}] API request successful for endpoint: ${endpoint}`, {
                status: response.status,
                headers: { // Log only a subset of potentially useful headers
                    'content-type': response.headers['content-type'],
                    'content-length': response.headers['content-length'],
                    'date': response.headers['date'],
                    'x-ratelimit-limit': response.headers['x-ratelimit-limit'],
                    'x-ratelimit-remaining': response.headers['x-ratelimit-remaining'],
                }
            });
            await this.rateLimitService.recordRequest();
            logger.debug(`[${methodName}] Rate limit request recorded for endpoint: ${endpoint}. Remaining requests: ${this.rateLimitService.getRemainingRequests()}`);
            return response.data;
        } catch (error) {
            // Error handling logic moved here from interceptor for better context
            // The raw error (including URL with API key) is logged by the interceptor's error handler.
            // Here we focus on structured error logging after redaction.
            if (axios.isAxiosError(error)) {
                const status = error.response?.status;
                const responseData = error.response?.data as any;
                const errorMessage = responseData?.message || responseData?.error?.message || error.message || 'Unknown API error';

                if (status === 404) {
                    throw new NotFoundError(`Resource not found at API endpoint: ${endpoint}`);
                }
                if (status === 500 && errorMessage.toLowerCase().includes('not found')) {
                    logger.warn(`API returned 500 but message indicates 'not found'`, { endpoint, status });
                    throw new NotFoundError(`Resource not found at API endpoint (reported as 500): ${endpoint}`);
                }
                if (status === 429) {
                    throw new RateLimitError(`Congress.gov API rate limit hit (status 429)`);
                }
                // Throw generic ApiError for other client/server errors from API
                // Provide a default status code (e.g., 0 or 500) if status is undefined
                throw new ApiError(`Congress API request failed with status ${status ?? 'N/A'}: ${errorMessage}`, status ?? 0, responseData);
            }
            // Rethrow unexpected errors as generic ApiError
            throw new ApiError(`Congress API request failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 0, error);
        }
    }


    // --- Specific Item Retrieval Methods (RFC-002) ---

    /**
     * Retrieves detailed information for a specific bill.
     * @param params - Parameters identifying the bill (congress, billType, billNumber).
     * @returns A Promise resolving to the bill details from the API.
     * @throws {InvalidParameterError} If required parameters are missing or invalid.
     */
    public async getBillDetails(params: BillResourceParams): Promise<any> {
        const methodName = "getBillDetails";
        logger.debug(`[${methodName}] Entered`, { params });
        // Validate numeric parts if needed, assuming they come as strings from URI parsing
        // Basic validation for required parameters
        if (!params || typeof params !== 'object') {
            throw new InvalidParameterError('BillResourceParams object is required.');
        }
        if (!params.congress) { // Assuming congress is a number or string representation of it
            throw new InvalidParameterError('Missing required parameter: congress.');
        }
        if (!params.billType || typeof params.billType !== 'string' || params.billType.trim() === '') {
            throw new InvalidParameterError('Missing or invalid required parameter: billType must be a non-empty string.');
        }
        if (!params.billNumber || typeof params.billNumber !== 'string' || params.billNumber.trim() === '') {
            throw new InvalidParameterError('Missing or invalid required parameter: billNumber must be a non-empty string.');
        }
        const endpoint = `/bill/${params.congress}/${params.billType}/${params.billNumber}`;
        logger.debug(`[${methodName}] Constructed endpoint: ${endpoint}`);
        const result = await this.executeRequest(methodName, endpoint);
        logger.debug(`[${methodName}] Result received`, { endpoint }); // Avoid logging full result data here for brevity
        return result;
    }

    /**
     * Retrieves detailed information for a specific member of Congress.
     * @param params - Parameters identifying the member (memberId).
     * @returns A Promise resolving to the member details from the API.
     * @throws {InvalidParameterError} If required parameters are missing or invalid.
     */
    public async getMemberDetails(params: MemberResourceParams): Promise<any> {
        const methodName = "getMemberDetails";
        logger.debug(`[${methodName}] Entered`, { params });
        if (!params || typeof params !== 'object') {
            throw new InvalidParameterError('MemberResourceParams object is required.');
        }
        if (!params.memberId || typeof params.memberId !== 'string' || params.memberId.trim() === '') {
            throw new InvalidParameterError('Missing or invalid required parameter: memberId must be a non-empty string.');
        }
        const endpoint = `/member/${params.memberId}`;
        logger.debug(`[${methodName}] Constructed endpoint: ${endpoint}`);
        const result = await this.executeRequest(methodName, endpoint);
        logger.debug(`[${methodName}] Result received`, { endpoint });
        return result;
    }

    /**
     * Retrieves detailed information for a specific Congress (e.g., 117th Congress).
     * @param params - Parameters identifying the Congress (congress number).
     * @returns A Promise resolving to the Congress details from the API.
     * @throws {InvalidParameterError} If required parameters are missing or invalid.
     */
    public async getCongressDetails(params: CongressResourceParams): Promise<any> {
        const methodName = "getCongressDetails";
        logger.debug(`[${methodName}] Entered`, { params });
        if (!params || typeof params !== 'object') {
            throw new InvalidParameterError('CongressResourceParams object is required.');
        }
        if (!params.congress) { // Assuming congress is a number or string representation of it
            throw new InvalidParameterError('Missing required parameter: congress.');
        }
        const endpoint = `/congress/${params.congress}`;
        logger.debug(`[${methodName}] Constructed endpoint: ${endpoint}`);
        const result = await this.executeRequest(methodName, endpoint);
        logger.debug(`[${methodName}] Result received`, { endpoint });
        return result;
    }

    /**
     * Retrieves detailed information for a specific committee.
     * @param params - Parameters identifying the committee (chamber, committeeCode, optional congress).
     * @returns A Promise resolving to the committee details from the API.
     * @throws {InvalidParameterError} If required parameters are missing or invalid.
     */
    public async getCommitteeDetails(params: CommitteeResourceParams): Promise<any> {
        const methodName = "getCommitteeDetails";
        logger.debug(`[${methodName}] Entered`, { params });
        if (!params || typeof params !== 'object') {
            throw new InvalidParameterError('CommitteeResourceParams object is required.');
        }
        if (!params.chamber || typeof params.chamber !== 'string' || params.chamber.trim() === '') {
            throw new InvalidParameterError('Missing or invalid required parameter: chamber must be a non-empty string.');
        }
        if (!params.committeeCode || typeof params.committeeCode !== 'string' || params.committeeCode.trim() === '') {
            throw new InvalidParameterError('Missing or invalid required parameter: committeeCode must be a non-empty string.');
        }
        // params.congress is optional for this endpoint, so only add if provided
        const endpoint = `/committee/${params.chamber}/${params.committeeCode}`;
        const queryParams: Record<string, string | number> = {};
        if (params.congress) { // Assuming congress is a number or string representation of it
            queryParams.congress = params.congress;
        }
        logger.debug(`[${methodName}] Constructed endpoint: ${endpoint}`, { queryParams });
        const result = await this.executeRequest(methodName, endpoint, queryParams);
        logger.debug(`[${methodName}] Result received`, { endpoint });
        return result;
    }

    /**
     * Retrieves detailed information for a specific amendment.
     * @param params - Parameters identifying the amendment (congress, amendmentType, amendmentNumber).
     * @returns A Promise resolving to the amendment details from the API.
     * @throws {InvalidParameterError} If required parameters are missing or invalid.
     */
    public async getAmendmentDetails(params: AmendmentResourceParams): Promise<any> {
        const methodName = "getAmendmentDetails";
        logger.debug(`[${methodName}] Entered`, { params });
        if (!params || typeof params !== 'object') {
            throw new InvalidParameterError('AmendmentResourceParams object is required.');
        }
        if (!params.congress) { // Assuming congress is a number or string representation of it
            throw new InvalidParameterError('Missing required parameter: congress.');
        }
        if (!params.amendmentType || typeof params.amendmentType !== 'string' || params.amendmentType.trim() === '') {
            throw new InvalidParameterError('Missing or invalid required parameter: amendmentType must be a non-empty string.');
        }
        if (!params.amendmentNumber || typeof params.amendmentNumber !== 'string' || params.amendmentNumber.trim() === '') {
            throw new InvalidParameterError('Missing or invalid required parameter: amendmentNumber must be a non-empty string.');
        }
        const endpoint = `/amendment/${params.congress}/${params.amendmentType}/${params.amendmentNumber}`;
        logger.debug(`[${methodName}] Constructed endpoint: ${endpoint}`);
        const result = await this.executeRequest(methodName, endpoint);
        logger.debug(`[${methodName}] Result received`, { endpoint });
        return result;
    }

    // Add methods for other specific types as needed, mapping params to endpoint structure, with similar logging
    // public async getNominationDetails(params: NominationResourceParams): Promise<any> { ... } // Add logging
    // public async getTreatyDetails(params: TreatyResourceParams): Promise<any> { ... } // Add logging
    // public async getCommunicationDetails(params: CommunicationResourceParams): Promise<any> { ... } // Add logging
    // public async getCommitteeReportDetails(params: CommitteeReportResourceParams): Promise<any> { ... } // Add logging
    // public async getCongressionalRecordDetails(params: CongressionalRecordResourceParams): Promise<any> { ... } // Add logging


    // --- List/Search Method (RFC-003) ---

    /**
     * Searches or lists items within a specified Congress.gov collection.
     * @param collection - The name of the collection to search (e.g., "bill", "member").
     * @param params - Search parameters including query, filters, sort, limit, and offset.
     * @returns A Promise resolving to the search results from the API.
     * @throws {InvalidParameterError} If unsupported filters or sort options are provided for the collection.
     */
    public async searchCollection(collection: string, params: SearchParams): Promise<any> {
        const methodName = "searchCollection";
        logger.debug(`[${methodName}] Entered`, { collection, params });

        const basePath = `/${collection}`; // e.g., /bill, /member
        const queryParams: Record<string, string | number | boolean> = {};

        // 1. Add Search Query (if applicable and supported)
        if (params.query) {
            if (this.isQuerySupported(collection)) {
                queryParams['q'] = params.query;
                logger.debug(`[${methodName}] Added 'q' parameter: ${params.query}`);
            } else {
                logger.warn(`[${methodName}] Query parameter '${params.query}' provided but general keyword search ('q') is likely not supported by /${collection} list endpoint. Ignoring query.`);
            }
        }

        // 2. Add Filters
        if (params.filters) {
            logger.debug(`[${methodName}] Processing filters`, { filters: params.filters });
            for (const [filterKey, filterValue] of Object.entries(params.filters)) {
                if (filterValue !== undefined && filterValue !== null && filterValue !== '') {
                    if (this.isFilterSupported(collection, filterKey)) {
                        queryParams[filterKey] = typeof filterValue === 'boolean' ? String(filterValue) : filterValue;
                        logger.debug(`[${methodName}] Added filter '${filterKey}': ${queryParams[filterKey]}`);
                    } else {
                        logger.warn(`[${methodName}] Unsupported filter '${filterKey}' for collection '${collection}'. Throwing error.`);
                        throw new InvalidParameterError(`Filter '${filterKey}' is not supported for collection '${collection}'.`);
                    }
                }
            }
        }

        // 3. Add Sorting
        if (params.sort) {
            if (this.isSortSupported(collection)) {
                queryParams['sort'] = params.sort;
                logger.debug(`[${methodName}] Added sort parameter: ${params.sort}`);
            } else {
                logger.warn(`[${methodName}] Unsupported sort for collection '${collection}'. Throwing error.`);
                throw new InvalidParameterError(`Sorting by 'updateDate' (or any sort) is not supported for collection '${collection}'.`);
            }
        }

        // 4. Add Pagination
        if (params.limit !== undefined) {
            queryParams['limit'] = params.limit;
            logger.debug(`[${methodName}] Added limit parameter: ${params.limit}`);
        }
        if (params.offset !== undefined) {
            queryParams['offset'] = params.offset;
            logger.debug(`[${methodName}] Added offset parameter: ${params.offset}`);
        }

        logger.debug(`[${methodName}] Constructed endpoint: ${basePath}`, { queryParams });
        const result = await this.executeRequest(methodName, basePath, queryParams);
        logger.debug(`[${methodName}] Result received for collection '${collection}'`, { basePath }); // Avoid logging full result
        return result;
    }


    // --- Sub-Resource Retrieval Methods (RFC-002) ---

    /**
     * Constructs the API path for a sub-resource based on a parent MCP URI.
     * @param methodName - The name of the calling method, for logging context.
     * @param parentUri - The MCP URI of the parent entity (e.g., "congress-gov://bill/117/hr/3076").
     * @param subResource - The name of the sub-resource to access (e.g., "actions").
     * @returns The constructed API path string (e.g., "/bill/117/hr/3076/actions").
     * @throws {InvalidParameterError} If the parentUri format is invalid or essential parts are missing.
     */
    private getSubResourcePath(methodName: string, parentUri: string, subResource: string): string {
        logger.debug(`[${methodName}] getSubResourcePath entered`, { parentUri, subResource });
        // Basic parsing, needs robust error handling and validation
        // Example valid parentUri: "congress-gov://bill/117/hr/3076"
        // Example valid parentUri: "congress-gov://member/K000393"
        let url: URL;
        try {
            url = new URL(parentUri);
        } catch (e: any) {
            logger.warn(`[${methodName}] Invalid parentUri format for URL parsing: "${parentUri}"`, { error: e.message });
            throw new InvalidParameterError(`Invalid parentUri format. Could not parse as URL: "${parentUri}". Error: ${e.message}`);
        }

        if (url.protocol !== 'congress-gov:') {
            logger.warn(`[${methodName}] Invalid parentUri protocol: "${url.protocol}" in "${parentUri}"`);
            throw new InvalidParameterError(`Invalid parentUri protocol: "${url.protocol}" in "${parentUri}". Expected "congress-gov:".`);
        }
        const collection = url.hostname; // e.g., 'bill', 'member'
        const pathSegments = url.pathname.split('/').filter(p => p); // e.g., ['117', 'hr', '3076'] or ['K000393']

        if (!collection) {
            logger.warn(`[${methodName}] Missing collection type (hostname) in parentUri: "${parentUri}"`);
            throw new InvalidParameterError(`Missing collection type (hostname) in parentUri: "${parentUri}"`);
        }
        if (pathSegments.length === 0) {
            logger.warn(`[${methodName}] Missing identifier path segments in parentUri: "${parentUri}"`);
            throw new InvalidParameterError(`Missing identifier path segments in parentUri: "${parentUri}"`);
        }

        // Construct the correct API path: /collection/segment1/segment2/.../subResource
        const basePath = `/${collection}/${pathSegments.join('/')}`;
        const fullPath = `${basePath}/${subResource}`;
        logger.debug(`[${methodName}] Constructed sub-resource path: ${fullPath}`);
        return fullPath;
    }

    /**
     * Retrieves a list of sub-resources for a given parent MCP URI.
     * @param parentUri - The MCP URI of the parent entity.
     * @param subResource - The name of the sub-resource to retrieve (e.g., "actions", "cosponsors").
     * @param pagination - Optional pagination parameters (limit, offset).
     * @returns A Promise resolving to the list of sub-resources from the API.
     * @throws {InvalidParameterError} If the parentUri format is invalid or the sub-resource is not valid for the parent.
     */
    public async getSubResource(parentUri: string, subResource: string, pagination?: PaginationParams): Promise<any> {
        const methodName = "getSubResource";
        logger.debug(`[${methodName}] Entered`, { parentUri, subResource, pagination });

        const endpoint = this.getSubResourcePath(methodName, parentUri, subResource);
        const queryParams: Record<string, string | number> = {};

        if (pagination?.limit !== undefined) {
            queryParams['limit'] = pagination.limit;
            logger.debug(`[${methodName}] Added limit parameter: ${pagination.limit}`);
        }
        if (pagination?.offset !== undefined) {
            queryParams['offset'] = pagination.offset;
            logger.debug(`[${methodName}] Added offset parameter: ${pagination.offset}`);
        }

        logger.debug(`[${methodName}] Prepared for executeRequest`, { endpoint, queryParams });
        const result = await this.executeRequest(methodName, endpoint, queryParams);
        logger.debug(`[${methodName}] Result received for sub-resource '${subResource}' of '${parentUri}'`, { endpoint }); // Avoid full result
        return result;
    }

    // --- Add specific wrappers for getSubResource if needed for clarity or type safety --- with logging
    // Example:
    // public async getBillActions(params: BillResourceParams, pagination?: PaginationParams): Promise<any> {
    //     const methodName = "getBillActions";
    //     logger.debug(`[${methodName}] Entered`, { params, pagination });
    //     const parentUri = `congress-gov://bill/${params.congress}/${params.billType}/${params.billNumber}`;
    //     const result = await this.getSubResource(parentUri, 'actions', pagination); // getSubResource already logs internally
    //     logger.debug(`[${methodName}] Result received`);
    //     return result;
    // }
    // public async getMemberSponsoredLegislation(params: MemberResourceParams, pagination?: PaginationParams): Promise<any> {
    //     const methodName = "getMemberSponsoredLegislation";
    //     logger.debug(`[${methodName}] Entered`, { params, pagination });
    //     const parentUri = `congress-gov://member/${params.memberId}`;
    //     const result = await this.getSubResource(parentUri, 'sponsored-legislation', pagination);
    //     logger.debug(`[${methodName}] Result received`);
    //     return result;
    // }
    // ... etc.

}

// Note: Removed default singleton export. Instantiation should be handled by the caller (e.g., in createServer.ts)
// This improves testability and allows configuration injection.

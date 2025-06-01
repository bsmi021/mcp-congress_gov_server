import { ConfigurationManager } from '../config/ConfigurationManager.js';
import { RateLimitConfig } from '../types/index.js'; // Import via barrel file
import { logger } from '../utils/logger.js';

/**
 * Service to manage rate limiting for external API calls, specifically Congress.gov.
 */
export class RateLimitService {
    private requestTimes: number[] = [];
    private readonly config: Required<RateLimitConfig>;

    constructor(config?: Partial<RateLimitConfig>) {
        const configManager = ConfigurationManager.getInstance();
        // Assuming ConfigurationManager has getRateLimitConfig()
        const defaultConfig = configManager.getRateLimitConfig();
        this.config = { ...defaultConfig, ...config };
        logger.info(`RateLimitService initialized`, { config: this.config }); // Log config object
    }

    /**
     * Checks if a request can be made without exceeding the rate limit.
     * Also cleans up old request timestamps.
     * @returns {boolean} True if a request can be made, false otherwise.
     */
    public canMakeRequest(): boolean {
        const now = Date.now();
        // Calculate the timestamp representing the start of the rate limit window
        const windowStart = now - (this.config.perHours * 60 * 60 * 1000);

        // Remove request timestamps older than the window start time
        this.requestTimes = this.requestTimes.filter(time => time > windowStart);

        // Check if the number of requests within the window is less than the maximum allowed
        const canRequest = this.requestTimes.length < this.config.maxRequests;
        if (!canRequest) {
            // Add context to warning
            logger.warn(`Rate limit potentially exceeded`, {
                requestsInWindow: this.requestTimes.length,
                maxRequests: this.config.maxRequests,
                windowHours: this.config.perHours
            });
        }
        return canRequest;
    }

    /**
     * Records the timestamp of a new request. Should be called after a successful check with canMakeRequest().
     */
    public recordRequest(): void {
        const now = Date.now();
        this.requestTimes.push(now);
        // Add context to debug log
        logger.debug(`API request recorded`, { timestamp: now, requestsInWindow: this.requestTimes.length });
    }

    /**
     * Gets the number of remaining requests allowed within the current window.
     * Note: This is an estimate as the window is rolling.
     * @returns {number} The number of remaining requests.
     */
    public getRemainingRequests(): number {
        // Ensure old requests are pruned before calculating remaining
        this.canMakeRequest(); // This call implicitly prunes old timestamps
        return Math.max(0, this.config.maxRequests - this.requestTimes.length);
    }

    /**
     * Estimates the time (in milliseconds since epoch) when the rate limit might reset.
     * This is based on the oldest request currently within the window.
     * Returns 0 if no requests are in the window.
     * @returns {number} Estimated reset time timestamp, or 0.
     */
    public getResetTime(): number {
        // Ensure old requests are pruned first
        this.canMakeRequest(); // This call implicitly prunes old timestamps

        if (this.requestTimes.length === 0) {
            return 0; // No requests, limit is effectively reset
        }

        // The window resets 1 hour after the oldest request *within the current window*
        const oldestRequestInWindow = Math.min(...this.requestTimes);
        return oldestRequestInWindow + (this.config.perHours * 60 * 60 * 1000);
    }

    /**
     * Gets the configured maximum number of requests for the rate limit window.
     * @returns {number} The maximum number of requests.
     */
    public getMaxRequests(): number {
        return this.config.maxRequests;
    }
}

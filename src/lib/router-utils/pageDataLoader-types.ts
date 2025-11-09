import {
  BaseMeta,
  PageResponseEnvelope,
  APIResponseEnvelope,
} from '../api-envelope/api-envelope-types';

/**
 * Base error definition with title and description
 */
export interface BaseErrorDefinition {
  title: string;
  description: string;
}

/**
 * Full error definition with title, description, message, and code
 */
export interface FullErrorDefinition extends BaseErrorDefinition {
  message: string;
  code: string;
}

/**
 * Shared interface for all error defaults used in both DEFAULT_ERROR_DEFAULTS const and PageLoaderConfig interface
 */
export interface ErrorDefaults {
  notFound: FullErrorDefinition;
  internalError: FullErrorDefinition;
  authRequired: BaseErrorDefinition;
  accessDenied: FullErrorDefinition;
  genericError: FullErrorDefinition;
  invalidResponse: FullErrorDefinition;
  invalidRedirect: FullErrorDefinition;
  redirectNotFollowed: FullErrorDefinition;
  unsafeRedirect: FullErrorDefinition;
}

/**
 * Custom status code handler function type
 *
 * @param statusCode - The HTTP status code from the API response
 * @param responseData - The parsed JSON response data from the API (if valid JSON)
 * @param config - The page loader configuration
 * @returns A PageResponseEnvelope or null/undefined to fall back to default handling
 *
 * For redirects, use the API envelope redirect pattern with status: "redirect".
 * SSR-only data (like cookies) will be automatically decorated by the page loader.
 */

export type CustomStatusCodeHandler = (
  statusCode: number,
  responseData: unknown,
  config: PageLoaderConfig,
) => PageResponseEnvelope | null | undefined;

/**
 * Configuration object interface for the page loader system
 */
export interface PageLoaderConfig {
  /** Base URL for the API server (e.g., "http://localhost:3001" or "https://api.example.com") */
  apiBaseUrl: string;
  /**
   * Page data endpoint path (e.g., "/api/v1/page_data" or "/api/page_data")
   *
   * This path will be appended to the apiBaseUrl to form the complete endpoint URL.
   * The pageType will be appended to this path: `{apiBaseUrl}{pageDataEndpoint}/{pageType}`
   *
   * @default "/api/v1/page_data"
   */
  pageDataEndpoint?: string;
  /** Default error constants for common scenarios */
  errorDefaults: ErrorDefaults;
  /**
   * Whether the application is running in development mode
   *
   * When true, detailed error information (like stack traces and error details)
   * may be included in error responses. When false, only user-friendly messages
   * are included for security. On the server, if provided, the SSR server's
   * isDevelopment flag is authoritative; otherwise this value is used. As a
   * final fallback, NODE_ENV === "development" is treated as development.
   *
   * Defaults to checking process.env.NODE_ENV === "development" if not explicitly set,
   * but you should explicitly set this for better Bun/Deno compatibility and clarity.
   *
   * @default process.env.NODE_ENV === "development"
   */
  isDevelopment?: boolean;
  /** Connection error messages for network failures */
  connectionErrorMessages?: {
    /** Message shown on server when API connection fails */
    server?: string;
    /** Message shown on client when API connection fails */
    client?: string;
  };
  /** Login URL for authentication redirects (e.g., "/login") */
  loginUrl: string;
  /** Query parameter name for return URL in login redirects (default: "return_to") */
  returnToParam?: string;
  /**
   * Timeout in milliseconds for API requests
   *
   * Defaults to 10000ms (10 seconds). Set to 0 to disable timeout.
   * Uses AbortController to cancel requests that exceed the timeout.
   *
   * @default 10000
   */
  timeoutMs?: number;
  /**
   * Function to generate fallback request IDs when none is provided in error responses
   * Called when creating error responses that don't have a request_id from the API
   * @param context - The context for the request ID ("error" or "redirect")
   * @returns A unique identifier string for the request
   */
  generateFallbackRequestID?: (context: 'error' | 'redirect') => string;
  /**
   * Optional function to transform/extend the meta object when converting API errors to page errors
   *
   * This is called when:
   * 1. An API endpoint returns an error response (type: "api")
   * 2. The pageLoader needs to convert it to a page response (type: "page") for React Router
   * 3. Metadata from the original API response needs to be preserved/transformed
   *
   * Common use case: API returns user account info, site settings, etc. in meta,
   * and you want to preserve that data in the converted page error response.
   *
   * @param baseMeta - The base page meta (title/description) already populated
   * @param statusCode - HTTP status code from the original response
   * @param errorCode - Error code from the API response
   * @param originalMetadata - Original metadata from API response (account, site_info, etc.)
   * @returns Extended meta object with app-specific fields added to baseMeta
   */
  transformErrorMeta?: (params: {
    baseMeta: BaseMeta;
    statusCode: number;
    errorCode: string;
    originalMetadata?: {
      title?: string;
      description?: string;
      [key: string]: unknown;
    };
  }) => BaseMeta | Record<string, unknown>;
  /**
   * Optional array of allowed origins for redirect safety validation
   *
   * Behavior:
   * - **undefined**: Redirect safety validation is disabled (any redirect target allowed)
   * - **empty array []**: Only relative paths allowed (all external URLs blocked)
   * - **array with origins**: Relative paths + specified origins allowed
   *
   * Example:
   * ```typescript
   * // Allow any redirect (validation disabled)
   * allowedRedirectOrigins: undefined
   *
   * // Only allow relative paths, block all external URLs
   * allowedRedirectOrigins: []
   *
   * // Allow relative paths + specific origins
   * allowedRedirectOrigins: [
   *   "https://myapp.com",
   *   "https://auth.myapp.com"
   * ]
   * ```
   *
   * With specific origins configured, this allows:
   * - "/dashboard" (relative path - always allowed)
   * - "https://myapp.com/profile" (allowed origin)
   * - "https://auth.myapp.com/login" (allowed origin)
   *
   * But blocks:
   * - "https://evil.com/phishing" (not in allowed origins)
   * - "javascript:alert('xss')" (not a valid origin)
   */
  allowedRedirectOrigins?: string[];
  /**
   * Optional map of custom status code handlers
   *
   * Allows you to provide custom handling logic for specific HTTP status codes.
   * Use '*' as a key for a wildcard handler that catches all status codes (checked after specific handlers).
   * If a handler returns null or undefined, the default handling logic will be used.
   *
   * You can manually construct PageResponseEnvelope objects. For redirects, use the API envelope
   * redirect pattern with status: "redirect". The APIResponseHelpers are designed for server-side
   * API handlers and require a FastifyRequest object, so they're not suitable for use in data loaders.
   *
   * Example:
   * ```typescript
   * statusCodeHandlers: {
   *   // Wildcard handler for all status codes (checked after specific handlers)
   *   '*': (statusCode, responseData, config) => {
   *     // Log all errors in development
   *     if (config.isDevelopment) {
   *       console.error(`Unhandled status code ${statusCode}:`, responseData);
   *     }
   *     // Return null to fall back to default handling
   *     return null;
   *   },
   *   // Custom handling for 418 I'm a teapot (number key)
   *   418: (statusCode, responseData, config) => {
   *     return {
   *       status: 'error',
   *       status_code: 418,
   *       request_id: responseData?.request_id || `teapot_${Date.now()}`,
   *       type: 'page',
   *       data: null,
   *       meta: { page: { title: 'I\'m a teapot', description: 'Cannot brew coffee' } },
   *       error: { code: 'teapot_error', message: 'I\'m a teapot! Cannot brew coffee.' }
   *     };
   *   },
   *   // Override default 404 handling (string key also works)
   *   "404": (statusCode, responseData, config) => {
   *     // Custom 404 logic here...
   *     // Return null to fall back to default 404 handling
   *     return null;
   *   },
   *   // Handle payment required with API envelope redirect
   *   402: (statusCode, responseData, config) => {
   *     // Use API envelope redirect pattern (recommended)
   *     return {
   *       status: 'redirect',
   *       status_code: 200,
   *       request_id: responseData?.request_id || `redirect_${Date.now()}`,
   *       type: 'page',
   *       data: null,
   *       meta: { page: { title: 'Payment Required', description: 'Redirecting to payment page' } },
   *       error: null,
   *       redirect: {
   *         target: '/payment-required',
   *         permanent: false,
   *         preserve_query: false
   *       }
   *     };
   *   }
   * }
   * ```
   */
  statusCodeHandlers?: Record<string | number, CustomStatusCodeHandler>;
}

/**
 * Narrower configuration for local-only page loaders (no framework HTTP fetch).
 * Includes only the fields actually used by the local loader path.
 */
export type LocalPageLoaderConfig = Pick<
  PageLoaderConfig,
  | 'errorDefaults'
  | 'isDevelopment'
  | 'connectionErrorMessages'
  | 'timeoutMs'
  | 'generateFallbackRequestID'
  | 'allowedRedirectOrigins'
  | 'transformErrorMeta'
>;

// Options interface for the page loader
export interface PageLoaderOptions {
  request: Request;
  params: Record<string, string | undefined>;
  pageType: string;
  config: PageLoaderConfig;
}

// ---------------------------------------------------------------------------
// Local Page Loader (where no HTTP request is made) types
// ---------------------------------------------------------------------------

export interface LocalPageHandlerParams {
  /** Logical page type for the local handler */
  pageType: string | 'local';
  /** Origin indicator for debugging */
  invocation_origin: 'local';
  /** Router params */
  route_params: Record<string, string>;
  /** URL query params */
  query_params: Record<string, string>;
  /** Pathname portion of the request URL */
  request_path: string;
  /** Full request URL string */
  original_url: string;
}

export type LocalPageHandler<T = unknown, M extends BaseMeta = BaseMeta> = (
  params: LocalPageHandlerParams,
) =>
  | Promise<PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M>>
  | PageResponseEnvelope<T, M>
  | APIResponseEnvelope<T, M>;

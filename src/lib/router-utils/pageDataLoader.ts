/**
 * Page Loader System
 * -----------------
 *
 * This is a centralized page loader system that handles all route data fetching for the application.
 * Instead of having multiple specialized loaders for separate pages, we've consolidated all page data fetching
 * into this single data loader that communicates with our API server.
 *
 * How it works:
 * 1. Each route uses createPageLoader(config, pageType) to create a loader for that route
 * 2. The pageLoader makes a POST request to /v1/page_data/{pageType} with route params and query params
 * 3. The API server handles the request and returns data in a standardized response format
 * 4. The loader processes the response, handling errors, redirects, and authentication
 *
 * Benefits:
 * - Consistent error handling and response processing
 * - Centralized authentication flow
 * - Simplified route definitions
 * - Easier maintenance with a single loader implementation
 *
 * This approach eliminates the need for multiple loader files and consolidates all
 * data fetching logic in one place, making it easier to maintain and extend.
 *
 * Usage Example:
 * ```typescript
 * import { createPageLoader, createDefaultPageLoaderConfig } from './pageDataLoader';
 *
 * // Create a configuration (typically done once in your app setup)
 * const config = createDefaultPageLoaderConfig('http://localhost:3001');
 *
 * // Or create a custom configuration with your own titles/branding
 * const customConfig = {
 *   apiBaseUrl: 'https://api.myapp.com',
 *   loginUrl: '/auth/login',
 *   returnToParam: 'redirect_to', // Custom query param name for login redirects
 *   isDevelopment: true, // Explicitly set for Bun/Deno compatibility
 *   generateFallbackRequestID: (context) => `myapp_${context}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
 *   connectionErrorMessages: {
 *     server: 'API service unavailable. Please try again later.',
 *     client: 'Network error. Please check your connection and try again.',
 *   },
 *   errorDefaults: {
 *     notFound: {
 *       title: 'Page Not Found | MyApp',
 *       description: 'The page you are looking for could not be found.',
 *       code: 'not_found',
 *       message: 'The requested resource was not found.',
 *     },
 *     internalError: {
 *       title: 'Server Error | MyApp',
 *       description: 'An internal server error occurred.',
 *       code: 'internal_server_error',
 *       message: 'An internal server error occurred.',
 *     },
 *     authRequired: {
 *       title: 'Login Required | MyApp',
 *       description: 'You must be logged in to access this page.',
 *     },
 *     accessDenied: {
 *       title: 'Access Denied | MyApp',
 *       description: 'You do not have permission to access this page.',
 *       message: 'Sorry, you don\'t have access to this feature.',
 *       code: 'access_denied', // Standard error code (can be customized)
 *     },
 *     genericError: {
 *       title: 'Oops! | MyApp',
 *       description: 'Something unexpected happened.',
 *       message: 'Oops! Something went wrong. Please try again.',
 *       code: 'unknown_error', // Standard error code (can be customized)
 *     },
 *     invalidResponse: {
 *       title: 'Server Error | MyApp',
 *       description: 'The server sent an unexpected response.',
 *       message: 'Sorry, we received an unexpected response from the server.',
 *       code: 'invalid_response', // Standard error code (can be customized)
 *     },
 *     invalidRedirect: {
 *       title: 'Invalid Redirect | MyApp',
 *       description: 'The server attempted an invalid redirect.',
 *       message: 'Sorry, the redirect information was incomplete.',
 *       code: 'invalid_redirect', // Standard error code (can be customized)
 *     },
 *     redirectNotFollowed: {
 *       title: 'Redirect Error | MyApp',
 *       description: 'HTTP redirects from the API are not supported.',
 *       message: 'Sorry, the API attempted an unsupported redirect.',
 *       code: 'api_redirect_not_followed', // Standard error code (can be customized)
 *     },
 *     unsafeRedirect: {
 *       title: 'Unsafe Redirect Blocked | MyApp',
 *       description: 'The redirect target is not allowed for security reasons.',
 *       message: 'Sorry, this redirect is not allowed for security reasons.',
 *       code: 'unsafe_redirect', // Standard error code (can be customized)
 *     },
 *   },
 *   // Optional: Configure allowed redirect origins for security
 *   allowedRedirectOrigins: [
 *     'https://myapp.com',
 *     'https://auth.myapp.com'
 *   ],
 *   // Optional: Transform metadata when converting API errors to page errors
 *   transformErrorMeta: ({ baseMeta, originalMetadata }) => ({
 *     ...baseMeta, // Keep the base page info (title/description)
 *     // Preserve app-specific fields from the original API response
 *     account: originalMetadata?.account,
 *     site_info: originalMetadata?.site_info || { current_year: new Date().getFullYear() },
 *     user_preferences: originalMetadata?.user_preferences,
 *   }),
 *   // Optional: Custom status code handlers
 *   statusCodeHandlers: {
 *     // Handle payment required with API envelope redirect
 *     402: (statusCode, responseData, config) => {
 *       return {
 *         status: 'redirect',
 *         status_code: 200,
 *         request_id: responseData?.request_id || `redirect_${Date.now()}`,
 *         type: 'page',
 *         data: null,
 *         meta: { page: { title: 'Payment Required', description: 'Redirecting to payment page' } },
 *         error: null,
 *         redirect: { target: '/payment-required', permanent: false }
 *       };
 *     },
 *     // Custom handling for maintenance mode
 *     503: (statusCode, responseData, config) => {
 *       // Manually construct a page error response
 *       return {
 *         status: 'error',
 *         status_code: 503,
 *         request_id: responseData?.request_id || `maint_${Date.now()}`,
 *         type: 'page',
 *         data: null,
 *         meta: {
 *           page: {
 *             title: 'Maintenance Mode',
 *             description: 'Service temporarily unavailable for maintenance.'
 *           }
 *         },
 *         error: {
 *           code: 'maintenance_mode',
 *           message: 'Service temporarily unavailable for maintenance.'
 *         }
 *       };
 *     },
 *     // Override default 404 but fall back if needed
 *     404: (statusCode, responseData, config) => {
 *       if (responseData?.error?.code === 'special_not_found') {
 *         // Handle special case with manual response
 *         return {
 *           status: 'error',
 *           status_code: 404,
 *           request_id: responseData?.request_id || `404_${Date.now()}`,
 *           type: 'page',
 *           data: null,
 *           meta: { page: { title: 'Special Not Found', description: 'Special page not found' } },
 *           error: { code: 'special_not_found', message: 'Special page not found' }
 *         };
 *       }
 *       // Fall back to default handling
 *       return null;
 *     }
 *   }
 * };
 *
 * // Create loaders for each page type
 * const homeLoader = createPageLoader(config, 'home');
 * const dashboardLoader = createPageLoader(config, 'dashboard');
 * const profileLoader = createPageLoader(config, 'profile');
 *
 * // Use in React Router
 * const router = createBrowserRouter([
 *   { path: '/', loader: homeLoader, element: <HomePage /> },
 *   { path: '/dashboard', loader: dashboardLoader, element: <DashboardPage /> },
 *   { path: '/profile/:id', loader: profileLoader, element: <ProfilePage /> },
 * ]);
 * ```
 */

import { LoaderFunctionArgs, redirect } from "react-router";
import {
  PageResponseEnvelope,
  PageErrorResponse,
  RedirectInfo,
  BaseMeta,
  ErrorDetails,
} from "../api-envelope/api-envelope-types";

// Debug flag to enable/disable logging in the page loader
const DEBUG_PAGE_LOADER = true;

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
 * Internal default values - not exported, used for fallbacks and createDefaultPageLoaderConfig
 */

/**
 * Base error definition with title and description
 */
interface BaseErrorDefinition {
  title: string;
  description: string;
}

/**
 * Full error definition with title, description, message, and code
 */
interface FullErrorDefinition extends BaseErrorDefinition {
  message: string;
  code: string;
}

/**
 * Shared interface for all error defaults used in both DEFAULT_ERROR_DEFAULTS and PageLoaderConfig
 */
interface ErrorDefaults {
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
const DEFAULT_ERROR_DEFAULTS: ErrorDefaults = {
  notFound: {
    title: "Page Not Found",
    description: "The page you are looking for could not be found.",
    code: "not_found",
    message: "The requested resource was not found.",
  },
  internalError: {
    title: "Server Error",
    description: "An internal server error occurred.",
    code: "internal_server_error",
    message: "An internal server error occurred.",
  },
  authRequired: {
    title: "Authentication Required",
    description: "You must be logged in to access this page.",
  },
  accessDenied: {
    title: "Access Denied",
    description: "You do not have permission to access this page.",
    message: "You do not have permission to access this resource.",
    code: "access_denied",
  },
  genericError: {
    title: "Error",
    description: "An unexpected error occurred.",
    message: "An unexpected error occurred.",
    code: "unknown_error",
  },
  invalidResponse: {
    title: "Invalid Response",
    description: "The server returned an unexpected response format.",
    message: "The server returned an unexpected response format.",
    code: "invalid_response",
  },
  invalidRedirect: {
    title: "Invalid Redirect",
    description: "The server attempted an invalid redirect.",
    message: "Redirect target not specified in response",
    code: "invalid_redirect",
  },
  redirectNotFollowed: {
    title: "Redirect Not Followed",
    description: "HTTP redirects from the API are not supported.",
    message:
      "The API attempted to redirect the request, which is not supported.",
    code: "api_redirect_not_followed",
  },
  unsafeRedirect: {
    title: "Unsafe Redirect Blocked",
    description: "The redirect target is not allowed for security reasons.",
    message: "Unsafe redirect blocked",
    code: "unsafe_redirect",
  },
} as const;

const DEFAULT_CONNECTION_ERROR_MESSAGES = {
  server: "Internal server error: Unable to connect to the API service.",
  client:
    "Unable to connect to the API server. Please check your network connection and try again.",
} as const;

const DEFAULT_LOGIN_URL = "/login";
const DEFAULT_RETURN_TO_PARAM = "return_to";

/**
 * Default fallback request ID generator for error responses
 * Used when API doesn't provide a request_id (e.g., network errors, captive portals, etc.)
 * @param context - The context for the request ID ("error" or "redirect")
 */
const DEFAULT_FALLBACK_REQUEST_ID_GENERATOR = (
  context: "error" | "redirect" = "error",
) => `${context}_${Date.now()}`;

/**
 * Configuration object interface for the page loader system
 */
export interface PageLoaderConfig {
  /** Base URL for the API server (e.g., "http://localhost:3001" or "https://api.example.com") */
  apiBaseUrl: string;
  /** Default error constants for common scenarios */
  errorDefaults: ErrorDefaults;
  /**
   * Whether the application is running in development mode
   *
   * When true, detailed error information (like stack traces and error details)
   * will be included in error responses. When false, only user-friendly messages
   * are included for security.
   *
   * Defaults to checking process.env.NODE_ENV !== "production" if not explicitly set,
   * but you should explicitly set this for better Bun/Deno compatibility.
   *
   * @default process.env.NODE_ENV !== "production"
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
   * Function to generate fallback request IDs when none is provided in error responses
   * Called when creating error responses that don't have a request_id from the API
   * @param context - The context for the request ID ("error" or "redirect")
   * @returns A unique identifier string for the request
   */
  generateFallbackRequestID?: (context: "error" | "redirect") => string;
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
 * Creates a default configuration object with sensible defaults
 *
 * Note: isDevelopment is not set by default, so it will fall back to
 * checking process.env.NODE_ENV !== "production". For better Bun/Deno
 * compatibility, consider explicitly setting isDevelopment when creating
 * your config.
 */
export function createDefaultPageLoaderConfig(
  apiBaseUrl: string,
): PageLoaderConfig {
  return {
    apiBaseUrl,
    errorDefaults: DEFAULT_ERROR_DEFAULTS,
    connectionErrorMessages: DEFAULT_CONNECTION_ERROR_MESSAGES,
    loginUrl: DEFAULT_LOGIN_URL,
    returnToParam: DEFAULT_RETURN_TO_PARAM,
    generateFallbackRequestID: DEFAULT_FALLBACK_REQUEST_ID_GENERATOR,
  };
}

// Define a factory function to create page loaders with specific page types
export function createPageLoader(config: PageLoaderConfig, pageType: string) {
  return ({ request, params }: LoaderFunctionArgs) =>
    pageLoader({ request, params, pageType, config });
}

// Options interface for the page loader
export interface PageLoaderOptions {
  request: Request;
  params: Record<string, string | undefined>;
  pageType: string;
  config: PageLoaderConfig;
}

function decorateWithSsrOnlyData(
  response: PageResponseEnvelope,
  SSR_ONLY_DATA: Record<string, unknown>,
) {
  const isServer = typeof window === "undefined"; // detecting here again instead of passing to promote tree-shaking

  if (isServer) {
    return {
      ...response,
      __ssOnly: SSR_ONLY_DATA,
    };
  }

  return response;
}

/**
 * Creates a page error response, optionally preserving metadata from original API responses
 *
 * When an API endpoint returns an error with type "api", this function converts it to
 * a page error response (type "page") that React Router can handle. The metadata parameter
 * contains fields from the original API response that should be preserved (like account info).
 */
function createErrorResponse(
  config: PageLoaderConfig,
  statusCode: number,
  errorCode: string,
  message: string,
  requestID?: string,
  metadata?: {
    title?: string;
    description?: string;
    [key: string]: unknown;
  },
  errorDetails?: ErrorDetails,
): PageErrorResponse {
  // Default error response creation - use generic error as fallback
  let title = config.errorDefaults.genericError.title;
  let description = config.errorDefaults.genericError.description;

  if (statusCode === 404) {
    title = config.errorDefaults.notFound.title;
    description = config.errorDefaults.notFound.description;
  } else if (statusCode === 500) {
    title = config.errorDefaults.internalError.title;
    description = config.errorDefaults.internalError.description;
  } else if (statusCode === 401) {
    title = config.errorDefaults.authRequired.title;
    description = config.errorDefaults.authRequired.description;
  } else if (statusCode === 403) {
    title = config.errorDefaults.accessDenied.title;
    description = config.errorDefaults.accessDenied.description;
  }

  // Override with provided metadata if present
  if (metadata?.title) {
    title = metadata.title;
  }

  if (metadata?.description) {
    description = metadata.description;
  }

  const baseMeta: BaseMeta = {
    page: {
      title,
      description,
    },
  };

  // Transform meta if transformer is provided
  const finalMeta = config.transformErrorMeta
    ? config.transformErrorMeta({
        baseMeta,
        statusCode,
        errorCode,
        originalMetadata: metadata,
      })
    : baseMeta;

  return {
    status: "error",
    status_code: statusCode,
    request_id:
      requestID ||
      (config.generateFallbackRequestID
        ? config.generateFallbackRequestID("error")
        : DEFAULT_FALLBACK_REQUEST_ID_GENERATOR("error")),
    type: "page",
    data: null,
    meta: finalMeta as BaseMeta,
    error: {
      code: errorCode,
      message,
      ...(errorDetails ? { details: errorDetails } : {}),
    },
  } as PageErrorResponse;
}

/**
 * Helper function to check for and execute custom status code handlers
 */
function tryCustomStatusHandler(
  statusCode: number,
  responseData: unknown,
  config: PageLoaderConfig,
  ssrOnlyData: Record<string, unknown>,
): PageResponseEnvelope | null {
  // Check for specific status code handlers first (number or string)
  const specificHandler =
    config.statusCodeHandlers?.[statusCode] ||
    config.statusCodeHandlers?.[statusCode.toString()];

  // Check for wildcard handler as fallback
  const wildcardHandler = config.statusCodeHandlers?.["*"];

  const statusHandler = specificHandler || wildcardHandler;

  if (!statusHandler) {
    return null;
  }

  const customResult = statusHandler(statusCode, responseData, config);

  if (customResult === null || customResult === undefined) {
    if (DEBUG_PAGE_LOADER) {
      console.log(
        `Custom handler for status code ${statusCode} returned null/undefined, falling back to default handling`,
      );
    }

    return null;
  }

  if (DEBUG_PAGE_LOADER) {
    console.log(`Using custom handler for status code ${statusCode}`);
  }

  // Automatically decorate PageResponseEnvelope with SSR-only data
  return decorateWithSsrOnlyData(customResult, ssrOnlyData);
}

async function processRedirectResponse(
  config: PageLoaderConfig,
  responseData: Record<string, unknown>,
  ssrOnlyData: Record<string, unknown>,
): Promise<PageResponseEnvelope> {
  const redirectInfo = responseData.redirect as RedirectInfo;
  const target = redirectInfo.target;

  if (!target) {
    // If no target provided, return an error
    return decorateWithSsrOnlyData(
      createErrorResponse(
        config,
        400,
        config.errorDefaults.invalidRedirect.code,
        config.errorDefaults.invalidRedirect.message,
        responseData?.request_id as string,
        responseData?.meta as Record<string, unknown>,
      ),
      ssrOnlyData,
    );
  }

  // Validate redirect safety if allowedRedirectOrigins is configured
  if (!isSafeRedirect(target, config.allowedRedirectOrigins)) {
    return decorateWithSsrOnlyData(
      createErrorResponse(
        config,
        400,
        config.errorDefaults.unsafeRedirect.code,
        config.errorDefaults.unsafeRedirect.message,
        responseData?.request_id as string,
        responseData?.meta as Record<string, unknown>,
      ),
      ssrOnlyData,
    );
  }

  // If preserve_query is true and we have a URL object, preserve query params
  let redirectTarget = target;
  const currentUrl =
    typeof window !== "undefined" ? window.location.href : null;

  if (redirectInfo.preserve_query && currentUrl) {
    try {
      const url = new URL(currentUrl);
      // Only append query if the target doesn't already have query params
      if (!target.includes("?") && url.search) {
        redirectTarget = `${target}${url.search}`;
      }
    } catch (error) {
      if (DEBUG_PAGE_LOADER) {
        console.warn("Failed to preserve query parameters in redirect", error);
      }
    }
  }

  if (DEBUG_PAGE_LOADER) {
    console.log(
      `Application redirect to: ${redirectTarget} (${redirectInfo.permanent ? "permanent" : "temporary"})`,
    );
  }

  return redirect(redirectTarget, {
    // Use the appropriate React Router redirect status
    status: redirectInfo.permanent ? 301 : 302,
  }) as unknown as PageResponseEnvelope;
}

async function processApiResponse(
  response: Response,
  config: PageLoaderConfig,
): Promise<PageResponseEnvelope> {
  const isServer = typeof window === "undefined"; // detecting here again instead of passing to promote tree-shaking
  const statusCode = response.status;

  // Extract cookies from response when on server
  const cookies = isServer ? response.headers.getSetCookie() : [];
  const ssrOnlyData = {
    ...(isServer ? { cookies } : {}),
  };

  // Handle HTTP redirects explicitly before attempting to parse JSON
  if (
    response.type === "opaqueredirect" ||
    [301, 302, 303, 307, 308].includes(statusCode)
  ) {
    if (DEBUG_PAGE_LOADER) {
      console.warn(
        `API returned a HTTP redirect to: ${response.headers.get("Location")}`,
      );
    }

    return decorateWithSsrOnlyData(
      createErrorResponse(
        config,
        statusCode,
        config.errorDefaults.redirectNotFollowed.code,
        config.errorDefaults.redirectNotFollowed.message,
        config.generateFallbackRequestID
          ? config.generateFallbackRequestID("redirect")
          : DEFAULT_FALLBACK_REQUEST_ID_GENERATOR("redirect"),
        undefined,
        {
          originalStatus: statusCode,
          location: response.headers.get("Location"),
        },
      ),
      ssrOnlyData,
    );
  }

  // extract the response data and check if it is valid json
  let responseData;
  let isValidJson = false;

  try {
    responseData = await response.json();
    isValidJson = true;
  } catch {
    responseData = null;
  }

  if (DEBUG_PAGE_LOADER) {
    console.log("response Info", {
      isValidJson,
      statusCode,
      responseData,
    });
  }

  if (isValidJson) {
    // Check for custom status code handlers first
    const customHandlerResult = tryCustomStatusHandler(
      statusCode,
      responseData,
      config,
      ssrOnlyData,
    );

    if (customHandlerResult) {
      // If the custom handler returned a redirect, process it.
      if (
        customHandlerResult.status === "redirect" &&
        customHandlerResult.type === "page" &&
        customHandlerResult.redirect
      ) {
        return processRedirectResponse(
          config,
          customHandlerResult as unknown as Record<string, unknown>,
          ssrOnlyData,
        );
      }

      // Otherwise, the custom handler's response is final.
      return customHandlerResult;
    }

    // Check for redirect status - only for page-type responses with status 200
    // Our convention is that redirect responses always use status_code 200
    if (
      responseData?.status === "redirect" &&
      responseData?.type === "page" &&
      responseData?.redirect
    ) {
      return processRedirectResponse(config, responseData, ssrOnlyData);
    }

    // Continue with existing checks for page responses and auth redirects
    if (statusCode === 200 && responseData?.type === "page") {
      // successful page response as is
      return decorateWithSsrOnlyData(responseData, ssrOnlyData);
    } else {
      // if it already is a page / error response, return it as is
      if (responseData?.type === "page") {
        return decorateWithSsrOnlyData(responseData, ssrOnlyData);
      } else if (
        statusCode === 401 &&
        responseData?.status === "error" &&
        responseData?.error?.code === "authentication_required"
      ) {
        // redirect to login - check for return_to in the error details
        const returnTo = responseData?.error?.details?.return_to;
        const returnToParam = config.returnToParam || DEFAULT_RETURN_TO_PARAM;

        // Only include return_to in the URL if it has a value, and ensure it's properly encoded
        if (returnTo) {
          const encodedReturnTo = encodeURIComponent(returnTo);
          return redirect(
            `${config.loginUrl}?${returnToParam}=${encodedReturnTo}`,
          ) as unknown as PageResponseEnvelope;
        }

        return redirect(config.loginUrl) as unknown as PageResponseEnvelope;
      } else {
        // Convert API responses to page responses
        // This happens when the API returns an "api" type response but we need a "page" type
        // for React Router data loaders. We preserve metadata from the original API response.
        if (responseData?.type === "api") {
          if (responseData?.status === "error") {
            const requestID =
              responseData?.request_id ||
              (config.generateFallbackRequestID
                ? config.generateFallbackRequestID("error")
                : DEFAULT_FALLBACK_REQUEST_ID_GENERATOR("error"));

            if (statusCode === 404) {
              return decorateWithSsrOnlyData(
                createErrorResponse(
                  config,
                  404,
                  config.errorDefaults.notFound.code,
                  responseData?.error?.message ||
                    config.errorDefaults.notFound.message,
                  requestID,
                  responseData?.meta,
                ),
                ssrOnlyData,
              );
            } else if (statusCode === 500) {
              return decorateWithSsrOnlyData(
                createErrorResponse(
                  config,
                  500,
                  config.errorDefaults.internalError.code,
                  responseData?.error?.message ||
                    config.errorDefaults.internalError.message,
                  requestID,
                  responseData?.meta,
                  // If in development mode, include error details
                  (config.isDevelopment ??
                    process.env.NODE_ENV !== "production")
                    ? responseData?.error?.details
                    : undefined,
                ),
                ssrOnlyData,
              );
            } else if (statusCode === 403) {
              // access denied is different from the auth required error, meaning logged out
              return decorateWithSsrOnlyData(
                createErrorResponse(
                  config,
                  403,
                  config.errorDefaults.accessDenied.code,
                  responseData?.error?.message ||
                    config.errorDefaults.accessDenied.message,
                  requestID,
                  responseData?.meta,
                  responseData?.error?.details,
                ),
                ssrOnlyData,
              );
            } else {
              // Generic error response
              return decorateWithSsrOnlyData(
                createErrorResponse(
                  config,
                  statusCode,
                  responseData?.error?.code ||
                    config.errorDefaults.genericError.code,
                  responseData?.error?.message ||
                    config.errorDefaults.genericError.message,
                  requestID,
                  responseData?.meta,
                  responseData?.error?.details,
                ),
                ssrOnlyData,
              );
            }
          } else {
            // Success API response that should be a page response
            return decorateWithSsrOnlyData(
              createErrorResponse(
                config,
                500,
                config.errorDefaults.invalidResponse.code,
                config.errorDefaults.invalidResponse.message,
                responseData?.request_id,
                responseData?.meta,
              ),
              ssrOnlyData,
            );
          }
        } else {
          // Not an API response, create appropriate page error
          if (statusCode === 404) {
            return decorateWithSsrOnlyData(
              createErrorResponse(
                config,
                404,
                config.errorDefaults.notFound.code,
                config.errorDefaults.notFound.message,
              ),
              ssrOnlyData,
            );
          } else if (statusCode === 500) {
            return decorateWithSsrOnlyData(
              createErrorResponse(
                config,
                500,
                config.errorDefaults.internalError.code,
                config.errorDefaults.internalError.message,
              ),
              ssrOnlyData,
            );
          } else {
            // Generic error for any other status code
            return decorateWithSsrOnlyData(
              createErrorResponse(
                config,
                statusCode,
                "http_error",
                `HTTP Error: ${statusCode}`,
              ),
              ssrOnlyData,
            );
          }
        }
      }
    }
  } else {
    // Check for custom status code handlers for non-JSON responses
    const customHandlerResult = tryCustomStatusHandler(
      statusCode,
      null,
      config,
      ssrOnlyData,
    );

    if (customHandlerResult) {
      // If the custom handler returned a redirect, process it.
      if (
        customHandlerResult.status === "redirect" &&
        customHandlerResult.type === "page" &&
        customHandlerResult.redirect
      ) {
        return processRedirectResponse(
          config,
          customHandlerResult as unknown as Record<string, unknown>,
          ssrOnlyData,
        );
      }

      // Otherwise, the custom handler's response is final.
      return customHandlerResult;
    }

    // Not valid JSON response
    return decorateWithSsrOnlyData(
      createErrorResponse(
        config,
        statusCode || 500,
        config.errorDefaults.invalidResponse.code,
        config.errorDefaults.invalidResponse.message,
      ),
      ssrOnlyData,
    );
  }
}

/**
 * Helper function to validate if a redirect target is safe
 * @param target - The redirect target URL or path
 * @param allowedOrigins - Array of allowed origins, or undefined to disable validation
 * @returns true if the redirect is safe, false otherwise
 */
const isSafeRedirect = (target: string, allowedOrigins?: string[]): boolean => {
  // If allowedOrigins is undefined, disable validation (allow any redirect)
  if (allowedOrigins === undefined) {
    return true;
  }

  // Always allow relative paths (starting with "/")
  if (target.startsWith("/")) {
    return true;
  }

  // If allowedOrigins is an empty array, only allow relative paths (block all external URLs)
  if (allowedOrigins.length === 0) {
    return false;
  }

  // Check if the target starts with any of the allowed origins
  return allowedOrigins.some((origin) => target.startsWith(origin));
};

/**
 * Helper function to create base headers with Content-Type: application/json
 * Used by both server and client-side data fetching
 */
const createBaseHeaders = () => {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  return headers;
};

/**
 * Main page loader function that handles data fetching for a specific page type
 */
export async function pageLoader({
  request,
  params,
  pageType,
  config,
}: PageLoaderOptions): Promise<PageResponseEnvelope> {
  const isServer = typeof window === "undefined";

  // Get the API server URL (already normalized)
  const apiBaseUrl = config.apiBaseUrl;
  const apiEndpoint = `${apiBaseUrl}/v1/page_data/${pageType}`;

  // build the request body
  const url = new URL(request.url);

  // Convert params to ensure all values are strings
  const routeParams: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    routeParams[key] = value || "";
  }

  const requestBody = {
    route_params: routeParams, // react router params
    query_params: Object.fromEntries(
      // url query params
      url.searchParams.entries(),
    ),
    // Include the requested path and original URL for debugging
    request_path: url.pathname,
    original_url: request.url,
  };

  try {
    if (isServer) {
      if (DEBUG_PAGE_LOADER) {
        console.log(`Server side data fetching for ${pageType} page`);
      }

      // Set to JSON and copy relevant headers from ssr request to api server
      // Forward: cookies, language preferences, and tracking headers

      const headers = createBaseHeaders();

      // Properly access headers from the Request object
      const xssrRequest = request.headers.get("x-ssr-request");
      const originalIp = request.headers.get("x-original-ip");
      const userAgent = request.headers.get("user-agent");
      const correlationId = request.headers.get("x-correlation-id");
      const cookie = request.headers.get("cookie");
      const acceptLanguage = request.headers.get("accept-language");

      // Set headers if they exist
      if (xssrRequest) {
        headers.set("X-SSR-Request", xssrRequest);
      }

      if (originalIp) {
        headers.set("X-Original-IP", originalIp);
      }

      if (userAgent) {
        headers.set("X-Forwarded-User-Agent", userAgent);
      }

      if (correlationId) {
        headers.set("X-Correlation-ID", correlationId);
      }

      if (cookie) {
        headers.set("Cookie", cookie);
      }

      // Forward Accept-Language header for internationalization support
      if (acceptLanguage) {
        headers.set("Accept-Language", acceptLanguage);
      }

      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        redirect: "manual", // Don't automatically follow redirects
      });

      return processApiResponse(response, config);
    } else {
      if (DEBUG_PAGE_LOADER) {
        console.log(`Client side data fetching for ${pageType} page`);
      }

      // Client side data fetching
      const headers = createBaseHeaders();

      // Forward Accept-Language header for internationalization support
      // In the browser, navigator.languages provides the user's preferred languages
      if (typeof navigator !== "undefined") {
        if (navigator.languages && navigator.languages.length) {
          headers.set("Accept-Language", navigator.languages.join(","));
        } else if (navigator.language) {
          headers.set("Accept-Language", navigator.language);
        }
      }

      // On client side, we include credentials: 'include' to allow cookies to be sent
      const response = await fetch(apiEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
        credentials: "include", // This allows cookies to be sent with the request
        redirect: "manual", // Don't automatically follow redirects
      });

      return processApiResponse(response, config);
    }
  } catch (error) {
    if (DEBUG_PAGE_LOADER) {
      console.error("Error fetching page data:", error);
    }

    // Check for common connection errors
    const errorMessage =
      error instanceof Error
        ? error.message
        : "Failed to fetch data from server";

    const isConnectionError =
      errorMessage.includes("fetch failed") ||
      errorMessage.includes("Unable to connect") ||
      errorMessage.includes("ECONNREFUSED") ||
      errorMessage.includes("NetworkError");

    // Create appropriate message based on server/client context
    let friendlyMessage = errorMessage;
    if (isConnectionError) {
      friendlyMessage = isServer
        ? config.connectionErrorMessages?.server ||
          DEFAULT_CONNECTION_ERROR_MESSAGES.server
        : config.connectionErrorMessages?.client ||
          DEFAULT_CONNECTION_ERROR_MESSAGES.client;
    }

    // Network or other errors that prevent the fetch from completing
    // No cookies would be available here since the fetch failed
    return decorateWithSsrOnlyData(
      createErrorResponse(
        config,
        500,
        config.errorDefaults.internalError.code,
        friendlyMessage,
      ),
      {}, // No SSR-only data for failed fetches
    );
  }
}

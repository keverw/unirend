/**
 * Page Data Loader System
 * -----------------
 *
 * This is a centralized page data loader system that handles all route data fetching for the application.
 * Instead of having multiple specialized loaders for separate pages, we've consolidated all page data fetching
 * into this single data loader that communicates with our API server.
 *
 * How it works:
 * 1. Each route uses createPageDataLoader(config, pageType) to create a loader for that route
 * 2. The pageDataLoader makes a POST request to {apiBaseUrl}{pageDataEndpoint}/{pageType} with route params and query params
 *    (default endpoint: /api/v1/page_data/{pageType}, configurable via pageDataEndpoint option)
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
 * import { createPageDataLoader, createDefaultPageDataLoaderConfig } from './pageDataLoader';
 *
 * // Create a configuration (typically done once in your app setup)
 * const config = createDefaultPageDataLoaderConfig('http://localhost:3001');
 *
 * // Or create a custom configuration with your own titles/branding
 * const customConfig = {
 *   apiBaseUrl: 'https://api.myapp.com',
 *   pageDataEndpoint: '/api/v1/page_data', // Custom page data endpoint (default: '/api/v1/page_data')
 *   loginUrl: '/auth/login',
 *   returnToParam: 'redirect_to', // Custom query param name for login redirects
 *   isDevelopment: true, // Explicitly set for Bun/Deno compatibility
 *   timeoutMs: 15000, // Custom timeout in milliseconds (default: 10000)
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
 * const homeLoader = createPageDataLoader(config, 'home');
 * const dashboardLoader = createPageDataLoader(config, 'dashboard');
 * const profileLoader = createPageDataLoader(config, 'profile');
 *
 * // Use in React Router
 * export const routes: RouteObject[] = [
 *   { path: '/', loader: homeLoader, element: <HomePage /> },
 *   { path: '/dashboard', loader: dashboardLoader, element: <DashboardPage /> },
 *   { path: '/profile/:id', loader: profileLoader, element: <ProfilePage /> },
 * ];
 * ```
 */

import { LoaderFunctionArgs } from 'react-router';
import {
  PageResponseEnvelope,
  BaseMeta,
  APIResponseEnvelope,
} from '../api-envelope/api-envelope-types';
import type { SSRHelpers } from '../types';
import {
  createBaseHeaders,
  createErrorResponse,
  decorateWithSsrOnlyData,
  fetchWithTimeout,
} from './pageDataLoader-utils';
import {
  PageDataLoaderConfig,
  PageDataLoaderOptions,
  LocalPageHandler,
  LocalPageHandlerParams,
  LocalPageDataLoaderConfig,
  ErrorDefaults,
} from './pageDataLoader-types';
import { APIResponseHelpers } from '../api-envelope/response-helpers';
import {
  processRedirectResponse,
  processApiResponse,
} from './pageDataLoader-helpers';
import {
  DEBUG_PAGE_LOADER,
  DEFAULT_CONNECTION_ERROR_MESSAGES,
  DEFAULT_ERROR_DEFAULTS,
  DEFAULT_LOGIN_URL,
  DEFAULT_RETURN_TO_PARAM,
  DEFAULT_PAGE_DATA_ENDPOINT,
  DEFAULT_FALLBACK_REQUEST_ID_GENERATOR,
  DEFAULT_TIMEOUT_MS,
} from './pageDataLoader-consts';

/**
 * Creates a default configuration object with sensible defaults
 *
 * Note: isDevelopment is not set by default, so it will fall back to
 * checking process.env.NODE_ENV !== "production". For better Bun/Deno
 * compatibility, consider explicitly setting isDevelopment when creating
 * your config.
 */
export function createDefaultPageDataLoaderConfig(
  apiBaseUrl: string,
): PageDataLoaderConfig {
  // Deep-clone nested defaults to avoid shared references
  const errorDefaultsClone: ErrorDefaults = JSON.parse(
    JSON.stringify(DEFAULT_ERROR_DEFAULTS),
  ) as ErrorDefaults;

  const connectionErrorMessagesClone = {
    ...DEFAULT_CONNECTION_ERROR_MESSAGES,
  } as const;

  return {
    apiBaseUrl,
    pageDataEndpoint: DEFAULT_PAGE_DATA_ENDPOINT,
    errorDefaults: errorDefaultsClone,
    connectionErrorMessages: connectionErrorMessagesClone,
    loginUrl: DEFAULT_LOGIN_URL,
    returnToParam: DEFAULT_RETURN_TO_PARAM,
    generateFallbackRequestID: DEFAULT_FALLBACK_REQUEST_ID_GENERATOR,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };
}

// Define a factory function to create page data loaders with specific page types
export function createPageDataLoader(
  config: PageDataLoaderConfig,
  pageType: string,
): (args: LoaderFunctionArgs) => Promise<unknown>;
export function createPageDataLoader(
  config: LocalPageDataLoaderConfig,
  handler: LocalPageHandler,
): (args: LoaderFunctionArgs) => Promise<unknown>;
export function createPageDataLoader(
  config: PageDataLoaderConfig | LocalPageDataLoaderConfig,
  pageTypeOrHandler: string | LocalPageHandler,
) {
  // If the pageTypeOrHandler is a string, create a page data loader that uses the page type
  if (typeof pageTypeOrHandler === 'string') {
    const pageType = pageTypeOrHandler;

    return ({ request, params }: LoaderFunctionArgs) =>
      pageDataLoader({
        request,
        params,
        pageType,
        config: config as PageDataLoaderConfig,
      });
  }

  // If the pageTypeOrHandler is a LocalPageHandler, create a page data loader that uses the handler
  const handler = pageTypeOrHandler;
  return (args: LoaderFunctionArgs) =>
    localPageDataLoader(config as LocalPageDataLoaderConfig, handler, args);
}

/**
 * Main page data loader function that handles data fetching for a specific page type
 */
async function pageDataLoader({
  request,
  params,
  pageType,
  config,
}: PageDataLoaderOptions): Promise<PageResponseEnvelope> {
  const isServer = typeof window === 'undefined';
  // Unified development mode flag derived in order of precedence:
  // 1) SSRHelpers (authoritative on server), 2) config.isDevelopment, 3) NODE_ENV
  const SSRHelpers = (request as unknown as { SSRHelpers?: SSRHelpers })
    .SSRHelpers;

  const isDevelopment =
    (isServer ? SSRHelpers?.isDevelopment : undefined) ??
    config.isDevelopment ??
    process.env.NODE_ENV === 'development';

  // Get the API server URL (already normalized)
  const apiBaseUrl = config.apiBaseUrl;
  const pageDataEndpoint =
    config.pageDataEndpoint || DEFAULT_PAGE_DATA_ENDPOINT;

  // Single source of truth for the external page-data URL
  // Note: Internal short-circuit calls do NOT rely on this URL; they reuse the
  // same routing context we place in requestBody (route_params, query_params,
  // request_path, original_url) to ensure consistency.
  const apiEndpoint = `${apiBaseUrl}${pageDataEndpoint}/${pageType}`;

  // build the request body
  const url = new URL(request.url);

  // Convert params to ensure all values are strings
  const route_params: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    route_params[key] = value || '';
  }

  // Assemble the request body
  const requestBody = {
    route_params: route_params, // react router params
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
        const SSRHelpers = (request as unknown as { SSRHelper?: SSRHelpers })
          .SSRHelper;
        const hasInternalHandler = !!SSRHelpers?.handlers?.hasHandler(pageType);

        // eslint-disable-next-line no-console
        console.log('[pageDataLoader] server-side data fetching decision', {
          pageType,
          SSRHelpersAttached: !!SSRHelpers,
          hasInternalHandler,
          strategy: hasInternalHandler
            ? 'internal_short_circuit'
            : 'http_fetch',
        });
      }

      // If SSRHelper is available (not undefined) and there is a registered handler, try internal call first before falling back to HTTP fetch
      if (SSRHelpers?.handlers?.hasHandler(pageType)) {
        // Note: internal_short_circuit selected

        try {
          const outcome = await SSRHelpers.handlers.callHandler({
            originalRequest: SSRHelpers.fastifyRequest,
            controlledReply: SSRHelpers.controlledReply,
            pageType,
            timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            // Pass the exact same data that would be in the POST body
            route_params: requestBody.route_params,
            query_params: requestBody.query_params,
            request_path: requestBody.request_path,
            original_url: requestBody.original_url,
          });

          if (outcome.exists && outcome.result) {
            // Internal handler returned an envelope
            const result = outcome.result as PageResponseEnvelope;

            if (result.type === 'page') {
              if (
                result.status === 'redirect' &&
                result.type === 'page' &&
                result.redirect
              ) {
                return processRedirectResponse(
                  config,
                  result as unknown as Record<string, unknown>,
                  {},
                );
              }

              return decorateWithSsrOnlyData(result, {});
            }
          } else if (DEBUG_PAGE_LOADER) {
            // No internal handler; fall back to HTTP fetch
            // eslint-disable-next-line no-console
            console.warn(
              `[pageDataLoader] fallback to http_fetch for ${pageType}`,
            );
          }
        } catch (internalError) {
          if (DEBUG_PAGE_LOADER) {
            // eslint-disable-next-line no-console
            console.error(
              `[pageDataLoader] Internal handler error for ${pageType}; converting to 500 error`,
              internalError,
            );
          }

          // Choose a clearer message for internal handler timeouts vs. generic internal errors
          const isHandlerTimeout =
            internalError instanceof Error &&
            (internalError as unknown as { errorCode?: string }).errorCode ===
              'handler_timeout';

          // Safe, user-facing messages; do not expose internal error messages
          // For internal timeouts, reuse the server connection error message if provided
          const message = isHandlerTimeout
            ? config.connectionErrorMessages?.server ||
              DEFAULT_CONNECTION_ERROR_MESSAGES.server
            : config.errorDefaults.internalError.message;

          // Return a 500 error envelope immediately to avoid reattempt via HTTP
          return decorateWithSsrOnlyData(
            createErrorResponse(
              config,
              500,
              config.errorDefaults.internalError.code,
              message,
              undefined,
              undefined,
              isDevelopment
                ? internalError instanceof Error
                  ? {
                      name: internalError.name,
                      message: internalError.message,
                      stack: internalError.stack,
                      ...(isHandlerTimeout
                        ? {
                            errorCode: 'handler_timeout',
                            timeoutMs: (
                              internalError as unknown as { timeoutMs?: number }
                            ).timeoutMs,
                          }
                        : {}),
                    }
                  : { value: String(internalError) }
                : undefined,
            ),
            {},
          );
        }
      }

      // Set to JSON and copy relevant headers from ssr request to api server
      // Forward: cookies, language preferences, and tracking headers

      const headers = createBaseHeaders();

      // Properly access headers from the Request object
      const xssrRequest = request.headers.get('x-ssr-request');
      const originalIp = request.headers.get('x-ssr-original-ip');
      const userAgent = request.headers.get('user-agent');
      const correlationId = request.headers.get('x-correlation-id');
      const cookie = request.headers.get('cookie');
      const acceptLanguage = request.headers.get('accept-language');

      // Set headers if they exist
      if (xssrRequest) {
        headers.set('X-SSR-Request', xssrRequest);
      }

      if (originalIp) {
        headers.set('X-SSR-Original-IP', originalIp);
      }

      if (userAgent) {
        headers.set('X-SSR-Forwarded-User-Agent', userAgent);
      }

      if (correlationId) {
        headers.set('X-Correlation-ID', correlationId);
      }

      if (cookie) {
        headers.set('Cookie', cookie);
      }

      // Forward Accept-Language header for internationalization support
      if (acceptLanguage) {
        headers.set('Accept-Language', acceptLanguage);
      }

      const response = await fetchWithTimeout(
        apiEndpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          redirect: 'manual', // Don't automatically follow redirects
        },
        config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );

      return processApiResponse(response, config);
    } else {
      if (DEBUG_PAGE_LOADER) {
        // eslint-disable-next-line no-console
        console.log(`Client side data fetching for ${pageType} page`);
      }

      // Client side data fetching
      const headers = createBaseHeaders();

      // Forward Accept-Language header for internationalization support
      // In the browser, navigator.languages provides the user's preferred languages
      if (typeof navigator !== 'undefined') {
        if (navigator.languages && navigator.languages.length) {
          headers.set('Accept-Language', navigator.languages.join(','));
        } else if (navigator.language) {
          headers.set('Accept-Language', navigator.language);
        }
      }

      // On client side, we include credentials: 'include' to allow cookies to be sent
      const response = await fetchWithTimeout(
        apiEndpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          credentials: 'include', // This allows cookies to be sent with the request
          redirect: 'manual', // Don't automatically follow redirects
        },
        config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );

      return processApiResponse(response, config);
    }
  } catch (error) {
    if (DEBUG_PAGE_LOADER) {
      // eslint-disable-next-line no-console
      console.error('Error fetching page data:', error);
    }

    // Check for common connection errors
    const errorMessage =
      error instanceof Error
        ? error.message
        : 'Failed to fetch data from server';

    const isConnectionError =
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('Unable to connect') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('NetworkError') ||
      errorMessage.includes('Request timeout after'); // Treat timeout as connection error

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

/**
 * Local page data loader (framework does not perform HTTP or short-circuit calls)
 *
 * Purpose:
 * - Run a page data loader locally without the framework doing an HTTP fetch or short-circuit calls
 * - Preserve the same ergonomics as the normal loader: timeout handling,
 *   redirect support, envelope validation, and consistent error envelopes
 *
 * Notes:
 * - Your handler may still perform its own fetch/database calls; the timeout
 *   here applies to the entire handler execution
 * - The handler receives `LocalPageHandlerParams` (no Fastify request object)
 * - `invocation_origin` is set to "local" for debugging
 * - Timeout uses `config.timeoutMs` (0 disables); timeout message mirrors the
 *   HTTP path by using `connectionErrorMessages.server` when available
 */
async function localPageDataLoader<T = unknown, M extends BaseMeta = BaseMeta>(
  config: LocalPageDataLoaderConfig,
  handler: LocalPageHandler<T, M>,
  { request, params }: LoaderFunctionArgs,
): Promise<unknown> {
  const url = new URL(request.url);

  // Convert params to ensure all values are strings
  const route_params: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    route_params[key] = value || '';
  }

  // Assemble the local handler params with origin and routing context
  const localParams: LocalPageHandlerParams = {
    pageType: 'local',
    invocation_origin: 'local',
    route_params: route_params,
    query_params: Object.fromEntries(url.searchParams.entries()),
    request_path: url.pathname,
    original_url: request.url,
  };

  // Configure timeout (0 disables)
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Defer invocation to the microtask queue and normalize to a Promise.
  // Using Promise.resolve().then(() => ...) ensures synchronous throws from
  // the handler become Promise rejections instead of escaping before our
  // timeout race is set up. Non-Promise returns are treated as resolved values.
  const invocation = Promise.resolve().then(() => handler(localParams));

  // Attach a no-op catch when using a timeout to prevent a possible
  // unhandledRejection if the timeout "wins" and the handler later rejects.
  if (timeoutMs && timeoutMs > 0) {
    void invocation.catch(() => {});
  }

  // Track the timeout ID to ensure it is cleared regardless of timeout path
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  // Build a single promise that either resolves to the handler result or rejects on timeout
  const resultPromise: Promise<PageResponseEnvelope | APIResponseEnvelope> =
    // Check if a timeout is specified
    !timeoutMs || timeoutMs <= 0
      ? // No timeout specified, return the handler result immediately
        // Handler promise when no timer is specified
        (invocation as Promise<PageResponseEnvelope | APIResponseEnvelope>)
      : // If a timeout is specified, race the handler promise with a timer promise
        (Promise.race([
          // Handler promise
          invocation,
          // Timer promise
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              const error = new Error(`Request timeout after ${timeoutMs}ms`);
              (error as unknown as { errorCode: string }).errorCode =
                'handler_timeout';
              (error as unknown as { timeoutMs: number }).timeoutMs = timeoutMs;
              reject(error);
            }, timeoutMs);
          }),
        ]) as Promise<PageResponseEnvelope | APIResponseEnvelope>);

  try {
    // Ensure timer cleared regardless of outcome
    const result = await resultPromise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });

    // Validate that the handler returned a proper envelope object
    if (!APIResponseHelpers.isValidEnvelope(result)) {
      return createErrorResponse(
        config,
        500,
        config.errorDefaults.invalidResponse.code,
        config.errorDefaults.invalidResponse.message,
      );
    }

    // Handle API-style redirect envelopes (status: "redirect")
    if (
      result.status === 'redirect' &&
      result.type === 'page' &&
      result.redirect
    ) {
      return processRedirectResponse(
        config,
        result as unknown as Record<string, unknown>,
        {},
      );
    }

    // Success or error envelopes are returned as-is and decorated
    // Note:
    // - Status codes provided by the handler's envelope (status_code) are preserved.
    //   The SSR base renderer will read loaderData and set the HTTP status accordingly.
    // - SSR-only cookies are NOT available in the local path because there is no HTTP
    //   response to extract Set-Cookie headers from. If you need to set cookies, use
    //   the HTTP-backed loader path (API fetch) so cookies can be forwarded via __ssOnly.
    return decorateWithSsrOnlyData(result as PageResponseEnvelope, {});
  } catch (internalError) {
    // Determine dev mode (mirrors pageDataLoader)
    const isDevelopment =
      typeof process !== 'undefined'
        ? process.env.NODE_ENV === 'development'
        : config.isDevelopment === true;

    // Identify timeout errors produced by the race above
    const isHandlerTimeout =
      internalError instanceof Error &&
      (internalError as unknown as { errorCode?: string }).errorCode ===
        'handler_timeout';

    // Friendly message parity with HTTP fetch timeouts
    const message = isHandlerTimeout
      ? config.connectionErrorMessages?.server ||
        DEFAULT_CONNECTION_ERROR_MESSAGES.server
      : config.errorDefaults.internalError.message;

    // Build a standardized page error envelope
    return decorateWithSsrOnlyData(
      createErrorResponse(
        config,
        500,
        config.errorDefaults.internalError.code,
        message,
        undefined,
        undefined,
        isDevelopment
          ? internalError instanceof Error
            ? {
                name: internalError.name,
                message: internalError.message,
                stack: internalError.stack,
                ...(isHandlerTimeout
                  ? {
                      errorCode: 'handler_timeout',
                      timeoutMs: (
                        internalError as unknown as { timeoutMs?: number }
                      ).timeoutMs,
                    }
                  : {}),
              }
            : { value: String(internalError) }
          : undefined,
      ),
      {},
    );
  }
}

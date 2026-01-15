import type {
  BaseMeta,
  ErrorDetails,
  PageErrorResponse,
  PageResponseEnvelope,
} from '../api-envelope/api-envelope-types';
import {
  DEBUG_PAGE_LOADER,
  DEFAULT_FALLBACK_REQUEST_ID_GENERATOR,
  DEFAULT_TIMEOUT_MS,
} from './page-data-loader-consts';
import type {
  LocalPageDataLoaderConfig,
  PageDataLoaderConfig,
} from './page-data-loader-types';

/**
 * Helper function to create base headers with Content-Type: application/json
 * Used by both server and client-side data fetching
 */
export function createBaseHeaders() {
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  return headers;
}

export function decorateWithSsrOnlyData(
  response: PageResponseEnvelope,
  SSR_ONLY_DATA: Record<string, unknown>,
) {
  const isServer = typeof window === 'undefined'; // detecting here again instead of passing to promote tree-shaking

  if (isServer) {
    return {
      ...response,
      __ssOnly: SSR_ONLY_DATA,
    };
  }

  return response;
}

/**
 * Helper function to validate if a redirect target is safe
 * @param target - The redirect target URL or path
 * @param allowedOrigins - Array of allowed origins, or undefined to disable validation
 * @returns true if the redirect is safe, false otherwise
 */
export function isSafeRedirect(
  target: string,
  allowedOrigins?: string[],
): boolean {
  // If allowedOrigins is undefined, disable validation (allow any redirect)
  if (allowedOrigins === undefined) {
    return true;
  }

  // Always allow relative paths (starting with "/")
  if (target.startsWith('/')) {
    return true;
  }

  // If allowedOrigins is an empty array, only allow relative paths (block all external URLs)
  if (allowedOrigins.length === 0) {
    return false;
  }

  // Check if the target starts with any of the allowed origins
  return allowedOrigins.some((origin) => target.startsWith(origin));
}

/**
 * Fetch with timeout using AbortController
 *
 * Prevents requests from hanging indefinitely by canceling them after the specified timeout.
 * Uses AbortController which is supported in Node 16+ and all modern browsers.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options (headers, method, body, etc.)
 * @param timeoutMs - Timeout in milliseconds (0 to disable timeout)
 * @returns Promise that resolves to Response or rejects with timeout/network error
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  // If timeout is 0 or negative, use regular fetch without timeout
  if (timeoutMs <= 0) {
    return fetch(url, options);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    // Abort the controller to ensure cleanup in case of non-timeout errors
    controller.abort();

    // Check if the error is due to abortion (timeout)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }

    // Re-throw other errors (network issues, etc.)
    throw error;
  } finally {
    clearTimeout(timer); // Prevent Node.js warning on fulfilled request
  }
}

/**
 * Creates a page error response, optionally preserving metadata from original API responses
 *
 * When an API endpoint returns an error with type "api", this function converts it to
 * a page error response (type "page") that React Router can handle. The metadata parameter
 * contains fields from the original API response that should be preserved (like account info).
 */
export function createErrorResponse(
  config: PageDataLoaderConfig | LocalPageDataLoaderConfig,
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
    status: 'error',
    status_code: statusCode,
    request_id:
      requestID ||
      (config.generateFallbackRequestID
        ? config.generateFallbackRequestID('error')
        : DEFAULT_FALLBACK_REQUEST_ID_GENERATOR('error')),
    type: 'page',
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
export function applyCustomHttpStatusHandler(
  statusCode: number,
  responseData: unknown,
  config: PageDataLoaderConfig,
  ssrOnlyData: Record<string, unknown>,
): PageResponseEnvelope | null {
  // Check for specific status code handlers first (number or string)
  const specificHandler =
    config.statusCodeHandlers?.[statusCode] ||
    config.statusCodeHandlers?.[statusCode.toString()];

  // Check for wildcard handler as fallback
  const wildcardHandler = config.statusCodeHandlers?.['*'];

  const statusHandler = specificHandler || wildcardHandler;

  if (!statusHandler) {
    return null;
  }

  const customResult = statusHandler(statusCode, responseData, config);

  if (customResult === null || customResult === undefined) {
    if (DEBUG_PAGE_LOADER) {
      // eslint-disable-next-line no-console
      console.log(
        `Custom handler for status code ${statusCode} returned null/undefined, falling back to default handling`,
      );
    }

    return null;
  }

  if (DEBUG_PAGE_LOADER) {
    // eslint-disable-next-line no-console
    console.log(`Using custom handler for status code ${statusCode}`);
  }

  // Automatically decorate PageResponseEnvelope with SSR-only data
  return decorateWithSsrOnlyData(customResult, ssrOnlyData);
}

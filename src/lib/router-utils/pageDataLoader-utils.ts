import { PageResponseEnvelope } from "../api-envelope/api-envelope-types";
import { DEFAULT_TIMEOUT_MS } from "./pageDataLoader-consts";

/**
 * Helper function to create base headers with Content-Type: application/json
 * Used by both server and client-side data fetching
 */
export function createBaseHeaders() {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  return headers;
}

export function decorateWithSsrOnlyData(
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
  if (target.startsWith("/")) {
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
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }

    // Re-throw other errors (network issues, etc.)
    throw error;
  } finally {
    clearTimeout(timer); // Prevent Node.js warning on fulfilled request
  }
}

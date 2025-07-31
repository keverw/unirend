import { PageResponseEnvelope } from "../api-envelope/api-envelope-types";

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

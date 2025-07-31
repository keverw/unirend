import { ErrorDefaults } from "./pageDataLoader-types";

/**
 * Internal default values - not exported publicly, used for fallbacks and createDefaultPageLoaderConfig
 */

export const DEFAULT_ERROR_DEFAULTS: ErrorDefaults = {
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

export const DEFAULT_CONNECTION_ERROR_MESSAGES = {
  server: "Internal server error: Unable to connect to the API service.",
  client:
    "Unable to connect to the API server. Please check your network connection and try again.",
} as const;

export const DEFAULT_LOGIN_URL = "/login";
export const DEFAULT_RETURN_TO_PARAM = "return_to";
export const DEFAULT_PAGE_DATA_ENDPOINT = "/v1/page_data";

/**
 * Default fallback request ID generator for error responses
 * Used when API doesn't provide a request_id (e.g., network errors, captive portals, etc.)
 * @param context - The context for the request ID ("error" or "redirect")
 */
export const DEFAULT_FALLBACK_REQUEST_ID_GENERATOR = (
  context: "error" | "redirect" = "error",
) => `${context}_${Date.now()}`;

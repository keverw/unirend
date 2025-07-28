// Page metadata - for SSR and SEO
export interface PageMetadata {
  title: string;
  description: string;
  keywords?: string;
  canonical?: string;
  og?: {
    title?: string;
    description?: string;
    image?: string;
  };
}

// --- API Response Envelope (for AJAX calls) ---

/**
 * Base meta structure with required page metadata
 */
export interface BaseMeta {
  page: PageMetadata;
}

// Error details
export interface ErrorDetails {
  [key: string]: unknown; // Allow any other error-specific details
}

/**
 * Error object structure for API error responses
 */
export interface ErrorObject {
  code: string;
  message: string;
  details?: ErrorDetails; // Can include stacktrace in development mode if passed in the error object
}

// Redirect information
export interface RedirectInfo {
  target: string;
  permanent: boolean;
  preserve_query?: boolean;
}

/**
 * API Success Response with extensible meta
 *
 * @template T - The data type
 * @template M - Additional meta properties (extends BaseMeta)
 *
 * @example
 * // Basic usage (no extra meta)
 * type BasicResponse = APISuccessResponse<User>;
 *
 * @example
 * // With required extra meta fields
 * interface CustomMeta extends BaseMeta {
 *   pagination: { page: number; total: number };
 *   cache: { expires: string };
 * }
 * type PaginatedResponse = APISuccessResponse<User[], CustomMeta>;
 */
export interface APISuccessResponse<T, M extends BaseMeta = BaseMeta> {
  status: "success";
  status_code: number;
  request_id: string;
  type: "api";
  data: T;
  meta: M;
  error: null;
}

/**
 * API Error Response with extensible meta
 *
 * @template M - Additional meta properties (extends BaseMeta)
 */
export interface APIErrorResponse<M extends BaseMeta = BaseMeta> {
  status: "error";
  status_code: number;
  request_id: string;
  type: "api";
  data: null;
  meta: M;
  error: ErrorObject;
}

/**
 * API response envelope as a discriminated union
 *
 * @template T - The data type for success responses
 * @template M - Additional meta properties (extends BaseMeta)
 */
export type APIResponseEnvelope<T = unknown, M extends BaseMeta = BaseMeta> =
  | APISuccessResponse<T, M>
  | APIErrorResponse<M>;

// --- Page Response Envelope (for SSR/data loaders) ---

/**
 * Page Success Response with extensible meta
 *
 * @template T - The data type
 * @template M - Additional meta properties (extends BaseMeta)
 */
export interface PageSuccessResponse<T, M extends BaseMeta = BaseMeta> {
  status: "success";
  status_code: number;
  request_id: string;
  type: "page";
  data: T;
  meta: M;
  error: null;
}

/**
 * Page Error Response with extensible meta
 *
 * @template M - Additional meta properties (extends BaseMeta)
 */
export interface PageErrorResponse<M extends BaseMeta = BaseMeta> {
  status: "error";
  status_code: number;
  request_id: string;
  type: "page";
  data: null;
  meta: M;
  error: ErrorObject;
}

/**
 * Page Redirect Response with extensible meta
 *
 * @template M - Additional meta properties (extends BaseMeta)
 */
export interface PageRedirectResponse<M extends BaseMeta = BaseMeta> {
  status: "redirect";
  status_code: 200; // Always use 200 to avoid confusion with HTTP redirects
  request_id: string;
  type: "page";
  data: null;
  meta: M;
  error: null;
  redirect: RedirectInfo;
}

/**
 * Page response envelope as a discriminated union
 *
 * @template T - The data type for success responses
 * @template M - Additional meta properties (extends BaseMeta)
 */
export type PageResponseEnvelope<T = unknown, M extends BaseMeta = BaseMeta> =
  | PageSuccessResponse<T, M>
  | PageErrorResponse<M>
  | PageRedirectResponse<M>;

/**
 * OpenGraph fields. Every member becomes a `<meta property="og:…">`, with the key prefixed.
 *
 * `title`, `description`, and `image` are named because they are the ones nearly every page sets,
 * so they autocomplete and are checked. The index signature carries the rest of the vocabulary
 * (`type`, `url`, `site_name`, `locale`, `image:width`, and so on) without Unirend having to
 * enumerate a spec it does not own.
 *
 * An index signature is safe here in a way it is not on `PageMetadata` itself: every key under
 * `og` renders the same way, as its own prefixed property, so an unrecognized one is still
 * meaningful. At the top level the fields render differently from each other (`title` is an
 * element, `canonical` is a link), so an unrecognized key there has no defined meaning at all.
 *
 * A key that already starts with `og:` is not prefixed twice, so `{ 'og:type': 'article' }` and
 * `{ type: 'article' }` both produce `og:type`.
 */
export interface PageMetadataOpenGraph {
  title?: string;
  description?: string;
  image?: string;
  [property: string]: string | undefined;
}

/**
 * The attributes an envelope-provided tag may never carry, whichever kind of tag it is.
 *
 * Written out as `never` so that asking for one is a build error rather than a tag that renders
 * without it. The index signature on the tag types below is what lets an entry carry `media`,
 * `sizes`, `hreflang`, and the rest of an open vocabulary, and left on its own it would also
 * accept every attribute the projection is built to strip. A handler would then compile, ship,
 * and find out from a development warning. Same argument as the union on `PageMetadataMetaTag`:
 * the shape the projection refuses should not type-check.
 *
 * `http-equiv` instructs the browser rather than describing the page (`refresh` navigates,
 * `content-security-policy` sets policy) and this value arrives over the wire. `style` and
 * `children` would make React throw on a void element, so the only spellings a handler could send
 * are the ones that fail. The rest are React's own props, and `on*` is an event handler, which has
 * no business arriving over the wire either.
 *
 * This is the readable half of the rule, not the whole of it. The projection matches these
 * lowercased, because a browser does, so a `HTTP-EQUIV` or an `ONLOAD` is refused at runtime just
 * the same. Enumerating every casing is not worth doing here: the type is for the handler writing
 * the entry, and the sanitizer is for the wire. See `FORBIDDEN_TAG_ATTRIBUTES` in
 * `UnirendHead/page-metadata-tags.ts`, which is the list this mirrors.
 */
interface ForbiddenTagAttributes {
  'http-equiv'?: never;
  httpEquiv?: never;
  style?: never;
  children?: never;
  dangerouslySetInnerHTML?: never;
  key?: never;
  ref?: never;
  suppressHydrationWarning?: never;
  [handler: `on${string}`]: never;
}

/**
 * The attributes every entry in `PageMetadata.tags` may carry, whichever kind of tag it is.
 *
 * `content` is required. Any other attribute (`media`, `sizes`, and so on) passes through as
 * written, which is what the index signature is for, barring the ones
 * {@link ForbiddenTagAttributes} rules out.
 */
interface PageMetadataMetaTagAttributes extends ForbiddenTagAttributes {
  content: string;
  [attribute: string]: string | undefined;
}

/**
 * A `<meta>` a handler wants on the page that the named `PageMetadata` fields cannot express.
 *
 * `content` is required, and so is one of `name` or `property`, since a meta with neither has no
 * identity to override or be overridden by. A union rather than two optional fields, so that a
 * meta the projection would skip is a build error rather than a tag that quietly never appears,
 * the same way `PageMetadataTag` makes naming neither `meta` nor `link` one.
 *
 * `http-equiv` is deliberately not part of this. It is the one meta attribute that instructs the
 * browser rather than describing the page (`refresh` navigates, `content-security-policy` sets
 * policy), and this value arrives over the wire, so it is refused rather than honored. Declare an
 * `http-equiv` meta as a `UnirendHead` child, where it lives in your own code. It is one of the
 * names {@link ForbiddenTagAttributes} rules out, so writing it here does not compile.
 */
export type PageMetadataMetaTag =
  | (PageMetadataMetaTagAttributes & { name: string; property?: string })
  | (PageMetadataMetaTagAttributes & { property: string; name?: string });

/**
 * A `<link>` a handler wants on the page. `rel` and `href` are required, everything else
 * (`hreflang`, `type`, `sizes`, `as`, and so on) passes through as written, barring the ones
 * {@link ForbiddenTagAttributes} rules out.
 *
 * `rel="stylesheet"` is refused too, but that is a value rather than a name, so it stays a runtime
 * check. `rel` is a token set with an open vocabulary and cannot be enumerated as a type.
 */
export interface PageMetadataLinkTag extends ForbiddenTagAttributes {
  rel: string;
  href: string;
  [attribute: string]: string | undefined;
}

/**
 * One entry in `PageMetadata.tags`. Exactly one of `meta` or `link` per entry, which is what tells
 * Unirend which element to render without guessing from the attributes.
 */
export type PageMetadataTag =
  | { meta: PageMetadataMetaTag; link?: never }
  | { link: PageMetadataLinkTag; meta?: never };

// Page metadata - for SSR and SEO
export interface PageMetadata {
  title: string;
  description: string;
  keywords?: string;
  canonical?: string;
  og?: PageMetadataOpenGraph;

  /**
   * Head tags beyond the named fields above, for the ones Unirend has no opinion about
   * (`twitter:*`, an app version, a feed link, an `hreflang` set).
   *
   * The named fields stay a closed, typo-checked surface: `PageMetadata` has no index signature,
   * so a mistyped `title` key is a build error rather than a silently emitted meta named after
   * the typo. This is the deliberate way in for everything else.
   *
   * A tag declared as a `UnirendHead` child still wins over an entry here with the same key, and
   * an entry whose key one of the named fields already produced is skipped, so a `rel="canonical"`
   * here never doubles up with the `canonical` field.
   */
  tags?: PageMetadataTag[];
}

// --- API Response Envelope (for AJAX calls) ---

/**
 * Base meta structure with required page metadata
 */
export interface BaseMeta {
  page?: PageMetadata;
}

// Error details - can be an object with key-value pairs or an array
export interface ErrorDetails {
  [key: string]: unknown; // Allow any other error-specific details
}

/**
 * Error details value - supports both object and array formats
 *
 * @example Object format (structured errors)
 * { field: 'email', reason: 'invalid format', code: 'VALIDATION_ERROR' }
 *
 * @example Array format (multiple validation errors with type field)
 * [
 *   { field: 'email', type: 'invalid_email', message: 'Must be a valid email address' },
 *   { field: 'password', type: 'invalid_length', message: 'Must be at least 8 characters long' }
 * ]
 *
 * @example Array format (error trace)
 * ['Step 1 failed', 'Rollback initiated', 'Cleanup completed']
 */
export type ErrorDetailsValue = ErrorDetails | unknown[];

/**
 * Error object structure for API error responses
 */
export interface ErrorObject {
  code: string;
  message: string;
  details?: ErrorDetailsValue; // Can include stack trace in development mode (via `stack` field), validation errors, or any error-specific details
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
  status: 'success';
  status_code: number;
  request_id: string;
  request_timestamp?: string;
  type: 'api';
  data: T;
  meta: M;
  error?: null;
}

/**
 * API Error Response with extensible meta
 *
 * @template M - Additional meta properties (extends BaseMeta)
 */
export interface APIErrorResponse<M extends BaseMeta = BaseMeta> {
  status: 'error';
  status_code: number;
  request_id: string;
  request_timestamp?: string;
  type: 'api';
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
  APISuccessResponse<T, M> | APIErrorResponse<M>;

// --- Page Response Envelope (for SSR/data loaders) ---

/**
 * Page Success Response with extensible meta
 *
 * @template T - The data type
 * @template M - Additional meta properties (extends BaseMeta)
 */
export interface PageSuccessResponse<T, M extends BaseMeta = BaseMeta> {
  status: 'success';
  status_code: number;
  request_id: string;
  request_timestamp?: string;
  type: 'page';
  data: T;
  meta: M;
  error?: null;
  ssr_request_context?: Record<string, unknown>;
}

/**
 * Page Error Response with extensible meta
 *
 * @template M - Additional meta properties (extends BaseMeta)
 */
export interface PageErrorResponse<M extends BaseMeta = BaseMeta> {
  status: 'error';
  status_code: number;
  request_id: string;
  request_timestamp?: string;
  type: 'page';
  data: null;
  meta: M;
  error: ErrorObject;
  ssr_request_context?: Record<string, unknown>;
}

/**
 * Page Redirect Response with extensible meta
 *
 * @template M - Additional meta properties (extends BaseMeta)
 */
export interface PageRedirectResponse<M extends BaseMeta = BaseMeta> {
  status: 'redirect';
  status_code: 200; // Always use 200 to avoid confusion with HTTP redirects
  request_id: string;
  request_timestamp?: string;
  type: 'page';
  data: null;
  meta: M;
  error?: null;
  redirect: RedirectInfo;
  ssr_request_context?: Record<string, unknown>;
}

/**
 * Page response envelope as a discriminated union
 *
 * @template T - The data type for success responses
 * @template M - Additional meta properties (extends BaseMeta)
 */
export type PageResponseEnvelope<T = unknown, M extends BaseMeta = BaseMeta> =
  PageSuccessResponse<T, M> | PageErrorResponse<M> | PageRedirectResponse<M>;

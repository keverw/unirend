import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifyRequest,
  FastifyReply,
  RouteHandler,
} from 'fastify';
import type {
  PluginMetadata,
  PluginHostInstance,
  PluginModeWithEnvelopeHelpers,
  FastifyHookName,
  SafeRouteOptions,
  ControlledReply,
  APIResponseHelpersClass,
  PluginAPIRouteShortcuts,
  PluginPageDataHandlerShortcuts,
  HTTPSOptions,
  WebResponse,
  APIClosingHandlerFn,
  WebClosingHandlerFn,
  SplitClosingHandler,
  APINotFoundHandlerFn,
  SplitNotFoundHandler,
  NotFoundRequest,
  PageDataNotFoundContext,
} from '../types';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { DEFAULT_API_PREFIX, DEFAULT_PAGE_DATA_ENDPOINT } from './consts';
import { generateDefault503ClosingPage } from './error-page-utils';
import { parseHostHeader, getDomain } from 'lifecycleion/domain-utils';
import { getDevMode } from 'lifecycleion/dev-mode';
import { sendRawErrorEnvelopeResponse } from './error-envelope-send';
import type { DomainInfo } from './domain-info';
import { ulid } from 'ulid';

/**
 * Normalize an API prefix to ensure it has a leading slash and no trailing slash.
 *
 * Handles: "api", "/api", "/api/", "api/", "//api//" → "/api"
 *
 * Special handling:
 * - `false` returns `false` (API disabled)
 * - `null`, `undefined`, or empty/whitespace-only string returns the default prefix
 *
 * @param prefix - The prefix to normalize, or false to disable API handling
 * @param defaultPrefix - Default prefix to use when input is null/undefined/empty (defaults to DEFAULT_API_PREFIX)
 * @returns Normalized prefix string, or false if API is disabled
 */

export function normalizeAPIPrefix(
  prefix: string | false | null | undefined,
  defaultPrefix: string = DEFAULT_API_PREFIX,
): string | false {
  // Explicit false means API is disabled
  if (prefix === false) {
    return false;
  }

  // null, undefined, or empty/whitespace-only string → use default
  const trimmed = (prefix ?? '').trim();
  let normalized = trimmed.length === 0 ? defaultPrefix : trimmed;

  // Add leading slash if missing
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  // Collapse multiple consecutive slashes to a single slash
  normalized = normalized.replace(/\/+/g, '/');

  // Remove trailing slash if present (but keep root "/" as-is)
  if (normalized.endsWith('/') && normalized.length > 1) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Normalize a page data endpoint name to have no leading or trailing slashes.
 *
 * Handles: "/page_data", "page_data/", "/page_data/" → "page_data"
 *
 * Special handling:
 * - `null`, `undefined`, or empty/whitespace-only string returns the default endpoint
 *
 * @param endpoint - The endpoint name to normalize
 * @param defaultEndpoint - Default endpoint to use when input is null/undefined/empty (defaults to DEFAULT_PAGE_DATA_ENDPOINT)
 * @returns Normalized endpoint string (never false, page data is always needed)
 */
export function normalizePageDataEndpoint(
  endpoint: string | null | undefined,
  defaultEndpoint: string = DEFAULT_PAGE_DATA_ENDPOINT,
): string {
  // null, undefined, or empty/whitespace-only string → use default
  const trimmed = (endpoint ?? '').trim();
  let normalized = trimmed.length === 0 ? defaultEndpoint : trimmed;

  // Collapse multiple consecutive slashes to a single slash
  normalized = normalized.replace(/\/+/g, '/');

  // Remove leading slash if present
  if (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }

  // Remove trailing slash if present
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Result of classifying a request path for API/page-data handling
 */
export interface RequestClassification {
  /** True if path starts with the API prefix (e.g., /api/...) */
  isAPI: boolean;
  /** True if path is a page-data endpoint (e.g., /api/v1/page_data/home) */
  isPageData: boolean;
}

/**
 * Classify a request URL to determine if it's an API request and/or a page-data request.
 *
 * Page data endpoints are always registered under the API prefix, so isPageData will
 * only be true when isAPI is also true.
 *
 * @param url - Request URL (may include query string, which will be stripped internally)
 * @param apiPrefix - The API prefix to match against (e.g., "/api"), or false if API is disabled
 * @param pageDataEndpoint - The page data endpoint name (e.g., "page_data")
 * @returns Object with isAPI and isPageData booleans
 *
 * @example
 * classifyRequest('/api/v1/page_data/home', '/api', 'page_data')
 * // => { isAPI: true, isPageData: true }
 *
 * classifyRequest('/api/users?id=123', '/api', 'page_data')
 * // => { isAPI: true, isPageData: false }
 *
 * classifyRequest('/about', '/api', 'page_data')
 * // => { isAPI: false, isPageData: false }
 *
 * classifyRequest('/api/users', false, 'page_data')
 * // => { isAPI: false, isPageData: false } (API disabled)
 */
export function classifyRequest(
  url: string,
  apiPrefix: string | false,
  pageDataEndpoint: string,
): RequestClassification {
  // IMPORTANT: apiPrefix should be pre-normalized (e.g., "/api" with leading slash, no trailing)
  // or false if API is disabled

  // IMPORTANT: pageDataEndpoint should be pre-normalized (e.g., "page_data" with no slashes)
  // Callers are responsible for normalizing these values once at startup

  // Extract pathname (strip query string if present)
  const rawPath = url.split('?')[0];

  // If API is disabled (prefix is false), nothing is an API request
  if (apiPrefix === false) {
    return { isAPI: false, isPageData: false };
  }

  // Check if this is an API request (path starts with prefix)
  // Special case: "/" prefix means ALL paths are API paths
  const isRootPrefix = apiPrefix === '/';
  const isAPI = isRootPrefix
    ? rawPath.startsWith('/')
    : !!apiPrefix &&
      (rawPath.startsWith(apiPrefix + '/') || rawPath === apiPrefix);

  // Page data is always under API prefix, so if not API, can't be page data
  if (!isAPI) {
    return { isAPI: false, isPageData: false };
  }

  // Strip API prefix and check for page data endpoint pattern
  // Matches: /{pageDataEndpoint} or /v{n}/{pageDataEndpoint}
  // For root prefix, we don't strip anything (pathAfterPrefix starts with /)
  const pathAfterPrefix = isRootPrefix
    ? rawPath
    : rawPath.slice(apiPrefix.length);

  // Page data path pattern: /{pageDataEndpoint} (e.g., "/page_data")
  const pageDataPath = '/' + pageDataEndpoint;

  // Check direct match: /{pageDataEndpoint} or /{pageDataEndpoint}/...
  let isPageData =
    pathAfterPrefix === pageDataPath ||
    pathAfterPrefix.startsWith(pageDataPath + '/');

  // If not matched, check versioned pattern: /v{digits}/{pageDataEndpoint}...
  if (!isPageData && pathAfterPrefix.startsWith('/v')) {
    // Scan for digits after /v (e.g., /v1 → i=3, /v100 → i=5)
    // Using manual charCodeAt parsing instead of regex for better performance
    // since this runs on every request in hot path
    let i = 2; // start after '/v'

    while (
      i < pathAfterPrefix.length &&
      pathAfterPrefix.charCodeAt(i) >= 48 && // '0'
      pathAfterPrefix.charCodeAt(i) <= 57 // '9'
    ) {
      i++;
    }

    // Valid version needs at least one digit (/v1, /v100 — not just /v)
    if (i > 2) {
      const pathAfterVersion = pathAfterPrefix.slice(i);
      isPageData =
        pathAfterVersion === pageDataPath ||
        pathAfterVersion.startsWith(pageDataPath + '/');
    }
  }

  return { isAPI, isPageData };
}

/**
 * Creates a default JSON error response using the envelope pattern.
 * Used by both APIServer and SSRServer for consistent error handling.
 * @param request - The Fastify request object
 * @param error - The error that occurred
 * @param isDevelopment - Whether running in development mode
 * @param apiPrefix - API prefix for request classification (e.g., "/api"), or false if API is disabled
 * @param pageDataEndpoint - Page data endpoint name (e.g., "page_data")
 * @returns JSON error response object
 */

export function createDefaultAPIErrorResponse(
  HelpersClass: APIResponseHelpersClass,
  request: FastifyRequest,
  error: Error,
  isDevelopment: boolean,
  apiPrefix: string | false,
  pageDataEndpoint: string,
): unknown {
  const { isPageData } = classifyRequest(
    request.url,
    apiPrefix,
    pageDataEndpoint,
  );

  const statusCode =
    (error as Error & { statusCode?: number }).statusCode || 500;
  const errorCode =
    statusCode === 500 ? 'internal_server_error' : 'request_error';
  const errorMessage = isDevelopment ? error.message : 'Internal Server Error';
  const errorDetails = isDevelopment ? { stack: error.stack } : undefined;

  if (isPageData) {
    return HelpersClass.createPageErrorResponse({
      request,
      statusCode,
      errorCode,
      errorMessage,
      errorDetails,
      pageMetadata: {
        title: 'Error',
        description: 'An error occurred while processing your request',
      },
    });
  }

  return HelpersClass.createAPIErrorResponse({
    request,
    statusCode,
    errorCode,
    errorMessage,
    errorDetails,
  });
}

/**
 * Names the shape of a handler return value without exposing any of it.
 *
 * Safe to log anywhere: it carries no application data, only the type. `null`
 * and arrays are reported distinctly, since `typeof` collapses both to
 * `'object'` and those are exactly the two cases worth telling apart when
 * diagnosing what a handler actually returned.
 */
export function describeHandlerResult(handlerResult: unknown): string {
  if (handlerResult === null) {
    return 'null';
  }

  if (Array.isArray(handlerResult)) {
    return 'array';
  }

  return typeof handlerResult;
}

/**
 * Records what a handler returned onto a handler-bug error.
 *
 * `handlerResponseType` is always attached, because it is a bare type name and
 * cannot carry application data. The value itself is attached **only in
 * development**, because it is arbitrary application data: a handler that
 * returned the wrong shape may well have returned credentials, tokens, or
 * personal data, and these errors are serialized into the configured logger,
 * which commonly forwards to a third-party sink. Production keeps the type,
 * the message, and the route, which is what identifies the handler; the value
 * is reproducible locally, where it is safe to look at.
 *
 * Every site that reports an offending handler return value goes through here
 * so the dev/production split cannot drift between them.
 */
export function attachHandlerResponseToError(
  error: Error,
  handlerResult: unknown,
): void {
  (error as unknown as { handlerResponseType: string }).handlerResponseType =
    describeHandlerResult(handlerResult);

  if (getDevMode()) {
    (error as unknown as { handlerResponse: unknown }).handlerResponse =
      handlerResult;
  }
}

/**
 * Creates a default JSON 404 not-found response using the envelope pattern.
 * Used by both APIServer and SSRServer for consistent 404 handling.
 * @param request - The Fastify request object, or the stripped not-found view
 *   of it. A custom `APIResponseHelpersClass` receives whatever is passed here,
 *   so `resolveAPINotFoundResponse` passes the view for the same reason it
 *   hands one to a custom not-found handler.
 * @param apiPrefix - API prefix for request classification (e.g., "/api"), or false if API is disabled
 * @param pageDataEndpoint - Page data endpoint name (e.g., "page_data")
 * @param isPageDataOverride - Forces the page-data branch instead of deriving
 *   it from the request URL. `resolveAPINotFoundResponse` always passes it, and
 *   has to: the view it passes as `request` carries the frontend URL for a page
 *   data request, so re-deriving here would answer an API envelope where an
 *   HTTP miss answers a page one. Omitting it is only correct where the raw
 *   request is passed and its URL is the one to classify, which today is the
 *   plain-web branch in api-server.ts.
 * @returns JSON 404 response object
 */
export function createDefaultAPINotFoundResponse(
  HelpersClass: APIResponseHelpersClass,
  request: FastifyRequest | NotFoundRequest,
  apiPrefix: string | false,
  pageDataEndpoint: string,
  isPageDataOverride?: boolean,
): unknown {
  const { isPageData } =
    isPageDataOverride === undefined
      ? classifyRequest(request.url, apiPrefix, pageDataEndpoint)
      : { isPageData: isPageDataOverride };

  const statusCode = 404;

  if (isPageData) {
    return HelpersClass.createPageErrorResponse({
      request,
      statusCode,
      errorCode: 'not_found',
      errorMessage: 'Page Not Found',
      pageMetadata: {
        title: 'Not Found',
        description: 'The requested page could not be found',
      },
    });
  }

  return HelpersClass.createAPIErrorResponse({
    request,
    statusCode,
    errorCode: 'not_found',
    errorMessage: 'Resource Not Found',
  });
}

/**
 * Not-found handler in its base (non-generic) form.
 *
 * Servers that are generic over their APIResponseHelpers class widen to this
 * when handing the option to resolveAPINotFoundResponse, which invokes the
 * handler with the class configured on that server.
 */
export type APINotFoundHandlerOption =
  APINotFoundHandlerFn | SplitNotFoundHandler;

/**
 * Configuration for the shared API/page-data not-found resolution.
 *
 * Scope boundary: this resolver is API/page-data only, and every caller enters
 * it under `isAPI`. Because classifyRequest reports `isAPI: false` whenever
 * `apiPrefix === false`, the plain-web branches (a split handler's `.web`, the
 * web-only function form, and the built-in HTML 404 page) are unreachable from
 * here and stay in api-server.ts. That precondition is also why there is no
 * `functionHandlerType` discriminator (unlike ClosingResponseConfig): inside
 * this resolver a bare function is always an APINotFoundHandlerFn.
 */
export interface APINotFoundResolutionConfig {
  handler?: APINotFoundHandlerOption;
  serverLabel: string;
  HelpersClass: APIResponseHelpersClass;
  apiPrefix: string | false;
  pageDataEndpoint: string;
}

/**
 * Resolves the 404 envelope for an API or page-data request that matched no
 * route. Called by both servers' not-found handlers so the two can never drift.
 *
 * Sets the status code and Cache-Control on the reply when one is given and
 * returns the envelope body. It never calls reply.send() itself, so the caller
 * returning this value keeps wrapThenable's single-send contract intact.
 *
 * `request.trigger404()` resolves through here too, which is what makes a
 * triggered 404 byte-identical to a genuine route miss instead of a lookalike
 * rebuilt at the call site. Anything added here that only the not-found
 * handlers should see would break that silently, so the guard is the
 * `trigger404 byte-equality matrix` describe blocks in trigger-404.test.ts and
 * trigger-404-ssr.test.ts: they run the same request against a server that
 * triggers and a server that never registered the route, and compare the raw
 * bodies.
 */
/**
 * The page data context a not-found handler receives, read off the loader's
 * POST body.
 *
 * Used on the HTTP path, where the loader's request body is parsed before the
 * not-found handler runs even though no route matched. The SSR short-circuit
 * passes its own equivalent instead, since it never builds an HTTP request.
 *
 * Returns undefined when this is not a page data request or the body is not
 * the shape the loader sends, which is what a direct curl to the endpoint
 * looks like. Both paths then agree on undefined.
 */
/**
 * A plain object, or an empty one for anything else a caller may have sent.
 *
 * The container only, deliberately. A registered page data route validates
 * these fields the same way, as an object that is not an array, and leaves the
 * values alone. Filtering values here would make an HTTP miss disagree with
 * the SSR short-circuit, which passes the route's own unfiltered params, and
 * that disagreement is the thing this context exists to remove.
 *
 * So `routeParams` is as accurate as it is for a registered handler, no more:
 * a caller sending `{ id: 123 }` yields a number where the type says string,
 * on both paths equally.
 */
function asPlainObject<V>(value: unknown): Record<string, V> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, V>;
}

export function derivePageDataNotFoundContext(
  request: FastifyRequest,
  pageDataEndpoint: string,
  apiPrefix: string | false,
): PageDataNotFoundContext | undefined {
  const body = request.body;

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return undefined;
  }

  const fields = body as Record<string, unknown>;
  const originalURL = fields.original_url;
  const requestPath = fields.request_path;

  if (typeof originalURL !== 'string' || typeof requestPath !== 'string') {
    return undefined;
  }

  // Walk the URL from the front rather than searching for the endpoint
  // segment. A first match would misread a prefix that contains the same word,
  // so `/page_data/service/v1/page_data/home` would report
  // `service/v1/page_data/home` as the page type instead of `home`, and the
  // short-circuit would then disagree with the HTTP path about what was
  // missing. Everything after the endpoint is kept, so a namespaced page type
  // such as `marketing/home` survives where taking the last segment would not.
  let rest = request.url.split('?')[0] ?? '';

  // Root is left alone. `normalizeAPIPrefix` keeps `/` as-is, and slicing it
  // would take the URL's only leading slash with it, so `/v1/page_data/home`
  // would become `v1/page_data/home` and match nothing below.
  if (apiPrefix && apiPrefix !== '/') {
    if (!rest.startsWith(apiPrefix)) {
      return undefined;
    }

    rest = rest.slice(apiPrefix.length);
  }

  // Optional version segment, as in `/v1`.
  rest = rest.replace(/^\/v\d+/, '');

  const marker = `/${pageDataEndpoint}/`;

  if (!rest.startsWith(marker)) {
    return undefined;
  }

  return {
    pageType: rest.slice(marker.length),
    // Checked rather than cast, to the same depth a registered route checks
    // them. An unregistered page type never reaches that validation, so a
    // caller can send `route_params` as a string or an array, and a bare cast
    // would hand a custom handler something that is not an object at all.
    routeParams: asPlainObject<string>(fields.route_params),
    queryParams: asPlainObject<unknown>(fields.query_params),
    requestPath,
    originalURL,
  };
}

/**
 * The view of a request that a not-found handler is given.
 *
 * `params`, `routeOptions`, and `is404` are removed, because they are the one
 * thing that could tell a `request.trigger404()` apart from a genuine miss. A
 * trigger runs on a request that matched a route and carries that route's
 * params and URL, while a real miss carries Fastify's wildcard params, no
 * route URL, and `is404 === true`. A handler reading any of them would answer
 * differently for the two, making a gated route distinguishable from an
 * unregistered one.
 *
 * Removing them for every caller is what makes the two paths agree. Faking a
 * miss on the trigger path instead was tried and does not work: the real
 * `routeOptions` is a twelve-key object holding Fastify's own 404 handler,
 * schema, and config, and a stub of it makes `routeOptions.config` throw where
 * a real miss would not.
 *
 * Prototype-based, so every other property, decoration, and getter reads
 * through to the real request unchanged and nothing is copied. The request
 * itself cannot be modified in any case, since `is404` and `routeOptions` are
 * readonly on it.
 *
 * Used by both sites that invoke a custom not-found handler: this file's
 * resolver, and the plain-web branch in `api-server.ts`.
 */
export function createNotFoundRequestView(
  request: FastifyRequest,
  pageData?: PageDataNotFoundContext,
): NotFoundRequest {
  return Object.create(request, {
    params: { value: undefined, enumerable: true },
    routeOptions: { value: undefined, enumerable: true },
    is404: { value: undefined, enumerable: true },
    // For a page data request, `url` and `method` describe the page the
    // visitor asked for rather than the transport that carried the lookup.
    //
    // Those two are the last thing that differed between the two ways this is
    // reached. A genuine miss arrives as `POST /api/v1/page_data/account`,
    // while the SSR short-circuit runs on the page request itself, `GET
    // /account`. Presenting the frontend view makes them agree, and it is the
    // more useful of the two, since a not-found page wants to name the page.
    // Neither value is invented: both paths carry it, the HTTP one in the
    // loader's body and the short-circuit in the loader context.
    //
    // `GET` because that is the request the frontend is describing. A client
    // side navigation has no page request of its own, and naming the page it
    // navigated to is still the right description.
    ...(pageData
      ? {
          url: { value: pageData.originalURL, enumerable: true },
          method: { value: 'GET', enumerable: true },
        }
      : {}),
  }) as NotFoundRequest;
}

export async function resolveAPINotFoundResponse({
  request,
  reply,
  classification,
  pageDataContext,
  handler,
  serverLabel,
  HelpersClass,
  apiPrefix,
  pageDataEndpoint,
}: APINotFoundResolutionConfig & {
  request: FastifyRequest;
  /** Omitted on the SSR internal short-circuit path, which has no HTTP response of its own */
  reply?: FastifyReply;
  /**
   * Forces the classification instead of deriving it from `request.url`.
   *
   * Only the SSR internal short-circuit path passes this: it runs on the page
   * request, whose URL is the web route rather than the page-data endpoint, so
   * deriving would produce an API envelope where the HTTP fallback for the very
   * same page type produces a page one.
   */
  classification?: { isAPI: boolean; isPageData: boolean };
  /**
   * The frontend's description of this page data request. Passed by the SSR
   * short-circuit, which has it directly and builds no HTTP request to read it
   * from. Derived from the loader's POST body otherwise.
   */
  pageDataContext?: PageDataNotFoundContext;
}): Promise<unknown> {
  const { isAPI, isPageData } =
    classification ?? classifyRequest(request.url, apiPrefix, pageDataEndpoint);

  // Built for every path, not just the custom-handler one. The routing state it
  // strips is the one thing that could tell a request.trigger404() apart from a
  // genuine miss, and a custom APIResponseHelpersClass reads the request too,
  // so the default envelope below has to be built from the same view.
  const pageData = isPageData
    ? (pageDataContext ??
      derivePageDataNotFoundContext(request, pageDataEndpoint, apiPrefix))
    : undefined;

  const handlerRequest = createNotFoundRequestView(request, pageData);

  if (handler) {
    try {
      let customResponse: { status_code?: number } | undefined;

      if (isSplitHandler<Partial<SplitNotFoundHandler>>(handler)) {
        // Split form lets mixed API + web servers customize each handler
        // independently. A split carrying only `.web` has nothing for us here
        // and falls through to the default envelope.
        if (isAPI && handler.api) {
          customResponse = await Promise.resolve(
            handler.api(handlerRequest, isPageData, {
              APIResponseHelpers: HelpersClass,
              pageData,
            }),
          );
        }
      } else if (typeof handler === 'function') {
        // Function form. Callers only reach this resolver under isAPI, so the
        // function is always the API/page envelope form.
        customResponse = await Promise.resolve(
          handler(handlerRequest, isPageData, {
            APIResponseHelpers: HelpersClass,
            pageData,
          }),
        );
      }

      if (customResponse) {
        const statusCode = customResponse.status_code || 404;
        reply?.code(statusCode).header('Cache-Control', 'no-store');

        return customResponse;
      }

      // No handler matched this case - fall through to default
    } catch (handlerError) {
      // If custom handler fails, fall back to default
      request.log.error(
        { err: handlerError, method: request.method, url: request.url },
        `[${serverLabel}] Custom not-found handler failed`,
      );
    }
  }

  // Default case (also used when a split handler is missing its api entry).
  //
  // The view rather than the raw request, so a custom APIResponseHelpersClass
  // cannot read the routing state that differs between a trigger and a miss.
  // `isPageData` is passed explicitly for the same reason it is on the SSR
  // short-circuit: the view's `url` is the frontend one for a page data
  // request, so re-deriving the classification from it here would disagree with
  // the classification everything above was resolved under.
  const response = createDefaultAPINotFoundResponse(
    HelpersClass,
    handlerRequest,
    apiPrefix,
    pageDataEndpoint,
    isPageData,
  );

  const statusCode = (response as { status_code?: number }).status_code || 404;

  reply?.code(statusCode).header('Cache-Control', 'no-store');

  return response;
}

/**
 * Creates a default JSON 503 shutdown response using the envelope pattern.
 * Used by both APIServer and SSRServer for requests that arrive while closing.
 * @param request - The Fastify request object
 * @param isPageData - Whether the request targets the page-data endpoint
 * @returns JSON 503 response object
 */
export function createDefaultAPIClosingResponse(
  HelpersClass: APIResponseHelpersClass,
  request: FastifyRequest,
  isPageData: boolean,
): unknown {
  const statusCode = 503;
  const errorCode = 'service_unavailable';
  const errorMessage = 'Server is shutting down';

  if (isPageData) {
    return HelpersClass.createPageErrorResponse({
      request,
      statusCode,
      errorCode,
      errorMessage,
      pageMetadata: {
        title: 'Service Unavailable',
        description: 'The server is shutting down. Please try again shortly.',
      },
    });
  }

  return HelpersClass.createAPIErrorResponse({
    request,
    statusCode,
    errorCode,
    errorMessage,
  });
}

/**
 * Creates the default web 503 shutdown response.
 * Used by API, SSR, static, and redirect servers for web requests while closing.
 */
export function createDefaultWebClosingResponse(): WebResponse {
  return {
    contentType: 'html',
    content: generateDefault503ClosingPage(),
    statusCode: 503,
  };
}

type ClosingFunctionHandlerType = 'api' | 'web';

/**
 * Closing handler in its base (non-generic) form.
 *
 * Servers that are generic over their APIResponseHelpers class widen to this
 * when handing the option to registerClosingResponseHook, which invokes the
 * handler with the class configured on that server.
 */
export type ClosingHandlerOption =
  APIClosingHandlerFn | WebClosingHandlerFn | SplitClosingHandler;

interface ClosingResponseConfig {
  handler?: ClosingHandlerOption;
  functionHandlerType: ClosingFunctionHandlerType;
  serverLabel: string;
  HelpersClass: APIResponseHelpersClass;
  apiPrefix: string | false;
  pageDataEndpoint: string;
}

interface ClosingResponseContext extends ClosingResponseConfig {
  request: FastifyRequest;
  reply: FastifyReply;
}

/**
 * Resolves the payload sent by registerClosingResponseHook when the server is
 * stopping. The resolver sets status/cache/content headers on the reply and
 * returns the body that the hook will pass to sendClosingPayload().
 */
export async function resolveClosingResponse({
  request,
  reply,
  handler,
  functionHandlerType,
  serverLabel,
  HelpersClass,
  apiPrefix,
  pageDataEndpoint,
}: ClosingResponseContext): Promise<unknown> {
  // Closing responses need the same API/page-data classification as normal
  // errors so defaults and split handlers return the expected response shape.
  const { isAPI, isPageData } = classifyRequest(
    request.url,
    apiPrefix,
    pageDataEndpoint,
  );

  if (handler) {
    try {
      if (isSplitHandler<Partial<SplitClosingHandler>>(handler)) {
        // Split form lets mixed API + web servers customize each handler
        // independently. Missing handlers fall through to Unirend defaults.
        if (isAPI && handler.api) {
          const apiResponse = await Promise.resolve(
            handler.api(request, isPageData, {
              APIResponseHelpers: HelpersClass,
            }),
          );

          const statusCode = apiResponse.status_code || 503;
          reply.code(statusCode).header('Cache-Control', 'no-store');
          return apiResponse;
        }

        if (!isAPI && handler.web) {
          const webResponse = await Promise.resolve(handler.web(request));

          return prepareWebResponse(reply, webResponse, 503);
        }
      } else if (functionHandlerType === 'api' && isAPI) {
        // Function form follows the server's primary response type. APIServer
        // uses API envelopes, while non-API web requests fall through to the
        // default web response unless split form provides a web handler.
        const apiHandler = handler as APIClosingHandlerFn;
        const apiResponse = await Promise.resolve(
          apiHandler(request, isPageData, {
            APIResponseHelpers: HelpersClass,
          }),
        );

        const statusCode = apiResponse.status_code || 503;
        reply.code(statusCode).header('Cache-Control', 'no-store');
        return apiResponse;
      } else if (functionHandlerType === 'web' && !isAPI) {
        // SSR/static/redirect servers use web responses for function form.
        // API/page-data requests fall through to the default API envelope unless
        // split form provides an API handler.
        const webHandler = handler as WebClosingHandlerFn;
        const webResponse = await Promise.resolve(webHandler(request));

        return prepareWebResponse(reply, webResponse, 503);
      }
    } catch (handlerError) {
      request.log.error(
        { err: handlerError, method: request.method, url: request.url },
        `[${serverLabel}] Custom closing handler failed`,
      );
    }
  }

  // No custom handler matched, or the matched handler failed. API and page-data
  // requests fall back to the standard error envelope so clients see the same
  // shape as other API failures.
  if (isAPI && apiPrefix) {
    const response = createDefaultAPIClosingResponse(
      HelpersClass,
      request,
      isPageData,
    );

    const statusCode =
      (response as { status_code?: number }).status_code || 503;

    reply.code(statusCode).header('Cache-Control', 'no-store');

    return response;
  }

  // Web requests fall back to the built-in HTML 503 page. This also covers
  // servers with API handling disabled because classifyRequest reports them as
  // non-API requests.
  return prepareWebResponse(reply, createDefaultWebClosingResponse(), 503);
}

export function sendClosingPayload(
  reply: FastifyReply,
  payload: unknown,
): FastifyReply {
  if (
    payload !== null &&
    typeof payload === 'object' &&
    !Buffer.isBuffer(payload)
  ) {
    return reply.type('application/json').send(JSON.stringify(payload));
  }

  return reply.send(payload);
}

export function registerClosingResponseHook(
  fastify: FastifyInstance,
  isStopping: () => boolean,
  responseConfig: ClosingResponseConfig,
): void {
  fastify.addHook('onRequest', (request, reply, done) => {
    if (!isStopping()) {
      done();
      return;
    }

    Promise.resolve(
      resolveClosingResponse({ ...responseConfig, request, reply }),
    )
      .then((payload) => {
        sendClosingPayload(reply, payload);
      })
      .catch(done);
  });
}

/**
 * Check if a handler is the split form (object with api and/or web).
 * Either handler can be optional - missing handlers fall through to defaults.
 */
export function isSplitHandler<T extends { api?: unknown; web?: unknown }>(
  handler: unknown,
): handler is T {
  if (handler === null || typeof handler !== 'object') {
    return false;
  }

  // It's split form if it has at least one of api/web as a function
  const obj = handler as Record<string, unknown>;
  const hasAPIHandler = 'api' in obj && typeof obj.api === 'function';
  const hasWebHandler = 'web' in obj && typeof obj.web === 'function';

  return hasAPIHandler || hasWebHandler;
}

export function prepareWebResponse(
  reply: FastifyReply,
  response: WebResponse,
  defaultStatusCode: number,
): unknown {
  const statusCode = response.statusCode ?? defaultStatusCode;
  reply.code(statusCode).header('Cache-Control', 'no-store');

  // Set Content-Type but do NOT call reply.send() here.
  // The callers returns the content so wrapThenable makes exactly one reply.send() call.
  if (response.contentType === 'json') {
    reply.type('application/json');
  } else if (response.contentType === 'html') {
    reply.type('text/html');
  } else {
    reply.type('text/plain');
  }

  return response.content;
}

const DEFERRED_REPLY_ACTION_SENTINEL = Symbol('unirend.deferred-reply-action');

/**
 * Wrap a route handler to throw a helpful error if reply.send() is called.
 *
 * Async route handlers must return the payload directly instead of calling
 * reply.send(). In Fastify 5, returning a value from an async handler causes
 * wrapThenable to call reply.send(payload) exactly once. If the handler also
 * calls reply.send() manually, wrapThenable fires a second send while the
 * async onSend pipeline is still pending — causing an ERR_HTTP_HEADERS_SENT
 * crash or silent response corruption.
 *
 * Correct pattern:
 *   reply.code(201).header('X-Foo', 'bar');
 *   return { your: 'data' };  // ✓
 *
 * Forbidden pattern:
 *   return reply.send({ your: 'data' });  // ✗ — double-send race
 *
 * Special case:
 *   return reply.redirect('/login');  // ✓ — redirect is normalized to headers
 *   and status only so Fastify still performs the single final send itself
 *
 *   return reply.callNotFound();  // ✓ — delegates the remainder of the request
 *   to Fastify's not-found pipeline, which owns the final send
 */
function guardRouteHandler(handler: RouteHandler): RouteHandler {
  return async function guardedHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    // Temporarily replace reply.send so any call from inside the handler body
    // throws immediately with a helpful message. We restore it in `finally` so
    // that wrapThenable can still call reply.send(returnValue) after the handler
    // resolves — that single wrapThenable-driven send is the correct path.
    const originalSend = (
      reply as unknown as { send: (...args: unknown[]) => unknown }
    ).send.bind(reply);
    const originalRedirect = reply.redirect.bind(reply);
    const originalCallNotFound = reply.callNotFound.bind(reply);
    let deferredActionKind: 'redirect' | 'callNotFound' | null = null;
    let deferredRedirectURL: string | undefined;
    let deferredRedirectCode: number | undefined;
    let handlerResult: unknown;

    (reply as unknown as { send: unknown }).send = function (
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      ...args: unknown[]
    ) {
      throw new Error(
        'Do not call reply.send() inside a unirend plugin route handler.\n' +
          'Set status and headers with reply.code() / reply.header(), then return the payload:\n' +
          '  ✓  reply.code(201); return { ok: true };\n' +
          '  ✗  return reply.send({ ok: true });  // causes double-send race in Fastify 5\n\n' +
          'reply.send() is only safe inside Fastify lifecycle hooks (addHook), not in route handlers.',
      );
    };

    reply.redirect = (url: string, code?: number) => {
      // Record the redirect intent but defer the real Fastify redirect call
      // until after this wrapper restores the original reply methods.
      deferredActionKind = 'redirect';
      deferredRedirectURL = url;
      deferredRedirectCode = code;
      return DEFERRED_REPLY_ACTION_SENTINEL as unknown as FastifyReply;
    };

    // The sentinel return is a thenable FastifyReply where Fastify types
    // callNotFound as void — intentional, so `return reply.callNotFound()`
    // hands the sentinel back to the wrapper for deferred-action detection.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    reply.callNotFound = () => {
      // Record the delegation intent but defer the real Fastify helper until
      // after this wrapper restores the original reply methods.
      deferredActionKind = 'callNotFound';
      return DEFERRED_REPLY_ACTION_SENTINEL as unknown as FastifyReply;
    };

    try {
      handlerResult = await (
        handler as (
          this: unknown,
          req: FastifyRequest,
          reply: FastifyReply,
        ) => unknown
      ).call(this, request, reply);
    } finally {
      // Restore so wrapThenable's reply.send(returnedPayload) works normally.
      (reply as unknown as { send: unknown }).send = originalSend;
      reply.redirect = originalRedirect;
      reply.callNotFound = originalCallNotFound;
    }

    const actionKind = deferredActionKind;

    if (actionKind) {
      if (handlerResult !== DEFERRED_REPLY_ACTION_SENTINEL) {
        const delegatedHelper =
          actionKind === 'redirect'
            ? 'reply.redirect()'
            : 'reply.callNotFound()';

        throw new Error(
          `When using ${delegatedHelper} inside a unirend plugin route handler, return it immediately.\n` +
            'Do not continue execution or return a payload after delegating the response.',
        );
      }

      switch (actionKind) {
        case 'redirect':
          return originalRedirect(
            deferredRedirectURL as string,
            deferredRedirectCode,
          );
        case 'callNotFound':
          return originalCallNotFound();
      }
    }

    return handlerResult;
  };
}

/**
 * Creates a controlled wrapper around the Fastify instance
 * This prevents plugins from accessing dangerous methods
 * @param fastifyInstance The real Fastify instance
 * @param shouldDisableRootWildcard Whether to disable root wildcard routes (e.g., "*" or "/*")
 * @returns Controlled interface for plugins
 */

export function createControlledInstance<
  H extends APIResponseHelpersClass = APIResponseHelpersClass,
>(
  fastifyInstance: FastifyInstance,
  shouldDisableRootWildcard: boolean,
  apiShortcuts: PluginAPIRouteShortcuts<H>,
  pageDataHandlerShortcuts: PluginPageDataHandlerShortcuts<H>,
  apiResponseHelpersClass: H,
): PluginHostInstance<PluginModeWithEnvelopeHelpers, H> {
  const earlyResponseHooks = new Set<FastifyHookName>([
    'onRequest',
    'preValidation',
    'preHandler',
  ]);

  return {
    register: <Options extends Record<string, unknown> = Record<string, never>>(
      plugin: FastifyPluginAsync<Options> | FastifyPluginCallback<Options>,
      opts?: Options,
    ) => {
      // Note: Fastify's register method has complex overloads that don't align perfectly
      // with our simplified generic constraints. These casts are necessary for compatibility.
      return fastifyInstance.register(
        plugin as Parameters<typeof fastifyInstance.register>[0],
        opts as Parameters<typeof fastifyInstance.register>[1],
      ) as unknown as Promise<void>;
    },
    addHook: (
      hookName: FastifyHookName,
      handler: (
        request: FastifyRequest,
        reply: FastifyReply,
        ...args: unknown[]
      ) => unknown,
    ) => {
      // Prevent plugins from overriding critical hooks
      if (hookName === 'onRoute' || hookName.includes('*')) {
        throw new Error(
          'Plugins cannot register catch-all route hooks that would conflict with SSR',
        );
      }
      // Fastify has two incompatible hook completion styles:
      // - async/promise hooks finish when the promise resolves
      // - callback hooks finish when done() is called
      //
      // We wrap plugin hooks so plain sync handlers don't hang. For early
      // request hooks, use callback-style wrapping because these hooks may
      // intentionally terminate the request with reply.send()/reply.redirect().
      // Calling done() after that would continue the lifecycle and can trigger
      // double-send/header-sent errors, so the wrapper only calls done() when
      // the hook did not already send a response.
      const wrappedHandler = earlyResponseHooks.has(hookName)
        ? (
            request: FastifyRequest,
            reply: FastifyReply,
            done: (error?: Error) => void,
          ) => {
            // Fastify's sent/header flags can lag behind an in-progress
            // reply.send()/reply.redirect() on the live server, so track calls
            // made inside the hook body directly.
            const replyWithSend = reply as unknown as {
              send: (...args: unknown[]) => unknown;
            };
            const originalSend = replyWithSend.send;
            let didSend = false;

            replyWithSend.send = function (
              this: FastifyReply,
              ...args: unknown[]
            ) {
              didSend = true;
              return originalSend.apply(this, args);
            };

            const restoreSend = () => {
              replyWithSend.send = originalSend;
            };

            const didAlreadySend = () =>
              didSend || reply.sent || reply.raw.headersSent;

            try {
              const result = handler(request, reply);

              // Async early hooks are allowed. Wait for them and then advance
              // only if they did not send the response while awaiting.
              if (
                result &&
                typeof (result as Promise<unknown>).then === 'function'
              ) {
                void (result as Promise<unknown>).then(
                  () => {
                    restoreSend();
                    if (!didAlreadySend()) {
                      done();
                    }
                  },
                  (error: unknown) => {
                    restoreSend();
                    done(
                      error instanceof Error ? error : new Error(String(error)),
                    );
                  },
                );
                return;
              }

              // Sync early hooks that sent a response are complete. Sync early
              // hooks that only mutated request/reply still need done().
              restoreSend();
              if (!didAlreadySend()) {
                done();
              }
            } catch (error) {
              restoreSend();
              done(error instanceof Error ? error : new Error(String(error)));
            }
          }
        : async (
            request: FastifyRequest,
            reply: FastifyReply,
            ...args: unknown[]
          ) => {
            // Later hooks do not control routing continuation in the same way,
            // so the simple async wrapper is enough to support sync handlers.
            return handler(request, reply, ...args);
          };
      return fastifyInstance.addHook(
        hookName as Parameters<typeof fastifyInstance.addHook>[0],

        wrappedHandler,
      );
    },
    decorate: (property: string, value: unknown) =>
      fastifyInstance.decorate(property, value),
    decorateRequest: (property: string, value: unknown) =>
      fastifyInstance.decorateRequest(property, value),
    decorateReply: (property: string, value: unknown) =>
      fastifyInstance.decorateReply(property, value),
    hasDecoration: (property: string) =>
      Object.prototype.hasOwnProperty.call(
        fastifyInstance as unknown as Record<string, unknown>,
        property,
      ),
    getDecoration: <T = unknown>(property: string): T | undefined =>
      (fastifyInstance as unknown as Record<string, unknown>)[property] as
        T | undefined,
    route: (opts: SafeRouteOptions) => {
      // Prevent catch-all routes that would conflict with SSR
      if (opts.url === '*' || opts.url.includes('*')) {
        throw new Error(
          'Plugins cannot register catch-all routes that would conflict with SSR rendering',
        );
      }
      // Note: SafeRouteOptions may not perfectly match Fastify's RouteOptions interface.
      // This cast ensures compatibility with Fastify's internal route registration.
      return fastifyInstance.route({
        ...(opts as Parameters<typeof fastifyInstance.route>[0]),
        handler: guardRouteHandler(opts.handler),
      });
    },
    get: (path: string, handler: RouteHandler) => {
      if (shouldDisableRootWildcard && (path === '*' || path === '/*')) {
        throw new Error(
          'Plugins cannot register root wildcard GET routes that would conflict with SSR rendering',
        );
      }

      return fastifyInstance.get(path, guardRouteHandler(handler));
    },
    post: (path: string, handler: RouteHandler) =>
      fastifyInstance.post(path, guardRouteHandler(handler)),
    put: (path: string, handler: RouteHandler) =>
      fastifyInstance.put(path, guardRouteHandler(handler)),
    delete: (path: string, handler: RouteHandler) =>
      fastifyInstance.delete(path, guardRouteHandler(handler)),
    patch: (path: string, handler: RouteHandler) =>
      fastifyInstance.patch(path, guardRouteHandler(handler)),
    log: fastifyInstance.log,
    api: apiShortcuts,
    pageDataHandler: pageDataHandlerShortcuts,
    APIResponseHelpers: apiResponseHelpersClass,
  };
}

/**
 * Wrap Fastify's reply object with a constrained, safe surface for handlers.
 */
export function createControlledReply(
  request: FastifyRequest,
  reply: FastifyReply,
): ControlledReply {
  return {
    header: (name: string, value: string) => {
      reply.header(name, value);
    },
    getHeader: (name: string) => reply.getHeader(name),
    getHeaders: () => reply.getHeaders(),
    removeHeader: (name: string) => {
      reply.removeHeader(name);
    },
    hasHeader: (name: string) => reply.hasHeader(name),
    get sent() {
      return reply.sent;
    },
    raw: {
      get destroyed() {
        return reply.raw.destroyed;
      },
    },
    _sendErrorEnvelope: async (statusCode, errorEnvelope) => {
      // ControlledReply does not expose reply.send()/raw writes to handlers,
      // but framework-owned helpers still need one sanctioned way to send an
      // early error envelope. Keep that capability internal here so handlers
      // cannot treat ControlledReply like a full FastifyReply.
      await sendRawErrorEnvelopeResponse(
        request,
        reply,
        statusCode,
        errorEnvelope,
      );
    },
    setCookie:
      typeof (reply as unknown as { setCookie?: unknown }).setCookie ===
      'function'
        ? (
            reply as unknown as {
              setCookie: (
                name: string,
                value: string,
                options?: CookieSerializeOptions,
              ) => void;
            }
          ).setCookie.bind(reply)
        : undefined,
    cookie:
      typeof (reply as unknown as { cookie?: unknown }).cookie === 'function'
        ? (
            reply as unknown as {
              cookie: (
                name: string,
                value: string,
                options?: CookieSerializeOptions,
              ) => void;
            }
          ).cookie.bind(reply)
        : undefined,
    clearCookie:
      typeof (reply as unknown as { clearCookie?: unknown }).clearCookie ===
      'function'
        ? (
            reply as unknown as {
              clearCookie: (
                name: string,
                options?: CookieSerializeOptions,
              ) => void;
            }
          ).clearCookie.bind(reply)
        : undefined,
    unsignCookie:
      typeof (reply as unknown as { unsignCookie?: unknown }).unsignCookie ===
      'function'
        ? (
            reply as unknown as {
              unsignCookie: (
                value: string,
              ) =>
                | { valid: true; renew: boolean; value: string }
                | { valid: false; renew: false; value: null };
            }
          ).unsignCookie.bind(reply)
        : undefined,
    signCookie:
      typeof (reply as unknown as { signCookie?: unknown }).signCookie ===
      'function'
        ? (
            reply as unknown as {
              signCookie: (value: string) => string;
            }
          ).signCookie.bind(reply)
        : undefined,
  };
}

/**
 * Validates that no API or page data loader handlers were registered when API handling is disabled.
 * This prevents configuration errors where handlers are registered but won't be used.
 *
 * @param apiRoutes API routes helper instance
 * @param pageDataHandlers Page data loader handlers helper instance
 * @throws Error if handlers were registered when API is disabled
 */
export function validateNoHandlersWhenAPIDisabled(
  apiRoutes: { hasRegisteredHandlers: () => boolean },
  pageDataHandlers: { hasRegisteredHandlers: () => boolean },
): void {
  const hasAPIRoutes = apiRoutes.hasRegisteredHandlers();
  const hasPageDataHandlers = pageDataHandlers.hasRegisteredHandlers();

  if (hasAPIRoutes || hasPageDataHandlers) {
    const registered = [
      hasAPIRoutes ? 'API routes' : null,
      hasPageDataHandlers ? 'page data loader handlers' : null,
    ]
      .filter(Boolean)
      .join(' and ');

    throw new Error(
      `Cannot start server: ${registered} were registered but API handling is disabled ` +
        `(apiEndpoints.apiEndpointPrefix is false). Either enable API handling by setting ` +
        `apiEndpointPrefix to a value like '/api', or remove the registered handlers.`,
    );
  }
}

/**
 * Validates plugin dependencies and registers a plugin with metadata tracking
 *
 * @param registeredPlugins Array of already registered plugin metadata (mutated by this function)
 * @param pluginResult The result returned by the plugin (either PluginMetadata or void)
 * @throws Error if plugin dependencies are not met or duplicate plugin names
 */
export function validateAndRegisterPlugin(
  registeredPlugins: PluginMetadata[],
  pluginResult: PluginMetadata | void,
): void {
  // If plugin returned no metadata, nothing to track
  if (!pluginResult) {
    return;
  }

  // Check for duplicate plugin names
  if (registeredPlugins.some((p) => p.name === pluginResult.name)) {
    throw new Error(
      `Plugin with name "${pluginResult.name}" is already registered`,
    );
  }

  // Check dependencies
  if (pluginResult.dependsOn) {
    const dependencies = Array.isArray(pluginResult.dependsOn)
      ? pluginResult.dependsOn
      : [pluginResult.dependsOn];

    const registeredNames = new Set(registeredPlugins.map((p) => p.name));

    for (const dep of dependencies) {
      if (!registeredNames.has(dep)) {
        throw new Error(
          `Plugin "${pluginResult.name}" depends on "${dep}" which has not been registered yet. ` +
            `Plugins must be registered in dependency order.`,
        );
      }
    }
  }

  // Add to registered plugins list
  registeredPlugins.push(pluginResult);
}

/**
 * Decorates requests with the resolved connection IP, set once per request.
 * Always sets connectionIP to request.ip first (which respects
 * fastifyOptions.trustProxy), then overwrites it with the awaited return value
 * of getConnectionIP if provided (e.g. a CDN/proxy header like CF-Connecting-IP).
 *
 * Also seeds request.clientIP = connectionIP, request.userAgent from the raw
 * User-Agent header, and request.clientUserAgent from that same raw header as a
 * base value; the client-info resolution step (when enabled) refines
 * clientIP/clientUserAgent with trusted forwarded SSR headers
 * (X-SSR-Original-IP / X-SSR-Forwarded-User-Agent) to recover the real end
 * user across hops without changing the immediate-hop userAgent.
 *
 * If getConnectionIP throws or rejects, connectionIP retains request.ip and the
 * error propagates as a normal 500.
 */
export function registerConnectionIPDecoration(
  fastify: FastifyInstance,
  getConnectionIP:
    ((request: FastifyRequest) => string | Promise<string>) | undefined,
): void {
  fastify.decorateRequest('connectionIP', '');
  // clientIP defaults to connectionIP; client-info resolution may override it.
  fastify.decorateRequest('clientIP', '');
  // userAgent is the immediate-hop User-Agent header.
  fastify.decorateRequest('userAgent', '');
  // clientUserAgent defaults to userAgent; client-info resolution may override it.
  fastify.decorateRequest('clientUserAgent', '');

  fastify.addHook('onRequest', async (request, _reply) => {
    request.connectionIP = request.ip;

    if (getConnectionIP) {
      request.connectionIP = await getConnectionIP(request);
    }

    // Base value — the real end user (clientIP) starts as the connecting IP
    // and is refined by client-info resolution when forwarded headers are trusted.
    request.clientIP = request.connectionIP;

    const userAgentHeader = request.headers['user-agent'];
    request.userAgent =
      typeof userAgentHeader === 'string' ? userAgentHeader : '';
    request.clientUserAgent = request.userAgent;
  });
}

/**
 * Decorates requests with a unique request ID, set once per request in an early
 * onRequest hook. Register this before access logging and user plugins so
 * `request.requestID` is available everywhere: access log hooks/templates,
 * plugins (e.g. clientInfo), page data + API route handlers, and the API/Page
 * envelope helpers (which read it for `request_id`).
 *
 * Defaults to a ULID — globally unique and safe across instances/restarts.
 * When `getRequestID` is provided, its return value is used instead; returning
 * `undefined` or an empty string opts out (leaves `requestID` unset, so
 * envelopes fall back to `"unknown"` unless you set it yourself). Use the
 * override to adopt an upstream/proxy request ID from a trusted header.
 */
export function registerRequestIDDecoration(
  fastify: FastifyInstance,
  getRequestID:
    | ((
        request: FastifyRequest,
      ) => string | undefined | Promise<string | undefined>)
    | undefined,
): void {
  fastify.decorateRequest('requestID', undefined);

  fastify.addHook('onRequest', async (request, _reply) => {
    if (getRequestID) {
      const id = await getRequestID(request);
      request.requestID =
        typeof id === 'string' && id.length > 0 ? id : undefined;
    } else {
      request.requestID = ulid();
    }
  });
}

/**
 * Builds Fastify-compatible HTTPS options from the shared HTTPSOptions type.
 * Handles extracting the `sni` field and converting it to a Node.js `SNICallback`
 * that supports both sync and async user functions.
 *
 * Used by APIServer, and SSRServer to avoid duplicating
 * the SNI callback adapter logic.
 *
 * @param httpsConfig - The HTTPSOptions from server configuration
 * @returns A plain object suitable for passing as `fastifyOptions.https`
 */
export function buildFastifyHTTPSOptions(
  httpsConfig: HTTPSOptions,
): Record<string, unknown> {
  const { sni, ...httpsOptions } = httpsConfig;

  // Build HTTPS options for Fastify
  const fastifyHTTPSOptions: Record<string, unknown> = {
    ...httpsOptions,
  };

  // Add SNI callback if provided
  if (sni) {
    fastifyHTTPSOptions.SNICallback = (
      servername: string,
      callback?: (err: Error | null, ctx?: unknown) => void,
    ) => {
      try {
        // Call user's SNI function (supports both sync and async)
        const result = sni(servername);

        // Handle Promise return
        if (result && typeof result === 'object' && 'then' in result) {
          if (callback) {
            result
              .then((ctx: unknown) => {
                callback(null, ctx);
              })
              .catch((error: unknown) => {
                callback(
                  error instanceof Error ? error : new Error(String(error)),
                );
              });
          } else {
            return result;
          }
        } else if (callback) {
          callback(null, result);
        } else {
          return result;
        }
      } catch (error) {
        if (callback) {
          callback(error instanceof Error ? error : new Error(String(error)));
        } else {
          throw error;
        }
      }
    };
  }

  return fastifyHTTPSOptions;
}

/**
 * Computes domain info from a request hostname using the public suffix list.
 * - `hostname`: the bare hostname (port stripped)
 * - `rootDomain`: the apex domain without a leading dot (e.g. `'example.com'`),
 *   or empty string for localhost / IP addresses where no root domain can be resolved.
 */
export function computeDomainInfo(hostname: string): DomainInfo {
  // Use parseHostHeader for correct IPv6 bracket handling
  // e.g. '[::1]:3000' → '::1', 'localhost:3000' → 'localhost'
  const { domain: host } = parseHostHeader(hostname);
  const root = getDomain(host) ?? '';

  return {
    hostname: host,
    // Empty string when domain-utils cannot resolve a root (localhost, raw IP, etc.)
    rootDomain: root,
  };
}

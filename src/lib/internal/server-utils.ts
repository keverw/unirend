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
  FastifyHookName,
  SafeRouteOptions,
  ControlledReply,
  APIResponseHelpersClass,
  HTTPSOptions,
  WebResponse,
  APIClosingHandlerFn,
  WebClosingHandlerFn,
  SplitClosingHandler,
} from '../types';
import type { BaseMeta } from '../api-envelope/api-envelope-types';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { DEFAULT_API_PREFIX, DEFAULT_PAGE_DATA_ENDPOINT } from './consts';
import { generateDefault503ClosingPage } from './error-page-utils';
import { parseHostHeader, getDomain } from 'lifecycleion/domain-utils';
import { sendRawErrorEnvelopeResponse } from './error-envelope-send';

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
 * Creates a default JSON 404 not-found response using the envelope pattern.
 * Used by both APIServer and SSRServer for consistent 404 handling.
 * @param request - The Fastify request object
 * @param apiPrefix - API prefix for request classification (e.g., "/api"), or false if API is disabled
 * @param pageDataEndpoint - Page data endpoint name (e.g., "page_data")
 * @returns JSON 404 response object
 */
export function createDefaultAPINotFoundResponse(
  HelpersClass: APIResponseHelpersClass,
  request: FastifyRequest,
  apiPrefix: string | false,
  pageDataEndpoint: string,
): unknown {
  const { isPageData } = classifyRequest(
    request.url,
    apiPrefix,
    pageDataEndpoint,
  );

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

type ClosingHandler<M extends BaseMeta = BaseMeta> =
  | APIClosingHandlerFn<M>
  | WebClosingHandlerFn
  | SplitClosingHandler<M>;

interface ClosingResponseConfig<M extends BaseMeta = BaseMeta> {
  handler?: ClosingHandler<M>;
  functionHandlerType: ClosingFunctionHandlerType;
  serverLabel: string;
  HelpersClass: APIResponseHelpersClass;
  apiPrefix: string | false;
  pageDataEndpoint: string;
}

interface ClosingResponseContext<
  M extends BaseMeta = BaseMeta,
> extends ClosingResponseConfig<M> {
  request: FastifyRequest;
  reply: FastifyReply;
}

/**
 * Resolves the payload sent by registerClosingResponseHook when the server is
 * stopping. The resolver sets status/cache/content headers on the reply and
 * returns the body that the hook will pass to sendClosingPayload().
 */
export async function resolveClosingResponse<M extends BaseMeta = BaseMeta>({
  request,
  reply,
  handler,
  functionHandlerType,
  serverLabel,
  HelpersClass,
  apiPrefix,
  pageDataEndpoint,
}: ClosingResponseContext<M>): Promise<unknown> {
  // Closing responses need the same API/page-data classification as normal
  // errors so defaults and split handlers return the expected response shape.
  const { isAPI, isPageData } = classifyRequest(
    request.url,
    apiPrefix,
    pageDataEndpoint,
  );

  if (handler) {
    try {
      if (isSplitHandler<Partial<SplitClosingHandler<M>>>(handler)) {
        // Split form lets mixed API + web servers customize each handler
        // independently. Missing handlers fall through to Unirend defaults.
        if (isAPI && handler.api) {
          const apiResponse = await Promise.resolve(
            handler.api(request, isPageData),
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
        const apiHandler = handler as APIClosingHandlerFn<M>;
        const apiResponse = await Promise.resolve(
          apiHandler(request, isPageData),
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

    reply.redirect = ((url: string, code?: number) => {
      // Record the redirect intent but defer the real Fastify redirect call
      // until after this wrapper restores the original reply methods.
      deferredActionKind = 'redirect';
      deferredRedirectURL = url;
      deferredRedirectCode = code;
      return DEFERRED_REPLY_ACTION_SENTINEL as unknown as FastifyReply;
    }) as typeof reply.redirect;

    reply.callNotFound = (() => {
      // Record the delegation intent but defer the real Fastify helper until
      // after this wrapper restores the original reply methods.
      deferredActionKind = 'callNotFound';
      return DEFERRED_REPLY_ACTION_SENTINEL as unknown as FastifyReply;
    }) as typeof reply.callNotFound;

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

export function createControlledInstance(
  fastifyInstance: FastifyInstance,
  shouldDisableRootWildcard: boolean,
  apiShortcuts: unknown,
  pageDataHandlerShortcuts: unknown,
  apiResponseHelpersClass: APIResponseHelpersClass,
): PluginHostInstance {
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
      ) => void | Promise<unknown>,
    ) => {
      // Prevent plugins from overriding critical hooks
      if (hookName === 'onRoute' || hookName.includes('*')) {
        throw new Error(
          'Plugins cannot register catch-all route hooks that would conflict with SSR',
        );
      }
      // Note: Fastify's addHook has complex overloads for different hook types.
      // These casts align our simplified interface with Fastify's internal expectations.
      // The handler is cast to 'any' because Fastify's hook types are too complex to satisfy
      // with our simplified generic signature, but the runtime behavior is correct.
      return fastifyInstance.addHook(
        hookName as Parameters<typeof fastifyInstance.addHook>[0],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        handler as any,
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
        | T
        | undefined,
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
    getHeader: (name: string) =>
      reply.getHeader(name) as unknown as
        | string
        | number
        | string[]
        | undefined,
    getHeaders: () => reply.getHeaders() as unknown as Record<string, unknown>,
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
          ).setCookie
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
          ).cookie
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
          ).clearCookie
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
          ).unsignCookie
        : undefined,
    signCookie:
      typeof (reply as unknown as { signCookie?: unknown }).signCookie ===
      'function'
        ? (
            reply as unknown as {
              signCookie: (value: string) => string;
            }
          ).signCookie
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
 * Decorates requests with a resolved client IP, set once per request.
 * Always sets clientIP to request.ip first (which respects fastifyOptions.trustProxy),
 * then overwrites it with the awaited return value of getClientIP if provided.
 *
 * If getClientIP throws or rejects, clientIP retains request.ip and the error
 * propagates as a normal 500.
 */
export function registerClientIPDecoration(
  fastify: FastifyInstance,
  getClientIP:
    | ((request: FastifyRequest) => string | Promise<string>)
    | undefined,
): void {
  fastify.decorateRequest('clientIP', '');

  fastify.addHook('onRequest', async (request, _reply) => {
    request.clientIP = request.ip;

    if (getClientIP) {
      request.clientIP = await getClientIP(request);
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
    };
  }

  return fastifyHTTPSOptions;
}

/**
 * Normalizes a CDN base URL by stripping a trailing slash, so the value is
 * consistent whether it comes from server config, per-request override, or
 * the injected `window.__CDN_BASE_URL__` global read by the client.
 *
 * Must be applied before the URL is placed into `unirendContext.cdnBaseURL`
 * so that `useCDNBaseURL()` returns the same value on server and client —
 * avoiding React hydration mismatches when a trailing-slash URL is configured.
 */
export function normalizeCDNBaseURL(url: string | undefined): string {
  if (!url) {
    return '';
  }

  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Computes domain info from a request hostname using the public suffix list.
 * - `hostname`: the bare hostname (port stripped)
 * - `rootDomain`: the apex domain without a leading dot (e.g. `'example.com'`),
 *   or empty string for localhost / IP addresses where no root domain can be resolved.
 */
export function computeDomainInfo(hostname: string): {
  hostname: string;
  rootDomain: string;
} {
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

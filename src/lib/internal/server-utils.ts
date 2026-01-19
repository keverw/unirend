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
} from '../types';
import type { CookieSerializeOptions } from '@fastify/cookie';
import { DEFAULT_API_PREFIX, DEFAULT_PAGE_DATA_ENDPOINT } from './consts';

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

  if (isPageData) {
    return HelpersClass.createPageErrorResponse({
      request,
      statusCode,
      errorCode,
      errorMessage,
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
      return fastifyInstance.route(
        opts as Parameters<typeof fastifyInstance.route>[0],
      );
    },
    get: (path: string, handler: RouteHandler) => {
      if (shouldDisableRootWildcard && (path === '*' || path === '/*')) {
        throw new Error(
          'Plugins cannot register root wildcard GET routes that would conflict with SSR rendering',
        );
      }
      return fastifyInstance.get(path, handler);
    },
    post: (path: string, handler: RouteHandler) =>
      fastifyInstance.post(path, handler),
    put: (path: string, handler: RouteHandler) =>
      fastifyInstance.put(path, handler),
    delete: (path: string, handler: RouteHandler) =>
      fastifyInstance.delete(path, handler),
    patch: (path: string, handler: RouteHandler) =>
      fastifyInstance.patch(path, handler),
    api: apiShortcuts,
    pageDataHandler: pageDataHandlerShortcuts,
  };
}

/**
 * Wrap Fastify's reply object with a constrained, safe surface for handlers.
 */
export function createControlledReply(reply: FastifyReply): ControlledReply {
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
    sent: reply.sent,
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

import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifyRequest,
  FastifyReply,
  RouteHandler,
} from "fastify";
import {
  type ControlledFastifyInstance,
  type FastifyHookName,
  type SafeRouteOptions,
} from "../types";
import { APIResponseHelpers } from "../../api-envelope";

/**
 * Detect if a request URL targets a React-Router DataLoader page-data JSON endpoint.
 *
 * Matches "/page_data" at root or versioned e.g. "/v1/page_data".
 * @param rawPath Path portion of the request URL (no query string)
 */

export function isPageDataRequest(rawPath: string): boolean {
  return (
    /^\/page_data(\/|$)/.test(rawPath) ||
    /^\/v\d+\/page_data(\/|$)/.test(rawPath)
  );
}

/**
 * Detects if a request path is for an API endpoint based on a configurable prefix.
 * Used by SSRServer to differentiate API requests from SSR page requests.
 * @param rawPath - The request path (without query string)
 * @param apiPrefix - The API prefix to match against (e.g., "/api")
 * @returns true if the path starts with the API prefix
 */

export function isAPIRequest(rawPath: string, apiPrefix: string): boolean {
  // If API prefix is false, then this handling is disabled on the SSRServer
  if (!apiPrefix) {
    return false;
  }

  return rawPath.startsWith(apiPrefix + "/") || rawPath === apiPrefix;
}

/**
 * Creates a default JSON error response using the envelope pattern.
 * Used by both APIServer and SSRServer for consistent error handling.
 * @param request - The Fastify request object
 * @param error - The error that occurred
 * @param isDevelopment - Whether running in development mode
 * @param apiPrefix - Optional API prefix to remove from path for page detection
 * @returns JSON error response object
 */

export function createDefaultAPIErrorResponse(
  request: FastifyRequest,
  error: Error,
  isDevelopment: boolean,
  apiPrefix?: string,
): unknown {
  // Determine path for page detection
  const rawPath = request.url.split("?")[0];
  const pathForPageCheck =
    apiPrefix && rawPath.startsWith(apiPrefix)
      ? rawPath.slice(apiPrefix.length)
      : rawPath;
  const isPage = isPageDataRequest(pathForPageCheck);

  const statusCode =
    (error as Error & { statusCode?: number }).statusCode || 500;
  const errorCode =
    statusCode === 500 ? "internal_server_error" : "request_error";
  const errorMessage = isDevelopment ? error.message : "Internal Server Error";

  if (isPage) {
    return APIResponseHelpers.createPageErrorResponse({
      request,
      statusCode,
      errorCode,
      errorMessage,
      pageMetadata: {
        title: "Error",
        description: "An error occurred while processing your request",
      },
    });
  }

  return APIResponseHelpers.createAPIErrorResponse({
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
 * @param apiPrefix - Optional API prefix to remove from path for page detection
 * @returns JSON 404 response object
 */
export function createDefaultAPINotFoundResponse(
  request: FastifyRequest,
  apiPrefix?: string,
): unknown {
  // Determine path for page detection
  const rawPath = request.url.split("?")[0];
  const pathForPageCheck =
    apiPrefix && rawPath.startsWith(apiPrefix)
      ? rawPath.slice(apiPrefix.length)
      : rawPath;
  const isPage = isPageDataRequest(pathForPageCheck);

  const statusCode = 404;

  if (isPage) {
    return APIResponseHelpers.createPageErrorResponse({
      request,
      statusCode,
      errorCode: "not_found",
      errorMessage: "Page Not Found",
      pageMetadata: {
        title: "Not Found",
        description: "The requested page could not be found",
      },
    });
  }

  return APIResponseHelpers.createAPIErrorResponse({
    request,
    statusCode,
    errorCode: "not_found",
    errorMessage: "Resource Not Found",
  });
}

/**
 * Creates a controlled wrapper around the Fastify instance
 * This prevents plugins from accessing dangerous methods
 * @param fastifyInstance The real Fastify instance
 * @param disableRootWildcard Whether to disable root wildcard routes (e.g., "*" or "/*")
 * @returns Controlled interface for plugins
 */

export function createControlledInstance(
  fastifyInstance: FastifyInstance,
  disableRootWildcard: boolean,
): ControlledFastifyInstance {
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
      ) => Promise<unknown> | unknown,
    ) => {
      // Prevent plugins from overriding critical hooks
      if (hookName === "onRoute" || hookName.includes("*")) {
        throw new Error(
          "Plugins cannot register catch-all route hooks that would conflict with SSR",
        );
      }
      // Note: Fastify's addHook has complex overloads for different hook types.
      // These casts align our simplified interface with Fastify's internal expectations.
      return fastifyInstance.addHook(
        hookName as Parameters<typeof fastifyInstance.addHook>[0],
        handler as Parameters<typeof fastifyInstance.addHook>[1],
      );
    },
    decorate: (property: string, value: unknown) =>
      fastifyInstance.decorate(property, value),
    decorateRequest: (property: string, value: unknown) =>
      fastifyInstance.decorateRequest(property, value),
    decorateReply: (property: string, value: unknown) =>
      fastifyInstance.decorateReply(property, value),
    route: (opts: SafeRouteOptions) => {
      // Prevent catch-all routes that would conflict with SSR
      if (opts.url === "*" || opts.url.includes("*")) {
        throw new Error(
          "Plugins cannot register catch-all routes that would conflict with SSR rendering",
        );
      }
      // Note: SafeRouteOptions may not perfectly match Fastify's RouteOptions interface.
      // This cast ensures compatibility with Fastify's internal route registration.
      return fastifyInstance.route(
        opts as Parameters<typeof fastifyInstance.route>[0],
      );
    },
    get: (path: string, handler: RouteHandler) => {
      if (disableRootWildcard && (path === "*" || path === "/*")) {
        throw new Error(
          "Plugins cannot register root wildcard GET routes that would conflict with SSR rendering",
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
  };
}

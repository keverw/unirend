import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  APIResponseEnvelope,
  BaseMeta,
} from '../api-envelope/api-envelope-types';
import { APIResponseHelpers } from '../api-envelope/response-helpers';
import type { ControlledReply } from '../types';
import { createControlledReply } from './server-utils';
import {
  validateVersion,
  validateSingleVersionWhenDisabled,
} from './version-helpers';

/**
 * Supported HTTP methods for API routes
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * Handler function type for generic API endpoints
 *
 * Handlers should return an APIResponseEnvelope. Returning any other object
 * will result in a runtime error being thrown during request handling.
 */
export type APIRouteHandler<T = unknown, M extends BaseMeta = BaseMeta> = (
  request: FastifyRequest,
  controlledReply: ControlledReply,
  params: {
    /** HTTP method used for this route */
    method: HTTPMethod;
    /** Endpoint path segment after version/prefix (e.g., "users/:id") */
    endpoint: string;
    /** Registered version for this handler (always set, defaults to 1) */
    version: number;
    /** Full path used to register the route */
    fullPath: string;
    /** Route params extracted from Fastify (raw values) */
    route_params: Record<string, unknown>;
    /** Query params extracted from Fastify (raw values) */
    query_params: Record<string, unknown>;
    /** Path portion of the URL without query string */
    request_path: string;
    /** Original URL including query string */
    original_url: string;
  },
  // Allow either sync or async returns
) => APIResponseEnvelope<T, M> | Promise<APIResponseEnvelope<T, M>>;

/**
 * Internal structure for storing handlers by method → endpoint → version
 */
type VersionToHandlerMap<T, M extends BaseMeta> = Map<
  number,
  APIRouteHandler<T, M>
>;
type EndpointToVersionMap<T, M extends BaseMeta> = Map<
  string,
  VersionToHandlerMap<T, M>
>;
type MethodToEndpointMap<T, M extends BaseMeta> = Map<
  HTTPMethod,
  EndpointToVersionMap<T, M>
>;

/**
 * Helper class for registering generic API routes, mirroring the ergonomics of
 * DataLoaderServerHandlerHelpers but for non-page endpoints.
 *
 * - Supports versioned or non-versioned endpoints
 * - Validates handler return envelopes using APIResponseHelpers
 * - Provides convenient shortcuts via .api.get/.post/.put/.delete/.patch
 * - Controls wildcard usage via constructor flag
 */
export class APIRoutesServerHelpers<
  T = unknown,
  M extends BaseMeta = BaseMeta,
> {
  private handlersByMethod: MethodToEndpointMap<T, M> = new Map();

  // ---------------------------------------------------------------------------
  // API Shortcuts (method-specific helpers)
  // ---------------------------------------------------------------------------
  private readonly api = {
    get: (
      endpoint: string,
      handlerOrVersion: number | APIRouteHandler<T, M>,
      maybeHandler?: APIRouteHandler<T, M>,
    ): void => {
      if (typeof handlerOrVersion === 'number') {
        this.registerAPIHandler(
          'GET',
          endpoint,
          handlerOrVersion,
          maybeHandler as APIRouteHandler<T, M>,
        );
      } else {
        this.registerAPIHandler('GET', endpoint, handlerOrVersion);
      }
    },
    post: (
      endpoint: string,
      handlerOrVersion: number | APIRouteHandler<T, M>,
      maybeHandler?: APIRouteHandler<T, M>,
    ): void => {
      if (typeof handlerOrVersion === 'number') {
        this.registerAPIHandler(
          'POST',
          endpoint,
          handlerOrVersion,
          maybeHandler as APIRouteHandler<T, M>,
        );
      } else {
        this.registerAPIHandler('POST', endpoint, handlerOrVersion);
      }
    },
    put: (
      endpoint: string,
      handlerOrVersion: number | APIRouteHandler<T, M>,
      maybeHandler?: APIRouteHandler<T, M>,
    ): void => {
      if (typeof handlerOrVersion === 'number') {
        this.registerAPIHandler(
          'PUT',
          endpoint,
          handlerOrVersion,
          maybeHandler as APIRouteHandler<T, M>,
        );
      } else {
        this.registerAPIHandler('PUT', endpoint, handlerOrVersion);
      }
    },
    delete: (
      endpoint: string,
      handlerOrVersion: number | APIRouteHandler<T, M>,
      maybeHandler?: APIRouteHandler<T, M>,
    ): void => {
      if (typeof handlerOrVersion === 'number') {
        this.registerAPIHandler(
          'DELETE',
          endpoint,
          handlerOrVersion,
          maybeHandler as APIRouteHandler<T, M>,
        );
      } else {
        this.registerAPIHandler('DELETE', endpoint, handlerOrVersion);
      }
    },
    patch: (
      endpoint: string,
      handlerOrVersion: number | APIRouteHandler<T, M>,
      maybeHandler?: APIRouteHandler<T, M>,
    ): void => {
      if (typeof handlerOrVersion === 'number') {
        this.registerAPIHandler(
          'PATCH',
          endpoint,
          handlerOrVersion,
          maybeHandler as APIRouteHandler<T, M>,
        );
      } else {
        this.registerAPIHandler('PATCH', endpoint, handlerOrVersion);
      }
    },
  } as const;

  // ---------------------------------------------------------------------------
  // Route registration into Fastify
  // ---------------------------------------------------------------------------
  /**
   * Register all stored handlers with the Fastify instance.
   *
   * @param fastify - The Fastify instance to register routes on
   * @param apiPrefix - Pre-normalized API prefix (e.g., "/api")
   * @param options - Optional config for versioning and wildcard behavior
   */
  public registerRoutes(
    fastify: FastifyInstance,
    apiPrefix: string,
    options?: {
      versioned?: boolean;
      allowWildcardAtRoot?: boolean;
    },
  ): void {
    const useVersioning = options?.versioned ?? true;

    // Prefix is already normalized by the caller (APIServer/SSRServer)
    const prefix = apiPrefix;
    const isRootPrefix = prefix === '/';
    const allowWildAtRoot = options?.allowWildcardAtRoot === true;

    for (const [method, endpointMap] of this.handlersByMethod) {
      for (const [endpoint, versionMap] of endpointMap) {
        // Enforce wildcard rule based on prefix: allow wildcards only when prefix is non-root
        if (
          !allowWildAtRoot &&
          isRootPrefix &&
          (endpoint === '*' || endpoint.includes('*'))
        ) {
          throw new Error(
            "Wildcard endpoints are not allowed when apiEndpointPrefix is root ('/' or empty). Set a non-root prefix like '/api' to use wildcards.",
          );
        }

        // Check if versioning is disabled but multiple versions exist
        validateSingleVersionWhenDisabled(
          useVersioning,
          versionMap,
          `Endpoint "${endpoint}" (${method})`,
        );

        // Register each version
        for (const [version, handler] of versionMap) {
          const fullPath = this.buildPath(
            prefix,
            endpoint,
            useVersioning,
            version,
          );

          // Register with Fastify according to method
          const wrappedHandler = async (
            request: FastifyRequest,
            reply: FastifyReply,
          ) => {
            const route_params = (request.params || {}) as Record<
              string,
              unknown
            >;
            const query_params = (request.query || {}) as Record<
              string,
              unknown
            >;

            const original_url = request.url;
            const request_path = original_url.split('?')[0] || original_url;

            const envelope = await handler(
              request,
              createControlledReply(reply),
              {
                method,
                endpoint,
                version,
                fullPath,
                route_params,
                query_params,
                request_path,
                original_url,
              },
            );

            if (!APIResponseHelpers.isValidEnvelope(envelope)) {
              const error = new Error(
                'API route ' +
                  method +
                  ' ' +
                  fullPath +
                  ' returned an invalid response envelope',
              );
              (error as unknown as { errorCode: string }).errorCode =
                'invalid_handler_response';
              (error as unknown as { route: string }).route =
                method + ' ' + fullPath;
              (
                error as unknown as { handlerResponse: unknown }
              ).handlerResponse = envelope;
              throw error;
            }

            reply.code(envelope.status_code);

            if (envelope.status_code >= 400) {
              reply.header('Cache-Control', 'no-store');
            }

            return envelope;
          };

          switch (method) {
            case 'GET':
              fastify.get(fullPath, wrappedHandler);
              break;
            case 'POST':
              fastify.post(fullPath, wrappedHandler);
              break;
            case 'PUT':
              fastify.put(fullPath, wrappedHandler);
              break;
            case 'DELETE':
              fastify.delete(fullPath, wrappedHandler);
              break;
            case 'PATCH':
              fastify.patch(fullPath, wrappedHandler);
              break;
          }
        }
      }
    }
  }

  /**
   * Expose only the lightweight shortcuts surface for external consumers
   */
  public get apiShortcuts() {
    return this.api;
  }

  /**
   * Check if any API handlers have been registered
   * Useful for validation when API handling is disabled
   */
  public hasRegisteredHandlers(): boolean {
    return this.handlersByMethod.size > 0;
  }

  /** Normalize and validate endpoint string (no prefix, no version) */
  private normalizeEndpoint(endpoint: string): string {
    const trimmed = (endpoint || '').trim();

    if (trimmed.length === 0) {
      throw new Error('Endpoint path segment cannot be empty');
    }

    // Remove leading slash to keep it as a path segment
    return trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
  }

  private ensureMethod(method: string): HTTPMethod {
    const upper = (method || '').toUpperCase();
    if (
      upper === 'GET' ||
      upper === 'POST' ||
      upper === 'PUT' ||
      upper === 'DELETE' ||
      upper === 'PATCH'
    ) {
      return upper as HTTPMethod;
    }

    throw new Error('Unsupported HTTP method: ' + method);
  }

  private getOrCreateEndpointMap(
    method: HTTPMethod,
  ): EndpointToVersionMap<T, M> {
    let map = this.handlersByMethod.get(method);

    if (!map) {
      map = new Map();
      this.handlersByMethod.set(method, map);
    }

    return map;
  }

  private getOrCreateVersionMap(
    endpointMap: EndpointToVersionMap<T, M>,
    endpoint: string,
  ): VersionToHandlerMap<T, M> {
    let versionMap = endpointMap.get(endpoint);

    if (!versionMap) {
      versionMap = new Map();
      endpointMap.set(endpoint, versionMap);
    }

    return versionMap;
  }

  // ---------------------------------------------------------------------------
  // Registration API (explicit method)
  // ---------------------------------------------------------------------------

  /**
   * Register an API handler without explicit version (uses default version if versioned)
   *
   * This method is used internally by the `.api` shortcuts (`.api.get`, `.api.post`, etc.).
   * External users should use those shortcuts instead, which are exposed on SSRServer and
   * APIServer via the `.api` getter property.
   *
   * @example
   * // Preferred public API:
   * server.api.get('users/:id', handler)
   * server.api.post('items', 2, handler)
   */
  private registerAPIHandler(
    method: HTTPMethod,
    endpoint: string,
    handler: APIRouteHandler<T, M>,
  ): void;

  /**
   * Register an API handler with explicit version
   *
   * This method is used internally by the `.api` shortcuts.
   * External users should use the public shortcuts instead: `server.api.get()`, etc.
   */
  private registerAPIHandler(
    method: HTTPMethod,
    endpoint: string,
    version: number,
    handler: APIRouteHandler<T, M>,
  ): void;

  /**
   * Implementation of the overloaded method
   *
   * This is the internal implementation used by the `.api` shortcuts.
   */
  private registerAPIHandler(
    method: HTTPMethod,
    endpoint: string,
    versionOrHandler: number | APIRouteHandler<T, M>,
    handlerMaybe?: APIRouteHandler<T, M>,
  ): void {
    const httpMethod = this.ensureMethod(method);
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);

    let version: number;
    let handler: APIRouteHandler<T, M>;

    if (typeof versionOrHandler === 'function') {
      // 2-param overload: registerAPIHandler(method, endpoint, handler)
      // Default to version 1 when not specified
      version = 1;
      handler = versionOrHandler;
    } else {
      // 3-param overload: registerAPIHandler(method, endpoint, version, handler)
      if (!handlerMaybe) {
        throw new Error(
          'Handler function is required when version is specified',
        );
      }

      validateVersion(versionOrHandler, 'API');
      version = versionOrHandler;
      handler = handlerMaybe;
    }

    const endpointMap = this.getOrCreateEndpointMap(httpMethod);
    const versionMap = this.getOrCreateVersionMap(
      endpointMap,
      normalizedEndpoint,
    );

    // Last registration wins for the same method + endpoint + version
    versionMap.set(version, handler);
  }

  private buildPath(
    prefix: string,
    endpoint: string,
    useVersioning: boolean,
    version: number,
  ): string {
    const base = useVersioning ? prefix + '/v' + version : prefix;
    return base + '/' + endpoint;
  }
}

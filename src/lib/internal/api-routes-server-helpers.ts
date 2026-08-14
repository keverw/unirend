import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type {
  APIResponseEnvelope,
  BaseMeta,
} from '../api-envelope/api-envelope-types';
import { APIResponseHelpers } from '../api-envelope/response-helpers';
import type { APIResponseHelpersClass, ControlledReply } from '../types';
import {
  createControlledReply,
  type APINotFoundResolutionConfig,
} from './server-utils';
import {
  checkTrigger404,
  closeTrigger404Scope,
  openTrigger404Scope,
  runInTrigger404Scope,
  type Trigger404Signal,
} from './trigger-404';
import {
  validateVersion,
  validateSingleVersionWhenDisabled,
} from './version-helpers';
import { getAPIResponseHelpersClass } from './api-response-helpers-utils';

/**
 * Supported HTTP methods for API routes
 */
export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

/**
 * Handler function type for generic API endpoints
 *
 * Handlers should return an APIResponseEnvelope. Returning any other object
 * will result in a runtime error being thrown during request handling.
 *
 * **Return false** when you've sent a custom response (e.g., using
 * APIResponseHelpers.sendErrorEnvelope() or validation helpers like ensureJSONBody).
 * This signals that the handler has already sent the response and the framework
 * should not attempt to send anything.
 *
 * **Return `request.trigger404()`** to abandon the request into this server's
 * not-found path, so the response is exactly what an unregistered route would
 * produce. Call it before setting headers or cookies and before any expensive
 * work.
 */
export type APIRouteHandler<
  T = unknown,
  M extends BaseMeta = BaseMeta,
  H extends APIResponseHelpersClass = APIResponseHelpersClass,
> = (
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
    routeParams: Record<string, unknown>;
    /** Query params extracted from Fastify (raw values) */
    queryParams: Record<string, unknown>;
    /** Path portion of the URL without query string */
    requestPath: string;
    /** Original URL including query string */
    originalURL: string;
    /** The APIResponseHelpers class configured on this server (use this instead of importing directly) */
    APIResponseHelpers: H;
  },
  // Allow either sync or async returns, including false for early-exit cases
  // and the trigger-404 sentinel for abandoning the request.
  //
  // The async arm carries the whole union rather than being one Promise per
  // member: an async handler that branches — an envelope on one path, `false`
  // or the sentinel on another — infers a single Promise over the union, which
  // no per-member Promise arm accepts.
) =>
  | APIResponseEnvelope<T, M>
  | false
  | Trigger404Signal
  | Promise<APIResponseEnvelope<T, M> | false | Trigger404Signal>;

/**
 * Internal structure for storing handlers by method → endpoint → version
 */
type VersionToHandlerMap<
  T,
  M extends BaseMeta,
  H extends APIResponseHelpersClass,
> = Map<number, APIRouteHandler<T, M, H>>;
type EndpointToVersionMap<
  T,
  M extends BaseMeta,
  H extends APIResponseHelpersClass,
> = Map<string, VersionToHandlerMap<T, M, H>>;
type MethodToEndpointMap<
  T,
  M extends BaseMeta,
  H extends APIResponseHelpersClass,
> = Map<HTTPMethod, EndpointToVersionMap<T, M, H>>;

/**
 * Helper class for registering generic API routes, mirroring the ergonomics of
 * DataLoaderServerHandlerHelpers but for non-page endpoints.
 *
 * - Supports versioned or non-versioned endpoints
 * - Validates handler return envelopes using APIResponseHelpers
 * - Provides convenient shortcuts via .api.get/.post/.put/.delete/.patch
 * - Controls wildcard usage via constructor flag
 *
 * ## Endpoint Convention
 *
 * Endpoints should be specified as path segments WITHOUT leading slashes:
 * - ✅ `server.api.get("users/:id", handler)`  → `/api/v1/users/:id`
 * - ✅ `server.api.post("upload/avatar", h)`   → `/api/v1/upload/avatar`
 * - ⚠️ `server.api.get("/users/:id", handler)` → `/api/v1/users/:id` (leading slash stripped)
 *
 * Leading slashes are allowed but will be automatically stripped during normalization.
 *
 * This design treats endpoints as path segments that get appended to the API prefix
 * and version, rather than as absolute paths.
 */
export class APIRoutesServerHelpers<
  T = unknown,
  M extends BaseMeta = BaseMeta,
  H extends APIResponseHelpersClass = APIResponseHelpersClass,
> {
  private handlersByMethod: MethodToEndpointMap<T, M, H> = new Map();

  // Installed by the server before registerRoutes(). Backs request.trigger404()
  // so an abandoned request resolves through the same not-found path a genuine
  // miss takes.
  private notFoundResolution?: APINotFoundResolutionConfig;

  // API Shortcut method-specific helpers
  private readonly api = {
    /**
     * Register a GET endpoint
     *
     * @param endpoint - Path segment (e.g., "users/:id" or "items")
     *   - Convention: Do NOT include leading slash - endpoints are path segments, not full paths
     *   - Leading slashes are allowed but will be stripped during normalization
     *   - The final path is constructed as: prefix + version + endpoint
     *     Example: "users/:id" → "/api/v1/users/:id" (with prefix="/api", versioned)
     * @param handlerOrVersion - Handler function, or version number if using versioned handler
     * @param maybeHandler - Handler function when version is specified
     */
    get: (
      endpoint: string,
      handlerOrVersion: number | APIRouteHandler<T, M, H>,
      maybeHandler?: APIRouteHandler<T, M, H>,
    ): void => {
      if (typeof handlerOrVersion === 'number') {
        this.registerAPIHandler(
          'GET',
          endpoint,
          handlerOrVersion,
          maybeHandler as APIRouteHandler<T, M, H>,
        );
      } else {
        this.registerAPIHandler('GET', endpoint, handlerOrVersion);
      }
    },
    /**
     * Register a POST endpoint
     *
     * @param endpoint - Path segment (e.g., "users" or "upload/avatar")
     *   - Convention: Do NOT include leading slash - endpoints are path segments, not full paths
     *   - Leading slashes are allowed but will be stripped during normalization
     * @param handlerOrVersion - Handler function, or version number if using versioned handler
     * @param maybeHandler - Handler function when version is specified
     */
    post: (
      endpoint: string,
      handlerOrVersion: number | APIRouteHandler<T, M, H>,
      maybeHandler?: APIRouteHandler<T, M, H>,
    ): void => {
      if (typeof handlerOrVersion === 'number') {
        this.registerAPIHandler(
          'POST',
          endpoint,
          handlerOrVersion,
          maybeHandler as APIRouteHandler<T, M, H>,
        );
      } else {
        this.registerAPIHandler('POST', endpoint, handlerOrVersion);
      }
    },
    /**
     * Register a PUT endpoint
     *
     * @param endpoint - Path segment (e.g., "users/:id" or "items/:itemId")
     *   - Convention: Do NOT include leading slash - endpoints are path segments, not full paths
     *   - Leading slashes are allowed but will be stripped during normalization
     * @param handlerOrVersion - Handler function, or version number if using versioned handler
     * @param maybeHandler - Handler function when version is specified
     */
    put: (
      endpoint: string,
      handlerOrVersion: number | APIRouteHandler<T, M, H>,
      maybeHandler?: APIRouteHandler<T, M, H>,
    ): void => {
      if (typeof handlerOrVersion === 'number') {
        this.registerAPIHandler(
          'PUT',
          endpoint,
          handlerOrVersion,
          maybeHandler as APIRouteHandler<T, M, H>,
        );
      } else {
        this.registerAPIHandler('PUT', endpoint, handlerOrVersion);
      }
    },
    /**
     * Register a DELETE endpoint
     *
     * @param endpoint - Path segment (e.g., "users/:id" or "items/:itemId")
     *   - Convention: Do NOT include leading slash - endpoints are path segments, not full paths
     *   - Leading slashes are allowed but will be stripped during normalization
     * @param handlerOrVersion - Handler function, or version number if using versioned handler
     * @param maybeHandler - Handler function when version is specified
     */
    delete: (
      endpoint: string,
      handlerOrVersion: number | APIRouteHandler<T, M, H>,
      maybeHandler?: APIRouteHandler<T, M, H>,
    ): void => {
      if (typeof handlerOrVersion === 'number') {
        this.registerAPIHandler(
          'DELETE',
          endpoint,
          handlerOrVersion,
          maybeHandler as APIRouteHandler<T, M, H>,
        );
      } else {
        this.registerAPIHandler('DELETE', endpoint, handlerOrVersion);
      }
    },
    /**
     * Register a PATCH endpoint
     *
     * @param endpoint - Path segment (e.g., "users/:id" or "profile")
     *   - Convention: Do NOT include leading slash - endpoints are path segments, not full paths
     *   - Leading slashes are allowed but will be stripped during normalization
     * @param handlerOrVersion - Handler function, or version number if using versioned handler
     * @param maybeHandler - Handler function when version is specified
     */
    patch: (
      endpoint: string,
      handlerOrVersion: number | APIRouteHandler<T, M, H>,
      maybeHandler?: APIRouteHandler<T, M, H>,
    ): void => {
      if (typeof handlerOrVersion === 'number') {
        this.registerAPIHandler(
          'PATCH',
          endpoint,
          handlerOrVersion,
          maybeHandler as APIRouteHandler<T, M, H>,
        );
      } else {
        this.registerAPIHandler('PATCH', endpoint, handlerOrVersion);
      }
    },
  } as const;

  /**
   * Install the not-found resolution used when a handler calls
   * request.trigger404().
   *
   * Both servers call this on both registries just before registerRoutes(), so
   * an abandoned request and a genuine miss resolve through the same config.
   */
  public setNotFoundResolution(config: APINotFoundResolutionConfig): void {
    this.notFoundResolution = config;
  }

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
            const routeParams = (request.params || {}) as Record<
              string,
              unknown
            >;

            const queryParams = (request.query || {}) as Record<
              string,
              unknown
            >;

            const originalURL = request.url;
            const requestPath = originalURL.split('?')[0] || originalURL;

            // Opens the window in which request.trigger404() is callable, so a
            // call from anywhere else throws instead of being ignored. The
            // scope belongs to this invocation, not to the request.
            const trigger404Scope = openTrigger404Scope();

            let envelope;

            try {
              envelope = await runInTrigger404Scope(trigger404Scope, () =>
                handler(request, createControlledReply(request, reply), {
                  method,
                  endpoint,
                  version,
                  fullPath,
                  routeParams,
                  queryParams,
                  requestPath,
                  originalURL,
                  // The decorated class is the same `H` the handler was
                  // registered against, but the request decoration is only
                  // typed as the base class.
                  APIResponseHelpers: getAPIResponseHelpersClass(request) as H,
                }),
              );
            } finally {
              closeTrigger404Scope(trigger404Scope);
            }

            // Must run before the checks below: the sentinel is not a valid
            // envelope, so checking later would reject it as an invalid
            // handler response.
            const trigger404 = await checkTrigger404({
              request,
              scope: trigger404Scope,
              reply,
              isResponseSent: reply.sent || reply.raw.headersSent,
              resolution: this.notFoundResolution,
              handlerResult: envelope,
              route: `${method} ${fullPath}`,
              version,
            });

            if (trigger404.triggered) {
              // The already-sent case has nothing left to send; the resolver
              // has set the status and headers for the other one.
              return trigger404.isResponseSent
                ? undefined
                : trigger404.envelope;
            }

            // If handler returned false, it has already sent the response
            // (e.g., via reply.sendErrorEnvelope() in a validation helper)
            if (envelope === false) {
              // Verify that the response was actually sent by the handler
              if (!reply.sent && !reply.raw.headersSent) {
                // Handler bug: returned false without sending a response
                // This is a programming error in the user's handler code
                const error = new Error(
                  `API route ${method} ${fullPath} returned false but did not send a response. ` +
                    `When returning false, you must send a response first using APIResponseHelpers.sendErrorEnvelope().`,
                );
                (error as unknown as { errorCode: string }).errorCode =
                  'handler_returned_false_without_sending';
                (error as unknown as { route: string }).route =
                  `${method} ${fullPath}`;
                throw error;
              }

              return; // Response was sent by handler, do not send anything more
            }

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
   * Expose only the lightweight shortcuts method surface for external consumers
   */
  public get apiMethod() {
    return this.api;
  }

  /**
   * Check if any API handlers have been registered
   * Useful for validation when API handling is disabled
   */
  public hasRegisteredHandlers(): boolean {
    return this.handlersByMethod.size > 0;
  }

  /**
   * Normalize and validate endpoint string (no prefix, no version)
   *
   * Endpoints are treated as path segments that will be appended to the
   * API prefix and version. Leading slashes are stripped to enforce this
   * segment-based approach.
   *
   * Convention: Callers should NOT include leading slashes, but they are
   * allowed and will be normalized away.
   *
   * @example
   * normalizeEndpoint("users/:id")  → "users/:id"
   * normalizeEndpoint("/users/:id") → "users/:id" (leading slash stripped)
   * normalizeEndpoint("upload/")    → "upload"    (trailing slash stripped)
   */
  private normalizeEndpoint(endpoint: string): string {
    const trimmed = (endpoint || '').trim();

    if (trimmed.length === 0) {
      throw new Error('Endpoint path segment cannot be empty');
    }

    // Remove leading slash - endpoints are path segments, not full paths
    let normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;

    // Remove trailing slash for consistency
    if (normalized.endsWith('/') && normalized.length > 1) {
      normalized = normalized.slice(0, -1);
    }

    // Prevent empty endpoint after normalization
    if (normalized.length === 0) {
      throw new Error(
        'Endpoint path segment cannot be empty after normalization',
      );
    }

    return normalized;
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
      return upper;
    }

    throw new Error('Unsupported HTTP method: ' + method);
  }

  private getOrCreateEndpointMap(
    method: HTTPMethod,
  ): EndpointToVersionMap<T, M, H> {
    let map = this.handlersByMethod.get(method);

    if (!map) {
      map = new Map();
      this.handlersByMethod.set(method, map);
    }

    return map;
  }

  private getOrCreateVersionMap(
    endpointMap: EndpointToVersionMap<T, M, H>,
    endpoint: string,
  ): VersionToHandlerMap<T, M, H> {
    let versionMap = endpointMap.get(endpoint);

    if (!versionMap) {
      versionMap = new Map();
      endpointMap.set(endpoint, versionMap);
    }

    return versionMap;
  }

  /**
   * Register an API handler without explicit version (uses default version if versioned)
   *
   * This method is used internally by the `.api` shortcuts method (`.api.get`, `.api.post`, etc.).
   * External users should use those shortcuts method instead, which are exposed on SSRServer and
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
    handler: APIRouteHandler<T, M, H>,
  ): void;

  /**
   * Register an API handler with explicit version
   *
   * This method is used internally by the `.api` method.
   * External users should use the public method instead: `server.api.get()`, etc.
   */
  private registerAPIHandler(
    method: HTTPMethod,
    endpoint: string,
    version: number,
    handler: APIRouteHandler<T, M, H>,
  ): void;

  /**
   * Implementation of the overloaded method
   *
   * This is the internal implementation used by the `.api` method.
   */
  private registerAPIHandler(
    method: HTTPMethod,
    endpoint: string,
    versionOrHandler: number | APIRouteHandler<T, M, H>,
    handlerMaybe?: APIRouteHandler<T, M, H>,
  ): void {
    const httpMethod = this.ensureMethod(method);
    const normalizedEndpoint = this.normalizeEndpoint(endpoint);

    let version: number;
    let handler: APIRouteHandler<T, M, H>;

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

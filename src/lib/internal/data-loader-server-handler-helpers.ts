import type { FastifyRequest, FastifyInstance } from 'fastify';
import type {
  PageResponseEnvelope,
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
 * Parameters passed to page data loader handlers with shortcuts to common fields
 *
 * Handlers should treat these params as the authoritative routing context
 * (routeParams, queryParams, requestPath, originalURL) produced by the
 * page data loader. Do not reconstruct routing info from the Fastify request.
 *
 * The Fastify request represents the original HTTP request and should be used
 * only for transport/ambient data (cookies, headers, IP, auth tokens, etc.).
 * During SSR, this is the same request that initiated the page render; after
 * hydration, client-side page data loader calls will include their own
 * transport context as appropriate.
 */
export interface PageDataHandlerParams {
  pageType: string;
  version?: number;
  /** Indicates how the handler was invoked: via HTTP route or internal short-circuit */
  invocationOrigin: 'http' | 'internal';
  // Shortcuts to common page data loader fields (extracted from request.body)
  /** Route params (from React Router via POST body) */
  routeParams: Record<string, string>;
  /** Query params (from React Router via POST body) */
  queryParams: Record<string, string>;
  /** Request path (from React Router via POST body) */
  requestPath: string;
  /** Original URL (from React Router via POST body) */
  originalURL: string;
}

/**
 * Handler function type for page data endpoints
 *
 * @param request - The Fastify request object (original request). Use for cookies, headers, IP, etc.
 * @param params - Page data context (preferred for page routing: path, query, route params)
 * @returns A PageResponseEnvelope (recommended), APIResponseEnvelope (will be converted), or false if response already sent
 *
 * **Recommendation**: Return PageResponseEnvelope for optimal performance and control.
 * APIResponseEnvelope is supported but will be converted by the pageDataLoader, which
 * adds overhead and may not preserve all metadata as intended.
 *
 * **Return false** when you've sent a custom response (e.g., using
 * APIResponseHelpers.sendErrorResponse() or validation helpers like ensureJSONBody).
 * This signals that the handler has already sent the response and the framework
 * should not attempt to send anything.
 */
export type PageDataHandler<T = unknown, M extends BaseMeta = BaseMeta> = (
  /** Original HTTP request (for cookies/headers/IP/auth) */
  originalRequest: FastifyRequest,
  reply: ControlledReply,
  params: PageDataHandlerParams,
) =>
  | Promise<PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M> | false>
  | PageResponseEnvelope<T, M>
  | APIResponseEnvelope<T, M>
  | false;

/**
 * Result returned from callHandler()
 */
export interface CallHandlerResult<T = unknown, M extends BaseMeta = BaseMeta> {
  /** Whether a handler exists for the given page type */
  exists: boolean;
  /** Version that was used when invoking the handler (if it exists) */
  version?: number;
  /** The envelope returned by the handler when successful, or false if handler sent response directly */
  result?: PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M> | false;
}

/**
 * Helper class for registering page data loader handlers on server instances
 *
 * This class provides a convenient API for registering page data endpoints that match
 * the frontend pageDataLoader expectations. It supports both versioned and non-versioned
 * endpoints with method overloading for clean API usage.
 *
 * Handlers are stored internally and registered when registerRoutes() is called.
 * Storage structure: Map<pageType, Map<version, handler>> for efficient lookups
 *
 * ## Page Type Convention
 *
 * Page types should be specified as path segments WITHOUT leading slashes:
 * - ✅ `server.pageDataHandler.register("home", handler)`           → `/api/v1/page_data/home`
 * - ✅ `server.pageDataHandler.register("protected-page", handler)` → `/api/v1/page_data/protected-page`
 * - ⚠️ `server.pageDataHandler.register("/home", handler)`          → `/api/v1/page_data/home` (leading slash stripped)
 *
 * Leading slashes are allowed but will be automatically stripped during normalization.
 *
 * This design treats page types as path segments that get appended to the API prefix,
 * version, and page data endpoint, rather than as absolute paths.
 */
export class DataLoaderServerHandlerHelpers {
  // Map<pageType, Map<version, handler>> - version defaults to 1 if not specified
  private handlersByPageType = new Map<string, Map<number, PageDataHandler>>();

  // pageDataHandler method-specific helpers
  private readonly pageDataHandler = {
    /**
     * Register a page data handler
     *
     * @param pageType - Page type identifier (e.g., "home" or "protected-page")
     *   - Convention: Do NOT include leading slash - page types are path segments, not full paths
     *   - Leading slashes are allowed but will be stripped during normalization
     *   - The final path is constructed as: prefix + version + pageDataEndpoint + pageType
     *     Example: "home" → "/api/v1/page_data/home" (with prefix="/api", versioned, pageDataEndpoint="page_data")
     * @param versionOrHandler - Handler function, or version number if using versioned handler
     * @param handlerMaybe - Handler function when version is specified
     */
    register: (
      pageType: string,
      versionOrHandler: number | PageDataHandler,
      handlerMaybe?: PageDataHandler,
    ): void => {
      if (typeof versionOrHandler === 'number') {
        this.registerDataLoaderHandler(
          pageType,
          versionOrHandler,
          handlerMaybe as PageDataHandler,
        );
      } else {
        this.registerDataLoaderHandler(pageType, versionOrHandler);
      }
    },
  } as const;

  /** Expose only the lightweight shortcuts surface for external consumers */
  public get pageDataHandlerMethod() {
    return this.pageDataHandler;
  }

  /**
   * Check if any page data loader handlers have been registered
   * Useful for validation when API handling is disabled
   */
  public hasRegisteredHandlers(): boolean {
    return this.handlersByPageType.size > 0;
  }

  /**
   * Register all stored handlers with the Fastify instance.
   * This is called during server listen() to actually register the routes.
   *
   * @param fastify - The Fastify instance to register routes on
   * @param apiPrefix - Pre-normalized API prefix (e.g., "/api")
   * @param pageDataEndpoint - Pre-normalized page data endpoint (e.g., "page_data")
   * @param options - Optional config for versioning
   */
  public registerRoutes(
    fastify: FastifyInstance,
    apiPrefix: string,
    pageDataEndpoint: string,
    options?: {
      versioned?: boolean;
    },
  ): void {
    const useVersioning = options?.versioned ?? true;

    // Iterate over all page types and their versions
    for (const [pageType, versionMap] of this.handlersByPageType) {
      // Check if versioning is disabled but multiple versions exist
      validateSingleVersionWhenDisabled(
        useVersioning,
        versionMap,
        `Page type "${pageType}"`,
      );

      // Register each version
      for (const [version, handler] of versionMap) {
        // Build the endpoint path
        const endpointPath = useVersioning
          ? `${apiPrefix}/v${version}/${pageDataEndpoint}/${pageType}`
          : `${apiPrefix}/${pageDataEndpoint}/${pageType}`;

        // Register the POST route with Fastify
        fastify.post(endpointPath, async (request, reply) => {
          try {
            // Extract page data loader fields from request body
            const requestBody = (request.body as Record<string, unknown>) || {};

            // Merge ssr_request_context into request.requestContext (SSR forwarding)
            // SECURITY: Only trust ssr_request_context when request comes from a trusted SSR server
            // This requires the clientInfo plugin to be registered and validates the source IP
            const clientInfo = (
              request as { clientInfo?: { isFromSSRServerAPICall?: boolean } }
            ).clientInfo;

            if (
              clientInfo?.isFromSSRServerAPICall &&
              requestBody.ssr_request_context !== null &&
              typeof requestBody.ssr_request_context === 'object' &&
              !Array.isArray(requestBody.ssr_request_context)
            ) {
              const contextToMerge = requestBody.ssr_request_context as Record<
                string,
                unknown
              >;

              // Only merge if there's actual data to merge (optimization: skip empty objects)
              if (Object.keys(contextToMerge).length > 0) {
                const reqWithContext = request as {
                  requestContext?: Record<string, unknown>;
                };

                // Merge into existing requestContext (APIServer/SSRServer initialize it as empty object)
                if (!reqWithContext.requestContext) {
                  reqWithContext.requestContext = {};
                }

                Object.assign(reqWithContext.requestContext, contextToMerge);
              }
            }

            // Validate required POST body fields from frontend page data loader
            // These represent the React Router URL/params (NOT the Fastify API endpoint)
            // If missing, fail fast with 400 Bad Request rather than continuing with empty values
            const routeParams = requestBody.route_params;
            const queryParams = requestBody.query_params;
            const requestPath = requestBody.request_path;
            const originalURL = requestBody.original_url;

            // Validate that routing fields have correct types
            const invalidFields = [];

            // Required string fields
            if (typeof requestPath !== 'string') {
              invalidFields.push('request_path (must be string)');
            }

            if (typeof originalURL !== 'string') {
              invalidFields.push('original_url (must be string)');
            }

            // Optional object fields - if present and not null/undefined, must be objects
            if (
              routeParams !== null &&
              routeParams !== undefined &&
              (typeof routeParams !== 'object' || Array.isArray(routeParams))
            ) {
              invalidFields.push(
                'route_params (must be object or null/undefined)',
              );
            }

            if (
              queryParams !== null &&
              queryParams !== undefined &&
              (typeof queryParams !== 'object' || Array.isArray(queryParams))
            ) {
              invalidFields.push(
                'query_params (must be object or null/undefined)',
              );
            }

            if (invalidFields.length > 0) {
              // Client error: malformed request body - return proper API error envelope
              reply.code(400).send(
                APIResponseHelpers.createAPIErrorResponse({
                  request,
                  statusCode: 400,
                  errorCode: 'invalid_page_data_body_fields',
                  errorMessage:
                    'Request body has invalid field types for page data loader',
                  errorDetails: {
                    invalid_fields: invalidFields,
                    received_body: requestBody,
                  },
                }),
              );
              return;
            }

            const result = await handler(
              request,
              createControlledReply(reply),
              {
                pageType,
                version,
                invocationOrigin: 'http',
                // Extract from POST body (sent by frontend page data loader with React Router context)
                // Note: These represent the React Router URL/params, NOT the Fastify request URL
                routeParams:
                  (routeParams as Record<string, string> | undefined) || {},
                queryParams:
                  (queryParams as Record<string, string> | undefined) || {},
                requestPath: requestPath as string,
                originalURL: originalURL as string,
              },
            );

            // If handler returned false, it has already sent the response
            // (e.g., via reply.sendErrorEnvelope() in a validation helper)
            if (result === false) {
              // Verify that the response was actually sent by the handler
              if (!reply.sent) {
                // Handler bug: returned false without sending a response
                // This is a programming error in the user's handler code
                const error = new Error(
                  `Handler for page type "${pageType}" returned false but did not send a response. ` +
                    `When returning false, you must send a response first using APIResponseHelpers.sendErrorResponse().`,
                );
                (error as unknown as { pageType: string }).pageType = pageType;
                (error as unknown as { version: number }).version = version;
                (error as unknown as { errorCode: string }).errorCode =
                  'handler_returned_false_without_sending';
                throw error;
              }
              return; // Response was sent by handler, do not send anything more
            }

            // Validate that the handler returned a proper envelope object
            if (!APIResponseHelpers.isValidEnvelope(result)) {
              // Create error with detailed context - logging will be handled by catch block
              const error = new Error(
                `Handler for page type "${pageType}" returned invalid response envelope`,
              );

              // Add metadata for error handlers
              (error as unknown as { pageType: string }).pageType = pageType;

              (error as unknown as { version: number }).version = version;
              (
                error as unknown as { handlerResponse: unknown }
              ).handlerResponse = result; // Include the actual invalid response

              (
                error as unknown as { handlerResponseType: string }
              ).handlerResponseType =
                typeof result === 'object' ? 'invalid_object' : typeof result;

              (error as unknown as { errorCode: string }).errorCode =
                'invalid_handler_response';

              throw error;
            }

            // Set HTTP status code from the envelope response
            reply.code(result.status_code);

            if (result.status_code >= 400) {
              reply.header('Cache-Control', 'no-store');
            }

            return result;
          } catch (error) {
            // Handle any errors thrown by the handler
            fastify.log.error(
              { err: error },
              `Error in handler for ${pageType} v${version}`,
            );

            // Re-throw the error to let downstream error handlers manage it
            // Add context metadata if it's not already present
            if (error instanceof Error) {
              if (!(error as unknown as { pageType: string }).pageType) {
                (error as unknown as { pageType: string }).pageType = pageType;
                (error as unknown as { version: number }).version = version;
              }
            }

            throw error;
          }
        });
      }
    }
  }

  /**
   * Programmatically invoke the latest registered handler for a page type.
   *
   * - Selects the highest version registered for the provided page type
   * - Supports an optional timeout (milliseconds). On timeout, throws an Error
   *   (mirrors fetch-style timeout behavior).
   * - Returns an object indicating existence and the handler's envelope when available
   */
  public async callHandler<
    T = unknown,
    M extends BaseMeta = BaseMeta,
  >(options: {
    /** Original HTTP request (for cookies/headers/IP/auth) */
    originalRequest: FastifyRequest;
    /** Controlled reply (required for internal short-circuit path) */
    controlledReply: ControlledReply;
    pageType: string;
    /** Timeout in milliseconds; if omitted or <= 0, no timeout is applied */
    timeoutMS?: number;
    /** Route params (from React Router via POST body) */
    routeParams: Record<string, string>;
    /** Query params (from React Router via POST body) */
    queryParams: Record<string, string>;
    /** Request path (from React Router via POST body) */
    requestPath: string;
    /** Original URL (from React Router via POST body) */
    originalURL: string;
  }): Promise<CallHandlerResult<T, M>> {
    const {
      originalRequest,
      pageType,
      timeoutMS,
      routeParams,
      queryParams,
      requestPath,
      originalURL,
    } = options;

    // Normalize pageType for consistent lookups
    const normalizedPageType = this.normalizePageType(pageType);
    const versionMap = this.handlersByPageType.get(normalizedPageType);

    if (!versionMap || versionMap.size === 0) {
      return { exists: false };
    }

    const latestVersion = this.getLatestVersion(pageType);
    if (latestVersion === undefined) {
      return { exists: false };
    }

    const handlerUncasted = versionMap.get(latestVersion);

    if (!handlerUncasted) {
      return { exists: false };
    }

    const handler = handlerUncasted as PageDataHandler<T, M>;

    // Assemble the request body with normalized pageType
    const finalParams: PageDataHandlerParams = {
      pageType: normalizedPageType,
      version: latestVersion,
      invocationOrigin: 'internal',
      routeParams,
      queryParams,
      requestPath,
      originalURL,
    };

    // Defer invocation to the microtask queue and normalize to a Promise.
    // Using Promise.resolve().then(() => ...) ensures synchronous throws from
    // the handler become Promise rejections instead of escaping before our
    // timeout race is set up. Non-Promise returns are treated as resolved values.
    const invocation = Promise.resolve().then(() =>
      handler(originalRequest, options.controlledReply, finalParams),
    );

    // Attach a no-op catch when using a timeout to prevent a possible
    // unhandledRejection if the timeout "wins" and the handler later rejects.
    if (timeoutMS && timeoutMS > 0) {
      void invocation.catch(() => {});
    }

    // Track the timeout ID to ensure it is cleared regardless of timeout path
    let timeoutID: ReturnType<typeof setTimeout> | undefined;

    // Build a single promise that either resolves to the handler result or rejects on timeout
    const resultPromise: Promise<
      PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M> | false
    > =
      // Check if a timeout is specified
      !timeoutMS || timeoutMS <= 0
        ? // No timeout specified, return the handler result immediately
          // Handler promise when no timer is specified
          (invocation as Promise<
            PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M> | false
          >)
        : // If a timeout is specified, race the handler promise with a timer promise
          (Promise.race([
            // Handler promise
            invocation,
            // Timer promise
            new Promise<never>((_, reject) => {
              timeoutID = setTimeout(() => {
                const error = new Error(`Request timeout after ${timeoutMS}ms`);
                (error as unknown as { pageType: string }).pageType = pageType;
                (error as unknown as { version: number }).version =
                  latestVersion;
                (error as unknown as { timeoutMS: number }).timeoutMS =
                  timeoutMS;
                (error as unknown as { errorCode: string }).errorCode =
                  'handler_timeout';
                reject(error);
              }, timeoutMS);
            }),
          ]) as Promise<
            PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M> | false
          >);

    // Ensure the timeout is cleared regardless of timeout path
    const result = await resultPromise.finally(() => {
      if (timeoutID) {
        clearTimeout(timeoutID);
      }
    });

    // If handler returned false, it has already sent the response
    if (result === false) {
      return { exists: true, version: latestVersion, result: false };
    }

    // Validate that the handler returned a proper envelope object
    if (!APIResponseHelpers.isValidEnvelope(result)) {
      const error = new Error(
        `Handler for page type "${pageType}" returned invalid response envelope`,
      );
      (error as unknown as { pageType: string }).pageType = pageType;
      (error as unknown as { version: number }).version = latestVersion;
      (error as unknown as { handlerResponse: unknown }).handlerResponse =
        result;
      (
        error as unknown as { handlerResponseType: string }
      ).handlerResponseType =
        typeof result === 'object' ? 'invalid_object' : typeof result;
      (error as unknown as { errorCode: string }).errorCode =
        'invalid_handler_response';
      throw error;
    }

    return { exists: true, version: latestVersion, result };
  }

  /**
   * Check if a handler is registered for the given page type and version
   * Used internally by pageDataLoader for short-circuit optimization
   */
  public hasHandler(pageType: string, version?: number): boolean {
    const normalizedPageType = this.normalizePageType(pageType);
    const versionMap = this.handlersByPageType.get(normalizedPageType);

    if (!versionMap) {
      return false;
    }

    // If no version specified, check if any version exists
    if (version === undefined) {
      return versionMap.size > 0;
    }

    return versionMap.has(version);
  }

  /**
   * Normalize and validate pageType string
   *
   * Page types are treated as path segments that will be appended to the
   * API prefix, version, and page data endpoint. Leading slashes are stripped
   * to enforce this segment-based approach.
   *
   * Convention: Callers should NOT include leading slashes, but they are
   * allowed and will be normalized away.
   *
   * @example
   * normalizePageType("home")            → "home"
   * normalizePageType("/home")           → "home" (leading slash stripped)
   * normalizePageType("protected-page/") → "protected-page" (trailing slash stripped)
   */
  private normalizePageType(pageType: string): string {
    const trimmed = (pageType || '').trim();

    if (trimmed.length === 0) {
      throw new Error('Page type cannot be empty');
    }

    // Remove leading slash - page types are path segments, not full paths
    let normalized = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;

    // Remove trailing slash for consistency
    if (normalized.endsWith('/') && normalized.length > 1) {
      normalized = normalized.slice(0, -1);
    }

    // Prevent empty pageType after normalization
    if (normalized.length === 0) {
      throw new Error('Page type cannot be empty after normalization');
    }

    return normalized;
  }

  /**
   * Returns the latest (highest) version registered for a given page type
   */
  private getLatestVersion(pageType: string): number | undefined {
    const normalizedPageType = this.normalizePageType(pageType);
    const versionMap = this.handlersByPageType.get(normalizedPageType);

    if (!versionMap || versionMap.size === 0) {
      return undefined;
    }

    let latestVersion = -Infinity;

    for (const version of versionMap.keys()) {
      if (version > latestVersion) {
        latestVersion = version;
      }
    }

    return Number.isFinite(latestVersion) ? latestVersion : undefined;
  }

  /**
   * Register a page data loader handler without explicit version (uses default version if versioned)
   */
  private registerDataLoaderHandler(
    pageType: string,
    handler: PageDataHandler,
  ): void;

  /**
   * Register a page data loader handler with explicit version
   */
  private registerDataLoaderHandler(
    pageType: string,
    version: number,
    handler: PageDataHandler,
  ): void;

  /**
   * Implementation of the overloaded method
   */
  private registerDataLoaderHandler(
    pageType: string,
    versionOrHandler: number | PageDataHandler,
    handler?: PageDataHandler,
  ): void {
    // Normalize pageType to handle leading/trailing slashes
    const normalizedPageType = this.normalizePageType(pageType);

    let version: number;
    let actualHandler: PageDataHandler;

    if (typeof versionOrHandler === 'function') {
      // 2-param overload: registerDataLoaderHandler(pageType, handler)
      // Default to version 1 when not specified
      version = 1;
      actualHandler = versionOrHandler;
    } else {
      // 3-param overload: registerDataLoaderHandler(pageType, version, handler)
      if (!handler) {
        throw new Error(
          'Handler function is required when version is specified',
        );
      }

      validateVersion(versionOrHandler, 'Page data loader');
      version = versionOrHandler;
      actualHandler = handler;
    }

    // Get or create the version map for this page type
    let versionMap = this.handlersByPageType.get(normalizedPageType);

    if (!versionMap) {
      versionMap = new Map<number, PageDataHandler>();
      this.handlersByPageType.set(normalizedPageType, versionMap);
    }

    // Last registration wins for the same pageType + version
    versionMap.set(version, actualHandler);
  }
}

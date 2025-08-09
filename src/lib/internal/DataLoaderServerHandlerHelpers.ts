import type { FastifyRequest, FastifyInstance } from "fastify";
import type {
  PageResponseEnvelope,
  APIResponseEnvelope,
  BaseMeta,
} from "../api-envelope/api-envelope-types";
import { APIResponseHelpers } from "../api-envelope/response-helpers";

/**
 * Parameters passed to page data handlers with shortcuts to common fields
 *
 * Handlers should treat these params as the authoritative routing context
 * (route_params, query_params, request_path, original_url) produced by the
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
  invocation_origin: "http" | "internal";
  // Shortcuts to common page data loader fields (extracted from request.body)
  route_params: Record<string, string>;
  query_params: Record<string, string>;
  request_path: string;
  original_url: string;
}

/**
 * Configuration for page data endpoints
 */
export interface PageDataHandlersConfig {
  /** Endpoint prefix that comes before version/endpoint (default: "/api") */
  endpointPrefix?: string;
  /** Base endpoint name for page data (default: "page_data") */
  endpoint?: string;
  /** Whether to enable versioning (default: true, matches frontend expectations) */
  versioned?: boolean;
  /** Default version when versioning is enabled (default: 1) */
  defaultVersion?: number;
}

/**
 * Handler function type for page data endpoints
 *
 * @param request - The Fastify request object (original request). Use for cookies, headers, IP, etc.
 * @param params - Page data context (preferred for page routing: path, query, route params)
 * @returns A PageResponseEnvelope (recommended) or APIResponseEnvelope (will be converted)
 *
 * **Recommendation**: Return PageResponseEnvelope for optimal performance and control.
 * APIResponseEnvelope is supported but will be converted by the pageDataLoader, which
 * adds overhead and may not preserve all metadata as intended.
 */
export type PageDataHandler<T = unknown, M extends BaseMeta = BaseMeta> = (
  /** Original HTTP request (for cookies/headers/IP/auth) */
  originalRequest: FastifyRequest,
  params: PageDataHandlerParams,
) =>
  | Promise<PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M>>
  | PageResponseEnvelope<T, M>
  | APIResponseEnvelope<T, M>;

/**
 * Result returned from callHandler()
 */
export interface CallHandlerResult<T = unknown, M extends BaseMeta = BaseMeta> {
  /** Whether a handler exists for the given page type */
  exists: boolean;
  /** Version that was used when invoking the handler (if it exists) */
  version?: number;
  /** The envelope returned by the handler when successful */
  result?: PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M>;
}

/**
 * Helper class for registering page data handlers on server instances
 *
 * This class provides a convenient API for registering page data endpoints that match
 * the frontend pageDataLoader expectations. It supports both versioned and non-versioned
 * endpoints with method overloading for clean API usage.
 *
 * Handlers are stored internally and registered when registerRoutes() is called.
 * Storage structure: Map<pageType, Map<version, handler>> for efficient lookups
 */
export class DataLoaderServerHandlerHelpers {
  // Map<pageType, Map<version, handler>> - version defaults to 1 if not specified
  private handlersByPageType = new Map<string, Map<number, PageDataHandler>>();

  /**
   * Returns the latest (highest) version registered for a given page type
   */
  private getLatestVersion(pageType: string): number | undefined {
    const versionMap = this.handlersByPageType.get(pageType);

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
   * Register a page data handler without explicit version (uses default version if versioned)
   */
  registerDataLoaderHandler(pageType: string, handler: PageDataHandler): void;

  /**
   * Register a page data handler with explicit version
   */
  registerDataLoaderHandler(
    pageType: string,
    version: number,
    handler: PageDataHandler,
  ): void;

  /**
   * Implementation of the overloaded method
   */
  registerDataLoaderHandler(
    pageType: string,
    versionOrHandler: number | PageDataHandler,
    handler?: PageDataHandler,
  ): void {
    let version: number;
    let actualHandler: PageDataHandler;

    if (typeof versionOrHandler === "function") {
      // 2-param overload: registerDataLoaderHandler(pageType, handler)
      version = 1; // Default version
      actualHandler = versionOrHandler;
    } else {
      // 3-param overload: registerDataLoaderHandler(pageType, version, handler)
      if (!handler) {
        throw new Error(
          "Handler function is required when version is specified",
        );
      }

      version = versionOrHandler;
      actualHandler = handler;
    }

    // Get or create the version map for this page type
    let versionMap = this.handlersByPageType.get(pageType);

    if (!versionMap) {
      versionMap = new Map<number, PageDataHandler>();
      this.handlersByPageType.set(pageType, versionMap);
    }

    // Check for conflicts
    if (versionMap.has(version)) {
      throw new Error(
        `Handler for page type "${pageType}" version ${version} is already registered`,
      );
    }

    // Store the handler
    versionMap.set(version, actualHandler);
  }

  /**
   * Register all stored handlers with the Fastify instance
   * This is called during server listen() to actually register the routes
   */
  registerRoutes(
    fastify: FastifyInstance,
    config: PageDataHandlersConfig = {},
  ): void {
    // Apply defaults to config
    const resolvedConfig = {
      endpointPrefix: "/api",
      endpoint: "page_data",
      versioned: true,
      defaultVersion: 1,
      ...config,
    };

    // Iterate over all page types and their versions
    for (const [pageType, versionMap] of this.handlersByPageType) {
      // If versioning is disabled but multiple versions exist, throw error
      if (!resolvedConfig.versioned && versionMap.size > 1) {
        const versions = Array.from(versionMap.keys()).sort((a, b) => a - b);

        throw new Error(
          `Page type "${pageType}" has multiple versions (${versions.join(", ")}) but versioning is disabled. ` +
            `Either enable versioning or register only one version per page type.`,
        );
      }

      for (const [version, handler] of versionMap) {
        // Build the endpoint path
        let endpointPath: string;

        if (resolvedConfig.versioned) {
          endpointPath = `${resolvedConfig.endpointPrefix}/v${version}/${resolvedConfig.endpoint}/${pageType}`;
        } else {
          endpointPath = `${resolvedConfig.endpointPrefix}/${resolvedConfig.endpoint}/${pageType}`;
        }

        // Register the POST route with Fastify
        fastify.post(endpointPath, async (request, reply) => {
          try {
            // Extract page data loader fields from request body
            const requestBody = (request.body as Record<string, unknown>) || {};

            const result = await handler(request, {
              pageType,
              version,
              invocation_origin: "http",
              // Shortcuts to common page data loader fields
              route_params:
                (requestBody.route_params as Record<string, string>) || {},
              query_params:
                (requestBody.query_params as Record<string, string>) || {},
              request_path: (requestBody.request_path as string) || request.url,
              original_url: (requestBody.original_url as string) || request.url,
            });

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
                typeof result === "object" ? "invalid_object" : typeof result;

              (error as unknown as { errorCode: string }).errorCode =
                "invalid_handler_response";

              throw error;
            }

            // Set HTTP status code from the envelope response
            reply.status(result.status_code);

            return result;
          } catch (error) {
            // Handle any errors thrown by the handler
            fastify.log.error(
              `Error in handler for ${pageType} v${version}:`,
              error,
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
    pageType: string;
    /** Timeout in milliseconds; if omitted or <= 0, no timeout is applied */
    timeoutMs?: number;
    /** Route params from the router (must match pageDataLoader's route_params) */
    routeParams: Record<string, string>;
    /** Query params from the URL (must match pageDataLoader's query_params) */
    queryParams: Record<string, string>;
    /** Request path (must match pageDataLoader's request_path) */
    requestPath: string;
    /** Original URL (must match pageDataLoader's original_url) */
    originalUrl: string;
  }): Promise<CallHandlerResult<T, M>> {
    const {
      originalRequest,
      pageType,
      timeoutMs,
      routeParams,
      queryParams,
      requestPath,
      originalUrl,
    } = options;

    const versionMap = this.handlersByPageType.get(pageType);
    if (!versionMap || versionMap.size === 0) {
      return { exists: false };
    }

    const latestVersion = this.getLatestVersion(pageType);
    if (latestVersion === undefined) {
      return { exists: false };
    }

    const handlerUncast = versionMap.get(latestVersion);
    if (!handlerUncast) {
      return { exists: false };
    }

    const handler = handlerUncast as PageDataHandler<T, M>;

    const finalParams: PageDataHandlerParams = {
      pageType,
      version: latestVersion,
      invocation_origin: "internal",
      route_params: routeParams,
      query_params: queryParams,
      request_path: requestPath,
      original_url: originalUrl,
    };

    const invocation = Promise.resolve(handler(originalRequest, finalParams));

    // Build a single promise that either resolves to the handler result or rejects on timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const resultPromise: Promise<
      PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M>
    > =
      // Check if a timeout is specified
      !timeoutMs || timeoutMs <= 0
        ? // No timeout specified, return the handler result immediately
          // Handler promise when no timer is specified
          (invocation as Promise<
            PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M>
          >)
        : // If a timeout is specified, race the handler promise with a timer promise
          (Promise.race([
            // Handler promise
            invocation,
            // Timer promise
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                const error = new Error(`Request timeout after ${timeoutMs}ms`);
                (error as unknown as { pageType: string }).pageType = pageType;
                (error as unknown as { version: number }).version =
                  latestVersion;
                (error as unknown as { timeoutMs: number }).timeoutMs =
                  timeoutMs as number;
                (error as unknown as { errorCode: string }).errorCode =
                  "handler_timeout";
                reject(error);
              }, timeoutMs);
            }),
          ]) as Promise<
            PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M>
          >);

    // Ensure the timeout is cleared regardless of timeout path
    const result = await resultPromise.finally(() => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    });

    // Validate once regardless of timeout path
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
        typeof result === "object" ? "invalid_object" : typeof result;
      (error as unknown as { errorCode: string }).errorCode =
        "invalid_handler_response";
      throw error;
    }

    return { exists: true, version: latestVersion, result };
  }

  /**
   * Check if a handler is registered for the given page type and version
   */
  hasHandler(pageType: string, version?: number): boolean {
    const versionMap = this.handlersByPageType.get(pageType);
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
   * Remove a specific handler
   */
  removeHandler(pageType: string, version?: number): boolean {
    const versionMap = this.handlersByPageType.get(pageType);
    if (!versionMap) {
      return false;
    }

    const targetVersion = version ?? 1; // Default to version 1 if not specified
    const removed = versionMap.delete(targetVersion);

    // Clean up empty version map
    if (versionMap.size === 0) {
      this.handlersByPageType.delete(pageType);
    }

    return removed;
  }

  /**
   * Get all registered handlers grouped by page type
   * Returns an object with pageType as key and array of versions as value
   */
  getHandlers(): Record<string, number[]> {
    const handlers: Record<string, number[]> = {};

    for (const [pageType, versionMap] of this.handlersByPageType) {
      handlers[pageType] = Array.from(versionMap.keys()).sort((a, b) => a - b);
    }

    return handlers;
  }

  /**
   * Clear all stored handlers (useful for testing or server restart)
   */
  clearHandlers(): void {
    this.handlersByPageType.clear();
  }
}

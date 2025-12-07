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
  invocation_origin: 'http' | 'internal';
  // Shortcuts to common page data loader fields (extracted from request.body)
  route_params: Record<string, string>;
  query_params: Record<string, string>;
  request_path: string;
  original_url: string;
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
  reply: ControlledReply,
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

  // ---------------------------------------------------------------------------
  // Shortcuts API for registration (mirrors APIRoutesServerHelpers style)
  // ---------------------------------------------------------------------------
  public readonly pageLoader = {
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
  public get pageLoaderShortcuts() {
    return this.pageLoader;
  }

  /**
   * Check if any page data handlers have been registered
   * Useful for validation when API handling is disabled
   */
  hasRegisteredHandlers(): boolean {
    return this.handlersByPageType.size > 0;
  }

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
    let versionMap = this.handlersByPageType.get(pageType);

    if (!versionMap) {
      versionMap = new Map<number, PageDataHandler>();
      this.handlersByPageType.set(pageType, versionMap);
    }

    // Last registration wins for the same pageType + version
    versionMap.set(version, actualHandler);
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
  registerRoutes(
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

            const result = await handler(
              request,
              createControlledReply(reply),
              {
                pageType,
                version,
                invocation_origin: 'http',
                // Shortcuts to common page data loader fields
                route_params:
                  (requestBody.route_params as Record<string, string>) || {},
                query_params:
                  (requestBody.query_params as Record<string, string>) || {},
                request_path:
                  (requestBody.request_path as string) || request.url,
                original_url:
                  (requestBody.original_url as string) || request.url,
              },
            );

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
    timeoutMs?: number;
    /** Route params from the router (must match pageDataLoader's route_params) */
    route_params: Record<string, string>;
    /** Query params from the URL (must match pageDataLoader's query_params) */
    query_params: Record<string, string>;
    /** Request path (must match pageDataLoader's request_path) */
    request_path: string;
    /** Original URL (must match pageDataLoader's original_url) */
    original_url: string;
  }): Promise<CallHandlerResult<T, M>> {
    const {
      originalRequest,
      pageType,
      timeoutMs,
      route_params,
      query_params,
      request_path,
      original_url,
    } = options;

    const versionMap = this.handlersByPageType.get(pageType);
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

    // Assemble the request body
    const finalParams: PageDataHandlerParams = {
      pageType,
      version: latestVersion,
      invocation_origin: 'internal',
      route_params,
      query_params,
      request_path,
      original_url,
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
    if (timeoutMs && timeoutMs > 0) {
      void invocation.catch(() => {});
    }

    // Track the timeout ID to ensure it is cleared regardless of timeout path
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Build a single promise that either resolves to the handler result or rejects on timeout
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
                  timeoutMs;
                (error as unknown as { errorCode: string }).errorCode =
                  'handler_timeout';
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
}

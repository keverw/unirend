import type { FastifyRequest, FastifyInstance } from "fastify";
import type {
  PageResponseEnvelope,
  APIResponseEnvelope,
  BaseMeta,
} from "../api-envelope/api-envelope-types";
import { APIResponseHelpers } from "../api-envelope/response-helpers";

/**
 * Parameters passed to page data handlers with shortcuts to common fields
 */
export interface PageDataHandlerParams {
  pageType: string;
  version?: number;
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
 * @param request - The Fastify request object (for cookies, headers, etc.)
 * @param params - Page data information with shortcuts to common fields
 * @returns A PageResponseEnvelope (recommended) or APIResponseEnvelope (will be converted)
 *
 * **Recommendation**: Return PageResponseEnvelope for optimal performance and control.
 * APIResponseEnvelope is supported but will be converted by the pageDataLoader, which
 * adds overhead and may not preserve all metadata as intended.
 */
export type PageDataHandler<T = unknown, M extends BaseMeta = BaseMeta> = (
  request: FastifyRequest,
  params: PageDataHandlerParams,
) =>
  | Promise<PageResponseEnvelope<T, M> | APIResponseEnvelope<T, M>>
  | PageResponseEnvelope<T, M>
  | APIResponseEnvelope<T, M>;

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

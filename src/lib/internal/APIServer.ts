import fastify, { type FastifyServerOptions } from "fastify";
import {
  createControlledInstance,
  isPageDataRequest,
  createDefaultAPIErrorResponse,
  createDefaultAPINotFoundResponse,
  validateAndRegisterPlugin,
} from "./server-utils";
import type { APIServerOptions, PluginMetadata } from "../types";
import { BaseServer } from "./BaseServer";
import {
  DataLoaderServerHandlerHelpers,
  type PageDataHandler,
} from "./DataLoaderServerHandlerHelpers";
import { APIRoutesServerHelpers } from "./APIRoutesServerHelpers";

/**
 * API Server class for creating JSON API servers with plugin support
 * Uses createControlledInstance with disableRootWildcard: false to allow full wildcard flexibility
 */
export class APIServer extends BaseServer {
  private options: APIServerOptions;
  private pageDataHandlers!: DataLoaderServerHandlerHelpers;
  private apiRoutes!: APIRoutesServerHelpers;
  private registeredPlugins: PluginMetadata[] = [];

  constructor(options: APIServerOptions = {}) {
    super();
    this.options = {
      isDevelopment: false,
      ...options,
    };

    // Initialize helpers (available immediately for handler registration)
    this.pageDataHandlers = new DataLoaderServerHandlerHelpers();
    this.apiRoutes = new APIRoutesServerHelpers();
  }

  /**
   * Start the API server
   * @param port Port to bind to (default: 3000)
   * @param host Host to bind to (default: "localhost")
   * @returns Promise that resolves when server is ready
   */
  async listen(port: number = 3000, host: string = "localhost"): Promise<void> {
    if (this._isListening) {
      throw new Error(
        "APIServer is already listening. Call stop() first before listening again.",
      );
    }

    if (this._isStarting) {
      throw new Error(
        "APIServer is already starting. Please wait for the current startup to complete.",
      );
    }

    this._isStarting = true;

    // Clear plugin tracking state on startup (handles restart scenarios)
    this.registeredPlugins = [];

    // Clean up any existing instances from previous failed startups
    if (this.fastifyInstance) {
      try {
        await this.fastifyInstance.close();
      } catch {
        // Ignore cleanup errors for stale instances
      }

      this.fastifyInstance = null;
    }

    try {
      // Build Fastify options from curated subset
      const fastifyOptions: FastifyServerOptions = {};

      if (this.options.fastifyOptions) {
        const { logger, trustProxy, bodyLimit, keepAliveTimeout } =
          this.options.fastifyOptions;

        if (logger !== undefined) {
          fastifyOptions.logger = logger;
        }

        if (trustProxy !== undefined) {
          fastifyOptions.trustProxy = trustProxy;
        }

        if (bodyLimit !== undefined) {
          fastifyOptions.bodyLimit = bodyLimit;
        }

        if (keepAliveTimeout !== undefined) {
          fastifyOptions.keepAliveTimeout = keepAliveTimeout;
        }
      }

      this.fastifyInstance = fastify(fastifyOptions);

      // Decorate requests with environment info (per-request)
      const mode: "development" | "production" = this.options.isDevelopment
        ? "development"
        : "production";
      const isDevelopment = mode === "development";
      this.fastifyInstance.decorateRequest("isDevelopment", isDevelopment);

      // Register global error handler
      this.setupErrorHandler();
      // Register not-found handler
      this.setupNotFoundHandler();

      // Register plugins if provided
      if (this.options.plugins && this.options.plugins.length > 0) {
        await this.registerPlugins();
      }

      // Register page data handler routes with Fastify
      this.pageDataHandlers.registerRoutes(this.fastifyInstance, {
        apiEndpointPrefix: this.options.apiEndpoints?.apiEndpointPrefix,
        versioned: this.options.apiEndpoints?.versioned,
        defaultVersion: this.options.apiEndpoints?.defaultVersion,
        pageDataEndpoint: this.options.apiEndpoints?.pageDataEndpoint,
      });

      // Register generic API routes (if any were added programmatically)
      this.apiRoutes.registerRoutes(
        this.fastifyInstance,
        {
          apiEndpointPrefix: this.options.apiEndpoints?.apiEndpointPrefix,
          versioned: this.options.apiEndpoints?.versioned,
          defaultVersion: this.options.apiEndpoints?.defaultVersion,
        },
        { allowWildcardAtRoot: true },
      );

      // Start the server
      await this.fastifyInstance.listen({
        port,
        host: host || "localhost",
      });

      this._isListening = true;
      this._isStarting = false;
    } catch (error) {
      // Cleanup on any startup failure
      this._isListening = false;
      this._isStarting = false;

      const cleanupErrors: string[] = [];

      // Close Fastify if it was created but startup failed
      if (this.fastifyInstance) {
        try {
          await this.fastifyInstance.close();
        } catch (closeError) {
          cleanupErrors.push(
            `Fastify cleanup failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
          );
        }

        this.fastifyInstance = null;
      }

      // Clear plugin tracking state on failure
      this.registeredPlugins = [];

      // Append cleanup errors to original error message if any
      if (cleanupErrors.length > 0 && error instanceof Error) {
        // Modify the original error's message directly
        error.message = `${error.message}. Additional errors occurred: ${cleanupErrors.join(", ")}`;
      }

      throw error;
    }
  }

  /**
   * Stop the API server if it's currently listening
   * @returns Promise that resolves when server is stopped
   */
  async stop(): Promise<void> {
    if (this.fastifyInstance && this._isListening) {
      await this.fastifyInstance.close();
      this._isListening = false;
      this.fastifyInstance = null;

      // Clear plugin tracking state
      this.registeredPlugins = [];
    }
  }

  /**
   * Public API shortcuts for registering versioned generic API routes
   * Usage: server.api.get("users/:id", handler) or server.api.get("users/:id", 2, handler)
   */
  public get api() {
    return this.apiRoutes.apiShortcuts;
  }

  /**
   * Register a page data handler for the specified page type
   * Provides method overloading for versioned and non-versioned handlers
   */
  registerDataLoaderHandler(pageType: string, handler: PageDataHandler): void;
  registerDataLoaderHandler(
    pageType: string,
    version: number,
    handler: PageDataHandler,
  ): void;
  registerDataLoaderHandler(
    pageType: string,
    versionOrHandler: number | PageDataHandler,
    handler?: PageDataHandler,
  ): void {
    if (typeof versionOrHandler === "number") {
      // Called with version: registerDataLoaderHandler(pageType, version, handler)
      if (!handler) {
        throw new Error("Handler is required when version is specified");
      }

      this.pageDataHandlers.registerDataLoaderHandler(
        pageType,
        versionOrHandler,
        handler,
      );
    } else {
      // Called without version: registerDataLoaderHandler(pageType, handler)
      this.pageDataHandlers.registerDataLoaderHandler(
        pageType,
        versionOrHandler,
      );
    }
  }

  /**
   * Setup global error handler for unhandled errors
   * @private
   */
  private setupErrorHandler(): void {
    if (!this.fastifyInstance) {
      return;
    }

    this.fastifyInstance.setErrorHandler(async (error, request, reply) => {
      // Determine if the incoming request is for page data (SSR loader)
      const rawPath = request.url.split("?")[0];

      // Determine if the incoming request is for page data (SSR loader)
      // Matches both exact endpoints and paths with parameters:
      // /page_data, /page_data/foo, /v1/page_data, /v1/page_data/user/123, etc.
      const isPage = isPageDataRequest(rawPath);

      // Use custom error handler if provided
      if (this.options.errorHandler) {
        try {
          const errorResponse = await this.options.errorHandler(
            request,
            error,
            this.options.isDevelopment ?? false,
            isPage,
          );

          // Extract status code from envelope response
          const statusCode = errorResponse.status_code || 500;
          reply.status(statusCode);

          return errorResponse;
        } catch (handlerError) {
          // Fallback if custom error handler fails
          this.fastifyInstance?.log.error(
            "Error handler failed:",
            handlerError,
          );
        }
      }

      // Default case
      const statusCode = error.statusCode || 500;
      reply.status(statusCode);

      const response = createDefaultAPIErrorResponse(
        request,
        error,
        this.options.isDevelopment ?? false,
      );

      return reply.send(response);
    });
  }

  /**
   * Setup a default 404 handler that returns standardized envelopes
   * @private
   */
  private setupNotFoundHandler(): void {
    if (!this.fastifyInstance) {
      return;
    }

    this.fastifyInstance.setNotFoundHandler(async (request, reply) => {
      const rawPath = request.url.split("?")[0];
      const isPage = isPageDataRequest(rawPath);

      // If user provided custom not-found handler, use it
      if (this.options.notFoundHandler) {
        const custom = await Promise.resolve(
          this.options.notFoundHandler(request, isPage),
        );

        // Extract status code from envelope response
        const statusCode = custom.status_code || 404;
        reply.status(statusCode);

        return reply.send(custom);
      }

      // Default case
      const statusCode = 404;
      reply.status(statusCode);

      const response = createDefaultAPINotFoundResponse(request);
      return reply.send(response);
    });
  }

  /**
   * Register plugins with controlled access to Fastify instance
   * @private
   */
  private async registerPlugins(): Promise<void> {
    // If no fastify instance or plugins are provided, return early
    if (!this.fastifyInstance || !this.options.plugins) {
      return;
    }

    // Create controlled instance wrapper with full wildcard support
    const controlledInstance = createControlledInstance(
      this.fastifyInstance,
      false,
      this.apiRoutes.apiShortcuts,
      this.pageDataHandlers.pageLoaderShortcuts,
    );

    // Plugin options to pass to each plugin
    const pluginOptions = {
      serverType: "api" as const,
      mode: (this.options.isDevelopment ? "development" : "production") as
        | "development"
        | "production",
      isDevelopment: this.options.isDevelopment ?? false,
      buildDir: undefined, // Not applicable for API servers
      apiEndpoints: this.options.apiEndpoints,
    };

    // Register each plugin with dependency validation
    for (const pluginEntry of this.options.plugins) {
      try {
        const plugin =
          typeof pluginEntry === "function" ? pluginEntry : pluginEntry.plugin;
        const userOptions =
          typeof pluginEntry === "function" ? undefined : pluginEntry.options;

        // Call plugin and get potential metadata
        const pluginResult = await plugin(controlledInstance, {
          ...pluginOptions,
          userOptions,
        });

        // Validate dependencies and track plugin
        validateAndRegisterPlugin(this.registeredPlugins, pluginResult);
      } catch (error) {
        this.fastifyInstance?.log.error("Failed to register plugin:", error);
        throw new Error(
          `Plugin registration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

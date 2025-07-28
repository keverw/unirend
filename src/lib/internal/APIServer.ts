import fastify, { type FastifyServerOptions } from "fastify";
import { createControlledInstance } from "./server-utils";
import type { APIServerOptions } from "../types";
import { BaseServer } from "./BaseServer";

/**
 * API Server class for creating JSON API servers with plugin support
 * Uses createControlledInstance with disableRootWildcard: false to allow full wildcard flexibility
 */
export class APIServer extends BaseServer {
  private options: APIServerOptions;

  constructor(options: APIServerOptions = {}) {
    super();
    this.options = {
      isDevelopment: false,
      ...options,
    };
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

      // Register global error handler
      this.setupErrorHandler();

      // Register plugins if provided
      if (this.options.plugins && this.options.plugins.length > 0) {
        await this.registerPlugins();
      }

      // Start the server
      await this.fastifyInstance.listen({
        port,
        host: host || "localhost",
      });

      this._isListening = true;
    } catch (error) {
      this._isListening = false;
      this.fastifyInstance = null;
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
      // Use custom error handler if provided
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
    );

    // Plugin options to pass to each plugin
    const pluginOptions = {
      mode: (this.options.isDevelopment ? "development" : "production") as
        | "development"
        | "production",
      isDevelopment: this.options.isDevelopment ?? false,
      buildDir: undefined, // Not applicable for API servers
    };

    // Register each plugin
    for (const plugin of this.options.plugins) {
      try {
        await plugin(controlledInstance, pluginOptions);
      } catch (error) {
        this.fastifyInstance?.log.error("Failed to register plugin:", error);
        throw new Error(
          `Plugin registration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

import {
  IRenderRequest,
  IRenderResult,
  ServeSSRDevOptions,
  ServeSSRProdOptions,
  SSRDevPaths,
  StaticContentRouterOptions,
  type SSRHelper,
  type PluginMetadata,
  type APIResponseHelpersClass,
} from "../types";
import {
  readHTMLFile,
  checkAndLoadManifest,
  getServerEntryFromManifest,
  validateDevPaths,
} from "./fs-utils";
import { processTemplate } from "./html-utils/format";
import { injectContent } from "./html-utils/inject";
import path from "path";
import type {
  FastifyRequest,
  FastifyReply,
  FastifyServerOptions,
  FastifyError,
} from "fastify";
import type { ViteDevServer } from "vite";
import {
  createControlledInstance,
  isAPIRequest,
  isPageDataRequest,
  createDefaultAPIErrorResponse,
  createDefaultAPINotFoundResponse,
  createControlledReply,
  validateAndRegisterPlugin,
} from "./server-utils";
import { generateDefault500ErrorPage } from "./errorPageUtils";
import StaticContentRouterPlugin from "./middleware/static-content-router";
import { BaseServer } from "./BaseServer";
import {
  DataLoaderServerHandlerHelpers,
  type PageDataHandler,
} from "./DataLoaderServerHandlerHelpers";
import { APIRoutesServerHelpers } from "./APIRoutesServerHelpers";
import {
  WebSocketServerHelpers,
  type WebSocketHandlerConfig,
} from "./WebSocketServerHelpers";
import {
  filterIncomingCookieHeader as applyCookiePolicyToCookieHeader,
  filterSetCookieHeaderValues as applyCookiePolicyToSetCookie,
} from "./cookie-utils";
import { APIResponseHelpers } from "../../api-envelope";
import type { WebSocket, WebSocketServer } from "ws";

type SSRServerConfigDev = {
  mode: "development";
  paths: SSRDevPaths; // Contains serverEntry, template, and viteConfig paths
  options: ServeSSRDevOptions;
};

type SSRServerConfigProd = {
  mode: "production";
  buildDir: string; // Directory containing built assets (HTML template, static files, manifest, etc.)
  options: ServeSSRProdOptions;
};

type SSRServerConfig = SSRServerConfigDev | SSRServerConfigProd;

/**
 * Internal server class for handling SSR rendering
 * Not intended to be used directly by library consumers
 */

export class SSRServer extends BaseServer {
  private config: SSRServerConfig;
  private clientFolderName: string;
  private serverFolderName: string;
  /** Pluggable helpers class reference for constructing API/Page envelopes */
  public readonly APIResponseHelpersClass: APIResponseHelpersClass;
  private cachedRenderFunction:
    | ((renderRequest: IRenderRequest) => Promise<IRenderResult>)
    | null = null;
  private pageDataHandlers!: DataLoaderServerHandlerHelpers;
  private apiRoutes!: APIRoutesServerHelpers;
  private webSocketHelpers: WebSocketServerHelpers | null = null;
  private viteDevServer: ViteDevServer | null = null;
  private registeredPlugins: PluginMetadata[] = [];

  // Cookie forwarding policy (computed from options for quick checks)
  private cookieAllowList?: Set<string>;
  private cookieBlockList?: Set<string> | true;

  /**
   * Creates a new SSR server instance
   *
   * @param config Server configuration object
   */
  constructor(config: SSRServerConfig) {
    super();
    this.config = config;

    // Set folder names with defaults
    this.clientFolderName = config.options.clientFolderName || "client";
    this.serverFolderName = config.options.serverFolderName || "server";

    // Set helpers class (custom or default)
    this.APIResponseHelpersClass =
      config.options.APIResponseHelpersClass || APIResponseHelpers;

    // Initialize helpers (available immediately for handler registration)
    this.pageDataHandlers = new DataLoaderServerHandlerHelpers();
    this.apiRoutes = new APIRoutesServerHelpers();

    // Initialize WebSocket helpers if enabled
    if (config.options.enableWebSockets) {
      this.webSocketHelpers = new WebSocketServerHelpers(
        this.APIResponseHelpersClass,
        config.options.webSocketOptions,
      );
    }

    // Initialize cookie forwarding policy
    const allow = config.options.cookieForwarding?.allowCookieNames;
    const block = config.options.cookieForwarding?.blockCookieNames;

    this.cookieAllowList =
      Array.isArray(allow) && allow.length > 0 ? new Set(allow) : undefined;
    // Support block = true (block all)
    this.cookieBlockList =
      block === true
        ? true
        : Array.isArray(block) && block.length > 0
          ? new Set(block)
          : undefined;
  }

  /**
   * Start the SSR server listening on the specified port and host
   *
   * @param port Port number to listen on (defaults to 3000)
   * @param host Host to bind to (defaults to localhost)
   * @returns Promise that resolves when server is listening
   */
  async listen(port: number = 3000, host: string = "localhost"): Promise<void> {
    if (this._isListening) {
      throw new Error(
        "SSRServer is already listening. Call stop() first before listening again.",
      );
    }

    if (this._isStarting) {
      throw new Error(
        "SSRServer is already starting. Please wait for the current startup to complete.",
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

    if (this.viteDevServer) {
      try {
        await this.viteDevServer.close();
      } catch {
        // Ignore cleanup errors for stale instances
      }

      this.viteDevServer = null;
    }

    try {
      // Validate development paths exist before proceeding
      if (this.config.mode === "development") {
        const pathValidation = await validateDevPaths(this.config.paths);
        if (!pathValidation.success) {
          throw new Error(
            `Development paths validation failed:\n${pathValidation.errors.join("\n")}`,
          );
        }
      }

      // Load HTML template (in production only - dev will read fresh per request)
      let htmlTemplate: string | undefined;

      if (this.config.mode === "production") {
        const templateResult = await this.loadHTMLTemplate();
        htmlTemplate = templateResult.content;
      }

      // Dynamic import to prevent bundling in client builds
      const { default: fastify } = await import("fastify");

      // Build Fastify options from curated subset
      const fastifyOptions: FastifyServerOptions = {};

      if (this.config.options.fastifyOptions) {
        const { logger, trustProxy, bodyLimit, keepAliveTimeout } =
          this.config.options.fastifyOptions;

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

      // Register WebSocket plugin if enabled
      if (this.webSocketHelpers) {
        await this.webSocketHelpers.registerWebSocketPlugin(
          this.fastifyInstance,
        );
      }

      // Decorate requests with environment info (per-request)
      const mode: "development" | "production" = this.config.mode;
      const isDevelopment = mode === "development";
      this.fastifyInstance.decorateRequest("isDevelopment", isDevelopment);

      // --- Setup Global Error Handling ---
      // IMPORTANT: The global error handler must be registered *before* any plugins
      // or routes. This ensures it can catch errors that occur during plugin
      // loading or from any registered route.
      this.fastifyInstance.setErrorHandler(
        async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
          // Avoid double-send if a previous step already wrote the response
          if (reply.sent) {
            return;
          }

          const isDevelopment = this.config.mode === "development";

          // Log the error using Fastify's logger
          if (this.fastifyInstance) {
            this.fastifyInstance.log.error(
              "Global Error Handler Caught:",
              error,
            );
          }

          // In development, let Vite fix the stack trace for better debugging.
          if (this.viteDevServer && isDevelopment && error instanceof Error) {
            this.viteDevServer.ssrFixStacktrace(error);
          }

          // If the response hasn't been sent, determine response type
          if (!reply.sent) {
            // Check if this is an API request (if APIHandling is enabled)
            const rawPath = request.url.split("?")[0];
            const apiPrefix = this.config.options.APIHandling?.prefix ?? "/api";
            const isAPI =
              apiPrefix !== false && isAPIRequest(rawPath, apiPrefix);

            if (isAPI) {
              // Handle API error with JSON response
              await this.handleAPIError(request, reply, error, apiPrefix);
            } else {
              // Handle SSR error with HTML response
              const errorPage = await this.generate500ErrorPage(request, error);

              reply
                .code(500)
                .header("Content-Type", "text/html")
                .send(errorPage);
            }
          }
        },
      );

      // Register plugins if provided
      if (
        this.config.options.plugins &&
        this.config.options.plugins.length > 0
      ) {
        await this.registerPlugins();
      }

      // Register WebSocket preValidation hook if enabled (before routes but after plugins)
      if (this.webSocketHelpers) {
        this.webSocketHelpers.registerPreValidationHook(this.fastifyInstance);
      }

      // Register page data handler routes with Fastify
      this.pageDataHandlers.registerRoutes(this.fastifyInstance, {
        apiEndpointPrefix: this.config.options.apiEndpoints?.apiEndpointPrefix,
        versioned: this.config.options.apiEndpoints?.versioned,
        defaultVersion: this.config.options.apiEndpoints?.defaultVersion,
        pageDataEndpoint: this.config.options.apiEndpoints?.pageDataEndpoint,
      });

      // Register generic API routes (if any were added programmatically)
      this.apiRoutes.registerRoutes(
        this.fastifyInstance,
        {
          apiEndpointPrefix:
            this.config.options.apiEndpoints?.apiEndpointPrefix,
          versioned: this.config.options.apiEndpoints?.versioned,
          defaultVersion: this.config.options.apiEndpoints?.defaultVersion,
        },
        { allowWildcardAtRoot: false },
      );

      // Register WebSocket routes if enabled
      if (this.webSocketHelpers) {
        this.webSocketHelpers.registerRoutes(this.fastifyInstance);
      }

      // Create Vite Dev Server Middleware (Development Only)
      if (this.config.mode === "development") {
        this.viteDevServer = await (
          await import("vite")
        ).createServer({
          configFile: this.config.paths.viteConfig,
          server: { middlewareMode: true },
          appType: "custom",
        });

        // Mount Vite's dev server middleware after Fastify's error handling and logging
        await this.fastifyInstance.register(import("@fastify/middie"));

        // Now we can use middleware
        this.fastifyInstance.use(this.viteDevServer.middlewares);
      }
      // Production Server Middleware (Production Only)
      else {
        // Check if static router is disabled (useful for CDN setups)
        // If staticContentRouter config is false, skip static file serving (CDN setup)
        if (this.config.options.staticContentRouter !== false) {
          // Configure and register the static router plugin for serving assets
          const clientBuildAssetDir = path.join(
            this.config.buildDir,
            this.clientFolderName,
            "assets",
          );

          // Use the static router configuration provided by the user, or use the default
          const staticContentRouterConfig: StaticContentRouterOptions = this
            .config.options.staticContentRouter || {
            // Default: just serve the assets folder with immutable caching
            folderMap: {
              "/assets": {
                path: clientBuildAssetDir,
                detectImmutableAssets: true, // Enable immutable caching for hashed assets
              },
            },
          };

          // Register the static router plugin
          await this.fastifyInstance.register(
            StaticContentRouterPlugin,
            staticContentRouterConfig,
          );
        }
      }

      // This handler will catch all requests
      this.fastifyInstance.get(
        "*",
        async (request: FastifyRequest, reply: FastifyReply) => {
          // (if APIHandling is enabled), Check if this is an API request that should return 404 JSON instead of SSR
          const rawPath = request.url.split("?")[0];
          const apiPrefix = this.config.options.APIHandling?.prefix ?? "/api";
          const isAPI = apiPrefix !== false && isAPIRequest(rawPath, apiPrefix);

          if (isAPI) {
            // This is an API request that didn't match any route - return 404 JSON
            return this.handleAPINotFound(request, reply, apiPrefix);
          }

          // Continue with SSR handling for non-API requests
          // Load and call the actual render function from the server entry
          // Signature should be: (renderRequest: IRenderRequest) => Promise<IRenderResult>
          let render: (renderRequest: IRenderRequest) => Promise<IRenderResult>;

          let template: string;

          if (this.config.mode === "development" && this.viteDevServer) {
            // --- Development SSR ---
            // Read template fresh per request in dev mode
            const templateResult = await this.loadHTMLTemplate();
            template = templateResult.content;

            // Apply Vite HTML transforms (injects HMR client, plugins)
            template = await this.viteDevServer.transformIndexHtml(
              request.url,
              template,
            );

            // Load server entry using Vite's SSR loader (from src)
            const entryServer = await this.viteDevServer.ssrLoadModule(
              this.config.paths.serverEntry,
            );

            if (
              !entryServer.render ||
              typeof entryServer.render !== "function"
            ) {
              throw new Error(
                "Server entry module must export a 'render' function",
              );
            }

            render = entryServer.render;
          } else {
            // --- Production SSR ---
            // Use the template loaded at startup and cached render function
            // Loaded once for performance in production mode
            if (!htmlTemplate) {
              throw new Error("HTML template not loaded in production mode");
            }

            template = htmlTemplate;
            render = await this.loadProductionRenderFunction();
          }

          // Create Fetch API Request object for React Router
          // Create Request object with appropriate data
          const fetchRequest = new Request(
            `${request.protocol}://${request.hostname}${request.url}`,
            {
              method: request.method,
              headers: (() => {
                // Create a new Headers object from the request headers
                const headers = new Headers(request.headers as HeadersInit);

                // First, delete any sensitive SSR headers that might be present in the client request
                // This prevents clients from spoofing these secure headers
                headers.delete("X-SSR-Request");
                headers.delete("X-SSR-Original-IP");
                headers.delete("X-SSR-Forwarded-User-Agent");
                headers.delete("X-Correlation-ID");

                // Now set these headers with our trusted server-side values
                headers.set("X-SSR-Request", "true");
                headers.set("X-SSR-Original-IP", request.ip);

                // Forward the user agent if needed
                const userAgent = request.headers["user-agent"];

                if (typeof userAgent === "string") {
                  headers.set("X-SSR-Forwarded-User-Agent", userAgent);
                }

                // Forward the correlation ID (which is the same as request ID at this point)
                if ((request as unknown as { requestID: string }).requestID) {
                  headers.set(
                    "X-Correlation-ID",
                    (request as unknown as { requestID: string }).requestID,
                  );
                }

                // Apply cookie forwarding policy to inbound Cookie header
                const originalCookieHeader = headers.get("cookie");
                const filteredCookieHeader = applyCookiePolicyToCookieHeader(
                  originalCookieHeader || undefined,
                  this.cookieAllowList,
                  this.cookieBlockList,
                );

                if (filteredCookieHeader && filteredCookieHeader.length > 0) {
                  headers.set("cookie", filteredCookieHeader);
                } else {
                  headers.delete("cookie");
                }

                return headers;
              })(),
              signal: AbortSignal.timeout(5000),
            },
          );

          // Attach SSRHelper for server-only access in loaders
          const ssrHelper: SSRHelper = {
            fastifyRequest: request,
            controlledReply: createControlledReply(reply),
            handlers: this.pageDataHandlers,
            isDevelopment: this.config.mode === "development",
          } as const;

          try {
            Object.defineProperty(fetchRequest, "SSRHelper", {
              value: ssrHelper,
              enumerable: false,
              configurable: false,
              writable: false,
            });
          } catch {
            // If defineProperty fails for any reason, fallback to direct assignment
            (fetchRequest as unknown as { SSRHelper?: SSRHelper }).SSRHelper =
              ssrHelper;
          }

          // --- Render the App ---
          try {
            const renderResult = await render({
              type: "ssr",
              fetchRequest,
            });

            if (renderResult.resultType === "page") {
              // ---> Extract status code from render result
              const statusCode = renderResult.statusCode || 200;

              // ---> Extract cookies from ssOnlyData set by data loader
              // cookies are returned as an array of strings, each string is a cookie header value already formatted
              const cookies = renderResult.ssOnlyData?.cookies;

              // set cookies on reply
              if (Array.isArray(cookies)) {
                const filteredCookies = applyCookiePolicyToSetCookie(
                  cookies as string[],
                  this.cookieAllowList,
                  this.cookieBlockList,
                );

                for (const cookie of filteredCookies) {
                  reply.header("Set-Cookie", cookie);
                }
              }

              // if a 500 error is returned, send the server 500 error page version instead
              /// This is used when there is a error boundary that sets the custom 500 error page
              // To simplify return a server generated 500 error page instead of trying to hydrate the custom 500 error page error boundary
              if (statusCode === 500) {
                const error =
                  renderResult.errorDetails ||
                  new Error("Internal Server Error");

                await this.handleSSRError(
                  request,
                  reply,
                  error,
                  this.viteDevServer,
                );

                return;
              }

              // --- Prepare Helmet data for injection ---
              const headParts = [
                renderResult.helmet?.title.toString() || "",
                renderResult.helmet?.meta.toString() || "",
                renderResult.helmet?.link.toString() || "",
                renderResult.preloadLinks || "",
              ].filter(Boolean);

              const headInject = headParts.join("\n");

              // Use our utility to inject content with proper formatting
              const finalHtml = injectContent(
                template,
                headInject,
                renderResult.html,
              );

              // ---> Send response with the extracted status code
              reply
                .code(statusCode)
                .header("Content-Type", "text/html")
                .send(finalHtml);

              return; // Stop further processing
            } else if (renderResult.resultType === "response") {
              // If React Router returned a Response (redirect/error as a response), handle it
              // Forward status and headers
              reply.code(renderResult.response.status);

              // Forward headers safe for redirects/responses
              for (const [key, value] of renderResult.response
                .headers as unknown as Iterable<[string, string]>) {
                if (
                  key.toLowerCase().startsWith("location") ||
                  key.toLowerCase().startsWith("set-cookie")
                ) {
                  if (key.toLowerCase().startsWith("set-cookie")) {
                    const filtered = applyCookiePolicyToSetCookie(
                      value,
                      this.cookieAllowList,
                      this.cookieBlockList,
                    );

                    for (const v of filtered) {
                      reply.header("Set-Cookie", v);
                    }
                  } else {
                    reply.header(key, value);
                  }
                }
              }

              // Check if body exists before sending
              try {
                const body = await renderResult.response.text();

                if (body) {
                  reply.send(body);
                } else {
                  reply.send();
                }
              } catch (bodyError) {
                this.fastifyInstance?.log.error(
                  "Error reading response body:",
                  bodyError,
                );
                reply.send(); // End response even if body reading fails
              }

              return; // Stop further processing
            } else if (renderResult.resultType === "render-error") {
              // Handle render errors
              await this.handleSSRError(
                request,
                reply,
                renderResult.error,
                this.viteDevServer,
              );

              return; // Stop further processing
            } else {
              // Handle unexpected result types (this should never happen with proper typing)
              // TypeScript knows this is never, but we handle it for runtime safety
              const resultType =
                (renderResult as { resultType?: string }).resultType ||
                "unknown";
              const unexpectedError = new Error(
                `Unexpected render result type: ${resultType}`,
              );

              await this.handleSSRError(
                request,
                reply,
                unexpectedError,
                this.viteDevServer,
              );

              return;
            }
          } catch (error) {
            await this.handleSSRError(
              request,
              reply,
              error as Error,
              this.viteDevServer,
            );

            return;
          }

          // Safety check - if we somehow reach here without sending a response
          if (!reply.sent) {
            this.fastifyInstance?.log.warn(
              "No response was sent, sending 500 error",
            );
            await this.handleSSRError(
              request,
              reply,
              new Error("No response was generated"),
              this.viteDevServer,
            );
          }
        },
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

      // Close Vite dev server if it was created but startup failed
      if (this.viteDevServer) {
        try {
          await this.viteDevServer.close();
        } catch (closeError) {
          cleanupErrors.push(
            `Vite dev server cleanup failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
          );
        }

        this.viteDevServer = null;
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
   * Stop the server if it's currently listening
   */
  async stop(): Promise<void> {
    if (!this._isListening) {
      return;
    }

    // Close Fastify server if it exists
    if (this.fastifyInstance) {
      await this.fastifyInstance.close();
      this.fastifyInstance = null;
    }

    // Close Vite dev server if it exists
    if (this.viteDevServer) {
      await this.viteDevServer.close();
      this.viteDevServer = null;
    }

    // Only mark as stopped after both are successfully closed
    this._isListening = false;

    // Clear plugin tracking state
    this.registeredPlugins = [];
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
   * Register a WebSocket handler for the specified path
   *
   * @param config WebSocket handler configuration
   * @throws Error if WebSocket support is not enabled
   */
  registerWebSocketHandler(config: WebSocketHandlerConfig): void {
    if (!this.webSocketHelpers) {
      throw new Error(
        "WebSocket support is not enabled. Set 'enableWebSockets: true' in ServeSSROptions to use WebSocket handlers.",
      );
    }

    this.webSocketHelpers.registerWebSocketHandler(config);
  }

  /**
   * Get the list of active WebSocket clients
   *
   * @returns Set of WebSocket clients, or empty Set if WebSocket support is disabled or server not started
   */
  getWebSocketClients(): Set<WebSocket> {
    if (!this.fastifyInstance || !this._isListening) {
      // Server not started or Fastify instance missing — return empty set as a safe fallback
      return new Set<WebSocket>();
    }

    // Access the websocketServer decorated by @fastify/websocket plugin
    const websocketServer = (
      this.fastifyInstance as unknown as { websocketServer?: WebSocketServer }
    ).websocketServer;

    if (!websocketServer || !websocketServer.clients) {
      // WebSocket server not available (plugin not enabled/initialized) — return empty set fallback
      return new Set<WebSocket>();
    }

    // Return the underlying ws client set (Set<WebSocket>)
    return websocketServer.clients;
  }

  /**
   * Register plugins with controlled access to Fastify instance
   * @private
   */
  private async registerPlugins(): Promise<void> {
    // If no fastify instance or plugins are provided, return early
    if (!this.fastifyInstance || !this.config.options.plugins) {
      return;
    }

    // Create controlled instance wrapper
    const controlledInstance = createControlledInstance(
      this.fastifyInstance,
      true,
      this.apiRoutes.apiShortcuts,
      this.pageDataHandlers.pageLoaderShortcuts,
    );

    // Plugin options to pass to each plugin
    const pluginOptions = {
      serverType: "ssr" as const,
      mode: this.config.mode,
      isDevelopment: this.config.mode === "development",
      buildDir:
        this.config.mode === "production" ? this.config.buildDir : undefined,
      apiEndpoints: this.config.options.apiEndpoints,
    };

    // Register each plugin with dependency validation
    for (const plugin of this.config.options.plugins) {
      try {
        // Call plugin and get potential metadata
        const pluginResult = await plugin(controlledInstance, pluginOptions);

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

  /**
   * Loads and caches the production render function from the server entry
   * This is called once and cached for performance in production mode
   * @returns Promise that resolves to the render function
   * @private
   */
  private async loadProductionRenderFunction(): Promise<
    (renderRequest: IRenderRequest) => Promise<IRenderResult>
  > {
    if (this.cachedRenderFunction) {
      return this.cachedRenderFunction;
    }

    if (this.config.mode !== "production") {
      throw new Error(
        "loadProductionRenderFunction should only be called in production mode",
      );
    }

    const prodConfig = this.config as SSRServerConfigProd;
    const serverEntry = prodConfig.options.serverEntry || "entry-server";
    const serverBuildDir = path.join(
      prodConfig.buildDir,
      this.serverFolderName,
    );

    // Load the server's regular manifest
    const serverManifestResult = await checkAndLoadManifest(
      serverBuildDir,
      false,
    );

    if (!serverManifestResult.success || !serverManifestResult.manifest) {
      throw new Error(
        `Failed to load server manifest: ${serverManifestResult.error}`,
      );
    }

    const entryResult = getServerEntryFromManifest(
      serverManifestResult.manifest,
      serverBuildDir,
      serverEntry,
    );

    if (!entryResult.success || !entryResult.entryPath) {
      throw new Error(`Failed to find server entry: ${entryResult.error}`);
    }

    // Import the server entry module
    let entryServer;

    try {
      entryServer = await import(entryResult.entryPath);
    } catch (error) {
      throw new Error(
        `Failed to import server entry from ${entryResult.entryPath}: ${error}`,
      );
    }

    if (!entryServer.render || typeof entryServer.render !== "function") {
      throw new Error("Server entry module must export a 'render' function");
    }

    // Cache the render function for subsequent requests
    this.cachedRenderFunction = entryServer.render;
    return entryServer.render;
  }

  /**
   * Loads and processes the HTML template based on the server mode
   * @returns Promise that resolves to the processed template content and path
   * @private
   */
  private async loadHTMLTemplate(): Promise<{ content: string; path: string }> {
    // Determine template path based on mode
    let htmlTemplatePath: string;

    if (this.config.mode === "development") {
      // Development mode: use provided template path
      htmlTemplatePath = this.config.paths.template;
    } else {
      // Production mode: use client folder from build directory
      htmlTemplatePath = path.join(
        this.config.buildDir,
        this.clientFolderName,
        "index.html",
      );
    }

    // Read the HTML template file
    const templateResult = await readHTMLFile(htmlTemplatePath);

    if (!templateResult.exists) {
      throw new Error(
        `HTML template not found at ${htmlTemplatePath}. ` +
          (this.config.mode === "development"
            ? "Please check the templatePath parameter."
            : "Make sure to run the client build first."),
      );
    }

    if (templateResult.error) {
      throw new Error(
        `Failed to read HTML template from ${htmlTemplatePath}: ${templateResult.error}`,
      );
    }

    // At this point, templateResult.content should exist
    const rawHtmlTemplate = templateResult.content as string;

    if (!rawHtmlTemplate || rawHtmlTemplate.length === 0) {
      throw new Error(`HTML template at ${htmlTemplatePath} is empty`);
    }

    // Process the template based on mode and options
    const isDevelopment = this.config.mode === "development";
    const frontendAppConfig =
      this.config.mode === "production"
        ? this.config.options.frontendAppConfig
        : undefined; // Don't inject config in development
    const containerID = this.config.options.containerID || "root";

    const processedTemplate = await processTemplate(
      rawHtmlTemplate,
      isDevelopment,
      frontendAppConfig,
      containerID,
    );

    return {
      content: processedTemplate,
      path: htmlTemplatePath,
    };
  }

  /**
   * Handles SSR errors with Vite stack trace fixing and custom error pages
   * @param request The Fastify request object
   * @param reply The Fastify reply object
   * @param error The error that occurred
   * @param vite The Vite dev server instance (null in production)
   * @private
   */
  private async handleSSRError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: Error,
    vite: ViteDevServer | null,
  ): Promise<void> {
    // This method is invoked both by the global Fastify error handler and
    // by our route-level try/catch around the render call. If a response
    // was already sent, bail out to prevent double-sending.
    if (reply.sent) {
      return;
    }

    const isDevelopment = this.config.mode === "development";

    // If an error is caught, let Vite fix the stack trace so it maps back
    // to your actual source code.
    if (vite && error instanceof Error && isDevelopment) {
      vite.ssrFixStacktrace(error);
    }

    // Generate and send error page (handles dev vs prod internally)
    const errorPage = await this.generate500ErrorPage(request, error);
    reply.code(500).header("Content-Type", "text/html").send(errorPage);
  }

  /**
   * Generates a 500 error page using custom handler or default
   * @param request The Fastify request object
   * @param error The error that occurred
   * @returns Promise that resolves to HTML string
   * @private
   */
  private async generate500ErrorPage(
    request: FastifyRequest,
    error: Error,
  ): Promise<string> {
    const isDevelopment = this.config.mode === "development";

    // Log error details for server logs (always log, regardless of mode)
    this.fastifyInstance?.log.error(
      `[SSR Error] ${request.method} ${request.url}:`,
      error,
    );

    try {
      if (this.config.options.get500ErrorPage) {
        // Use custom error handler if provided
        return await this.config.options.get500ErrorPage(
          request,
          error,
          isDevelopment,
        );
      } else {
        // Use default error page if no custom handler provided
        return generateDefault500ErrorPage(request, error, isDevelopment);
      }
    } catch (errorHandlerError) {
      // If custom error handler itself throws, fall back to the default error page
      this.fastifyInstance?.log.error(
        "[SSR Error Handler Error]:",
        errorHandlerError,
      );
      return generateDefault500ErrorPage(request, error, isDevelopment);
    }
  }

  /**
   * Handles API errors with JSON responses using envelope pattern
   * @param request The Fastify request object
   * @param reply The Fastify reply object
   * @param error The error that occurred
   * @param apiPrefix The API prefix to remove from path
   * @private
   */
  private async handleAPIError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: Error,
    apiPrefix: string,
  ): Promise<void> {
    const isDevelopment = this.config.mode === "development";

    // Remove API prefix to check for page-data pattern
    const rawPath = request.url.split("?")[0];
    const pathWithoutAPI = rawPath.startsWith(apiPrefix)
      ? rawPath.slice(apiPrefix.length)
      : rawPath;
    const isPage = isPageDataRequest(pathWithoutAPI);

    // Check for custom API error handler if provided
    if (this.config.options.APIHandling?.errorHandler) {
      try {
        const customResponse = await Promise.resolve(
          this.config.options.APIHandling.errorHandler(
            request,
            error,
            isDevelopment,
            isPage,
          ),
        );

        // Extract status code from envelope response
        const statusCode = customResponse.status_code || 500;
        reply.status(statusCode);

        return reply.send(customResponse);
      } catch (handlerError) {
        // If custom handler fails, fall back to default
        this.fastifyInstance?.log.error(
          "[API Error Handler Error]:",
          handlerError,
        );
      }
    }

    // Default case
    const statusCode = (error as FastifyError).statusCode || 500;
    reply.status(statusCode);

    // Default API error response using shared utility
    const response = createDefaultAPIErrorResponse(
      this.APIResponseHelpersClass,
      request,
      error,
      isDevelopment,
      apiPrefix,
    );

    return reply.send(response);
  }

  /**
   * Handles API 404 not found responses with JSON envelopes
   * @param request The Fastify request object
   * @param reply The Fastify reply object
   * @param apiPrefix The API prefix to remove from path
   * @private
   */
  private async handleAPINotFound(
    request: FastifyRequest,
    reply: FastifyReply,
    apiPrefix: string,
  ): Promise<void> {
    // Remove API prefix to check for page-data pattern
    const rawPath = request.url.split("?")[0];
    const pathWithoutAPI = rawPath.startsWith(apiPrefix)
      ? rawPath.slice(apiPrefix.length)
      : rawPath;
    const isPage = isPageDataRequest(pathWithoutAPI);

    // Check for custom API not-found handler
    if (this.config.options.APIHandling?.notFoundHandler) {
      try {
        const customResponse = await Promise.resolve(
          this.config.options.APIHandling.notFoundHandler(request, isPage),
        );

        // Extract status code from envelope response
        const statusCode = customResponse.status_code || 404;
        reply.status(statusCode);

        return reply.send(customResponse);
      } catch (handlerError) {
        // If custom handler fails, fall back to default
        this.fastifyInstance?.log.error(
          "[API Not Found Handler Error]:",
          handlerError,
        );
      }
    }

    // Default case
    const statusCode = 404;
    reply.status(statusCode);

    // Default API not-found response using shared utility
    const response = createDefaultAPINotFoundResponse(
      this.APIResponseHelpersClass,
      request,
      apiPrefix,
    );

    return reply.send(response);
  }
}

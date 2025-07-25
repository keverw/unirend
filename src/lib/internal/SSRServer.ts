import {
  IRenderRequest,
  IRenderResult,
  ServeSSRDevOptions,
  ServeSSRProdOptions,
  SSRDevPaths,
  StaticRouterOptions,
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
  FastifyInstance,
  FastifyRequest,
  FastifyReply,
  FastifyServerOptions,
} from "fastify";
import type { ViteDevServer } from "vite";
import { createControlledInstance } from "./server-utils";
import { generateDefault500ErrorPage } from "./errorPageUtils";
import StaticRouterPlugin from "./middleware/static-router";

type SSRServerConfigDev = {
  mode: "development";
  paths: SSRDevPaths; // Contains serverEntry, template, and viteConfig paths
  options: ServeSSRDevOptions;
};

type SSRServerConfigProd = {
  mode: "production";
  buildDir: string; // Directory containing built assets (HTML template, static files, manifest, etc.)
  importFn: () => Promise<{ render: (req: Request) => Promise<Response> }>;
  options: ServeSSRProdOptions;
};

type SSRServerConfig = SSRServerConfigDev | SSRServerConfigProd;

/**
 * Internal server class for handling SSR rendering
 * Not intended to be used directly by library consumers
 */

export class SSRServer {
  private config: SSRServerConfig;
  private isListening: boolean = false;
  private fastifyInstance: FastifyInstance | null = null;
  private clientFolderName: string;
  private serverFolderName: string;
  private cachedRenderFunction:
    | ((renderRequest: IRenderRequest) => Promise<IRenderResult>)
    | null = null;

  /**
   * Creates a new SSR server instance
   *
   * @param config Server configuration object
   */
  constructor(config: SSRServerConfig) {
    this.config = config;

    // Set folder names with defaults
    this.clientFolderName = config.options.clientFolderName || "client";
    this.serverFolderName = config.options.serverFolderName || "server";
  }

  /**
   * Start the SSR server listening on the specified port and host
   *
   * @param port Port number to listen on
   * @param host Optional host to bind to (defaults to localhost)
   * @returns Promise that resolves when server is listening
   */
  async listen(port: number, host?: string): Promise<void> {
    if (this.isListening) {
      throw new Error(
        "Server is already listening. Call close() first before listening again.",
      );
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

      // Load HTML template
      const { content: htmlTemplate } = await this.loadHTMLTemplate();

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

      // --- Setup Global Error Handling ---
      // IMPORTANT: The global error handler must be registered *before* any plugins
      // or routes. This ensures it can catch errors that occur during plugin
      // loading or from any registered route.
      this.fastifyInstance.setErrorHandler(
        async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
          const isDevelopment = this.config.mode === "development";

          // Log the error using Fastify's logger
          if (this.fastifyInstance) {
            this.fastifyInstance.log.error(
              "Global Error Handler Caught:",
              error,
            );
          }

          // In development, let Vite fix the stack trace for better debugging.
          if (vite && isDevelopment && error instanceof Error) {
            vite.ssrFixStacktrace(error);
          }

          // If the response hasn't been sent, send a custom 500 error page.
          if (!reply.sent) {
            const errorPage = await this.generate500ErrorPage(request, error);
            reply.code(500).header("Content-Type", "text/html").send(errorPage);
          }
        },
      );

      // Register plugins if provided
      if (
        this.config.options.plugins &&
        this.config.options.plugins.length > 0
      ) {
        await this.registerPlugins(this.fastifyInstance);
      }

      // --- Vite Dev Server Middleware (Development Only) ---
      let vite: ViteDevServer | null = null;

      // Vite Dev Server Middleware (Development Only)
      if (this.config.mode === "development") {
        vite = await (
          await import("vite")
        ).createServer({
          configFile: this.config.paths.viteConfig,
          server: { middlewareMode: true },
          appType: "custom",
        });

        // Mount Vite's dev server middleware after Fastify's error handling and logging
        await this.fastifyInstance.register(import("@fastify/middie"));

        // Now we can use middleware
        this.fastifyInstance.use(vite.middlewares);
      }
      // Production Server Middleware (Production Only)
      else {
        // Check if static router is disabled (useful for CDN setups)
        // If staticRouter is false, skip static file serving (CDN setup)
        if (this.config.options.staticRouter !== false) {
          // Configure and register the static router plugin for serving assets
          const clientBuildAssetDir = path.join(
            this.config.buildDir,
            this.clientFolderName,
            "assets",
          );

          // Use the static router configuration provided by the user, or use the default
          const staticRouterConfig: StaticRouterOptions = this.config.options
            .staticRouter || {
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
            StaticRouterPlugin,
            staticRouterConfig,
          );
        }
      }

      // This handler will catch all requests
      this.fastifyInstance.get(
        "*",
        async (request: FastifyRequest, reply: FastifyReply) => {
          // Load and call the actual render function from the server entry
          // Signature should be: (renderRequest: IRenderRequest) => Promise<IRenderResult>
          let render: (renderRequest: IRenderRequest) => Promise<IRenderResult>;

          let template = htmlTemplate; // Start with the loaded template

          if (this.config.mode === "development" && vite) {
            // --- Development SSR ---
            // Apply Vite HTML transforms (injects HMR client, plugins)
            template = await vite.transformIndexHtml(request.url, template);
            // Load server entry using Vite's SSR loader (from src)
            const entryServer = await vite.ssrLoadModule(
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
            // Use cached render function (loaded once for performance)
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
                headers.delete("X-Original-IP");
                headers.delete("X-Forwarded-User-Agent");
                headers.delete("X-Correlation-ID");

                // Now set these headers with our trusted server-side values
                headers.set("X-SSR-Request", "true");
                headers.set("X-Original-IP", request.ip);

                // Forward the user agent if needed
                const userAgent = request.headers["user-agent"];

                if (typeof userAgent === "string") {
                  headers.set("X-Forwarded-User-Agent", userAgent);
                }

                // Forward the correlation ID (which is the same as request ID at this point)
                if ((request as unknown as { requestID: string }).requestID) {
                  headers.set(
                    "X-Correlation-ID",
                    (request as unknown as { requestID: string }).requestID,
                  );
                }

                return headers;
              })(),
              signal: AbortSignal.timeout(5000),
            },
          );

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
                for (const cookie of cookies) {
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

                await this.handleSSRError(request, reply, error, vite);
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
                this.config.mode === "development", // Pass development mode flag
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
                  reply.header(key, value);
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
                vite,
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

              await this.handleSSRError(request, reply, unexpectedError, vite);
              return;
            }
          } catch (error) {
            await this.handleSSRError(request, reply, error as Error, vite);
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
              vite,
            );
          }
        },
      );

      await this.fastifyInstance.listen({
        port,
        host: host || "localhost",
      });

      this.isListening = true;
    } catch (error) {
      this.isListening = false;
      this.fastifyInstance = null;
      throw error;
    }
  }

  /**
   * Close the server if it's currently listening
   */
  async close(): Promise<void> {
    if (this.fastifyInstance && this.isListening) {
      await this.fastifyInstance.close();
      this.isListening = false;
      this.fastifyInstance = null;
    }
  }

  /**
   * Check if the server is currently listening
   */
  get listening(): boolean {
    return this.isListening;
  }

  /**
   * Register plugins with controlled access to Fastify instance
   * @param fastifyInstance The Fastify instance to register plugins with
   * @private
   */
  private async registerPlugins(
    fastifyInstance: FastifyInstance,
  ): Promise<void> {
    // If no plugins are provided, return early
    if (!this.config.options.plugins) {
      return;
    }

    // Create controlled instance wrapper
    const controlledInstance = createControlledInstance(fastifyInstance);

    // Plugin options to pass to each plugin
    const pluginOptions = {
      mode: this.config.mode,
      isDevelopment: this.config.mode === "development",
      buildDir:
        this.config.mode === "production" ? this.config.buildDir : undefined,
    };

    // Register each plugin
    for (const plugin of this.config.options.plugins) {
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
    const entryServer = await import(entryResult.entryPath);

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
}

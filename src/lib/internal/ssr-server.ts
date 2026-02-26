import type {
  RenderRequest,
  RenderResult,
  ServeSSRDevOptions,
  ServeSSRProdOptions,
  RegisterDevAppOptions,
  RegisterProdAppOptions,
  SSRDevPaths,
  StaticContentRouterOptions,
  SSRHelpers,
  PluginMetadata,
  APIResponseHelpersClass,
  SSRInternalAppConfig,
  SSRInternalAppConfigDev,
  SSRInternalAppConfigProd,
} from '../types';
import {
  readHTMLFile,
  checkAndLoadManifest,
  getServerEntryFromManifest,
  validateDevPaths,
} from './fs-utils';
import { processTemplate } from './html-utils/format';
import { injectContent } from './html-utils/inject';
import path from 'path';
import type {
  FastifyRequest,
  FastifyReply,
  FastifyServerOptions,
} from 'fastify';
import {
  createControlledInstance,
  classifyRequest,
  normalizeAPIPrefix,
  normalizePageDataEndpoint,
  createDefaultAPIErrorResponse,
  createDefaultAPINotFoundResponse,
  createControlledReply,
  validateAndRegisterPlugin,
  validateNoHandlersWhenAPIDisabled,
  buildFastifyHTTPSOptions,
} from './server-utils';
import { generateDefault500ErrorPage } from './error-page-utils';
import { StaticContentCache } from './static-content-cache';
import { staticContentHookHandler } from './static-content-hook';
import { BaseServer } from './base-server';
import { DataLoaderServerHandlerHelpers } from './data-loader-server-handler-helpers';
import { APIRoutesServerHelpers } from './api-routes-server-helpers';
import { WebSocketServerHelpers } from './web-socket-server-helpers';
import type { WebSocketHandlerConfig } from './web-socket-server-helpers';
import {
  filterIncomingCookieHeader as applyCookiePolicyToCookieHeader,
  filterSetCookieHeaderValues as applyCookiePolicyToSetCookie,
} from './cookie-utils';
import { APIResponseHelpers } from '../../api-envelope';
import type { WebSocket, WebSocketServer } from 'ws';
import {
  registerFileUploadValidationHooks,
  registerMultipartPlugin,
} from './file-upload-validation-helpers';
import { resolveFastifyLoggerConfig } from './logger-config-utils';

type SSRServerConfigDev = {
  mode: 'development';
  paths: SSRDevPaths; // Contains serverEntry, template, and viteConfig paths
  options: ServeSSRDevOptions;
};

type SSRServerConfigProd = {
  mode: 'production';
  buildDir: string; // Directory containing built assets (HTML template, static files, manifest, etc.)
  options: ServeSSRProdOptions;
};

type SSRServerConfig = SSRServerConfigDev | SSRServerConfigProd;

/**
 * Internal server class for handling SSR rendering
 * Not intended to be used directly by library consumers
 */

export class SSRServer extends BaseServer {
  /** Pluggable helpers class reference for constructing API/Page envelopes */
  public readonly APIResponseHelpersClass: APIResponseHelpersClass;

  // config state
  private serverMode: 'development' | 'production';

  // Multi-app storage
  private apps: Map<string, SSRInternalAppConfig> = new Map();

  // Shared server configuration (used across all apps)
  private sharedOptions: ServeSSRDevOptions | ServeSSRProdOptions;

  // Shared server resources (used across all apps)
  private pageDataHandlers!: DataLoaderServerHandlerHelpers;
  private apiRoutes!: APIRoutesServerHelpers;
  private webSocketHelpers: WebSocketServerHelpers | null = null;
  private registeredPlugins: PluginMetadata[] = [];

  // Cookie forwarding policy (computed from options for quick checks)
  private cookieAllowList?: Set<string>;
  private cookieBlockList?: Set<string> | true;

  // Normalized endpoint config (computed once at construction)
  // false means API handling is disabled (matches config type)
  private readonly normalizedAPIPrefix: string | false;
  private readonly normalizedPageDataEndpoint: string;

  /**
   * Creates a new SSR server instance
   *
   * @param config Server configuration object
   */
  constructor(config: SSRServerConfig) {
    super();

    // Store server mode and shared options
    this.serverMode = config.mode;
    this.sharedOptions = config.options;

    // Convert single config to Map with '__default__' key
    const defaultApp: SSRInternalAppConfig =
      config.mode === 'development'
        ? {
            // Dev mode - has paths
            paths: config.paths,
            frontendAppConfig: config.options.frontendAppConfig,
            clientFolderName: config.options.clientFolderName || 'client',
            serverFolderName: config.options.serverFolderName || 'server',
            containerID: config.options.containerID,
            get500ErrorPage: config.options.get500ErrorPage,
          }
        : {
            // Prod mode - has buildDir
            buildDir: config.buildDir,
            serverEntry: config.options.serverEntry,
            template: config.options.template,
            CDNBaseURL: config.options.CDNBaseURL,
            staticContentRouter: config.options.staticContentRouter,
            frontendAppConfig: config.options.frontendAppConfig,
            clientFolderName: config.options.clientFolderName || 'client',
            serverFolderName: config.options.serverFolderName || 'server',
            containerID: config.options.containerID,
            get500ErrorPage: config.options.get500ErrorPage,
          };

    this.apps.set('__default__', defaultApp);

    // Set helpers class (custom or default)
    this.APIResponseHelpersClass =
      this.sharedOptions.APIResponseHelpersClass || APIResponseHelpers;

    // Normalize API endpoint config once at construction
    this.normalizedAPIPrefix = normalizeAPIPrefix(
      config.options.apiEndpoints?.apiEndpointPrefix,
    );

    // Normalize page data endpoint once at construction
    this.normalizedPageDataEndpoint = normalizePageDataEndpoint(
      config.options.apiEndpoints?.pageDataEndpoint,
    );

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
   * Register an additional dev-mode SSR app
   *
   * Can only be called on dev servers (created via serveSSRDev).
   * Apps must be registered BEFORE calling listen().
   *
   * Uses the same parameters as serveSSRDev for consistency - you can copy/paste
   * configuration between the default app and additional apps.
   *
   * @param appKey - Unique identifier for this app (used in request.activeSSRApp)
   * @param paths - Dev-specific paths (same as serveSSRDev)
   * @param options - Dev options (same as serveSSRDev)
   *
   * @example
   * ```ts
   * const mainPaths = {
   *   serverEntry: './src/entry-server.tsx',
   *   template: './index.html',
   *   viteConfig: './vite.config.ts'
   * };
   * const server = serveSSRDev(mainPaths, { port: 3000 });
   *
   * // Same parameters as above - easy to copy/paste
   * server.registerDevApp('marketing', {
   *   serverEntry: './src/marketing/entry-server.tsx',
   *   template: './src/marketing/index.html',
   *   viteConfig: './vite.marketing.config.ts'
   * }, {
   *   frontendAppConfig: { apiUrl: 'http://localhost:3002' }
   * });
   *
   * await server.listen(3000);
   * ```
   */
  public registerDevApp(
    appKey: string,
    paths: SSRDevPaths,
    options?: RegisterDevAppOptions,
  ): void {
    if (!appKey || typeof appKey !== 'string') {
      throw new Error('App key must be a non-empty string');
    }

    const trimmedAppKey = appKey.trim();

    if (this._isListening) {
      throw new Error(
        'Cannot register apps after server has started listening. Register all apps before calling listen().',
      );
    }

    this.validateAppKey(trimmedAppKey);

    if (this.serverMode !== 'development') {
      throw new Error(
        `Cannot register dev app "${trimmedAppKey}" on prod server. Use registerProdApp() instead.`,
      );
    }

    const opts = options || {};
    const appConfig: SSRInternalAppConfigDev = {
      paths,
      frontendAppConfig: opts.frontendAppConfig,
      clientFolderName: opts.clientFolderName || 'client',
      serverFolderName: opts.serverFolderName || 'server',
      containerID: opts.containerID,
      get500ErrorPage: opts.get500ErrorPage,
    };

    this.apps.set(trimmedAppKey, appConfig);
  }

  /**
   * Register an additional prod-mode SSR app
   *
   * Can only be called on prod servers (created via serveSSRProd).
   * Apps must be registered BEFORE calling listen().
   *
   * Uses the same parameters as serveSSRProd for consistency - you can copy/paste
   * configuration between the default app and additional apps.
   *
   * @param appKey - Unique identifier for this app (used in request.activeSSRApp)
   * @param buildDir - Build directory path (same as serveSSRProd)
   * @param options - Prod options (same as serveSSRProd)
   *
   * @example
   * ```ts
   * const server = serveSSRProd('./build-main', { port: 3000 });
   *
   * // Same parameters as above - easy to copy/paste
   * server.registerProdApp('marketing', './build-marketing', {
   *   frontendAppConfig: { apiUrl: 'https://marketing.example.com' }
   * });
   *
   * await server.listen(3000);
   * ```
   */
  public registerProdApp(
    appKey: string,
    buildDir: string,
    options?: RegisterProdAppOptions,
  ): void {
    if (!appKey || typeof appKey !== 'string') {
      throw new Error('App key must be a non-empty string');
    }

    const trimmedAppKey = appKey.trim();

    if (this._isListening) {
      throw new Error(
        'Cannot register apps after server has started listening. Register all apps before calling listen().',
      );
    }

    this.validateAppKey(trimmedAppKey);

    if (this.serverMode !== 'production') {
      throw new Error(
        `Cannot register prod app "${trimmedAppKey}" on dev server. Use registerDevApp() instead.`,
      );
    }

    const opts = options || {};
    const appConfig: SSRInternalAppConfigProd = {
      buildDir,
      serverEntry: opts.serverEntry,
      template: opts.template,
      CDNBaseURL: opts.CDNBaseURL,
      staticContentRouter: opts.staticContentRouter,
      frontendAppConfig: opts.frontendAppConfig,
      clientFolderName: opts.clientFolderName || 'client',
      serverFolderName: opts.serverFolderName || 'server',
      containerID: opts.containerID,
      get500ErrorPage: opts.get500ErrorPage,
    };

    this.apps.set(trimmedAppKey, appConfig);
  }

  /**
   * Start the SSR server listening on the specified port and host
   *
   * @param port Port number to listen on (defaults to 3000)
   * @param host Host to bind to (defaults to localhost)
   * @returns Promise that resolves when server is listening
   */
  public async listen(
    port: number = 3000,
    host: string = 'localhost',
  ): Promise<void> {
    if (this._isListening) {
      throw new Error(
        'SSRServer is already listening. Call stop() first before listening again.',
      );
    }

    if (this._isStarting) {
      throw new Error(
        'SSRServer is already starting. Please wait for the current startup to complete.',
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

    // Clean up Vite dev servers and clear caches from all apps
    // This ensures clean state even if previous stop() failed partway through
    for (const [_, appConfig] of this.apps) {
      if ('viteDevServer' in appConfig && appConfig.viteDevServer) {
        try {
          await appConfig.viteDevServer.close();
        } catch {
          // Ignore cleanup errors for stale instances
        }

        appConfig.viteDevServer = undefined;
      }

      // Clear cached templates and render functions (defensive programming)
      if ('cachedHTMLTemplate' in appConfig) {
        appConfig.cachedHTMLTemplate = undefined;
      }

      if ('cachedRenderFunction' in appConfig) {
        appConfig.cachedRenderFunction = undefined;
      }
    }

    try {
      // Validate development paths exist before proceeding for ALL dev apps
      if (this.serverMode === 'development') {
        for (const [appKey, appConfig] of this.apps) {
          if ('paths' in appConfig) {
            const pathValidation = await validateDevPaths(appConfig.paths);
            if (!pathValidation.success) {
              throw new Error(
                `Development paths validation failed for app "${appKey}":\n${pathValidation.errors.join('\n')}`,
              );
            }
          }
        }
      }

      // Load HTML templates and render functions for all prod apps
      // (dev will read/load fresh per request for HMR support)
      if (this.serverMode === 'production') {
        for (const [appKey, appConfig] of this.apps) {
          // In production mode, all apps should have buildDir (enforced by TypeScript)
          if (!('buildDir' in appConfig)) {
            throw new Error(
              `Production app "${appKey}" is missing buildDir. This should not happen.`,
            );
          }

          // Load and cache HTML template
          try {
            const templateResult = await this.loadHTMLTemplate(appConfig);
            // CDN rewriting is now handled inside processTemplate() during loadHTMLTemplate()
            appConfig.cachedHTMLTemplate = templateResult.content;
          } catch (loadError) {
            throw new Error(
              `Failed to load HTML template for app "${appKey}": ${loadError instanceof Error ? loadError.message : String(loadError)}`,
            );
          }

          // Load and cache render function (fail fast at startup instead of on first request)
          try {
            await this.loadProductionRenderFunction(appConfig);
          } catch (loadError) {
            throw new Error(
              `Failed to load render function for app "${appKey}": ${loadError instanceof Error ? loadError.message : String(loadError)}`,
            );
          }
        }
      }

      // Dynamic import to prevent bundling in client builds
      const { default: fastify } = await import('fastify');

      // Build Fastify options from curated subset
      const fastifyOptions: FastifyServerOptions & { https?: unknown } = {};

      Object.assign(
        fastifyOptions,
        resolveFastifyLoggerConfig({
          logging: this.sharedOptions.logging,
          fastifyOptions: this.sharedOptions.fastifyOptions,
        }),
      );

      if (this.sharedOptions.fastifyOptions) {
        const { trustProxy, bodyLimit, keepAliveTimeout } =
          this.sharedOptions.fastifyOptions;

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

      // Add HTTPS configuration if provided
      if (this.sharedOptions.https) {
        fastifyOptions.https = buildFastifyHTTPSOptions(
          this.sharedOptions.https,
        );
      }

      this.fastifyInstance = fastify(fastifyOptions);

      // Register WebSocket plugin if enabled
      if (this.webSocketHelpers) {
        await this.webSocketHelpers.registerWebSocketPlugin(
          this.fastifyInstance,
        );
      }

      // Decorate requests with environment info (per-request)
      const mode: 'development' | 'production' = this.serverMode;
      const isDevelopment = mode === 'development';
      this.fastifyInstance.decorateRequest('isDevelopment', isDevelopment);

      // Decorate requests with activeSSRApp for multi-app routing (defaults to '__default__')
      this.fastifyInstance.decorateRequest('activeSSRApp', '__default__');

      // Decorate requests with APIResponseHelpersClass for file upload helpers
      this.fastifyInstance.decorateRequest(
        'APIResponseHelpersClass',
        this.APIResponseHelpersClass,
      );

      // Initialize request context for all requests
      this.fastifyInstance.addHook('onRequest', async (request, _reply) => {
        (
          request as FastifyRequest & {
            requestContext?: Record<string, unknown>;
          }
        ).requestContext = {};
      });

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

          const isDevelopment = this.serverMode === 'development';

          // Log errors for debugging (unless explicitly disabled, consistent with APIServer)
          if (this.sharedOptions.logErrors !== false) {
            request.log.error(
              { err: error, url: request.url, method: request.method },
              'Request error:',
            );
          }

          // Get active app config for error handling (fall back to default if active app not found)
          const appKey = request.activeSSRApp || '__default__';
          const appConfig =
            this.apps.get(appKey) || this.apps.get('__default__');

          if (!appConfig) {
            // This should never happen, but handle gracefully
            this.fastifyInstance?.log.error(
              'No app config found for error handling',
            );

            reply
              .code(500)
              .header('Content-Type', 'text/plain')
              .send('Internal Server Error');
            return;
          }

          // In development, let Vite fix the stack trace for better debugging.
          if (
            'viteDevServer' in appConfig &&
            appConfig.viteDevServer &&
            isDevelopment &&
            error instanceof Error
          ) {
            appConfig.viteDevServer.ssrFixStacktrace(error);
          }

          // If the response hasn't been sent, determine response type
          if (!reply.sent) {
            // Check if this is an API request
            // classifyRequest handles false prefix internally (returns isAPI: false)
            const { isAPI } = classifyRequest(
              request.url,
              this.normalizedAPIPrefix,
              this.normalizedPageDataEndpoint,
            );

            if (isAPI && this.normalizedAPIPrefix) {
              // Handle API error with JSON response
              await this.handleAPIError(request, reply, error);
            } else {
              // Handle SSR error with HTML response
              const errorPage = await this.generate500ErrorPage(
                request,
                error,
                appConfig,
              );

              reply
                .code(500)
                .header('Content-Type', 'text/html')
                .header('Cache-Control', 'no-store')
                .send(errorPage);
            }
          }
        },
      );

      // Register plugins if provided
      if (this.sharedOptions.plugins && this.sharedOptions.plugins.length > 0) {
        await this.registerPlugins();
      }

      // Register file upload hooks and plugin after user plugins
      // This ensures user plugin hooks (auth, etc.) run before upload validation
      if (this.sharedOptions.fileUploads?.enabled) {
        // Register validation hook using shared helper
        registerFileUploadValidationHooks(
          this.fastifyInstance,
          this.sharedOptions.fileUploads,
        );

        // Register multipart plugin using shared helper (also decorates with multipartEnabled)
        await registerMultipartPlugin(
          this.fastifyInstance,
          this.sharedOptions.fileUploads,
        );
      }

      // Register WebSocket preValidation hook if enabled (before routes but after plugins)
      if (this.webSocketHelpers) {
        this.webSocketHelpers.registerPreValidationHook(this.fastifyInstance);
      }

      // Register API routes if enabled, or validate no handlers were registered if disabled
      if (this.normalizedAPIPrefix === false) {
        // API is disabled - validate that no handlers were registered
        validateNoHandlersWhenAPIDisabled(
          this.apiRoutes,
          this.pageDataHandlers,
        );
      } else {
        // API is enabled - register page data and API routes
        this.pageDataHandlers.registerRoutes(
          this.fastifyInstance,
          this.normalizedAPIPrefix,
          this.normalizedPageDataEndpoint,
          {
            versioned: this.sharedOptions.apiEndpoints?.versioned,
          },
        );

        // Register API routes
        this.apiRoutes.registerRoutes(
          this.fastifyInstance,
          this.normalizedAPIPrefix,
          {
            versioned: this.sharedOptions.apiEndpoints?.versioned,
            allowWildcardAtRoot: false,
          },
        );
      }

      // Register WebSocket routes if enabled
      if (this.webSocketHelpers) {
        this.webSocketHelpers.registerRoutes(this.fastifyInstance);
      }

      // Create Vite Dev Server Middleware (Development Only)
      if (this.serverMode === 'development') {
        // Collect all dev apps (apps with paths)
        const devApps = Array.from(this.apps.entries()).filter(
          ([_, app]) => 'paths' in app,
        );

        if (devApps.length > 0) {
          // Create Vite instances for all dev apps in parallel
          // Each instance needs a unique HMR port to avoid conflicts
          await Promise.all(
            devApps.map(async ([appKey, appConfig], index) => {
              const devApp = appConfig as SSRInternalAppConfigDev;

              // Auto-assign HMR port: base port + index offset
              // Use port + 1000 + index to avoid conflicts with main server port
              const hmrPort = port + 1000 + index;

              devApp.viteDevServer = await (
                await import('vite')
              ).createServer({
                configFile: devApp.paths.viteConfig,
                server: {
                  middlewareMode: true,
                  hmr: {
                    // Auto-assign unique HMR port for each app
                    port: hmrPort,
                  },
                },
                appType: 'custom',
              });

              this.fastifyInstance?.log.debug(
                `Created Vite dev server for app "${appKey}" with HMR port ${hmrPort}`,
              );
            }),
          );

          // Dispatch Vite dev middleware via a Fastify onRequest hook.
          // We use onRequest instead of @fastify/middie because we need this to run
          // AFTER user plugin hooks (which set activeSSRApp, auth, etc.) so that
          // multi-app routing works correctly. The .use() approach from @fastify/middie
          // runs at the raw Node layer before Fastify decorations are available.
          // Vite's Connect-style middleware is wrapped in a Promise to integrate
          // with Fastify's async hook chain.
          this.fastifyInstance.addHook('onRequest', async (request, reply) => {
            const appKey = request.activeSSRApp || '__default__';
            const appConfig = this.apps.get(appKey);

            if (
              !appConfig ||
              !('viteDevServer' in appConfig) ||
              !appConfig.viteDevServer
            ) {
              // No Vite server for this app — continue to route handler
              return;
            }

            const viteMiddleware = appConfig.viteDevServer.middlewares;

            // Wrap Connect-style middleware (req, res, next) in a Promise.
            // If Vite handles the request (HMR, source files, /@vite/client, etc.)
            // it writes to res directly and never calls next(). We detect this via
            // res.writableEnded and tell Fastify we're done.
            // If Vite doesn't handle it, next() is called and we resolve to let
            // Fastify continue to the route handler for SSR rendering.
            await new Promise<void>((resolve, reject) => {
              viteMiddleware(request.raw, reply.raw, (err?: unknown) => {
                if (err) {
                  reject(
                    err instanceof Error
                      ? err
                      : new Error(
                          typeof err === 'string'
                            ? err
                            : 'Vite middleware error',
                        ),
                  );
                } else {
                  resolve();
                }
              });
            });

            // If Vite handled the request (wrote to res directly), hijack the
            // reply so Fastify doesn't try to send a second response.
            if (reply.raw.writableEnded) {
              reply.hijack();
            }
          });
        }
      }
      // Production Server Middleware (Production Only)
      else {
        // Create static content caches for all prod apps
        const staticContentCaches = new Map<string, StaticContentCache>();

        for (const [appKey, appConfig] of this.apps) {
          if ('buildDir' in appConfig) {
            // TypeScript knows appConfig is SSRProdAppConfig after the check
            // Check if static router is disabled for this app
            const staticRouterConfig = appConfig.staticContentRouter;

            // Skip if explicitly disabled (false)
            if (staticRouterConfig === false) {
              continue;
            }

            const clientBuildAssetDir = path.join(
              appConfig.buildDir,
              appConfig.clientFolderName || 'client',
              'assets',
            );

            // Use provided config or default to assets folder with immutable caching
            const finalConfig: StaticContentRouterOptions =
              staticRouterConfig || {
                folderMap: {
                  '/assets': {
                    path: clientBuildAssetDir,
                    detectImmutableAssets: true,
                  },
                },
              };

            // Create cache instance for this app
            const cache = new StaticContentCache(
              finalConfig,
              this.fastifyInstance.log,
            );
            staticContentCaches.set(appKey, cache);
          }
        }

        // Register routing hook if we have any caches
        if (staticContentCaches.size > 0) {
          this.fastifyInstance.addHook('onRequest', async (request, reply) => {
            const appKey = request.activeSSRApp || '__default__';
            const cache = staticContentCaches.get(appKey);

            if (cache) {
              // Use shared static content handler (includes GET check and URL validation)
              await staticContentHookHandler(cache, request, reply);
              // If file was served, reply was sent and hook returns early automatically
            }
          });
        }
      }

      // This handler will catch all requests
      this.fastifyInstance.get(
        '*',
        async (request: FastifyRequest, reply: FastifyReply) => {
          // Check if this is an API request that should return 404 JSON instead of SSR
          // classifyRequest handles false prefix internally (returns isAPI: false)
          const { isAPI } = classifyRequest(
            request.url,
            this.normalizedAPIPrefix,
            this.normalizedPageDataEndpoint,
          );

          if (isAPI && this.normalizedAPIPrefix) {
            // This is an API request that didn't match any route - return 404 JSON
            return this.handleAPINotFound(request, reply);
          }

          // Continue with SSR handling for non-API requests
          // Get active app based on request.activeSSRApp (defaults to '__default__')
          const appKey = request.activeSSRApp || '__default__';
          const appConfig = this.apps.get(appKey);

          if (!appConfig) {
            const availableApps = Array.from(this.apps.keys()).join(', ');
            throw new Error(
              `Active app "${appKey}" not found. Available apps: ${availableApps}`,
            );
          }

          // Load and call the actual render function from the server entry
          // Signature should be: (renderRequest: RenderRequest) => Promise<RenderResult>
          let render: (renderRequest: RenderRequest) => Promise<RenderResult>;

          let template: string;

          if (
            this.serverMode === 'development' &&
            'viteDevServer' in appConfig &&
            appConfig.viteDevServer
          ) {
            // --- Development SSR ---
            // Read template fresh per request in dev mode
            const templateResult = await this.loadHTMLTemplate(appConfig);
            template = templateResult.content;

            // Apply Vite HTML transforms (injects HMR client, plugins)
            template = await appConfig.viteDevServer.transformIndexHtml(
              request.url,
              template,
            );

            // Load server entry using Vite's SSR loader (from src)
            const entryServer = await appConfig.viteDevServer.ssrLoadModule(
              appConfig.paths.serverEntry,
            );

            if (
              !entryServer.render ||
              typeof entryServer.render !== 'function'
            ) {
              throw new Error(
                "Server entry module must export a 'render' function",
              );
            }

            // Type assertion: We've validated render exists and is a function
            render = entryServer.render as (
              renderRequest: RenderRequest,
            ) => Promise<RenderResult>;
          } else {
            // --- Production SSR ---
            // Use template and render function loaded at startup
            // Both are loaded once at startup for performance and fail-fast validation
            if (
              !('cachedHTMLTemplate' in appConfig) ||
              !appConfig.cachedHTMLTemplate
            ) {
              throw new Error(
                `HTML template not loaded for app "${appKey}" in production mode`,
              );
            }

            if (
              !('cachedRenderFunction' in appConfig) ||
              !appConfig.cachedRenderFunction
            ) {
              throw new Error(
                `Render function not loaded for app "${appKey}" in production mode`,
              );
            }

            template = appConfig.cachedHTMLTemplate;
            render = appConfig.cachedRenderFunction;
          }

          // Create Fetch API Request object for React Router
          // Create Request object with appropriate data
          const fetchRequest = new Request(
            `${request.protocol}://${request.hostname}${request.url}`,
            {
              method: request.method,
              headers: (() => {
                // Safely construct Headers from Fastify request headers, normalizing string | string[]
                const headers = new Headers();
                const reqHeaders = request.headers as Record<
                  string,
                  string | string[] | undefined
                >;

                for (const key in reqHeaders) {
                  const value = reqHeaders[key];

                  if (typeof value === 'string') {
                    headers.set(key, value);
                  } else if (Array.isArray(value)) {
                    for (const v of value) {
                      headers.append(key, v);
                    }
                  }
                }

                // First, delete any sensitive SSR headers that might be present in the client request
                // This prevents clients from spoofing these secure headers
                headers.delete('X-SSR-Request');
                headers.delete('X-SSR-Original-IP');
                headers.delete('X-SSR-Forwarded-User-Agent');
                headers.delete('X-Correlation-ID');

                // Now set these headers with our trusted server-side values
                headers.set('X-SSR-Request', 'true');
                headers.set('X-SSR-Original-IP', request.ip);

                // Forward the user agent if needed
                const userAgent = request.headers['user-agent'];

                if (typeof userAgent === 'string') {
                  headers.set('X-SSR-Forwarded-User-Agent', userAgent);
                }

                // Forward the correlation ID (which is the same as request ID at this point)
                if ((request as unknown as { requestID: string }).requestID) {
                  headers.set(
                    'X-Correlation-ID',
                    (request as unknown as { requestID: string }).requestID,
                  );
                }

                // Apply cookie forwarding policy to inbound Cookie header
                const originalCookieHeader = headers.get('cookie');
                const filteredCookieHeader = applyCookiePolicyToCookieHeader(
                  originalCookieHeader || undefined,
                  this.cookieAllowList,
                  this.cookieBlockList,
                );

                if (filteredCookieHeader && filteredCookieHeader.length > 0) {
                  headers.set('cookie', filteredCookieHeader);
                } else {
                  headers.delete('cookie');
                }

                return headers;
              })(),
              signal: AbortSignal.timeout(
                this.sharedOptions.ssrRenderTimeout ?? 5000,
              ),
            },
          );

          // Attach SSRHelper for server-only access in loaders
          const SSRHelpers: SSRHelpers = {
            fastifyRequest: request,
            controlledReply: createControlledReply(reply),
            handlers: this.pageDataHandlers,
            isDevelopment: this.serverMode === 'development',
          } as const;

          try {
            Object.defineProperty(fetchRequest, 'SSRHelpers', {
              value: SSRHelpers,
              enumerable: false,
              configurable: false,
              writable: false,
            });
          } catch {
            // If defineProperty fails for any reason, fallback to direct assignment
            (
              fetchRequest as unknown as { SSRHelpers?: SSRHelpers }
            ).SSRHelpers = SSRHelpers;
          }

          // --- Render the App ---
          try {
            // Clone app-specific frontendAppConfig to ensure it stays immutable for the entire request
            const frontendAppConfig = appConfig.frontendAppConfig
              ? Object.freeze(structuredClone(appConfig.frontendAppConfig))
              : undefined;

            const renderResult = await render({
              type: 'ssr',
              fetchRequest,
              unirendContext: {
                renderMode: 'ssr',
                isDevelopment: this.serverMode === 'development',
                fetchRequest: fetchRequest,
                frontendAppConfig,
                requestContextRevision: '0-0', // Initial revision for this request
              },
            });

            if (renderResult.resultType === 'page') {
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
                  reply.header('Set-Cookie', cookie);
                }
              }

              // if a 500 error is returned, send the server 500 error page version instead
              /// This is used when there is a error boundary that sets the custom 500 error page
              // To simplify return a server generated 500 error page instead of trying to hydrate the custom 500 error page error boundary
              if (statusCode === 500) {
                const error =
                  renderResult.errorDetails ||
                  new Error('Internal Server Error');

                await this.handleSSRError(request, reply, error, appConfig);

                return;
              }

              // --- Prepare Helmet data for injection ---
              const headParts = [
                renderResult.helmet?.title.toString() || '',
                renderResult.helmet?.meta.toString() || '',
                renderResult.helmet?.link.toString() || '',
                renderResult.preloadLinks || '',
              ].filter(Boolean);

              const headInject = headParts.join('\n');

              // Get app-specific config and request context for injection
              const requestContext =
                (
                  request as FastifyRequest & {
                    requestContext?: Record<string, unknown>;
                  }
                ).requestContext || {};

              // Use our utility to inject content with app-specific config
              // Check for per-request CDN URL override, fallback to app config
              const CDNBaseURL =
                (
                  request as FastifyRequest & {
                    CDNBaseURL?: string;
                  }
                ).CDNBaseURL ||
                ('CDNBaseURL' in appConfig ? appConfig.CDNBaseURL : undefined);

              const finalHTML = injectContent(
                template,
                headInject,
                renderResult.html,
                {
                  app: frontendAppConfig,
                  request: requestContext,
                },
                CDNBaseURL,
              );

              // ---> Send response with the extracted status code
              if (statusCode >= 400) {
                reply.header('Cache-Control', 'no-store');
              }

              reply
                .code(statusCode)
                .header('Content-Type', 'text/html')
                .send(finalHTML);

              return; // Stop further processing
            } else if (renderResult.resultType === 'response') {
              // If React Router returned a Response (redirect/error as a response), handle it
              // Forward status and headers
              reply.code(renderResult.response.status);

              // Apply no-store for all 4xx/5xx in SSR Response path
              if (renderResult.response.status >= 400) {
                reply.header('Cache-Control', 'no-store');
              }

              // Forward headers safe for redirects/responses
              // Headers is iterable at runtime but TS DOM lib types don't expose entries(),
              // so we cast to the expected iterable shape for safe iteration.
              const responseHeaders = renderResult.response
                .headers as unknown as Iterable<[string, string]>;

              for (const [key, value] of Array.from(responseHeaders)) {
                const lowerKey = key.toLowerCase();

                if (lowerKey === 'location' || lowerKey === 'set-cookie') {
                  if (lowerKey === 'set-cookie') {
                    const filtered = applyCookiePolicyToSetCookie(
                      value,
                      this.cookieAllowList,
                      this.cookieBlockList,
                    );

                    for (const v of filtered) {
                      reply.header('Set-Cookie', v);
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
                  { err: bodyError },
                  'Error reading response body:',
                );
                reply.send(); // End response even if body reading fails
              }

              return; // Stop further processing
            } else if (renderResult.resultType === 'render-error') {
              // Handle render errors
              await this.handleSSRError(
                request,
                reply,
                renderResult.error,
                appConfig,
              );

              return; // Stop further processing
            } else {
              // Handle unexpected result types (this should never happen with proper typing)
              // TypeScript knows this is never, but we handle it for runtime safety
              const resultType =
                (renderResult as { resultType?: string }).resultType ||
                'unknown';
              const unexpectedError = new Error(
                `Unexpected render result type: ${resultType}`,
              );

              await this.handleSSRError(
                request,
                reply,
                unexpectedError,
                appConfig,
              );

              return;
            }
          } catch (error) {
            await this.handleSSRError(
              request,
              reply,
              error as Error,
              appConfig,
            );

            return;
          }

          // Safety check - if we somehow reach here without sending a response
          if (!reply.sent) {
            this.fastifyInstance?.log.warn(
              'No response was sent, sending 500 error',
            );

            // Re-fetch appConfig for safety check (should always exist, but be defensive)
            const safetyAppKey = request.activeSSRApp || '__default__';
            const fallbackAppConfig =
              this.apps.get(safetyAppKey) || this.apps.get('__default__');

            if (!fallbackAppConfig) {
              // Ultimate fallback if even default app is missing
              reply
                .code(500)
                .header('Content-Type', 'text/plain')
                .send('Internal Server Error');
              return;
            }

            // TypeScript doesn't narrow the type properly here, but we've verified it exists above
            await this.handleSSRError(
              request,
              reply,
              new Error('No response was generated'),
              fallbackAppConfig as SSRInternalAppConfig,
            );
          }
        },
      );

      // Start the server
      await this.fastifyInstance.listen({
        port,
        host: host || 'localhost',
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

      // Close all Vite dev servers if any were created but startup failed
      for (const [appKey, appConfig] of this.apps) {
        if ('viteDevServer' in appConfig && appConfig.viteDevServer) {
          try {
            await appConfig.viteDevServer.close();
          } catch (closeError) {
            cleanupErrors.push(
              `Vite dev server cleanup failed for app "${appKey}": ${closeError instanceof Error ? closeError.message : String(closeError)}`,
            );
          }

          appConfig.viteDevServer = undefined;
        }
      }

      // Clear plugin tracking state on failure
      this.registeredPlugins = [];

      // Append cleanup errors to original error message if any
      if (cleanupErrors.length > 0 && error instanceof Error) {
        // Modify the original error's message directly
        error.message = `${error.message}. Additional errors occurred: ${cleanupErrors.join(', ')}`;
      }

      throw error;
    }
  }

  /**
   * Stop the server if it's currently listening
   */
  public async stop(): Promise<void> {
    if (!this._isListening) {
      return;
    }

    // Close all Vite dev servers and clear caches
    const cleanupErrors: string[] = [];

    // Close Fastify server if it exists
    if (this.fastifyInstance) {
      try {
        await this.fastifyInstance.close();
      } catch (closeError) {
        cleanupErrors.push(
          `Fastify close failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
        );
      }

      this.fastifyInstance = null;
    }

    for (const [appKey, appConfig] of this.apps) {
      // Close Vite dev server if present
      if ('viteDevServer' in appConfig && appConfig.viteDevServer) {
        try {
          await appConfig.viteDevServer.close();
          // Only clear reference if close succeeded
          appConfig.viteDevServer = undefined;
        } catch (closeError) {
          cleanupErrors.push(
            `Failed to close Vite dev server for app "${appKey}": ${closeError instanceof Error ? closeError.message : String(closeError)}`,
          );
          // Don't clear viteDevServer reference - it might still be running
        }
      }

      // Clear cached templates and render functions (production mode)
      if ('cachedHTMLTemplate' in appConfig) {
        appConfig.cachedHTMLTemplate = undefined;
      }

      if ('cachedRenderFunction' in appConfig) {
        appConfig.cachedRenderFunction = undefined;
      }
    }

    // Throw if any cleanup errors occurred
    if (cleanupErrors.length > 0) {
      throw new Error(
        `Server stop failed with ${cleanupErrors.length} error(s):\n${cleanupErrors.join('\n')}`,
      );
    }

    // Only mark as stopped after both are successfully closed
    this._isListening = false;

    // Clear plugin tracking state
    this.registeredPlugins = [];
  }

  /**
   * Public API method for registering versioned generic API routes
   * Usage: server.api.get("users/:id", handler) or server.api.get("users/:id", 2, handler)
   */
  public get api() {
    return this.apiRoutes.apiMethod;
  }

  /**
   * Public API method for registering page data loader handlers
   * Usage: server.pageDataHandler.register("home", handler) or server.pageDataHandler.register("home", 2, handler)
   */
  public get pageDataHandler() {
    return this.pageDataHandlers.pageDataHandlerMethod;
  }

  /**
   * Register a WebSocket handler for the specified path
   *
   * @param config WebSocket handler configuration
   * @throws Error if WebSocket support is not enabled
   */
  public registerWebSocketHandler(config: WebSocketHandlerConfig): void {
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
  public getWebSocketClients(): Set<WebSocket> {
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
   * Validate app key for registration
   * @private
   */
  private validateAppKey(appKey: string): void {
    // appKey is already validated as a non-empty string and trimmed by the caller
    if (appKey.length === 0) {
      throw new Error('App key cannot be empty or whitespace-only');
    }

    if (appKey === '__default__') {
      throw new Error(
        'Cannot register app with reserved key "__default__". This key is used for the initial app.',
      );
    }

    if (appKey.includes('/') || appKey.includes('\\')) {
      throw new Error(
        'App key cannot contain path separators. Use alphanumeric names like "marketing" or "admin".',
      );
    }

    if (this.apps.has(appKey)) {
      throw new Error(
        `App "${appKey}" is already registered. Use a different key or unregister the existing app first.`,
      );
    }
  }

  /**
   * Register plugins with controlled access to Fastify instance
   * @private
   */
  private async registerPlugins(): Promise<void> {
    // If no fastify instance or plugins are provided, return early
    if (!this.fastifyInstance || !this.sharedOptions.plugins) {
      return;
    }

    // Create controlled instance wrapper
    const controlledInstance = createControlledInstance(
      this.fastifyInstance,
      true,
      this.apiRoutes.apiMethod,
      this.pageDataHandlers.pageDataHandlerMethod,
    );

    // Plugin options to pass to each plugin
    const pluginOptions = {
      serverType: 'ssr' as const,
      mode: this.serverMode,
      isDevelopment: this.serverMode === 'development',
      apiEndpoints: this.sharedOptions.apiEndpoints,
    };

    // Register each plugin with dependency validation
    for (const plugin of this.sharedOptions.plugins) {
      try {
        // Call plugin and get potential metadata
        const pluginResult = await plugin(controlledInstance, pluginOptions);

        // Validate dependencies and track plugin
        validateAndRegisterPlugin(this.registeredPlugins, pluginResult);
      } catch (error) {
        this.fastifyInstance?.log.error(
          { err: error },
          'Failed to register plugin:',
        );

        throw new Error(
          `Plugin registration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Loads and caches the production render function from the server entry
   * This is called once and cached for performance in production mode
   * @param appConfig App configuration to load render function for
   * @returns Promise that resolves to the render function
   * @private
   */
  private async loadProductionRenderFunction(
    appConfig: SSRInternalAppConfig,
  ): Promise<(renderRequest: RenderRequest) => Promise<RenderResult>> {
    // Check if already cached on app config
    if ('cachedRenderFunction' in appConfig && appConfig.cachedRenderFunction) {
      return appConfig.cachedRenderFunction;
    }

    if (this.serverMode !== 'production' || !('buildDir' in appConfig)) {
      throw new Error(
        'loadProductionRenderFunction requires production mode with buildDir',
      );
    }

    const serverEntry = appConfig.serverEntry || 'entry-server';
    const serverBuildDir = path.join(
      appConfig.buildDir,
      appConfig.serverFolderName || 'server',
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
    let entryServer: unknown;

    try {
      /* @vite-ignore */
      entryServer = await import(entryResult.entryPath);
    } catch (error) {
      // Type assertion for error message - error could be anything
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      throw new Error(
        `Failed to import server entry from ${entryResult.entryPath}: ${errorMessage}`,
      );
    }

    // Validate the imported module has a render function
    if (
      !entryServer ||
      typeof entryServer !== 'object' ||
      !('render' in entryServer) ||
      typeof entryServer.render !== 'function'
    ) {
      throw new Error("Server entry module must export a 'render' function");
    }

    // Type assertion: We've validated render exists and is a function
    const renderFunction = entryServer.render as (
      renderRequest: RenderRequest,
    ) => Promise<RenderResult>;

    // Cache the render function on the app config for subsequent requests
    appConfig.cachedRenderFunction = renderFunction;
    return renderFunction;
  }

  /**
   * Loads and processes the HTML template based on the server mode
   * @param appConfig App configuration to load template for
   * @returns Promise that resolves to the processed template content and path
   * @private
   */
  private async loadHTMLTemplate(
    appConfig: SSRInternalAppConfig,
  ): Promise<{ content: string; path: string }> {
    // Determine template path based on mode
    let htmlTemplatePath: string;

    if (this.serverMode === 'development' && 'paths' in appConfig) {
      // Development mode: use provided template path
      htmlTemplatePath = appConfig.paths.template;
    } else if (this.serverMode === 'production' && 'buildDir' in appConfig) {
      // Production mode: use custom template or default to client/index.html
      if (appConfig.template) {
        // Custom template path (relative to buildDir)
        htmlTemplatePath = path.join(appConfig.buildDir, appConfig.template);
      } else {
        // Default: client folder from build directory
        htmlTemplatePath = path.join(
          appConfig.buildDir,
          appConfig.clientFolderName || 'client',
          'index.html',
        );
      }
    } else {
      throw new Error('Invalid app config for template loading');
    }

    // Read the HTML template file
    const templateResult = await readHTMLFile(htmlTemplatePath);

    if (!templateResult.exists) {
      throw new Error(
        `HTML template not found at ${htmlTemplatePath}. ` +
          (this.serverMode === 'development'
            ? 'Please check the templatePath parameter.'
            : 'Make sure to run the client build first.'),
      );
    }

    if (templateResult.error) {
      throw new Error(
        `Failed to read HTML template from ${htmlTemplatePath}: ${templateResult.error}`,
      );
    }

    // At this point, templateResult.content should exist
    const rawHTMLTemplate = templateResult.content as string;

    if (!rawHTMLTemplate || rawHTMLTemplate.length === 0) {
      throw new Error(`HTML template at ${htmlTemplatePath} is empty`);
    }

    // Process the template based on mode and app-specific container ID
    const isDevelopment = this.serverMode === 'development';
    const containerID = appConfig.containerID || 'root';

    const processResult = await processTemplate(
      rawHTMLTemplate,
      'ssr', // mode
      isDevelopment,
      containerID,
    );

    // For SSR, throw error if processing fails
    if (!processResult.success) {
      throw new Error(
        `Failed to process HTML template: ${processResult.error}`,
      );
    }

    return {
      content: processResult.html,
      path: htmlTemplatePath,
    };
  }

  /**
   * Handles SSR errors with Vite stack trace fixing and custom error pages
   * @param request The Fastify request object
   * @param reply The Fastify reply object
   * @param error The error that occurred
   * @param appConfig The app configuration (contains viteDevServer in development)
   * @private
   */
  private async handleSSRError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: Error,
    appConfig: SSRInternalAppConfig,
  ): Promise<void> {
    // This method is invoked both by the global Fastify error handler and
    // by our route-level try/catch around the render call. If a response
    // was already sent, bail out to prevent double-sending.
    if (reply.sent) {
      return;
    }

    const isDevelopment = this.serverMode === 'development';

    // If an error is caught, let Vite fix the stack trace so it maps back
    // to your actual source code.
    const vite = 'viteDevServer' in appConfig ? appConfig.viteDevServer : null;

    if (vite && error instanceof Error && isDevelopment) {
      vite.ssrFixStacktrace(error);
    }

    // Generate and send error page (handles dev vs prod internally)
    const errorPage = await this.generate500ErrorPage(
      request,
      error,
      appConfig,
    );

    reply
      .code(500)
      .header('Content-Type', 'text/html')
      .header('Cache-Control', 'no-store')
      .send(errorPage);
  }

  /**
   * Generates a 500 error page using custom handler or default
   * @param request The Fastify request object
   * @param error The error that occurred
   * @param appConfig The active app configuration
   * @returns Promise that resolves to HTML string
   * @private
   */
  private async generate500ErrorPage(
    request: FastifyRequest,
    error: Error,
    appConfig: SSRInternalAppConfig,
  ): Promise<string> {
    const isDevelopment = this.serverMode === 'development';

    // Log error details for server logs (always log, regardless of mode)
    this.fastifyInstance?.log.error(
      { err: error },
      `[SSR Error] ${request.method} ${request.url}:`,
    );

    try {
      // Use app-specific error handler if provided
      if (appConfig.get500ErrorPage) {
        return await appConfig.get500ErrorPage(request, error, isDevelopment);
      }

      // Fall back to built-in default error page
      return generateDefault500ErrorPage(request, error, isDevelopment);
    } catch (errorHandlerError) {
      // If custom error handler itself throws, fall back to the default error page
      this.fastifyInstance?.log.error(
        { err: errorHandlerError },
        '[SSR Error Handler Error]:',
      );
      return generateDefault500ErrorPage(request, error, isDevelopment);
    }
  }

  /**
   * Handles API errors with JSON responses using envelope pattern
   * @param request The Fastify request object
   * @param reply The Fastify reply object
   * @param error The error that occurred
   * @private
   */
  private async handleAPIError(
    request: FastifyRequest,
    reply: FastifyReply,
    error: Error,
  ): Promise<void> {
    const isDevelopment = this.serverMode === 'development';

    const { isPageData } = classifyRequest(
      request.url,
      this.normalizedAPIPrefix,
      this.normalizedPageDataEndpoint,
    );

    // Check for custom API error handler if provided
    if (this.sharedOptions.APIHandling?.errorHandler) {
      try {
        const customResponse = await Promise.resolve(
          this.sharedOptions.APIHandling.errorHandler(
            request,
            error,
            isDevelopment,
            isPageData,
          ),
        );

        // Extract status code from envelope response
        const statusCode = customResponse.status_code || 500;
        reply.code(statusCode).header('Cache-Control', 'no-store');

        return reply.send(customResponse);
      } catch (handlerError) {
        // If custom handler fails, fall back to default
        this.fastifyInstance?.log.error(
          { err: handlerError },
          '[API Error Handler Error]:',
        );
      }
    }

    // Default case
    const response = createDefaultAPIErrorResponse(
      this.APIResponseHelpersClass,
      request,
      error,
      isDevelopment,
      this.normalizedAPIPrefix,
      this.normalizedPageDataEndpoint,
    );

    // Extract status code from envelope response
    const statusCode =
      (response as { status_code?: number }).status_code || 500;

    return reply
      .code(statusCode)
      .header('Cache-Control', 'no-store')
      .send(response);
  }

  /**
   * Handles API 404 not found responses with JSON envelopes
   * @param request The Fastify request object
   * @param reply The Fastify reply object
   * @private
   */
  private async handleAPINotFound(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const { isPageData } = classifyRequest(
      request.url,
      this.normalizedAPIPrefix,
      this.normalizedPageDataEndpoint,
    );

    // Check for custom API not-found handler
    if (this.sharedOptions.APIHandling?.notFoundHandler) {
      try {
        const customResponse = await Promise.resolve(
          this.sharedOptions.APIHandling.notFoundHandler(request, isPageData),
        );

        // Extract status code from envelope response
        const statusCode = customResponse.status_code || 404;
        reply.code(statusCode).header('Cache-Control', 'no-store');

        return reply.send(customResponse);
      } catch (handlerError) {
        // If custom handler fails, fall back to default
        this.fastifyInstance?.log.error(
          { err: handlerError },
          '[API Not Found Handler Error]:',
        );
      }
    }

    // Default case
    const response = createDefaultAPINotFoundResponse(
      this.APIResponseHelpersClass,
      request,
      this.normalizedAPIPrefix,
      this.normalizedPageDataEndpoint,
    );

    // Extract status code from envelope response
    const statusCode =
      (response as { status_code?: number }).status_code || 404;

    return reply
      .code(statusCode)
      .header('Cache-Control', 'no-store')
      .send(response);
  }
}

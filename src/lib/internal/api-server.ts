import fastify from 'fastify';
import qs from 'qs';
import formbody from '@fastify/formbody';
import type { FastifyServerOptions, FastifyError } from 'fastify';
import {
  createControlledInstance,
  classifyRequest,
  normalizeAPIPrefix,
  normalizePageDataEndpoint,
  createDefaultAPIErrorResponse,
  createDefaultAPINotFoundResponse,
  registerClosingResponseHook,
  isSplitHandler,
  prepareWebResponse,
  validateAndRegisterPlugin,
  validateNoHandlersWhenAPIDisabled,
  buildFastifyHTTPSOptions,
  registerConnectionIPDecoration,
  registerRequestIDDecoration,
  computeDomainInfo,
} from './server-utils';
import { registerClientInfoResolution } from './client-info-resolution';
import type {
  APIServerOptions,
  PluginMetadata,
  APIResponseHelpersClass,
  PluginOptions,
  SplitErrorHandler,
  SplitNotFoundHandler,
  AccessLogConfig,
  WebErrorHandlerFn,
  WebNotFoundHandlerFn,
  APIErrorHandlerFn,
  APINotFoundHandlerFn,
  PluginAPIRouteShortcuts,
  PluginPageDataHandlerShortcuts,
  PluginHostInstance,
  ServerPlugin,
} from '../types';
import { AccessLogPlugin } from './access-log-plugin';
import { BaseServer } from './base-server';
import { DataLoaderServerHandlerHelpers } from './data-loader-server-handler-helpers';
import { APIRoutesServerHelpers } from './api-routes-server-helpers';
import { WebSocketServerHelpers } from './web-socket-server-helpers';
import type { WebSocketHandlerConfig } from './web-socket-server-helpers';
import { resolveFastifyLoggerConfig } from './logger-config-utils';
import {
  registerFileUploadValidationHooks,
  registerMultipartPlugin,
} from './file-upload-validation-helpers';
import { APIResponseHelpers } from '../../api-envelope';
import {
  generateDefault404NotFoundPage,
  generateDefault500ErrorPage,
} from './error-page-utils';
import type { WebSocket, WebSocketServer } from 'ws';
import { getDevMode } from 'lifecycleion/dev-mode';
import { registerResponseCompression } from './response-compression';
import {
  registerResponseTimeHeader,
  registerResponseTimeHijackPatch,
} from './response-time-header';
import { deepFreeze } from './utils';

function createDisabledAPIRouteShortcuts(): PluginAPIRouteShortcuts {
  const throwDisabled = () => {
    throw new Error(
      `Cannot register pluginHost.api.* handlers because API handling is disabled ` +
        `(apiEndpoints.apiEndpointPrefix is false). Use raw pluginHost.get/post routes ` +
        `for plain web server mode, or enable API handling with an API prefix like '/api'.`,
    );
  };

  return {
    get: throwDisabled,
    post: throwDisabled,
    put: throwDisabled,
    delete: throwDisabled,
    patch: throwDisabled,
  };
}

function createDisabledPageDataHandlerShortcuts(): PluginPageDataHandlerShortcuts {
  const throwDisabled = () => {
    throw new Error(
      `Cannot register pluginHost.pageDataHandler.* handlers because API handling is disabled ` +
        `(apiEndpoints.apiEndpointPrefix is false). Use raw pluginHost.get/post routes ` +
        `for plain web server mode, or enable API handling with an API prefix like '/api'.`,
    );
  };

  return {
    register: throwDisabled,
  };
}

/**
 * API Server class for creating JSON API servers with plugin support
 * Uses createControlledInstance with shouldDisableRootWildcard: false to allow full wildcard flexibility
 */

export class APIServer extends BaseServer {
  /** Pluggable helpers class reference for constructing API/Page envelopes */
  public readonly APIResponseHelpersClass: APIResponseHelpersClass;

  private options: APIServerOptions;
  private readonly serverLabel: string;
  private _accessLog: AccessLogPlugin;
  private pageDataHandlers!: DataLoaderServerHandlerHelpers;
  private apiRoutes!: APIRoutesServerHelpers;
  private webSocketHelpers: WebSocketServerHelpers | null = null;
  private registeredPlugins: PluginMetadata[] = [];

  // Normalized endpoint config (computed once at construction)
  // Can be false if API handling is disabled (server becomes a plain web server)
  private readonly normalizedAPIPrefix: string | false;
  private readonly normalizedPageDataEndpoint: string;

  constructor(options: APIServerOptions = {}) {
    super();

    this.options = {
      ...options,
    };

    this.serverLabel = options.serverLabel ?? 'API';
    this._accessLog = new AccessLogPlugin(this.serverLabel, options.accessLog);

    // Normalize API endpoint config once at construction
    this.normalizedAPIPrefix = normalizeAPIPrefix(
      this.options.apiEndpoints?.apiEndpointPrefix,
    );

    // Normalize page data endpoint once at construction
    this.normalizedPageDataEndpoint = normalizePageDataEndpoint(
      this.options.apiEndpoints?.pageDataEndpoint,
    );

    // Set helpers class (custom or default)
    this.APIResponseHelpersClass =
      this.options.APIResponseHelpersClass || APIResponseHelpers;

    // Initialize helpers (available immediately for handler registration)
    this.pageDataHandlers = new DataLoaderServerHandlerHelpers();
    this.apiRoutes = new APIRoutesServerHelpers();

    // Initialize WebSocket helpers if enabled
    if (this.options.enableWebSockets) {
      this.webSocketHelpers = new WebSocketServerHelpers(
        this.APIResponseHelpersClass,
        this.options.webSocketOptions,
      );
    }
  }

  /**
   * Start the API server
   * @param port Port to bind to (default: 3000)
   * @param host Host to bind to (default: "localhost")
   * @returns Promise that resolves when server is ready
   */
  public async listen(
    port: number = 3000,
    host: string = 'localhost',
  ): Promise<void> {
    if (this._isListening) {
      throw new Error(
        'APIServer is already listening. Call stop() first before listening again.',
      );
    }

    if (this._isStarting) {
      throw new Error(
        'APIServer is already starting. Please wait for the current startup to complete.',
      );
    }

    this._isStarting = true;
    this._isStopping = false;

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
      const fastifyOptions: FastifyServerOptions & { https?: unknown } = {};

      Object.assign(
        fastifyOptions,
        resolveFastifyLoggerConfig({
          logging: this.options.logging,
          fastifyOptions: this.options.fastifyOptions,
        }),
      );

      if (this.options.fastifyOptions) {
        const {
          trustProxy,
          bodyLimit,
          keepAliveTimeout,
          requestTimeout,
          connectionTimeout,
        } = this.options.fastifyOptions;

        if (trustProxy !== undefined) {
          fastifyOptions.trustProxy = trustProxy;
        }

        if (bodyLimit !== undefined) {
          fastifyOptions.bodyLimit = bodyLimit;
        }

        if (keepAliveTimeout !== undefined) {
          fastifyOptions.keepAliveTimeout = keepAliveTimeout;
        }

        if (requestTimeout !== undefined) {
          fastifyOptions.requestTimeout = requestTimeout;
        }

        if (connectionTimeout !== undefined) {
          fastifyOptions.connectionTimeout = connectionTimeout;
        }
      }

      // Add HTTPS configuration if provided
      if (this.options.https) {
        fastifyOptions.https = buildFastifyHTTPSOptions(this.options.https);
      }

      // Framework-owned Fastify behavior. These are intentionally not exposed
      // through fastifyOptions because Unirend depends on them for consistent
      // routing and shutdown responses across server types.
      fastifyOptions.return503OnClosing = false;

      fastifyOptions.routerOptions = {
        // Ignore trailing slashes for flexible routing (matches Express behavior)
        ignoreTrailingSlash: true,
        // Use qs for richer query string parsing (nested objects, arrays, encoded brackets)
        // querystringParser is a router option in Fastify v5+
        querystringParser: (str) => qs.parse(str),
      };

      // Create Fastify instance with merged options (user options + defaults + HTTPS + trailing slash)
      this.fastifyInstance = fastify(fastifyOptions);

      // Register formbody to support application/x-www-form-urlencoded bodies
      await this.fastifyInstance.register(formbody);

      // Register WebSocket plugin if enabled
      if (this.webSocketHelpers) {
        await this.webSocketHelpers.registerWebSocketPlugin(
          this.fastifyInstance,
        );
      }

      // Decorate requests with environment info
      // The default here is just a shape hint for Fastify; the live value is set per-request in the onRequest hook below.
      this.fastifyInstance.decorateRequest('isDevelopment', false);
      this.fastifyInstance.decorateRequest('serverLabel', this.serverLabel);
      this.fastifyInstance.decorateRequest('publicAppConfig', undefined);

      // Decorate requests with APIResponseHelpersClass for file upload helpers
      this.fastifyInstance.decorateRequest(
        'APIResponseHelpersClass',
        this.APIResponseHelpersClass,
      );

      // Initialize request context and set live dev-mode flag for all requests (consistent with SSRServer)
      // This runs early before plugins, so requestContext is always at least an empty object
      this.fastifyInstance.addHook('onRequest', async (request, _reply) => {
        // Set live dev-mode flag (read fresh each request so overrideDevMode() takes effect)
        (request as { isDevelopment?: boolean }).isDevelopment = getDevMode();

        // Capture request start time for envelope timestamp
        (request as { receivedAt?: number }).receivedAt = Date.now();

        // Initialize per-request context object (always present, never undefined)
        request.requestContext = {};

        // Compute domain info once per request so plugins/hooks can read rootDomain
        // (e.g. to set domain=.rootDomain on cookies) without re-parsing the hostname.
        // computeDomainInfo handles empty/missing hostnames gracefully:
        // parseHostHeader('') → { domain: '', port: '' }, rootDomain falls back to ''.
        request.domainInfo = computeDomainInfo(request.hostname);

        // Default false — set true by the static content handler if a static file is served
        // (e.g. via the staticContent plugin from unirend/plugins).
        (request as { isStaticAsset?: boolean }).isStaticAsset = false;

        request.publicAppConfig = this.options.publicAppConfig
          ? deepFreeze(structuredClone(this.options.publicAppConfig))
          : undefined;
      });

      // Set request.requestID once per request, before access logging and
      // plugins — available to access logs, handlers, and envelope helpers.
      // Defaults to a ULID; customizable via getRequestID.
      registerRequestIDDecoration(
        this.fastifyInstance,
        this.options.getRequestID,
      );

      // Set request.connectionIP (peer) and base request.clientIP once per
      // request — available to plugins, hooks, and access logs.
      registerConnectionIPDecoration(
        this.fastifyInstance,
        this.options.getConnectionIP,
      );

      // Resolve real end-user identity (request.clientIP override + clientInfo)
      // before access logging, unless disabled via clientInfo: false.
      if (this.options.clientInfo !== false) {
        registerClientInfoResolution(
          this.fastifyInstance,
          this.options.clientInfo ?? {},
        );
      }

      // Register access logging hooks. Config is read per request so
      // updateAccessLoggingConfig() changes take effect without a restart.
      this._accessLog.register(this.fastifyInstance);

      registerClosingResponseHook(
        this.fastifyInstance,
        () => this._isStopping,
        {
          handler: this.options.closingHandler,
          // APIServer function form is API-first when API handling is enabled.
          // In plain web server mode, function form returns WebResponse.
          functionHandlerType:
            this.normalizedAPIPrefix === false ? 'web' : 'api',
          serverLabel: this.serverLabel,
          HelpersClass: this.APIResponseHelpersClass,
          apiPrefix: this.normalizedAPIPrefix,
          pageDataEndpoint: this.normalizedPageDataEndpoint,
        },
      );

      // Patch reply.hijack() early so all subsequently registered routes
      // inherit the wrapper, including user/plugin routes that bypass onSend.
      registerResponseTimeHijackPatch(
        this.fastifyInstance,
        this.options.responseTimeHeader,
      );

      // Register global error handler
      this.setupErrorHandler();
      // Register not-found handler
      this.setupNotFoundHandler();

      // Register plugins if provided
      if (this.options.plugins && this.options.plugins.length > 0) {
        await this.registerPlugins();
      }

      // Register file upload hooks and plugin after user plugins
      // This ensures user plugin hooks (auth, etc.) run before upload validation
      if (this.options.fileUploads?.enabled) {
        // Register validation hook using shared helper
        registerFileUploadValidationHooks(
          this.fastifyInstance,
          this.options.fileUploads,
        );

        // Register multipart plugin using shared helper (also decorates with multipartEnabled)
        await registerMultipartPlugin(
          this.fastifyInstance,
          this.options.fileUploads,
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
            versioned: this.options.apiEndpoints?.versioned,
          },
        );

        this.apiRoutes.registerRoutes(
          this.fastifyInstance,
          this.normalizedAPIPrefix,
          {
            versioned: this.options.apiEndpoints?.versioned,
            allowWildcardAtRoot: true,
          },
        );
      }

      // Register WebSocket routes if enabled
      if (this.webSocketHelpers) {
        this.webSocketHelpers.registerRoutes(this.fastifyInstance);
      }

      // Register response compression for non-streaming API/web responses.
      // Static file compression is handled separately in the static content layer.
      registerResponseCompression(
        this.fastifyInstance,
        this.options.responseCompression,
      );

      // Register the response-time header hook after plugins and routes so
      // third-party onSend hooks run first. Normal Fastify-managed replies
      // measure the header here, while access logging measures on completion.
      registerResponseTimeHeader(
        this.fastifyInstance,
        this.options.responseTimeHeader,
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
   * Stop the API server if it's currently listening
   * @returns Promise that resolves when server is stopped
   */
  public async stop(): Promise<void> {
    if (this.fastifyInstance && this._isListening) {
      this._isStopping = true;

      try {
        await this.fastifyInstance.close();
        this._isListening = false;
        this.fastifyInstance = null;
      } finally {
        this._isStopping = false;
      }

      // Clear plugin tracking state
      this.registeredPlugins = [];
    }
  }

  /**
   * Merges the provided keys into the current access log config at runtime.
   * Access logging is on by default (finish events, default template). Use
   * `events: 'none'` to disable logging while keeping hooks active.
   * Omitted keys stay unchanged. Pass `undefined` for a hook callback to remove it.
   *
   * Changes take effect on the next request — no restart required.
   */
  public updateAccessLoggingConfig(partial: Partial<AccessLogConfig>): void {
    this._accessLog.update(partial);
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
        "WebSocket support is not enabled. Set 'enableWebSockets: true' in APIServerOptions to use WebSocket handlers.",
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
   * @private
   */
  private setupErrorHandler(): void {
    if (!this.fastifyInstance) {
      return;
    }

    this.fastifyInstance.setErrorHandler(async (error, request, reply) => {
      // If a handler already sent a response and then threw, avoid double-send
      if (reply.sent || reply.raw.headersSent) {
        return;
      }

      const requestID = (request as unknown as { requestID?: string })
        .requestID;

      request.log.error(
        {
          err: error,
          method: request.method,
          url: request.url,
          ...(requestID ? { requestID } : {}),
        },
        `[${this.serverLabel}] Request error`,
      );

      const { isAPI, isPageData } = classifyRequest(
        request.url,
        this.normalizedAPIPrefix,
        this.normalizedPageDataEndpoint,
      );

      const isDev = (request as unknown as { isDevelopment: boolean })
        .isDevelopment;

      // Use custom error handler if provided
      if (this.options.errorHandler) {
        try {
          // Check if it's the split form (object with api and/or web handlers)
          if (
            isSplitHandler<Partial<SplitErrorHandler>>(
              this.options.errorHandler,
            )
          ) {
            const splitHandler = this.options.errorHandler;

            if (isAPI && splitHandler.api) {
              // Use API handler
              const errorResponse = await Promise.resolve(
                splitHandler.api(
                  request,
                  error as FastifyError,
                  isDev,
                  isPageData,
                  { APIResponseHelpers: this.APIResponseHelpersClass },
                ),
              );

              // Extract status code from envelope response
              const statusCode = errorResponse.status_code || 500;
              reply.code(statusCode);

              if (statusCode >= 400) {
                reply.header('Cache-Control', 'no-store');
              }

              return errorResponse;
            } else if (!isAPI && splitHandler.web) {
              // Use web handler
              const webResponse = await Promise.resolve(
                splitHandler.web(request, error as FastifyError, isDev),
              );

              return prepareWebResponse(reply, webResponse, 500);
            }

            // Missing handler for this case - fall through to default
          } else if (
            typeof this.options.errorHandler === 'function' &&
            this.normalizedAPIPrefix === false
          ) {
            // Web-only function form for plain web server mode.
            const webHandler = this.options.errorHandler as WebErrorHandlerFn;
            const webResponse = await Promise.resolve(
              webHandler(request, error as FastifyError, isDev),
            );

            return prepareWebResponse(reply, webResponse, 500);
          } else if (typeof this.options.errorHandler === 'function') {
            // Function form (SSR compatible API/Page envelope)
            const apiHandler = this.options.errorHandler as APIErrorHandlerFn;
            const errorResponse = await Promise.resolve(
              apiHandler(request, error as FastifyError, isDev, isPageData, {
                APIResponseHelpers: this.APIResponseHelpersClass,
              }),
            );

            // Extract status code from envelope response
            const statusCode = errorResponse.status_code || 500;
            reply.code(statusCode);

            if (statusCode >= 400) {
              reply.header('Cache-Control', 'no-store');
            }

            return errorResponse;
          }
        } catch (handlerError) {
          // If custom handler fails, fall back to default
          request.log.error(
            { err: handlerError, method: request.method, url: request.url },
            `[${this.serverLabel}] Custom error handler failed`,
          );
        }
      }

      // Default 500 error page for web/plain-server mode
      if (this.normalizedAPIPrefix === false) {
        return prepareWebResponse(
          reply,
          {
            contentType: 'html',
            content: generateDefault500ErrorPage(
              request,
              error as FastifyError,
              isDev,
            ),
            statusCode: 500,
          },
          500,
        );
      }

      // Default case (also used when split handler is missing api/web)
      const response = createDefaultAPIErrorResponse(
        this.APIResponseHelpersClass,
        request,
        error as FastifyError,
        isDev,
        this.normalizedAPIPrefix,
        this.normalizedPageDataEndpoint,
      );

      // Extract status code from envelope response
      const statusCode =
        (response as { status_code?: number }).status_code || 500;

      reply.code(statusCode).header('Cache-Control', 'no-store');

      return response;
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
      const { isAPI, isPageData } = classifyRequest(
        request.url,
        this.normalizedAPIPrefix,
        this.normalizedPageDataEndpoint,
      );

      // If user provided custom not-found handler, use it
      if (this.options.notFoundHandler) {
        try {
          // Check if it's the split form (object with api and/or web handlers)
          if (
            isSplitHandler<Partial<SplitNotFoundHandler>>(
              this.options.notFoundHandler,
            )
          ) {
            const splitHandler = this.options.notFoundHandler;

            if (isAPI && splitHandler.api) {
              // Use API handler
              const apiResponse = await Promise.resolve(
                splitHandler.api(request, isPageData, {
                  APIResponseHelpers: this.APIResponseHelpersClass,
                }),
              );

              // Extract status code from envelope response
              const statusCode = apiResponse.status_code || 404;
              reply.code(statusCode).header('Cache-Control', 'no-store');

              return apiResponse;
            } else if (!isAPI && splitHandler.web) {
              // Use web handler
              const webResponse = await Promise.resolve(
                splitHandler.web(request),
              );

              return prepareWebResponse(reply, webResponse, 404);
            }

            // Missing handler for this case - fall through to default
          } else if (
            typeof this.options.notFoundHandler === 'function' &&
            this.normalizedAPIPrefix === false
          ) {
            // Web-only function form for plain web server mode.
            const webHandler = this.options
              .notFoundHandler as WebNotFoundHandlerFn;
            const webResponse = await Promise.resolve(webHandler(request));

            return prepareWebResponse(reply, webResponse, 404);
          } else if (typeof this.options.notFoundHandler === 'function') {
            // Function form (SSR compatible API/Page envelope)
            const apiHandler = this.options
              .notFoundHandler as APINotFoundHandlerFn;
            const custom = await Promise.resolve(
              apiHandler(request, isPageData, {
                APIResponseHelpers: this.APIResponseHelpersClass,
              }),
            );

            // Extract status code from envelope response
            const statusCode = custom.status_code || 404;
            reply.code(statusCode).header('Cache-Control', 'no-store');

            return custom;
          }
        } catch (handlerError) {
          // If custom handler fails, fall back to default
          request.log.error(
            { err: handlerError, method: request.method, url: request.url },
            `[${this.serverLabel}] Custom not-found handler failed`,
          );
        }
      }

      // Default 404 not found page for web/plain-server mode
      if (this.normalizedAPIPrefix === false) {
        return prepareWebResponse(
          reply,
          {
            contentType: 'html',
            content: generateDefault404NotFoundPage(request),
            statusCode: 404,
          },
          404,
        );
      }

      // Default case (also used when split handler is missing api/web)
      const response = createDefaultAPINotFoundResponse(
        this.APIResponseHelpersClass,
        request,
        this.normalizedAPIPrefix,
        this.normalizedPageDataEndpoint,
      );

      // Extract status code from envelope response
      const statusCode =
        (response as { status_code?: number }).status_code || 404;

      reply.code(statusCode).header('Cache-Control', 'no-store');

      return response;
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

    const apiShortcuts =
      this.normalizedAPIPrefix === false
        ? createDisabledAPIRouteShortcuts()
        : this.apiRoutes.apiMethod;
    const pageDataHandlerShortcuts =
      this.normalizedAPIPrefix === false
        ? createDisabledPageDataHandlerShortcuts()
        : this.pageDataHandlers.pageDataHandlerMethod;

    // Create controlled instance wrapper with full wildcard support
    const controlledInstance = createControlledInstance(
      this.fastifyInstance,
      false,
      apiShortcuts,
      pageDataHandlerShortcuts,
      this.APIResponseHelpersClass,
    );

    // Plugin options to pass to each plugin
    const isDevelopment = getDevMode();

    const pluginOptions: PluginOptions<'api' | 'plain'> = {
      serverType: this.normalizedAPIPrefix === false ? 'plain' : 'api',
      mode: isDevelopment ? 'development' : 'production',
      isDevelopment,
      apiEndpoints: this.options.apiEndpoints,
    };

    // Register each plugin with dependency validation
    const registerPlugin = async <Mode extends 'api' | 'plain'>(
      plugin: ServerPlugin<Mode>,
      host: PluginHostInstance<Mode>,
      options: PluginOptions<Mode>,
    ) => {
      try {
        // Call plugin and get potential metadata
        const pluginResult = await plugin(host, options);

        // Validate dependencies and track plugin
        validateAndRegisterPlugin(this.registeredPlugins, pluginResult);
      } catch (error) {
        this.fastifyInstance?.log.error(
          { err: error },
          `[${this.serverLabel}] Failed to register plugin`,
        );

        throw new Error(
          `Plugin registration failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    // Register each plugin with dependency validation
    if (this.normalizedAPIPrefix === false) {
      const plugins = this.options.plugins as ServerPlugin<'plain'>[];
      const host = controlledInstance as unknown as PluginHostInstance<'plain'>;
      const options = pluginOptions as PluginOptions<'plain'>;

      for (const plugin of plugins) {
        await registerPlugin(plugin, host, options);
      }
    } else {
      const plugins = this.options.plugins as ServerPlugin<'api'>[];
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
      const host = controlledInstance as PluginHostInstance<'api'>;
      const options = pluginOptions as PluginOptions<'api'>;

      for (const plugin of plugins) {
        await registerPlugin(plugin, host, options);
      }
    }
  }
}

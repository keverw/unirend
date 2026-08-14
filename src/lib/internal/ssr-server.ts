import type {
  RenderRequest,
  RenderResult,
  ServeSSRWithHMROptions,
  ServeSSRBuiltOptions,
  RegisterHMRAppOptions,
  RegisterBuiltAppOptions,
  SSRWithHMRPaths,
  StaticContentRouterOptions,
  SSRHelpers,
  NormalizedHTTPResponse,
  PluginMetadata,
  APIResponseHelpersClass,
  SSRInternalAppConfig,
  SSRInternalAppConfigHMR,
  SSRInternalAppConfigBuilt,
  AccessLogConfig,
} from '../types';
import { HTTPClient } from 'lifecycleion/http-client';
import { NodeAdapter } from 'lifecycleion/http-client-node';
import { AccessLogPlugin } from './access-log-plugin';
import { deepFreeze } from './utils';
import {
  readHTMLFile,
  checkAndLoadManifest,
  getServerEntryFromManifest,
  validateDevPaths,
} from './fs-utils';
import {
  collectTemplateCSPHashes,
  processTemplate,
  resolveTemplateCSPHashes,
  type TemplateCSPHashes,
} from './html-utils/format';
import { normalizeCDNBaseURL } from './cdn';
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
  computeDomainInfo,
  createDefaultAPIErrorResponse,
  resolveAPINotFoundResponse,
  registerClosingResponseHook,
  createControlledReply,
  validateAndRegisterPlugin,
  validateNoHandlersWhenAPIDisabled,
  buildFastifyHTTPSOptions,
  registerConnectionIPDecoration,
  registerRequestIDDecoration,
} from './server-utils';
import type {
  ClosingHandlerOption,
  APINotFoundHandlerOption,
  APINotFoundResolutionConfig,
} from './server-utils';
import { markTrigger404Requested } from './trigger-404';
import { registerClientInfoResolution } from './client-info-resolution';
import { generateDefault500ErrorPage } from './error-page-utils';
// See comment in static-content-cache.ts — cross-entry import via unirend/utils.
import { StaticContentCache } from 'unirend/utils';
import { staticContentHookHandler } from './static-content-hook';
import {
  validateProdAppStaticConfig,
  buildProdStaticRouterConfig,
  assertPublicPathsExist,
  findShadowedPublicPaths,
} from './static-router-config-utils';
import type { NormalizedPublicPaths } from './static-router-config-utils';
import { BaseServer } from './base-server';
import { DataLoaderServerHandlerHelpers } from './data-loader-server-handler-helpers';
import { APIRoutesServerHelpers } from './api-routes-server-helpers';
import { WebSocketServerHelpers } from './web-socket-server-helpers';
import type { WebSocketHandlerConfig } from './web-socket-server-helpers';
import type { BaseMeta } from '../api-envelope/api-envelope-types';
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
import { getDevMode } from 'lifecycleion/dev-mode';
import { registerResponseCompression } from './response-compression';
import {
  registerResponseTimeHeader,
  registerResponseTimeHijackPatch,
} from './response-time-header';
import { EventEmitter } from 'node:events';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { hmrPathForApp, isViteHMRUpgrade } from './hmr-upgrade-utils';
import {
  createStaticRequestMatcher,
  setStaticRequestClassification,
} from './static-request-paths';

type SSRServerConfigDev<H extends APIResponseHelpersClass> = {
  mode: 'development';
  sourcePaths: SSRWithHMRPaths; // Contains serverEntry, template, and viteConfig paths
  options: ServeSSRWithHMROptions<H>;
};

type SSRServerConfigProd<H extends APIResponseHelpersClass> = {
  mode: 'production';
  buildDir: string; // Directory containing built assets (HTML template, static files, manifest, etc.)
  options: ServeSSRBuiltOptions<H>;
};

type SSRServerConfig<H extends APIResponseHelpersClass> =
  SSRServerConfigDev<H> | SSRServerConfigProd<H>;

// Private per-request fields used to back the public active-app API.
// Keeping these separate lets request.activeSSRApp stay read-only while
// request.setActiveSSRApp() can validate and refresh app-derived values.
type ActiveSSRAppInternalState = {
  appKey?: string;
  lastAppDefaultCDNBaseURL?: string;
};

type SSRRequestInternalState = FastifyRequest & {
  activeSSRAppInternal?: ActiveSSRAppInternalState;
};

/**
 * Server-side HTTP transport for page-data requests.
 *
 * Uses lifecycleion's HTTPClient rather than fetch so that forwarded headers
 * (including Host) are sent at the transport level — the Fetch spec forbids
 * setting Host on a Request object, so fetch silently drops it.
 *
 * When no adapter is provided, HTTPClient uses its built-in Node.js transport
 * (http/https modules) — fine for standard setups. Pass a NodeAdapter from
 * resolvePageDataRequestOptions when you need TLS control (custom CA, mTLS,
 * SNI servername) or are dialing by IP address.
 *
 * The body is passed as an object and serialized once by lifecycleion — no
 * JSON stringify/parse round-trip like the browser fetch path would require.
 *
 * Redirects are disabled: an unexpected redirect from an internal service is
 * a misconfiguration worth surfacing, not silently following.
 */
async function pageDataServerFetch(
  url: string,
  headers: Headers,
  body: unknown,
  timeoutMS: number,
  adapter?: NodeAdapter,
): Promise<NormalizedHTTPResponse> {
  // Headers object is iterable at runtime but TypeScript's DOM lib doesn't
  // include [Symbol.iterator] on Headers without DOM.Iterable in the tsconfig.
  const headersObj: Record<string, string> = {};
  for (const [key, value] of headers as unknown as Iterable<[string, string]>) {
    headersObj[key] = value;
  }

  // Always use NodeAdapter so Host and other restricted headers are sent at the
  // transport level — FetchAdapter (the HTTPClient default) uses Node's fetch,
  // which silently drops the Host header per the Fetch spec forbidden-header rules.
  const client = new HTTPClient({
    adapter: adapter ?? new NodeAdapter(),
    // Headers sent at transport level — bypasses Fetch spec forbidden-header restrictions.
    defaultHeaders: headersObj,
    followRedirects: false,
  });

  // Send the request and wait for the full response.
  const result = await client
    .post<unknown>(url)
    .json(body)
    .timeout(timeoutMS)
    .send();

  // Surface transport-level failures as thrown errors so the caller can
  // convert them to a 500 envelope without inspecting a status code.
  if (result.isFailed) {
    // When followRedirects is false, a 3xx response sets isFailed with status: 0
    // and loses the original status code. Return a redirect response so
    // processAPIResponse can build the redirectNotFollowed envelope with Location.
    // type: 'opaqueredirect' triggers the existing redirect detection branch.
    if (result.wasRedirectDetected) {
      return {
        status: 302,
        type: 'opaqueredirect',
        headers: {
          get: (name: string) =>
            name.toLowerCase() === 'location'
              ? (result.detectedRedirectURL ?? null)
              : null,
          getSetCookie: () => [],
        },
        json: () => Promise.resolve(null),
      };
    }

    if (result.isTimeout) {
      throw new Error(`Request timeout after ${timeoutMS}ms`);
    }

    if (result.isNetworkError) {
      throw new Error('Network error connecting to page data service');
    }

    // isParseError: response was received but JSON decoding failed
    if (result.isParseError) {
      throw new Error('Page data response could not be parsed as JSON');
    }

    throw new Error('Page data request failed');
  }

  // Wrap lifecycleion's response into NormalizedHTTPResponse so page-data-loader
  // can handle both this path and the browser fetch path through the same interface.
  return {
    status: result.status,
    headers: {
      get: (name: string) => {
        const val = result.headers[name.toLowerCase()];
        return Array.isArray(val) ? (val[0] ?? null) : (val ?? null);
      },
      // set-cookie may be an array (multiple headers) or a single string.
      getSetCookie: () => {
        const val = result.headers['set-cookie'];
        return Array.isArray(val) ? val : val ? [val] : [];
      },
    },
    // body is already parsed by lifecycleion — return as-is, no re-parsing needed.
    json: () => Promise.resolve(result.body),
  };
}

/**
 * Internal server class for handling SSR rendering
 * Not intended to be used directly by library consumers
 */

export class SSRServer<
  H extends APIResponseHelpersClass = APIResponseHelpersClass,
> extends BaseServer {
  /** Pluggable helpers class reference for constructing API/Page envelopes */
  public readonly APIResponseHelpersClass: H;

  // config state
  private serverMode: 'development' | 'production';
  private readonly serverLabel: string;

  // Multi-app storage
  private apps: Map<string, SSRInternalAppConfig> = new Map();

  // Shared server configuration (used across all apps)
  private sharedOptions: ServeSSRWithHMROptions<H> | ServeSSRBuiltOptions<H>;
  private _accessLog: AccessLogPlugin;

  // Shared server resources (used across all apps)
  private pageDataHandlers!: DataLoaderServerHandlerHelpers<H>;
  private apiRoutes!: APIRoutesServerHelpers<unknown, BaseMeta, H>;
  private webSocketHelpers: WebSocketServerHelpers<H> | null = null;
  private registeredPlugins: PluginMetadata[] = [];

  // When both WebSockets and Vite HMR are active, @fastify/websocket is bound
  // to this private proxy emitter instead of the real HTTP server so it does
  // not compete with Vite's shared HMR listener over the "upgrade" event.
  // wsUpgradeDispatcher is the single real-server listener that routes Vite
  // HMR upgrades to Vite and forwards the rest to the proxy. Both are null
  // unless WebSockets are enabled in development (HMR) mode.
  private wsUpgradeProxy: EventEmitter | null = null;
  private wsUpgradeDispatcher:
    ((req: IncomingMessage, socket: Duplex, head: Buffer) => void) | null =
    null;

  // Cookie forwarding policy (computed from options for quick checks)
  private cookieAllowList?: Set<string>;
  private cookieBlockList?: Set<string> | true;

  // Normalized endpoint config (computed once at construction)
  // false means API handling is disabled (matches config type)
  private readonly normalizedAPIPrefix: string | false;
  private readonly normalizedPageDataEndpoint: string;
  private readonly isStaticRequestPath: (pathname: string) => boolean;

  /**
   * Creates a new SSR server instance
   *
   * @param config Server configuration object
   */
  constructor(config: SSRServerConfig<H>) {
    super();

    // Store server mode and shared options
    this.serverMode = config.mode;
    this.sharedOptions = config.options;
    this.serverLabel = config.options.serverLabel ?? 'SSR';
    this.isStaticRequestPath = createStaticRequestMatcher(
      config.options.staticRequestPaths,
    );
    this._accessLog = new AccessLogPlugin(
      this.serverLabel,
      config.options.accessLog,
    );

    // Validate prod static config up front (publicFiles/publicFolders
    // entries, root-mount guard) so a bad config throws where it was written,
    // not at listen().
    let normalizedDefaultPublicPaths: NormalizedPublicPaths = {};

    if (config.mode === 'production') {
      normalizedDefaultPublicPaths = validateProdAppStaticConfig(
        'the default app',
        config.buildDir,
        config.options.clientFolderName || 'client',
        config.options.staticContentRouter,
        config.options.publicFiles,
        config.options.publicFolders,
      );
    }

    // Convert single config to Map with '__default__' key
    const defaultApp: SSRInternalAppConfig =
      config.mode === 'development'
        ? {
            // Dev mode - has sourcePaths
            sourcePaths: config.sourcePaths,
            publicAppConfig: config.options.publicAppConfig,
            clientFolderName: config.options.clientFolderName || 'client',
            serverFolderName: config.options.serverFolderName || 'server',
            containerID: config.options.containerID,
            templateSlots: config.options.templateSlots,
            get500ErrorPage: config.options.get500ErrorPage,
          }
        : {
            // Prod mode - has buildDir
            buildDir: config.buildDir,
            serverEntry: config.options.serverEntry,
            template: config.options.template,
            CDNBaseURL: config.options.CDNBaseURL,
            staticContentRouter: config.options.staticContentRouter,
            publicFiles: normalizedDefaultPublicPaths.publicFiles,
            publicFolders: normalizedDefaultPublicPaths.publicFolders,
            publicAppConfig: config.options.publicAppConfig,
            clientFolderName: config.options.clientFolderName || 'client',
            serverFolderName: config.options.serverFolderName || 'server',
            containerID: config.options.containerID,
            templateSlots: config.options.templateSlots,
            get500ErrorPage: config.options.get500ErrorPage,
            getStaticNotFoundPage: config.options.getStaticNotFoundPage,
          };

    this.apps.set('__default__', defaultApp);

    // Set helpers class (custom or default)
    // Cast covers the default branch: without an explicit class, `H` stays the
    // base class, which is exactly what APIResponseHelpers is.
    this.APIResponseHelpersClass = (this.sharedOptions
      .APIResponseHelpersClass || APIResponseHelpers) as H;

    // Normalize API endpoint config once at construction
    this.normalizedAPIPrefix = normalizeAPIPrefix(
      config.options.apiEndpoints?.apiEndpointPrefix,
    );

    // Normalize page data endpoint once at construction
    this.normalizedPageDataEndpoint = normalizePageDataEndpoint(
      config.options.apiEndpoints?.pageDataEndpoint,
    );

    // Initialize helpers (available immediately for handler registration)
    this.pageDataHandlers = new DataLoaderServerHandlerHelpers<H>();
    this.apiRoutes = new APIRoutesServerHelpers<unknown, BaseMeta, H>();

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
   * Register an additional HMR-mode SSR app
   *
   * Can only be called on HMR servers (created via serveSSRWithHMR).
   * Apps must be registered BEFORE calling listen().
   *
   * Uses the same app-specific parameters as serveSSRWithHMR (excluding server-wide settings like port/host).
   *
   * @param appKey - Unique identifier for this app (selected with request.setActiveSSRApp)
   * @param sourcePaths - Dev-specific source paths (same as serveSSRWithHMR)
   * @param options - App-specific dev options (subset of serveSSRWithHMR options)
   *
   * @example
   * ```ts
   * const mainPaths = {
   *   serverEntry: './src/EntrySSR.tsx',
   *   template: './index.html',
   *   viteConfig: './vite.config.ts'
   * };
   *
   * const server = serveSSRWithHMR(mainPaths, { port: 3000 });
   *
   * // Same parameters as above - easy to copy/paste
   * server.registerHMRApp('marketing', {
   *   serverEntry: './src/marketing/EntrySSR.tsx',
   *   template: './src/marketing/index.html',
   *   viteConfig: './vite.marketing.config.ts'
   * }, {
   *   publicAppConfig: { api_endpoint: 'http://localhost:3002' }
   * });
   *
   * await server.listen(3000);
   * ```
   */
  public registerHMRApp(
    appKey: string,
    sourcePaths: SSRWithHMRPaths,
    options?: RegisterHMRAppOptions,
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
        `Cannot register dev app "${trimmedAppKey}" on prod server. Use registerBuiltApp() instead.`,
      );
    }

    const opts = options || {};
    const appConfig: SSRInternalAppConfigHMR = {
      sourcePaths,
      publicAppConfig: opts.publicAppConfig,
      clientFolderName: opts.clientFolderName || 'client',
      serverFolderName: opts.serverFolderName || 'server',
      containerID: opts.containerID,
      templateSlots: opts.templateSlots,
      get500ErrorPage: opts.get500ErrorPage,
    };

    this.apps.set(trimmedAppKey, appConfig);
  }

  /**
   * Register an additional built-mode SSR app
   *
   * Can only be called on built servers (created via serveSSRBuilt).
   * Apps must be registered BEFORE calling listen().
   *
   * Uses the same app-specific parameters as serveSSRBuilt (excluding server-wide settings like port/host).
   *
   * @param appKey - Unique identifier for this app (selected with request.setActiveSSRApp)
   * @param buildDir - Build directory path (same as serveSSRBuilt)
   * @param options - App-specific prod options (subset of serveSSRBuilt options)
   *
   * @example
   * ```ts
   * const server = serveSSRBuilt('./build-main', { port: 3000 });
   *
   * // Same parameters as above - easy to copy/paste
   * server.registerBuiltApp('marketing', './build-marketing', {
   *   publicAppConfig: { api_endpoint: 'https://marketing.example.com' }
   * });
   *
   * await server.listen(3000);
   * ```
   */
  public registerBuiltApp(
    appKey: string,
    buildDir: string,
    options?: RegisterBuiltAppOptions,
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
        `Cannot register prod app "${trimmedAppKey}" on dev server. Use registerHMRApp() instead.`,
      );
    }

    const opts = options || {};

    // Validate prod static config up front (publicFiles/publicFolders
    // entries, root-mount guard) so a bad config throws here, not at listen().
    const normalizedPublicPaths = validateProdAppStaticConfig(
      `app "${trimmedAppKey}"`,
      buildDir,
      opts.clientFolderName || 'client',
      opts.staticContentRouter,
      opts.publicFiles,
      opts.publicFolders,
    );

    const appConfig: SSRInternalAppConfigBuilt = {
      buildDir,
      serverEntry: opts.serverEntry,
      template: opts.template,
      CDNBaseURL: opts.CDNBaseURL,
      staticContentRouter: opts.staticContentRouter,
      // Router stored raw — StaticContentCache normalizes it at listen();
      // public paths normalized here because listen() consumes them directly.
      publicFiles: normalizedPublicPaths.publicFiles,
      publicFolders: normalizedPublicPaths.publicFolders,
      publicAppConfig: opts.publicAppConfig,
      clientFolderName: opts.clientFolderName || 'client',
      serverFolderName: opts.serverFolderName || 'server',
      containerID: opts.containerID,
      templateSlots: opts.templateSlots,
      get500ErrorPage: opts.get500ErrorPage,
      getStaticNotFoundPage: opts.getStaticNotFoundPage,
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

      this.teardownWSUpgradeDispatcher();
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
      //
      // The template's CSP hashes go with it, in the same branch rather than
      // one of their own. They describe that exact template's inline content,
      // so a cleared template that left them behind would be a set of hashes
      // for bytes nothing is serving. Nothing reads them in that state today,
      // since the request path refuses to serve without a template at all, but
      // the two are written together when the template loads and keeping them
      // cleared together is what stops that from depending on a guard
      // elsewhere.
      if ('cachedHTMLTemplate' in appConfig) {
        appConfig.cachedHTMLTemplate = undefined;
        appConfig.cachedTemplateCSPHashes = undefined;
      }

      if ('cachedRenderFunction' in appConfig) {
        appConfig.cachedRenderFunction = undefined;
      }
    }

    try {
      // Validate development paths exist before proceeding for ALL dev apps
      if (this.serverMode === 'development') {
        for (const [appKey, appConfig] of this.apps) {
          if ('sourcePaths' in appConfig) {
            const pathValidation = await validateDevPaths(
              appConfig.sourcePaths,
            );

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
            // Fixed for the life of the process alongside the template itself,
            // so hashing happens once here rather than per response.
            appConfig.cachedTemplateCSPHashes = templateResult.cspHashes;
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
      const { default: qs } = await import('qs');

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
        const {
          trustProxy,
          bodyLimit,
          keepAliveTimeout,
          requestTimeout,
          connectionTimeout,
        } = this.sharedOptions.fastifyOptions;

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
      if (this.sharedOptions.https) {
        fastifyOptions.https = buildFastifyHTTPSOptions(
          this.sharedOptions.https,
        );
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
      await this.fastifyInstance.register(
        (await import('@fastify/formbody')).default,
      );

      // Register WebSocket plugin if enabled
      if (this.webSocketHelpers) {
        // In development, Vite's HMR WebSocket shares the same HTTP server, and
        // @fastify/websocket otherwise grabs every "upgrade" unconditionally.
        // Bind it to a private proxy emitter so the two don't collide; a
        // dispatcher installed after Vite starts feeds it the non-HMR upgrades.
        // In built/production mode there is no Vite, so it binds directly.
        if (this.serverMode === 'development') {
          this.wsUpgradeProxy = new EventEmitter();
        }

        await this.webSocketHelpers.registerWebSocketPlugin(
          this.fastifyInstance,
          this.wsUpgradeProxy ?? undefined,
        );
      }

      // Decorate requests with environment info
      // The default here is just a shape hint for Fastify; the live value is set per-request in the onRequest hook below.
      this.fastifyInstance.decorateRequest('isDevelopment', false);
      this.fastifyInstance.decorateRequest('isStaticAsset', false);
      this.fastifyInstance.decorateRequest('isStaticRequest', false);
      this.fastifyInstance.decorateRequest('isStaticContentMatch', false);
      this.fastifyInstance.decorateRequest('serverLabel', this.serverLabel);

      // Decorate active app routing (defaults to '__default__') and app-derived request values.
      // activeSSRApp is intentionally read-only so plugins cannot change the
      // selected app without also refreshing publicAppConfig/CDNBaseURL.
      this.fastifyInstance.decorateRequest('activeSSRAppInternal', undefined);
      this.fastifyInstance.decorateRequest('activeSSRApp', {
        getter(this: FastifyRequest) {
          return (
            (this as SSRRequestInternalState).activeSSRAppInternal?.appKey ||
            '__default__'
          );
        },
        setter() {
          throw new Error(
            'request.activeSSRApp is read-only. Use request.setActiveSSRApp(appKey) to choose an SSR app.',
          );
        },
      });

      this.fastifyInstance.decorateRequest('setActiveSSRApp', () => {
        throw new Error(
          'request.setActiveSSRApp() is not initialized for this request.',
        );
      });
      this.fastifyInstance.decorateRequest('publicAppConfig', undefined);
      this.fastifyInstance.decorateRequest('CDNBaseURL', undefined);

      // Abandon a request into the not-found path. Fastify puts function
      // decorators on the Request prototype, so this costs nothing per request
      // and carries no per-request state: the trigger state lives in the async
      // context of the handler invocation that called it.
      this.fastifyInstance.decorateRequest(
        'trigger404',
        markTrigger404Requested,
      );

      // Decorate requests with APIResponseHelpersClass for file upload helpers
      this.fastifyInstance.decorateRequest(
        'APIResponseHelpersClass',
        // Widened to the base class: Fastify's decorator typing rejects an
        // unresolved generic, and readers narrow it back per server anyway.
        this.APIResponseHelpersClass as APIResponseHelpersClass,
      );

      // Initialize request context and set live dev-mode flag for all requests
      this.fastifyInstance.addHook('onRequest', async (request, _reply) => {
        // Set live dev-mode flag (read fresh each request so overrideDevMode() takes effect)
        (
          request as FastifyRequest & {
            isDevelopment?: boolean;
          }
        ).isDevelopment = getDevMode();

        // Capture request start time for envelope timestamp
        (request as { receivedAt?: number }).receivedAt = Date.now();

        // Initialize per-request context object (always present, never undefined)
        request.requestContext = {};

        // Compute domain info once per request so plugins/hooks can read rootDomain
        // (e.g. to set domain=.rootDomain on cookies) without re-parsing the hostname.
        // computeDomainInfo handles empty/missing hostnames gracefully:
        // parseHostHeader('') → { domain: '', port: '' }, rootDomain falls back to ''.
        request.domainInfo = computeDomainInfo(request.hostname);

        // Default false — set true by the static content handler before hijacking,
        // whether that's the built-in /assets serving or a staticContent plugin
        // registered by the app. Lets onResponse hooks detect static asset requests.
        (request as { isStaticAsset?: boolean }).isStaticAsset = false;

        // Set later only when a configured static mapping matches. It stays
        // true for a mapped file that is missing and reaches a 404 path.
        (request as { isStaticContentMatch?: boolean }).isStaticContentMatch =
          false;

        setStaticRequestClassification(request, this.isStaticRequestPath);

        const activeSSRAppInternal: ActiveSSRAppInternalState = {};
        request.setDecorator<ActiveSSRAppInternalState>(
          'activeSSRAppInternal',
          activeSSRAppInternal,
        );

        // Use one path for every app selection, including the default app
        // below. That keeps validation, config cloning, and CDN state updates
        // identical for the initial request and later middleware changes.
        const applyActiveApp = (appKey: string): void => {
          const trimmedAppKey = appKey.trim();

          if (!trimmedAppKey) {
            throw new Error('Active app key must be a non-empty string');
          }

          const activeAppConfig = this.apps.get(trimmedAppKey);

          if (!activeAppConfig) {
            const availableApps = Array.from(this.apps.keys()).join(', ');

            throw new Error(
              `Active app "${trimmedAppKey}" not found. Available apps: ${availableApps}`,
            );
          }

          if (trimmedAppKey !== activeSSRAppInternal.appKey) {
            // Keep one immutable public config snapshot per active app choice.
            // Re-selecting the same app leaves the current request snapshot alone.
            request.publicAppConfig = activeAppConfig.publicAppConfig
              ? deepFreeze(structuredClone(activeAppConfig.publicAppConfig))
              : undefined;
          }

          // App config provides the default CDN URL, but SSR middleware may set
          // request.CDNBaseURL for request-specific routing such as regional
          // CDNs. Replace only a missing value or the last value we applied
          // from app config. If middleware changed request.CDNBaseURL, it will
          // no longer match lastAppDefaultCDNBaseURL, so preserve it.
          if (
            request.CDNBaseURL === undefined ||
            request.CDNBaseURL === activeSSRAppInternal.lastAppDefaultCDNBaseURL
          ) {
            const appCDNBaseURL =
              'CDNBaseURL' in activeAppConfig
                ? activeAppConfig.CDNBaseURL
                : undefined;

            request.CDNBaseURL = appCDNBaseURL;
            activeSSRAppInternal.lastAppDefaultCDNBaseURL = appCDNBaseURL;
          }

          // Store this last so a failed refresh cannot leave the request
          // pointing at an app whose derived values were not applied.
          activeSSRAppInternal.appKey = trimmedAppKey;
        };

        // Expose the public setter after its per-request closure exists. User
        // onRequest hooks registered later can call this immediately.
        request.setDecorator<(appKey: string) => void>(
          'setActiveSSRApp',
          (appKey: string): void => {
            applyActiveApp(appKey);
          },
        );

        // Seed the request with the default app through the same code path that
        // middleware uses for multi-app routing.
        applyActiveApp('__default__');
      });

      // Set request.requestID once per request, before access logging and
      // plugins — available to access logs, handlers, and envelope helpers.
      // Defaults to a ULID; customizable via getRequestID.
      registerRequestIDDecoration(
        this.fastifyInstance,
        this.sharedOptions.getRequestID,
      );

      // Set request.connectionIP (peer) and base request.clientIP once per
      // request — available to plugins, hooks, and access logs.
      registerConnectionIPDecoration(
        this.fastifyInstance,
        this.sharedOptions.getConnectionIP,
      );

      // Resolve real end-user identity (request.clientIP override + clientInfo)
      // before access logging, unless disabled via clientInfo: false.
      if (this.sharedOptions.clientInfo !== false) {
        registerClientInfoResolution(
          this.fastifyInstance,
          this.sharedOptions.clientInfo ?? {},
        );
      }

      // Register access logging hooks. Config is read per request so
      // updateAccessLoggingConfig() changes take effect without a restart.
      this._accessLog.register(this.fastifyInstance);

      registerClosingResponseHook(
        this.fastifyInstance,
        () => this._isStopping,
        {
          // The hook invokes handlers with the class configured on this
          // server, so widening the params type back to the base is safe.
          handler: this.sharedOptions.closingHandler as ClosingHandlerOption,
          // SSR function form is web-first. Split form can still customize
          // API and page-data requests when API handling is enabled.
          functionHandlerType: 'web',
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
        this.sharedOptions.responseTimeHeader,
      );

      // --- Setup Global Error Handling ---
      // IMPORTANT: The global error handler must be registered *before* any plugins
      // or routes. This ensures it can catch errors that occur during plugin
      // loading or from any registered route.
      this.fastifyInstance.setErrorHandler(
        async (error: Error, request: FastifyRequest, reply: FastifyReply) => {
          // Avoid double-send if a previous step already wrote the response
          if (reply.sent || reply.raw.headersSent) {
            return;
          }

          // Get active app config for error handling. setActiveSSRApp validates
          // app keys, so the fallback is defensive for unexpected internal state.
          const appKey = request.activeSSRApp || '__default__';
          const appConfig =
            this.apps.get(appKey) || this.apps.get('__default__');

          if (!appConfig) {
            // This should never happen, but handle gracefully
            request.log.error(
              { method: request.method, url: request.url },
              `[${this.serverLabel}] No app config found for error handling`,
            );

            reply.code(500).header('Content-Type', 'text/plain');
            return 'Internal Server Error';
          }

          // In development, fix Vite stack traces for all errors so source locations are accurate.
          // ssrFixStacktrace is idempotent — safe to call here even if handleSSRError calls it again.
          if (
            'viteDevServer' in appConfig &&
            appConfig.viteDevServer &&
            this.serverMode === 'development' &&
            error instanceof Error
          ) {
            appConfig.viteDevServer.ssrFixStacktrace(error);
          }

          // If the response hasn't been sent, determine response type
          if (!reply.sent && !reply.raw.headersSent) {
            // Check if this is an API request
            // classifyRequest handles false prefix internally (returns isAPI: false)
            const { isAPI } = classifyRequest(
              request.url,
              this.normalizedAPIPrefix,
              this.normalizedPageDataEndpoint,
            );

            if (isAPI && this.normalizedAPIPrefix) {
              // Log the original request error here (single log point for API errors).
              // If a custom errorHandler also throws, that failure is logged separately
              // inside handleAPIError — two different errors, intentionally two log entries.
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

              // Return the envelope so wrapThenable makes exactly one reply.send() call.
              return await this.handleAPIError(request, reply, error);
            } else {
              // Return the HTML from handleSSRError so wrapThenable makes one reply.send() call.
              return await this.handleSSRError(
                request,
                reply,
                error,
                appConfig,
              );
            }
          }
        },
      );

      // --- Setup Global Not-Found Handling ---
      // Registered alongside the error handler and before any plugins, so a
      // plugin route calling reply.callNotFound() delegates to it.
      this.setupNotFoundHandler();

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
        // Install the not-found resolution on both registries before their
        // routes exist, so request.trigger404() resolves through exactly the
        // config a genuine miss resolves through.
        const notFoundResolution = this.notFoundResolutionConfig();
        this.pageDataHandlers.setNotFoundResolution(notFoundResolution);
        this.apiRoutes.setNotFoundResolution(notFoundResolution);

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
          ([_, app]) => 'sourcePaths' in app,
        );

        // Shared by the HMR wiring and the WebSocket upgrade dispatcher below.
        const httpServer = this.fastifyInstance?.server;

        // The effective HMR paths the browser connects to, used by the upgrade
        // dispatcher to tell Vite HMR sockets apart from application WebSockets.
        // Vite joins the resolved dev `base` with our per-app path, so we record
        // that same joined value (not just hmrPath) to match Vite's own listener
        // even when an app configures a non-root base. Stays empty when there
        // are no dev apps, which makes the dispatcher forward every upgrade to
        // @fastify/websocket.
        const hmrPaths = new Set<string>();

        if (devApps.length > 0) {
          // Create Vite instances for all dev apps in parallel.
          //
          // Rather than allocating a dedicated HMR WebSocket port per app
          // using the main port + 1000 (e.g., 4000 + 1000 = 5000),
          // (which collided with macOS AirPlay on 5000 when the app used port
          // 4000, or with other Unirend projects' main ports), each app's Vite
          // instance shares the main Fastify HTTP server for its HMR WebSocket
          // and is disambiguated by a unique path. Vite's shared-server
          // listener only claims upgrades whose subprotocol is
          // "vite-hmr"/"vite-ping" AND whose pathname matches this app's
          // hmrPath, so multiple apps coexist on one port and the browser
          // client connects back to the page's own port automatically (no HMR
          // port is injected into the client).
          await Promise.all(
            devApps.map(async ([appKey, appConfig]) => {
              const devApp = appConfig as SSRInternalAppConfigHMR;

              // Unique per-app HMR path on the shared server, URL-safe and
              // consistent between the server listener and the injected client.
              const hmrPath = hmrPathForApp(appKey);

              devApp.viteDevServer = await (
                await import('vite')
              ).createServer({
                configFile: devApp.sourcePaths.viteConfig,
                server: {
                  middlewareMode: true,
                  ws: {
                    // Share the main HTTP server instead of opening a port.
                    server: httpServer,
                    path: hmrPath,
                  },
                },
                appType: 'custom',
              });

              // Vite derives the client's HMR URL as posix.join(base, path);
              // record the same value so the dispatcher matches what actually
              // arrives on the wire.
              const base = devApp.viteDevServer.config.base || '/';
              const effectiveHmrPath = path.posix.join(base, hmrPath);
              hmrPaths.add(effectiveHmrPath);

              this.fastifyInstance?.log.debug(
                `Created Vite dev server for app "${appKey}" with shared HMR at path ${effectiveHmrPath}`,
              );
            }),
          );

          // Dispatch Vite dev middleware via a Fastify onRequest hook.
          // We use onRequest instead of @fastify/middie because we need this to run
          // AFTER user plugin hooks (which can call setActiveSSRApp and run auth) so that
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

        // Install the WebSocket upgrade dispatcher whenever WebSockets are
        // enabled in development (i.e. wsUpgradeProxy was created), independent
        // of the dev app count. @fastify/websocket is bound to that private
        // proxy, so without this dispatcher forwarding real-server upgrades to
        // it, application WebSocket handlers would never fire. Vite HMR upgrades
        // (matching subprotocol AND a configured HMR path) are left for Vite's
        // own listener; everything else is forwarded to the proxy. With no dev
        // apps hmrPaths is empty, so every upgrade is forwarded. Guarding this
        // on wsUpgradeProxy (not devApps.length) keeps it consistent with the
        // proxy binding so application WebSockets can't be silently orphaned.
        if (this.wsUpgradeProxy && httpServer) {
          const proxy = this.wsUpgradeProxy;

          this.wsUpgradeDispatcher = (req, socket, head) => {
            if (
              isViteHMRUpgrade(
                req.headers['sec-websocket-protocol'],
                req.url,
                hmrPaths,
              )
            ) {
              // Vite's own shared-server listener handles these.
              return;
            }

            proxy.emit('upgrade', req, socket, head);
          };

          httpServer.on('upgrade', this.wsUpgradeDispatcher);
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

            const clientRootDir = path.join(
              appConfig.buildDir,
              appConfig.clientFolderName || 'client',
            );

            const appLabel =
              appKey === '__default__' ? 'the default app' : `app "${appKey}"`;

            const publicPaths: NormalizedPublicPaths = {
              publicFiles: appConfig.publicFiles,
              publicFolders: appConfig.publicFolders,
            };

            // Startup existence check: every declared publicFiles file and
            // publicFolders directory must exist in the client build dir — a
            // typo or bad build fails loudly at boot instead of 404ing
            // silently in production.
            if (
              (publicPaths.publicFiles?.length ?? 0) > 0 ||
              (publicPaths.publicFolders?.length ?? 0) > 0
            ) {
              await assertPublicPathsExist(
                publicPaths,
                clientRootDir,
                appLabel,
              );
            }

            // Shadowing a publicFiles/publicFolders entry with an explicit
            // singleAssetMap key / folderMap prefix is allowed (explicit
            // entries win) but usually a mistake, so call it out at boot.
            // The exception: a folderMap entry pointing at the same directory
            // as its publicFolders declaration AND enabling immutable
            // detection is the intentional pattern for custom knobs on a
            // declared public folder, and stays quiet.
            const shadowed = findShadowedPublicPaths(
              staticRouterConfig || undefined,
              publicPaths,
              clientRootDir,
            );

            if (shadowed.length > 0) {
              this.fastifyInstance.log.warn(
                `Some publicFiles/publicFolders entries for ${appLabel} are also defined as explicit staticContentRouter keys. The staticContentRouter keys win, so these publicFiles/publicFolders declarations are ignored: ${shadowed.join(', ')}. Remove them from one side to silence this warning.`,
              );
            }

            // A custom staticContentRouter replaces the /assets default
            // (pre-publicFiles behavior); publicFiles/publicFolders entries
            // are folded into whichever config is in effect, with explicit
            // singleAssetMap/folderMap keys winning on conflict.
            const finalConfig: StaticContentRouterOptions =
              buildProdStaticRouterConfig(
                staticRouterConfig || undefined,
                publicPaths,
                clientRootDir,
                this.sharedOptions.responseCompression,
              );

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
              const result = await staticContentHookHandler(
                cache,
                request,
                reply,
              );

              // A served static response already hijacked the reply and owns
              // the socket, so nothing below applies to it. Returning here does
              // not end the hook chain — returning undefined from an onRequest
              // hook always continues it, and only the hijack keeps later hooks
              // and the catch-all SSR route from writing to the same response.
              if (result?.served) {
                return;
              }

              // Get the active app config for static not-found handling.
              // setActiveSSRApp validates app keys, so the default fallback is
              // defensive for unexpected internal state, matching 500 errors.
              const appConfig =
                this.apps.get(appKey) || this.apps.get('__default__');

              // Only an opt-in handler intercepts a mapped target that is
              // missing or not a regular file, or OS junk rejected from a
              // configured folder mapping. Every other result falls through
              // to normal API or React 404/error handling.
              if (
                result &&
                !result.served &&
                result.reason === 'matched-not-found' &&
                appConfig?.getStaticNotFoundPage
              ) {
                const page = await appConfig.getStaticNotFoundPage(
                  request,
                  (request as FastifyRequest & { isDevelopment: boolean })
                    .isDevelopment,
                );

                reply
                  .code(404)
                  .header('Content-Type', 'text/html; charset=utf-8')
                  .header('Cache-Control', 'no-store');

                return reply.send(page);
              }
            }
          });
        }
      }

      // This handler will catch all GET requests. Everything else a route did
      // not claim reaches the same place through setupNotFoundHandler().
      this.fastifyInstance.get(
        '*',
        async (request: FastifyRequest, reply: FastifyReply) => {
          return this.handleUnmatchedRequest(request, reply);
        },
      );

      // Register response compression for non-streaming SSR/API responses.
      // Static file compression is handled separately in the static content layer.
      registerResponseCompression(
        this.fastifyInstance,
        this.sharedOptions.responseCompression,
      );

      // Register the response-time header hook after plugins and routes so
      // third-party onSend hooks run first. Normal Fastify-managed replies
      // measure the header here, while access logging measures on completion.
      registerResponseTimeHeader(
        this.fastifyInstance,
        this.sharedOptions.responseTimeHeader,
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

        this.teardownWSUpgradeDispatcher();
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
      this._isStopping = true;

      try {
        await this.fastifyInstance.close();
      } catch (closeError) {
        cleanupErrors.push(
          `Fastify close failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
        );
      } finally {
        this._isStopping = false;
      }

      this.teardownWSUpgradeDispatcher();
      this.fastifyInstance = null;
    }

    for (const [appKey, appConfig] of this.apps) {
      // Close Vite dev server if present
      if ('viteDevServer' in appConfig && appConfig.viteDevServer) {
        const viteDevServer = appConfig.viteDevServer;

        const viteCleanupWarnings: string[] = [];

        // Unref the watcher so the process can exit even if Bun doesn't
        // fully release the underlying fs handle after close().
        viteDevServer.watcher?.unref?.();

        // Close the file watcher explicitly first so Bun handles the fs
        // handle release as a discrete step rather than racing it against
        // HMR teardown inside Vite's internal close().
        try {
          await viteDevServer.watcher?.close();
        } catch (closeError) {
          viteCleanupWarnings.push(
            `watcher.close() failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
          );
        }

        // Start ws.close() first — its Promise executor runs synchronously,
        // so the server stops accepting new connections immediately.
        try {
          const wsClosePromise = viteDevServer.ws.close();

          // Terminate any connected clients. terminate() forcefully closes the
          // socket and its underlying TCP connection so the HMR HTTP server has
          // no remaining connections when wsHttpServer.close() fires.
          for (const client of viteDevServer.ws.clients) {
            client.socket.terminate();
          }

          await wsClosePromise;
        } catch (closeError) {
          viteCleanupWarnings.push(
            `ws.close() failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
          );
        }

        // Always run Vite's full close path so watcher/HMR failures do not
        // skip environment, HTTP server, or SSR runner cleanup.
        try {
          await viteDevServer.close();

          // Only clear reference if Vite reports that its full close path finished.
          appConfig.viteDevServer = undefined;
        } catch (closeError) {
          const errorDetails = [
            ...viteCleanupWarnings,
            `viteDevServer.close() failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`,
          ];
          cleanupErrors.push(
            `Failed to close Vite dev server for app "${appKey}": ${errorDetails.join('; ')}`,
          );
          // Don't clear viteDevServer reference - it might still be running
        }
      }

      // Clear cached templates and render functions (production mode).
      // The template's CSP hashes are cleared with it, for the reason given
      // where the same thing happens before a start.
      if ('cachedHTMLTemplate' in appConfig) {
        appConfig.cachedHTMLTemplate = undefined;
        appConfig.cachedTemplateCSPHashes = undefined;
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
   * Force-close all open connections, including Fastify WebSockets and Vite HMR
   * sockets in development mode. Unlike stop(), this does not wait for
   * in-flight requests to complete.
   */
  public override closeAllConnections(): void {
    for (const appConfig of this.apps.values()) {
      if ('viteDevServer' in appConfig && appConfig.viteDevServer) {
        for (const client of appConfig.viteDevServer.ws.clients) {
          client.socket.terminate();
        }
      }
    }

    super.closeAllConnections();
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
  public registerWebSocketHandler<M extends BaseMeta = BaseMeta>(
    config: WebSocketHandlerConfig<M, H>,
  ): void {
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
   * Detach the shared-HMR upgrade dispatcher (development + WebSockets only)
   * and drop the proxy reference. Vite removes its own "upgrade" listener when
   * its dev server closes, so this only needs to clear the dispatcher we added.
   * Safe to call when nothing was installed.
   * @private
   */
  private teardownWSUpgradeDispatcher(): void {
    if (this.wsUpgradeDispatcher && this.fastifyInstance) {
      this.fastifyInstance.server.removeListener(
        'upgrade',
        this.wsUpgradeDispatcher,
      );
    }

    this.wsUpgradeDispatcher = null;
    this.wsUpgradeProxy = null;
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
      this.APIResponseHelpersClass,
    );

    // Plugin options to pass to each plugin
    const pluginOptions = {
      serverType: 'ssr' as const,
      mode: this.serverMode,
      isDevelopment: getDevMode(),
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
          `[${this.serverLabel}] Failed to register plugin`,
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

    const serverEntry = appConfig.serverEntry || 'EntrySSR';
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
      entryServer = await import(/* @vite-ignore */ entryResult.entryPath);
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
  private async loadHTMLTemplate(appConfig: SSRInternalAppConfig): Promise<{
    content: string;
    path: string;
    cspHashes: TemplateCSPHashes;
  }> {
    // Determine template path based on mode
    let htmlTemplatePath: string;

    if (this.serverMode === 'development' && 'sourcePaths' in appConfig) {
      // Development mode: use provided template path
      htmlTemplatePath = appConfig.sourcePaths.template;
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
    const isDevServer = this.serverMode === 'development';
    const containerID = appConfig.containerID || 'root';

    const processResult = await processTemplate(
      rawHTMLTemplate,
      'ssr', // mode
      getDevMode(), // runtime behavior (dev comment)
      isDevServer, // asset serving strategy (CDN rewriting)
      containerID,
      appConfig.templateSlots, // extra inline head scripts / body-prepend HTML
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
      cspHashes: processResult.cspHashes,
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
  ): Promise<string | undefined> {
    // This method is invoked both by the global Fastify error handler and
    // by our route-level try/catch around the render call. If a response
    // was already sent, bail out to prevent double-sending.
    if (reply.sent || reply.raw.headersSent) {
      return undefined;
    }

    // If an error is caught, let Vite fix the stack trace so it maps back
    // to your actual source code.
    const vite = 'viteDevServer' in appConfig ? appConfig.viteDevServer : null;

    if (vite && error instanceof Error && this.serverMode === 'development') {
      vite.ssrFixStacktrace(error);
    }

    // Log SSR errors here (single log point — avoids double-logging when called from global error handler)
    // Uses request.log to include per-request logger bindings
    const requestID = (request as unknown as { requestID?: string }).requestID;

    request.log.error(
      {
        err: error,
        method: request.method,
        url: request.url,
        ...(requestID ? { requestID } : {}),
      },
      `[${this.serverLabel}] Request error`,
    );

    // Generate error page HTML (handles dev vs prod internally).
    // Callers inside async Fastify route handlers should `return await handleSSRError(...)`
    // so that wrapThenable makes exactly one reply.send() call with the returned HTML.
    const errorPage = await this.generate500ErrorPage(
      request,
      error,
      appConfig,
    );

    reply
      .code(500)
      .header('Content-Type', 'text/html')
      .header('Cache-Control', 'no-store');

    return errorPage;
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
    const isDevelopment = (
      request as FastifyRequest & { isDevelopment: boolean }
    ).isDevelopment;

    try {
      // Use app-specific error handler if provided
      if (appConfig.get500ErrorPage) {
        return await appConfig.get500ErrorPage(request, error, isDevelopment);
      }

      // Fall back to built-in default error page
      return generateDefault500ErrorPage(request, error, isDevelopment);
    } catch (errorHandlerError) {
      // If custom handler throws, log that failure separately and fall back to the default page.
      // The original request error was already logged in handleSSRError — two different errors,
      // intentionally two log entries.
      request.log.error(
        { err: errorHandlerError, method: request.method, url: request.url },
        `[${this.serverLabel}] Custom 500 error page handler failed`,
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
  ): Promise<unknown> {
    const isDevelopment = (
      request as FastifyRequest & { isDevelopment: boolean }
    ).isDevelopment;

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
            { APIResponseHelpers: this.APIResponseHelpersClass },
          ),
        );

        // Extract status code from envelope response
        const statusCode = customResponse.status_code || 500;
        reply.code(statusCode).header('Cache-Control', 'no-store');

        // Return the envelope instead of calling reply.send() directly.
        // The caller returns this value so wrapThenable makes exactly one reply.send() call.
        return customResponse;
      } catch (handlerError) {
        // If custom handler fails, fall back to default
        request.log.error(
          { err: handlerError, method: request.method, url: request.url },
          `[${this.serverLabel}] Custom API error handler failed`,
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

    reply.code(statusCode).header('Cache-Control', 'no-store');

    return response;
  }

  /**
   * Assembles the shared API/page-data not-found resolution config in one
   * place, so every caller resolves 404s identically.
   * @private
   */
  private notFoundResolutionConfig(): APINotFoundResolutionConfig {
    return {
      // The resolver invokes the handler with the class configured on this
      // server, so widening the params type back to the base is safe.
      handler: this.sharedOptions.APIHandling?.notFoundHandler as
        APINotFoundHandlerOption | undefined,
      serverLabel: this.serverLabel,
      HelpersClass: this.APIResponseHelpersClass,
      apiPrefix: this.normalizedAPIPrefix,
      pageDataEndpoint: this.normalizedPageDataEndpoint,
    };
  }

  /**
   * Registers the not-found handler that answers everything the `GET '*'`
   * catch-all does not match: every non-GET miss, and any plugin route handler
   * that returns `reply.callNotFound()`.
   *
   * Without it those requests fell through to Fastify's stock JSON 404, which
   * is the wrong shape on both sides of the split — an API path never got the
   * envelope this server configures, and a web path never reached React on a
   * server whose whole premise is that a 404 renders the app's own page.
   *
   * Plugins receive a controlled wrapper over the root instance rather than an
   * encapsulated scope, and that wrapper exposes no `setNotFoundHandler`, so no
   * plugin can shadow this one.
   *
   * @private
   */
  private setupNotFoundHandler(): void {
    if (!this.fastifyInstance) {
      return;
    }

    this.fastifyInstance.setNotFoundHandler(
      async (request: FastifyRequest, reply: FastifyReply) => {
        return this.handleUnmatchedRequest(request, reply);
      },
    );
  }

  /**
   * Routes a request that no route claimed. An API or page-data path gets the
   * JSON envelope, everything else renders through the active app.
   *
   * Both entry points land here — the `GET '*'` catch-all and the not-found
   * handler that covers every non-GET miss and any plugin route returning
   * `reply.callNotFound()` — so the classification can never drift between them.
   *
   * @param request The Fastify request object
   * @param reply The Fastify reply object
   * @private
   */
  private async handleUnmatchedRequest(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
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

    // A web path no route claimed. GET and HEAD render normally; anything else
    // is a method this server has no route for, and must not be handed to
    // React Router with its original method.
    //
    // React Router's static handler runs the matched route's `action` for a
    // non-GET request, which is how <Form method="post"> is meant to work in a
    // React Router app. Here it would mean a request Fastify never routed
    // executing the app's mutation code. And for the far more common route
    // with no action it answers 405, deciding that from a route object having
    // matched — so an app with the recommended `path: '*'` catch-all 405s even
    // a URL that genuinely does not exist, which is not a distinction worth
    // forwarding.
    //
    // So it renders as a GET and answers 404. GET makes running an action
    // structurally impossible rather than merely discouraged, and the request
    // gets whatever the app renders for that URL, which for an unknown path is
    // the app's own 404 page.
    const isReadMethod = request.method === 'GET' || request.method === 'HEAD';

    return this.handleSSRRequest(request, reply, {
      isUnmatchedNonReadMethod: !isReadMethod,
    });
  }

  /**
   * Renders a request through the active app's server entry and returns the
   * HTML, so wrapThenable makes exactly one reply.send() call.
   *
   * Extracted from the `GET '*'` catch-all so the not-found handler can serve
   * the identical response for a request the catch-all never saw.
   *
   * @param request The Fastify request object
   * @param reply The Fastify reply object
   * @private
   */
  private async handleSSRRequest(
    request: FastifyRequest,
    reply: FastifyReply,
    options: {
      /**
       * Set for a non-GET/HEAD request that no route claimed. Renders as a GET
       * so React Router cannot run a route action, and forces the response to
       * 404 whatever the render produced. See `handleUnmatchedRequest`.
       */
      isUnmatchedNonReadMethod?: boolean;
    } = {},
  ): Promise<unknown> {
    const { isUnmatchedNonReadMethod = false } = options;
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

    // The CDN base URL in force for this request, resolved once.
    //
    // Needed before the render rather than only at it, because the
    // template's CSP hashes depend on it: a template may write
    // __CDN__INJECTION__POINT__ into an inline <style>, and injectContent
    // resolves that per request, so the hash has to be taken against the
    // same value. `request.CDNBaseURL` is populated before preHandler, so
    // it is already settled here.
    //
    // `??` rather than `||` so an explicit empty-string override, which is
    // how a hook disables the CDN for one request, is honored instead of
    // falling through to the app-level default.
    const requestCDNBaseURL = normalizeCDNBaseURL(
      request.CDNBaseURL ??
        ('CDNBaseURL' in appConfig ? appConfig.CDNBaseURL : undefined),
    );

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

      // Hash after Vite, not before. transformIndexHtml runs after
      // processTemplate and adds inline content of its own, the React
      // refresh preamble among it, so hashes taken earlier would be
      // missing exactly the scripts that only exist in development.
      //
      // Guarded on the decoration rather than on a mode flag: it is
      // absent unless securityHeaders is registered with a csp policy, so
      // a dev server that is not using CSP pays nothing for this.
      if (request.addCSPSources) {
        request.addCSPSources(
          resolveTemplateCSPHashes(
            // Still a template at this point, so injectContent has yet to
            // resolve the CDN placeholder in it and any inline block
            // carrying one has to be held back rather than hashed here.
            await collectTemplateCSPHashes(template, {
              cdnPlaceholderPending: true,
            }),
            requestCDNBaseURL,
          ),
        );
      }

      // Load server entry using Vite's SSR loader (from src)
      const entryServer = await appConfig.viteDevServer.ssrLoadModule(
        appConfig.sourcePaths.serverEntry,
      );

      if (!entryServer.render || typeof entryServer.render !== 'function') {
        throw new Error("Server entry module must export a 'render' function");
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

      // Hashed once at startup, so this is a lookup rather than work,
      // except for any inline block carrying the CDN placeholder. Those
      // could not be hashed then, since the value they resolve to is
      // per request, so resolveTemplateCSPHashes settles them here. It
      // returns the cached object untouched when there are none, which is
      // the usual case.
      if (request.addCSPSources && appConfig.cachedTemplateCSPHashes) {
        request.addCSPSources(
          resolveTemplateCSPHashes(
            appConfig.cachedTemplateCSPHashes,
            requestCDNBaseURL,
          ),
        );
      }
    }

    // The render never sees a method that could run a route action, whatever
    // the caller intended.
    //
    // React Router's static handler runs the matched route's `action` for any
    // non-GET request, and route actions are not part of this framework's
    // model: page data loaders populate page content and mutations go through
    // API routes or page data handlers. Nothing should reach here with a
    // non-read method — the catch-all is registered `GET '*'`, and
    // `handleUnmatchedRequest` is the only other entry — so this is a
    // backstop, placed at the one point every render passes through rather
    // than trusting each caller. It coerces rather than throws so a future
    // path that gets here cannot run an action even once, and logs because a
    // silent coercion would hide the bug it exists to catch.
    const isReadMethod = request.method === 'GET' || request.method === 'HEAD';

    if (!isReadMethod && !isUnmatchedNonReadMethod) {
      request.log.error(
        {
          errorCode: 'ssr_render_non_read_method',
          method: request.method,
          url: request.url,
        },
        `A ${request.method} request reached SSR rendering. It was rendered as a GET so no route action could run. This is a unirend bug.`,
      );
    }

    // Create Fetch API Request object for React Router
    // Create Request object with appropriate data
    const fetchRequest = new Request(
      `${request.protocol}://${request.hostname}${request.url}`,
      {
        // No body is attached to this Request in any case, so nothing is
        // dropped by rendering a non-read method as a GET.
        method: isReadMethod ? request.method : 'GET',
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
          headers.set('X-SSR-Original-IP', request.clientIP);

          // Forward the resolved end-user user agent if needed
          if (request.clientUserAgent) {
            headers.set('X-SSR-Forwarded-User-Agent', request.clientUserAgent);
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
      controlledReply: createControlledReply(request, reply),
      handlers: this.pageDataHandlers,
      resolvePageDataRequestOptions:
        this.sharedOptions.resolvePageDataRequestOptions,
      serverFetch: pageDataServerFetch,
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
      (fetchRequest as unknown as { SSRHelpers?: SSRHelpers }).SSRHelpers =
        SSRHelpers;
    }

    // --- Render the App ---
    try {
      // Resolved once above, before the template's CSP hashes were
      // settled against it, so the value the components see through
      // useCDNBaseURL() is the same one those hashes were taken with.
      const CDNBaseURL = requestCDNBaseURL;

      const renderResult = await render({
        type: 'ssr',
        fetchRequest,
        unirendContext: {
          renderMode: 'ssr',
          isDevelopment: (
            request as FastifyRequest & { isDevelopment: boolean }
          ).isDevelopment,
          fetchRequest: fetchRequest,
          publicAppConfig: request.publicAppConfig,
          cdnBaseURL: normalizeCDNBaseURL(CDNBaseURL),
          domainInfo: request.domainInfo,
          requestContextRevision: '0-0', // Initial revision for this request
        },
      });

      if (renderResult.resultType === 'page') {
        // ---> Extract status code from render result
        //
        // A non-GET/HEAD request no route claimed is a 404 whatever the render
        // decided. The render ran as a GET, so for an unknown URL the app's own
        // 404 page already produced 404 and this changes nothing; the override
        // is what stops a POST to a URL that *does* render (a real page) coming
        // back 200.
        //
        // A 5xx is the exception, and the only one. The override exists to stop
        // a success or a redirect being invented for a request no route
        // claimed; a server error is neither invented nor a leak, it is a true
        // statement about this server. Masking it as 404 would hide a real
        // failure from whatever watches status codes, and would skip the
        // `statusCode === 500` branch below that hands the request to
        // `get500ErrorPage`. It also keeps the three result branches
        // consistent: a render that throws lands in `render-error` and answers
        // 500, so a render that reports the same failure by returning it should
        // not answer 404 instead.
        const renderedStatusCode = renderResult.statusCode || 200;
        const statusCode =
          isUnmatchedNonReadMethod && renderedStatusCode < 500
            ? 404
            : renderedStatusCode;

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
            renderResult.errorDetails || new Error('Internal Server Error');

          return await this.handleSSRError(request, reply, error, appConfig);
        }

        // --- Prepare head data for injection ---
        const headParts = [
          renderResult.head?.title || '',
          renderResult.head?.meta || '',
          renderResult.head?.link || '',
        ].filter(Boolean);

        const headInject = headParts.join('\n');

        const finalHTML = await injectContent(
          template,
          headInject,
          renderResult.html,
          {
            context: {
              app: request.publicAppConfig,
              // inject per-request context so client-side React hydrates with the same values
              request: request.requestContext,
            },
            CDNBaseURL,
            domainInfo: request.domainInfo,
            htmlAttrs: renderResult.head?.htmlAttrs,
            bodyAttrs: renderResult.head?.bodyAttrs,
            // Covers the inline content whose bytes are decided by this
            // render rather than by the template: anything the page
            // rendered itself, a React 19 hoistable `<style>` among the
            // likeliest, plus a React Router hydration script in a shape
            // injectContent declined to lift into the data block and so
            // passes through verbatim. The template hashes above were
            // contributed before rendering and cannot know about any of
            // it. Guarded on the same decoration they are, so a server
            // without a CSP does no work for it.
            addCSPSources: request.addCSPSources
              ? (sources) => request.addCSPSources?.(sources)
              : undefined,
          },
        );

        // ---> Send response with the extracted status code
        if (statusCode >= 400) {
          reply.header('Cache-Control', 'no-store');
        }

        // Return the HTML string instead of calling reply.send() directly.
        // In Fastify 5, async handlers that call reply.send() and return undefined
        // trigger wrapThenable to call reply.send(undefined) a second time
        // while any async onSend hook is still pending (reply.sent stays false
        // until headers are actually written). Returning the payload here lets
        // wrapThenable make exactly one reply.send() call.
        reply.code(statusCode).header('Content-Type', 'text/html');
        return finalHTML;
      } else if (renderResult.resultType === 'response') {
        // If React Router returned a Response (redirect/error as a response), handle it
        //
        // A `response` result is not only redirects: the type is a bare
        // `Response`, and a custom server entry may return any status through
        // it. So the unmatched non-read override applies here too, with no
        // exception for redirects.
        //
        // A redirect looks like the one status worth forwarding, and it is the
        // one that must not be. The render ran as a GET, but the *client* sent
        // a POST or a DELETE and that is what its redirect handling keys on.
        // A 307 or 308 tells it to repeat the original method and body at the
        // Location, so a loader redirecting an unknown URL would turn a POST
        // no route claimed into a POST, body included, against wherever that
        // Location points. 301 and 302 preserve the method for everything
        // except POST, so a DELETE follows as a DELETE. Rendering as a GET
        // stops an action running on this server and does nothing about what
        // the browser does next.
        //
        // Every non-read miss is therefore a plain 404, and the Location is
        // dropped below so nothing is left for a client to follow. A 5xx is
        // passed through for the same reason as on the page path above.
        const isForced404 =
          isUnmatchedNonReadMethod && renderResult.response.status < 500;

        const responseStatusCode = isForced404
          ? 404
          : renderResult.response.status;

        // Forward status and headers
        reply.code(responseStatusCode);

        // Apply no-store for all 4xx/5xx in SSR Response path
        if (responseStatusCode >= 400) {
          reply.header('Cache-Control', 'no-store');
        }

        // Forward headers safe for redirects/responses
        // Headers is iterable at runtime but TS DOM lib types don't expose entries(),
        // so we cast to the expected iterable shape for safe iteration.
        const responseHeaders = renderResult.response
          .headers as unknown as Iterable<[string, string]>;

        for (const [key, value] of Array.from(responseHeaders)) {
          const lowerKey = key.toLowerCase();

          // A forced 404 carries no destination. Forwarding Location here
          // would leave a redirect target on a response whose whole point is
          // that nothing handled the request. Set-Cookie still passes, the
          // same way it does on the page path.
          if (lowerKey === 'location' && isForced404) {
            continue;
          }

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

        // Return the body (or undefined for an intentionally empty
        // response) so wrapThenable makes exactly one reply.send() call.
        // See the page path above for why.
        try {
          const body = await renderResult.response.text();
          return body || undefined;
        } catch (bodyError) {
          request.log.error(
            {
              err: bodyError,
              method: request.method,
              url: request.url,
            },
            `[${this.serverLabel}] Error reading response body`,
          );

          // If we cannot read the body from a returned Response, treat it
          // as an internal server failure rather than silently ending the
          // request with an empty body under the original status code.
          return await this.handleSSRError(
            request,
            reply,
            bodyError instanceof Error
              ? bodyError
              : new Error('Failed to read response body'),
            appConfig,
          );
        }
      } else if (renderResult.resultType === 'render-error') {
        // Handle render errors
        return await this.handleSSRError(
          request,
          reply,
          renderResult.error,
          appConfig,
        );
      } else {
        // Handle unexpected result types (this should never happen with proper typing)
        // TypeScript knows this is never, but we handle it for runtime safety
        const resultType =
          (renderResult as { resultType?: string }).resultType || 'unknown';
        const unexpectedError = new Error(
          `Unexpected render result type: ${resultType}`,
        );

        return await this.handleSSRError(
          request,
          reply,
          unexpectedError,
          appConfig,
        );
      }
    } catch (error) {
      return await this.handleSSRError(
        request,
        reply,
        error as Error,
        appConfig,
      );
    }

    // Safety check - if we somehow reach here without sending a response
    if (!reply.sent && !reply.raw.headersSent) {
      this.fastifyInstance?.log.warn('No response was sent, sending 500 error');

      // Re-fetch appConfig for safety check (should always exist, but be defensive)
      const safetyAppKey = request.activeSSRApp || '__default__';
      const fallbackAppConfig =
        this.apps.get(safetyAppKey) || this.apps.get('__default__');

      if (!fallbackAppConfig) {
        // Ultimate fallback if even default app is missing
        reply.code(500).header('Content-Type', 'text/plain');
        return 'Internal Server Error';
      }

      // TypeScript doesn't narrow the type properly here, but we've verified it exists above
      return await this.handleSSRError(
        request,
        reply,
        new Error('No response was generated'),
        fallbackAppConfig as SSRInternalAppConfig,
      );
    }
  }

  /**
   * Handles API 404 not found responses with JSON envelopes.
   * Shares its resolution with APIServer so the two can never drift.
   * @param request The Fastify request object
   * @param reply The Fastify reply object
   * @private
   */
  private async handleAPINotFound(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<unknown> {
    // Returns the envelope instead of calling reply.send() directly.
    // The caller returns this value so wrapThenable makes exactly one reply.send() call.
    return resolveAPINotFoundResponse({
      ...this.notFoundResolutionConfig(),
      request,
      reply,
    });
  }
}

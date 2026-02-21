import type {
  FastifyRequest,
  FastifyLoggerOptions,
  FastifyBaseLogger,
  FastifyReply,
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifySchema,
  preHandlerHookHandler,
  FastifyInstance,
} from 'fastify';
import type { CookieSerializeOptions } from '@fastify/cookie';
import type { DataLoaderServerHandlerHelpers } from './internal/data-loader-server-handler-helpers';
import type {
  APIErrorResponse,
  PageErrorResponse,
  BaseMeta,
} from './api-envelope/api-envelope-types';
import type { UnirendContextValue } from './internal/UnirendContext';
// Reference type for pluggable API response helpers class
import type { APIResponseHelpers } from '../api-envelope';

export type RenderType = 'ssg' | 'ssr';
export type APIResponseHelpersClass = typeof APIResponseHelpers;

export interface RenderRequest {
  type: RenderType;
  fetchRequest: Request;
  /**
   * Unirend context value to provide to the app
   * Contains render mode, development status, and server request info
   * Always provided by SSRServer or SSG
   */
  unirendContext: UnirendContextValue;
}

/**
 * Helper object attached to SSR Fetch Request for server-only context
 */
export interface SSRHelpers {
  fastifyRequest: FastifyRequest;
  /** Controlled reply to allow handlers to set headers/cookies in short-circuit path */
  controlledReply: ControlledReply;
  handlers: DataLoaderServerHandlerHelpers;
  /** True when SSR server is running in development mode */
  isDevelopment?: boolean;
}

/**
 * Helper object attached to SSG Fetch Request for build-time context
 * Similar to SSRHelpers but simplified for static generation
 */
export interface SSGHelpers {
  /** Request context object that can be populated and injected into the page */
  requestContext: Record<string, unknown>;
}

/**
 * Base interface for render results with a discriminated union type
 */
interface RenderResultBase {
  resultType: 'page' | 'response' | 'render-error';
}

/**
 * Page result containing HTML content
 */
export interface RenderPageResult extends RenderResultBase {
  resultType: 'page';
  html: string;
  preloadLinks: string;
  helmet?: {
    title: { toString(): string };
    meta: { toString(): string };
    link: { toString(): string };
  };
  statusCode?: number;
  errorDetails?: Error;
  ssOnlyData?: Record<string, unknown>;
}

/**
 * Response result wrapping a standard Response object
 * Used for redirects, errors, or any other non-HTML responses
 */
export interface RenderResponseResult extends RenderResultBase {
  resultType: 'response';
  response: Response;
}

/**
 * Error result containing error information
 * Used when rendering fails with an exception
 */
export interface RenderErrorResult extends RenderResultBase {
  resultType: 'render-error';
  error: Error;
}

/**
 * Union type for all possible render results
 */
export type RenderResult =
  | RenderPageResult
  | RenderResponseResult
  | RenderErrorResult;

/**
 * Required paths for SSR development server
 */
export interface SSRDevPaths {
  /** Path to the server entry file (e.g. "./src/entry-server.tsx") */
  serverEntry: string;
  /** Path to the HTML template file (e.g. "./index.html") */
  template: string;
  /** Path to the Vite config file (e.g. "./vite.config.ts") */
  viteConfig: string;
}

/**
 * Plugin metadata returned by plugins for dependency tracking and cleanup
 */
export interface PluginMetadata {
  /** Unique name for this plugin */
  name: string;
  /** Plugin dependencies - other plugin names that must be registered first */
  dependsOn?: string | string[];
}

/**
 * Plugin registration function type
 * Plugins get access to a controlled subset of Fastify functionality
 * Can optionally return metadata for dependency tracking
 */
export type ServerPlugin = (
  pluginHost: PluginHostInstance,
  options: PluginOptions,
) => Promise<PluginMetadata | void> | PluginMetadata | void;

/**
 * Fastify hook names that plugins can register
 * Includes common lifecycle hooks plus string for custom hooks
 */
export type FastifyHookName = Parameters<FastifyInstance['addHook']>[0];

/**
 * Controlled Fastify instance interface for plugins
 * Exposes safe methods while preventing access to destructive operations
 */
export interface PluginHostInstance {
  /** Register plugins and middleware */
  register: <Options extends Record<string, unknown> = Record<string, never>>(
    plugin: FastifyPluginAsync<Options> | FastifyPluginCallback<Options>,
    opts?: Options,
  ) => Promise<void>;
  /** Add custom hooks */
  addHook: (
    hookName: FastifyHookName,
    handler: (
      request: FastifyRequest,
      reply: FastifyReply,
      ...args: unknown[]
    ) => void | Promise<unknown>,
  ) => void;
  /** Add decorators to request/reply objects */
  decorate: (property: string, value: unknown) => void;
  decorateRequest: (property: string, value: unknown) => void;
  decorateReply: (property: string, value: unknown) => void;
  /** Read-only accessors for server-level decorations */
  hasDecoration: (property: string) => boolean;
  getDecoration: <T = unknown>(property: string) => T | undefined;
  /** Access to route registration with constraints */
  route: (opts: SafeRouteOptions) => void;
  get: (path: string, handler: RouteHandler) => void;
  post: (path: string, handler: RouteHandler) => void;
  put: (path: string, handler: RouteHandler) => void;
  delete: (path: string, handler: RouteHandler) => void;
  patch: (path: string, handler: RouteHandler) => void;
  /** API route registration shortcuts method for versioned endpoints */
  api?: unknown;
  /** Page data loader handler registration method for page data endpoints */
  pageDataHandler?: unknown;
}

/**
 * Controlled reply surface available to handlers.
 * Allows setting headers and cookies without giving full reply control.
 *
 * Used by page data loader handlers, API route handlers, and processFileUpload().
 * Provides limited access to prevent handlers from prematurely sending responses
 * or bypassing the framework's envelope pattern.
 */
export interface ControlledReply {
  /** Set a response header (content-type may be enforced by framework) */
  header: (name: string, value: string) => void;
  /** Set a cookie if @fastify/cookie is registered */
  setCookie?: (
    name: string,
    value: string,
    options?: CookieSerializeOptions,
  ) => void;
  /** Alias for setCookie if @fastify/cookie is registered */
  cookie?: (
    name: string,
    value: string,
    options?: CookieSerializeOptions,
  ) => void;
  /** Clear a cookie if @fastify/cookie is registered */
  clearCookie?: (name: string, options?: CookieSerializeOptions) => void;
  /** Verify and unsign a cookie value if @fastify/cookie is registered */
  unsignCookie?: (
    value: string,
  ) =>
    | { valid: true; renew: boolean; value: string }
    | { valid: false; renew: false; value: null };
  /** Sign a cookie value if @fastify/cookie is registered */
  signCookie?: (value: string) => string;
  /** Read a response header value (if available) */
  getHeader: (name: string) => string | number | string[] | undefined;
  /** Read all response headers as a plain object */
  getHeaders: () => Record<string, unknown>;
  /** Remove a response header by name */
  removeHeader: (name: string) => void;
  /** Check if a response header has been set */
  hasHeader: (name: string) => boolean;
  /** Whether the reply has already been sent */
  sent: boolean;
  /**
   * Access to the underlying response stream (for connection monitoring)
   *
   * Limited scope: Only used internally by processFileUpload() for detecting
   * broken connections during file uploads. Most handlers won't need this
   */
  raw: {
    /** Whether the underlying connection has been destroyed */
    destroyed: boolean;
  };
  /**
   * Internal: Send an error envelope response and terminate the request early
   * Used internally by APIResponseHelpers.sendErrorResponse()
   *
   * @internal
   * Users should call APIResponseHelpers.sendErrorResponse() instead of calling this directly.
   *
   * @param statusCode - HTTP status code to send
   * @param errorEnvelope - Error envelope object to send as JSON response
   */
  _sendErrorEnvelope: (
    statusCode: number,
    errorEnvelope: APIErrorResponse<BaseMeta> | PageErrorResponse<BaseMeta>,
  ) => void;
}

/**
 * Safe route options that prevent catch-all conflicts
 */
export interface SafeRouteOptions {
  method: string | string[];
  url: string;
  handler: RouteHandler;
  preHandler?: preHandlerHookHandler | preHandlerHookHandler[];
  schema?: FastifySchema;
  config?: unknown;
  constraints?: {
    /** Only allow specific hosts, no wildcards that could conflict with SSR */
    host?: string;
    /** Only allow specific versions */
    version?: string;
  };
}

export type RouteHandler = (
  request: FastifyRequest,
  reply: FastifyReply,
) => void | Promise<unknown>;

/**
 * WebSocket server configuration options
 */
export interface WebSocketOptions {
  /**
   * Enable/disable permessage-deflate compression
   * @default false
   */
  perMessageDeflate?: boolean;
  /**
   * The maximum allowed message size in bytes
   * @default 100 * 1024 * 1024 (100MB)
   */
  maxPayload?: number;
  /**
   * Custom handler called when the WebSocket server is closing
   * Provides access to all connected clients for graceful shutdown
   * @param clients Set of all connected WebSocket clients
   * @returns Promise that resolves when cleanup is complete
   */
  preClose?: (clients: Set<unknown>) => Promise<void>;
}

/**
 * Shared configuration for versioned API endpoint groups
 * Used by helpers that register versioned endpoints (page data, generic API routes, etc.)
 */
export interface APIEndpointConfig {
  /**
   * Endpoint prefix that comes before version/endpoint (default: "/api")
   * Set to `false` to disable API handling (server becomes a plain web server)
   */
  apiEndpointPrefix?: string | false;
  /** Whether to enable versioning (default: true) */
  versioned?: boolean;
  /** Base endpoint name for page data loader handlers (default: "page_data"). Used by SSR/APIServer's page-data registration only. */
  pageDataEndpoint?: string;
}

/**
 * Plugin options passed to each plugin
 *
 * Environment information available at plugin registration time.
 *
 * Notes:
 * - Use these fields inside your plugin setup to decide what to REGISTER
 *   (e.g., which routes, which hooks). This is registration-time context.
 * - For per-request branching inside handlers/middleware, read
 *   `request.isDevelopment` (decorated by the servers). Both reflect the same
 *   underlying mode; they serve different scopes.
 */
export interface PluginOptions {
  /** Type of server the plugin is running on */
  serverType: 'ssr' | 'api';
  /** Server mode (development or production) */
  mode: 'development' | 'production';
  /** Whether running in development mode */
  isDevelopment: boolean;
  /** Build directory (SSR only, undefined for API server) */
  buildDir?: string;
  /** API endpoints configuration from the server */
  apiEndpoints?: APIEndpointConfig;
}

/**
 * Log levels supported by the Unirend logger adapter.
 */
export type UnirendLoggerLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal';

/**
 * Logger function signature used by Unirend logger object methods.
 */
export type UnirendLoggerFunction = (
  message: string,
  context?: Record<string, unknown>,
) => void;

/**
 * Framework-level logger object that Unirend adapts to Fastify's logger interface.
 */
export interface UnirendLoggerObject {
  trace: UnirendLoggerFunction;
  debug: UnirendLoggerFunction;
  info: UnirendLoggerFunction;
  warn: UnirendLoggerFunction;
  error: UnirendLoggerFunction;
  fatal: UnirendLoggerFunction;
}

/**
 * High-level logging options that Unirend can adapt to Fastify.
 */
export interface UnirendLoggingOptions {
  /**
   * Logger object used by Unirend and adapted to Fastify under the hood.
   */
  logger: UnirendLoggerObject;
  /**
   * Initial minimum level used by the adapter.
   * @default "info"
   */
  level?: UnirendLoggerLevel;
}

/**
 * Base options for SSR
 * @template M Custom meta type extending BaseMeta for error/notFound handlers
 */
interface ServeSSROptions<M extends BaseMeta = BaseMeta> {
  /**
   * ID of the container element (defaults to "root")
   * This element will be formatted inline to prevent hydration issues
   */
  containerID?: string;
  /**
   * Optional configuration object to be injected into the frontend app.
   * Serialized and injected as window.__FRONTEND_APP_CONFIG__ during SSR.
   * Available via useFrontendAppConfig() hook on both server and client.
   *
   * Keep this minimal and non-sensitive; it will be passed to the client.
   *
   * See README section "4. Frontend App Config Pattern" for usage in components,
   * loaders, fallback patterns, and SPA-only dev mode considerations.
   */
  frontendAppConfig?: Record<string, unknown>;
  /**
   * Cookie forwarding controls for SSR
   *
   * Controls which cookies are forwarded:
   * - from client request → SSR loaders (via the Fetch `Cookie` header)
   * - from backend/server → client (via `Set-Cookie` headers)
   *
   * Behavior:
   * - If both arrays are empty or undefined, all cookies are allowed
   * - If `allowCookieNames` is non-empty, only cookies with those names are allowed
   * - `blockCookieNames` is always applied and will block those cookies even if in allow list
   */
  cookieForwarding?: {
    /**
     * Cookie names that are allowed to be forwarded.
     * If provided and non-empty, only these cookie names will be forwarded.
     */
    allowCookieNames?: string[];
    /**
     * Cookie names that must never be forwarded (takes precedence over allow list).
     *
     * You can also set this to `true` to block ALL cookies from being forwarded.
     * When `true`, no cookies will be forwarded regardless of `allowCookieNames`.
     */
    blockCookieNames?: string[] | true;
  };
  /**
   * Array of plugins to register with the server
   * Plugins get access to a controlled Fastify instance
   */
  plugins?: ServerPlugin[];
  /**
   * Override the helpers used to construct API/Page envelopes.
   * Provide your own class (subclassing `APIResponseHelpers` recommended) to
   * inject default metadata or behavior. If not provided, the default
   * `APIResponseHelpers` will be used.
   */
  APIResponseHelpersClass?: APIResponseHelpersClass;
  /**
   * Configuration for versioned API endpoints (shared by page data and generic API routes)
   * For page data loader handler endpoints, set pageDataEndpoint (default: "page_data")
   */
  apiEndpoints?: APIEndpointConfig;
  /**
   * File upload configuration
   * When enabled, multipart file upload support will be available
   * Allows use of processFileUpload() in your plugins
   */
  fileUploads?: FileUploadsConfig;
  /**
   * Name of the client folder within buildDir
   * Defaults to "client" if not provided
   */
  clientFolderName?: string;
  /**
   * Name of the server folder within buildDir
   * Defaults to "server" if not provided
   */
  serverFolderName?: string;
  /**
   * Custom 500 error page handler
   * Called when SSR rendering fails with an error
   * @param request The Fastify request object
   * @param error The error that occurred
   * @param isDevelopment Whether running in development mode
   * @returns HTML string for the error page
   */
  get500ErrorPage?: (
    request: FastifyRequest,
    error: Error,
    isDevelopment: boolean,
  ) => string | Promise<string>;
  /**
   * Custom error/not-found handlers for mixed SSR+API servers
   * These handlers return JSON envelope responses instead of HTML error pages
   * for requests matching the apiEndpoints.apiEndpointPrefix
   */
  APIHandling?: {
    /**
     * Custom error handler for API routes
     * Called when an unhandled error occurs in API routes
     *
     * REQUIRED: Must return a proper API or Page envelope response according to api-envelope-structure.md
     * - For API requests (isPageData=false): Return APIErrorResponse envelope
     * - For Page requests (isPageData=true): Return PageErrorResponse envelope
     *
     * Params: (request, error, isDevelopment, isPageData)
     * - request: The Fastify request object
     * - error: The error that occurred
     * - isDevelopment: Whether running in development mode
     * - isPageData: Whether this is a page-data request (e.g., /api/v1/page_data/home)
     *
     * Required envelope return fields:
     * - status: "error"
     * - status_code: HTTP status code (400, 401, 404, 500, etc.)
     * - request_id: Unique request identifier
     * - type: "api" for API requests, "page" for page data requests
     * - data: null (always null for error responses)
     * - meta: Object containing metadata (page metadata required for page type)
     * - error: Object with { code, message, details? }
     */
    errorHandler?: APIErrorHandlerFn<M>;
    /**
     * Custom handler for API requests that did not match any route (404)
     * If provided, overrides the built-in envelope handler for API routes
     *
     * REQUIRED: Must return a proper API or Page envelope response according to api-envelope-structure.md
     * - For API requests (isPageData=false): Return APIErrorResponse envelope with status_code: 404
     * - For Page requests (isPageData=true): Return PageErrorResponse envelope with status_code: 404
     *
     * Params: (request, isPageData)
     * - request: The Fastify request object
     * - isPageData: Whether this is a page-data request (e.g., /api/v1/page_data/home)
     *
     * Required envelope return fields:
     * - status: "error"
     * - status_code: 404
     * - request_id: Unique request identifier
     * - type: "api" for API requests, "page" for page data requests
     * - data: null (always null for error responses)
     * - meta: Object containing metadata (page metadata required for page type)
     * - error: Object with { code: "not_found", message, details? }
     */
    notFoundHandler?: APINotFoundHandlerFn<M>;
  };
  /**
   * Enable WebSocket support on the server
   * @default false
   */
  enableWebSockets?: boolean;
  /**
   * WebSocket server configuration options
   * Only used when enableWebSockets is true
   */
  webSocketOptions?: WebSocketOptions;
  /**
   * Curated Fastify options for SSR server configuration
   * Only exposes safe options that won't conflict with SSR setup
   */
  fastifyOptions?: {
    /**
     * Enable/configure Fastify logging
     * @example true | false | { level: 'info' } | { level: 'warn', prettyPrint: true }
     */
    logger?: boolean | FastifyLoggerOptions;
    /**
     * Custom Fastify logger instance (e.g. pino-compatible logger).
     * When provided, this is passed to Fastify as `loggerInstance`.
     */
    loggerInstance?: FastifyBaseLogger;
    /**
     * Disable Fastify automatic request lifecycle logging (`incoming request` / `request completed`).
     * This only applies when logging is enabled.
     * @default false
     */
    disableRequestLogging?: boolean;
    /**
     * Trust proxy headers (useful for deployment behind load balancers)
     * @default false
     */
    trustProxy?: boolean | string | string[] | number;
    /**
     * Maximum request body size in bytes
     * @default 1048576 (1MB)
     */
    bodyLimit?: number;
    /**
     * Keep-alive timeout in milliseconds
     * @default 72000 (72 seconds)
     */
    keepAliveTimeout?: number;
  };
  /**
   * Framework-level logging options adapted to Fastify under the hood.
   *
   * Note: Cannot be used together with `fastifyOptions.logger` or
   * `fastifyOptions.loggerInstance`.
   */
  logging?: UnirendLoggingOptions;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ServeSSRDevOptions<
  M extends BaseMeta = BaseMeta,
> extends ServeSSROptions<M> {
  // Currently no development-specific options
  // This is a placeholder for any future development-specific options
}

export interface ServeSSRProdOptions<
  M extends BaseMeta = BaseMeta,
> extends ServeSSROptions<M> {
  /**
   * Name of the server entry file to look for in the Vite manifest
   * Defaults to "entry-server" if not provided
   */
  serverEntry?: string;
  /**
   * Configuration for the static file router middleware
   * Used to serve static assets in production mode
   *
   * - If not provided: defaults will be used based on the build directory
   * - If set to `false`: static router will be disabled (useful for CDN setups)
   * - If set to an object: custom configuration will be used
   */
  staticContentRouter?: StaticContentRouterOptions | false;
}

// ============================================================================
// API Server Types
// ============================================================================

/**
 * Response type for web (non-API) error handlers
 * Similar to InvalidDomainResponse from domainValidation plugin
 */
export interface WebErrorResponse {
  /** Content type for the response */
  contentType: 'html' | 'text' | 'json';
  /** Response content - string for html/text, object for json */
  content: string | object;
  /** HTTP status code (defaults to 500 for errors, 404 for not found) */
  statusCode?: number;
}

/**
 * Error handler function type for API/page requests
 */
export type APIErrorHandlerFn<M extends BaseMeta = BaseMeta> = (
  request: FastifyRequest,
  error: Error,
  isDevelopment: boolean,
  isPageData?: boolean,
) =>
  | APIErrorResponse<M>
  | PageErrorResponse<M>
  | Promise<APIErrorResponse<M> | PageErrorResponse<M>>;

/**
 * Error handler function type for web (non-API) requests
 */
export type WebErrorHandlerFn = (
  request: FastifyRequest,
  error: Error,
  isDevelopment: boolean,
) => WebErrorResponse | Promise<WebErrorResponse>;

/**
 * Not found handler function type for API/page requests
 */
export type APINotFoundHandlerFn<M extends BaseMeta = BaseMeta> = (
  request: FastifyRequest,
  isPageData?: boolean,
) =>
  | APIErrorResponse<M>
  | PageErrorResponse<M>
  | Promise<APIErrorResponse<M> | PageErrorResponse<M>>;

/**
 * Not found handler function type for web (non-API) requests
 */
export type WebNotFoundHandlerFn = (
  request: FastifyRequest,
) => WebErrorResponse | Promise<WebErrorResponse>;

/**
 * Split error handler with separate API and web handlers
 * @template M Custom meta type extending BaseMeta for API handlers
 */
export interface SplitErrorHandler<M extends BaseMeta = BaseMeta> {
  /** Handler for API requests (paths matching apiEndpointPrefix) */
  api: APIErrorHandlerFn<M>;
  /** Handler for web requests (non-API paths) */
  web: WebErrorHandlerFn;
}

/**
 * Split not found handler with separate API and web handlers
 * @template M Custom meta type extending BaseMeta for API handlers
 */
export interface SplitNotFoundHandler<M extends BaseMeta = BaseMeta> {
  /** Handler for API requests (paths matching apiEndpointPrefix) */
  api: APINotFoundHandlerFn<M>;
  /** Handler for web requests (non-API paths) */
  web: WebNotFoundHandlerFn;
}

/**
 * Options for configuring the API server
 * @template M Custom meta type extending BaseMeta for error/notFound handlers
 */
export interface APIServerOptions<M extends BaseMeta = BaseMeta> {
  /**
   * Array of plugins to register with the server
   * Plugins get access to a controlled Fastify instance with full wildcard support
   */
  plugins?: ServerPlugin[];
  /**
   * Override the helpers used to construct API/Page envelopes.
   * Provide your own class (subclassing `APIResponseHelpers` recommended) to
   * inject default metadata or behavior. If not provided, the default
   * `APIResponseHelpers` will be used.
   */
  APIResponseHelpersClass?: APIResponseHelpersClass;
  /**
   * Configuration for versioned API endpoints (shared by page data and generic API routes)
   * For page data loader handler endpoints, set pageDataEndpoint (default: "page_data")
   */
  apiEndpoints?: APIEndpointConfig;
  /**
   * File upload configuration
   * When enabled, multipart file upload support will be available
   * Allows use of processFileUpload() in your plugins
   */
  fileUploads?: FileUploadsConfig;
  /**
   * Custom error handler for server errors
   *
   * Can be either:
   * 1. A function (handles all requests the same way - JSON envelope)
   * 2. An object with separate `api` and `web` handlers for split behavior
   *
   * Function form (same signature as SSR APIHandling.errorHandler):
   * - Must return API or Page envelope response (see api-envelope-structure.md)
   * - Used for pure API servers
   *
   * Object form (for mixed API + web servers):
   * - `api`: Handles API requests (paths matching apiEndpointPrefix)
   *   Params: (request, error, isDevelopment, isPageData)
   *   - request: The Fastify request object
   *   - error: The error that occurred
   *   - isDevelopment: Whether running in development mode
   *   - isPageData: Whether this is a page-data request (e.g., /api/v1/page_data/home)
   *   Required envelope return fields:
   *   - status: "error"
   *   - status_code: HTTP status code (400, 401, 404, 500, etc.)
   *   - request_id: Unique request identifier
   *   - type: "api" for API requests, "page" for page data requests
   *   - data: null (always null for error responses)
   *   - meta: Object containing metadata (page metadata required for page type)
   *   - error: Object with { code, message, details? }
   * - `web`: Handles non-API requests
   *   Params: (request, error, isDevelopment)
   *   - request: The Fastify request object
   *   - error: The error that occurred
   *   - isDevelopment: Whether running in development mode
   *   Required WebErrorResponse return fields:
   *   - contentType: 'html' | 'text' | 'json'
   *   - content: string for html/text, object for json
   *   - statusCode?: HTTP status code (defaults to 500)
   *
   * @example Function form
   * errorHandler: (request, error, isDev, isPageData) =>
   *   APIResponseHelpers.createAPIErrorResponse({ request, statusCode: 500, ... })
   *
   * @example Object form
   * errorHandler: {
   *   api: (request, error, isDev, isPageData) => APIResponseHelpers.createAPIErrorResponse({ ... }),
   *   web: (request, error, isDev) => ({ contentType: 'html', content: '<h1>Error</h1>' })
   * }
   */
  errorHandler?: APIErrorHandlerFn<M> | SplitErrorHandler<M>;
  /**
   * Custom handler for requests that did not match any route (404)
   * If provided, overrides the built-in envelope handler.
   *
   * Can be either:
   * 1. A function (handles all requests the same way - JSON envelope)
   * 2. An object with separate `api` and `web` handlers for split behavior
   *
   * Function form (same signature as SSR APIHandling.notFoundHandler):
   * - Must return API or Page envelope response with status_code: 404 (see api-envelope-structure.md)
   * - Used for pure API servers
   *
   * Object form (for mixed API + web servers):
   * - `api`: Handles API requests (paths matching apiEndpointPrefix)
   *   Params: (request, isPageData)
   *   - request: The Fastify request object
   *   - isPageData: Whether this is a page-data request (e.g., /api/v1/page_data/home)
   *   Required envelope return fields:
   *   - status: "error"
   *   - status_code: 404
   *   - request_id: Unique request identifier
   *   - type: "api" for API requests, "page" for page data requests
   *   - data: null (always null for error responses)
   *   - meta: Object containing metadata (page metadata required for page type)
   *   - error: Object with { code: "not_found", message, details? }
   * - `web`: Handles non-API requests
   *   Params: (request)
   *   - request: The Fastify request object
   *   Required WebErrorResponse return fields:
   *   - contentType: 'html' | 'text' | 'json'
   *   - content: string for html/text, object for json
   *   - statusCode?: HTTP status code (defaults to 404)
   *
   * @example Function form
   * notFoundHandler: (request, isPageData) =>
   *   APIResponseHelpers.createAPIErrorResponse({ request, statusCode: 404, ... })
   *
   * @example Object form
   * notFoundHandler: {
   *   api: (request, isPageData) => APIResponseHelpers.createAPIErrorResponse({ ... }),
   *   web: (request) => ({ contentType: 'html', content: '<h1>404 Not Found</h1>' })
   * }
   */
  notFoundHandler?: APINotFoundHandlerFn<M> | SplitNotFoundHandler<M>;
  /**
   * Whether to run in development mode
   * Affects error reporting and logging behavior
   * @default false
   */
  isDevelopment?: boolean;
  /**
   * Enable WebSocket support on the server
   * @default false
   */
  enableWebSockets?: boolean;
  /**
   * WebSocket server configuration options
   * Only used when enableWebSockets is true
   */
  webSocketOptions?: WebSocketOptions;
  /**
   * Curated Fastify options for API server configuration
   * Only exposes safe options that won't conflict with API setup
   */
  fastifyOptions?: {
    /**
     * Enable/configure Fastify logging
     * @example true | false | { level: 'info' } | { level: 'warn', prettyPrint: true }
     */
    logger?: boolean | FastifyLoggerOptions;
    /**
     * Custom Fastify logger instance (e.g. pino-compatible logger).
     * When provided, this is passed to Fastify as `loggerInstance`.
     */
    loggerInstance?: FastifyBaseLogger;
    /**
     * Disable Fastify automatic request lifecycle logging (`incoming request` / `request completed`).
     * This only applies when logging is enabled.
     * @default false
     */
    disableRequestLogging?: boolean;
    /**
     * Trust proxy headers (useful for deployment behind load balancers)
     * @default false
     */
    trustProxy?: boolean | string | string[] | number;
    /**
     * Maximum request body size in bytes
     * @default 1048576 (1MB)
     */
    bodyLimit?: number;
    /**
     * Keep-alive timeout in milliseconds
     * @default 72000 (72 seconds)
     */
    keepAliveTimeout?: number;
  };
  /**
   * Framework-level logging options adapted to Fastify under the hood.
   *
   * Note: Cannot be used together with `fastifyOptions.logger` or
   * `fastifyOptions.loggerInstance`.
   */
  logging?: UnirendLoggingOptions;
}

/**
 * Object logger for the SSG process.
 * This is separate from Fastify's logger configuration.
 */
export interface SSGLogger {
  /** Log info messages */
  info: (message: string) => void;
  /** Log warning messages */
  warn: (message: string) => void;
  /** Log error messages */
  error: (message: string) => void;
}

/**
 * Pre-built console logger for SSG with prefixed messages
 * Use this if you want basic console logging during SSG
 */
export const SSGConsoleLogger: SSGLogger = {
  // eslint-disable-next-line no-console
  info: (message: string) => console.log(`[SSG Info] ${message}`),
  // eslint-disable-next-line no-console
  warn: (message: string) => console.warn(`[SSG Warn] ${message}`),
  // eslint-disable-next-line no-console
  error: (message: string) => console.error(`[SSG Error] ${message}`),
};

/**
 * Options for Static Site Generation
 */
export interface SSGOptions {
  /**
   * Optional configuration object to be injected into the frontend app.
   * Serialized and injected as window.__FRONTEND_APP_CONFIG__ during SSG.
   * Available via useFrontendAppConfig() hook on both server and client.
   *
   * Keep this minimal and non-sensitive; it will be passed to the client.
   *
   * See README section "4. Frontend App Config Pattern" for usage in components,
   * loaders, fallback patterns, and SPA-only dev mode considerations.
   */
  frontendAppConfig?: Record<string, unknown>;
  /**
   * ID of the container element (defaults to "root")
   * This element will be formatted inline to prevent hydration issues
   */
  containerID?: string;
  /**
   * Name of the server entry file to look for in the Vite manifest
   * Defaults to "entry-server" if not provided
   */
  serverEntry?: string;
  /**
   * Optional logger for the SSG process
   * Defaults to console if not provided
   */
  logger?: SSGLogger;
  /**
   * Name of the client folder within buildDir
   * Defaults to "client" if not provided
   */
  clientFolderName?: string;
  /**
   * Name of the server folder within buildDir
   * Defaults to "server" if not provided
   */
  serverFolderName?: string;
  /**
   * Filename for a JSON file mapping URL paths to generated filenames.
   * Written to buildDir (e.g., `buildDir/page-map.json`).
   *
   * Useful for server code that needs to dynamically serve clean URLs
   * (e.g., `/about` → `about.html`) without hardcoding or configuring rewrites.
   *
   * Serving the correct file matters for React hydration — even a subtle mismatch
   * like `/about` vs `/about.html` can cause hydration errors if the wrong file is served.
   *
   * The generated file contains a simple object mapping paths to filenames:
   * ```json
   * {
   *   "/": "index.html",
   *   "/about": "about.html"
   * }
   * ```
   *
   * If not provided, no page map file is written.
   */
  pageMapOutput?: string;
}

/**
 * Base interface for pages to be generated
 */
export interface GeneratorPageBase {
  /** The output filename for the generated HTML */
  filename: string;
}

/**
 * SSG page - server-side rendered at build time
 */
export interface SSGPageType extends GeneratorPageBase {
  /** Type of page generation */
  type: 'ssg';
  /** The URL path for the page (required for SSG) */
  path: string;
}

/**
 * SPA page - client-side rendered with custom metadata
 */
export interface SPAPageType extends GeneratorPageBase {
  /** Type of page generation */
  type: 'spa';
  /** Custom title for the SPA page */
  title?: string;
  /** Custom meta description for the SPA page */
  description?: string;
  /** Additional meta tags as key-value pairs */
  meta?: Record<string, string>;
  /** Optional request context to inject into the page (available as window.__FRONTEND_REQUEST_CONTEXT__) */
  requestContext?: Record<string, unknown>;
}

/**
 * Union type for all page types
 */
export type PageTypeWanted = SSGPageType | SPAPageType;

/**
 * Status code for a generated page
 */
export type SSGPageStatus = 'success' | 'not_found' | 'error';

/**
 * Report for a single generated page
 */
export interface SSGPageReport {
  /** The page that was processed */
  page: PageTypeWanted;
  /** Status of the generation */
  status: SSGPageStatus;
  /** Full path to the generated file (if successful) */
  outputPath?: string;
  /** Error details (if status is 'error') */
  errorDetails?: string;
  /** Time taken to generate the page in milliseconds */
  timeMS: number;
}

/**
 * Collection of page reports for the SSG process
 */
export interface SSGPagesReport {
  /** Reports for each page */
  pages: SSGPageReport[];
  /** Total number of pages processed */
  totalPages: number;
  /** Number of successfully generated pages */
  successCount: number;
  /** Number of pages with errors */
  errorCount: number;
  /** Number of pages not found (404) */
  notFoundCount: number;
  /** Total time taken for the entire generation process in milliseconds */
  totalTimeMS: number;
  /** Directory where files were generated */
  buildDir: string;
}

/**
 * Complete report for the SSG process, including potential fatal errors
 */
export interface SSGReport {
  /** Fatal error if the process failed before page generation */
  fatalError?: Error;
  /** Page generation reports (always present, even on error) */
  pagesReport: SSGPagesReport;
}

/**
 * Configuration for multipart file upload support
 * When provided, the server will automatically enable multipart uploads
 */
export interface FileUploadsConfig {
  /**
   * Whether to enable file upload support
   * When true, multipart upload support will be enabled automatically
   * @default false
   */
  enabled: boolean;
  /**
   * Global limits for file uploads (can be overridden per-route)
   * These act as maximum limits for security
   */
  limits?: {
    /**
     * Maximum file size in bytes
     * @default 10485760 (10MB)
     */
    fileSize?: number;
    /**
     * Maximum number of files per request
     * @default 10
     */
    files?: number;
    /**
     * Maximum number of form fields
     * @default 10
     */
    fields?: number;
    /**
     * Maximum size of form field values in bytes
     * @default 1024 (1KB)
     */
    fieldSize?: number;
  };
  /**
   * Optional: List of routes/patterns that allow multipart uploads
   * When provided, a preHandler hook will reject multipart requests to other routes
   * This prevents bandwidth waste and potential DoS attacks
   *
   * Supports exact matches and wildcard patterns.
   * Use asterisk (*) to match any path segment (e.g. /api/upload/workspace/*)
   *
   * @example
   * allowedRoutes: ['/api/upload/avatar', '/api/upload/document']
   */
  allowedRoutes?: string[];
  /**
   * Optional: Pre-validation function that runs BEFORE multipart parsing
   * Use this to reject requests early based on headers (auth, rate limiting, etc.)
   * This saves bandwidth by rejecting before any file data is parsed
   *
   * Supports both synchronous and asynchronous validation functions
   * Return true to allow the request, or an error response object to reject it
   *
   * @example
   * // Async validation
   * preValidation: async (request) => {
   *   const token = request.headers.authorization;
   *   if (!token) {
   *     return { statusCode: 401, error: 'unauthorized', message: 'Auth required' };
   *   }
   *   return true; // Allow request to proceed
   * }
   *
   * @example
   * // Sync validation
   * preValidation: (request) => {
   *   if (!request.headers['x-api-key']) {
   *     return { statusCode: 403, error: 'forbidden', message: 'API key required' };
   *   }
   *   return true;
   * }
   */
  preValidation?: (
    request: FastifyRequest,
  ) =>
    | Promise<true | { statusCode: number; error: string; message: string }>
    | true
    | { statusCode: number; error: string; message: string };
}

/**
 * Configuration for a folder in the static router folderMap
 */
export interface FolderConfig {
  /** Path to the directory */
  path: string;
  /** Whether to detect and use immutable caching for fingerprinted assets */
  detectImmutableAssets?: boolean;
}

/**
 * Options for the static router middleware
 * Used to serve static files in production SSR mode
 */
export interface StaticContentRouterOptions {
  /** Exact URL → absolute file path (optional) */
  singleAssetMap?: Record<string, string>;
  /** URL prefix → absolute directory path (as string) or folder config object */
  folderMap?: Record<string, string | FolderConfig>;
  /** Maximum size (in bytes) for hashing & in-memory caching; default 5 MB */
  smallFileMaxSize?: number;
  /** Maximum number of entries in ETag/content caches; default 100 */
  cacheEntries?: number;
  /** Maximum total memory size (in bytes) for content cache; default 50 MB */
  contentCacheMaxSize?: number;
  /** Maximum number of entries in the stat cache; default 250 */
  statCacheEntries?: number;
  /** TTL in milliseconds for negative stat cache entries; default 30 seconds */
  negativeCacheTtl?: number;
  /** TTL in milliseconds for positive stat cache entries; default 1 hour */
  positiveCacheTtl?: number;
  /** Custom Cache-Control header; default 'public, max-age=0, must-revalidate' */
  cacheControl?: string;
  /** Cache-Control header for immutable fingerprinted assets; default 'public, max-age=31536000, immutable' */
  immutableCacheControl?: string;
}

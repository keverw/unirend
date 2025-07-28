export type renderType = "ssg" | "ssr";
import type {
  FastifyRequest,
  FastifyLoggerOptions,
  FastifyReply,
  FastifyPluginAsync,
  FastifyPluginCallback,
  FastifySchema,
  preHandlerHookHandler,
} from "fastify";

export interface IRenderRequest {
  type: renderType;
  fetchRequest: Request;
}

/**
 * Base interface for render results with a discriminated union type
 */
interface IRenderResultBase {
  resultType: "page" | "response" | "render-error";
}

/**
 * Page result containing HTML content
 */
export interface IRenderPageResult extends IRenderResultBase {
  resultType: "page";
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
export interface IRenderResponseResult extends IRenderResultBase {
  resultType: "response";
  response: Response;
}

/**
 * Error result containing error information
 * Used when rendering fails with an exception
 */
export interface IRenderErrorResult extends IRenderResultBase {
  resultType: "render-error";
  error: Error;
}

/**
 * Union type for all possible render results
 */
export type IRenderResult =
  | IRenderPageResult
  | IRenderResponseResult
  | IRenderErrorResult;

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
 * Plugin registration function type
 * Plugins get access to a controlled subset of Fastify functionality
 */
export type SSRPlugin = (
  fastify: ControlledFastifyInstance,
  options: PluginOptions,
) => Promise<void> | void;

/**
 * Fastify hook names that plugins can register
 * Includes common lifecycle hooks plus string for custom hooks
 */
export type FastifyHookName =
  | "onRequest"
  | "preHandler"
  | "onSend"
  | "onResponse"
  | "onError"
  | string;

/**
 * Controlled Fastify instance interface for plugins
 * Exposes safe methods while preventing access to destructive operations
 */
export interface ControlledFastifyInstance {
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
    ) => Promise<unknown> | unknown,
  ) => void;
  /** Add decorators to request/reply objects */
  decorate: (property: string, value: unknown) => void;
  decorateRequest: (property: string, value: unknown) => void;
  decorateReply: (property: string, value: unknown) => void;
  /** Access to route registration with constraints */
  route: (opts: SafeRouteOptions) => void;
  get: (path: string, handler: RouteHandler) => void;
  post: (path: string, handler: RouteHandler) => void;
  put: (path: string, handler: RouteHandler) => void;
  delete: (path: string, handler: RouteHandler) => void;
  patch: (path: string, handler: RouteHandler) => void;
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
) => Promise<void | unknown> | void | unknown;

/**
 * Plugin options passed to each plugin
 */
export interface PluginOptions {
  mode: "development" | "production";
  isDevelopment: boolean;
  buildDir?: string;
}

/**
 * Base options for SSR
 */
interface ServeSSROptions {
  /**
   * ID of the container element (defaults to "root")
   * This element will be formatted inline to prevent hydration issues
   */
  containerID?: string;
  /**
   * Array of plugins to register with the server
   * Plugins get access to a controlled Fastify instance
   */
  plugins?: SSRPlugin[];
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
}

export interface ServeSSRDevOptions extends ServeSSROptions {
}

export interface ServeSSRProdOptions extends ServeSSROptions {
  /**
   * Optional configuration object to be injected into the frontend app
   * Will be serialized and injected as window.__APP_CONFIG__
   *
   * NOTE: This only works in production builds. In development with Vite,
   * use environment variables (import.meta.env) or other dev-time config methods.
   * Your app should check for window.__APP_CONFIG__ and fallback to dev defaults:
   *
   * const apiUrl = window.__APP_CONFIG__?.apiUrl || 'http://localhost:3001';
   */
  frontendAppConfig?: Record<string, unknown>;
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
  staticRouter?: StaticRouterOptions | false;
}

// ============================================================================
// API Server Types
// ============================================================================

/**
 * Options for configuring the API server
 */
export interface APIServerOptions {
  /**
   * Array of plugins to register with the server
   * Plugins get access to a controlled Fastify instance with full wildcard support
   */
  plugins?: SSRPlugin[];
  /**
   * Custom error handler for API routes
   * Called when an unhandled error occurs in API routes
   * @param request The Fastify request object
   * @param error The error that occurred
   * @param isDevelopment Whether running in development mode
   * @returns object to send as error response
   */
  errorHandler?: (
    request: FastifyRequest,
    error: Error,
    isDevelopment: boolean,
  ) => Record<string, unknown> | Promise<Record<string, unknown>>;
  /**
   * Whether to run in development mode
   * Affects error reporting and logging behavior
   * @default false
   */
  isDevelopment?: boolean;
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
}

/**
 * Logger interface for SSG process
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
   * Optional configuration object to be injected into the frontend app
   * Will be serialized and injected as window.__APP_CONFIG__
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
}

/**
 * Base interface for pages to be generated
 */
export interface IGeneratorPageBase {
  /** The output filename for the generated HTML */
  filename: string;
}

/**
 * SSG page - server-side rendered at build time
 */
export interface ISSGPage extends IGeneratorPageBase {
  /** Type of page generation */
  type: "ssg";
  /** The URL path for the page (required for SSG) */
  path: string;
}

/**
 * SPA page - client-side rendered with custom metadata
 */
export interface ISPAPage extends IGeneratorPageBase {
  /** Type of page generation */
  type: "spa";
  /** Custom title for the SPA page */
  title?: string;
  /** Custom meta description for the SPA page */
  description?: string;
  /** Additional meta tags as key-value pairs */
  meta?: Record<string, string>;
}

/**
 * Union type for all page types
 */
export type IPageWanted = ISSGPage | ISPAPage;

/**
 * Status code for a generated page
 */
export type SSGPageStatus = "success" | "not_found" | "error";

/**
 * Report for a single generated page
 */
export interface SSGPageReport {
  /** The page that was processed */
  page: IPageWanted;
  /** Status of the generation */
  status: SSGPageStatus;
  /** Full path to the generated file (if successful) */
  outputPath?: string;
  /** Error details (if status is 'error') */
  errorDetails?: string;
  /** Time taken to generate the page in milliseconds */
  timeMs: number;
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
  totalTimeMs: number;
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
export interface StaticRouterOptions {
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

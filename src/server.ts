/**
 * Server-only exports for unirend
 *
 * This entry point includes server-side functionality like SSR servers,
 * SSG generation, file system operations, and server-side rendering utilities.
 * It should only be imported in server environments (Node.js, Bun, etc.).
 *
 * Import from 'unirend/server' in your server-side code:
 *
 * ```typescript
 * import { serveSSRWithHMR, serveSSRBuilt, generateSSG } from 'unirend/server';
 *
 * // Development (with HMR)
 * const devServer = serveSSRWithHMR({
 *   serverEntry: './src/EntrySSR.tsx',
 *   template: './index.html',
 *   viteConfig: './vite.config.ts'
 * });
 *
 * // Production (Built)
 * const prodServer = serveSSRBuilt('./build');
 *
 * // Static Site Generation
 * const result = await generateSSG('./build', pages);
 * ```
 */

// Server-safe types
export type {
  NotFoundRequest,
  RenderRequest,
  RenderResult,
  ServeSSRWithHMROptions,
  ServeSSRBuiltOptions,
  TemplateSlots,
  SSGOptions,
  SSGReport,
  SSGPageReport,
  PageTypeWanted,
  APIServerOptions,
  APIServerListenOptions,
  APIServerTCPListenOptions,
  APIServerUnixSocketListenOptions,
  PlainServerOptions,
  ControlledReply,
  UnirendLoggingOptions,
  UnirendLoggerObject,
  UnirendLoggerLevel,
  HTTPSOptions,
  AccessLogConfig,
  AccessLogLevelConfig,
  AccessLogRequestContext,
  AccessLogResponseContext,
  AccessLogReplyInfo,
} from './lib/types';
export type {
  RedirectServerOptions,
  InvalidDomainResponse,
} from './lib/redirect';

// Server-safe constants
export { SSGConsoleLogger } from './lib/types';

export type {
  SSRWithHMRPaths,
  ServerPlugin,
  PluginHostInstance,
  PluginOptions,
  PluginMetadata,
  UnirendServerMode,
  PluginAPIRouteShortcuts,
  PluginPageDataHandlerShortcuts,
  StaticWebServerOptions,
} from './lib/types';
export type { SSRServer } from './lib/internal/ssr-server';
export type { APIServer } from './lib/internal/api-server';
export type { PlainServer } from './lib/api';
// only export the config type as class not used internally
export type { PageDataHandler } from './lib/internal/data-loader-server-handler-helpers';
export type { APIRouteHandler } from './lib/internal/api-routes-server-helpers';
// The opaque value `request.trigger404()` returns, so a handler's return type
// can be named without restating the union.
export type { Trigger404Signal } from './lib/internal/trigger-404';
// Checked app bundle keys. `request.activeSSRApp` is a plain string, so a
// bundle gate is not checked for you; declaring the keys once makes a typo a
// compile error. A value rather than a type declaration on purpose — typing the
// request itself would mean a Fastify module augmentation, which is global, so
// every app compiled together would share one list.
export { defineAppBundles } from './lib/internal/app-bundles';
export type { AppBundles, AppBundleRequest } from './lib/internal/app-bundles';
export type {
  WebSocketHandlerParams,
  WebSocketPreValidationResult,
  WebSocketHandlerConfig,
} from './lib/internal/web-socket-server-helpers';
export type { APIEndpointConfig } from './lib/types';

// The rest of the public option and result types. Each of these was already
// reachable from an exported one, as a member of a union, a field of an options
// object, or a callback a caller writes, but had no exported name, so naming it
// meant restating its shape.
export type {
  // Members of the `RenderResult` union, for code that names one branch.
  RenderType,
  RenderPageResult,
  RenderResponseResult,
  RenderErrorResult,
  // Members of the `PageTypeWanted` union `generateSSG()` takes. The shared
  // base they extend is not exported: it carries no `type` discriminant, so
  // nothing constructs or receives one, and a helper generic over all three
  // wants `PageTypeWanted` itself.
  SSGPageType,
  SPAPageType,
  HTMLPageType,
  // The SSG report's inner shapes, and the logger interface `SSGConsoleLogger`
  // implements, for supplying your own.
  SSGPageStatus,
  SSGPagesReport,
  SSGLogger,
  // The options `registerHMRApp()` and `registerBuiltApp()` take, for a helper
  // that wraps either one.
  RegisterHMRAppOptions,
  RegisterBuiltAppOptions,
  // The page data request options and the resolver callback form.
  PageDataRequestContext,
  PageDataRequestOptions,
  ResolvePageDataRequestOptions,
  // Server option sub-objects, for a configuration built in its own module.
  WebSocketOptions,
  FileUploadsConfig,
  ResponseCompressionOptions,
  ResponseTimeHeaderOptions,
  // unirend's own passthrough options, not Fastify's type of the same name.
  FastifyServerOptions,
  FastifyTrustProxyFunction,
  // The function form of the `logging` option, alongside the object form.
  UnirendLoggerFunction,
  // Raw plugin routes: the handler contract and the route options.
  RouteHandler,
  SafeRouteOptions,
} from './lib/types';
export type { HTTPMethod } from './lib/internal/api-routes-server-helpers';
// The params a page data handler receives, alongside the handler type itself.
export type { PageDataHandlerParams } from './lib/internal/data-loader-server-handler-helpers';

// The error, not-found, and closing handler types, so a handler written as a
// named function or in its own file can name what it receives. Only the
// request type was exported before, which left the `params` argument
// unnameable from outside and forced callers to restate a structural subset of
// it. `APIResponseHelpersClass` is the generic bound, for code generic over
// which helpers class a server was configured with.
export type {
  APIResponseHelpersClass,
  WebResponse,
  APIErrorHandlerParams,
  APIErrorHandlerFn,
  WebErrorHandlerFn,
  SplitErrorHandler,
  WebOnlySplitErrorHandler,
  PageDataNotFoundContext,
  APINotFoundHandlerParams,
  APINotFoundHandlerFn,
  WebNotFoundHandlerFn,
  SplitNotFoundHandler,
  WebOnlySplitNotFoundHandler,
  APIClosingHandlerFn,
  WebClosingHandlerFn,
  SplitClosingHandler,
  WebOnlySplitClosingHandler,
} from './lib/types';

// Server-safe functions
export { serveSSRWithHMR, serveSSRBuilt } from './lib/ssr';
export { generateSSG } from './lib/ssg';
// The shape of `SSGReport.cspHashes`, so a caller can name it. Handing back a
// value whose type has no exported name means anyone writing a function that
// takes it has to restate the shape by hand or reach into internals.
export type {
  ResolvedTemplateCSPHashes,
  // The read shape, carried on the SSG report, and the write shape a caller
  // hands to `request.addCSPSources`. The write one omits the raw attribute
  // value, which nothing on that path reads.
  InlineAttributeFinding,
  InlineAttributeReport,
} from './lib/internal/html-utils/format';
export { unirendBaseRender } from './lib/base-render';
export { serveAPI, servePlain } from './lib/api';
export { serveRedirect, RedirectServer } from './lib/redirect';

// Re-export Fastify request/reply types to avoid forcing consumers to import 'fastify'
export type { FastifyRequest, FastifyReply } from 'fastify';
export type { DomainInfo } from './lib/internal/domain-info';
// Client-identity resolution (the `clientInfo` server option)
export type {
  ClientInfo,
  ClientInfoConfig,
  ClientInfoLoggingOptions,
} from './lib/internal/client-info-resolution';
export type {
  FastifyRequest as ServerRequest,
  FastifyReply as ServerReply,
} from 'fastify';

// Export our out of the box static web server
export { StaticWebServer } from './lib/internal/static-web-server';

// Lifecycleion logger adaptor
export { UnirendLifecycleionLoggerAdaptor } from './lib/internal/lifecycleion-logger-adaptor';
export { SSGLifecycleionLogger } from './lib/internal/ssg-lifecycleion-logger';
export type { LifecycleionLogContextOptions } from './lib/internal/lifecycleion-logger-adaptor';

// File upload helpers
export { processFileUpload } from './lib/server/process-file-upload';
export type {
  AbortReason,
  FileMetadata,
  ProcessorContext,
  ProcessedFile,
  FileUploadConfig,
  MimeTypeValidationResult,
  UploadSuccess,
  UploadError,
  UploadResult,
} from './lib/server/process-file-upload-types';

// Host verification
// For error pages and error handlers, which run on the one path where the
// request may have failed before the host was ever checked.
export { isHostUnverified } from './lib/internal/host-verification';

// Security-headers policy validation
// For policies that arrive from a database, an API request, or an admin form
// rather than from the repository. Reports every problem as data instead of
// throwing on the first, so a stored policy can be checked when it is saved
// rather than failing per request once a resolver returns it.
export { validateSecurityHeadersPolicy } from './lib/internal/security-headers-validation';
export type {
  SecurityHeadersPolicyIssue,
  SecurityHeadersPolicyValidation,
  SecurityHeadersPolicyInput,
  SecurityHeadersPolicyBaseline,
  SecurityHeadersBaseline,
} from './lib/internal/security-headers-validation';

// CORS validation
// The companion to the above, for the half of the configuration a resolver
// cannot replace. Same rules the plugin applies at startup, reported as data,
// so an admin form or a config loader can check a CORS block before a server
// is built out of it.
export { validateCORSPolicy } from './lib/internal/cors-validation';
export type {
  CORSPolicyIssue,
  CORSPolicyValidation,
} from './lib/internal/cors-validation';

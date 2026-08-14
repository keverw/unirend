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
export type { AppBundles } from './lib/internal/app-bundles';
export type {
  WebSocketHandlerParams,
  WebSocketPreValidationResult,
  WebSocketHandlerConfig,
} from './lib/internal/web-socket-server-helpers';
export type { APIEndpointConfig } from './lib/types';

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

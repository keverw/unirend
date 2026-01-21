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
 * import { serveSSRDev, serveSSRProd, generateSSG } from 'unirend/server';
 *
 * // Development
 * const devServer = serveSSRDev({
 *   serverEntry: './src/entry-server.tsx',
 *   template: './index.html',
 *   viteConfig: './vite.config.ts'
 * });
 *
 * // Production
 * const prodServer = serveSSRProd('./build');
 *
 * // Static Site Generation
 * const result = await generateSSG('./build', pages);
 * ```
 */

// Server-safe types
export type {
  RenderRequest,
  RenderResult,
  ServeSSRDevOptions,
  ServeSSRProdOptions,
  SSGOptions,
  SSGReport,
  SSGPageReport,
  PageTypeWanted,
  APIServerOptions,
  ControlledReply,
} from './lib/types';

// Server-safe constants
export { SSGConsoleLogger } from './lib/types';

export type {
  SSRDevPaths,
  ServerPlugin,
  PluginHostInstance,
  PluginOptions,
  PluginMetadata,
} from './lib/types';
export type { SSRServer } from './lib/internal/ssr-server';
export type { APIServer } from './lib/internal/api-server';
// only export the config type as class not used internally
export type { PageDataHandler } from './lib/internal/data-loader-server-handler-helpers';
export type { APIRouteHandler } from './lib/internal/api-routes-server-helpers';
export type { APIEndpointConfig } from './lib/types';

// Server-safe functions
export { serveSSRDev, serveSSRProd } from './lib/ssr';
export { generateSSG } from './lib/ssg';
export { unirendBaseRender } from './lib/base-render';
export { serveAPI } from './lib/api';

// Re-export Fastify request/reply types to avoid forcing consumers to import 'fastify'
export type { FastifyRequest, FastifyReply } from 'fastify';
export type {
  FastifyRequest as ServerRequest,
  FastifyReply as ServerReply,
} from 'fastify';

// Export our out of the box static web server
export type { StaticWebServer } from './lib/internal/static-web-server';

// File upload helpers
export { FileUploadHelpers } from './lib/server/file-upload-helpers';
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
} from './lib/server/file-upload-helpers';

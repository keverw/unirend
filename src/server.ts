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
 * const devServer = await serveSSRDev({
 *   serverEntry: './src/entry-server.tsx',
 *   template: './index.html',
 *   viteConfig: './vite.config.ts'
 * });
 *
 * // Production
 * const prodServer = await serveSSRProd('./build');
 *
 * // Static Site Generation
 * const result = await generateSSG('./build', pages);
 * ```
 */

// Server-safe types
export type {
  IRenderRequest,
  IRenderResult,
  ServeSSRDevOptions,
  ServeSSRProdOptions,
  SSGOptions,
  SSGReport,
  SSGPageReport,
  IPageWanted,
} from "./lib/types";

// Server-safe constants
export { SSGConsoleLogger } from "./lib/types";

export type {
  SSRDevPaths,
  SSRPlugin,
  ControlledFastifyInstance,
  PluginOptions,
} from "./lib/types";
export type { SSRServer } from "./lib/internal/SSRServer";

// Server-safe functions
export { serveSSRDev, serveSSRProd } from "./lib/ssr";
export { generateSSG } from "./lib/ssg";
export { unirendBaseRender } from "./lib/baseRender";

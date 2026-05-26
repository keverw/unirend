import { SSRServer } from './internal/ssr-server';
import type {
  ServeSSRWithHMROptions,
  ServeSSRBuiltOptions,
  SSRWithHMRPaths,
} from './types';

/**
 * Development server handler for SSR applications using Vite's HMR and middleware.
 * Simplifies dev workflow while preserving React Router SSR consistency.
 *
 * For development, we integrate with Vite's dev server for HMR support and middleware mode.
 *
 * Multi-App Support: The returned SSRServer instance supports serving multiple React applications
 * from a single server. Use `server.registerHMRApp(appKey, sourcePaths, options)` to register additional
 * HMR-mode apps before calling `server.listen()`. See docs/ssr.md "Multi-App SSR Support" for details.
 *
 * @param sourcePaths Required file paths for development server setup (default app)
 * @param options Development SSR options (default app)
 *
 * @example Single app
 * ```ts
 * const server = serveSSRWithHMR(devPaths, { port: 3000 });
 * await server.listen(3000);
 * ```
 *
 * @example Multi-app with subdomain routing
 * ```ts
 * const server = serveSSRWithHMR(mainPaths, mainOptions);
 *
 * server.registerHMRApp('marketing', marketingPaths, marketingOptions);
 *
 * server.fastifyInstance.addHook('onRequest', async (request, reply) => {
 *   if (request.hostname === 'marketing.example.com') {
 *     request.setActiveSSRApp('marketing');
 *   }
 * });
 *
 * await server.listen(3000);
 * ```
 */

export function serveSSRWithHMR(
  sourcePaths: SSRWithHMRPaths,
  options: ServeSSRWithHMROptions = {},
): SSRServer {
  return new SSRServer({
    mode: 'development',
    sourcePaths,
    options,
  });
}

/**
 * Production server handler for SSR applications.
 *
 * Creates an SSR server instance for production mode. The server entry import
 * and manifest loading are deferred until the server starts listening, which
 * provides better error handling and avoids unnecessary work during construction.
 *
 * Multi-App Support: The returned SSRServer instance supports serving multiple React applications
 * from a single server. Use `server.registerBuiltApp(appKey, buildDir, options)` to register additional
 * built-mode apps before calling `server.listen()`. See docs/ssr.md "Multi-App SSR Support" for details.
 *
 * @param buildDir Directory containing built assets (HTML template, static files, manifest, etc.) for default app
 * @param options Production SSR options, including serverEntry to specify which entry file to use (default app)
 *
 * @example Single app
 * ```ts
 * const server = serveSSRBuilt('./build', { port: 3000 });
 * await server.listen(3000);
 * ```
 *
 * @example Multi-app with path-based routing
 * ```ts
 * const server = serveSSRBuilt('./build-main', mainOptions);
 *
 * server.registerBuiltApp('marketing', './build-marketing', marketingOptions);
 *
 * server.fastifyInstance.addHook('onRequest', async (request, reply) => {
 *   if (request.url.startsWith('/marketing')) {
 *     request.setActiveSSRApp('marketing');
 *   }
 * });
 *
 * await server.listen(3000);
 * ```
 */

export function serveSSRBuilt(
  buildDir: string,
  options: ServeSSRBuiltOptions = {},
): SSRServer {
  return new SSRServer({
    mode: 'production',
    buildDir,
    options,
  });
}

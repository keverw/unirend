import { SSRServer } from './internal/ssr-server';
import { ServeSSRDevOptions, ServeSSRProdOptions, SSRDevPaths } from './types';

/**
 * Development server handler for SSR applications using Vite's HMR and middleware.
 * Simplifies dev workflow while preserving React Router SSR consistency.
 *
 * For development, we integrate with Vite's dev server for HMR support and middleware mode.
 *
 * @param paths Required file paths for development server setup
 * @param options Development SSR options
 */

export function serveSSRDev(
  paths: SSRDevPaths,
  options: ServeSSRDevOptions = {},
): SSRServer {
  return new SSRServer({
    mode: 'development',
    paths,
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
 * @param buildDir Directory containing built assets (HTML template, static files, manifest, etc.)
 * @param options Production SSR options, including serverEntry to specify which entry file to use
 */

export function serveSSRProd(
  buildDir: string,
  options: ServeSSRProdOptions = {},
): SSRServer {
  return new SSRServer({
    mode: 'production',
    buildDir,
    options,
  });
}

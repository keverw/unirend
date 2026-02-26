import { RedirectServer } from './internal/redirect-server';
import type { RedirectServerOptions } from './internal/redirect-server';

/**
 * Create a dedicated HTTP → HTTPS redirect server
 *
 * Lightweight server specifically designed for HTTP → HTTPS redirects.
 * Common use case: Run on port 80 to redirect all HTTP traffic to HTTPS (port 443)
 *
 * @param options Redirect server configuration
 * @returns RedirectServer instance
 *
 * @example Basic usage (redirect all HTTP to HTTPS)
 * ```ts
 * import { serveRedirect } from 'unirend/server';
 *
 * const redirectServer = serveRedirect({
 *   targetProtocol: 'https',
 *   statusCode: 301,
 * });
 *
 * await redirectServer.listen(80);
 * ```
 *
 * @example With domain validation (security)
 * ```ts
 * const redirectServer = serveRedirect({
 *   targetProtocol: 'https',
 *   allowedDomains: ['example.com', '*.example.com'],
 * });
 *
 * await redirectServer.listen(80);
 * ```
 *
 * @example Multi-server setup (HTTP redirect + HTTPS main server)
 * ```ts
 * import { serveRedirect, serveSSRProd } from 'unirend/server';
 *
 * // HTTP → HTTPS redirect server (port 80)
 * const redirectServer = serveRedirect({
 *   allowedDomains: ['example.com', '*.example.com'],
 * });
 *
 * await redirectServer.listen(80);
 *
 * // Main HTTPS server (port 443)
 * const mainServer = serveSSRProd('./build', {
 *   https: {
 *     key: privateKey,     // string | Buffer
 *     cert: certificate,   // string | Buffer
 *   },
 * });
 *
 * await mainServer.listen(443);
 * ```
 */
export function serveRedirect(
  options: RedirectServerOptions = {},
): RedirectServer {
  return new RedirectServer(options);
}

export {
  type RedirectServerOptions,
  RedirectServer,
} from './internal/redirect-server';

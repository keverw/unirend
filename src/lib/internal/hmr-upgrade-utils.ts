import type { IncomingHttpHeaders } from 'node:http';

/**
 * Shared-server HMR helpers.
 *
 * In development, each app's Vite dev server shares the main HTTP server for
 * its HMR WebSocket instead of opening a dedicated port. Apps are told apart by
 * a unique path, and when application WebSockets are also enabled a single
 * upgrade dispatcher decides which upgrades belong to Vite and which belong to
 * the application's own handlers. These two pure helpers capture that routing
 * so it can be unit tested in isolation from the Fastify/Vite wiring.
 */

/**
 * The per-app HMR WebSocket path on the shared HTTP server.
 *
 * `encodeURIComponent` keeps arbitrary app keys URL-safe and, because both the
 * Vite server listener and the injected browser client derive the path the same
 * way, keeps the two consistent for any key.
 */
export function hmrPathForApp(appKey: string): string {
  return `/__hmr/${encodeURIComponent(appKey)}`;
}

/**
 * Extract the pathname from a raw upgrade request URL, ignoring the query
 * string. Mirrors how Vite parses the incoming upgrade URL. Returns `null` when
 * the URL is missing or unparseable so callers treat it as a non-match.
 */
export function upgradeRequestPathname(
  rawURL: string | undefined,
): string | null {
  if (!rawURL) {
    return null;
  }

  try {
    return new URL(`http://unirend.local${rawURL}`).pathname;
  } catch {
    return null;
  }
}

/**
 * Whether a WebSocket upgrade belongs to Vite's HMR channel and should be left
 * for Vite's own shared-server listener (the dispatcher forwards everything else
 * to `@fastify/websocket`).
 *
 * Vite negotiates its HMR socket with the `vite-hmr` subprotocol and its
 * liveness probe with `vite-ping`, but it only claims those upgrades when the
 * request path also matches one of its HMR paths. We mirror both checks: an
 * upgrade only counts as Vite's when the subprotocol matches (exact string, so a
 * multi-value array header is treated as non-Vite) AND the request path is one
 * of the configured per-app HMR paths. This prevents a `vite-hmr`-subprotocol
 * request to some other path (a malformed request, or an application route that
 * happens to reuse the name) from being silently dropped instead of reaching the
 * application's own WebSocket handlers.
 */
export function isViteHMRUpgrade(
  protocol: IncomingHttpHeaders['sec-websocket-protocol'],
  rawURL: string | undefined,
  hmrPaths: ReadonlySet<string>,
): boolean {
  if (protocol !== 'vite-hmr' && protocol !== 'vite-ping') {
    return false;
  }

  const pathname = upgradeRequestPathname(rawURL);

  return pathname !== null && hmrPaths.has(pathname);
}

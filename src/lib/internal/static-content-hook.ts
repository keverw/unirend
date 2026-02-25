import type { FastifyRequest, FastifyReply } from 'fastify';
import { StaticContentCache } from './static-content-cache';
import type {
  StaticContentWarnLoggerObject,
  ServeFileResult,
} from './static-content-cache';
import type { StaticContentRouterOptions } from '../types';

/**
 * Static content hook handler that delegates to a StaticContentCache instance.
 *
 * Performs safety checks before delegating to the cache:
 * - Only handles GET requests
 * - Requires a valid URL to be present
 *
 * @param cache StaticContentCache instance to delegate to
 * @param req Fastify request object
 * @param reply Fastify reply object
 * @returns Promise that resolves to ServeFileResult, or undefined if request was filtered out
 * @internal Shared handler logic used by createStaticContentHook and SSRServer
 */
export async function staticContentHookHandler(
  cache: StaticContentCache,
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<ServeFileResult | undefined> {
  // Exit early for non-GET requests
  if (req.method !== 'GET') {
    return;
  }

  // If there's no URL, we can't handle it
  if (!req.raw.url) {
    return;
  }

  // Delegate to cache to handle URL cleaning, resolution, and file serving
  return cache.handleRequest(req.raw.url, req, reply);
}

/**
 * Creates a static content serving hook with its own caches and configuration.
 *
 * Rationale:
 * - Unlike generic static handlers which may check disk for every path or apply
 *   wildcard matching, this only hits the filesystem when:
 *     1) the request URL exactly matches an entry in `singleAssetMap`, or
 *     2) it falls under a configured prefix in `folderMap`.
 * - Adds strong ETag support with optional LRU caching of ETag values and small file content.
 * - Caches file stat results to avoid repeated `stat()` calls.
 * - This minimizes unnecessary disk I/O, improves performance, and locks down
 *   asset serving to known files and directories, preventing accidental exposure
 *   or directory traversal beyond the intended public paths.
 *
 * Each call creates an independent instance with its own caches, allowing multiple
 * instances to be registered with different configurations.
 *
 * @param optionsOrCache Static content configuration OR an existing StaticContentCache instance
 * @param logger Optional logger (e.g., fastify.log) for error logging (ignored if cache instance provided)
 * @returns Fastify onRequest hook handler function
 * @internal Used by SSRServer (internal) and staticContent() plugin (public API)
 */
export function createStaticContentHook(
  optionsOrCache: StaticContentRouterOptions | StaticContentCache,
  logger?: StaticContentWarnLoggerObject,
) {
  // Determine cache source: use provided instance or create new one from options
  let cache: StaticContentCache;

  if (optionsOrCache instanceof StaticContentCache) {
    // Using externally-created cache instance (for runtime updates)
    cache = optionsOrCache;
    // Note: logger parameter is ignored when cache instance is provided
  } else {
    // Creating new cache from configuration options
    cache = new StaticContentCache(optionsOrCache, logger);
  }

  // Return the hook handler using shared handler logic
  return async (req: FastifyRequest, reply: FastifyReply) => {
    return staticContentHookHandler(cache, req, reply);
  };
}

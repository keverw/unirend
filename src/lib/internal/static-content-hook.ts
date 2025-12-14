import { FastifyRequest, FastifyReply } from 'fastify';
import { StaticContentCache } from './StaticContentCache';
import type { StaticContentRouterOptions } from '../types';

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
 * @param options Static content configuration (file mappings, cache settings, etc.)
 * @param logger Optional logger (e.g., fastify.log) for error logging
 * @returns Fastify onRequest hook handler function
 * @internal Used by SSRServer (internal) and staticContent() plugin (public API)
 */
export function createStaticContentHook(
  options: StaticContentRouterOptions,
  logger?: { warn: (obj: object, msg: string) => void },
) {
  // Create the static content cache instance with all caching and routing logic
  const cache = new StaticContentCache(options, logger);

  // Return the hook handler
  return async (req: FastifyRequest, reply: FastifyReply) => {
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
  };
}

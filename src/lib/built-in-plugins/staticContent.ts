import type { ServerPlugin, StaticContentRouterOptions } from '../types';
import { createStaticContentHook } from '../internal/static-content-hook';

// Re-export the options type for convenience
export type { StaticContentRouterOptions };

// Also re-export FolderConfig since users will need it for folderMap
export type { FolderConfig } from '../types';

/**
 * Creates a static content serving plugin that can be used with any Unirend server.
 *
 * This plugin serves static files from configured paths with:
 * - Efficient file caching and ETag support for conditional requests
 * - Content-based strong ETags for small files (SHA-256)
 * - Weak ETags for large files (size + mtime based)
 * - LRU caching for stats, content, and ETags
 * - Range request support for large files
 * - Immutable asset detection for fingerprinted files (optional)
 *
 * Multiple instances can be registered with different configurations,
 * allowing you to serve files from different directories with different settings.
 *
 * @example Basic usage - serve uploads folder
 * ```typescript
 * import { staticContent } from 'unirend/plugins';
 *
 * const server = serveSSRDev(paths, {
 *   plugins: [
 *     staticContent({
 *       folderMap: {
 *         '/uploads': './uploads',
 *         '/static': './public/static',
 *       },
 *     }),
 *   ],
 * });
 * ```
 *
 * @example Multiple folders with different settings
 * ```typescript
 * import { staticContent } from 'unirend/plugins';
 *
 * const server = serveSSRProd(buildDir, {
 *   plugins: [
 *     // User uploads - no immutable caching
 *     staticContent({
 *       folderMap: {
 *         '/uploads': { path: './uploads', detectImmutableAssets: false },
 *       },
 *     }),
 *     // Static assets with fingerprinted filenames - immutable caching
 *     staticContent({
 *       folderMap: {
 *         '/static': { path: './public/static', detectImmutableAssets: true },
 *       },
 *     }),
 *   ],
 * });
 * ```
 *
 * @example Custom plugin name for debugging and dependencies
 * ```typescript
 * const server = serveSSRProd(buildDir, {
 *   plugins: [
 *     staticContent({
 *       folderMap: { '/uploads': './uploads' },
 *     }, 'uploads-handler'),
 *   ],
 * });
 * ```
 *
 * @example Use on standalone API server
 * ```typescript
 * import { createAPIServer } from 'unirend/server';
 * import { staticContent } from 'unirend/plugins';
 *
 * const server = createAPIServer({
 *   plugins: [
 *     staticContent({
 *       folderMap: {
 *         '/files': './data/files',
 *       },
 *       singleAssetMap: {
 *         '/favicon.ico': './public/favicon.ico',
 *       },
 *     }),
 *   ],
 * });
 * ```
 *
 * @example Fine-tuned caching settings
 * ```typescript
 * staticContent({
 *   folderMap: { '/assets': './dist/assets' },
 *   smallFileMaxSize: 1024 * 1024, // 1MB - files below this get content-based ETags
 *   cacheEntries: 200, // Max LRU cache entries
 *   contentCacheMaxSize: 100 * 1024 * 1024, // 100MB total content cache
 *   positiveCacheTtl: 3600 * 1000, // 1 hour for found files
 *   negativeCacheTtl: 60 * 1000, // 1 minute for 404s
 *   cacheControl: 'public, max-age=3600', // Custom Cache-Control
 * })
 * ```
 *
 * @param config Static content router configuration
 * @param name Optional custom name for this plugin instance (useful for debugging and plugin dependencies)
 * @returns A ServerPlugin that can be added to the plugins array
 */
export function staticContent(
  config: StaticContentRouterOptions,
  name?: string,
): ServerPlugin {
  // Validate custom name if provided
  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      throw new Error(
        'staticContent plugin name must be a non-empty string if provided',
      );
    }
  }

  // Use custom name or generate a unique instance ID for this plugin registration
  // This allows multiple instances to be registered and tracked independently
  const instanceId =
    name ||
    `static-content-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const staticContentPlugin: ServerPlugin = (pluginHost, _pluginOptions) => {
    // Try to get logger from fastify instance if available
    const logger = pluginHost.getDecoration<{
      warn: (obj: object, msg: string) => void;
    }>('log');

    // Create and register the hook directly (no plugin wrapper needed)
    const hook = createStaticContentHook(config, logger);
    pluginHost.addHook('onRequest', hook);

    return {
      name: instanceId,
    };
  };

  return staticContentPlugin;
}

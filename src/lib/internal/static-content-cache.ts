import type { FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import LRUCache from './lru-cache';
import type { StaticContentRouterOptions, FolderConfig } from '../types';

/**
 * Minimal stat info interface with only the properties we actually use
 */
interface MinimalStatInfo {
  isFile: boolean;
  size: number;
  mtime: Date;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  mtimeMs: number;
}

/**
 * Negative cache entry type (for 404s and access errors)
 */
interface NegativeCacheEntry {
  notFound: true;
}

/**
 * Combined type for stat cache entries
 */
type StatCacheEntry = MinimalStatInfo | NegativeCacheEntry | null;

/**
 * Options for getFile() method
 */
export interface GetFileOptions {
  /** Whether to detect immutable assets for cache control decisions */
  shouldDetectImmutable?: boolean;
  /** Optional ETag from client's If-None-Match header (for 304 optimization) */
  clientETag?: string;
}

/**
 * Options for creating a read stream (for range requests)
 */
export interface CreateStreamOptions {
  /** Start byte position (inclusive) */
  start?: number;
  /** End byte position (inclusive) */
  end?: number;
}

/**
 * Result from serveFile() indicating what action was taken
 */
export type ServeFileResult =
  | { served: false; reason: 'not-found' }
  | { served: false; reason: 'error'; error: Error }
  | { served: true; statusCode: 200 | 206 | 304 }; // 200: full file served, 206: partial content, 304: not modified

/**
 * File content discriminated union - either buffered in memory or needs streaming
 */
export type FileContent =
  | {
      /** Content is buffered in memory (small files) */
      shouldStream: false;
      /** The file content buffer */
      data: Buffer;
    }
  | {
      /** Content needs to be streamed from disk (large files) */
      shouldStream: true;
      /** Factory function to create a read stream with optional range support */
      createStream: (options?: CreateStreamOptions) => fs.ReadStream;
    };

/**
 * Internal logger object used by static content helpers.
 */
export type StaticContentWarnLoggerObject = {
  warn: (obj: object, msg: string) => void;
};

/**
 * Result when file is not found (404)
 */
export interface FileNotFoundResult {
  status: 'not-found';
}

/**
 * Result when an unexpected error occurs (500)
 */
export interface FileErrorResult {
  status: 'error';
  error: Error;
}

/**
 * Result when client's ETag matches (304 Not Modified)
 */
export interface FileNotModifiedResult {
  status: 'not-modified';
  /** Generated ETag for the file */
  etag: string;
  /** Last-Modified date as HTTP header string */
  lastModified: string;
}

/**
 * Result when file is found and should be served (200)
 */
export interface FileFoundResult {
  status: 'ok';
  /** File stats (size, modification time, etc.) */
  stat: MinimalStatInfo;
  /** Generated ETag for the file */
  etag: string;
  /** Last-Modified date as HTTP header string */
  lastModified: string;
  /** MIME type based on file extension */
  mimeType: string;
  /** File content - either buffered or needs streaming */
  content: FileContent;
  /** Whether this file appears to be fingerprinted/immutable (for aggressive caching) */
  isImmutableAsset: boolean;
}

/**
 * Union type for all possible getFile() results
 */
export type FileResult =
  | FileNotFoundResult
  | FileErrorResult
  | FileNotModifiedResult
  | FileFoundResult;

/**
 * Encapsulates caching and serving of static content files.
 *
 * This class manages:
 * - Multiple LRU caches (ETag, file content, and file stats)
 * - Configuration for single asset and folder mappings
 * - Optimized file serving with HTTP caching headers
 * - Content-based ETags for small files, weak ETags for large files
 * - Automatic detection of immutable assets (fingerprinted files)
 *
 * Each instance maintains its own independent caches, allowing
 * multiple instances with different configurations.
 */
export class StaticContentCache {
  // Normalized mappings (mutable to allow runtime updates)
  private singleAssetMap: Map<string, string>; // URL path → filesystem path
  private folderMap: Map<string, FolderConfig>; // URL prefix → folder config

  // Cache configuration
  private readonly smallFileMaxSize: number;
  private readonly cacheControl: string;
  private readonly immutableCacheControl: string;
  private readonly negativeCacheTtl: number;
  private readonly positiveCacheTtl: number;

  // LRU caches (all keyed by filesystem path)
  private readonly etagCache: LRUCache<string, string>; // fs path → ETag
  private readonly contentCache: LRUCache<string, Buffer>; // fs path → file content
  private readonly statCache: LRUCache<string, StatCacheEntry>; // fs path → file stats

  // Optional logger
  private readonly logger?: StaticContentWarnLoggerObject;

  /**
   * Creates a new StaticContentCache instance
   *
   * @param options Static content configuration (file mappings, cache settings, etc.)
   * @param logger Optional logger (e.g., fastify.log) for error logging
   */
  constructor(
    options: StaticContentRouterOptions,
    logger?: StaticContentWarnLoggerObject,
  ) {
    const {
      singleAssetMap = {},
      folderMap = {},
      smallFileMaxSize = 5 * 1024 * 1024, // 5 MB
      cacheEntries = 100,
      contentCacheMaxSize = 50 * 1024 * 1024, // 50 MB
      statCacheEntries = 250,
      negativeCacheTtl = 30 * 1000, // 30 seconds
      positiveCacheTtl = 60 * 60 * 1000, // 1 hour
      cacheControl = 'public, max-age=0, must-revalidate',
      immutableCacheControl = 'public, max-age=31536000, immutable',
    } = options;

    this.smallFileMaxSize = smallFileMaxSize;
    this.cacheControl = cacheControl;
    this.immutableCacheControl = immutableCacheControl;
    this.negativeCacheTtl = negativeCacheTtl;
    this.positiveCacheTtl = positiveCacheTtl;
    this.logger = logger;

    // Normalize singleAssetMap
    this.singleAssetMap = this.normalizeSingleAssetMap(singleAssetMap);

    // Normalize folderMap
    this.folderMap = this.normalizeFolderMap(folderMap);

    // Initialize LRU caches
    const defaultTtl = positiveCacheTtl > 0 ? positiveCacheTtl : undefined;

    this.etagCache = new LRUCache<string, string>(cacheEntries, { defaultTtl });
    this.contentCache = new LRUCache<string, Buffer>(cacheEntries, {
      defaultTtl,
      maxSize: contentCacheMaxSize,
    });
    this.statCache = new LRUCache<string, StatCacheEntry>(statCacheEntries, {
      defaultTtl,
    });
  }

  /**
   * Gets file metadata and content with optimized caching
   *
   * This method handles all the core file operations and caching:
   * - File stats caching to avoid repeated filesystem operations
   * - ETag generation and caching (content-based for small files, weak for large files)
   * - Small file content caching in memory for performance
   * - Proper MIME type detection
   * - Immutable asset detection for cache control decisions
   * - Optional short-circuit if client ETag matches (for 304 responses)
   *
   * Useful for both HTTP serving (via serveFile) and programmatic access
   *
   * @param resolvedPath The absolute path to the file
   * @param options Optional configuration for file retrieval
   * @returns Result with status: 'not-found', 'error', 'not-modified', or 'ok'
   */
  public async getFile(
    resolvedPath: string,
    options?: GetFileOptions,
  ): Promise<FileResult> {
    // Wrap entire operation in try-catch to return errors instead of throwing
    try {
      const { shouldDetectImmutable = false, clientETag } = options || {};

      // Try to get file stats from cache to avoid filesystem operations
      const cachedStat = this.statCache.get(resolvedPath);

      // Variable that will hold our file information
      let stat: MinimalStatInfo | null = null;

      // Handle cached entries (LRU handles TTL expiration internally)
      if (cachedStat) {
        if ('notFound' in cachedStat) {
          // File is known to not exist
          return { status: 'not-found' };
        } else if (cachedStat !== null) {
          // We have a valid cached stat, use it
          stat = cachedStat;
        }
      }

      // If stats aren't cached, retrieve them from filesystem
      if (!stat) {
        try {
          const fullStat = await fs.promises.stat(resolvedPath);

          // Only serve regular files, not directories or special files
          if (!fullStat.isFile()) {
            // Cache as negative entry with specific TTL
            this.statCache.set(
              resolvedPath,
              { notFound: true },
              this.negativeCacheTtl,
            );

            return { status: 'not-found' };
          }

          // Extract only the properties we need to minimize memory usage
          stat = {
            isFile: true, // We know it's a file at this point
            size: fullStat.size,
            mtime: fullStat.mtime,
            // eslint-disable-next-line @typescript-eslint/naming-convention
            mtimeMs: fullStat.mtimeMs,
          };

          // Cache the minimal stats for future requests
          // The TTL was already set when creating the cache
          this.statCache.set(resolvedPath, stat);
        } catch (error) {
          // File doesn't exist or can't be accessed
          // Cache as negative entry with specific TTL
          this.statCache.set(
            resolvedPath,
            { notFound: true },
            this.negativeCacheTtl,
          );

          // Log unexpected errors (like permission issues) but not 'file not found' errors
          // ENOENT is expected for files that don't exist and shouldn't be logged
          if (
            error instanceof Error &&
            'code' in error &&
            (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
            this.logger
          ) {
            this.logger.warn(
              {
                err: error,
                path: resolvedPath,
              },
              'Unexpected error accessing static file',
            );
          }

          return { status: 'not-found' };
        }
      }

      // Generate Last-Modified header from file modification time
      const lastModified = stat.mtime.toUTCString();

      // Try to get ETag from cache
      let etag = this.etagCache.get(resolvedPath);

      // Generate a new ETag if not cached
      if (!etag) {
        // For small files: create content-based strong ETag using SHA-256
        if (stat.size <= this.smallFileMaxSize) {
          // Try to get file content from cache for ETag generation
          let buf = this.contentCache.get(resolvedPath);

          // If content not cached, read and cache it
          if (!buf) {
            try {
              buf = await fs.promises.readFile(resolvedPath);
              this.contentCache.set(resolvedPath, buf);
            } catch (error) {
              // Log unexpected errors when reading file content
              // Cast to NodeJS.ErrnoException to access error codes if needed
              const fsError = error as NodeJS.ErrnoException;

              if (this.logger) {
                this.logger.warn(
                  {
                    err: fsError,
                    path: resolvedPath,
                    code: fsError.code,
                  },
                  'Error reading static file content',
                );
              }

              // Re-throw to be handled by outer error handling
              throw error;
            }
          }

          // Generate a strong hash-based ETag from file content
          const hash = crypto.createHash('sha256').update(buf).digest('base64');
          etag = `"${hash}"`;
        } else {
          // For large files: create a weak ETag based on size and modification time
          // Using W/ prefix to indicate a weak validator per RFC specs
          etag = `W/"${stat.size}-${Number(stat.mtimeMs)}"`;
        }

        // Cache the ETag for future requests
        this.etagCache.set(resolvedPath, etag);
      }

      // Extract client cache validation header (ETag-based validation)
      // Check if client's ETag matches (short-circuit for 304)
      if (clientETag && clientETag === etag) {
        // Return HTTP 304 Not Modified response (no body)
        // This saves bandwidth as the client will use its cached version
        return {
          status: 'not-modified',
          etag,
          lastModified,
        };
      }

      // Determine if we should use immutable cache headers based on the filename pattern
      // A fingerprinted file typically has a name like main.a1b2c3.js or chunk-5a7d9c8b.js
      const isImmutableAsset =
        shouldDetectImmutable && this.isImmutableAsset(resolvedPath);

      // Get MIME type based on file extension
      const mimeType = this.getMimeType(resolvedPath);

      // Build content discriminated union based on file size
      // Small files: buffered in memory (get from cache or read from disk as fallback)
      // Large files: must be streamed from disk with factory function that supports ranges
      let fileContent: FileContent;

      if (stat.size <= this.smallFileMaxSize) {
        // Try to get content from cache first
        let content = this.contentCache.get(resolvedPath);

        // If not in cache, read from disk
        if (!content) {
          try {
            content = await fs.promises.readFile(resolvedPath);
            this.contentCache.set(resolvedPath, content);
          } catch (error) {
            // File disappeared or became inaccessible
            const fsError = error as NodeJS.ErrnoException;

            // If file no longer exists, treat as not-found
            if (fsError.code === 'ENOENT') {
              // Invalidate caches since file disappeared
              this.statCache.set(
                resolvedPath,
                { notFound: true },
                this.negativeCacheTtl,
              );

              this.etagCache.delete(resolvedPath);
              this.contentCache.delete(resolvedPath);

              return { status: 'not-found' };
            }

            // Other errors - log and re-throw
            if (this.logger) {
              this.logger.warn(
                {
                  err: fsError,
                  path: resolvedPath,
                  code: fsError.code,
                },
                'Error reading static file content',
              );
            }

            throw error;
          }
        }

        fileContent = { shouldStream: false, data: content };
      } else {
        fileContent = {
          shouldStream: true,
          createStream: (options) => fs.createReadStream(resolvedPath, options),
        };
      }

      return {
        status: 'ok',
        stat,
        etag,
        lastModified,
        mimeType,
        content: fileContent,
        isImmutableAsset,
      };
    } catch (error) {
      // Return error status for unexpected errors
      return {
        status: 'error',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Serves a static file via HTTP with conditional responses
   *
   * This is a thin HTTP wrapper around getFile() that handles:
   * - HTTP 304 Not Modified responses when client cache is valid (If-None-Match)
   * - HTTP 206 Partial Content responses for range requests
   * - Proper HTTP headers (Cache-Control, ETag, Content-Type, Last-Modified, etc.)
   * - Streaming large files vs sending cached buffers for small files
   *
   * The heavy lifting (file I/O, caching, ETag generation) is done by getFile()
   *
   * @param req The Fastify request object
   * @param reply The Fastify reply object
   * @param resolvedPath The absolute path to the file to be served
   * @param options Optional configuration for file serving
   * @returns Information about whether the file was served and what status code
   */
  public async serveFile(
    req: FastifyRequest,
    reply: FastifyReply,
    resolvedPath: string,
    options?: GetFileOptions,
  ): Promise<ServeFileResult> {
    // Extract If-None-Match header for ETag comparison
    const clientETag = req.headers['if-none-match'];

    // Get file with all metadata and caching
    const result = await this.getFile(resolvedPath, {
      ...options,
      clientETag,
    });

    // Handle different result statuses
    if (result.status === 'not-found') {
      // File not found, return early (let hook fall through to 404)
      return { served: false, reason: 'not-found' };
    } else if (result.status === 'error') {
      // Unexpected error occurred, return error info
      return { served: false, reason: 'error', error: result.error };
    } else if (result.status === 'not-modified') {
      // Client's cache is still valid, send 304
      await reply
        .code(304)
        .header('ETag', result.etag)
        .header('Last-Modified', result.lastModified)
        .send();

      return { served: true, statusCode: 304 };
    }

    // File found (status === 'ok'), proceed with serving

    // Determine Cache-Control header based on immutability
    const headerCacheControl = result.isImmutableAsset
      ? this.immutableCacheControl
      : this.cacheControl;

    // Set common headers
    reply
      .header('Last-Modified', result.lastModified)
      .header('ETag', result.etag)
      .header('Cache-Control', headerCacheControl)
      .type(result.mimeType);

    // Only advertise range support for streaming files
    // (files larger than smallFileMaxSize that are streamed from disk)
    // Buffered files in memory don't support range requests
    if (result.content.shouldStream) {
      reply.header('Accept-Ranges', 'bytes');
    }

    // Check for Range header to handle partial content requests
    const rangeHeader = req.headers.range;

    // Handle range requests if present and file is being streamed
    if (rangeHeader && result.content.shouldStream) {
      // Parse the range header
      const matches = /bytes=(\d+)-(\d*)/.exec(rangeHeader);

      if (!matches) {
        // Malformed range header
        return reply
          .code(400)
          .header('Cache-Control', 'no-store')
          .send({ error: 'Invalid range header format' });
      }

      // Extract range values
      const start = parseInt(matches[1], 10);
      let end = matches[2] ? parseInt(matches[2], 10) : result.stat.size - 1;

      // Cap the end to actual file size
      end = Math.min(end, result.stat.size - 1);

      // Validate range
      if (
        isNaN(start) ||
        isNaN(end) ||
        start < 0 ||
        start >= result.stat.size ||
        end < start
      ) {
        // Invalid range
        return reply
          .code(416) // Range Not Satisfiable
          .header('Cache-Control', 'no-store')
          .header('Content-Range', `bytes */${result.stat.size}`)
          .send({ error: 'Range not satisfiable' });
      }

      const chunkSize = end - start + 1;

      // Set headers for partial content response
      reply
        .code(206) // Partial Content
        .header('Content-Range', `bytes ${start}-${end}/${result.stat.size}`)
        .header('Content-Length', chunkSize.toString());

      // Stream the requested range using factory function with range options
      await reply.send(result.content.createStream({ start, end }));
      return { served: true, statusCode: 206 };
    }

    // Serve full file based on whether streaming is needed
    if (result.content.shouldStream) {
      // Large file - stream from disk using factory function
      await reply.send(result.content.createStream());
    } else {
      // Small file - send buffered data directly
      // This avoids redundant filesystem operations
      await reply.send(result.content.data);
    }

    return { served: true, statusCode: 200 };
  }

  /**
   * Clears all caches (useful for testing or cache invalidation)
   */
  public clearCaches(): void {
    this.etagCache.clear();
    this.contentCache.clear();
    this.statCache.clear();
  }

  /**
   * Gets statistics about cache usage
   */
  public getCacheStats() {
    return {
      etag: {
        items: this.etagCache.size,
        byteSize: this.etagCache.byteSize,
      },
      content: {
        items: this.contentCache.size,
        byteSize: this.contentCache.byteSize,
      },
      stat: {
        items: this.statCache.size,
        byteSize: this.statCache.byteSize,
      },
    };
  }

  /**
   * Updates the static content configuration at runtime
   *
   * This method allows you to dynamically update file mappings without restarting
   * the server. Useful for SSG scenarios where the full mapping is regenerated.
   *
   * **Important:** When providing a section, you must provide the COMPLETE mapping for that section.
   * - If you provide `singleAssetMap`, it replaces the entire single asset map
   * - If you provide `folderMap`, it replaces the entire folder map
   * - You can update one section, the other, or both
   * - Omitted sections remain unchanged
   *
   * **Cache invalidation strategy:**
   * - `singleAssetMap` changes: Only invalidates specific filesystem paths that changed
   * - `folderMap` changes: Clears all caches (folder changes are structural)
   *
   * @param newConfig Complete mapping(s) for the section(s) you want to update
   *
   * @example Update only single asset mappings
   * ```typescript
   * cache.updateConfig({
   *   singleAssetMap: {
   *     '/': './dist/index.html',
   *     '/blog/new-post': './dist/blog/new-post.html'
   *   }
   * });
   * ```
   *
   * @example Update only folder mappings
   * ```typescript
   * cache.updateConfig({
   *   folderMap: {
   *     '/assets': { path: './dist/assets', detectImmutableAssets: true }
   *   }
   * });
   * ```
   *
   * @example Update both sections
   * ```typescript
   * cache.updateConfig({
   *   singleAssetMap: { '/': './dist/index.html' },
   *   folderMap: { '/assets': './dist/assets' }
   * });
   * ```
   */
  public updateConfig(newConfig: {
    singleAssetMap?: Record<string, string>;
    folderMap?: Record<string, string | FolderConfig>;
  }): void {
    // Handle singleAssetMap - smart invalidation of specific filesystem paths
    if (newConfig.singleAssetMap !== undefined) {
      const newMap = this.normalizeSingleAssetMap(newConfig.singleAssetMap);

      // Track filesystem paths that need cache invalidation
      const pathsToInvalidate = new Set<string>();

      // Loop 1: Iterate over OLD map to find filesystem paths that are no longer in use
      // Example: '/page' used to point to '/dist/old.html', now points to '/dist/new.html'
      // Result: Invalidate '/dist/old.html' (the old file's cache is stale)
      for (const [url, oldFsPath] of this.singleAssetMap.entries()) {
        const newFsPath = newMap.get(url);

        // If URL was removed OR now points to a different file, invalidate OLD filesystem path
        if (newFsPath === undefined || newFsPath !== oldFsPath) {
          pathsToInvalidate.add(oldFsPath);
        }
      }

      // Loop 2: Iterate over NEW map to find filesystem paths that changed
      // Example: '/page' used to point to '/dist/old.html', now points to '/dist/new.html'
      // Result: Invalidate '/dist/new.html' (ensure fresh read from disk)
      // IMPORTANT: This prevents serving stale cached data if the new file was already cached
      // from a previous mapping (e.g., same file was previously mapped to a different URL)
      for (const [url, newFsPath] of newMap.entries()) {
        const oldFsPath = this.singleAssetMap.get(url);

        // Only invalidate NEW filesystem path if URL existed before AND now points to different file
        if (oldFsPath !== undefined && oldFsPath !== newFsPath) {
          pathsToInvalidate.add(newFsPath);
        }
      }

      // Replace the map
      this.singleAssetMap = newMap;

      // Invalidate caches for affected filesystem paths only
      for (const fsPath of pathsToInvalidate) {
        this.etagCache.delete(fsPath);
        this.contentCache.delete(fsPath);
        this.statCache.delete(fsPath);
      }
    }

    // Handle folderMap - clear all caches only if it changed
    if (newConfig.folderMap !== undefined) {
      const newFolderMap = this.normalizeFolderMap(newConfig.folderMap);

      // Check if folderMap actually changed
      // Note: Can't just compare size - could have same number of folders but different prefixes/configs
      let hasFolderMapChanged = false;

      // Quick check: if sizes differ, it definitely changed
      if (this.folderMap.size !== newFolderMap.size) {
        hasFolderMapChanged = true;
      } else {
        // Sizes match - need to check if any prefix or config changed
        for (const [prefix, config] of newFolderMap.entries()) {
          const oldConfig = this.folderMap.get(prefix);

          if (!oldConfig || !this.isSameFolderConfig(oldConfig, config)) {
            hasFolderMapChanged = true;
            break;
          }
        }
      }

      this.folderMap = newFolderMap;

      // Only clear all caches if folderMap actually changed
      // Folder mapping changes are rare and structural - clearing everything is safe
      if (hasFolderMapChanged) {
        this.clearCaches();
      }
    }
  }

  /**
   * Handles an HTTP request by resolving the URL to a file path and serving it
   *
   * This is a convenience method that combines URL resolution with file serving.
   * If no file matches the URL, it returns without sending a response (lets the hook fall through).
   *
   * @param rawURL The raw request URL (may include query string or hash)
   * @param req The Fastify request object
   * @param reply The Fastify reply object
   * @returns Information about whether a file was served
   */
  public async handleRequest(
    rawURL: string,
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<ServeFileResult> {
    // Strip off query string, hash, etc., and ensure a single leading slash for matching
    const cleanedURL = rawURL.split('?')[0].split('#')[0];
    const url = cleanedURL.startsWith('/') ? cleanedURL : '/' + cleanedURL;

    // Security: Reject URLs containing null bytes to prevent path truncation attacks
    if (url.includes('\0')) {
      return { served: false, reason: 'not-found' };
    }

    let resolved = '';
    let shouldDetectImmutable = false;

    // 1. Try singleAssetMap first (exact URL → file)
    if (this.singleAssetMap.has(url)) {
      resolved = this.singleAssetMap.get(url) as string;
    }
    // 2. If not matched, try folderMap (URL prefix → directory)
    else {
      const folder = Array.from(this.folderMap.keys()).find((prefix) =>
        url.startsWith(prefix),
      );

      if (folder) {
        // Get resolved base folder and config
        const folderConfig = this.folderMap.get(folder);

        if (folderConfig) {
          // Calculate file path relative to the matched prefix
          const relativePath = url.slice(folder.length);

          // Guard against absolute path behavior if a leading slash sneaks in
          const safeRelativePath = relativePath.startsWith('/')
            ? relativePath.slice(1)
            : relativePath;

          // Only allow files that don't contain '..' to prevent directory traversal
          if (
            !safeRelativePath.includes('../') &&
            !safeRelativePath.includes('..\\')
          ) {
            resolved = path.join(folderConfig.path, safeRelativePath);
            shouldDetectImmutable = folderConfig.detectImmutableAssets ?? false;
          }
        }
      }
    }

    // If we found a file to serve, serve it
    // otherwise: return not-found (let hook fall through)
    if (resolved) {
      return this.serveFile(req, reply, resolved, { shouldDetectImmutable });
    }

    return { served: false, reason: 'not-found' };
  }

  /**
   * Normalizes single asset map keys to ensure leading slash
   * Also validates against null bytes to prevent path injection
   */
  private normalizeSingleAssetMap(
    singleAssetMap: Record<string, string>,
  ): Map<string, string> {
    const normalized = new Map<string, string>();

    for (const [key, value] of Object.entries(singleAssetMap)) {
      // Security: Skip entries with null bytes to prevent path truncation attacks
      if (key.includes('\0') || value.includes('\0')) {
        if (this.logger) {
          this.logger.warn(
            { key, value },
            'Skipping singleAssetMap entry with null byte',
          );
        }

        continue;
      }

      const normalizedKey = key.startsWith('/') ? key : '/' + key;
      normalized.set(normalizedKey, value);
    }

    return normalized;
  }

  /**
   * Normalizes folder map with proper prefix formatting
   * Also validates against null bytes to prevent path injection
   *
   * Handles two config formats:
   * 1. String shorthand: { "/assets/": "/path/to/assets" }
   * 2. Full config object: { "/assets/": { path: "/path/to/assets", detectImmutableAssets: true } }
   */
  private normalizeFolderMap(
    folderMap: Record<string, string | FolderConfig>,
  ): Map<string, FolderConfig> {
    const normalized = new Map<string, FolderConfig>();

    for (const [prefix, config] of Object.entries(folderMap)) {
      const normalizedPrefix = this.normalizePrefix(prefix);

      // Security: Skip entries with null bytes to prevent path truncation attacks
      const configPath = typeof config === 'string' ? config : config.path;
      if (prefix.includes('\0') || configPath.includes('\0')) {
        if (this.logger) {
          this.logger.warn(
            { prefix, configPath },
            'Skipping folderMap entry with null byte',
          );
        }

        continue;
      }

      // Handle string shorthand: just a directory path
      if (typeof config === 'string') {
        normalized.set(normalizedPrefix, {
          path: config,
          detectImmutableAssets: false,
        });
      } else {
        // Handle full config object with optional detectImmutableAssets
        normalized.set(normalizedPrefix, {
          path: config.path,
          detectImmutableAssets: config.detectImmutableAssets ?? false,
        });
      }
    }

    return normalized;
  }

  /**
   * Normalizes URL prefix: ensures leading and trailing slash, collapses multiple slashes
   */
  private normalizePrefix(prefix: string): string {
    let p = prefix || '/';

    // Collapse multiple consecutive slashes into a single slash
    p = p.replace(/\/+/g, '/');

    if (!p.startsWith('/')) {
      p = '/' + p;
    }

    if (!p.endsWith('/')) {
      p = p + '/';
    }

    return p;
  }

  /**
   * Gets the MIME type for a file based on its extension
   */
  private getMimeType(filePath: string): string {
    // Strip the leading dot from the extension
    const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');

    // Map common extensions to MIME types (alphabetical order)
    const mimeTypes: Record<string, string> = {
      css: 'text/css',
      gif: 'image/gif',
      html: 'text/html',
      ico: 'image/x-icon',
      jpeg: 'image/jpeg',
      jpg: 'image/jpeg',
      js: 'application/javascript',
      json: 'application/json',
      mp4: 'video/mp4',
      pdf: 'application/pdf',
      png: 'image/png',
      svg: 'image/svg+xml',
      txt: 'text/plain',
      webmanifest: 'application/manifest+json',
      xml: 'application/xml',
    };

    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Compares two FolderConfig objects for equality
   * Dynamically checks all properties so we don't need to update this if FolderConfig changes
   */
  private isSameFolderConfig(a: FolderConfig, b: FolderConfig): boolean {
    const keysA = Object.keys(a) as (keyof FolderConfig)[];
    const keysB = Object.keys(b) as (keyof FolderConfig)[];

    // Different number of keys means they're not equal
    if (keysA.length !== keysB.length) {
      return false;
    }

    // Check all keys from a (sufficient now since lengths match)
    return keysA.every((key) => a[key] === b[key]);
  }

  /**
   * Checks if a file appears to be fingerprinted/immutable based on filename
   *
   * Detects common build tool fingerprinting patterns:
   * - .{hash}.{ext} format (e.g., main.a1b2c3d4.js, styles.CTpDmzGw.css)
   * - -{hash}.{ext} format (e.g., chunk-a1b2c3d4.js, vendor-5f8e9a2b.js)
   *
   * Hash must be at least 6 alphanumeric characters
   *
   * @param filePath The file path to check
   * @returns True if the file appears to be fingerprinted
   */
  private isImmutableAsset(filePath: string): boolean {
    const fileBasename = path.basename(filePath);

    // Check for fingerprint patterns:
    // 1. .{hash}.{ext} pattern (e.g., main.CTpDmzGw.js)
    // 2. -{hash}.{ext} pattern (e.g., chunk-CTpDmzGw.js)
    return (
      /\.[A-Za-z0-9]{6,}\./.test(fileBasename) ||
      /-[A-Za-z0-9]{6,}\./.test(fileBasename)
    );
  }
}

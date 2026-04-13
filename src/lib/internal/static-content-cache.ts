import type { FastifyRequest, FastifyReply } from 'fastify';
import type { OutgoingHttpHeaders } from 'node:http';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { LRUCache, type LRUCacheChangeEvent } from 'lifecycleion/lru-cache';
import type { StaticContentRouterOptions, FolderConfig } from '../types';
import { addToVaryHeader } from './http-header-utils';
import {
  buildEncodedETag,
  compressPayload,
  isCompressibleContentType,
  matchesIfNoneMatch,
  normalizeResponseCompressionOptions,
  selectResponseEncoding,
} from './response-compression';

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

type CompressedVariantState =
  | {
      kind: 'compressed';
      data: Buffer;
    }
  | {
      kind: 'not-worth-it';
    }
  | {
      kind: 'tombstone';
    };

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
  /** Accepted content encodings from the request for representation selection */
  acceptEncoding?: string | string[];
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
  | {
      served: true;
      statusCode:
        | 200 // Full file served
        | 206 // Partial content served
        | 304 // Not modified
        | 400 // Invalid range request
        | 416; // Range not satisfiable
    };

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
  /** Generated ETag for the selected response representation */
  etag: string;
  /** Last-Modified date as HTTP header string */
  lastModified: string;
  /** Selected content encoding, if a compressed representation was chosen */
  contentEncoding?: 'br' | 'gzip';
  /** Whether the response should include `Vary: Accept-Encoding` */
  varyByAcceptEncoding: boolean;
}

/**
 * Result when file is found and should be served (200)
 */
export interface FileFoundResult {
  status: 'ok';
  /** File stats (size, modification time, etc.) */
  stat: MinimalStatInfo;
  /** Generated ETag for the selected response representation */
  etag: string;
  /** Base file ETag before representation-specific encoding suffixes */
  baseETag: string;
  /** Last-Modified date as HTTP header string */
  lastModified: string;
  /** MIME type based on file extension */
  mimeType: string;
  /** File content - either buffered or needs streaming */
  content: FileContent;
  /** Selected content encoding, if a compressed representation was chosen */
  contentEncoding?: 'br' | 'gzip';
  /** Whether the response should include `Vary: Accept-Encoding` */
  varyByAcceptEncoding: boolean;
  /** Whether this file appears to be fingerprinted/immutable (for aggressive caching) */
  isImmutableAsset: boolean;
}

function waitForReadStreamOpen(stream: fs.ReadStream): Promise<void> {
  if (
    stream.pending === false ||
    typeof (stream as fs.ReadStream & { fd?: number }).fd === 'number'
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      stream.off('open', onOpen);
      stream.off('error', onError);
    };

    stream.once('open', onOpen);
    stream.once('error', onError);
  });
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
 * Parse a Range header into [start, end] byte offsets (both inclusive).
 *
 * Supports:
 *   bytes=0-499      explicit range
 *   bytes=500-       from offset to end of file
 *   bytes=-500       last 500 bytes (suffix range)
 *
 * Returns [start, end] on success.
 * Returns 'malformed' (→ 400) for syntactically invalid headers (no bytes= prefix, bad spec format).
 * Returns 'unsatisfiable' (→ 416) for multipart ranges or ranges that exceed the file size.
 */
function parseRange(
  header: string,
  fileSize: number,
): [number, number] | 'malformed' | 'unsatisfiable' {
  if (!header.startsWith('bytes=')) {
    return 'malformed';
  }

  const spec = header.slice(6);

  // Reject multipart ranges (satisfiable syntax, but unsupported)
  if (spec.includes(',')) {
    return 'unsatisfiable';
  }

  const match = /^(\d*)-(\d*)$/.exec(spec);

  if (!match) {
    return 'malformed';
  }

  const startStr = match[1];
  const endStr = match[2];

  if (startStr === '' && endStr === '') {
    return 'malformed';
  }

  let start: number;
  let end: number;

  if (startStr === '') {
    // Suffix range: bytes=-500 → last 500 bytes
    const suffix = parseInt(endStr, 10);
    start = Math.max(0, fileSize - suffix);
    end = fileSize - 1;
  } else if (endStr === '') {
    // Open-ended range: bytes=500-
    start = parseInt(startStr, 10);
    end = fileSize - 1;
  } else {
    start = parseInt(startStr, 10);
    end = parseInt(endStr, 10);
  }

  // Validate: start must be within file, start must not exceed end
  if (start >= fileSize || start > end) {
    return 'unsatisfiable';
  }

  // Clamp end to last valid byte
  end = Math.min(end, fileSize - 1);

  return [start, end];
}

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
  private readonly compression: ReturnType<
    typeof normalizeResponseCompressionOptions
  >;

  // LRU caches (all keyed by filesystem path)
  private readonly etagCache: LRUCache<string, string>; // fs path → ETag
  private readonly contentCache: LRUCache<string, Buffer>; // fs path → file content
  // Keyed by fs path + BASE file ETag + encoding.
  // The stored ETag component is the uncompressed file's identity; the
  // representation-specific HTTP ETag is derived later by suffixing the
  // encoding (e.g. "--gzip", "--br") when sending the response.
  private readonly compressedVariantCache: LRUCache<
    string,
    CompressedVariantState
  >; // fs path + base etag + encoding → compressed variant state
  private readonly statCache: LRUCache<string, StatCacheEntry>; // fs path → file stats
  // Reverse index of filesystem path -> compressed cache keys for that file.
  // This lets invalidateFile() clear every cached compressed representation for
  // a path without needing to know which base ETag variants are currently live.
  private readonly compressedContentIndex: Map<string, Set<string>> = new Map();

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
      compression = true,
    } = options;

    this.smallFileMaxSize = smallFileMaxSize;
    this.cacheControl = cacheControl;
    this.immutableCacheControl = immutableCacheControl;
    this.negativeCacheTtl = negativeCacheTtl;
    this.positiveCacheTtl = positiveCacheTtl;
    this.compression = normalizeResponseCompressionOptions(compression);
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

    this.compressedVariantCache = new LRUCache<string, CompressedVariantState>(
      cacheEntries,
      {
        defaultTtl,
        maxSize: contentCacheMaxSize,
        // Keep the reverse index aligned when compressed variants disappear from
        // the LRU on their own, not just when StaticContentCache deletes them.
        onChange: (event) => this.handleCompressedVariantCacheChange(event),
        onChangeReasons: ['evict', 'expired', 'delete', 'clear'],
      },
    );
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
      const {
        shouldDetectImmutable = false,
        clientETag,
        acceptEncoding,
      } = options || {};

      // Step 1: Resolve file metadata, preferably from the stat cache.
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

      // Step 2: Derive the base file validator used for identity responses and
      // as the source for encoding-specific ETags.
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

      // Determine if we should use immutable cache headers based on the filename pattern
      // A fingerprinted file typically has a name like main.a1b2c3.js or chunk-5a7d9c8b.js
      const isImmutableAsset =
        shouldDetectImmutable && this.isImmutableAsset(resolvedPath);

      // Get MIME type based on file extension
      const mimeType = this.getMimeType(resolvedPath);

      // Step 3: Load the file body as either a cached/buffered payload or a
      // stream factory, depending on size.
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

      // Step 4: Choose the response representation before checking
      // If-None-Match so gzip/br variants get their own ETags and 304 behavior.
      const shouldVaryByAcceptEncoding =
        this.compression.enabled &&
        !fileContent.shouldStream &&
        isCompressibleContentType(mimeType) &&
        fileContent.data.length >= this.compression.threshold;

      const selectedEncoding = shouldVaryByAcceptEncoding
        ? selectResponseEncoding(acceptEncoding, this.compression.preferBrotli)
        : null;
      let responseEncoding: 'br' | 'gzip' | undefined;

      // Step 5: For buffered responses, reuse or build a compressed variant if
      // the negotiated encoding is smaller than the original bytes.
      if (!fileContent.shouldStream && selectedEncoding) {
        const compressedCacheKey = this.getCompressedCacheKey(
          resolvedPath,
          etag,
          selectedEncoding,
        );

        const cachedVariant =
          this.compressedVariantCache.get(compressedCacheKey);

        let compressed =
          cachedVariant?.kind === 'compressed' ? cachedVariant.data : undefined;
        const isCompressedNotWorthIt = cachedVariant?.kind === 'not-worth-it';
        const isCompressedTombstone = cachedVariant?.kind === 'tombstone';

        if (!cachedVariant || isCompressedTombstone) {
          // A plain cache miss may leave behind a stale reverse-index entry, so
          // clean that up before recomputing. Tombstones stay tracked on
          // purpose: they still represent a live variant key that should block
          // immediate reinsertion after invalidateFile().
          if (!isCompressedTombstone) {
            this.untrackCompressedVariant(resolvedPath, compressedCacheKey);
          }

          compressed = await compressPayload(
            fileContent.data,
            selectedEncoding,
            this.compression,
          );
        }

        // Only keep an encoded variant if it is actually smaller than the
        // original bytes. Otherwise prefer the identity response and clear any
        // stale cached compressed entry for this representation.
        if (compressed && compressed.length < fileContent.data.length) {
          responseEncoding = selectedEncoding;

          // Only store compressed bytes if we do not already have them cached
          // and this exact variant key is not still inside the invalidation
          // tombstone window from a recent invalidateFile() call.
          if (
            !this.compressedVariantCache.get(compressedCacheKey) &&
            !isCompressedTombstone
          ) {
            // invalidateFile() leaves a short-lived tombstone for the old
            // path + base ETag + encoding key so an older in-flight request
            // cannot immediately repopulate a stale compressed variant.
            this.compressedVariantCache.set(compressedCacheKey, {
              kind: 'compressed',
              data: compressed,
            });

            // The reverse index groups all compressed variants for a file path
            // so invalidateFile() can clear them without knowing the current
            // base ETag or encoding ahead of time.
            const existingCompressedKeys =
              this.compressedContentIndex.get(resolvedPath);

            if (existingCompressedKeys) {
              existingCompressedKeys.add(compressedCacheKey);
            } else {
              this.compressedContentIndex.set(
                resolvedPath,
                new Set([compressedCacheKey]),
              );
            }
          }

          fileContent = {
            shouldStream: false,
            data: compressed,
          };
        } else {
          // Only record a fresh negative result. Reuse existing tombstones and
          // prior "not worth it" decisions instead of resetting their state.
          if (!isCompressedNotWorthIt && !isCompressedTombstone) {
            // Record that this exact variant key negotiated successfully but
            // did not beat the identity response, so future requests can skip
            // recompressing until the file version changes or the entry expires.
            this.compressedVariantCache.delete(compressedCacheKey);
            this.compressedVariantCache.set(compressedCacheKey, {
              kind: 'not-worth-it',
            });

            // Track negative variant decisions in the same reverse index so
            // invalidateFile() can clear all per-variant state for the path.
            const existingVariantKeys =
              this.compressedContentIndex.get(resolvedPath);

            if (existingVariantKeys) {
              existingVariantKeys.add(compressedCacheKey);
            } else {
              this.compressedContentIndex.set(
                resolvedPath,
                new Set([compressedCacheKey]),
              );
            }
          }
        }
      }

      const responseETag = responseEncoding
        ? buildEncodedETag(etag, responseEncoding)
        : etag;

      if (clientETag && matchesIfNoneMatch(clientETag, responseETag)) {
        return {
          status: 'not-modified',
          etag: responseETag,
          lastModified,
          contentEncoding: responseEncoding,
          varyByAcceptEncoding: shouldVaryByAcceptEncoding,
        };
      }

      return {
        status: 'ok',
        stat,
        etag: responseETag,
        baseETag: etag,
        lastModified,
        mimeType,
        content: fileContent,
        contentEncoding: responseEncoding,
        varyByAcceptEncoding: shouldVaryByAcceptEncoding,
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
    // Raw static responses use reply.hijack() + writeHead(), which bypasses
    // Fastify's normal onSend pipeline. Built-in CORS exposes a request-scoped
    // helper so hijacked paths can still apply the same actual-response headers
    // before we snapshot reply.getHeaders(). Keep this ahead of hijack so a
    // CORS/config failure still propagates through normal Fastify error
    // handling instead of failing after raw ownership has been taken.

    // Get file with all metadata and caching
    const result = await this.getFile(resolvedPath, {
      ...options,
      // Extract client cache validation header (ETag-based validation).
      clientETag: req.headers['if-none-match'],
      // Pass through Accept-Encoding so getFile() can choose the response
      // representation before doing ETag/304 handling.
      acceptEncoding: req.headers['accept-encoding'],
    });

    // Handle different result statuses
    if (result.status === 'not-found') {
      // File not found, return early (let hook fall through to 404)
      return { served: false, reason: 'not-found' };
    } else if (result.status === 'error') {
      // Unexpected error occurred, return error info
      return { served: false, reason: 'error', error: result.error };
    } else if (result.status === 'not-modified') {
      // Client's cache is still valid, send 304.
      // Return HTTP 304 Not Modified response (no body). This saves bandwidth
      // because the client reuses its cached representation.
      //
      // reply.hijack() bypasses Fastify's onSend pipeline (including the generic
      // response-compression hook), so we write directly to the raw socket.
      // onResponse hooks still fire because setupResponseListeners attaches to
      // reply.raw.on('finish', ...) before any hooks run.

      // Representation selection depends on Accept-Encoding, so advertise that
      // caches must keep separate variants when compression is in play.
      if (result.varyByAcceptEncoding) {
        addToVaryHeader(reply, 'Accept-Encoding');
      }

      // A 304 carries metadata for the representation the client validated, so
      // keep Content-Encoding aligned with the selected cached variant.
      if (result.contentEncoding) {
        reply.header('Content-Encoding', result.contentEncoding);
      }

      reply
        .code(304)
        .header('ETag', result.etag)
        .header('Last-Modified', result.lastModified);

      await req.applyCORSHeaders?.(reply);
      reply.hijack();
      reply.raw.writeHead(304, reply.getHeaders() as OutgoingHttpHeaders);
      reply.raw.end();

      return { served: true, statusCode: 304 };
    }

    // File found (status === 'ok'), proceed with serving.
    //
    // reply.hijack() bypasses Fastify's onSend pipeline entirely, preventing
    // the generic response-compression hook from re-processing a response whose
    // representation (identity/gzip/br) and ETag were already finalized by
    // getFile(). Without hijack(), the compression hook could re-compress an
    // identity response and mutate the ETag the client already validated against.

    // Determine Cache-Control header based on immutability
    const headerCacheControl = result.isImmutableAsset
      ? this.immutableCacheControl
      : this.cacheControl;

    // Representation selection depends on Accept-Encoding, so advertise that
    // caches must keep separate variants when compression is in play.
    if (result.varyByAcceptEncoding) {
      addToVaryHeader(reply, 'Accept-Encoding');
    }

    // Only encoded representations send Content-Encoding; identity responses
    // intentionally omit it even when compression was considered.
    if (result.contentEncoding) {
      reply.header('Content-Encoding', result.contentEncoding);
    }

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
      const range = parseRange(rangeHeader, result.stat.size);

      if (range === 'malformed') {
        // Bad Request — syntactically invalid Range header
        const body = JSON.stringify({ error: 'Invalid Range header' });
        reply
          .code(400)
          .header('Cache-Control', 'no-store')
          .type('application/json')
          .header('Content-Length', String(Buffer.byteLength(body)));
        await req.applyCORSHeaders?.(reply);
        reply.hijack();
        reply.raw.writeHead(400, reply.getHeaders() as OutgoingHttpHeaders);
        reply.raw.end(req.method === 'HEAD' ? undefined : body);
        return { served: true, statusCode: 400 };
      } else if (range === 'unsatisfiable') {
        const body = JSON.stringify({ error: 'Range not satisfiable' });
        reply
          .code(416)
          .header('Cache-Control', 'no-store')
          .type('application/json')
          .header('Content-Range', `bytes */${result.stat.size}`)
          .header('Content-Length', String(Buffer.byteLength(body)));
        await req.applyCORSHeaders?.(reply);
        reply.hijack();
        reply.raw.writeHead(416, reply.getHeaders() as OutgoingHttpHeaders);
        reply.raw.end(req.method === 'HEAD' ? undefined : body);
        return { served: true, statusCode: 416 };
      }

      const [start, end] = range;
      const chunkSize = end - start + 1;
      const rangeStream = result.content.createStream({ start, end });

      await waitForReadStreamOpen(rangeStream);

      // Set headers for partial content response
      reply
        .code(206) // Partial Content
        .header('Content-Range', `bytes ${start}-${end}/${result.stat.size}`)
        .header('Content-Length', chunkSize.toString());

      await req.applyCORSHeaders?.(reply);
      reply.hijack();
      reply.raw.writeHead(206, reply.getHeaders() as OutgoingHttpHeaders);

      // HEAD — headers are set; skip stream creation entirely (no fd opened, no disk I/O)
      if (req.method === 'HEAD') {
        reply.raw.end();
        return { served: true, statusCode: 206 };
      }

      // Stream the requested range using factory function with range options
      await pipeline(rangeStream, reply.raw);
      return { served: true, statusCode: 206 };
    }

    // HEAD — set Content-Length from stat, then end without a body
    if (req.method === 'HEAD') {
      // When the response would be compressed, report the compressed size so
      // the Content-Length matches what a GET would actually transfer.
      // Compressed responses are always buffered (!shouldStream), so narrow first.
      const headContentLength =
        result.contentEncoding && !result.content.shouldStream
          ? result.content.data.length
          : result.stat.size;
      reply.header('Content-Length', headContentLength.toString());
      await req.applyCORSHeaders?.(reply);
      reply.hijack();
      reply.raw.writeHead(
        reply.statusCode,
        reply.getHeaders() as OutgoingHttpHeaders,
      );
      reply.raw.end();
      return { served: true, statusCode: 200 };
    }

    // Serve full file based on whether streaming is needed
    const fullFileStream = result.content.shouldStream
      ? result.content.createStream()
      : null;

    if (fullFileStream) {
      await waitForReadStreamOpen(fullFileStream);
    }

    await req.applyCORSHeaders?.(reply);

    if (!result.content.shouldStream) {
      // reply.raw.end(buffer) does not get Fastify's normal Content-Length
      // inference, so buffered 200 responses must set it explicitly here.
      reply.header('Content-Length', result.content.data.length.toString());
    }

    reply.hijack();
    reply.raw.writeHead(200, reply.getHeaders() as OutgoingHttpHeaders);

    if (result.content.shouldStream) {
      // Large file — stream from disk directly to the socket.
      // pipeline() propagates backpressure and destroys the stream on error.
      await pipeline(fullFileStream as fs.ReadStream, reply.raw);
    } else {
      // Small file — send the buffered bytes in a single write.
      reply.raw.end(result.content.data);
    }

    return { served: true, statusCode: 200 };
  }

  /**
   * Replaces routing maps and clears all file caches in one shot.
   *
   * Use this after a full build has completed. Unlike `updateConfig`, this method
   * makes no attempt at smart per-path invalidation — it simply replaces
   * whichever maps you provide and wipes the content, stat, and ETag caches
   * unconditionally, guaranteeing fresh reads for the next request.
   *
   * You may pass `singleAssetMap`, `folderMap`, or both. Omitted sections retain
   * their current routing configuration. Pass an empty object (`{}`) for a
   * section to clear all mappings in that section. All file caches are always
   * cleared, regardless of which sections are provided — even when only
   * `singleAssetMap` is passed, the rebuilt HTML pages likely reference JS/CSS
   * bundles served from `folderMap` directories that were also regenerated in
   * the same build step, so preserving folder caches would risk serving stale
   * assets alongside fresh pages.
   *
   * For targeted cache invalidation (when URL-to-path mappings changed but
   * file contents at those paths are unchanged), use `updateConfig` instead.
   * Note: `updateConfig` does not detect in-place file content changes — it
   * only tracks which filesystem paths entered or left the map.
   *
   * @param newConfig Sections to replace (at least one should be provided)
   *
   * @example
   * ```typescript
   * // After an SSG build completes (page map only):
   * cache.replaceConfig({ singleAssetMap: await loadPageMap() });
   *
   * // After a build that changes both pages and asset folders:
   * cache.replaceConfig({
   *   singleAssetMap: await loadPageMap(),
   *   folderMap: { '/assets/': { path: './dist/assets', detectImmutableAssets: true } },
   * });
   * ```
   */
  public replaceConfig(newConfig: {
    singleAssetMap?: Record<string, string>;
    folderMap?: Record<string, string | FolderConfig>;
  }): void {
    if (newConfig.singleAssetMap !== undefined) {
      this.singleAssetMap = this.normalizeSingleAssetMap(
        newConfig.singleAssetMap,
      );
    }

    if (newConfig.folderMap !== undefined) {
      this.folderMap = this.normalizeFolderMap(newConfig.folderMap);
    }

    // Always clear all caches — no smart invalidation.
    // A build can change file contents in-place without renaming files,
    // so preserving any cached content or stat data would risk stale reads.
    this.clearCaches();
  }

  /**
   * Evicts a single file's cached content, stat, and ETag without touching
   * any URL-to-path mappings.
   *
   * Use this when you know a specific file changed on disk and want to force
   * a fresh read on the next request — without flushing the entire cache.
   * Works for files served via `singleAssetMap` or `folderMap`.
   *
   * The parameter is the **filesystem path** (as it appears in the cache key),
   * not a URL.
   *
   * For `singleAssetMap` entries these are the absolute paths you
   * provided.
   *
   * For folder-served files the cache key is the absolute path
   * resolved at request time.
   *
   * @param fsPath Absolute filesystem path of the file to evict
   *
   * @example
   * ```typescript
   * // A file watcher detected /dist/about.html was rewritten:
   * cache.invalidateFile('/dist/about.html');
   * ```
   */
  public invalidateFile(fsPath: string): void {
    this.etagCache.delete(fsPath);
    this.contentCache.delete(fsPath);
    this.statCache.delete(fsPath);
    this.invalidateCompressedVariants(fsPath);
  }

  /**
   * Clears all caches (useful for testing or cache invalidation)
   */
  public clearCaches(): void {
    this.etagCache.clear();
    this.contentCache.clear();
    this.compressedVariantCache.clear();
    this.statCache.clear();
    this.compressedContentIndex.clear();
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
      compressedVariants: {
        items: this.compressedVariantCache.size,
        byteSize: this.compressedVariantCache.byteSize,
      },
      stat: {
        items: this.statCache.size,
        byteSize: this.statCache.byteSize,
      },
    };
  }

  /**
   * Updates the static content configuration at runtime with targeted cache
   * invalidation — only evicting entries whose URL-to-path mapping changed.
   *
   * Use this when URL routing is changing but file contents at existing paths
   * are unchanged (e.g., adding or removing pages without rebuilding assets).
   * For post-build reloads where file contents may have changed, use
   * `replaceConfig` instead.
   *
   * **Important:** When providing a section, you must provide the COMPLETE mapping for that section.
   * - If you provide `singleAssetMap`, it replaces the entire single asset map
   * - If you provide `folderMap`, it replaces the entire folder map
   * - You can update one section, the other, or both
   * - Omitted sections remain unchanged
   *
   * **Cache invalidation strategy:**
   * - `singleAssetMap` changes: Only invalidates filesystem paths whose URL-to-path
   *   *mapping* changed (added, removed, or pointed to a different file). Paths whose
   *   mapping is unchanged are not evicted — this method has no visibility into whether
   *   the file content on disk changed. If files were rebuilt in-place, use
   *   `replaceConfig` instead.
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
        this.invalidateCompressedVariants(fsPath);
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

  private getCompressedCacheKey(
    resolvedPath: string,
    etag: string,
    encoding: string,
  ): string {
    return `${resolvedPath}::${etag}::${encoding}`;
  }

  private invalidateCompressedVariants(fsPath: string): void {
    // Leave a short-lived tombstone for each invalidated compressed variant so
    // an older in-flight request cannot immediately repopulate the same stale
    // path + base ETag + encoding entry after invalidateFile() runs.
    const keys = this.compressedContentIndex.get(fsPath);

    if (!keys) {
      return;
    }

    for (const key of keys) {
      // Replace the current variant state with a short-lived tombstone so an
      // older in-flight request cannot immediately repopulate the same stale
      // compressed variant after invalidateFile() runs.
      this.compressedVariantCache.set(key, { kind: 'tombstone' }, 5 * 1000);
    }

    this.compressedContentIndex.delete(fsPath);
  }

  private handleCompressedVariantCacheChange(
    event: LRUCacheChangeEvent<string, CompressedVariantState>,
  ): void {
    if (
      event.reason !== 'evict' &&
      event.reason !== 'expired' &&
      event.reason !== 'delete' &&
      event.reason !== 'clear'
    ) {
      return;
    }

    // The compressed LRU is keyed by path + base ETag + encoding, but the
    // reverse index is keyed only by filesystem path.
    this.untrackCompressedVariantByKey(event.key);
  }

  private untrackCompressedVariantByKey(cacheKey: string): void {
    // Compressed cache keys are stored as path + base ETag + encoding, so drop
    // the final two segments to recover the filesystem path used by the index.
    const keyParts = cacheKey.split('::');
    const fsPath = keyParts.slice(0, -2).join('::');

    this.untrackCompressedVariant(fsPath, cacheKey);
  }

  private untrackCompressedVariant(fsPath: string, cacheKey: string): void {
    // Missing index state is harmless here. This map only helps invalidate all
    // variant keys for a file path later, it is not consulted when choosing
    // what bytes or variant state to serve for the current request.
    const existing = this.compressedContentIndex.get(fsPath);

    if (!existing) {
      return;
    }

    existing.delete(cacheKey);

    // Remove the path entry entirely once no compressed variants remain for it.
    if (existing.size === 0) {
      this.compressedContentIndex.delete(fsPath);
    }
  }
}

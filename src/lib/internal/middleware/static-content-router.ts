import fp from "fastify-plugin";
import { FastifyPluginAsync, FastifyRequest, FastifyReply } from "fastify";
import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import LRUCache from "../lru-cache";
import type { StaticContentRouterOptions } from "../../types";

/**
 * A Fastify plugin that serves only explicitly mapped static files or directories,
 * without globbing or scanning the entire public folder on every request.
 *
 * Rationale:
 * - Unlike generic static handlers which may check disk for every path or apply
 *   wildcard matching, this plugin only hits the filesystem when:
 *     1) the request URL exactly matches an entry in `singleAssetMap`, or
 *     2) it falls under a configured prefix in `folderMap`.
 * - Adds strong ETag support with optional LRU caching of ETag values and small file content.
 * - Caches file stat results to avoid repeated `stat()` calls.
 * - This minimizes unnecessary disk I/O, improves performance, and locks down
 *   asset serving to known files and directories, preventing accidental exposure
 *   or directory traversal beyond the intended public paths.
 */

const StaticContentRouterPlugin: FastifyPluginAsync<
  StaticContentRouterOptions
> = async (fastify, options) => {
  const {
    singleAssetMap = {},
    folderMap = {},
    smallFileMaxSize = 5 * 1024 * 1024, // 5 MB
    cacheEntries = 100,
    contentCacheMaxSize = 50 * 1024 * 1024, // 50 MB
    statCacheEntries = 250, // Higher default since this includes 404s and failures
    negativeCacheTtl = 30 * 1000, // 30 seconds TTL for negative cache entries
    positiveCacheTtl = 60 * 60 * 1000, // 1 hour TTL for positive entries
    cacheControl = "public, max-age=0, must-revalidate",
    immutableCacheControl = "public, max-age=31536000, immutable",
  } = options;

  // Process folder map to normalize config objects
  const normalizedFolderMap = new Map<
    string,
    { path: string; detectImmutableAssets: boolean }
  >();
  Object.entries(folderMap).forEach(([prefix, config]) => {
    if (typeof config === "string") {
      normalizedFolderMap.set(prefix, {
        path: config,
        detectImmutableAssets: false,
      });
    } else {
      normalizedFolderMap.set(prefix, {
        path: config.path,
        detectImmutableAssets: config.detectImmutableAssets ?? false,
      });
    }
  });

  // Define a minimal stat info interface with only the properties we actually use
  interface MinimalStatInfo {
    isFile: boolean;
    size: number;
    mtime: Date;
    mtimeMs: number;
  }

  // Define a negative cache entry type (for 404s and access errors)
  interface NegativeCacheEntry {
    notFound: true;
  }

  // Define a combined type for stat cache entries
  type StatCacheEntry = MinimalStatInfo | NegativeCacheEntry | null;

  // Use the same TTL for all caches
  const defaultTtl = positiveCacheTtl > 0 ? positiveCacheTtl : undefined;

  const etagCache = new LRUCache<string, string>(cacheEntries, { defaultTtl });
  const contentCache = new LRUCache<string, Buffer>(cacheEntries, {
    defaultTtl,
    maxSize: contentCacheMaxSize,
    // Use actual buffer size for size calculation
    sizeCalculator: (buffer) => buffer.length,
  });
  const statCache = new LRUCache<string, StatCacheEntry>(statCacheEntries, {
    defaultTtl,
  });

  fastify.addHook(
    "onRequest",
    async (req: FastifyRequest, reply: FastifyReply) => {
      // Exit early for non-GET requests
      if (req.method !== "GET") {
        return;
      }

      // If there's no URL, we can't handle it
      if (!req.raw.url) {
        return;
      }

      const rawUrl = req.raw.url || "/";

      // Strip off query string, hash, etc.
      const url = rawUrl.split("?")[0].split("#")[0];

      let resolved = "";
      let detectImmutable = false;

      // 1. Try singleAssetMap first (exact URL → file)
      if (Object.prototype.hasOwnProperty.call(singleAssetMap, url)) {
        resolved = singleAssetMap[url];
      }
      // 2. If not matched, try folderMap (URL prefix → directory)
      else {
        const folder = Array.from(normalizedFolderMap.keys()).find((prefix) =>
          url.startsWith(prefix),
        );

        if (folder) {
          // Get resolved base folder and config
          const folderConfig = normalizedFolderMap.get(folder);

          if (folderConfig) {
            // Calculate file path relative to the matched prefix
            const relativePath = url.slice(folder.length);

            // Only allow files that don't contain '..' to prevent directory traversal
            if (
              !relativePath.includes("../") &&
              !relativePath.includes("..\\")
            ) {
              resolved = path.join(folderConfig.path, relativePath);
              detectImmutable = folderConfig.detectImmutableAssets;
            }
          }
        }
      }

      // If we found a file to serve, do so
      // otherwise: fall through to next route/not found

      if (resolved) {
        return serveFile(req, reply, resolved, detectImmutable);
      }
    },
  );

  /**
   * Serves a static file with optimized caching and conditional responses
   *
   * This function handles:
   * - File stats caching to avoid repeated filesystem operations
   * - ETag generation and caching for efficient HTTP caching
   * - Small file content caching in memory for performance
   * - HTTP 304 Not Modified responses when browser cache is valid
   * - Proper MIME type and cache control headers
   *
   * @param req - The Fastify request object
   * @param reply - The Fastify reply object
   * @param resolved - The absolute path to the file to be served
   */

  async function serveFile(
    req: FastifyRequest,
    reply: FastifyReply,
    resolved: string,
    detectImmutable: boolean = false,
  ) {
    // Try to get file stats from cache to avoid filesystem operations
    const cachedStat = statCache.get(resolved);

    // Variable that will hold our file information
    let stat: MinimalStatInfo | null = null;

    // Handle cached entries (LRU will handle TTL expiration internally)
    if (cachedStat) {
      if ("notFound" in cachedStat) {
        // File is known to not exist
        return;
      } else if (cachedStat !== null) {
        // We have a valid cached stat, use it
        stat = cachedStat;
      }
    }

    // If stats aren't cached, retrieve them from the filesystem
    if (!stat) {
      try {
        const fullStat = await fs.promises.stat(resolved);

        // Only serve regular files, not directories or special files
        if (!fullStat.isFile()) {
          // Cache as negative entry with specific TTL
          statCache.set(
            resolved,
            {
              notFound: true,
            },
            negativeCacheTtl,
          );
          return;
        }

        // Extract only the properties we need to minimize memory usage
        stat = {
          isFile: true, // We know it's a file at this point
          size: fullStat.size,
          mtime: fullStat.mtime,
          mtimeMs: fullStat.mtimeMs,
        };

        // Cache the minimal stats for future requests
        // The TTL was already set when creating the cache
        statCache.set(resolved, stat);
      } catch (error) {
        // File doesn't exist or can't be accessed
        // Cache as negative entry with specific TTL
        statCache.set(
          resolved,
          {
            notFound: true,
          },
          negativeCacheTtl,
        );

        // Log unexpected errors (like permission issues) but not 'file not found' errors
        // ENOENT is expected for files that don't exist and shouldn't be logged
        if (
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code !== "ENOENT"
        ) {
          fastify.log.warn(
            {
              err: error,
              path: resolved,
            },
            "Unexpected error accessing static file",
          );
        }
        return;
      }
    }

    // Generate Last-Modified header from file modification time
    const lastModified = stat.mtime.toUTCString();
    // Try to get ETag from cache
    let etag = etagCache.get(resolved);

    // Generate a new ETag if not cached
    if (!etag) {
      // For small files: create a content-based strong ETag using SHA-256
      if (stat.size <= smallFileMaxSize) {
        // Try to get file content from cache
        let buf = contentCache.get(resolved);

        // If content not cached, read and cache it
        if (!buf) {
          try {
            buf = await fs.promises.readFile(resolved);
            contentCache.set(resolved, buf);
          } catch (error) {
            // Log unexpected errors when reading file content
            // Cast to NodeJS.ErrnoException to access error codes if needed
            const fsError = error as NodeJS.ErrnoException;
            fastify.log.warn(
              {
                err: fsError,
                path: resolved,
                code: fsError.code,
              },
              "Error reading static file content",
            );

            throw error; // Re-throw to be handled by the outer error handling
          }
        }

        // Generate a strong hash-based ETag from file content
        const hash = crypto.createHash("sha256").update(buf).digest("base64");
        etag = `"${hash}"`;
      } else {
        // For large files: create a weak ETag based on size and modification time
        // Using W/ prefix to indicate a weak validator per RFC specs
        etag = `W/"${stat.size}-${Number(stat.mtimeMs)}"`;
      }

      // Cache the ETag for future requests
      etagCache.set(resolved, etag);
    }

    // Extract client cache validation header (ETag-based validation)
    const ifNoneMatch = req.headers["if-none-match"];

    // Check if client cache is still valid using ETag (more precise than If-Modified-Since)
    if (ifNoneMatch === etag) {
      // Return HTTP 304 Not Modified response (no body)
      // This saves bandwidth as the client will use its cached version
      return reply.code(304).send();
    }

    // Determine if we should use immutable cache headers based on the filename pattern
    // A fingerprinted file typically has a name like main.a1b2c3.js or chunk-5a7d9c8b.js
    let headerCacheControl = cacheControl;
    if (detectImmutable) {
      // Check for fingerprint pattern: either .{hash}. or -{hash} format
      // Matches patterns like main.a1b2c3d4.js or chunk-a1b2c3d4.js
      const fileBasename = path.basename(resolved);

      if (
        // Match .{hash}.{ext} pattern (e.g., main.CTpDmzGw.js)
        /\.[A-Za-z0-9]{6,}\./.test(fileBasename) ||
        // Match -{hash}.{ext} pattern (e.g., chunk-CTpDmzGw.js)
        /-[A-Za-z0-9]{6,}\./.test(fileBasename)
      ) {
        headerCacheControl = immutableCacheControl;
      }
    }

    // Set cache validation headers for future requests
    reply
      .header("Last-Modified", lastModified)
      .header("ETag", etag) // For content-based validation (primary method)
      .header("Cache-Control", headerCacheControl) // Use appropriate cache control
      .type(getMime(resolved)); // Set Content-Type based on file extension

    // Only advertise range request support for files that aren't in memory cache
    // as we only implement range support for those files
    if (!(stat.size <= smallFileMaxSize && contentCache.get(resolved))) {
      reply.header("Accept-Ranges", "bytes");
    }

    // Check for Range header to handle partial content requests
    const rangeHeader = req.headers.range;

    // Handle range requests if present and file is not in memory cache
    if (
      rangeHeader &&
      !(stat.size <= smallFileMaxSize && contentCache.get(resolved))
    ) {
      // Parse the range header
      const matches = /bytes=(\d+)-(\d*)/.exec(rangeHeader);

      if (!matches) {
        // Malformed range header
        return reply.code(400).send({ error: "Invalid range header format" });
      }

      // Extract range values
      const start = parseInt(matches[1], 10);
      let end = matches[2] ? parseInt(matches[2], 10) : stat.size - 1;

      // Cap the end to the actual file size
      end = Math.min(end, stat.size - 1);

      // Validate range
      if (
        isNaN(start) ||
        isNaN(end) ||
        start < 0 ||
        start >= stat.size ||
        end < start
      ) {
        // Invalid range
        return reply
          .code(416) // Range Not Satisfiable
          .header("Content-Range", `bytes */${stat.size}`)
          .send({ error: "Range not satisfiable" });
      }

      const chunkSize = end - start + 1;

      // Set headers for partial content response
      reply
        .code(206) // Partial Content
        .header("Content-Range", `bytes ${start}-${end}/${stat.size}`)
        .header("Content-Length", chunkSize.toString());

      // Stream the requested range
      return reply.send(fs.createReadStream(resolved, { start, end }));
    }

    // Serve the full file content if it's small enough and cached
    if (stat.size <= smallFileMaxSize && contentCache.get(resolved)) {
      // For small files that we've already read into memory, use the cached buffer
      // This avoids redundant filesystem operations
      return reply.send(contentCache.get(resolved));
    } else {
      // For large files or uncached content, stream directly from disk
      // This prevents loading large files into memory
      return reply.send(fs.createReadStream(resolved));
    }
  }
};

// Simple extension-based MIME lookup (alphabetical order)
function getMime(file: string): string {
  // Strip the leading dot from the extension
  const ext = path.extname(file).toLowerCase().replace(/^\./, "");

  // Map common extensions to MIME types (alphabetical order)
  const mimeTypes: Record<string, string> = {
    css: "text/css",
    gif: "image/gif",
    html: "text/html",
    ico: "image/x-icon",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    js: "application/javascript",
    json: "application/json",
    mp4: "video/mp4",
    pdf: "application/pdf",
    png: "image/png",
    svg: "image/svg+xml",
    txt: "text/plain",
    webmanifest: "application/manifest+json",
    xml: "application/xml",
  };

  return mimeTypes[ext] || "application/octet-stream";
}

export default fp(StaticContentRouterPlugin, {
  name: "static-router",
});

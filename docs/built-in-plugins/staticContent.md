# staticContent

<!-- toc -->

- [Overview](#overview)
- [Usage](#usage)
  - [Basic Example](#basic-example)
  - [Multiple Instances](#multiple-instances)
  - [With API Server](#with-api-server)
- [Options](#options)
  - [Plugin Name](#plugin-name)
  - [File Mappings](#file-mappings)
  - [Server Memory Caching](#server-memory-caching)
  - [HTTP Cache Headers](#http-cache-headers)
- [How It Works](#how-it-works)
  - [ETag Generation](#etag-generation)
  - [Conditional Requests](#conditional-requests)
  - [Range Requests](#range-requests)
  - [Immutable Asset Detection](#immutable-asset-detection)
- [SSR Server Default Behavior](#ssr-server-default-behavior)
- [Best Practices](#best-practices)
  - [1. Use Immutable Caching for Build Assets](#1-use-immutable-caching-for-build-assets)
  - [2. Separate User Uploads from Build Assets](#2-separate-user-uploads-from-build-assets)
  - [3. Tune Server Memory Caching for Your Workload](#3-tune-server-memory-caching-for-your-workload)
  - [4. Use Single Asset Map for Specific Files](#4-use-single-asset-map-for-specific-files)
- [Plugin Dependencies](#plugin-dependencies)

<!-- tocstop -->

## Overview

The `staticContent` plugin provides efficient static file serving with built-in caching, ETag support, and range requests. You can register multiple instances with different configurations to serve files from multiple directories with different caching strategies.

Key features:

- **Efficient caching**: LRU caches for file stats, content, and ETags
- **Strong ETags**: Content-based SHA-256 hashes for small files
- **Weak ETags**: Size + mtime based for large files
- **Range requests**: Support for partial content (video/audio streaming)
- **Immutable detection**: Auto-detect fingerprinted assets for aggressive caching
- **Multiple instances**: Register multiple plugins with different configurations

## Usage

### Basic Example

```typescript
import { serveSSRDev } from 'unirend/server';
import { staticContent } from 'unirend/plugins';

const server = serveSSRDev(
  {
    serverEntry: './src/entry-server.tsx',
    template: './index.html',
    viteConfig: './vite.config.ts',
  },
  {
    plugins: [
      staticContent({
        folderMap: {
          '/uploads': './uploads',
        },
      }),
    ],
  },
);
```

### Multiple Instances

You can register multiple `staticContent` plugins with different configurations:

```typescript
import { serveSSRProd } from 'unirend/server';
import { staticContent } from 'unirend/plugins';

const server = serveSSRProd('./build', {
  plugins: [
    // User uploads - no immutable caching, shorter cache TTL
    staticContent(
      {
        folderMap: {
          '/uploads': {
            path: './uploads',
            detectImmutableAssets: false,
          },
        },
        cacheControl: 'public, max-age=3600', // 1 hour
        positiveCacheTtl: 60 * 1000, // 1 minute internal cache
      },
      'uploads-handler', // Optional custom name for debugging
    ),

    // Static assets with fingerprinted filenames
    staticContent(
      {
        folderMap: {
          '/static': {
            path: './public/static',
            detectImmutableAssets: true,
          },
        },
      },
      'static-assets',
    ),

    // Single file mappings
    staticContent({
      singleAssetMap: {
        '/robots.txt': './public/robots.txt',
        '/sitemap.xml': './public/sitemap.xml',
      },
    }),
  ],
});
```

### With API Server

The plugin works with standalone API servers too:

```typescript
import { createAPIServer } from 'unirend/server';
import { staticContent } from 'unirend/plugins';

const server = createAPIServer({
  plugins: [
    staticContent({
      folderMap: {
        '/files': './data/files',
        '/docs': './public/documentation',
      },
      singleAssetMap: {
        '/favicon.ico': './public/favicon.ico',
      },
    }),
  ],
});

await server.listen(3000);
```

## Options

### Plugin Name

The `staticContent()` function accepts an optional second parameter for a custom plugin name:

```typescript
staticContent(config, name?)
```

| Parameter | Type     | Description                                                       |
| --------- | -------- | ----------------------------------------------------------------- |
| `config`  | `object` | Static content configuration (required)                           |
| `name`    | `string` | Optional custom name for debugging and plugin dependency tracking |

**Example:**

```typescript
plugins: [
  staticContent({ folderMap: { '/uploads': './uploads' } }, 'uploads-handler'),
  staticContent({ folderMap: { '/static': './static' } }, 'static-assets'),
];
```

If no name is provided, a unique ID is automatically generated (e.g., `static-content-1733318400000-abc123`).

### File Mappings

| Option           | Type                                     | Description                             |
| ---------------- | ---------------------------------------- | --------------------------------------- |
| `singleAssetMap` | `Record<string, string>`                 | Exact URL → absolute file path mappings |
| `folderMap`      | `Record<string, string \| FolderConfig>` | URL prefix → directory mappings         |

**FolderConfig type:**

```typescript
interface FolderConfig {
  path: string; // Absolute path to the directory
  detectImmutableAssets?: boolean; // Auto-detect fingerprinted files (default: false)
}
```

**Examples:**

```typescript
// Simple string path
folderMap: {
  '/uploads': './uploads',
}

// With folder config
folderMap: {
  '/assets': {
    path: './dist/assets',
    detectImmutableAssets: true, // Enable immutable caching for hashed files
  },
}
```

### Server Memory Caching

These options control **server-side in-memory caching** to reduce disk I/O operations:

| Option                | Type     | Default                    | Description                                |
| --------------------- | -------- | -------------------------- | ------------------------------------------ |
| `smallFileMaxSize`    | `number` | `5 * 1024 * 1024` (5 MB)   | Max file size for content-based ETags      |
| `cacheEntries`        | `number` | `100`                      | Max entries in ETag/content LRU caches     |
| `contentCacheMaxSize` | `number` | `50 * 1024 * 1024` (50 MB) | Max total size of content cache            |
| `statCacheEntries`    | `number` | `250`                      | Max entries in file stat cache             |
| `negativeCacheTtl`    | `number` | `30 * 1000` (30s)          | TTL for 404/error cache entries (ms)       |
| `positiveCacheTtl`    | `number` | `3600 * 1000` (1h)         | TTL for successful file cache entries (ms) |

**Note:** This caches file stats, content, and ETags **in server memory** to avoid repeated disk reads. This is separate from browser/CDN caching controlled by HTTP headers (see below).

**Example - High-traffic site with aggressive server caching:**

```typescript
// Reduces disk I/O by caching more files in server memory
staticContent({
  folderMap: { '/assets': './dist/assets' },
  smallFileMaxSize: 2 * 1024 * 1024, // 2 MB - cache larger files in memory
  cacheEntries: 500, // More ETag/content cache entries
  contentCacheMaxSize: 200 * 1024 * 1024, // 200 MB total server memory for content
  statCacheEntries: 1000, // Cache more file stats
  positiveCacheTtl: 3600 * 1000, // Keep successful lookups cached for 1 hour
  negativeCacheTtl: 60 * 1000, // Keep 404s cached for 1 minute
});
```

### HTTP Cache Headers

These options control **HTTP Cache-Control headers** sent to browsers/CDNs:

| Option                  | Type     | Default                                 | Description                           |
| ----------------------- | -------- | --------------------------------------- | ------------------------------------- |
| `cacheControl`          | `string` | `'public, max-age=0, must-revalidate'`  | Default Cache-Control header          |
| `immutableCacheControl` | `string` | `'public, max-age=31536000, immutable'` | Cache-Control for fingerprinted files |

**Note:** These headers tell **browsers and CDNs** how long to cache files. This is separate from server memory caching (above) which reduces disk I/O.

**Example - Custom browser/CDN caching:**

```typescript
staticContent({
  folderMap: {
    '/assets': { path: './dist/assets', detectImmutableAssets: true },
  },
  // Tell browsers: revalidate immediately (but can use ETag for 304 responses)
  cacheControl: 'public, max-age=0, must-revalidate',
  // Tell browsers: hashed files never change, cache for 1 year
  immutableCacheControl: 'public, max-age=31536000, immutable',
});
```

## How It Works

The plugin uses a **two-layer caching strategy**:

1. **Server memory caching** (LRU caches) - Reduces disk I/O by caching file stats, content, and ETags in server RAM
2. **HTTP caching** (ETag/Cache-Control) - Reduces bandwidth by letting browsers/CDNs cache files and use 304 responses

### ETag Generation

The plugin uses two strategies for ETag generation:

1. **Strong ETags** (small files ≤ `smallFileMaxSize`):
   - Content-based SHA-256 hash
   - Format: `"<base64-hash>"`
   - Guarantees content hasn't changed

2. **Weak ETags** (large files > `smallFileMaxSize`):
   - Based on file size and modification time
   - Format: `W/"<size>-<mtime>"`
   - Efficient for large files without reading content

### Conditional Requests

The plugin supports `If-None-Match` conditional requests:

1. Browser sends `If-None-Match: "<etag>"`
2. If ETag matches, server responds with `304 Not Modified`
3. Browser uses cached version, saving bandwidth

### Range Requests

For large files not in memory cache, the plugin supports HTTP range requests:

```http
GET /video.mp4 HTTP/1.1
Range: bytes=0-1023
```

Response:

```http
HTTP/1.1 206 Partial Content
Content-Range: bytes 0-1023/1048576
Content-Length: 1024
```

This enables video/audio seeking and resumable downloads.

### Immutable Asset Detection

When `detectImmutableAssets: true`, the plugin detects fingerprinted filenames:

- Pattern: `.{hash}.{ext}` (e.g., `main.CTpDmzGw.js`)
- Pattern: `-{hash}.{ext}` (e.g., `chunk-a1b2c3d4.css`)

Detected files receive the `immutableCacheControl` header (default: 1 year, immutable).

## SSR Server Default Behavior

The SSR server automatically serves the `/assets` folder in production mode for your built application assets (JavaScript, CSS, images generated by Vite).

**Options:**

- **Add additional folders**: Use the `staticContent` plugin for extra paths like `/uploads` or `/static`
- **Disable default assets serving**: Set `staticContentRouter: false` in SSR options (useful for CDN setups)
- **Customize default behavior**: Pass `staticContentRouter: { ... }` in SSR options to configure cache settings

**Example - Disable for CDN:**

```typescript
const server = serveSSRProd('./build', {
  staticContentRouter: false, // Disable - using CDN for all assets
});
```

**Example - Add extra folders:**

```typescript
const server = serveSSRProd('./build', {
  // Default /assets serving is still active
  plugins: [
    staticContent({ folderMap: { '/uploads': './uploads' } }, 'uploads'),
  ],
});
```

**Avoiding Conflicts:**

The `staticContent` plugin works alongside the default `/assets` serving without conflicts, as long as URL prefixes don't overlap. For example:

- ✅ Default `/assets` + plugin `/uploads` → No conflict
- ✅ Default `/assets` + plugin `/static` → No conflict
- ❌ Default `/assets` + plugin `/assets` → Conflict (first registered wins)

## Best Practices

### 1. Use Immutable Caching for Build Assets

```typescript
staticContent({
  folderMap: {
    '/static': {
      path: './public/static',
      detectImmutableAssets: true, // Auto-detect hashed filenames
    },
  },
});
```

### 2. Separate User Uploads from Build Assets

```typescript
plugins: [
  // User uploads - shorter browser cache, refresh server cache more often
  staticContent(
    {
      folderMap: { '/uploads': './uploads' },
      cacheControl: 'public, max-age=3600', // Browsers: cache 1 hour
      positiveCacheTtl: 60 * 1000, // Server memory: refresh every minute
    },
    'uploads',
  ),

  // Extra static assets (e.g., /static folder)
  // Note: SSR already serves /assets internally, so use a different prefix
  // or disable the internal router with staticContentRouter: false
  staticContent(
    {
      folderMap: {
        '/static': { path: './public/static', detectImmutableAssets: true },
      },
      // Uses defaults: immutable for hashed files, must-revalidate for others
    },
    'static-assets',
  ),
];
```

### 3. Tune Server Memory Caching for Your Workload

```typescript
// High-traffic site - cache more in server memory to reduce disk I/O
staticContent({
  folderMap: { '/static': './public' },
  cacheEntries: 500, // More ETag cache entries
  statCacheEntries: 1000, // More stat cache entries (includes 404s)
  contentCacheMaxSize: 200 * 1024 * 1024, // 200 MB of files cached in RAM
  smallFileMaxSize: 2 * 1024 * 1024, // Cache files < 2 MB in memory
  positiveCacheTtl: 3600 * 1000, // Keep in memory for 1 hour
});
```

### 4. Use Single Asset Map for Specific Files

```typescript
staticContent({
  singleAssetMap: {
    '/favicon.ico': './public/favicon.ico',
    '/robots.txt': './public/robots.txt',
    '/manifest.json': './public/manifest.json',
    '/.well-known/security.txt': './public/security.txt',
  },
});
```

## Plugin Dependencies

This plugin does not depend on other plugins and can be registered at any position in the plugins array.

Each instance of `staticContent` is independent with its own caches, allowing you to register multiple instances with different configurations.

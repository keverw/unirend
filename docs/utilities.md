# Utilities

Unirend exposes utilities for domain/origin validation, static file caching, and related functionality. While used internally by unirend, they can also be used standalone in any project.

```typescript
import { ... } from 'unirend/utils';
```

<!-- toc -->

- [HTML Utilities](#html-utilities)
  - [`escapeHTML(str: string): string`](#escapehtmlstr-string-string)
- [Domain Utilities](#domain-utilities)
  - [`normalizeOrigin(origin: string): string`](#normalizeoriginorigin-string-string)
  - [`normalizeDomain(domain: string): string`](#normalizedomaindomain-string-string)
  - [`matchesWildcardDomain(domain: string, pattern: string): boolean`](#matcheswildcarddomaindomain-string-pattern-string-boolean)
  - [`matchesWildcardOrigin(origin: string, pattern: string): boolean`](#matcheswildcardoriginorigin-string-pattern-string-boolean)
  - [`matchesDomainList(domain: string, allowedDomains: string[]): boolean`](#matchesdomainlistdomain-string-alloweddomains-string-boolean)
  - [`matchesOriginList(origin: string | undefined, allowedOrigins: string[], opts?): boolean`](#matchesoriginlistorigin-string--undefined-allowedorigins-string-opts-boolean)
  - [`matchesCORSCredentialsList(origin: string | undefined, allowedOrigins: string[], options?): boolean`](#matchescorscredentialslistorigin-string--undefined-allowedorigins-string-options-boolean)
  - [`validateConfigEntry(entry: string, context: 'domain' | 'origin', options?): ValidationResult`](#validateconfigentryentry-string-context-domain--origin-options-validationresult)
  - [`isIPAddress(str: string): boolean`](#isipaddressstr-string-boolean)
  - [`checkDNSLength(host: string): boolean`](#checkdnslengthhost-string-boolean)
- [LRUCache](#lrucache)
  - [Features](#features)
  - [Basic Usage](#basic-usage)
  - [With TTL](#with-ttl)
  - [With Size Limits](#with-size-limits)
  - [Constructor](#constructor)
  - [Methods](#methods)
- [StaticContentCache](#staticcontentcache)
  - [Overview](#overview)
  - [Basic Usage](#basic-usage-1)
  - [Constructor Options](#constructor-options)
  - [Methods](#methods-1)
    - [`getFile(resolvedPath: string, options?): Promise<FileResult>`](#getfileresolvedpath-string-options-promisefileresult)
    - [`serveFile(req, reply, resolvedPath, options?): Promise<ServeFileResult>`](#servefilereq-reply-resolvedpath-options-promiseservefileresult)
    - [`handleRequest(rawUrl, req, reply): Promise<ServeFileResult>`](#handlerequestrawurl-req-reply-promiseservefileresult)
    - [`updateConfig(newConfig): void`](#updateconfignewconfig-void)
    - [`clearCaches(): void`](#clearcaches-void)
    - [`invalidateFile(fsPath): void`](#invalidatefilefspath-void)
    - [`replaceConfig(newConfig): void`](#replaceconfignewconfig-void)
    - [`getCacheStats(): object`](#getcachestats-object)
  - [Types](#types)

<!-- tocstop -->

## HTML Utilities

### `escapeHTML(str: string): string`

Escapes HTML special characters to prevent XSS attacks when generating raw HTML.

**When to use:**

- Error page handlers that return raw HTML (`get500ErrorPage`, `invalidDomainHandler`, etc.)
- Custom API error responses with HTML content
- Any server-side HTML generation outside of React
- React's `dangerouslySetInnerHTML` when inserting user content

**Note:** React components automatically escape content in JSX, so you only need this utility when bypassing React's escaping (e.g., `dangerouslySetInnerHTML`) or generating raw HTML strings outside of React.

Converts the following to HTML entities:

- `&` → `&amp;`
- `<` → `&lt;`
- `>` → `&gt;`
- `"` → `&quot;`
- `'` → `&#39;`

```typescript
import { escapeHTML } from 'unirend/utils';

escapeHTML('<script>alert("xss")</script>');
// Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'

// Example: Safe error page HTML generation
const get500ErrorPage = (error?: Error) => `
<!DOCTYPE html>
<html>
  <body>
    <h1>Server Error</h1>
    <p>${escapeHTML(error?.message ?? 'An unexpected error occurred')}</p>
  </body>
</html>
`;
```

## Domain Utilities

Functions for domain/origin validation, normalization, and wildcard matching. Useful for CORS configuration, security checks, and URL handling.

### `normalizeOrigin(origin: string): string`

Normalizes an origin URL for consistent comparison. Handles protocol, hostname, port normalization with punycode support. Removes default ports (80 for http, 443 for https).

```typescript
import { normalizeOrigin } from 'unirend/utils';

normalizeOrigin('HTTPS://Example.COM:443/'); // 'https://example.com'
normalizeOrigin('http://example.com:80'); // 'http://example.com'
normalizeOrigin('https://example.com:8080'); // 'https://example.com:8080'
```

### `normalizeDomain(domain: string): string`

Normalizes a domain name for consistent comparison. Handles trim, lowercase, trailing dots, NFC normalization, and punycode conversion for IDN safety.

```typescript
import { normalizeDomain } from 'unirend/utils';

normalizeDomain('Example.COM.'); // 'example.com'
normalizeDomain('  api.test  '); // 'api.test'
normalizeDomain('münchen.de'); // 'xn--mnchen-3ya.de' (punycode)
```

### `matchesWildcardDomain(domain: string, pattern: string): boolean`

Smart wildcard matching for domains. Apex domains must be listed explicitly.

**Pattern rules:**

- `*` - Global wildcard, matches any host (domains and IPs)
- `*.example.com` - Matches direct subdomains only (`api.example.com` ✅, `app.api.example.com` ❌)
- `**.example.com` - Matches all subdomains including nested (`api.example.com` ✅, `app.api.example.com` ✅)
- `*.*.example.com` - Matches exactly two subdomain levels

```typescript
import { matchesWildcardDomain } from 'unirend/utils';

matchesWildcardDomain('api.example.com', '*.example.com'); // true
matchesWildcardDomain('deep.api.example.com', '*.example.com'); // false
matchesWildcardDomain('deep.api.example.com', '**.example.com'); // true
matchesWildcardDomain('example.com', '*.example.com'); // false (apex)
```

### `matchesWildcardOrigin(origin: string, pattern: string): boolean`

Smart origin wildcard matching for CORS with URL parsing. Supports protocol-specific wildcards and domain wildcards.

**Pattern examples:**

- `*` - Matches any valid HTTP(S) origin
- `https://*` or `http://*` - Matches any domain with specific protocol
- `*.example.com` - Matches direct subdomains with any protocol
- `**.example.com` - Matches all subdomains with any protocol
- `https://*.example.com` - Matches direct subdomains with specific protocol

```typescript
import { matchesWildcardOrigin } from 'unirend/utils';

matchesWildcardOrigin('https://api.example.com', 'https://*.example.com'); // true
matchesWildcardOrigin('http://api.example.com', 'https://*.example.com'); // false (protocol mismatch)
matchesWildcardOrigin('https://example.com', '*'); // true
```

### `matchesDomainList(domain: string, allowedDomains: string[]): boolean`

Checks if a domain matches any pattern in a list. Supports exact matches and wildcards.

```typescript
import { matchesDomainList } from 'unirend/utils';

matchesDomainList('api.example.com', ['*.example.com', 'other.com']); // true
matchesDomainList('test.com', ['*.example.com', 'other.com']); // false
```

### `matchesOriginList(origin: string | undefined, allowedOrigins: string[], opts?): boolean`

Checks if an origin matches any pattern in a list. Supports exact matches, wildcards, and normalization.

```typescript
import { matchesOriginList } from 'unirend/utils';

matchesOriginList('https://api.example.com', ['https://*.example.com']); // true
matchesOriginList(undefined, ['*'], { treatNoOriginAsAllowed: true }); // true
```

### `matchesCORSCredentialsList(origin: string | undefined, allowedOrigins: string[], options?): boolean`

Credentials-safe origin matching. By default only supports exact matches (no wildcards) for security. Optionally allows subdomain wildcards.

```typescript
import { matchesCORSCredentialsList } from 'unirend/utils';

// Exact match only (default - secure)
matchesCORSCredentialsList('https://example.com', ['https://example.com']); // true

// With subdomain wildcards enabled
matchesCORSCredentialsList(
  'https://api.example.com',
  ['https://*.example.com'],
  {
    allowWildcardSubdomains: true,
  },
); // true
```

### `validateConfigEntry(entry: string, context: 'domain' | 'origin', options?): ValidationResult`

Validates a configuration entry for domain or origin contexts. Non-throwing, returns validation result with info.

```typescript
import { validateConfigEntry } from 'unirend/utils';

const result = validateConfigEntry('*.example.com', 'domain');
// { valid: true, wildcardKind: 'subdomain' }

const result2 = validateConfigEntry('*.com', 'domain');
// { valid: false, info: 'wildcard tail targets public suffix...', wildcardKind: 'none' }
```

**Options:**

- `allowGlobalWildcard?: boolean` - Allow `*` as global wildcard (default: false)
- `allowProtocolWildcard?: boolean` - Allow `https://*` patterns (default: true)

**Return type:**

```typescript
type WildcardKind = 'none' | 'global' | 'protocol' | 'subdomain';
{ valid: boolean; info?: string; wildcardKind: WildcardKind }
```

### `isIPAddress(str: string): boolean`

Checks if a string is an IP address (IPv4 or IPv6).

```typescript
import { isIPAddress } from 'unirend/utils';

isIPAddress('192.168.1.1'); // true
isIPAddress('::1'); // true
isIPAddress('[::1]'); // true
isIPAddress('example.com'); // false
```

### `checkDNSLength(host: string): boolean`

Validates DNS length constraints for hostnames:

- Each label must be ≤ 63 octets
- Total FQDN must be ≤ 255 octets
- Maximum 127 labels

Assumes ASCII input (post-punycode processing).

```typescript
import { checkDNSLength } from 'unirend/utils';

checkDNSLength('example.com'); // true
checkDNSLength('a'.repeat(64) + '.com'); // false (label > 63)
checkDNSLength('sub.'.repeat(50) + 'example.com'); // false (too many labels)
```

## LRUCache

A TTL-aware LRU (Least Recently Used) cache with configurable size limits and automatic expiration.

### Features

- **Max entries**: Limit the number of cached items
- **Max size**: Limit total memory usage in bytes
- **TTL support**: Optional time-to-live for cache entries
- **Automatic cleanup**: Periodic removal of expired entries
- **Size-aware eviction**: Evicts oldest entries when limits are exceeded

### Basic Usage

```typescript
import { LRUCache } from 'unirend/utils';

// Simple cache with max 100 entries
const cache = new LRUCache<string, string>(100);

cache.set('key', 'value');
cache.get('key'); // 'value'
cache.delete('key');
cache.clear();
```

### With TTL

```typescript
// Cache with 5-minute default TTL
const cache = new LRUCache<string, object>(100, {
  defaultTtl: 5 * 60 * 1000, // 5 minutes in ms
});

cache.set('user:123', { name: 'Alice' });

// Override TTL for specific entry (1 hour)
cache.set('session:abc', { token: '...' }, 60 * 60 * 1000);
```

### With Size Limits

```typescript
// Cache with 50MB max size
const cache = new LRUCache<string, Buffer>(1000, {
  maxSize: 50 * 1024 * 1024, // 50MB
});

// Custom size calculator for complex objects
const jsonCache = new LRUCache<string, object>(500, {
  maxSize: 10 * 1024 * 1024, // 10MB
  sizeCalculator: (value) => JSON.stringify(value).length * 2,
});
```

### Constructor

```typescript
new LRUCache<K, V>(maxEntries: number, options?: {
  defaultTtl?: number;      // Default TTL in milliseconds
  maxSize?: number;         // Maximum total size in bytes
  sizeCalculator?: (value: V) => number; // Custom size function
})
```

### Methods

| Method                                            | Description                                           |
| ------------------------------------------------- | ----------------------------------------------------- |
| `has(key: K): boolean`                            | Check if key exists (doesn't affect LRU order)        |
| `get(key: K): V \| undefined`                     | Get a value (returns undefined if expired or missing) |
| `set(key: K, value: V, customTtl?: number): void` | Set a value with optional custom TTL                  |
| `delete(key: K): boolean`                         | Delete an entry, returns true if it existed           |
| `clear(): void`                                   | Clear all entries                                     |
| `size: number`                                    | Current number of entries                             |
| `byteSize: number`                                | Current total size in bytes                           |

## StaticContentCache

A caching layer for static file serving with ETag support, LRU caching, and optimized file serving for Fastify applications.

### Overview

`StaticContentCache` manages:

- Multiple LRU caches (ETag, file content, and file stats)
- Configuration for single asset and folder mappings
- Optimized file serving with HTTP caching headers
- Content-based ETags for small files, weak ETags for large files
- Automatic detection of immutable assets (fingerprinted files)

### Basic Usage

```typescript
import { StaticContentCache } from 'unirend/utils';

const cache = new StaticContentCache({
  folderMap: {
    '/assets/': '/path/to/assets',
  },
  singleAssetMap: {
    '/favicon.ico': '/path/to/favicon.ico',
  },
});

// In a Fastify hook or handler
const result = await cache.handleRequest(request.url, request, reply);

if (result.served) {
  // File was served
} else {
  // File not found, continue to next handler
}
```

### Constructor Options

```typescript
interface StaticContentRouterOptions {
  // Map specific URLs to specific files
  singleAssetMap?: Record<string, string>;

  // Map URL prefixes to directories
  folderMap?: Record<
    string,
    string | { path: string; detectImmutableAssets?: boolean }
  >;

  // Max file size to cache in memory (default: 5MB)
  smallFileMaxSize?: number;

  // Max entries in ETag cache (default: 100)
  cacheEntries?: number;

  // Max total size of content cache (default: 50MB)
  contentCacheMaxSize?: number;

  // Max entries in stat cache (default: 250)
  statCacheEntries?: number;

  // TTL for negative cache entries (default: 30s)
  negativeCacheTtl?: number;

  // TTL for positive cache entries (default: 1 hour)
  positiveCacheTtl?: number;

  // Cache-Control header for normal files
  cacheControl?: string; // default: 'public, max-age=0, must-revalidate'

  // Cache-Control header for immutable/fingerprinted files
  immutableCacheControl?: string; // default: 'public, max-age=31536000, immutable'
}
```

### Methods

#### `getFile(resolvedPath: string, options?): Promise<FileResult>`

Gets file metadata and content with optimized caching. Useful for programmatic access.

```typescript
const result = await cache.getFile('/path/to/file.js', {
  shouldDetectImmutable: true,
  clientETag: request.headers['if-none-match'],
});

if (result.status === 'ok') {
  console.log(result.mimeType, result.etag, result.isImmutableAsset);
}
```

#### `serveFile(req, reply, resolvedPath, options?): Promise<ServeFileResult>`

Serves a static file via HTTP with conditional responses (304 Not Modified, 206 Partial Content).

```typescript
const result = await cache.serveFile(request, reply, '/path/to/file.js', {
  shouldDetectImmutable: true,
});

if (result.served) {
  console.log(`Served with status ${result.statusCode}`);
}
```

#### `handleRequest(rawUrl, req, reply): Promise<ServeFileResult>`

Convenience method that resolves URL to file path and serves it.

```typescript
const result = await cache.handleRequest('/assets/main.js', request, reply);
```

#### `updateConfig(newConfig): void`

Updates file mappings at runtime with targeted cache invalidation — only evicting entries whose URL-to-path mapping changed. Use this when routing is changing but file contents at existing paths are unchanged (e.g., adding or removing pages without rebuilding assets). For post-build reloads where file contents may have changed, use `replaceConfig` instead.

**Important:** When providing a section, you must provide the **complete** mapping for that section.

- If you provide `singleAssetMap`, it replaces the entire single asset map
- If you provide `folderMap`, it replaces the entire folder map
- You can update one section, the other, or both
- Omitted sections remain unchanged
- **Empty objects clear that section**: Passing `singleAssetMap: {}` removes all single asset mappings

**Parameters:**

- `newConfig`: Configuration object with one or both sections
  - `singleAssetMap?`: Complete record of URL-to-file mappings (pass `{}` to clear all)
  - `folderMap?`: Complete record of URL-prefix-to-directory mappings (pass `{}` to clear all)

**Example - Update only file mappings:**

```typescript
cache.updateConfig({
  singleAssetMap: {
    '/': './dist/index.html',
    '/about': './dist/about.html',
    '/blog/new-post': './dist/blog/new-post.html',
  },
});
```

**Example - Update only folder mappings:**

```typescript
cache.updateConfig({
  folderMap: {
    '/assets': { path: './dist/assets', detectImmutableAssets: true },
  },
});
```

**Example - Update both sections:**

```typescript
cache.updateConfig({
  singleAssetMap: {
    '/': './dist/index.html',
    '/about': './dist/about.html',
  },
  folderMap: {
    '/assets': './dist/assets',
  },
});
```

**Example - Clear all single asset mappings:**

```typescript
cache.updateConfig({
  singleAssetMap: {}, // Clears all single asset mappings
  // folderMap is omitted, so it remains unchanged
});
```

**Cache invalidation strategy:**

- **`singleAssetMap` changes**: Only invalidates filesystem paths whose URL-to-path _mapping_ changed (added, removed, or pointed to a different file). Paths whose mapping is unchanged are not evicted — `updateConfig` has no visibility into whether the file content on disk changed. If you know specific files were rebuilt in-place, use `invalidateFile` for surgical eviction, or for a full build flush use `replaceConfig`.
- **`folderMap` changes**: Clears all caches (folder changes are rare and structural)

#### `clearCaches(): void`

Clears all caches (useful for testing or cache invalidation).

#### `invalidateFile(fsPath): void`

Evicts a single file's cached content, stat, and ETag without touching any URL-to-path mappings.

Use this when you know a specific file changed on disk and want to force a fresh read on the next request — without flushing the entire cache. Works for files served via `singleAssetMap` or `folderMap`.

The parameter is the **filesystem path** (as it appears in the cache key), not a URL. For `singleAssetMap` entries these are the absolute paths you provided, and for folder-served files the cache key is the absolute path resolved at request time.

**When to use:** A file watcher or webhook that knows exactly which file was rewritten, and you want surgical invalidation rather than a full cache flush.

```typescript
// A file watcher detected /dist/about.html was rewritten in-place:
cache.invalidateFile('/dist/about.html');
```

#### `replaceConfig(newConfig): void`

Replaces routing maps and clears all file caches in one shot. The intended use case is reloading after a full build has completed.

Use this after a full build has completed. Unlike `updateConfig`, no attempt is made at targeted per-path invalidation — the routing maps are replaced and all file caches (content, stats, ETags) are wiped unconditionally.

**Why all caches are always cleared — even folder caches:** A build can change file contents in-place without renaming files. More importantly, the rebuilt HTML pages reference JS/CSS bundles served from `folderMap` directories — and those bundles were likely regenerated in the same build step. Even when only `singleAssetMap` is passed, the folder caches are still flushed, as selectively preserving them would risk serving stale assets alongside fresh pages that now reference new bundle hashes.

You may provide `singleAssetMap`, `folderMap`, or both. Omitted sections retain their current routing configuration. Pass an empty object (`{}`) for a section to clear all mappings in that section (e.g., `replaceConfig({ singleAssetMap: {} })` removes all single-asset routes).

For targeted cache invalidation (when URL-to-path mappings changed but file contents at those paths are unchanged), use `updateConfig` instead. If only specific files changed on disk (e.g., detected by a file watcher), use `invalidateFile` for surgical eviction without a full flush.

**When to use:**

- After an SSG or full client build — pages and assets were likely both regenerated
- When files may have been rebuilt in-place with the same filenames
- When you need to update folder mappings at the same time (e.g., new asset output directory)

```typescript
// After an SSG build (page map only — asset folder caches also flushed):
cache.replaceConfig({ singleAssetMap: await loadPageMap() });

// After a build that changes both pages and asset folders:
cache.replaceConfig({
  singleAssetMap: await loadPageMap(),
  folderMap: {
    '/assets/': { path: './dist/assets', detectImmutableAssets: true },
  },
});
```

#### `getCacheStats(): object`

Returns statistics about cache usage (items count, byte sizes).

### Types

```typescript
type FileResult =
  | { status: 'not-found' }
  | { status: 'error'; error: Error }
  | { status: 'not-modified'; etag: string; lastModified: string }
  | {
      status: 'ok';
      stat: MinimalStatInfo;
      etag: string;
      lastModified: string;
      mimeType: string;
      content: FileContent;
      isImmutableAsset: boolean;
    };

type FileContent =
  | { shouldStream: false; data: Buffer }
  | { shouldStream: true; createStream: (options?) => ReadStream };

type ServeFileResult =
  | { served: false; reason: 'not-found' }
  | { served: false; reason: 'error'; error: Error }
  | { served: true; statusCode: 200 | 206 | 304 };
```

# Utilities

Unirend exposes utilities for domain/origin validation, static file caching, and related functionality. While used internally by unirend, they can also be used standalone in any project.

```typescript
import { ... } from 'unirend/utils';
```

<!-- toc -->

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
    - [`getCacheStats(): object`](#getcachestats-object)
  - [Types](#types)

<!-- tocstop -->

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

Updates file mappings at runtime with intelligent cache invalidation.

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

- **`singleAssetMap` changes**: Only invalidates specific filesystem paths that were added, updated, or removed (efficient for incremental updates)
- **`folderMap` changes**: Clears all caches (folder changes are rare and structural)

#### `clearCaches(): void`

Clears all caches (useful for testing or cache invalidation).

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

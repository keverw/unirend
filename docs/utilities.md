# Utilities

Unirend exposes public utilities for static file caching, HTML escaping, and runtime requirement checks. Some are used internally by unirend, while others are intended for use in your own server or build scripts.

```typescript
import { ... } from 'unirend/utils';
```

<!-- toc -->

- [Runtime Utilities](#runtime-utilities)
  - [`MINIMUM_SUPPORTED_NODE_MAJOR`](#minimum_supported_node_major)
  - [`getRuntimeSupportInfo(minimumNodeMajor?): RuntimeSupportInfo`](#getruntimesupportinfominimumnodemajor-runtimesupportinfo)
  - [`isSupportedRuntime(minimumNodeMajor?): boolean`](#issupportedruntimeminimumnodemajor-boolean)
  - [`assertSupportedRuntime(minimumNodeMajor?): void`](#assertsupportedruntimeminimumnodemajor-void)
- [HTML Utilities](#html-utilities)
  - [`escapeHTML(str: string): string`](#escapehtmlstr-string-string)
  - [`escapeHTMLAttr(str: string): string`](#escapehtmlattrstr-string-string)
- [Content-Security-Policy Utilities](#content-security-policy-utilities)
  - [`hashInlineContentForCSP(content: string, algorithm?): string`](#hashinlinecontentforcspcontent-string-algorithm-string)
- [StaticContentCache](#staticcontentcache)
  - [Overview](#overview)
  - [Basic Usage](#basic-usage)
  - [Constructor Options](#constructor-options)
  - [Methods](#methods)
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

## Runtime Utilities

### `MINIMUM_SUPPORTED_NODE_MAJOR`

The default Node major version required by Unirend when the runtime is Node.

```typescript
import { MINIMUM_SUPPORTED_NODE_MAJOR } from 'unirend/utils';

console.log(MINIMUM_SUPPORTED_NODE_MAJOR); // 25
```

### `getRuntimeSupportInfo(minimumNodeMajor?): RuntimeSupportInfo`

Detects the current runtime and reports whether it satisfies Unirend's runtime requirement.

Important: Bun is treated as supported even if `process.versions.node` reports an older compatibility version.

```typescript
import { getRuntimeSupportInfo } from 'unirend/utils';

const runtime = getRuntimeSupportInfo();

if (!runtime.isSupported) {
  console.error(
    `Need Node >= ${runtime.minimumNodeMajor} or Bun. Detected ${runtime.runtime}.`,
  );
}
```

Returned shape:

```typescript
interface RuntimeSupportInfo {
  runtime: 'bun' | 'node' | 'unknown';
  isSupported: boolean;
  minimumNodeMajor: number;
  nodeVersion?: string;
  bunVersion?: string;
}
```

### `isSupportedRuntime(minimumNodeMajor?): boolean`

Convenience boolean wrapper around `getRuntimeSupportInfo()`.

```typescript
import { isSupportedRuntime } from 'unirend/utils';

if (!isSupportedRuntime()) {
  process.exitCode = 1;
}
```

### `assertSupportedRuntime(minimumNodeMajor?): void`

Throws when the current runtime does not satisfy Unirend's runtime requirement.

```typescript
import { assertSupportedRuntime } from 'unirend/utils';

assertSupportedRuntime();
```

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

### `escapeHTMLAttr(str: string): string`

Escapes characters that are unsafe in double-quoted HTML attribute values.

Converts the following to HTML entities:

- `&` -> `&amp;`
- `"` -> `&quot;`
- `<` -> `&lt;`
- `>` -> `&gt;`

```typescript
import { escapeHTMLAttr } from 'unirend/utils';

const href = escapeHTMLAttr('https://example.com/?q="x"&next=<home>');
// Returns: 'https://example.com/?q=&quot;x&quot;&amp;next=&lt;home&gt;'
```

## Content-Security-Policy Utilities

### `hashInlineContentForCSP(content: string, algorithm?): string`

Returns the CSP source expression for a piece of inline content, unquoted, for example `sha256-K/x...=`. Quoting is left to whoever assembles the directive, since a source list has unquoted members too. `algorithm` accepts `'sha256'` (default), `'sha384'`, or `'sha512'`, which is the whole list a browser understands.

Reach for this when your own code emits an inline `<style>` or `<script>` and the page has to keep working under a strict CSP. A custom 500 page is the usual case: it renders only when something has already gone wrong, so an unstyled one is easy to ship and hard to notice.

```typescript
import { hashInlineContentForCSP } from 'unirend/utils';

// Keep the inline text in its own constant, so the value you hash and the
// value the page emits cannot drift apart.
const PAGE_STYLES = `
  body { margin: 0; }
`;

export const PAGE_STYLE_HASH = hashInlineContentForCSP(PAGE_STYLES);

export function renderPage(): string {
  // Nothing between the tags and the interpolation.
  return `<html><head><style>${PAGE_STYLES}</style></head><body></body></html>`;
}
```

<!-- prettier-ignore -->
> [!IMPORTANT]
> Hash exactly what the browser will read. The digest covers the element's text content, and the tags themselves are not part of it. Leading and trailing whitespace, indentation, blank lines, and capitalization all change the answer, so there is no trimming and no tidying up.

Line endings are the one thing that does not change the answer, and that is deliberate. A CSP hash is matched against a DOM value rather than against the bytes on the wire, and a browser normalizes newlines while parsing, so the helper does the same: CRLF and lone CR become LF, and NUL becomes U+FFFD. Without that, a `PAGE_STYLES` constant in a file checked out on Windows would ship with CRLFs, be hashed by the browser without them, and render unstyled with nothing to point at. You do not have to configure git or add a `.gitattributes` to make this work.

That is why the example above keeps its own newline and indentation inside `PAGE_STYLES` rather than pretty-printing the markup around it. Formatting the output is fine, as long as the formatting lives in the value being hashed. Put a newline between `<style>` and `${PAGE_STYLES}` and the hash silently stops matching, with no error anywhere and a page that just renders unstyled.

The helper is exact for raw HTML strings sent straight to the transport, which is what an error page is. Content that passes through unirend's template pipeline is different: cheerio parses it and writes it out again, so it has to be hashed after serialization, which unirend does internally so you never touch it.

A hash of an element's content covers that element only. An `onclick=` handler or a `style=""` attribute is different content with a different digest, so an element hash never matches one.

An attribute **can** be hashed, it just takes more: `'unsafe-hashes'` in the governing directive plus a digest of the attribute's own value. Pass that value to this helper the same way, under the same rules. Better still is rewriting so there is no inline attribute to cover, since a hash listed for `'unsafe-hashes'` matches that value on any element in the page rather than the one you meant. Unirend's own error pages took that route: the refresh control is an anchor with an empty `href` rather than a button with an inline `onclick`. See [inline attributes](built-in-plugins/security-headers.md#inline-attributes-take-more-than-a-hash) for the full picture, including the warning unirend emits when a policy would block one.

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

> The shape above is reproduced for convenience. The exported `StaticContentRouterOptions` type in the source is authoritative if the two ever diverge.

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

Updates file mappings at runtime with targeted cache invalidation, only evicting entries whose URL-to-path mapping changed. Use this when routing is changing but file contents at existing paths are unchanged (e.g., adding or removing pages without rebuilding assets). For post-build reloads where file contents may have changed, use `replaceConfig` instead.

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

- **`singleAssetMap` changes**: Only invalidates filesystem paths whose URL-to-path _mapping_ changed (added, removed, or pointed to a different file). Paths whose mapping is unchanged are not evicted, `updateConfig` has no visibility into whether the file content on disk changed. If you know specific files were rebuilt in-place, use `invalidateFile` for surgical eviction, or for a full build flush use `replaceConfig`.
- **`folderMap` changes**: Clears all caches (folder changes are rare and structural)

#### `clearCaches(): void`

Clears all caches (useful for testing or cache invalidation).

#### `invalidateFile(fsPath): void`

Evicts a single file's cached content, stat, and ETag without touching any URL-to-path mappings.

Use this when you know a specific file changed on disk and want to force a fresh read on the next request, without flushing the entire cache. Works for files served via `singleAssetMap` or `folderMap`.

The parameter is the **filesystem path** (as it appears in the cache key), not a URL. For `singleAssetMap` entries these are the absolute paths you provided, and for folder-served files the cache key is the absolute path resolved at request time.

**When to use:** A file watcher or webhook that knows exactly which file was rewritten, and you want surgical invalidation rather than a full cache flush.

```typescript
// A file watcher detected /dist/about.html was rewritten in-place:
cache.invalidateFile('/dist/about.html');
```

#### `replaceConfig(newConfig): void`

Replaces routing maps and clears all file caches in one shot. The intended use case is reloading after a full build has completed.

Use this after a full build has completed. Unlike `updateConfig`, no attempt is made at targeted per-path invalidation, the routing maps are replaced and all file caches (content, stats, ETags) are wiped unconditionally.

**Why all caches are always cleared, even folder caches:** A build can change file contents in-place without renaming files. More importantly, the rebuilt HTML pages reference JS/CSS bundles served from `folderMap` directories, and those bundles were likely regenerated in the same build step. Even when only `singleAssetMap` is passed, the folder caches are still flushed, as selectively preserving them would risk serving stale assets alongside fresh pages that now reference new bundle hashes.

You may provide `singleAssetMap`, `folderMap`, or both. Omitted sections retain their current routing configuration. Pass an empty object (`{}`) for a section to clear all mappings in that section (e.g., `replaceConfig({ singleAssetMap: {} })` removes all single-asset routes).

For targeted cache invalidation (when URL-to-path mappings changed but file contents at those paths are unchanged), use `updateConfig` instead. If only specific files changed on disk (e.g., detected by a file watcher), use `invalidateFile` for surgical eviction without a full flush.

**When to use:**

- After an SSG or full client build, pages and assets were likely both regenerated
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

```typescript
const stats = cache.getCacheStats();
// stats.etag.items       — ETag cache entries
// stats.etag.byteSize    — ETag cache memory usage in bytes
// stats.content.items    — file content cache entries
// stats.content.byteSize — file content cache memory usage in bytes
// stats.stat.items       — file stat cache entries
// stats.stat.byteSize    — file stat cache memory usage in bytes
```

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
  | {
      served: true;
      statusCode:
        | 200 // Full file served
        | 206 // Partial content served
        | 304 // Not modified
        | 400 // Invalid range request
        | 416; // Range not satisfiable
    };
```

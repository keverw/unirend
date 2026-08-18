/**
 * Public utilities exported from unirend/utils
 *
 * This module exposes public utilities for static file caching, HTML escaping,
 * and runtime checks. Some are used internally by unirend, while others are
 * intended for use in consumer scripts.
 *
 * - StaticContentCache: Caching layer for static file serving with ETag support and LRU caching
 * - escapeHTML / escapeHTMLAttr: Safe HTML escaping for server-side HTML generation
 * - hashInlineContentForCSP: CSP source expression for an inline <style>/<script> block
 */

// =============================================================================
// Static Content Cache
// =============================================================================
// A caching layer for static file serving with ETag support, LRU caching,
// and optimized file serving for Fastify applications.

export { StaticContentCache } from './lib/internal/static-content-cache';

// Re-export types for StaticContentCache
export type {
  GetFileOptions,
  CreateStreamOptions,
  ServeFileResult,
  FileContent,
  FileNotFoundResult,
  FileErrorResult,
  FileNotModifiedResult,
  FileFoundResult,
  FileResult,
} from './lib/internal/static-content-cache';

export type { FolderConfig } from './lib/types';

// The stat shape carried on a `FileFoundResult`, and the router options and
// warn-logger object the `StaticContentCache` constructor takes. All three were
// reachable but unnameable from here, which left a cache configured in its own
// module unable to name what it was building.
export type {
  MinimalStatInfo,
  StaticContentWarnLoggerObject,
} from './lib/internal/static-content-cache';
export type { StaticContentRouterOptions } from './lib/types';

// =============================================================================
// HTML Utilities
// =============================================================================
// Utility functions for safely handling HTML content

export { escapeHTML, escapeHTMLAttr } from './lib/internal/html-utils/escape';

// =============================================================================
// Content-Security-Policy Helpers
// =============================================================================
// For code that emits its own inline <style> or <script> and needs the page to
// keep working under a strict CSP. A custom error page is the usual case.

export { hashInlineContentForCSP } from './lib/internal/csp-hash';

export type { CSPHashAlgorithm } from './lib/internal/csp-hash';

// Runtime detection helpers
export {
  MINIMUM_SUPPORTED_NODE_MAJOR,
  getRuntimeSupportInfo,
  isSupportedRuntime,
  assertSupportedRuntime,
} from './lib/internal/utils';

// The environment object those checks optionally accept is deliberately not
// exported: it defaults to `globalThis`, so only a test stub ever passes one,
// and a stub satisfies it structurally without naming it.
export type { RuntimeName, RuntimeSupportInfo } from './lib/internal/utils';

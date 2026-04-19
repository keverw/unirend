/**
 * Public utilities exported from unirend/utils
 *
 * This module exposes public utilities for static file caching, HTML escaping,
 * and runtime checks. Some are used internally by unirend, while others are
 * intended for use in consumer scripts.
 *
 * - StaticContentCache: Caching layer for static file serving with ETag support and LRU caching
 * - escapeHTML / escapeHTMLAttr: Safe HTML escaping for server-side HTML generation
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

// =============================================================================
// HTML Utilities
// =============================================================================
// Utility functions for safely handling HTML content

export { escapeHTML, escapeHTMLAttr } from './lib/internal/html-utils/escape';

// Runtime detection helpers
export {
  MINIMUM_SUPPORTED_NODE_MAJOR,
  getRuntimeSupportInfo,
  isSupportedRuntime,
  assertSupportedRuntime,
} from './lib/internal/utils';

export type { RuntimeName, RuntimeSupportInfo } from './lib/internal/utils';

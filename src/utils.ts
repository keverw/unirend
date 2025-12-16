/**
 * Public utilities exported from unirend/utils
 *
 * This module exposes utilities for domain/origin validation, static file caching,
 * and related functionality. While these are used internally by unirend, they can
 * also be used standalone in any project.
 */

// =============================================================================
// Domain Utilities
// =============================================================================
// Functions for domain/origin validation, normalization, and wildcard matching.
// Useful for CORS configuration, security checks, and URL handling.

export {
  // Core normalization functions
  normalizeOrigin,
  normalizeDomain,

  // Wildcard matching functions
  matchesWildcardDomain,
  matchesWildcardOrigin,

  // List matching functions
  matchesDomainList,
  matchesOriginList,
  matchesCORSCredentialsList,

  // Validation function
  validateConfigEntry,

  // IP address detection
  isIPAddress,

  // Type exports
  type WildcardKind,
} from './lib/internal/domain-utils/domain-utils';

// Additional low-level helpers that may be useful
export { checkDNSLength } from './lib/internal/domain-utils/helpers';

// =============================================================================
// Static Content Cache
// =============================================================================
// A caching layer for static file serving with ETag support, LRU caching,
// and optimized file serving for Fastify applications.

export { StaticContentCache } from './lib/internal/StaticContentCache';

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
} from './lib/internal/StaticContentCache';

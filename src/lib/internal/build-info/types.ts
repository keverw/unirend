/**
 * Shared types for build info generation and loading
 */

/**
 * Interface for build information
 */
export interface BuildInfo {
  build_timestamp: string;
  version: string;
  git_hash: string;
  git_branch: string;
  // Allow additional custom properties
  [key: string]: unknown;
}

/**
 * Configuration options for the build info generator
 */
export interface GenerateBuildInfoOptions {
  /** The working directory to use as base path (defaults to process.cwd()) */
  workingDir?: string;
  /** Optional version string to use instead of reading from package.json */
  version?: string;
  /** Custom properties to include in the build info */
  customProperties?: Record<string, unknown>;
}

/**
 * Result from build info generation with warnings
 */
export interface GenerationResult {
  buildInfo: BuildInfo;
  warnings: string[];
}

/**
 * Result from save operations
 */
export interface SaveResult {
  saved: boolean;
  warnings: string[];
}

/**
 * Status codes for build info loading
 */
export type BuildInfoStatus =
  | 'DEFAULT_NOT_PRODUCTION'
  | 'LOADED_SUCCESSFULLY'
  | 'MODULE_MISSING_DATA'
  | 'MODULE_INVALID_DATA'
  | 'IMPORT_ERROR';

/**
 * Result from build info loading operations
 */
export interface LoadResult {
  status: BuildInfoStatus;
  isDefault: boolean; // true when using DEFAULT_BUILD_INFO, false when using loaded info
  info: BuildInfo;
}

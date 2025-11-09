/**
 * Build Info Utilities
 *
 * This module provides utilities for accessing build information
 * in a way that works with both development and production environments,
 * and is compatible with various bundlers.
 */

// Import shared types
import type { BuildInfo, LoadResult } from './types';

/**
 * Default build info for development environments
 * Uses Unix epoch timestamp to make it clear this is fallback data
 */
export const DEFAULT_BUILD_INFO: BuildInfo = {
  version: '1.0.0',
  git_hash: 'dev',
  git_branch: 'dev',
  build_timestamp: '1970-01-01T00:00:00.000Z', // Unix epoch - clearly fake!
};

/**
 * Type guard to check if an unknown value is a valid BuildInfo object
 */
function isValidBuildInfo(value: unknown): value is BuildInfo {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).build_timestamp === 'string' &&
    typeof (value as Record<string, unknown>).version === 'string' &&
    typeof (value as Record<string, unknown>).git_hash === 'string' &&
    typeof (value as Record<string, unknown>).git_branch === 'string'
  );
}

/**
 * Load build information
 *
 * @param isProduction Whether the app is running in production mode
 * @param importPromise A promise that imports the build info module (passed as a function to avoid bundler issues)
 * @returns A promise that resolves to the build info result containing both the info and status
 */
export async function loadBuildInfo(
  isProduction: boolean,
  importPromise: () => Promise<unknown>,
): Promise<LoadResult> {
  // In development, just return the default build info
  if (!isProduction) {
    return {
      status: 'DEFAULT_NOT_PRODUCTION',
      isDefault: true,
      info: DEFAULT_BUILD_INFO,
    };
  }

  try {
    // In production, try to load the build info from the generated file
    const buildInfoModule = await importPromise();

    if (
      buildInfoModule &&
      typeof buildInfoModule === 'object' &&
      'BUILD_INFO' in buildInfoModule
    ) {
      const loadedInfo = (buildInfoModule as { BUILD_INFO: unknown })
        .BUILD_INFO;

      // Validate that BUILD_INFO is actually a valid BuildInfo object
      if (isValidBuildInfo(loadedInfo)) {
        return {
          status: 'LOADED_SUCCESSFULLY',
          isDefault: false,
          info: loadedInfo,
        };
      } else {
        return {
          status: 'MODULE_INVALID_DATA',
          isDefault: true,
          info: DEFAULT_BUILD_INFO,
        };
      }
    } else {
      return {
        status: 'MODULE_MISSING_DATA',
        isDefault: true,
        info: DEFAULT_BUILD_INFO,
      };
    }
  } catch {
    return {
      status: 'IMPORT_ERROR',
      isDefault: true,
      info: DEFAULT_BUILD_INFO,
    };
  }
}

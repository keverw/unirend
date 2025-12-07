/**
 * Shared utilities for handler version management
 * Used by both APIRoutesServerHelpers and DataLoaderServerHandlerHelpers
 */

/**
 * Validate that a version number is >= 1
 * Throws an error if validation fails
 */
export function validateVersion(version: number, context: string): void {
  if (version < 1) {
    throw new Error(`${context} version must be >= 1, got ${version}`);
  }
}

/**
 * Check if versioning is disabled but multiple versions exist, throwing if so
 */
export function validateSingleVersionWhenDisabled(
  useVersioning: boolean,
  versionMap: Map<number, unknown>,
  contextMessage: string,
): void {
  if (!useVersioning && versionMap.size > 1) {
    const versions = Array.from(versionMap.keys()).sort((a, b) => a - b);
    throw new Error(
      `${contextMessage} has multiple versions (${versions.join(', ')}) but versioning is disabled. ` +
        `Either enable versioning or register only one version per ${contextMessage.includes('Endpoint') ? 'endpoint' : 'page type'}.`,
    );
  }
}

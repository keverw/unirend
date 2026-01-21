/**
 * MIME Type Utilities
 *
 * Helper functions for MIME type validation and pattern matching.
 */

/**
 * Check if a MIME type matches a pattern (supports wildcards like 'image/*' or '*\/*')
 *
 * @param mimetype - Actual MIME type to check (e.g., 'image/jpeg')
 * @param pattern - Pattern to match against (e.g., 'image/*', 'image/jpeg', '*\/*')
 * @returns True if mimetype matches the pattern
 *
 * @example
 * ```typescript
 * matchesMimeTypePattern('image/jpeg', 'image/jpeg') // true - exact match
 * matchesMimeTypePattern('image/jpeg', 'image/*')    // true - wildcard match
 * matchesMimeTypePattern('image/png', 'image/*')     // true - wildcard match
 * matchesMimeTypePattern('video/mp4', 'image/*')     // false - different category
 * matchesMimeTypePattern('text/plain', '*\/*')        // true - all types wildcard
 * ```
 */
export function matchesMimeTypePattern(
  mimetype: string,
  pattern: string,
): boolean {
  // Exact match
  if (mimetype === pattern) {
    return true;
  }

  // Check for wildcard patterns
  if (pattern.includes('*')) {
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*'); // Replace * with .*

    return new RegExp(`^${regexPattern}$`).test(mimetype);
  }

  return false;
}

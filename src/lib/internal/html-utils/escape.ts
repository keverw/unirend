/**
 * Escapes HTML special characters to prevent XSS attacks
 *
 * Converts the following characters to HTML entities:
 * - & → &amp;
 * - < → &lt;
 * - > → &gt;
 * - " → &quot;
 * - ' → &#39;
 *
 * @param str - The string to escape
 * @returns The escaped string safe for insertion into HTML
 *
 * @example
 * ```ts
 * escapeHTML('<script>alert("xss")</script>');
 * // Returns: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 * ```
 */
export function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes a string for safe insertion into double-quoted HTML attributes.
 *
 * Converts the following characters to HTML entities:
 * - & → &amp;
 * - " → &quot;
 * - < → &lt;
 * - > → &gt;
 *
 * @param str - The string to escape
 * @returns The escaped string safe for insertion into HTML attributes
 */
export function escapeHTMLAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

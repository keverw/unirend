import { decodeHTML as entitiesDecodeHTML } from 'entities';

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

/**
 * Decodes standard HTML entities and numeric character references.
 *
 * @param str - The string to decode
 * @returns The decoded string
 */
export function decodeHTML(str: string): string {
  return entitiesDecodeHTML(str);
}

/**
 * Standard HTML boolean attributes.
 * These are true by presence alone, so true translates to empty string and false translates to 'false' (removal marker).
 */
export const HTML_BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]);

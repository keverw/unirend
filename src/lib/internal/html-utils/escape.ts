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
 * Escapes a string for safe insertion as HTML text content.
 *
 * Only `&`, `<`, and `>` are significant between tags. Quotes are not, so unlike
 * {@link escapeHTML} they're left alone, which keeps ordinary prose readable in the
 * served markup instead of peppering it with `&quot;`.
 *
 * @param str - The string to escape
 * @returns The escaped string safe for insertion as element text
 */
export function escapeHTMLText(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

/**
 * Whether an attribute record entry is a boolean attribute carrying that removal marker, so a
 * writer emits nothing for it rather than the marker itself.
 *
 * A predicate rather than the rule written out at each writer, because the marker only works if
 * every writer knows to read it, and one that does not is silently wrong in the worst direction:
 * `disabled="false"` is not a disabled of false, it is a disabled, since a boolean attribute is
 * true by presence whatever its value says. So the writer that forgets emits the opposite of what
 * the author asked for. That already happened once, to `serializeHeadCollector()`, which shipped a
 * `<link rel="stylesheet" disabled={false}>` to the server-rendered page as a disabled stylesheet
 * while the client rendered it enabled.
 *
 * Matched on the lowercased name, because the browser does, and because a record can reach this
 * with React's own spelling: `itemScope={false}` is encoded here as `itemScope="false"`.
 */
export function isRemovedBooleanAttribute(
  name: string,
  value: string,
): boolean {
  return HTML_BOOLEAN_ATTRIBUTES.has(name.toLowerCase()) && value === 'false';
}

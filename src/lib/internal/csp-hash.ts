import { createHash } from 'node:crypto';

/**
 * Hash algorithms a Content-Security-Policy source expression accepts.
 *
 * These three are the whole list. CSP names the algorithm in the source
 * expression itself (`'sha256-...'`), so a browser only honors a hash written
 * with one it knows about.
 */
export type CSPHashAlgorithm = 'sha256' | 'sha384' | 'sha512';

/**
 * Build the CSP source expression for a piece of inline content.
 *
 * Returns the value without the surrounding single quotes, for example
 * `sha256-K/x...=`. Quoting is the job of whoever assembles the directive,
 * since a source list has other unquoted members.
 *
 * **Hash exactly what the browser will receive.** The digest covers the text
 * content of the element byte for byte, with no trimming and no normalization,
 * and the `<script>` / `<style>` tags themselves are not part of it. Leading and
 * trailing whitespace, indentation, newlines, and capitalization all change the
 * answer, so a hash taken from a prettier-formatted source file will not match
 * the same content after anything rewrites it on the way out.
 *
 * That makes this exact for raw HTML strings sent straight to the transport, an
 * error page being the usual case, since what the function returned is what the
 * browser reads. Content that passes through unirend's template pipeline is a
 * different matter: cheerio parses it and writes it out again, so it has to be hashed
 * after serialization, which unirend does internally.
 *
 * Hashes cover inline `<script>` and `<style>` **elements** only. An `onclick=`
 * handler or a `style=""` attribute is not an element and is not covered by
 * one, so those need `'unsafe-hashes'` or, better, rewriting so they are not
 * inline attributes at all.
 *
 * @param content The exact text between the opening and closing tag
 * @param algorithm Digest to use, `sha256` unless you have a reason
 * @returns The unquoted source expression, e.g. `sha256-...`
 *
 * @example
 * ```ts
 * const styles = `body { margin: 0; }`;
 * const page = `<style>${styles}</style>`;
 * // Hash the interpolated value, not the surrounding template.
 * const source = hashInlineContentForCSP(styles);
 * // style-src 'self' 'sha256-...'
 * ```
 */
export function hashInlineContentForCSP(
  content: string,
  algorithm: CSPHashAlgorithm = 'sha256',
): string {
  return `${algorithm}-${createHash(algorithm).update(content, 'utf8').digest('base64')}`;
}

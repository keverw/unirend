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
 * **Hash what the browser will read, which is not quite what you send.** The
 * digest covers the element's text content, and the `<script>` / `<style>` tags
 * themselves are not part of it. Leading and trailing whitespace, indentation,
 * newlines, and capitalization all change the answer, so a hash taken from a
 * prettier-formatted source file will not match the same content after anything
 * rewrites it on the way out.
 *
 * The one thing that does not change the answer is a line ending, and that is
 * deliberate rather than incidental. A CSP hash covers a DOM value, so the
 * argument is normalized here the same way a browser normalizes it while
 * parsing: CRLF and lone CR become LF, and NUL becomes U+FFFD. See
 * {@link normalizeForCSPHash}. Without that, a `<style>` constant living in a
 * file checked out on Windows, which git will happily give you with CRLFs,
 * hashes to a digest the browser never computes, and the page renders unstyled
 * under a strict `style-src` with nothing anywhere mentioning line endings.
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
  return `${algorithm}-${createHash(algorithm).update(normalizeForCSPHash(content), 'utf8').digest('base64')}`;
}

/**
 * Put text through the normalizations a browser has already applied by the time
 * it computes a CSP hash.
 *
 * A hash source is matched against a DOM value, never against the bytes on the
 * wire, and two characters cannot survive parsing to reach one:
 *
 * - **CR.** Newlines are normalized in "Preprocessing the input stream", before
 *   tokenization and therefore everywhere. CRLF and a lone CR both become LF.
 * - **NUL.** Replaced with U+FFFD by the tokenizer states that read raw text,
 *   which is where `<script>` and `<style>` content is read, and by the
 *   attribute-value states as well.
 *
 * Between them those two cover every context a CSP hash is ever computed in:
 * inline element content, and the `on*=` or `style=` attribute value that an
 * `'unsafe-hashes'` policy matches. The ordinary data state does pass a NUL
 * through untouched, but ordinary text is never hashed, so there is no context
 * where this normalization is the wrong answer.
 *
 * Verified in Chrome rather than reasoned about, because this file previously
 * documented the opposite and had a test pinning it: the intuition that a hash
 * covers the bytes you sent is wrong, and wrong quietly. Serving one `<style>`
 * whose content carries CRLFs under two policies differing only in the digest,
 * the normalized one applies and the literal-bytes one is refused with
 * "Applying inline style violates the following Content Security Policy
 * directive", naming the normalized digest as the hash that would work. The
 * element's `textContent` in the resulting DOM contains no CR. The NUL half
 * behaves the same way: the U+FFFD digest applies, the literal-NUL digest is
 * refused, and `textContent` holds U+FFFD.
 *
 * Exported so a caller assembling a policy by hand can compare like with like,
 * and because the rule is worth being able to point at.
 */
export function normalizeForCSPHash(content: string): string {
  return content.replace(/\r\n?/g, '\n').replace(/\0/g, '�');
}

/**
 * `type` values a browser treats as JavaScript.
 *
 * **Do not "parse the MIME type and compare the essence before the `;`".** That
 * change looks like a fix, has been proposed as one more than once, and is
 * wrong. [Prepare the script element][prepare] tests the attribute for a
 * [JavaScript MIME type essence match][essence], and an essence is the bare
 * type with no parameters, so a `type` carrying one matches nothing and the
 * element is never executed. The standard uses this very case as its worked
 * example: scripts with `type="text/javascript; charset=utf-8"` "will not be
 * evaluated, even though that is a valid JavaScript MIME type when parsed".
 * Accepting parameters here would publish hashes for inert content, which is
 * noise rather than safety. `collectTemplateCSPHashes` has a regression test
 * pinning it.
 *
 * [prepare]: https://html.spec.whatwg.org/multipage/scripting.html#prepare-the-script-element
 * [essence]: https://mimesniff.spec.whatwg.org/#javascript-mime-type-essence-match
 *
 * Verified in Chrome as well, through both the parser and `createElement`,
 * since the rule is unintuitive enough to be worth checking rather than
 * reasoning about. Executed: no attribute, `""`, `text/javascript`,
 * `TEXT/JAVASCRIPT`, `  text/javascript  `, `text/ecmascript`, `module`,
 * `MODULE`. Not executed: `text/javascript; charset=utf-8`,
 * `application/javascript; charset=utf-8`, `module; charset=utf-8`, `"   "`,
 * `application/json`.
 *
 * One harmless over-inclusion is left in deliberately. Whitespace is stripped
 * for both comparisons here, but a browser strips it only for the MIME half, so
 * `  module  ` does not execute and still gets a hash. An unused source
 * expression costs nothing, where the opposite error blocks a script.
 */
const JAVASCRIPT_SCRIPT_TYPES = new Set([
  'text/javascript',
  'application/javascript',
  'module',
  'text/ecmascript',
  'application/ecmascript',
]);

/**
 * `type` values that are not JavaScript, are never executed as code, and are
 * still governed by `script-src`.
 *
 * These are the reason this module asks "is it governed" rather than "is it
 * JavaScript", which is the more intuitive question and the wrong one. Both
 * carry JSON, neither runs, and a browser blocks both without a hash, a nonce,
 * or `'unsafe-inline'`.
 *
 * `importmap` decides how every bare module specifier on the page resolves, so
 * losing it does not degrade anything gracefully: the map is blocked and then
 * every `import 'dep'` fails with a module resolution error, which reads like a
 * bundler problem rather than a CSP one.
 *
 * `speculationrules` drives prefetch and prerender. Losing it is invisible,
 * which is worse in its own way, since the only symptom is a site that quietly
 * stopped being fast. `'inline-speculation-rules'` is the other way to allow it
 * and stays available to anyone who prefers a keyword to a hash.
 *
 * [Prepare the script element][prepare] is explicit about both. Type
 * determination happens before the inline check, the check runs for any script
 * with no `src` whatever its type, and an import map may not have a `src` at
 * all, so it always takes that path. Speculation rules are passed the CSP type
 * `script speculationrules` rather than `script`, which is what the dedicated
 * keyword keys on, and hashes match there as well.
 *
 * Verified in Chrome rather than reasoned about, because the intuition that
 * "it is not JavaScript so `script-src` cannot apply" is exactly wrong here. An
 * inline import map under `script-src 'self'` is refused with "Executing inline
 * script violates the following Content Security Policy directive", naming the
 * hash that would allow it, and the module that depends on it then fails to
 * resolve its specifier. Adding that hash makes both work. An inline
 * `speculationrules` block under the same policy is refused with "Applying
 * inline speculation rules violates ...", naming its hash, and adding it clears
 * the violation.
 */
const NON_JAVASCRIPT_CSP_GOVERNED_SCRIPT_TYPES = new Set([
  'importmap',
  'speculationrules',
]);

/**
 * Whether an inline `<script>` carrying this `type` is one `script-src`
 * governs, and so one a hash is worth publishing for.
 *
 * **The question is "is it governed", not "is it executed".** They are not the
 * same, and the difference is the whole reason this is a named function rather
 * than a set membership test at each call site. An import map is inert JSON
 * that a browser will nonetheless refuse to apply under a strict `script-src`,
 * so a scanner that skips everything non-executable silently drops the one
 * element the page's module graph depends on.
 *
 * Lives here, next to the hashing itself, because both places that scan for
 * inline content have to answer it the same way: the template scanner in
 * `format.ts` and the rendered-body scanner in `inject.ts`. Two copies of this
 * rule would drift, and the direction it drifts matters, since hashing inert
 * content is only noise while skipping governed content blocks a page.
 *
 * Still false for a data block such as `application/json` or
 * `application/ld+json`, which is the reason the JSON payload unirend emits for
 * the client bootstrap needs no hash and no nonce.
 *
 * @param type The element's `type` attribute, or undefined when it has none
 */
export function isCSPGovernedScriptType(type: string | undefined): boolean {
  // An absent attribute means "classic script", and so does an empty one, both
  // of which execute. Only the empty string, not a whitespace-only value: a
  // browser executes `type=""` and does not execute `type="   "`, which is why
  // this is matched before the trim below rather than after it.
  if (type === undefined || type === '') {
    return true;
  }

  const normalized = type.trim().toLowerCase();

  return (
    JAVASCRIPT_SCRIPT_TYPES.has(normalized) ||
    NON_JAVASCRIPT_CSP_GOVERNED_SCRIPT_TYPES.has(normalized)
  );
}

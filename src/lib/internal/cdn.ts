/**
 * The CDN base URL and the placeholder that stands in for it, kept together
 * because they are two halves of one thing: the placeholder is what the
 * template writes, and this normalization decides the exact bytes it turns
 * into.
 *
 * Its own module, and deliberately a tiny one that imports nothing. Both halves
 * are needed by the HTML pipeline, which runs under SSR, SSG, and the template
 * processor alike, and the obvious home for them, `server-utils`, pulls in the
 * error pages, the envelope sender, and `ulid`. None of that belongs in the
 * path that formats a template.
 */

/**
 * Stands in for the CDN base URL inside the HTML template, so one processed
 * template can be served under a different CDN per request.
 *
 * `processTemplate` stamps it onto the build's own `script[src]` and
 * `link[href]`, and a template may write it into a URL of its own by hand,
 * which is the only way markup in index.html can follow the CDN: there is no
 * React context there to call `useCDNBaseURL()` from. `injectContent` resolves
 * every occurrence in the template, to the configured base URL or to nothing,
 * which leaves the original root-relative path.
 *
 * Valid in an inline `<script>` or `<style>` as well as in a URL, but those
 * cost something the attribute positions do not. A CSP hash for inline content
 * is normally taken once, when the template is processed, and a block carrying
 * this cannot be: the value it resolves to is decided per request, so one
 * cached digest could never describe what ships. `processTemplate` reports
 * those blocks as `cdnDependent` instead of hashing them, and the request path
 * hashes them after resolving. See `resolveTemplateCSPHashes` in
 * `html-utils/format.ts`.
 *
 * Resolved against the template only. Rendered markup is not searched for it,
 * because components have `useCDNBaseURL()` and because a whole-document
 * replace also reached bare text and the JSON data block, rewriting values that
 * merely contained the string.
 */
export const CDN_INJECTION_PLACEHOLDER = '__CDN__INJECTION__POINT__';

/**
 * Normalizes a CDN base URL by stripping a trailing slash, so the value is
 * consistent whether it comes from server config, per-request override, or
 * the injected `window.__CDN_BASE_URL__` global read by the client.
 *
 * Must be applied before the URL is placed into `unirendContext.cdnBaseURL`
 * so that `useCDNBaseURL()` returns the same value on server and client,
 * avoiding React hydration mismatches when a trailing-slash URL is configured.
 *
 * There is one of these rather than a copy per call site, and that matters more
 * than it looks. Whatever this returns is substituted for
 * {@link CDN_INJECTION_PLACEHOLDER} and then hashed for CSP, so two spellings
 * of "strip the trailing slash" that disagreed by a single character would put
 * a digest in the policy for a URL the page does not contain, and the browser
 * would block the block it was meant to allow.
 */
export function normalizeCDNBaseURL(url: string | undefined): string {
  if (!url) {
    return '';
  }

  return url.endsWith('/') ? url.slice(0, -1) : url;
}

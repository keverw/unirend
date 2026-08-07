import { TAB_SPACES, TEMPLATE_META_MARKER_ATTRIBUTE } from '../consts';
import { getDevMode } from 'lifecycleion/dev-mode';
import {
  renderContextDataElements,
  type UnirendContextData,
} from './context-data-block';
import {
  escapeHTMLAttr,
  decodeHTMLAttributeValue,
  isRemovedBooleanAttribute,
} from './escape';
import { getMetaKeys } from './meta-key';
import { hashInlineContentForCSP, isCSPGovernedScriptType } from '../csp-hash';
import type { AnyNode } from 'domhandler';
import type { CheerioAPI, load as cheerioLoad } from 'cheerio';

/**
 * The parse5 source offsets cheerio attaches under `sourceCodeLocationInfo`.
 *
 * The tag offsets are what make an element's *text content* addressable, as
 * opposed to the whole element: everything between the open tag's end and the
 * close tag's start, byte for byte in the original source. That is exactly what
 * a CSP hash covers, so a digest taken from this range is one the browser will
 * agree with.
 */
interface ScriptSourceLocation {
  startOffset: number;
  endOffset: number;
  startTag?: { endOffset: number };
  endTag?: { startOffset: number };
}

/**
 * Apply the two normalizations the HTML tokenizer performs on raw text, so a
 * digest taken from the source bytes agrees with the one a browser computes.
 *
 * A CSP hash covers an element's **child text content**, which is a DOM value
 * rather than a byte range, and neither a CR nor a NUL survives into one. The
 * two get there by different routes, which is worth keeping straight because
 * only one of them is universal. Newlines are normalized in "Preprocessing the
 * input stream", before tokenization and so for every element: CRLF and a lone
 * CR both become LF. NUL is replaced with U+FFFD by the tokenizer states that
 * read raw text, which is where `<script>` and `<style>` content is read, while
 * the ordinary data state passes a NUL through untouched.
 *
 * That difference is why this function is only ever called on the contents of a
 * raw-text element. Applied to anything else, the NUL half would be wrong.
 *
 * Reading raw source offsets is still right for everything else, which is why
 * this is a normalization rather than a switch back to the parsed tree. Rendered
 * markup ships verbatim and never round-trips through a serializer, so the
 * offsets are the only way to get at content cheerio would otherwise rewrite.
 * These two characters are the entire gap between the bytes and the tree in a
 * raw-text element: nothing else in `<script>` or `<style>` is decoded or
 * rewritten, entity references included.
 *
 * Getting the direction wrong is silent and one-sided. Publishing the
 * un-normalized digest blocks the very content the hash was for, on a policy
 * that reads as though it allows it, and the only trigger is a line ending
 * nobody looks at: a CMS field or a file read on Windows reaching the page
 * through `dangerouslySetInnerHTML`.
 */
function normalizeRawTextForHash(content: string): string {
  return content.replace(/\r\n?/g, '\n').replace(/\0/g, '�');
}

/**
 * React Router's hydration script, as it emits it:
 *
 * ```html
 * <script>window.__staticRouterHydrationData = JSON.parse("{\"loaderData\":…}");</script>
 * ```
 *
 * The argument is a JSON string token whose contents are themselves JSON. That
 * double encoding is deliberate on React Router's part, since parsing one large
 * string beats parsing an equivalent object literal.
 *
 * Matching the whole element rather than just the call keeps this from firing on
 * anything else that happens to mention the global.
 */
const ROUTER_HYDRATION_SCRIPT =
  /^<script(?:\s[^>]*)?>\s*window\.__staticRouterHydrationData\s*=\s*JSON\.parse\(\s*("(?:[^"\\]|\\.)*")\s*\)\s*;?\s*<\/script>$/;

/**
 * Pull the hydration payload out of React Router's assignment script.
 *
 * Returns the inner JSON **text**, character for character as React Router
 * encoded it, so it can be handed to the client to `JSON.parse` exactly as the
 * original script would have. Nothing here re-encodes the payload.
 *
 * Returns `null` when the script is not the expected shape, which is the signal
 * to leave it alone and emit it verbatim. React Router owns that output and may
 * change it; guessing at a shape we do not recognize would break hydration,
 * where declining costs only the ability to cover it with a CSP hash.
 */
function extractRouterHydrationPayload(script: string): string | null {
  const match = ROUTER_HYDRATION_SCRIPT.exec(script.trim());

  if (!match) {
    return null;
  }

  try {
    // The captured group is a JSON string token, so parsing it yields the inner
    // JSON text. A non-string result means the shape is not what it looked like.
    const payload: unknown = JSON.parse(match[1]);

    return typeof payload === 'string' ? payload : null;
  } catch {
    return null;
  }
}

// Prettify all head tags: each tag (<title>, <meta>, <link>, etc.) on its own line, indented
export function prettifyHeadTags(head: string, indent = TAB_SPACES): string {
  // Use a non-capturing group so tag names are not included in the split output
  return head
    .split(/(?=<(?:title|meta|link|script|style|base|noscript|preload)\b)/g)
    .filter(Boolean)
    .map((line) => indent + line.trim())
    .join('\n')
    .trim();
}

interface HeadTagMatch {
  start: number;
  end: number;
  attrs: Record<string, string>;
}

/**
 * Match a closing tag for `tagName` at `index`, returning the index just past its '>', or -1.
 *
 * HTML allows whitespace between the tag name and the '>' of a closing tag, so `</script >`
 * closes a script just as `</script>` does. Matching the exact string only would end a script
 * one character too late (missing its real close and swallowing the rest of the head) or, for
 * `</head >`, fail to notice the head ended at all and carry the scan into the body.
 */
function matchClosingTagAt(
  html: string,
  lower: string,
  index: number,
  tagName: string,
): number {
  const prefix = `</${tagName}`;

  if (!lower.startsWith(prefix, index)) {
    return -1;
  }

  let i = index + prefix.length;

  while (i < html.length && /\s/.test(html[i])) {
    i++;
  }

  return html[i] === '>' ? i + 1 : -1;
}

/**
 * Find the next real closing tag for `tagName` at or after `from`. Skips text that only starts
 * like one, such as `</scripts>`, which does not close a script.
 */
function findClosingTag(
  html: string,
  lower: string,
  from: number,
  tagName: string,
): number {
  let i = from;

  for (;;) {
    const found = lower.indexOf(`</${tagName}`, i);

    if (found === -1) {
      return -1;
    }

    const end = matchClosingTagAt(html, lower, found, tagName);

    if (end !== -1) {
      return end;
    }

    i = found + 2;
  }
}

/**
 * Scan forward from the '<' of an opening tag to the index just past its closing '>',
 * ignoring any '>' that sits inside a quoted attribute value (e.g. content="scale > 1").
 * Returns -1 when the tag is never closed.
 */
function findTagEnd(html: string, tagStart: number): number {
  let isInDoubleQuote = false;
  let isInSingleQuote = false;

  for (let i = tagStart; i < html.length; i++) {
    const char = html[i];

    if (char === '"' && !isInSingleQuote) {
      isInDoubleQuote = !isInDoubleQuote;
    } else if (char === "'" && !isInDoubleQuote) {
      isInSingleQuote = !isInSingleQuote;
    } else if (char === '>' && !isInDoubleQuote && !isInSingleQuote) {
      return i + 1;
    }
  }

  return -1;
}

/**
 * Find opening tags with the given name, stopping at </head> when it's present so we never
 * reach into the body.
 *
 * Every opening tag is consumed as a whole, quote-aware unit, not just the tag being looked
 * for, and comment and script/style bodies are skipped wholesale. That means the substrings
 * this scanner treats as significant ('</head>', '<!--', '<script', '<style') are only ever
 * recognized in real markup positions — one sitting inside another tag's attribute value,
 * as in <link title="a </head> b">, is passed over with the tag that contains it instead of
 * cutting the scan short and hiding the metas beyond it.
 *
 * For the same reason the end of the head is recognized during the scan rather than looked up
 * ahead of it: only </script> closes a script, so an inline script may legally hold the text
 * "</head>" in a string, and searching for it up front would stop the scan early.
 */
function findHeadTags(html: string, tagName: string): HeadTagMatch[] {
  const lower = html.toLowerCase();
  const matches: HeadTagMatch[] = [];

  let i = 0;

  while (i < html.length) {
    // Anything that isn't the start of a tag or comment is text, and text can't contain a
    // significant substring — a bare '<' in text is not valid HTML.
    if (html[i] !== '<') {
      i++;
      continue;
    }

    if (html.startsWith('<!--', i)) {
      const commentEnd = html.indexOf('-->', i + 4);

      if (commentEnd === -1) {
        break;
      }

      i = commentEnd + 3;
      continue;
    }

    if (matchClosingTagAt(html, lower, i, 'head') !== -1) {
      break;
    }

    const nameMatch = /^<([a-z][a-z0-9-]*)/i.exec(html.slice(i, i + 32));

    if (!nameMatch) {
      // A closing tag or stray '<'. Closing tags carry no attributes, so there's nothing
      // inside them that could be mistaken for markup.
      i++;
      continue;
    }

    const foundName = nameMatch[1].toLowerCase();
    const tagEnd = findTagEnd(html, i + nameMatch[0].length);

    // Unterminated tag — nothing further can be parsed.
    if (tagEnd === -1) {
      break;
    }

    // Skip a script or style along with its whole body: its contents are raw text, and only
    // the matching closing tag ends it.
    if (foundName === 'script' || foundName === 'style') {
      const closeEnd = findClosingTag(html, lower, tagEnd, foundName);

      // An unterminated script/style means the rest of the document is its body,
      // so there are no further head tags to find.
      if (closeEnd === -1) {
        break;
      }

      i = closeEnd;
      continue;
    }

    if (foundName === tagName) {
      const attrStart = i + nameMatch[0].length;

      matches.push({
        start: i,
        end: tagEnd,
        // tagEnd sits past the '>', and a self-closing tag ends in '/>', so trim both back
        // off before parsing the attributes.
        attrs: parseAttributesString(
          html.slice(attrStart, tagEnd - 1).replace(/\/$/, ''),
        ),
      });
    }

    i = tagEnd;
  }

  return matches;
}

/**
 * Expand a removal range to swallow the whole line when the tag sits alone on it, so
 * dropping a tag doesn't leave a blank indented line behind.
 */
function expandToWholeLine(
  html: string,
  range: { start: number; end: number },
): { start: number; end: number } {
  const lineStart = html.lastIndexOf('\n', range.start - 1) + 1;
  let lineEnd = html.indexOf('\n', range.end);

  if (lineEnd === -1) {
    lineEnd = html.length;
  }

  const before = html.slice(lineStart, range.start);
  const after = html.slice(range.end, lineEnd);

  if (before.trim() === '' && after.trim() === '') {
    return { start: lineStart, end: Math.min(lineEnd + 1, html.length) };
  }

  return range;
}

export interface TemplateMetaMergeResult {
  /** The template with overridden metas removed and the surviving ones marked. */
  template: string;
  /**
   * Every identifiable meta the template declares, including the ones removed just above.
   * This is the baseline the client restores from, so it has to describe the template as
   * authored, not the head as served for this particular page.
   */
  baseline: Array<Record<string, string>>;
}

/**
 * Merge the template's <meta> baseline with the metas this page declares through UnirendHead.
 *
 * The template's metas are a baseline: they're served as-is unless the page declares the same
 * tag, in which case the page's version wins and the template's copy is removed so the served
 * head doesn't end up with both. Metas the page never mentions (viewport, theme-color, robots,
 * and anything else the app puts in index.html) pass through untouched.
 *
 * The surviving template metas are marked so the client can tell them apart from the ones React
 * hoists, and the full baseline is returned so the client can put back a meta this page
 * overrode once the user navigates to a page that doesn't. Between them, those two let
 * UnirendHead keep the override contract true across client-side navigation instead of only on
 * the server-rendered page.
 *
 * The tags UnirendHead manages for every page (<title>, description, og:*, twitter:*) are
 * already gone by now — processTemplate() strips those, since that rule doesn't depend on the
 * page and its output is cached across pages.
 *
 * Runs against the template before any rendered body content is spliced in, so the string
 * surgery here can never touch React's markup or its hydration markers.
 */
export function mergeTemplateMetas(
  template: string,
  headContent: string,
): TemplateMetaMergeResult {
  const pageMetaKeys = new Set<string>();

  for (const meta of findHeadTags(headContent, 'meta')) {
    // Every identity the page's meta carries, not just the first. A page meta written as
    // `name="twitter:title" property="og:site_name"` is both of those tags, so it overrides a
    // template meta of either identity.
    for (const key of getMetaKeys(meta.attrs)) {
      pageMetaKeys.add(key);
    }
  }

  const baseline: Array<Record<string, string>> = [];
  const edits: Array<{ start: number; end: number; replacement: string }> = [];

  for (const meta of findHeadTags(template, 'meta')) {
    // Every identity this one carries, for the override test just below. A template meta can carry
    // two the same way a page's can, and a page overriding either of them replaces it.
    //
    // Nothing is filed under a key here. The baseline is a flat list of attribute records and the
    // marker is a valueless attribute, so this side never has to name a meta. The client builds its
    // own index over that list when it pairs the baseline back up with the marked nodes in the
    // head, and it groups by the same whole identity set this loop decides from. See
    // `templateMetaSignature()` in UnirendHead.tsx.
    const keys = getMetaKeys(meta.attrs);

    // Metas with no identifying attribute (<meta charset>) can't be overridden by name, so
    // they're not part of the baseline and are left exactly as the template wrote them.
    if (keys.length === 0) {
      continue;
    }

    baseline.push(meta.attrs);

    // Decided from this meta's whole identity set, so two template metas sharing only their first
    // identity can go separate ways. The client pairs the baseline back up by the same set, since
    // it can no longer assume that one survivor speaks for every meta with that first identity.
    if (keys.some((key) => pageMetaKeys.has(key))) {
      const { start, end } = expandToWholeLine(template, meta);
      edits.push({ start, end, replacement: '' });
      continue;
    }

    // Mark the survivor. The marker goes just before the tag's closing '>' (or before the '/'
    // of a self-closing '/>'), so the rest of the tag is preserved byte for byte.
    const tag = template.slice(meta.start, meta.end);
    const insertAt = meta.end - (tag.endsWith('/>') ? 2 : 1);

    edits.push({
      start: insertAt,
      end: insertAt,
      replacement: ` ${TEMPLATE_META_MARKER_ATTRIBUTE}`,
    });
  }

  let result = template;

  // Apply from the end first so earlier offsets stay valid.
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result =
      result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  }

  return { template: result, baseline };
}

export interface InjectContentOptions {
  context?: {
    app?: Record<string, unknown>;
    request?: Record<string, unknown>;
  };
  CDNBaseURL?: string;
  domainInfo?: { hostname: string; rootDomain: string } | null;
  htmlAttrs?: Record<string, string>;
  bodyAttrs?: Record<string, string>;
  /**
   * Receives CSP source expressions, quoted and ready to drop into a directive,
   * for the inline content this function emits that nothing earlier could have
   * hashed.
   *
   * Two kinds reach it, and both exist for the same reason: the caller
   * contributes a request's hashes from the *template* before rendering, and
   * neither of these is in the template.
   *
   * The rendered body is the larger of the two. React 19 renders a hoistable
   * `<style>` or `<script>` inline in the SSR stream, and anything using
   * `dangerouslySetInnerHTML` can put one there directly, so a page's own
   * inline content is decided per render and lands in the `<!--ss-outlet-->`
   * splice. Without this it is served under a policy that never heard of it,
   * which for a `<style>` means an unstyled page and for a `<script>` means one
   * that silently never runs.
   *
   * The other is a React Router hydration script in a shape
   * `extractRouterHydrationPayload` declined to take apart, which is then
   * passed through verbatim rather than lifted into the data block.
   *
   * Not needed by a caller that hashes the finished document itself, which is
   * what SSG does, so it is optional. Its absence is also what keeps the extra
   * hashing off servers that are not using CSP: nothing here is computed unless
   * a callback is supplied.
   */
  addCSPSources?: (sources: {
    scriptSrc?: readonly string[];
    styleSrc?: readonly string[];
  }) => void;
}

/**
 * Replace the first occurrence of `marker` with `value`, treating `value` as
 * literal text.
 *
 * `String.prototype.replace` expands `$&`, `` $` ``, `$'`, and `$1` **in the
 * replacement**, which is a disaster when the replacement is a rendered page.
 * `$&` alone is enough: `<p>Cost: $&nbsp;5</p>` is an ordinary price followed
 * by a non-breaking space, and it substituted the marker back into the output.
 * `` $` `` is worse, splicing the entire preceding document into the body.
 *
 * Passing a function bypasses the substitution rules entirely, which is the
 * documented way to say "this is literal". Every replacement here is untrusted
 * in the relevant sense: the rendered body is whatever the app rendered, the
 * head is whatever the page declared, and the context scripts carry the JSON
 * data block, which holds the request context and the app config.
 *
 * It also protected the CSP hashes. A corrupted body no longer matches the
 * digest taken from it, so a `<style>` downstream of a stray `$&` was blocked
 * with nothing to explain it.
 */
function replaceLiteral(source: string, marker: string, value: string): string {
  return source.replace(marker, () => value);
}

// Utility to inject content, preserving React attributes
export async function injectContent(
  template: string,
  headContent: string,
  bodyContent: string,
  options: InjectContentOptions = {},
): Promise<string> {
  const {
    context,
    CDNBaseURL,
    domainInfo,
    htmlAttrs,
    bodyAttrs,
    addCSPSources,
  } = options;

  // Collected as this function goes and reported in one call at the end, so a
  // caller that pushes straight onto a request's policy is not asked to
  // deduplicate what a single render contributed.
  const pageScriptSources = new Set<string>();
  // Prettify all head tags with consistent indentation
  const compactedHead = prettifyHeadTags(headContent);

  // Merge the template's meta baseline with the page's own metas, so the page's versions are
  // the only ones served. Done before the body is spliced in, while the template still holds
  // nothing but markers where the rendered markup will go.
  const { template: mergedTemplate, baseline: templateMetas } =
    mergeTemplateMetas(template, headContent);

  // Use cheerio to find React Router's hydration script in the rendered body content.
  // StaticRouterProvider (server) renders window.__staticRouterHydrationData as a React child,
  // but RouterProvider (client) renders no such script — causing a hydration mismatch when any
  // HTML wrapper sits between the framework root and the router. Moving it to <head> eliminates
  // the mismatch; the client reads the global before React hydrates so location doesn't matter.
  //
  // We use cheerio only for detection/offsets, then splice the original bodyContent.
  // This avoids any risk of cheerio re-serializing React's hydration markers/attributes.

  const cheerio = await import('cheerio');
  // Cheerio forwards this parse5 option at runtime, but its exported TypeScript
  // type does not expose it. The option gives us original source offsets.
  const parseOptions = {
    sourceCodeLocationInfo: true,
  } as unknown as Parameters<typeof cheerio.load>[1];
  const $body = cheerio.load(bodyContent, parseOptions);
  const routerHydrationScripts: string[] = [];
  const removalRanges: Array<{ start: number; end: number }> = [];

  // Every hydration script this pass recognized, by reference, so the page-wide
  // scan below can leave them out. One shape never ships at all (it is lifted
  // into the JSON data block) and the other is hashed from the raw source
  // offsets right here, so in neither case is a second hash from the parsed
  // tree the right answer.
  const routerHydrationElements = new Set<AnyNode>();

  // The hydration payload, lifted out of React Router's assignment script so it
  // can ride in the JSON data block with everything else. Left undefined when
  // there is no hydration script, or when one was found in a shape this cannot
  // safely take apart.
  let routerHydration: string | undefined;

  $body('script').each((_, el) => {
    if (($body(el).html() ?? '').includes('__staticRouterHydrationData')) {
      const location = (
        el as {
          sourceCodeLocation?: ScriptSourceLocation;
        }
      ).sourceCodeLocation;

      if (!location) {
        return;
      }

      // Read the raw source rather than $body.html(el): cheerio's serializer
      // output is not hydration-safe, and re-serializing a payload this file
      // does not own is exactly the thing to avoid.
      const rawScript = bodyContent.slice(
        location.startOffset,
        location.endOffset,
      );

      const payload = extractRouterHydrationPayload(rawScript);

      if (payload === null) {
        // Unrecognized shape, so leave it alone and emit it verbatim as before.
        // Better a script that CSP has to be told about than a hydration
        // payload mangled by a guess at what React Router meant.
        routerHydrationScripts.push(rawScript);

        // Told, rather than merely something to tell. The alternative is a
        // strict policy blocking this script, which leaves the page rendered,
        // hydration never starting, and nothing anywhere saying why, on the one
        // path that exists to be forgiving about React Router changing its
        // output.
        //
        // The digest covers the element's text content and not the element, so
        // it is read from between the tags rather than from `rawScript`. Taken
        // from the original source through parse5's offsets: re-serializing
        // through cheerio to get at the content would reintroduce the mangling
        // this branch exists to avoid, and could hash something the browser
        // never sees. Normalized on the way out, since text content is what a
        // browser hashes and the tokenizer has already been over it.
        const contentStart = location.startTag?.endOffset;
        const contentEnd = location.endTag?.startOffset ?? location.endOffset;

        if (
          addCSPSources &&
          contentStart !== undefined &&
          contentEnd >= contentStart
        ) {
          pageScriptSources.add(
            `'${hashInlineContentForCSP(
              normalizeRawTextForHash(
                bodyContent.slice(contentStart, contentEnd),
              ),
            )}'`,
          );
        }
      } else {
        routerHydration = payload;
      }

      routerHydrationElements.add(el);

      removalRanges.push({
        start: location.startOffset,
        end: location.endOffset,
      });
    }
  });

  // The rest of the rendered page's own inline content.
  //
  // This is not a corner case. React 19 renders a hoistable `<style>` or
  // `<script>` inline in the SSR stream, `dangerouslySetInnerHTML` can put one
  // anywhere, and a component is free to render either directly. All of it is
  // decided per render, so the template hashes the caller contributed before
  // rendering cannot possibly cover it. Left out, the page ships under a policy
  // that never heard of it: a `<style>` renders unstyled and a `<script>`
  // silently never runs, on a header that reads as though it allows same-origin
  // content.
  //
  // Only asked for when a caller wants the answer, which keeps the scan off
  // servers that are not using CSP. SSG needs none of this: it hashes each
  // finished page after writing it, so this content is already covered there.
  if (addCSPSources) {
    const pageHashes = collectRenderedInlineHashes(
      $body,
      bodyContent,
      cheerio.load,
      parseOptions,
      routerHydrationElements,
    );

    for (const source of pageHashes.scriptSrc) {
      pageScriptSources.add(source);
    }

    addCSPSources({
      scriptSrc: [...pageScriptSources],
      styleSrc: [...pageHashes.styleSrc],
    });
  }

  let cleanBodyContent = bodyContent;

  // Remove from the end first so earlier offsets remain valid.
  for (const range of [...removalRanges].sort((a, b) => b.start - a.start)) {
    cleanBodyContent =
      cleanBodyContent.slice(0, range.start) +
      cleanBodyContent.slice(range.end);
  }

  // Start with head and body replacement
  // The <!--ss-outlet--> marker should be directly replaced with the content
  // without any additional or changed comments/whitespace that could cause hydration issues
  let result = replaceLiteral(mergedTemplate, '<!--ss-head-->', compactedHead);
  result = replaceLiteral(result, '<!--ss-outlet-->', cleanBodyContent);

  // Normalize CDN base URL (strip trailing slash) so it's consistent everywhere
  const normalizedCDN = CDNBaseURL
    ? CDNBaseURL.endsWith('/')
      ? CDNBaseURL.slice(0, -1)
      : CDNBaseURL
    : '';

  // Collect the template's baseline <html> and <body> attributes so client-side
  // DOM reconciliation knows the clean, unmodified values from index.html.

  // 1. Locate the opening <html> and <body> tags in the raw HTML template string.
  const htmlTagMatch = findOpeningTag(mergedTemplate, 'html');
  const bodyTagMatch = findOpeningTag(mergedTemplate, 'body');

  // 2. Parse their raw HTML attribute strings (e.g. 'class="foo" lang="en"') into key-value records.
  const templateHTMLAttrs = htmlTagMatch
    ? parseAttributesString(htmlTagMatch.attrsStr)
    : {};
  const templateBodyAttrs = bodyTagMatch
    ? parseAttributesString(bodyTagMatch.attrsStr)
    : {};

  // Build the single payload the client bootstrap reads.
  //
  // This used to be seven separate inline scripts, one per global, each with
  // the value written directly into executable JavaScript. That made the script
  // text different on every request, so no CSP hash could cover it and nonces
  // were the only way to allow it — which in turn rules out prerendered output,
  // where there is no request to mint a nonce for. Moving the varying bytes into
  // a non-executable JSON block leaves one fixed bootstrap script that hashes
  // once. Consolidating seven elements into two is a small win on its own.
  //
  // request and app stay conditional, since "not provided" and "provided as
  // empty" are different: JSON.stringify drops an undefined member entirely,
  // and the bootstrap tests for the key rather than its value.
  const contextData: UnirendContextData = {
    // Dev mode comes from the server so the client always agrees with it
    isDev: getDevMode(),
    requestContext: context?.request,
    appConfig: context?.app,
    // Empty string when no CDN is configured, so client code can read it
    // unconditionally without guarding against undefined
    cdnBaseURL: normalizedCDN,
    // null when hostname is not known (SSG without a configured hostname, or
    // SPA), so client code can check for null rather than undefined
    domainInfo: domainInfo ?? null,
    templateAttrs: {
      html: templateHTMLAttrs,
      body: templateBodyAttrs,
    },
    // The template's <meta> baseline. The client reconciles template metas
    // across navigations and needs them as the template authored them: the ones
    // this page overrides are absent from the served head, so the DOM alone
    // cannot describe it, and without this there would be nothing to restore
    // when the user navigates to a page that does not override them.
    templateMetas,
    // React Router's hydration payload, when it was in a shape we could lift
    // out of its assignment script. Undefined otherwise, and the script is
    // emitted verbatim below instead.
    routerHydration,
  };

  // Build context scripts array
  const contextScripts: string[] = renderContextDataElements(contextData);

  // Router hydration data last — only needed once the client module runs, order relative
  // to other head scripts doesn't matter since all head scripts run before any module script
  for (const script of routerHydrationScripts) {
    contextScripts.push(script);
  }

  // Replace the placeholder with all context scripts (or remove if none).
  const hasMarkers =
    mergedTemplate.includes('<!--ss-head-->') ||
    mergedTemplate.includes('<!--ss-outlet-->') ||
    mergedTemplate.includes('<!--context-scripts-injection-point-->');

  if (hasMarkers) {
    if (result.includes('<!--context-scripts-injection-point-->')) {
      // Detect the placeholder's leading whitespace so injected scripts match indentation.
      const indentMatch = result.match(
        /^([ \t]*)<!--context-scripts-injection-point-->/m,
      );
      const indent = indentMatch ? indentMatch[1] : '';
      result = replaceLiteral(
        result,
        '<!--context-scripts-injection-point-->',
        contextScripts.join('\n' + indent),
      );
    } else {
      // Fallback: if placeholder is missing, inject context scripts before </head> if present,
      // otherwise after the opening <body> tag, or append at the end.
      const headEndIndex = result.toLowerCase().indexOf('</head>');
      if (headEndIndex !== -1) {
        result =
          result.slice(0, headEndIndex) +
          contextScripts.join('\n') +
          '\n' +
          result.slice(headEndIndex);
      } else {
        const bodyTag = findOpeningTag(result, 'body');
        if (bodyTag) {
          result =
            result.slice(0, bodyTag.end) +
            '\n' +
            contextScripts.join('\n') +
            result.slice(bodyTag.end);
        } else {
          result = result + '\n' + contextScripts.join('\n');
        }
      }
    }
  }

  // Replace CDN injection placeholder with actual CDN URL or empty string
  // This allows runtime CDN URL override per request
  if (normalizedCDN) {
    result = result.replaceAll(
      '__CDN__INJECTION__POINT__',
      () => normalizedCDN,
    );
  } else {
    // No CDN URL provided - remove placeholder to preserve original /assets/... paths
    result = result.replaceAll('__CDN__INJECTION__POINT__', '');
  }

  // Unlike tags inside the <head> (which are collected as raw HTML strings and injected into placeholders),
  // <html> and <body> attributes are resolved as key-value objects from React context.
  // We locate these existing tags in the template and merge the new attributes in-place.
  result = updateTagAttributes(result, 'html', htmlAttrs);
  result = updateTagAttributes(result, 'body', bodyAttrs);

  return result;
}

/**
 * Hash the inline `<script>` and `<style>` of rendered markup, reading every
 * digest from the **original source bytes** rather than from the parsed tree.
 *
 * That distinction is the whole function. The template scanner can read the
 * parsed tree, because the template was serialized *out of* a parse, so the
 * bytes and the tree already agree. Rendered body content is spliced into the
 * page verbatim and never round-trips through a serializer, so cheerio's
 * serializer is free to rewrite it on the way back out, and a digest taken from
 * what it hands back can cover something the browser never receives.
 *
 * The bytes are not hashed quite as they are found, though, and that is the
 * other half of getting this right. A CSP hash covers the element's *child text
 * content*, a DOM value, and the HTML input stream is preprocessed before
 * tokenization: CRLF and lone CR become LF, and NUL becomes U+FFFD. So a
 * `<style>` written with Windows line endings, which is what a file read on
 * Windows or a CMS field will hand you, ships with its CRLFs intact and is
 * hashed by the browser without them. `normalizeRawTextForHash` closes exactly
 * that gap, and nothing else in a raw-text element differs between the bytes
 * and the tree.
 *
 * `<noscript>` needs the same treatment one level down. cheerio parses with
 * scripting enabled, so a `<noscript>` body is a single raw-text node and the
 * selectors see nothing inside it, while a browser with JavaScript disabled
 * parses the same bytes as markup. Its contents are re-parsed here with source
 * offsets of their own, which are then rebased onto the outer document so the
 * slice still comes from the original bytes.
 *
 * @param $body The already-parsed body, loaded with `sourceCodeLocationInfo`
 * @param source The exact bytes `$body` was parsed from, which are also the
 *   bytes that ship
 * @param baseOffset Added to every location, for a re-parsed `<noscript>` whose
 *   offsets are relative to its own inner text
 */
function collectRenderedInlineHashes(
  $body: CheerioAPI,
  source: string,
  load: typeof cheerioLoad,
  parseOptions: Parameters<typeof cheerioLoad>[1],
  skip: ReadonlySet<AnyNode>,
  baseOffset = 0,
): { scriptSrc: Set<string>; styleSrc: Set<string> } {
  const scriptSrc = new Set<string>();
  const styleSrc = new Set<string>();

  /**
   * The element's text content, taken from the bytes rather than the tree and
   * then put through the tokenizer's own normalization, so it is the value a
   * browser will hash rather than the value it was parsed from.
   */
  const rawContentOf = (el: AnyNode): string | undefined => {
    const location = (el as { sourceCodeLocation?: ScriptSourceLocation })
      .sourceCodeLocation;
    const start = location?.startTag?.endOffset;
    const end = location?.endTag?.startOffset;

    if (start === undefined || end === undefined || end < start) {
      return undefined;
    }

    return normalizeRawTextForHash(
      source.slice(baseOffset + start, baseOffset + end),
    );
  };

  $body('script').each((_, el) => {
    const element = $body(el);

    if (skip.has(el) || element.attr('src')) {
      return;
    }

    if (!isCSPGovernedScriptType(element.attr('type'))) {
      return;
    }

    const content = rawContentOf(el);

    if (content) {
      scriptSrc.add(`'${hashInlineContentForCSP(content)}'`);
    }
  });

  $body('style').each((_, el) => {
    if (skip.has(el)) {
      return;
    }

    const content = rawContentOf(el);

    if (content) {
      styleSrc.add(`'${hashInlineContentForCSP(content)}'`);
    }
  });

  $body('noscript').each((_, el) => {
    const location = (el as { sourceCodeLocation?: ScriptSourceLocation })
      .sourceCodeLocation;
    const start = location?.startTag?.endOffset;
    const end = location?.endTag?.startOffset;

    if (start === undefined || end === undefined || end < start) {
      return;
    }

    const inner = source.slice(baseOffset + start, baseOffset + end);

    if (!/<(?:script|style)\b/i.test(inner)) {
      return;
    }

    const nested = collectRenderedInlineHashes(
      load(inner, parseOptions, false),
      source,
      load,
      parseOptions,
      skip,
      baseOffset + start,
    );

    for (const hash of nested.scriptSrc) {
      scriptSrc.add(hash);
    }

    for (const hash of nested.styleSrc) {
      styleSrc.add(hash);
    }
  });

  return { scriptSrc, styleSrc };
}

interface TagMatch {
  start: number;
  end: number;
  attrsStr: string;
}

/**
 * Finds the opening tag of html/body in a comment-aware and quote-aware manner.
 * Ignores any closing brackets (>) nested inside single/double quotes of attribute values.
 */
export function findOpeningTag(
  html: string,
  tagName: 'html' | 'body',
): TagMatch | null {
  let i = 0;
  while (i < html.length) {
    if (html.startsWith('<!--', i)) {
      const commentEnd = html.indexOf('-->', i + 4);
      if (commentEnd === -1) {
        break;
      }
      i = commentEnd + 3;
      continue;
    }
    if (html.toLowerCase().startsWith('<script', i)) {
      const nextChar = html[i + 7];
      if (!nextChar || /\s|>|\//.test(nextChar)) {
        const closeIndex = html.toLowerCase().indexOf('</script>', i + 7);
        if (closeIndex === -1) {
          break;
        }
        i = closeIndex + 9;
        continue;
      }
    }
    if (html.toLowerCase().startsWith('<style', i)) {
      const nextChar = html[i + 6];
      if (!nextChar || /\s|>|\//.test(nextChar)) {
        const closeIndex = html.toLowerCase().indexOf('</style>', i + 6);
        if (closeIndex === -1) {
          break;
        }
        i = closeIndex + 8;
        continue;
      }
    }
    if (html[i] === '<') {
      const match = html.slice(i).match(/^<([a-z0-9\-:]+)\b/i);
      if (match) {
        const foundTagName = match[1].toLowerCase();
        if (foundTagName === tagName) {
          const tagStart = i;
          const attrStart = i + 1 + match[1].length;
          let isInDoubleQuote = false;
          let isInSingleQuote = false;
          let j = attrStart;
          while (j < html.length) {
            const char = html[j];
            if (char === '"' && !isInSingleQuote) {
              isInDoubleQuote = !isInDoubleQuote;
            } else if (char === "'" && !isInDoubleQuote) {
              isInSingleQuote = !isInSingleQuote;
            } else if (char === '>' && !isInDoubleQuote && !isInSingleQuote) {
              return {
                start: tagStart,
                end: j + 1,
                attrsStr: html.slice(attrStart, j),
              };
            }
            j++;
          }
        }
      }
    }
    i++;
  }
  return null;
}

function parseAttributesString(attrsStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};

  // Regex to match key="value" or key='value' or key=value or key (boolean).
  //
  // The name is read the way the HTML tokenizer reads one: everything up to whitespace or one of
  // the characters that can only end it (`"`, `'`, `>`, `/`, `=`). A name is not a restricted
  // alphabet, and spelling it as one meant a name carrying anything outside that alphabet was not
  // rejected, it was *split*. The excluded character ended the name, and the regex then matched the
  // tail as a whole separate attribute: `data_name="robots"` parsed as `data` plus `name="robots"`,
  // an identity the tag never declared.
  //
  // That reached further than a parsing curiosity. This parser is what the server reads its own
  // serialized head back through, so a `meta.page.tags` entry off the wire could mint a `name` or
  // an `http-equiv` out of a name Unirend had already allowed (`_` and `.` are both in
  // `VALID_ATTRIBUTE_NAME`), and `mergeTemplateMetas()` would strip the matching index.html meta
  // from the served page. The client reads the real React prop and never saw it that way, so the
  // tag came back on hydration and only the crawler's copy was missing it.
  const attrRegex =
    /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;

  while ((match = attrRegex.exec(attrsStr)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[key] = decodeHTMLAttributeValue(val);
  }

  return attrs;
}

function serializeAttributes(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .filter(([k, v]) => {
      // Do not serialize class or style attributes if they are empty/whitespace-only
      if ((k === 'class' || k === 'style') && v.trim() === '') {
        return false;
      }
      // Do not serialize boolean attributes if their value is 'false' (removal marker)
      if (isRemovedBooleanAttribute(k, v)) {
        return false;
      }
      return true;
    })
    .map(([k, v]) => {
      if (v === '') {
        return k;
      }

      return `${k}="${escapeHTMLAttr(v)}"`;
    })
    .join(' ');
}

/**
 * Deserializes attributes from an HTML tag string, merges new attributes into them,
 * and serializes the merged result back into a single HTML element string.
 */
function mergeAndSerializeTag(
  tagMatch: string,
  attrsStr: string,
  tagName: string,
  newAttrs?: Record<string, string>,
): string {
  // 1. If there are no new attributes to merge, return the original tag match untouched.
  if (!newAttrs || Object.keys(newAttrs).length === 0) {
    return tagMatch;
  }

  // 2. Parse the existing tag's attributes into a key-value record.
  const existingAttrs = parseAttributesString(attrsStr);

  // 3. Iterate through new attributes and merge them based on key type.
  for (const [key, value] of Object.entries(newAttrs)) {
    const normKey = key.toLowerCase();

    if (normKey === 'class') {
      // Classes: Union and deduplicate individual class tokens.
      const existingValue = existingAttrs['class'] || '';
      const newClasses = value.split(/\s+/).filter(Boolean);
      const existingClasses = existingValue.split(/\s+/).filter(Boolean);
      existingAttrs['class'] = Array.from(
        new Set([...existingClasses, ...newClasses]),
      ).join(' ');
    } else if (normKey === 'style') {
      // Styles: Concatenate the raw strings (separated by a semicolon if needed).
      // We append instead of parsing property-by-property to prevent breaking complex
      // values like inline SVGs or data URLs. Browser CSS precedence handles any overrides.
      const existingValue = existingAttrs['style'] || '';
      const sep = existingValue && !existingValue.endsWith(';') ? ';' : '';
      existingAttrs['style'] = existingValue + sep + value;
    } else {
      // All other attributes: Overwrite existing values (last-write-wins).
      existingAttrs[normKey] = value;
    }
  }

  // 4. Serialize the merged attributes collection back to HTML.
  const serialized = serializeAttributes(existingAttrs);
  return `<${tagName}${serialized ? ' ' + serialized : ''}>`;
}

/**
 * Locate a specific HTML tag (e.g. <html> or <body>) inside the template and
 * merge new attributes into it, returning the updated HTML string.
 */
export function updateTagAttributes(
  html: string,
  tagName: 'html' | 'body',
  newAttrs?: Record<string, string>,
): string {
  // 1. If there are no new attributes to inject, return the original HTML immediately.
  if (!newAttrs || Object.keys(newAttrs).length === 0) {
    return html;
  }

  // 2. Locate the tag in a quote-aware and comment-aware manner.
  //    If the tag isn't present in the HTML template, exit early.
  const tagMatch = findOpeningTag(html, tagName);
  if (!tagMatch) {
    return html;
  }

  // 3. Parse its existing attributes, merge them with the new attributes,
  //    serialize the merged tag back to HTML, and replace it in the template.
  const originalTag = html.slice(tagMatch.start, tagMatch.end);
  const updatedTag = mergeAndSerializeTag(
    originalTag,
    tagMatch.attrsStr,
    tagName,
    newAttrs,
  );

  return html.slice(0, tagMatch.start) + updatedTag + html.slice(tagMatch.end);
}

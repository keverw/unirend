import type { RenderType, TemplateSlots } from '../../types';
import type { CheerioAPI, load as cheerioLoad } from 'cheerio';
import type { AnyNode, Comment, Document, Element, Text } from 'domhandler';
import { escapeHTMLAttr, escapeHTMLText } from './escape';
import { hashInlineContentForCSP, isCSPGovernedScriptType } from '../csp-hash';
import { CDN_INJECTION_PLACEHOLDER } from '../cdn';
// Type-only, so this pulls nothing into the HTML pipeline at runtime. Imported
// rather than redeclared because csp-policy owns the CSP vocabulary, and two
// exported types with the same name would eventually disagree.
import type { CSPInlineKind } from '../csp-policy';
import { UNIREND_DATA_BLOCK_ID } from './context-data-block';

// cheerio's load(), narrowed to the fragment-parsing call validateTemplateSlots() makes.
// Passed in rather than imported so the dynamic import in processTemplate() stays the only
// place cheerio is pulled in, keeping it out of client bundles.
type CheerioLoad = (
  content: string,
  options: null,
  isDocument: false,
) => CheerioAPI;

// Define a lightweight type for directive nodes from the parser
type DirectiveElement = { type: 'directive'; data: string };

// domhandler types `node.type` as the `ElementType` string enum, so comparing
// it directly to a string literal trips `no-unsafe-enum-comparison`. These
// guards widen the discriminant to a plain string before comparing and return a
// type predicate, so callers still narrow the node union correctly.
const nodeType = (node: AnyNode): string => node.type;
const isDocumentNode = (node: AnyNode): node is Document =>
  nodeType(node) === 'root';
const isDirectiveNode = (node: AnyNode): boolean =>
  nodeType(node) === 'directive';
const isCommentNode = (node: AnyNode): node is Comment =>
  nodeType(node) === 'comment';
const isTextNode = (node: AnyNode): node is Text => nodeType(node) === 'text';
const isElementNode = (node: AnyNode): node is Element => {
  const type = nodeType(node);
  return type === 'tag' || type === 'script' || type === 'style';
};

// Development comment that should be preserved. Names the element it is about,
// because it is emitted next to that element and a bare "them" reads as though
// it refers to whatever markup happens to follow.
const DEVELOPMENT_COMMENT =
  'React hydration relies on the data attributes on the app container below. Do not remove them.';

// <meta> tags UnirendHead manages per page, and so strips from the template: the page's
// content metadata (description) and its social preview tags (OpenGraph, Twitter cards),
// all of which describe the specific page rather than the document as a whole.
//
// Keep this to tags a page is expected to set for itself. Anything matched here is gone from
// the served head unless the page declares it, so document-level tags that every page shares
// (viewport, charset, theme-color, robots, apple-*) must never be added.
const UNIREND_HEAD_MANAGED_META_NAMES = new Set(['description']);
const UNIREND_HEAD_MANAGED_META_PREFIXES = ['og:', 'twitter:'];

// Exemptions from the prefixes above: social tags that describe the site rather than the
// page, and so are a normal thing to set once in index.html. They stay as a template
// baseline, and a page can still override one by declaring it, like any other baseline meta.
const UNIREND_HEAD_TEMPLATE_OWNED_METAS = new Set(['og:site_name']);

/**
 * Whether a <meta> tag's identifying value (its `name` or `property`) is one UnirendHead
 * manages per page. Matched against either attribute, since OpenGraph is conventionally
 * written as `property="og:title"` and Twitter cards as `name="twitter:card"`, but both
 * spellings appear in the wild for either family.
 */
function isUnirendHeadManagedMeta(identifier: string): boolean {
  const normalized = identifier.toLowerCase();

  if (UNIREND_HEAD_TEMPLATE_OWNED_METAS.has(normalized)) {
    return false;
  }

  return (
    UNIREND_HEAD_MANAGED_META_NAMES.has(normalized) ||
    UNIREND_HEAD_MANAGED_META_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    )
  );
}

/**
 * Whether an asset URL points at something this app serves, and so should be rewritten to
 * the CDN placeholder.
 *
 * Root-relative is the marker of a local asset ("/assets/main.js"), but a leading slash on
 * its own isn't enough: a protocol-relative URL ("//cdn.vendor.com/w.js", still used by some
 * third-party embeds) also starts with one while pointing at another origin entirely.
 * Prefixing it would produce "https://cdn.example.com//cdn.vendor.com/w.js", so it's treated
 * as external, along with every fully-qualified URL.
 */
function isLocalAssetURL(url: string): boolean {
  return url.startsWith('/') && !url.startsWith('//');
}

/**
 * Normalizes the headInlineScripts slot, which takes one script as a plain string or several
 * as an array, to the array the rest of the code works with.
 *
 * @returns The scripts, or null when the value is neither a string nor an array, which
 * validateTemplateSlots() turns into an error. Both callers go through here so the validated
 * scripts and the emitted ones can never be a different list.
 */
function toHeadInlineScripts(
  value: TemplateSlots['headInlineScripts'],
): string[] | null {
  if (value === undefined) {
    return [];
  }

  if (typeof value === 'string') {
    return [value];
  }

  return Array.isArray(value) ? value : null;
}

/**
 * Validates templateSlots before any of it reaches the document.
 *
 * These slots are raw, trusted content emitted verbatim, so the checks here aren't about
 * escaping — they're about the ways slot content can silently corrupt the pipeline that
 * runs around it. Each one is a mistake that would otherwise produce broken HTML at
 * request time rather than a clear failure at startup.
 *
 * @returns An error message, or null when the slots are usable.
 */
function validateTemplateSlots(
  slots: TemplateSlots,
  containerID: string,
  load: CheerioLoad,
): string | null {
  const MARKERS = ['ss-head', 'ss-outlet'];

  // Two checks, because a slot can smuggle a marker past either one alone.
  //
  // The raw check catches the marker's literal characters wherever they sit, including places a
  // parser sees no comment node at all, such as inside a <script> or <style> in the slot.
  // injectContent() locates each marker with a single plain string replace, so those characters
  // are live to it regardless of what they parsed as.
  const rawMarkerIn = (value: string): string | null =>
    MARKERS.find((marker) =>
      new RegExp(`<!--\\s*${marker}\\s*-->`).test(value),
    ) ?? null;

  // The parsed check catches the reverse: a comment the raw check does not recognize, but which
  // the prettifier re-emits in the canonical spelling that injectContent() then matches. HTML
  // ends a comment on `--!>` as well as `-->`, so `<!--ss-outlet--!>` reads past the raw regex,
  // parses to a comment whose data is "ss-outlet", and is written back out as a real
  // `<!--ss-outlet-->`. Pattern-matching every spelling the tokenizer accepts is a losing game,
  // so this asks the parser instead.
  const parsedMarkerIn = (nodes: AnyNode[]): string | null => {
    for (const node of nodes) {
      if (isCommentNode(node)) {
        const data = node.data?.trim() ?? '';

        if (MARKERS.includes(data)) {
          return data;
        }
      }

      const children =
        isElementNode(node) || isDocumentNode(node) ? node.children : null;

      if (children) {
        const found = parsedMarkerIn(children);

        if (found) {
          return found;
        }
      }
    }

    return null;
  };

  const headInlineScripts = toHeadInlineScripts(slots.headInlineScripts);

  if (headInlineScripts === null) {
    return 'templateSlots.headInlineScripts must be a string of JavaScript source, or an array of them.';
  }

  // A single script is passed as a plain string, so an index would be meaningless noise in the
  // error when that's what the caller did.
  const isSingle = typeof slots.headInlineScripts === 'string';
  const scriptLabel = (index: number): string =>
    isSingle
      ? 'templateSlots.headInlineScripts'
      : `templateSlots.headInlineScripts[${index}]`;

  for (const [index, script] of headInlineScripts.entries()) {
    if (typeof script !== 'string') {
      return `${scriptLabel(index)} must be a string of JavaScript source.`;
    }

    // The entry is wrapped in a <script> tag, so a tag in the source would either nest
    // (invalid) or, for a closing tag, terminate the wrapper early and dump the rest of
    // the script into the document as markup. A literal `</script` inside a JS string is
    // the same hazard, and is why the check is on the raw text rather than a parse.
    if (/<\/?script\b/i.test(script)) {
      return `${scriptLabel(index)} contains a <script> tag. Pass JavaScript source only — unirend wraps it in a <script> tag for you. If the script needs a literal "</script>" inside a string, escape it as "<\\/script>".`;
    }

    // Raw check only: this is JavaScript source, not HTML, so it is never parsed. Only the
    // literal characters injectContent() searches for can do any harm here.
    const scriptMarker = rawMarkerIn(script);

    if (scriptMarker) {
      return `${scriptLabel(index)} contains the <!--${scriptMarker}--> marker, which belongs to the template itself. It would take the injection meant for the template's own marker.`;
    }
  }

  const htmlSlots: [name: string, value: string | undefined][] = [
    ['bodyPrepend', slots.bodyPrepend],
    ['bodyAppend', slots.bodyAppend],
  ];

  for (const [name, value] of htmlSlots) {
    if (value === undefined) {
      continue;
    }

    if (typeof value !== 'string') {
      return `templateSlots.${name} must be a string of HTML.`;
    }

    const fragment = load(value, null, false);

    // The body slots are spliced in after marker validation and comment cleanup, so a marker
    // here would survive to injectContent() and be treated as the real one. A second
    // ss-outlet in particular would get a full copy of the rendered page injected into it.
    // Checked both ways, since either alone can be walked around: see rawMarkerIn/parsedMarkerIn.
    const bodyMarker =
      rawMarkerIn(value) ?? parsedMarkerIn(fragment.root().toArray());

    if (bodyMarker) {
      return `templateSlots.${name} contains the <!--${bodyMarker}--> marker, which belongs to the template itself. Injected content would be duplicated into it.`;
    }

    // A second element with the container's ID would be ambiguous for both the prettifier's
    // hydration-safe inline formatting and the client's getElementById() mount.
    //
    // Parsed rather than pattern-matched, because the attribute has too many spellings for a
    // regex to chase: `id=root` unquoted, single-quoted, `ID=` in any case, extra whitespace
    // around the `=`. The parser normalizes all of them, and it sidesteps having to escape
    // regex metacharacters in containerID, which is caller-supplied.
    const hasContainerID = fragment('*')
      .toArray()
      .some((el) => isElementNode(el) && el.attribs?.['id'] === containerID);

    if (hasContainerID) {
      return `templateSlots.${name} declares id="${containerID}", which is the container element's ID. The app would have two mount points.`;
    }

    // Same failure as above, for the element carrying the server context. The
    // client bootstrap finds it with getElementById, so a second element with
    // that ID earlier in the document would be read instead, and every injected
    // global would come from whatever that element happened to contain.
    //
    // A page may hold any number of other `application/json` blocks, JSON-LD
    // structured data being the usual one, and none of them are a problem: the
    // lookup is by ID, not by type. Only this exact ID collides.
    const hasDataBlockID = fragment('*')
      .toArray()
      .some(
        (el) =>
          isElementNode(el) && el.attribs?.['id'] === UNIREND_DATA_BLOCK_ID,
      );

    if (hasDataBlockID) {
      return `templateSlots.${name} declares id="${UNIREND_DATA_BLOCK_ID}", which unirend uses for the element carrying server context to the client. The client would read this element instead, and every injected global would be wrong.`;
    }
  }

  return null;
}

// Elements whose text content is significant to the rendered output. The prettifier trims text
// nodes and adds indentation, which is invisible for normal markup but is content for these:
// re-indenting the body of a <pre> visibly changes the page, and doing it to a <textarea>
// changes the value the user submits. They're serialized byte-for-byte instead.
const WHITESPACE_SENSITIVE_TAGS = new Set(['pre', 'textarea', 'listing']);

// Void elements have no children and no end tag. Emitting one is not a cosmetic slip: HTML5
// parses a stray `</br>` as another `<br>` start tag, so serializing a single <br> as
// `<br></br>` re-parses into two line breaks, and the content grows on every round trip.
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

// Elements whose children the HTML parser does NOT treat as markup, handing back a single text
// node holding the source characters as-is. Their text must be emitted raw: entity-encoding it
// would corrupt the content, turning `a && b` in a script into `a &amp;&amp; b`, or the markup
// inside a <noscript> into literal, visible `&lt;div&gt;` on the page.
//
// <title> and <textarea> are deliberately absent. The parser DOES decode entities in those, so
// they behave like normal text and have to be re-encoded on the way out.
const RAW_TEXT_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'noembed',
  'noframes',
  'xmp',
  'plaintext',
]);

/**
 * Whether a text node sits directly inside an element whose contents the parser kept raw, and
 * so must be written back out without escaping.
 */
function isRawText(node: AnyNode): boolean {
  const parent = node.parent;

  return (
    parent !== null &&
    isElementNode(parent) &&
    RAW_TEXT_TAGS.has(parent.name.toLowerCase())
  );
}

/**
 * Serializes an element's attributes.
 *
 * Values are re-encoded because the parser handed them over decoded. Writing one back raw would
 * at best mangle it (`a &amp; b` collapsing to `a & b`) and at worst let a value containing a
 * double quote close the attribute early and inject markup into the tag.
 */
function serializeAttributes(el: Element): string {
  return Object.entries(el.attribs || {})
    .map(([key, val]) => (val === '' ? key : `${key}="${escapeHTMLAttr(val)}"`))
    .join(' ');
}

/**
 * Serializes a node exactly as parsed, with no trimming, indentation, or line breaks added.
 * Used for the contents of whitespace-sensitive elements, where the formatting IS the content.
 */
function serializeVerbatim(el: AnyNode): string {
  if (isCommentNode(el)) {
    return `<!--${el.data}-->`;
  }

  if (isTextNode(el)) {
    const text = el.data ?? '';

    return isRawText(el) ? text : escapeHTMLText(text);
  }

  if (!isElementNode(el)) {
    return '';
  }

  const attrs = serializeAttributes(el);
  const openTag = attrs ? `<${el.name} ${attrs}>` : `<${el.name}>`;

  if (VOID_TAGS.has(el.name)) {
    return openTag;
  }

  const children = (el.children ?? []).map(serializeVerbatim).join('');

  return `${openTag}${children}</${el.name}>`;
}

function formatNode(
  el: AnyNode,
  level = 0,
  isInRoot = false,
  containerID = 'root',
): string {
  const indent = isInRoot ? '' : '  '.repeat(level);

  if (isDocumentNode(el)) {
    const children = el.children;

    return children
      .map((child) => formatNode(child, level, false, containerID))
      .filter(Boolean)
      .join('\n');
  }

  if (isDirectiveNode(el)) {
    const dir = el as unknown as DirectiveElement;
    return `${indent}<${dir.data}>`;
  }

  // Comment nodes
  if (isCommentNode(el)) {
    return `${indent}<!--${el.data}-->`;
  }

  // Text nodes
  if (isTextNode(el)) {
    const text = el.data?.trim() ?? '';
    if (!text) {
      return '';
    }

    // Re-encode, since the parser handed this back decoded. Emitting it raw would turn an
    // author's escaped `&lt;b&gt;` back into a live <b> tag. Raw-text elements (script, style,
    // noscript) are the exception: their contents were never decoded, and encoding them now
    // would break the code or markup they hold.
    return `${indent}${isRawText(el) ? text : escapeHTMLText(text)}`;
  }

  // Only element-like nodes (tag/script/style) remain past this point. Guard
  // against any other node types (e.g. CDATA) which carry no tag info; this
  // also narrows `el` to a domhandler Element for the property access below.
  if (!isElementNode(el)) {
    return '';
  }

  // Tag elements
  const tag = el;
  const tagName = tag.name;
  const attrs = serializeAttributes(tag);
  const openTag = attrs ? `<${tagName} ${attrs}>` : `<${tagName}>`;

  // Whitespace-sensitive elements are emitted exactly as authored: the open tag gets the
  // surrounding indentation, but nothing is added inside it.
  //
  // The leading newline is re-added because the HTML parser drops one that directly follows the
  // open tag ("<pre>\nfoo" parses to the text "foo"). Without putting it back, a <pre> whose
  // content legitimately starts with a blank line would lose it a little more on every
  // parse/serialize round trip.
  if (WHITESPACE_SENSITIVE_TAGS.has(tagName)) {
    const inner = (tag.children ?? []).map(serializeVerbatim).join('');
    const leadingNewline = inner.startsWith('\n') ? '\n' : '';

    return `${indent}${openTag}${leadingNewline}${inner}</${tagName}>`;
  }

  // Special handling for container element to prevent whitespace nodes
  const isRoot =
    tagName === 'div' &&
    'id' in tag.attribs &&
    tag.attribs['id'] === containerID;

  if (tag.children && tag.children.length > 0) {
    // Different handling for root element - keep content on a single line for hydration
    if (isRoot) {
      let result = `${indent}${openTag}`;

      for (const child of tag.children) {
        const childStr = formatNode(child, 0, true, containerID);
        if (childStr) {
          result += childStr;
        }
      }

      result += `</${tagName}>`;
      return result;
    } else {
      // Standard handling. If we're inside the #root element (isInRoot), we want to keep
      // everything on a single line to avoid introducing whitespace nodes that would
      // break React hydration. Therefore, we skip inserting newlines in that case.

      const isInline = isInRoot;
      let result = `${indent}${openTag}`;

      for (const child of tag.children) {
        const childStr = formatNode(
          child,
          isInline ? 0 : level + 1,
          isInRoot,
          containerID,
        );

        if (childStr) {
          result += isInline ? childStr : `\n${childStr}`;
        }
      }

      result += isInline ? `</${tagName}>` : `\n${indent}</${tagName}>`;
      return result;
    }
  }

  // Self-closing tags
  if (VOID_TAGS.has(tagName)) {
    return `${indent}<${tagName}${attrs ? ` ${attrs}` : ''}/>`;
  }

  // Empty standard tag
  return `${indent}${openTag}</${tagName}>`;
}

export function prettifyHTML($: CheerioAPI, containerID = 'root'): string {
  let html = '';

  for (const el of $.root().toArray()) {
    html += formatNode(el, 0, false, containerID) + '\n';
  }

  return html;
}

/**
 * CSP source expressions covering the inline content of a processed template,
 * quoted and ready to drop into a directive.
 *
 * Computed from the **final serialized output**, never from the slot values the
 * caller passed in. The pipeline parses and rewrites everything it touches, so
 * a hash of the input can differ from a hash of what ships, and CSP would then
 * block the very script the hash was meant to allow, silently.
 */
export interface TemplateCSPHashes extends ResolvedTemplateCSPHashes {
  /**
   * Inline `<script>` and `<style>` whose text carries the CDN placeholder, so
   * their bytes are not known until a request resolves it.
   *
   * Empty for anything hashed after resolution, which is every SSG page and any
   * template that does not use the placeholder. See
   * {@link CDNDependentInlineContent}.
   */
  cdnDependent: CDNDependentInlineContent[];
}

/**
 * One inline attribute, with everything needed to judge and report it.
 *
 * Carries the hash rather than only the attribute's name because the two
 * questions downstream are "would the policy block this" and "what would fix
 * it", and both need the exact value.
 */
export interface InlineAttributeFinding {
  /** Names the element and attribute, e.g. `<button> has onclick=`. */
  description: string;
  /**
   * Which directive chain governs it, so this decides which policy half is
   * consulted.
   */
  kind: CSPInlineKind;
  /**
   * CSP source expression for the attribute's value, quoted and ready to paste,
   * e.g. `'sha256-...'`.
   *
   * The digest covers the attribute value exactly as written, with no trimming
   * and no normalization, the same way an element hash covers its text content.
   */
  hash: string;
  /**
   * The attribute's value as parsed, kept so the hash can be recomputed once the
   * CDN placeholder is resolved.
   *
   * Only meaningful for a value carrying the placeholder, which is rare enough
   * that it would be easy to leave stale. It is not: a `style=` attribute
   * pointing at a CDN asset is the same timing problem an inline `<style>` has,
   * and while the consequence is smaller, an advisory warning printing a hash
   * that would not work is worse than no hash at all.
   */
  value: string;
}

export interface CollectTemplateCSPHashesOptions {
  /**
   * Whether the caller is going to resolve {@link CDN_INJECTION_PLACEHOLDER} in
   * this content after hashing it.
   *
   * Off by default, and that default is the honest one: most content handed to
   * this function is final, so a placeholder in it is literal text that ships
   * as written and has to be hashed as written. Turning this on wrongly drops
   * the hash for content nothing will ever rewrite, and the page is blocked
   * with the policy silently missing a source it should have carried.
   *
   * On for the two callers that really do substitute afterwards: the template
   * scan in `processTemplate`, and the development SSR path, which re-hashes
   * the Vite-transformed template before `injectContent` resolves it. Off for
   * SSG, which hashes the bytes it has already written to disk, and off for the
   * rendered-body scan, which is never substituted at all.
   */
  cdnPlaceholderPending?: boolean;
}

/**
 * Inline content whose bytes are not settled until a request resolves
 * {@link CDN_INJECTION_PLACEHOLDER}, kept as text so it can be hashed then.
 *
 * The template scan cannot hash these, and that is a timing problem rather than
 * a limitation. A template is processed once, at startup in production, while
 * the CDN base URL is decided per request: `request.CDNBaseURL` may be set in an
 * `onRequest` hook, so a single cached digest could not describe what ships to
 * every request. Held back here and hashed by {@link resolveTemplateCSPHashes}
 * once the value is known.
 *
 * Only blocks actually carrying the placeholder land here, so a template that
 * does not use it pays nothing and the per-request work stays proportional to
 * how much of it there is.
 */
export interface CDNDependentInlineContent {
  /** Which directive the resolved hash belongs in. */
  kind: CSPInlineKind;
  /**
   * The element's text content exactly as the processed template holds it, with
   * the placeholder still unresolved.
   *
   * Substituted and hashed rather than re-parsed, which is what keeps this
   * cheap: the bytes here already came out of the serialized template, so the
   * only thing standing between them and a correct digest is one string
   * replacement.
   */
  content: string;
}

/**
 * Hashes for content whose bytes are fully settled, ready to go into a policy.
 *
 * The shape a caller receives once nothing is left to resolve, which is what
 * `SSGReport` carries and what the request path builds per response. Separate
 * from {@link TemplateCSPHashes} so neither of them has to carry a field that
 * is meaningless for it.
 */
export interface ResolvedTemplateCSPHashes {
  scriptSrc: string[];
  styleSrc: string[];
  inlineAttributes: InlineAttributeFinding[];
}

export type ProcessTemplateResult =
  | { success: true; html: string; cspHashes: TemplateCSPHashes }
  | { success: false; error: string };

/**
 * Hash every inline `<script>` and `<style>` in a finished template.
 *
 * Parsing back what was just serialized looks wasteful, and is the point: it reads
 * the same bytes a browser will, so there is no way for the hash and the
 * delivered content to disagree. Runs once per app at startup, not per request.
 *
 * Scripts with a `src` are skipped, having no inline content to cover, and so
 * are data blocks such as `application/json`, which `script-src` does not
 * govern. Which types those are is `isCSPGovernedScriptType`'s question, and it
 * is not the same as "is this JavaScript": an import map and a speculation
 * rules block are both inert JSON that a strict `script-src` still blocks.
 */
export async function collectTemplateCSPHashes(
  html: string,
  options: CollectTemplateCSPHashesOptions = {},
): Promise<TemplateCSPHashes> {
  // Dynamic import for the same reason processTemplate uses one: cheerio must
  // not be pulled into client bundles.
  const cheerio = await import('cheerio');

  return collectTemplateCSPHashesWith(html, cheerio.load, options);
}

/**
 * Hash the inline `<script>` and `<style>` elements of an already-parsed
 * template, and report its inline attributes.
 *
 * Reads content with cheerio's `.html()` rather than from source offsets, and
 * that is safe **here specifically** because the template was serialized out of
 * a parse: `processTemplate` prettifies the document and then hashes what it
 * just wrote, so the tree and the bytes already agree.
 *
 * Rendered SSR markup is the opposite case and deliberately does not come
 * through here. It is spliced into the page verbatim without round-tripping
 * through a serializer, so the tokenizer's normalizations, CRLF to LF inside
 * raw-text elements being the one that bites, leave the tree and the bytes
 * disagreeing. That path reads digests from the original source offsets
 * instead. See `collectRenderedInlineHashes` in `inject.ts`.
 */
function collectInlineCSPHashes(
  $: CheerioAPI,
  load: typeof cheerioLoad,
  options: CollectTemplateCSPHashesOptions,
): TemplateCSPHashes {
  const scriptSrc = new Set<string>();
  const styleSrc = new Set<string>();
  // Keyed by kind and text, so the same block appearing twice is carried once.
  // Deduplicated here rather than after resolution because the substitution is
  // the same everywhere, so equal inputs stay equal outputs.
  const cdnDependent = new Map<string, CDNDependentInlineContent>();

  /**
   * Hash this content now, or hold it back for the request that will settle it.
   *
   * Returns whether it was handled here, so each caller can skip its own
   * hashing without repeating the placeholder test.
   */
  const deferIfCDNDependent = (
    kind: CSPInlineKind,
    content: string,
  ): boolean => {
    if (
      !options.cdnPlaceholderPending ||
      !content.includes(CDN_INJECTION_PLACEHOLDER)
    ) {
      return false;
    }

    cdnDependent.set(`${kind}|${content}`, { kind, content });

    return true;
  };

  // Keyed by description *and* hash, so two <button onclick> with different
  // handlers stay two findings. Keying on the description alone would collapse
  // them onto whichever value was seen first, and a policy covering that one
  // would then read as covering the template: the second handler is blocked and
  // nothing says so.
  const inlineAttributes = new Map<string, InlineAttributeFinding>();
  const collectFrom = ($: CheerioAPI): void => {
    collectAttributesFrom($);

    $('script').each((_, el) => {
      const element = $(el);

      if (element.attr('src')) {
        return;
      }

      if (!isCSPGovernedScriptType(element.attr('type'))) {
        return;
      }

      const content = element.html();

      if (content && !deferIfCDNDependent('script', content)) {
        scriptSrc.add(`'${hashInlineContentForCSP(content)}'`);
      }
    });

    $('style').each((_, el) => {
      const content = $(el).html();

      // Compared against null rather than read as truthy, because the empty
      // string is a real `<style></style>` and has to be hashed. A placeholder
      // or a CSS-in-JS tag that produced no rules is one, and a browser applies
      // it: Chrome blocks it under a strict style-src and names the
      // empty-string digest as the hash that would allow it. Reading the value
      // as truthy dropped exactly that case.
      //
      // The null branch cannot be reached from here, since `.html()` only
      // returns null for an empty selection and this is inside `.each`. It is
      // written out anyway so the guard says what it is testing for rather than
      // relying on the reader knowing that.
      //
      // The `<script>` arm above is deliberately left on a truthiness test,
      // since an empty inline script draws no violation.
      if (content !== null && !deferIfCDNDependent('style', content)) {
        styleSrc.add(`'${hashInlineContentForCSP(content)}'`);
      }
    });

    // <noscript> has to be parsed separately, and missing this is silent in the
    // worst way. A parser with scripting enabled, which is what cheerio is,
    // treats the element's contents as raw text, so the selectors above see
    // nothing inside it. A browser with JavaScript *disabled* parses the same
    // bytes as real markup, so a <style> in there becomes a live style element
    // and a strict style-src without its hash blocks it.
    //
    // The result would be a noscript fallback rendering unstyled for exactly
    // the users it exists for, and invisible to anyone testing with JavaScript
    // on. Both the starter template and the demos put a <style> in theirs.
    $('noscript').each((_, el) => {
      const inner = $(el).html();

      if (inner && /<(?:script|style)\b/i.test(inner)) {
        collectFrom(load(inner, null, false));
      }
    });
  };

  const collectAttributesFrom = ($: CheerioAPI): void => {
    $('*').each((_, el) => {
      if (!isElementNode(el)) {
        return;
      }

      for (const [name, value] of Object.entries(el.attribs ?? {})) {
        // on* is the event-handler namespace. `style` is the other attribute a
        // plain hash source cannot cover on its own. Both need 'unsafe-hashes'
        // alongside a hash of the value, and the better fix is usually not to
        // write them inline at all.
        const kind = /^on[a-z]+$/i.test(name)
          ? 'script'
          : name.toLowerCase() === 'style'
            ? 'style'
            : undefined;

        if (!kind) {
          continue;
        }

        const attribute = kind === 'style' ? 'style' : name;
        const description = `<${el.tagName}> has ${attribute}=`;

        // Hashed from the attribute value as parsed, which is what a browser
        // matches against: entity references are already decoded here and are
        // decoded there too, so the digest agrees with the one the browser
        // computes rather than with the source bytes.
        const hash = `'${hashInlineContentForCSP(value)}'`;
        const key = `${description}|${hash}`;

        if (!inlineAttributes.has(key)) {
          inlineAttributes.set(key, { description, kind, hash, value });
        }
      }
    });
  };

  collectFrom($);

  return {
    scriptSrc: [...scriptSrc],
    styleSrc: [...styleSrc],
    inlineAttributes: [...inlineAttributes.values()],
    cdnDependent: [...cdnDependent.values()],
  };
}

/**
 * Settle a template's hashes against the CDN base URL in force for a request.
 *
 * Everything already hashed passes through untouched. What was held back is
 * substituted and hashed now, which is the whole per-request cost: one string
 * replacement and one digest per block that uses the placeholder, with no
 * re-parse. A template that does not use it does no work here at all.
 *
 * Inline attributes are settled the same way, and for a smaller reason. A
 * `style=` carrying a CDN URL is never added to the policy, only reported, but
 * a report naming a hash that would not match is worse than one naming none.
 *
 * @param hashes What `processTemplate` produced, cached or not
 * @param normalizedCDN The base URL, already through `normalizeCDNBaseURL`, so
 *   this hashes the exact bytes `injectContent` substitutes
 */
export function resolveTemplateCSPHashes(
  hashes: TemplateCSPHashes,
  normalizedCDN: string,
): ResolvedTemplateCSPHashes {
  const resolve = (content: string) =>
    content.replaceAll(CDN_INJECTION_PLACEHOLDER, () => normalizedCDN);

  const isAttributePending = hashes.inlineAttributes.some((finding) =>
    finding.value.includes(CDN_INJECTION_PLACEHOLDER),
  );

  // The common case by a wide margin, and worth returning early for: it is
  // every template that does not write the placeholder into inline content,
  // and every SSG page, which is hashed after resolution and so never has any.
  //
  // Both halves are asked about, not just `cdnDependent`. An attribute is
  // reported rather than deferred, since its hash never enters a policy, so a
  // template whose only placeholder sits in a `style=` has nothing in
  // `cdnDependent` and still has a finding to resettle. Keying the early return
  // on the deferred list alone returned that finding with the unresolved hash
  // still on it, which is the stale advice this resettling exists to avoid.
  //
  // The scan is free in the usual case, since a template with no inline
  // attributes has an empty array to test.
  //
  // Rebuilt rather than returned by identity, and only because the return type
  // says `cdnDependent` is not there. Handing back the input leaves the field
  // on the object at runtime, which is invisible to every current reader, since
  // they all read named fields, and wrong the moment one serializes the value:
  // `SSGReport.cspHashes` is public, and JSON.stringify would emit a key its
  // type denies. Three property references is not a cost worth that.
  if (!hashes.cdnDependent.length && !isAttributePending) {
    return {
      scriptSrc: hashes.scriptSrc,
      styleSrc: hashes.styleSrc,
      inlineAttributes: hashes.inlineAttributes,
    };
  }

  const scriptSrc = new Set(hashes.scriptSrc);
  const styleSrc = new Set(hashes.styleSrc);

  for (const { kind, content } of hashes.cdnDependent) {
    const source = `'${hashInlineContentForCSP(resolve(content))}'`;

    (kind === 'script' ? scriptSrc : styleSrc).add(source);
  }

  return {
    scriptSrc: [...scriptSrc],
    styleSrc: [...styleSrc],
    inlineAttributes: hashes.inlineAttributes.map((finding) =>
      finding.value.includes(CDN_INJECTION_PLACEHOLDER)
        ? {
            ...finding,
            value: resolve(finding.value),
            hash: `'${hashInlineContentForCSP(resolve(finding.value))}'`,
          }
        : finding,
    ),
  };
}

function collectTemplateCSPHashesWith(
  html: string,
  load: typeof cheerioLoad,
  options: CollectTemplateCSPHashesOptions = {},
): TemplateCSPHashes {
  return collectInlineCSPHashes(load(html), load, options);
}

export async function processTemplate(
  html: string,
  mode: RenderType,
  isDevelopment: boolean,
  isDevServer: boolean,
  containerID = 'root',
  templateSlots?: TemplateSlots,
): Promise<ProcessTemplateResult> {
  try {
    // isDevelopment = runtime behavior (dev comment injection)
    // isDevServer  = asset serving strategy (CDN rewriting skipped for Vite dev server)

    // Dynamic import to prevent bundling in client builds
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);

    // Validate before any slot content reaches the document, but after cheerio is available,
    // since the container-ID check parses each slot rather than pattern-matching it.
    if (templateSlots) {
      const slotsError = validateTemplateSlots(
        templateSlots,
        containerID,
        cheerio.load,
      );

      if (slotsError) {
        return { success: false, error: slotsError };
      }
    }

    // Drop the head tags UnirendHead owns per page. Their template copies go even when a page
    // declares nothing of its own, for two different reasons.
    //
    // The metas (description, og:*, twitter:*) could technically be kept as a baseline — the
    // client reconciles template metas, so an override would be restored on navigation just
    // like viewport's. They're excluded because they describe the individual page: a template
    // default would put a stale, generic description on every page that forgot to set one.
    //
    // <title> is not part of that reconciled baseline, so nothing manages it on the client.
    // React won't remove a <title> already sitting in the head, so keeping the template's would
    // leave two in the document once a page renders its own: invalid, and undefined behavior
    // for crawlers. Note React hoists the two tags by different rules (mountHoistable): a meta
    // is appended to the end of the head, so an earlier template meta would come first and its
    // stale value would win — which is what the client reconciliation exists to prevent — while
    // a title is inserted *before* any existing one, so the page's title would win regardless.
    // The objection to keeping a template <title> is the duplicate element, not a stale value.
    //
    // Every other template meta (viewport, charset, theme-color, robots, apple-*, anything
    // custom) is a baseline that survives untouched. A page can still override one by
    // declaring the same tag, but that's decided per page in injectContent(): processTemplate()
    // runs once per template and its output is cached, so it can't know what any given page
    // will declare.
    $('head title').remove();

    // Every identity the tag carries, not just the first one it happens to declare. A meta is
    // whatever its attributes say it is, so `<meta name="site-default" property="og:title">` is a
    // page-owned og:title however unremarkable its `name` looks. Read as `name ?? property`, the
    // unmanaged name answered for the whole tag and the og:title rode along: it survived here, so
    // it was served on every page that declared no og:title of its own, and the client restored it
    // on each navigation back to one. That is the stale template default this strip exists to
    // prevent, arrived at through the one spelling that skipped the check.
    //
    // Any managed identity is enough to remove it, matching how mergeTemplateMetas() decides what
    // a page overrides. A tag carrying a page-owned identity alongside a template-owned one
    // (`name="twitter:title" property="og:site_name"`) goes with the page-owned reading, so keep
    // site-wide baselines on tags of their own rather than hanging one on a per-page tag.
    $('meta[name], meta[property]').each((_, el) => {
      const identifiers = [$(el).attr('name'), $(el).attr('property')];

      if (
        identifiers.some(
          (identifier) => identifier && isUnirendHeadManagedMeta(identifier),
        )
      ) {
        $(el).remove();
      }
    });

    // Replace absolute asset URLs with CDN injection placeholder (production builds only)
    // In dev server mode, Vite needs the original URLs to serve files from its dev server
    // This allows runtime CDN URL override per request in production
    // The placeholder will be replaced in injectContent() for SSR with:
    // 1. request.CDNBaseURL (if set), or
    // 2. appConfig.CDNBaseURL (if set), or
    // 3. empty string (preserves original /assets/... paths)
    if (!isDevServer) {
      $('script[src]').each((_, el) => {
        const src = $(el).attr('src');
        if (src && isLocalAssetURL(src)) {
          $(el).attr('src', `${CDN_INJECTION_PLACEHOLDER}${src}`);
        }
      });

      $('link[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && isLocalAssetURL(href)) {
          $(el).attr('href', `${CDN_INJECTION_PLACEHOLDER}${href}`);
        }
      });
    }

    // Append the configured inline head scripts to <head> before scripts are collected below,
    // so they're picked up by the same relocation as the template's own: they end up after the
    // context globals and can read __FRONTEND_REQUEST_CONTEXT__, which is the whole point of a
    // slotted theme flash-prevention script. Appending puts them after the template's scripts
    // in document order, and the collection preserves that order.
    //
    // Wrapping happens here rather than in the caller so the slot value stays plain JS source:
    // validateTemplateSlots() has already rejected any entry carrying a <script> tag, so the
    // wrapper can't be terminated early. It has also already rejected a value that is neither a
    // string nor an array, so the normalizer cannot return null by this point.
    for (const script of toHeadInlineScripts(
      templateSlots?.headInlineScripts,
    ) ?? []) {
      const source = script.trim();

      // Skip blank entries instead of emitting an empty <script></script>. Lets a shared slots
      // object use a conditional (`isProd ? analytics : ''`) without leaving a stray tag behind.
      if (source) {
        $('head').append(`<script>${source}</script>`);
      }
    }

    // Collect head and body scripts separately so we can control insertion order.
    // Head scripts (e.g. inline theme flash scripts) are re-inserted after the context
    // placeholder, guaranteeing they can always read __FRONTEND_REQUEST_CONTEXT__.
    const headScripts: string[] = [];

    $('head script').each((_, el) => {
      headScripts.push($.html(el));
    });

    const bodyScripts: string[] = [];

    $('body script').each((_, el) => {
      bodyScripts.push($.html(el));
    });

    // Remove all scripts from their original locations
    $('script').remove();

    // Track required markers during comment processing
    let hasHeadMarker = false;
    let hasOutletMarker = false;

    // Remove comments that don't start with ss- or the development comment
    // Also normalize ss- comments by trimming their content
    // AND validate that required markers are present
    $('*:not(script):not(style)')
      .contents()
      .each((_index: number, node: AnyNode) => {
        if (isCommentNode(node)) {
          const commentData = node.data?.trim() || '';
          const shouldKeep =
            commentData.startsWith('ss-') ||
            commentData === DEVELOPMENT_COMMENT;

          if (shouldKeep) {
            // Check for required markers (after normalization)
            if (commentData === 'ss-head') {
              hasHeadMarker = true;
            } else if (commentData === 'ss-outlet') {
              hasOutletMarker = true;
            }

            // Normalize ss- comments by trimming their content
            if (commentData.startsWith('ss-') && node.data !== commentData) {
              node.data = commentData;
            }
          } else {
            $(node).remove();
          }
        }
      });

    // Validate required markers after comment processing
    if (!hasHeadMarker || !hasOutletMarker) {
      const missingMarkers: string[] = [];

      if (!hasHeadMarker) {
        missingMarkers.push('<!--ss-head-->');
      }

      if (!hasOutletMarker) {
        missingMarkers.push('<!--ss-outlet-->');
      }

      const contentDescription =
        mode === 'ssg'
          ? 'generated content will be injected'
          : 'server-rendered content will be injected';

      return {
        success: false,
        error: `Missing required comment markers in HTML template: ${missingMarkers.join(', ')}. These markers indicate where ${contentDescription}.`,
      };
    }

    // Append context placeholder first, then user head scripts — so context globals
    // are always available when user inline scripts run.
    // Final order in <head>: ss-head content → static tags → context globals → user inline scripts.
    // Must be added AFTER comment cleanup so the placeholder isn't stripped by the ss- filter.
    $('head').append('\n<!--context-scripts-injection-point-->');

    if (headScripts.length > 0) {
      $('head').append('\n' + headScripts.join('\n'));
    }

    // Find the container element and append body scripts AFTER it, not inside it
    const rootElement = $(`#${containerID}`);

    if (rootElement.length > 0) {
      if (bodyScripts.length > 0) {
        rootElement.after(bodyScripts.join('\n'));
      }
    } else {
      // Fallback: If no #root element is found, append to the end of body
      if (bodyScripts.length > 0) {
        $('body').append(bodyScripts.join('\n'));
      }
    }

    // Splice in the configured body content: bodyPrepend lands before the container element,
    // bodyAppend after everything, including the body scripts just relocated above. Neither
    // touches the container itself, so hydration is unaffected.
    //
    // This runs last, after script collection and comment cleanup, and that ordering is the
    // contract: a <script> written in the template's body is relocated to after the container,
    // but one written here is not, and comments here survive rather than being stripped as
    // non-ss- comments. Slot content is emitted as authored. It also means the marker
    // validation above can't be fooled by a marker in this content, which is instead rejected
    // outright by validateTemplateSlots().
    if (templateSlots?.bodyAppend) {
      $('body').append(templateSlots.bodyAppend);
    }

    if (templateSlots?.bodyPrepend) {
      $('body').prepend(templateSlots.bodyPrepend);
    }

    // Emitted directly above the app container, which is what it is about.
    //
    // It used to be prepended to <body> instead, on the reasoning that a note is
    // easiest to find at the top. In practice that put it immediately above
    // whatever bodyPrepend contributed — a noscript block in both the starter
    // template and the demos — so top-down it read as a note about that, and the
    // element it actually describes was hundreds of lines further down.
    //
    // Falls back to the old position if the container is missing, which is not a
    // valid template but is not worth losing the note over.
    if (isDevelopment) {
      const container = $(`#${containerID}`);

      if (container.length > 0) {
        container.before(`<!-- ${DEVELOPMENT_COMMENT} -->\n`);
      } else {
        $('body').prepend(`<!-- ${DEVELOPMENT_COMMENT} -->\n`);
      }
    }

    // Serialize first, then hash what came out. Anything that reformats the
    // document has already run by this point, so these hashes describe the
    // bytes that ship.
    //
    // What injectContent does afterwards cannot disturb them. It merges the
    // template's <meta> tags, replaces the markers, resolves
    // CDN_INJECTION_PLACEHOLDER, and rewrites the <html>/<body> attributes.
    // The placeholder is the one worth spelling out, since it is resolved
    // across the whole template rather than at a known location and so can
    // reach inline content. The scan handles that by not hashing those blocks
    // here at all: they come back as `cdnDependent` and are hashed per request,
    // once the value they resolve to is known.
    const processedHTML = prettifyHTML($, containerID);

    return {
      success: true,
      html: processedHTML,
      cspHashes: collectTemplateCSPHashesWith(processedHTML, cheerio.load, {
        // injectContent resolves the placeholder in this template per request,
        // so any inline block carrying it is held back and hashed there.
        cdnPlaceholderPending: true,
      }),
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to process HTML template: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

import type { RenderType, TemplateSlots } from '../../types';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Comment, Document, Element, Text } from 'domhandler';
import { escapeHTMLAttr, escapeHTMLText } from './escape';

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

// Development comment that should be preserved
const DEVELOPMENT_COMMENT =
  'React hydration relies on data attributes. Do not remove them.';

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
  // Every slot is checked, not just the body ones. injectContent() locates each marker with a
  // single plain string replace, so the first literal occurrence anywhere in the document wins,
  // whether or not a parser would see a comment node there. A head inline script is the worst
  // case: the head is emitted before the body, so JS source containing the characters
  // "<!--ss-outlet-->" would take the replacement and receive the entire rendered page, leaving
  // the real outlet empty. This is also why the check runs on raw text rather than a parse.
  const markerIn = (value: string): string | null =>
    ['ss-head', 'ss-outlet'].find((marker) =>
      new RegExp(`<!--\\s*${marker}\\s*-->`).test(value),
    ) ?? null;

  for (const [index, script] of (slots.headInlineScripts ?? []).entries()) {
    if (typeof script !== 'string') {
      return `templateSlots.headInlineScripts[${index}] must be a string of JavaScript source.`;
    }

    // The entry is wrapped in a <script> tag, so a tag in the source would either nest
    // (invalid) or, for a closing tag, terminate the wrapper early and dump the rest of
    // the script into the document as markup. A literal `</script` inside a JS string is
    // the same hazard, and is why the check is on the raw text rather than a parse.
    if (/<\/?script\b/i.test(script)) {
      return `templateSlots.headInlineScripts[${index}] contains a <script> tag. Pass JavaScript source only — unirend wraps it in a <script> tag for you. If the script needs a literal "</script>" inside a string, escape it as "<\\/script>".`;
    }

    const scriptMarker = markerIn(script);

    if (scriptMarker) {
      return `templateSlots.headInlineScripts[${index}] contains the <!--${scriptMarker}--> marker, which belongs to the template itself. It would take the injection meant for the template's own marker.`;
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

    // The body slots are spliced in after marker validation and comment cleanup, so a marker
    // here would survive to injectContent() and be treated as the real one. A second
    // ss-outlet in particular would get a full copy of the rendered page injected into it.
    const bodyMarker = markerIn(value);

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
    const fragment = load(value, null, false);
    const hasContainerID = fragment('*')
      .toArray()
      .some((el) => isElementNode(el) && el.attribs?.['id'] === containerID);

    if (hasContainerID) {
      return `templateSlots.${name} declares id="${containerID}", which is the container element's ID. The app would have two mount points.`;
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

export type ProcessTemplateResult =
  { success: true; html: string } | { success: false; error: string };

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

    $('meta[name], meta[property]').each((_, el) => {
      const identifier = $(el).attr('name') ?? $(el).attr('property');

      if (identifier && isUnirendHeadManagedMeta(identifier)) {
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
          $(el).attr('src', `__CDN__INJECTION__POINT__${src}`);
        }
      });

      $('link[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && isLocalAssetURL(href)) {
          $(el).attr('href', `__CDN__INJECTION__POINT__${href}`);
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
    // wrapper can't be terminated early.
    for (const script of templateSlots?.headInlineScripts ?? []) {
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

    // Prepended after the slot content so the note stays the first thing in <body>, which is
    // where a developer reading source expects it. Nothing below it depends on the position.
    if (isDevelopment) {
      $('body').prepend(`<!-- ${DEVELOPMENT_COMMENT} -->\n`);
    }

    return {
      success: true,
      html: prettifyHTML($, containerID),
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to process HTML template: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

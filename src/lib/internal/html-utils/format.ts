import type { RenderType } from '../../types';
import type { CheerioAPI } from 'cheerio';
import type { AnyNode, Comment, Document, Element, Text } from 'domhandler';

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

    return `${indent}${text}`;
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
  const attrs = Object.entries(tag.attribs || {})
    .map(([key, val]) => (val === '' ? key : `${key}="${val}"`))
    .join(' ');
  const openTag = attrs ? `<${tagName} ${attrs}>` : `<${tagName}>`;

  // Special handling for container element to prevent whitespace nodes
  const isRoot =
    tagName === 'div' &&
    'id' in tag.attribs &&
    tag.attribs['id'] === containerID;

  const selfClosingTags = new Set([
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
  if (selfClosingTags.has(tagName)) {
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
  | { success: true; html: string }
  | { success: false; error: string };

export async function processTemplate(
  html: string,
  mode: RenderType,
  isDevelopment: boolean,
  isDevServer: boolean,
  containerID = 'root',
): Promise<ProcessTemplateResult> {
  try {
    // isDevelopment = runtime behavior (dev comment injection)
    // isDevServer  = asset serving strategy (CDN rewriting skipped for Vite dev server)

    // Dynamic import to prevent bundling in client builds
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);

    // Remove title tags from head
    $('head title').remove();

    if (isDevelopment) {
      $('body').prepend(`<!-- ${DEVELOPMENT_COMMENT} -->\n`);
    }

    // Remove meta tags except apple-mobile-web-app-title
    $('meta[name]').each((_, el) => {
      const name = $(el).attr('name');
      if (name !== 'apple-mobile-web-app-title') {
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
        if (src && src.startsWith('/')) {
          $(el).attr('src', `__CDN__INJECTION__POINT__${src}`);
        }
      });

      $('link[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (href && href.startsWith('/')) {
          $(el).attr('href', `__CDN__INJECTION__POINT__${href}`);
        }
      });
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

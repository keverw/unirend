import { TAB_SPACES } from '../consts';
import { getDevMode } from 'lifecycleion/dev-mode';
import { escapeHTMLAttr, decodeHTML, HTML_BOOLEAN_ATTRIBUTES } from './escape';

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

export interface InjectContentOptions {
  context?: {
    app?: Record<string, unknown>;
    request?: Record<string, unknown>;
  };
  CDNBaseURL?: string;
  domainInfo?: { hostname: string; rootDomain: string } | null;
  htmlAttrs?: Record<string, string>;
  bodyAttrs?: Record<string, string>;
}

// Utility to inject content, preserving React attributes
export async function injectContent(
  template: string,
  headContent: string,
  bodyContent: string,
  options: InjectContentOptions = {},
): Promise<string> {
  const { context, CDNBaseURL, domainInfo, htmlAttrs, bodyAttrs } = options;
  // Prettify all head tags with consistent indentation
  const compactedHead = prettifyHeadTags(headContent);

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

  $body('script').each((_, el) => {
    if (($body(el).html() ?? '').includes('__staticRouterHydrationData')) {
      const location = (
        el as {
          sourceCodeLocation?: { startOffset: number; endOffset: number };
        }
      ).sourceCodeLocation;

      if (!location) {
        return;
      }

      // Keep the script exactly as React Router emitted it. Do not use
      // $body.html(el), because serializer output is not hydration-safe.
      routerHydrationScripts.push(
        bodyContent.slice(location.startOffset, location.endOffset),
      );

      removalRanges.push({
        start: location.startOffset,
        end: location.endOffset,
      });
    }
  });

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
  let result = template
    .replace('<!--ss-head-->', compactedHead)
    .replace('<!--ss-outlet-->', cleanBodyContent);

  // Build context scripts array
  const contextScripts: string[] = [];

  // Inject dev mode global so the client always matches the server
  contextScripts.push(
    `<script>globalThis.__lifecycleion_is_dev__=${String(getDevMode())};</script>`,
  );

  // Add __FRONTEND_REQUEST_CONTEXT__ if provided (even if empty object)
  if (context?.request !== undefined) {
    const safeContextJSON = JSON.stringify(context.request).replace(
      /</g,
      '\\u003c',
    );

    contextScripts.push(
      `<script>window.__FRONTEND_REQUEST_CONTEXT__=${safeContextJSON};</script>`,
    );
  }

  // Add __PUBLIC_APP_CONFIG__ if provided (even if empty object)
  if (context?.app !== undefined) {
    const safeConfigJSON = JSON.stringify(context.app).replace(/</g, '\\u003c');

    contextScripts.push(
      `<script>window.__PUBLIC_APP_CONFIG__=${safeConfigJSON};</script>`,
    );
  }

  // Normalize CDN base URL (strip trailing slash) so it's consistent everywhere
  const normalizedCDN = CDNBaseURL
    ? CDNBaseURL.endsWith('/')
      ? CDNBaseURL.slice(0, -1)
      : CDNBaseURL
    : '';

  // Always inject __CDN_BASE_URL__ — empty string when no CDN configured so client
  // code can read it unconditionally without guarding against undefined
  const safeCDNJSON = JSON.stringify(normalizedCDN).replace(/</g, '\\u003c');

  contextScripts.push(
    `<script>window.__CDN_BASE_URL__=${safeCDNJSON};</script>`,
  );

  // Inject __DOMAIN_INFO__ — null when hostname not known (SSG without hostname configured, or SPA)
  // so client code can check for null rather than guarding against undefined
  const safeDomainJSON = JSON.stringify(domainInfo ?? null).replace(
    /</g,
    '\\u003c',
  );

  contextScripts.push(
    `<script>window.__DOMAIN_INFO__=${safeDomainJSON};</script>`,
  );

  // Inject __UNIREND_TEMPLATE_ATTRS__ so client-side DOM reconciliation
  // knows the clean, unmodified attributes from the original index.html template.

  // 1. Locate the opening <html> and <body> tags in the raw HTML template string.
  const htmlTagMatch = findOpeningTag(template, 'html');
  const bodyTagMatch = findOpeningTag(template, 'body');

  // 2. Parse their raw HTML attribute strings (e.g. 'class="foo" lang="en"') into key-value records.
  const templateHTMLAttrs = htmlTagMatch
    ? parseAttributesString(htmlTagMatch.attrsStr)
    : {};
  const templateBodyAttrs = bodyTagMatch
    ? parseAttributesString(bodyTagMatch.attrsStr)
    : {};

  // 3. Serialize the parsed baseline attributes into a JSON string and escape '<' characters
  //    to prevent closing-script-tag XSS injection vulnerabilities.
  const safeTemplateAttrsJSON = JSON.stringify({
    html: templateHTMLAttrs,
    body: templateBodyAttrs,
  }).replace(/</g, '\\u003c');

  // 4. Push the global variable declaration script into the contextScripts list.
  contextScripts.push(
    `<script>window.__UNIREND_TEMPLATE_ATTRS__=${safeTemplateAttrsJSON};</script>`,
  );

  // Router hydration data last — only needed once the client module runs, order relative
  // to other head scripts doesn't matter since all head scripts run before any module script
  for (const script of routerHydrationScripts) {
    contextScripts.push(script);
  }

  // Replace the placeholder with all context scripts (or remove if none).
  const hasMarkers =
    template.includes('<!--ss-head-->') ||
    template.includes('<!--ss-outlet-->') ||
    template.includes('<!--context-scripts-injection-point-->');

  if (hasMarkers) {
    if (result.includes('<!--context-scripts-injection-point-->')) {
      // Detect the placeholder's leading whitespace so injected scripts match indentation.
      const indentMatch = result.match(
        /^([ \t]*)<!--context-scripts-injection-point-->/m,
      );
      const indent = indentMatch ? indentMatch[1] : '';
      result = result.replace(
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
    result = result.replace(/__CDN__INJECTION__POINT__/g, normalizedCDN);
  } else {
    // No CDN URL provided - remove placeholder to preserve original /assets/... paths
    result = result.replace(/__CDN__INJECTION__POINT__/g, '');
  }

  // Unlike tags inside the <head> (which are collected as raw HTML strings and injected into placeholders),
  // <html> and <body> attributes are resolved as key-value objects from React context.
  // We locate these existing tags in the template and merge the new attributes in-place.
  result = updateTagAttributes(result, 'html', htmlAttrs);
  result = updateTagAttributes(result, 'body', bodyAttrs);

  return result;
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

  // Regex to match key="value" or key='value' or key=value or key (boolean)
  const attrRegex =
    /([a-z0-9\-:]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gi;
  let match;

  while ((match = attrRegex.exec(attrsStr)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] ?? match[3] ?? match[4] ?? '';
    attrs[key] = decodeHTML(val);
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
      if (HTML_BOOLEAN_ATTRIBUTES.has(k.toLowerCase()) && v === 'false') {
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

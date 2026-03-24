import { TAB_SPACES } from '../consts';
import { getDevMode } from 'lifecycleion/dev-mode';

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

// Utility to inject content, preserving React attributes
export function injectContent(
  template: string,
  headContent: string,
  bodyContent: string,
  context?: {
    app?: Record<string, unknown>;
    request?: Record<string, unknown>;
  },
  CDNBaseURL?: string,
  domainInfo?: { hostname: string; rootDomain: string } | null,
): string {
  // Prettify all head tags with consistent indentation
  const compactedHead = prettifyHeadTags(headContent);

  // Start with head and body replacement
  // The <!--ss-outlet--> marker should be directly replaced with the content
  // without any additional or changed comments/whitespace that could cause hydration issues
  let result = template
    .replace('<!--ss-head-->', compactedHead)
    .replace('<!--ss-outlet-->', bodyContent);

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

  // Add __FRONTEND_APP_CONFIG__ if provided (even if empty object)
  if (context?.app !== undefined) {
    const safeConfigJSON = JSON.stringify(context.app).replace(/</g, '\\u003c');

    contextScripts.push(
      `<script>window.__FRONTEND_APP_CONFIG__=${safeConfigJSON};</script>`,
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

  // Replace the placeholder with all context scripts (or remove if none).
  // Detect the placeholder's leading whitespace so injected scripts match indentation.
  const indentMatch = result.match(
    /^([ \t]*)<!--context-scripts-injection-point-->/m,
  );

  const indent = indentMatch ? indentMatch[1] : '';
  result = result.replace(
    '<!--context-scripts-injection-point-->',
    contextScripts.join('\n' + indent),
  );

  // Replace CDN injection placeholder with actual CDN URL or empty string
  // This allows runtime CDN URL override per request
  if (normalizedCDN) {
    result = result.replace(/__CDN__INJECTION__POINT__/g, normalizedCDN);
  } else {
    // No CDN URL provided - remove placeholder to preserve original /assets/... paths
    result = result.replace(/__CDN__INJECTION__POINT__/g, '');
  }

  return result;
}

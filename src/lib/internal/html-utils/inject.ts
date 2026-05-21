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
export async function injectContent(
  template: string,
  headContent: string,
  bodyContent: string,
  context?: {
    app?: Record<string, unknown>;
    request?: Record<string, unknown>;
  },
  CDNBaseURL?: string,
  domainInfo?: { hostname: string; rootDomain: string } | null,
): Promise<string> {
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

  // Router hydration data last — only needed once the client module runs, order relative
  // to other head scripts doesn't matter since all head scripts run before any module script
  for (const script of routerHydrationScripts) {
    contextScripts.push(script);
  }

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

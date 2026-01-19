import { TAB_SPACES } from '../consts';

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

  // Replace the placeholder with all context scripts (or remove if none)
  result = result.replace(
    '<!--context-scripts-injection-point-->',
    contextScripts.join('\n'),
  );

  return result;
}

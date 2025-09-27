import { tab_spaces } from "../consts";

// Prettify all head tags: each tag (<title>, <meta>, <link>, etc.) on its own line, indented
export function prettifyHeadTags(head: string, indent = tab_spaces): string {
  // Use a non-capturing group so tag names are not included in the split output
  return head
    .split(/(?=<(?:title|meta|link|script|style|base|noscript|preload)\b)/g)
    .filter(Boolean)
    .map((line) => indent + line.trim())
    .join("\n")
    .trim();
}

// Utility to inject content, preserving React attributes
export function injectContent(
  template: string,
  headContent: string,
  bodyContent: string,
): string {
  // Prettify all head tags with consistent indentation
  const compactedHead = prettifyHeadTags(headContent);

  // Modify the root element to include hydration script after it
  // The <!--ss-outlet--> marker should be directly replaced with the content
  // without any additional or changed comments whitespace that could cause hydration issues
  return template
    .replace("<!--ss-head-->", compactedHead)
    .replace("<!--ss-outlet-->", bodyContent);
}

import type { FastifyRequest } from 'fastify';
import { escapeHTML } from './html-utils/escape';
import { hashInlineContentForCSP } from './csp-hash';

type ErrorPageStyleRules = Record<string, Record<string, string>>;

const DEFAULT_ERROR_PAGE_STYLE_RULES = {
  'html, body': {
    height: '100%',
    margin: '0',
    padding: '0',
    background: '#fff',
  },
  body: {
    'min-height': '100vh',
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'font-family': 'system-ui, Arial, sans-serif',
    background: '#f7f7f8',
  },
  '.ep-card': {
    background: '#fff',
    'border-radius': '14px',
    'box-shadow': '0 2px 16px rgba(0,0,0,0.08)',
    'max-width': '440px',
    width: '100%',
    margin: '32px',
    padding: '32px 28px 24px 28px',
    'text-align': 'center',
  },
  '.ep-title': {
    'font-size': '2rem',
    'font-weight': '600',
    'margin-bottom': '12px',
  },
  '.ep-sub': {
    'font-size': '1.1rem',
    'font-weight': '500',
    'margin-bottom': '24px',
    color: '#222',
  },
  '.ep-panel': {
    background: '#f1f1f3',
    'border-radius': '6px',
    padding: '12px 14px',
    'font-size': '0.98rem',
    color: '#222',
  },
} satisfies ErrorPageStyleRules;

function generateErrorPageStyles(overrides: ErrorPageStyleRules): string {
  const rules: ErrorPageStyleRules = {};

  for (const [selector, declarations] of Object.entries(
    DEFAULT_ERROR_PAGE_STYLE_RULES,
  )) {
    rules[selector] = { ...declarations };
  }

  for (const [selector, declarations] of Object.entries(overrides)) {
    rules[selector] = { ...rules[selector], ...declarations };
  }

  return Object.entries(rules)
    .map(
      ([selector, declarations]) => `    ${selector} {
${Object.entries(declarations)
  .map(([property, value]) => `      ${property}: ${value};`)
  .join('\n')}
    }`,
    )
    .join('\n');
}

/**
 * Build a `<style>` element's text content: the generated rules, wrapped in the
 * newline and closing indent that make the emitted page read like hand-written
 * HTML.
 *
 * The whitespace is part of the value on purpose. A CSP hash covers the text
 * content byte for byte, so the choice is not between a readable page and a
 * hashable one. It is between hashing what the page actually contains and
 * hashing something adjacent to it. Keeping the pretty-printing inside the
 * constant gets both.
 */
function inlineStyleBlock(overrides: ErrorPageStyleRules): string {
  return `\n${generateErrorPageStyles(overrides)}\n  `;
}

/**
 * The style text each built-in error page emits, computed once at module load.
 *
 * These are constants rather than expressions inlined into the templates so
 * they can be hashed for CSP. A hash covers the delivered bytes exactly, so the
 * only way to publish one that matches is to hash the same value the page
 * interpolates. Recomputing the styles per request and hashing them separately
 * would work right up until the two drifted, and then fail silently, with the
 * page rendering unstyled and nothing in the logs to say why.
 *
 * The invariant each template below has to preserve: a constant is the `<style>`
 * element's text content **verbatim**, so it is written as
 * `<style>${CONSTANT}</style>` with nothing between the tags and the value. The
 * formatting that makes the output readable lives inside the constant instead,
 * where it is covered by the hash.
 */
const ERROR_PAGE_500_STYLES = inlineStyleBlock({
  '.ep-title': {
    color: '#e53935',
    'letter-spacing': '0.01em',
  },
  '.ep-section': {
    'margin-bottom': '18px',
    'text-align': 'left',
  },
  '.ep-label': {
    'font-size': '1rem',
    'font-weight': '600',
    color: '#444',
    'margin-bottom': '2px',
  },
  '.ep-panel': {
    'word-break': 'break-all',
    'overflow-x': 'auto',
  },
  '.ep-stack': {
    'font-size': '0.92rem',
    'white-space': 'pre-wrap',
    'font-family':
      'ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace',
    'max-height': '300px',
    'overflow-y': 'auto',
  },
  '.ep-note': {
    'margin-top': '30px',
    'font-size': '0.97rem',
    color: '#888',
  },
  '.ep-btn': {
    margin: '18px auto 0 auto',
    display: 'block',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    'border-radius': '6px',
    padding: '10px 22px',
    'font-size': '1rem',
    'font-weight': '500',
    cursor: 'pointer',
    'box-shadow': '0 1px 3px rgba(0,0,0,0.1)',
    transition: 'background 0.15s',
    // The refresh control is an anchor rather than a button, so it needs the
    // link decoration removed and the text centered to still look like one.
    'text-decoration': 'none',
    'text-align': 'center',
    'max-width': 'fit-content',
  },
  '.ep-btn:hover, .ep-btn:focus': {
    background: '#1d4ed8',
    outline: 'none',
  },
});

const ERROR_PAGE_404_STYLES = inlineStyleBlock({
  '.ep-title': {
    color: '#374151',
  },
});

// Identical to the 404 styles today. Kept separate rather than shared because
// the pages are independent and either may gain its own rules, and the hash
// list below dedupes anyway.
const ERROR_PAGE_503_STYLES = inlineStyleBlock({
  '.ep-title': {
    color: '#374151',
  },
});

/**
 * CSP `style-src` source expressions covering every inline `<style>` block
 * unirend's own error pages emit, unquoted and deduplicated.
 *
 * A strict `style-src` blocks inline styles, and an error page is exactly where
 * that goes unnoticed: it renders unstyled, but only on the requests where
 * something has already gone wrong. Publishing the hashes lets unirend keep its
 * own pages working without asking anyone to allow `'unsafe-inline'`.
 */
export const UNIREND_ERROR_PAGE_STYLE_HASHES: readonly string[] = Array.from(
  new Set(
    [ERROR_PAGE_500_STYLES, ERROR_PAGE_404_STYLES, ERROR_PAGE_503_STYLES].map(
      (styles) => hashInlineContentForCSP(styles),
    ),
  ),
);

/**
 * Generates a default 500 error page.
 * @param request The Fastify request object
 * @param error The error that occurred
 * @param isDevelopment Whether running in development mode
 * @returns HTML string for the error page
 */
export function generateDefault500ErrorPage(
  request: FastifyRequest,
  error: Error,
  isDevelopment: boolean,
): string {
  // The "Refresh Page" link below is deliberately `href=""`, which resolves to
  // the current document. That is what refresh means, and it is the only form
  // that cannot be pointed somewhere else.
  //
  // Echoing request.url there would be an open redirect. Fastify hands over the
  // request target verbatim, so a client can send "//evil.example/p" or the
  // absolute-form "http://evil.example/p", and in an anchor either one resolves
  // to a different origin. Backslashes do it too: a URL parser folds them into
  // forward slashes for http(s), so "/\/evil.example" is protocol-relative
  // without containing a single "//". HTML escaping does not help, because none
  // of those characters are escaped and the problem is what the URL means
  // rather than how it is spelled.
  //
  // request.url is still echoed into the dev panel below, which is fine: that
  // is text content, escaped, and not something a browser will navigate to.

  // Panels for dev mode
  const devPanels = isDevelopment
    ? `<div class="ep-section">
      <div class="ep-label">Message:</div>
      <div class="ep-panel">${escapeHTML(error.message)}</div>
    </div>
    <div class="ep-section">
      <div class="ep-label">Stack Trace:</div>
      <div class="ep-panel ep-stack">${escapeHTML(error.stack || 'No stack trace available')}</div>
    </div>
    <div class="ep-section">
      <div class="ep-label">Request Info:</div>
      <div class="ep-panel">
        URL: ${escapeHTML(request.url)}<br>
        Method: ${request.method}
      </div>
    </div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>500 - Internal Server Error</title>
  <style>${ERROR_PAGE_500_STYLES}</style>
</head>
<body>
  <main class="ep-card">
    <div class="ep-title">500 - Internal Server Error</div>
    <div class="ep-sub">
      ${isDevelopment ? 'Error Details (Development Mode)' : "We're sorry, something went wrong."}
    </div>
    ${
      isDevelopment
        ? devPanels
        : '<div class="ep-panel">An unexpected error occurred. Please try again later.</div>'
    }
    <a class="ep-btn" href="">Refresh Page</a>
    ${
      isDevelopment
        ? '<div class="ep-note"><b>Note:</b> Detailed error information is only shown in development mode.</div>'
        : ''
    }
  </main>
</body>
</html>`;
}

/**
 * Generates a default web/plain-server 404 not found page.
 * API/page-data 404s use envelope responses instead.
 * @param request The Fastify request object
 * @returns HTML string for the not found page
 */
export function generateDefault404NotFoundPage(
  request: FastifyRequest,
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 - Not Found</title>
  <style>${ERROR_PAGE_404_STYLES}</style>
</head>
<body>
  <main class="ep-card">
    <div class="ep-title">404 - Not Found</div>
    <div class="ep-sub">The requested page could not be found.</div>
    <div class="ep-panel">${escapeHTML(request.url)}</div>
  </main>
</body>
</html>`;
}

/**
 * Generates a default 503 page for requests received while the server is closing.
 * @returns HTML string for the shutdown page
 */
export function generateDefault503ClosingPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>503 - Service Unavailable</title>
  <style>${ERROR_PAGE_503_STYLES}</style>
</head>
<body>
  <main class="ep-card">
    <div class="ep-title">503 - Service Unavailable</div>
    <div class="ep-sub">Server is shutting down</div>
    <div class="ep-panel">Please try again shortly.</div>
  </main>
</body>
</html>`;
}

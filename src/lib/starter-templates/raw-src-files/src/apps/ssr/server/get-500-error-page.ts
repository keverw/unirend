import type { FastifyRequest } from 'unirend/server';
import { escapeHTML } from 'unirend/utils';

/**
 * Custom 500 error page generator.
 * Mirrored from the SGGs template static 500.html page style and functionality,
 * but adapted for SSR and customized to display error details in development mode.
 */
export function get500ErrorPage(
  request: FastifyRequest,
  error: Error,
  isDevelopment: boolean,
): string {
  const requestContext = (
    request as FastifyRequest & {
      requestContext?: Record<string, unknown>;
    }
  ).requestContext;

  const preference =
    requestContext?.themePreference === 'dark' ||
    requestContext?.themePreference === 'light' ||
    requestContext?.themePreference === 'auto'
      ? requestContext.themePreference
      : 'auto';

  const safeMessage = escapeHTML(error.message || 'Unexpected server error');
  const safeStack = error.stack
    ? escapeHTML(error.stack)
    : 'No stack trace available';

  return `<!doctype html>
<html lang="en"${preference === 'dark' ? ' class="dark"' : ''}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>500 - Server Error</title>
    <meta name="description" content="An unexpected server error occurred." />
    <style>
      *,
      *::before,
      *::after {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family:
          ui-sans-serif,
          system-ui,
          -apple-system,
          sans-serif;
        background: #fff;
        color: #1f2937;
        display: flex;
        min-height: 100vh;
        align-items: center;
        justify-content: center;
        padding: 2rem;
      }

      .card {
        border: 4px dashed #f97316;
        border-radius: 0.5rem;
        padding: 2rem;
        max-width: 480px;
        width: 100%;
      }

      /* Expand card width in development mode to comfortably fit stack traces */
      .card.dev-card {
        max-width: 640px;
      }

      h1 {
        margin: 0 0 0.5rem;
        font-size: 2.25rem;
        font-weight: 700;
        line-height: 1.2;
      }

      h2 {
        margin: 0 0 1rem;
        font-size: 1.5rem;
        font-weight: 700;
        line-height: 1.3;
      }

      p {
        margin: 0 0 1.5rem;
        color: #4b5563;
      }

      a {
        display: inline-block;
        border: 4px dashed #14b8a6;
        border-radius: 0.25rem;
        padding: 0.5rem 1rem;
        text-decoration: none;
        color: #374151;
      }

      a:hover {
        opacity: 0.8;
      }

      html.dark body {
        background: #111827;
        color: #f3f4f6;
      }

      html.dark p {
        color: #9ca3af;
      }

      html.dark a {
        color: #d1d5db;
      }

      /* Development Error Styles */
      .details {
        margin-top: 1.5rem;
        text-align: left;
        border-top: 1px dashed #e5e7eb;
        padding-top: 1.5rem;
      }

      html.dark .details {
        border-top-color: #374151;
      }

      .details h3 {
        margin: 0 0 0.5rem;
        font-size: 1rem;
        font-weight: 600;
        color: #1f2937;
      }

      html.dark .details h3 {
        color: #f3f4f6;
      }

      .details-section {
        margin-bottom: 1rem;
      }

      .details-label {
        font-size: 0.75rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: #6b7280;
        margin-bottom: 0.25rem;
      }

      html.dark .details-label {
        color: #9ca3af;
      }

      .details-val {
        font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
        font-size: 0.875rem;
        background: #f9fafb;
        border: 1px solid #e5e7eb;
        border-radius: 0.375rem;
        padding: 0.5rem;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
        color: #374151;
      }

      html.dark .details-val {
        background: #1f2937;
        border-color: #374151;
        color: #e5e7eb;
      }

      .stack-trace {
        max-height: 250px;
        overflow-y: auto;
      }
    </style>
    <script>
      window.__FRONTEND_REQUEST_CONTEXT__ = {
        themePreference: ${JSON.stringify(preference)}
      };
    </script>
    <script>
      (function () {
        // Mirrors the flash-prevention script in index.html: cookie-first, then
        // __FRONTEND_REQUEST_CONTEXT__ (injected by the get500ErrorPage handler), then OS.
        // Unlike the main app (index.html + React bundle) there is no React or full theme system here, so we
        // mirror ThemeProvider's sync strategy: matchMedia for OS changes (auto mode),
        // BroadcastChannel for real-time cross-tab updates, and visibilitychange to
        // re-read the cookie when the tab comes back into focus.
        const valid = ['light', 'dark', 'auto'];
        const cookieMatch = document.cookie.match(
          /(?:^|;\\s*)themePreference=([^;]+)/,
        );

        const cookiePref = valid.includes(cookieMatch?.[1])
          ? cookieMatch[1]
          : null;

        let currentPref =
          cookiePref ||
          window.__FRONTEND_REQUEST_CONTEXT__?.themePreference ||
          'auto';

        const mq =
          typeof window.matchMedia === 'function'
            ? window.matchMedia('(prefers-color-scheme: dark)')
            : null;

        // Shared helper — applies a preference value, resolving auto via OS.
        function applyPref(preference) {
          currentPref = preference;

          const shouldUseDarkTheme =
            preference === 'dark' ||
            (preference === 'auto' && (mq ? mq.matches : false));
          document.documentElement.classList.toggle('dark', shouldUseDarkTheme);
        }

        // Apply the initial cookie/context/OS-derived preference before the page renders.
        applyPref(currentPref);

        // Keep auto mode in sync with OS preference changes for the duration of this page load.
        if (mq) {
          mq.addEventListener('change', function () {
            if (currentPref === 'auto') applyPref('auto');
          });
        }

        // BroadcastChannel for real-time cross-tab sync — mirrors ThemeProvider.
        if (typeof BroadcastChannel === 'function') {
          new BroadcastChannel('theme').onmessage = function (e) {
            if (
              e.data &&
              e.data.themePreference &&
              valid.includes(e.data.themePreference)
            ) {
              applyPref(e.data.themePreference);
            }
          };
        }

        // Re-read cookie when tab becomes visible — catches changes made while in the background.
        // Intentionally does not broadcast back, matching ThemeProvider behavior.
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState !== 'visible') return;
          var m = document.cookie.match(/(?:^|;\\s*)themePreference=([^;]+)/);
          applyPref((valid.includes(m?.[1]) ? m[1] : null) || 'auto');
        });
      })();
    </script>
  </head>
  <body>
    <div class="card${isDevelopment ? ' dev-card' : ''}">
      <h1>500</h1>
      <h2>Server Error</h2>
      <p>Something went wrong on our end. Please try again later.</p>
      <a href="/">Go Home</a>
      ${
        isDevelopment
          ? `<div class="details">
              <h3>Development Error Details</h3>
              <div class="details-section">
                <div class="details-label">Message:</div>
                <div class="details-val">${safeMessage}</div>
              </div>
              <div class="details-section">
                <div class="details-label">Stack Trace:</div>
                <div class="details-val stack-trace">${safeStack}</div>
              </div>
              <div class="details-section">
                <div class="details-label">Request Info:</div>
                <div class="details-val">
                  URL: ${escapeHTML(request.url)}<br>
                  Method: ${request.method}
                </div>
              </div>
            </div>`
          : ''
      }
    </div>
  </body>
</html>`;
}

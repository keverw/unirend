import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSG template's `error-pages/500.html`.
 *
 * A self-contained static error page — no React bundle, no Vite, no external
 * assets — so it survives real server failures where the asset pipeline may be
 * unavailable. Includes the same cookie-first dark-mode theme sync script as
 * `index.html` (extended with `matchMedia` OS tracking, `BroadcastChannel`
 * cross-tab sync, and `visibilitychange` cookie re-read), inline CSS with
 * light/dark variants, and a styled error card.
 *
 * SSG-only: the SSG generator emits this as a `{ type: 'html' }` entry
 * (see `generate-ssg.ts`) rather than routing it through React. For SSR, the
 * equivalent is the `get500ErrorPage` callback in `ssr-component.ts`, which
 * returns an HTML string directly — see the comment there for guidance.
 */
const fileSrc = `<!doctype html>
<html lang="en">
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
    </style>
    <script>
      (function () {
        // Mirrors the flash-prevention script in index.html: cookie-first, then
        // __FRONTEND_REQUEST_CONTEXT__ (not injected here, falls through), then OS.
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
    <div class="card">
      <h1>500</h1>
      <h2>Server Error</h2>
      <p>Something went wrong on our end. Please try again later.</p>
      <a href="/">Go Home</a>
    </div>
  </body>
</html>
`;

/**
 * Ensure the SSG app's `error-pages/500.html` exists at
 * `${projectPath}/error-pages/500.html`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSG500HTML(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/error-pages/500.html`;

  try {
    const didWrite = await vfsWriteIfNotExists(root, relPath, fileSrc);

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}

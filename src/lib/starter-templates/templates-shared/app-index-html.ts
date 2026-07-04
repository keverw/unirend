import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * cspell words that appear in the generated `index.html` and so must be in the
 * generated project's dictionary. Co-located with the file that emits them so
 * the two stay in sync; the SSG/SSR `getTemplateConfig` branches fold these
 * into their template-specific `cspellWords` (they don't belong in the global
 * `defaultWords` — an API-only project has no `index.html` to use them).
 *
 * - `Neue` — the `'Helvetica Neue'` font stack in the noscript card's CSS.
 */
export const APP_INDEX_HTML_CSPELL_WORDS = ['Neue'];

/**
 * Build the source for a Vite app's `index.html`.
 *
 * Identical across the Vite-based templates (SSG, SSR) apart from the document
 * `<title>`, so it lives in `templates-shared/` rather than being duplicated
 * per template. The only dynamic substitution is `title` (the project name);
 * everything else — the theme flash-prevention script, the noscript card, the
 * SSR markers (`<!--ss-head-->` / `<!--ss-outlet-->`) and the EntryClient
 * script tag — is emitted verbatim.
 *
 * @param title - Document `<title>` for the generated app
 */
function buildIndexHTMLSrc(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
    <!--ss-head-->
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <!-- Ideally you would do a complete favicon and shortcut icon package - see https://realfavicongenerator.net/-->
    <!-- Note: Browsers and services automatically request /favicon.ico by default, even without a <link> tag.
         Consider placing a favicon.ico in your public directory for maximum compatibility. -->
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <!-- Flash prevention: applies the correct theme class before the page renders.
         Cookie is preferred over __FRONTEND_REQUEST_CONTEXT__ — the cookie reflects the
         user's last explicit choice and is more up-to-date. The context value is baked at
         build time for SSG, or read at request time for SSR (so a change in another tab
         mid-request would still leave them out of sync). Falls back to the OS preference
         via matchMedia when neither is set. -->
    <script>
      (function () {
        const valid = ['light', 'dark', 'auto'];
        const cookieMatch = document.cookie.match(
          /(?:^|;\\s*)themePreference=([^;]+)/,
        );

        const cookiePref = valid.includes(cookieMatch?.[1])
          ? cookieMatch[1]
          : null;

        const pref =
          cookiePref ||
          window.__FRONTEND_REQUEST_CONTEXT__?.themePreference ||
          'auto';

        const systemPrefersDark =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches;

        const theme =
          pref === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : pref;

        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
          // Register dynamic classes in window.__UNIREND_IGNORED_CLASSES__ so
          // UnirendHead doesn't capture them in its static template baseline attributes.
          window.__UNIREND_IGNORED_CLASSES__ =
            window.__UNIREND_IGNORED_CLASSES__ || new Set();
          window.__UNIREND_IGNORED_CLASSES__.add('dark');
        }
      })();
    </script>
  </head>
  <body>
    <!-- Noscript Warning: Displays a centered warning card with a blurred backdrop when JavaScript is disabled.
         Feel free to customize the styling below to match your project. -->
    <noscript>
      <style>
        .noscript-overlay {
          --noscript-accent: #f97316; /* Brand color — drives border, icon, and glow */
          --noscript-accent-tint: rgba(
            249,
            115,
            22,
            0.1
          ); /* Icon circle background (light) */
          --noscript-accent-tint-dark: rgba(
            249,
            115,
            22,
            0.15
          ); /* Icon circle background (dark) */
          --noscript-overlay-bg: rgba(
            249,
            250,
            251,
            0.85
          ); /* Backdrop (light) */
          --noscript-card-bg: #ffffff; /* Card background (light) */
          --noscript-title-color: #111827; /* Title text (light) */
          --noscript-message-color: #6b7280; /* Body text (light) */

          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 99999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background-color: var(--noscript-overlay-bg);
          backdrop-filter: blur(12px) saturate(180%);
          -webkit-backdrop-filter: blur(12px) saturate(180%);
          font-family:
            ui-sans-serif,
            system-ui,
            -apple-system,
            BlinkMacSystemFont,
            'Segoe UI',
            Roboto,
            'Helvetica Neue',
            Arial,
            sans-serif;
        }
        .noscript-card {
          width: 100%;
          max-width: 440px;
          padding: 40px 36px;
          background-color: var(--noscript-card-bg);
          border: 3px dashed var(--noscript-accent);
          border-radius: 16px;
          box-shadow:
            0 0 0 1px color-mix(in srgb, var(--noscript-accent) 8%, transparent),
            0 4px 6px -1px rgba(0, 0, 0, 0.07),
            0 24px 48px -8px rgba(0, 0, 0, 0.12);
          text-align: center;
        }
        /* Icon circle badge */
        .noscript-icon-wrap {
          width: 64px;
          height: 64px;
          margin: 0 auto 20px;
          border-radius: 50%;
          background-color: var(--noscript-accent-tint);
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .noscript-icon {
          width: 32px;
          height: 32px;
          color: var(--noscript-accent);
          display: block;
        }
        .noscript-title {
          font-size: 22px;
          font-weight: 700;
          margin: 0 0 10px;
          letter-spacing: -0.01em;
          color: var(--noscript-title-color);
        }
        .noscript-message {
          font-size: 15px;
          line-height: 1.6;
          margin: 0;
          color: var(--noscript-message-color);
        }

        /* Dark mode overrides (respects system preferences when JS is disabled) */
        @media (prefers-color-scheme: dark) {
          .noscript-overlay {
            --noscript-overlay-bg: rgba(3, 7, 18, 0.85);
            --noscript-card-bg: #0f172a;
            --noscript-accent-tint: var(--noscript-accent-tint-dark);
            --noscript-title-color: #f9fafb;
            --noscript-message-color: #9ca3af;
          }
          .noscript-card {
            box-shadow:
              0 0 0 1px
                color-mix(in srgb, var(--noscript-accent) 12%, transparent),
              0 4px 6px -1px rgba(0, 0, 0, 0.3),
              0 24px 48px -8px rgba(0, 0, 0, 0.5);
          }
        }
      </style>
      <div class="noscript-overlay">
        <div class="noscript-card">
          <div class="noscript-icon-wrap">
            <!-- Warning triangle icon -->
            <svg class="noscript-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 3L1.5 21h21Z"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linejoin="round"
                stroke-linecap="round"
              />
              <rect
                x="11"
                y="10"
                width="2"
                height="5"
                rx="0.5"
                fill="currentColor"
              />
              <rect
                x="11"
                y="16.5"
                width="2"
                height="2"
                rx="0.5"
                fill="currentColor"
              />
            </svg>
          </div>
          <h3 class="noscript-title">JavaScript Required</h3>
          <p class="noscript-message">
            This page needs JavaScript to run. Please enable it in your browser
            settings and reload the page.
          </p>
        </div>
      </div>
    </noscript>
    <div id="root"><!--ss-outlet--></div>
    <script type="module" src="/EntryClient.tsx"></script>
  </body>
</html>
`;
}

/**
 * Ensure a Vite app's `index.html` exists at `${projectPath}/index.html`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param title - Document `<title>` for the generated app
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppIndexHTML(
  root: FileRoot,
  projectPath: string,
  title: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/index.html`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      buildIndexHTMLSrc(title),
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}

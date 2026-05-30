import { BaseComponent } from 'lifecycleion/lifecycle-manager';
import type { Logger } from 'lifecycleion/logger';
import {
  serveSSRWithHMR,
  serveSSRBuilt,
  UnirendLifecycleionLoggerAdaptor,
} from '../../../src/server';
import type {
  SSRServer,
  ServerPlugin,
  ServerRequest,
} from '../../../src/server';
import { clientInfo, cookies } from '../../../src/plugins';
import { escapeHTML } from '../../../src/utils';
import path from 'path';
import type { ServerMode } from './start';

const PORT = 3000;
const HOST = '0.0.0.0';

// SSR_SRC_DIR and SSR_DIST_DIR_APP_A/B override __dirname resolution — useful when running
// a bundled server or if the directory locations change relative to the runner.
const SRC_DIR = process.env.SSR_SRC_DIR ?? path.resolve(__dirname, '..');
const DIST_DIR_APP_A =
  process.env.SSR_DIST_DIR_APP_A ?? path.resolve(__dirname, '../build');
const DIST_DIR_APP_B =
  process.env.SSR_DIST_DIR_APP_B ?? path.resolve(__dirname, '../build-app-b');

// Error string emitted by setActiveSSRApp for unregistered app keys.
// Full message: `Active app "<key>" not found. Available apps: __default__, app-b`
const UNKNOWN_APP_ERROR_FRAGMENT = 'not found. Available apps:';

// ─── Unknown-app 500 page ─────────────────────────────────────────────────────
// Shown when the selected_app cookie holds a key that isn't registered on the
// server (e.g. 'app-c'). The inline JS button clears the cookie and returns the
// user to App A without needing a server round-trip.

function getUnknownAppErrorPage(appKey: string, error: Error): string {
  const safeKey = escapeHTML(appKey);
  const safeMessage = escapeHTML(error.message);

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Unknown App | Multi-App SSR Demo</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, -apple-system, sans-serif;
        background: #0f172a;
        color: #f1f5f9;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
      }
      .card {
        width: min(100%, 560px);
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 2.5rem;
        text-align: center;
      }
      .icon { font-size: 3rem; margin-bottom: 1rem; }
      h1 { margin: 0 0 0.5rem; font-size: 1.75rem; }
      .app-key {
        display: inline-block;
        background: #0f172a;
        border: 1px solid #475569;
        border-radius: 6px;
        padding: 0.15rem 0.5rem;
        font-family: monospace;
        font-size: 1rem;
        color: #f87171;
        margin-bottom: 1rem;
      }
      p { color: #94a3b8; margin: 0 0 1.5rem; line-height: 1.6; }
      details { text-align: left; margin-bottom: 1.5rem; }
      summary { cursor: pointer; color: #64748b; font-size: 0.85rem; }
      pre {
        margin: 0.5rem 0 0;
        padding: 0.75rem;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 6px;
        font-size: 0.78rem;
        color: #94a3b8;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
      }
      button {
        padding: 0.65rem 1.5rem;
        background: #6366f1;
        color: #fff;
        border: none;
        border-radius: 8px;
        font: inherit;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
      }
      button:hover { background: #4f46e5; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon">🔌</div>
      <h1>Unknown App</h1>
      <div class="app-key">${safeKey}</div>
      <p>
        The app key stored in your <code>selected_app</code> cookie doesn't
        match any registered app on this server. Clear the cookie to return
        to App A.
      </p>
      <details>
        <summary>Error detail</summary>
        <pre>${safeMessage}</pre>
      </details>
      <button
        onclick="document.cookie='selected_app=; path=/; max-age=0'; window.location.href='/';"
      >
        Clear App Cookie &amp; Go Home
      </button>
    </div>
  </body>
</html>`;
}

// ─── General SSR 500 page ─────────────────────────────────────────────────────
// Shown when the React SSR render itself fails (separate from routing errors).

function get500ErrorPage(
  _request: ServerRequest,
  error: Error,
  isDevelopment: boolean,
): string {
  const safeMessage = escapeHTML(error.message || 'Unexpected server error');
  const safeStack = error.stack ? escapeHTML(error.stack) : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>500 - Server Error | Multi-App SSR Demo</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        font-family: system-ui, -apple-system, sans-serif;
        background: #0f172a;
        color: #f1f5f9;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
      }
      .card {
        width: min(100%, 560px);
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 12px;
        padding: 2.5rem;
        text-align: center;
      }
      .icon { font-size: 3rem; margin-bottom: 1rem; }
      h1 { margin: 0 0 0.75rem; font-size: 1.75rem; }
      p { color: #94a3b8; margin: 0 0 1.5rem; line-height: 1.6; }
      .actions { display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap; }
      a, button {
        padding: 0.65rem 1.25rem;
        border-radius: 8px;
        font: inherit;
        font-size: 0.95rem;
        font-weight: 600;
        cursor: pointer;
        text-decoration: none;
      }
      button {
        background: #334155;
        color: #f1f5f9;
        border: 1px solid #475569;
      }
      a {
        background: transparent;
        color: #94a3b8;
        border: 1px solid #334155;
      }
      button:hover { background: #475569; }
      a:hover { color: #f1f5f9; border-color: #475569; }
      .details { margin-top: 2rem; text-align: left; }
      .details h2 { font-size: 0.9rem; color: #64748b; margin: 0 0 0.5rem; }
      pre {
        margin: 0;
        padding: 1rem;
        background: #0f172a;
        border: 1px solid #334155;
        border-radius: 8px;
        font-size: 0.78rem;
        color: #94a3b8;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 220px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="icon">💥</div>
      <h1>Server Error</h1>
      <p>
        The server encountered an unexpected error while rendering this page.
      </p>
      <div class="actions">
        <button onclick="window.location.reload()">Try Again</button>
        <a href="/">Go Home</a>
      </div>
      ${
        isDevelopment
          ? `<div class="details">
        <h2>Development Error Details</h2>
        <pre>${safeMessage}${safeStack ? `\n\n${safeStack}` : ''}</pre>
      </div>`
          : ''
      }
    </div>
  </body>
</html>`;
}

// ─── Cookie routing plugin ────────────────────────────────────────────────────
// Reads the selected_app cookie and activates the matching registered app.
// App A is the default (__default__), so 'app-a' or no cookie both fall through.
// For an unknown key (e.g. 'app-c'), setActiveSSRApp throws — we check the error
// message and serve a dedicated "Unknown App" page with a cookie-clear button.
// In a real app, app selection is driven by subdomain or other server-side
// business logic — not user-selectable — so an unknown key would be a bug and
// should surface as a 500. Here we catch it explicitly to show the error path
// and give the demo user a cookie-clear escape hatch.

const cookieRoutingPlugin: ServerPlugin = (pluginHost) => {
  pluginHost.addHook('onRequest', async (request, reply) => {
    // request.cookies is provided by the cookies plugin (dependsOn: ['cookies']).
    const selectedApp = request.cookies['selected_app'];

    if (!selectedApp || selectedApp === 'app-a') {
      return;
    }

    try {
      request.setActiveSSRApp(selectedApp);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes(UNKNOWN_APP_ERROR_FRAGMENT)
      ) {
        await reply
          .code(500)
          .type('text/html; charset=utf-8')
          .send(getUnknownAppErrorPage(selectedApp, error));
      } else {
        throw error;
      }
    }
  });

  return { name: 'cookie-routing', dependsOn: ['cookies'] };
};

// ─── Server component ─────────────────────────────────────────────────────────

interface MultiAppSSRServerComponentOptions {
  mode: ServerMode;
}

export class MultiAppSSRServerComponent extends BaseComponent {
  private server: SSRServer | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private readonly mode: ServerMode;

  constructor(logger: Logger, options: MultiAppSSRServerComponentOptions) {
    super(logger, {
      name: 'multi-app-ssr-server',
      shutdownGracefulTimeoutMS: 30_000,
      shutdownForceTimeoutMS: 5_000,
    });
    this.mode = options.mode;
  }

  public async start(): Promise<void> {
    // Starting while shutdown is active is not a safe no-op: the manager could
    // mark the component running while the old stop() is still draining.
    if (this.stopPromise) {
      throw new Error('Cannot start server while shutdown is in progress');
    }

    // Return the same promise if start is already running, so concurrent callers
    // join the in-flight operation instead of starting a second concurrent startup.
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      try {
        const SHARED_PLUGINS = [
          clientInfo({ setResponseHeaders: true }),
          cookies(),
          cookieRoutingPlugin,
        ];

        const loggingConfig = {
          logger: UnirendLifecycleionLoggerAdaptor(this.logger),
          level: 'debug' as const,
        };

        // publicAppConfig is per-app: the client reads appName/appKey from
        // usePublicAppConfig() to show the current app name and drive AppSwitcher.
        const APP_A_CONFIG = {
          appName: 'App A',
          appKey: 'app-a',
          accentColor: '#6366f1',
        };

        const APP_B_CONFIG = {
          appName: 'App B',
          appKey: 'app-b',
          accentColor: '#10b981',
        };

        if (this.mode === 'hmr') {
          this.server = serveSSRWithHMR(
            {
              serverEntry: path.join(SRC_DIR, 'EntrySSR.tsx'),
              template: path.join(SRC_DIR, 'index.html'),
              viteConfig: path.join(SRC_DIR, 'vite.config.ts'),
            },
            {
              plugins: SHARED_PLUGINS,
              publicAppConfig: APP_A_CONFIG,
              get500ErrorPage,
              logging: loggingConfig,
            },
          );

          // App B: separate Vite instance, separate entry point and template
          this.server.registerHMRApp(
            'app-b',
            {
              serverEntry: path.join(SRC_DIR, 'app-b/EntrySSR.tsx'),
              template: path.join(SRC_DIR, 'app-b/index.html'),
              viteConfig: path.join(SRC_DIR, 'app-b/vite.config.ts'),
            },
            {
              publicAppConfig: APP_B_CONFIG,
              get500ErrorPage,
            },
          );
        } else {
          this.server = serveSSRBuilt(DIST_DIR_APP_A, {
            serverEntry: 'EntrySSR',
            plugins: SHARED_PLUGINS,
            publicAppConfig: APP_A_CONFIG,
            get500ErrorPage,
            logging: loggingConfig,
          });

          // App B: its own build directory
          this.server.registerBuiltApp('app-b', DIST_DIR_APP_B, {
            serverEntry: 'EntrySSR',
            publicAppConfig: APP_B_CONFIG,
            get500ErrorPage,
          });
        }

        await this.server.listen(PORT, HOST);

        this.logger.success(
          '{{mode}} multi-app SSR server running at http://localhost:{{port}}',
          {
            params: { mode: this.mode === 'hmr' ? 'HMR' : 'Built', port: PORT },
          },
        );
        this.logger.info(
          'Apps: App A (default, indigo) | App B (app-b, green)',
        );
        this.logger.info(
          'Cookie routing: set selected_app cookie to switch apps (app-a / app-b / app-c triggers error)',
        );
      } catch (error) {
        // Reset promises and references on failure so that startup can be retried.
        // We throw the error so it propagates to the caller.
        this.startPromise = null;
        this.server = null;
        throw error;
      }
    })();

    return this.startPromise;
  }

  public async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopPromise = (async () => {
      try {
        // Await active startup to settle before stopping, preventing orphaned listening
        // sockets if shutdown is initiated mid-boot. If startup hangs, the manager's
        // shutdown timeouts or process termination will clean it up.
        if (this.startPromise) {
          try {
            await this.startPromise;
          } catch {
            // Ignore start errors since we are stopping anyway
          }
        }

        // Stop the server if it successfully started and is listening. Keep a
        // local reference so the callback stops the same server instance even if
        // component state changes while shutdown is in progress.
        const server = this.server;
        if (server?.isListening()) {
          await server.stop();
        }

        // Only clear the server reference after a successful stop. If stop()
        // rejects, force shutdown still needs this.server to close connections.
        this.server = null;
        this.startPromise = null;
      } finally {
        // Runs on both success and error. Without this, a thrown error would leave
        // stopPromise pointing at a rejected promise forever.
        this.stopPromise = null;
      }
    })();

    return this.stopPromise;
  }

  public async onShutdownForce(): Promise<void> {
    this.server?.closeAllConnections?.();
    await this.stop();
  }

  public healthCheck() {
    if (!this.server) {
      return {
        healthy: false,
        message: 'Server is not started',
      };
    }

    const isHealthy = this.server.isListening();
    return {
      healthy: isHealthy,
      message: isHealthy
        ? `Listening on port ${PORT}`
        : 'Server is not listening',
    };
  }
}

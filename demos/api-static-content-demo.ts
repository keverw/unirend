/**
 * Demo of the staticContent plugin with APIServer
 *
 * This demonstrates how to serve static files from an API-only server
 * using the staticContent plugin from unirend/plugins.
 *
 * Also demonstrates the split error/notFound handlers options for mixed HTML/JSON servers that allow
 * returning HTML for web requests and JSON for API requests.
 *
 * This is useful when you are using the API server as a standalone web server that serves both HTML pages and JSON APIs
 * without using the built-in React compatible SSR server or dedicated static web server.
 *
 * Run with: bun run api-static-demo
 *
 * Signals:
 *   SIGINT / Ctrl+C / ESC — graceful shutdown
 *   SIGUSR1 / I key       — print component health
 */

import path from 'path';
import { initDevMode, getDevMode } from 'lifecycleion/dev-mode';
import {
  LifecycleManager,
  BaseComponent,
} from 'lifecycleion/lifecycle-manager';
import { Logger, ConsoleSink, LogLevel } from 'lifecycleion/logger';
import { assertSupportedRuntime } from '../src/utils';
import { serveAPI } from '../src/server';
import type { APIServer, APIServerOptions } from '../src/server';
import { staticContent } from '../src/plugins';
import { APIResponseHelpers } from '../src/api-envelope';

// Resolve the demo files directory relative to this file
const staticFilesDir = path.join(import.meta.dirname, 'static-demo-files');

const PORT = 3002;

// ─── Bootstrap ───────────────────────────────────────────────────────────────
assertSupportedRuntime();
initDevMode({ detect: 'cmd', strict: true });

// ─── Logger ──────────────────────────────────────────────────────────────────
const isDev = getDevMode();

const logger = new Logger({
  sinks: [
    new ConsoleSink({
      colors: true,
      timestamps: true,
      minLevel: isDev ? LogLevel.DEBUG : LogLevel.SUCCESS,
    }),
  ],
});

// ─── HTML error page generators ───────────────────────────────────────────────

/**
 * Generate an HTML error page with consistent styling
 */
function generateErrorHTML(
  statusCode: number,
  title: string,
  message: string,
  url: string,
): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${statusCode} - ${title}</title>
  <link rel="stylesheet" href="/static/styles.css" />
</head>
<body>
  <div class="container">
    <header>
      <a href="/static/index.html">
        <img src="/static/logo.svg" alt="Unirend Logo" class="logo" />
      </a>
      <h1>${statusCode} - ${title}</h1>
    </header>
    <main>
      <section class="card">
        <h2>💥 Error</h2>
        <p>${message}</p>
        <p>Path: <code>${url}</code></p>
      </section>
      <section class="card">
        <h2>🔗 Try these instead</h2>
        <ul>
          <li><a href="/static/index.html">Home Page</a></li>
          <li><a href="/api/health">API Health Check</a></li>
        </ul>
      </section>
    </main>
    <footer>
      <p>Powered by <strong>Unirend</strong> staticContent plugin</p>
    </footer>
  </div>
</body>
</html>`;
}

/**
 * Generate an HTML 404 page with consistent styling
 */
function generate404Html(url: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>404 - Page Not Found</title>
  <link rel="stylesheet" href="/static/styles.css" />
</head>
<body>
  <div class="container">
    <header>
      <a href="/static/index.html">
        <img src="/static/logo.svg" alt="Unirend Logo" class="logo" />
      </a>
      <h1>404 - Page Not Found</h1>
    </header>
    <main>
      <section class="card">
        <h2>🔍 Oops!</h2>
        <p>The page <code>${url}</code> could not be found.</p>
      </section>
      <section class="card">
        <h2>💡 What happened?</h2>
        <ul>
          <li>The static file doesn't exist in the <code>/static</code> folder</li>
          <li>The staticContent plugin returned (file not found)</li>
          <li>The notFoundHandler.web served this HTML 404 page</li>
        </ul>
      </section>
      <section class="card">
        <h2>🔗 Try these instead</h2>
        <ul>
          <li><a href="/static/index.html">Home Page</a></li>
          <li><a href="/api/health">API Health Check</a></li>
        </ul>
      </section>
    </main>
    <footer>
      <p>Powered by <strong>Unirend</strong> staticContent plugin</p>
    </footer>
  </div>
</body>
</html>`;
}

// ─── StaticContentDemoComponent ───────────────────────────────────────────────

class StaticContentDemoComponent extends BaseComponent {
  private server: APIServer | null = null;
  private startPromise: Promise<void> | null = null;
  // Stored so concurrent callers (e.g. onShutdownForce) join the same
  // in-flight promise rather than starting a second concurrent close.
  private stopPromise: Promise<void> | null = null;

  constructor(parentLogger: Logger) {
    super(parentLogger, {
      name: 'api-static-content-demo',
      // 10s graceful: static file serving requests complete in milliseconds.
      shutdownGracefulTimeoutMS: 10_000,
      // 5s force: after closeAllConnections() kicks in, stop() resolves quickly.
      shutdownForceTimeoutMS: 5_000,
    });
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
        this.logger.info('Serving static files from: {{dir}}', {
          params: { dir: staticFilesDir },
        });

        const options: APIServerOptions = {
          // apiEndpoints.apiEndpointPrefix defaults to '/api'
          // Split handlers use this to detect API vs web requests
          plugins: [
            // Static content plugin - serves files from /static/*
            staticContent({
              folderMap: {
                '/static': {
                  path: staticFilesDir,
                  detectImmutableAssets: false, // Demo files aren't fingerprinted
                },
              },
              // Custom cache settings for demo
              cacheControl: 'public, max-age=60', // 1 minute for demo
              positiveCacheTtl: 10 * 1000, // 10 second internal cache for demo
            }),

            // API routes plugin
            (fastify, pluginOptions) => {
              // eslint-disable-next-line no-console
              console.log(
                '📦 Registering API routes with options:',
                pluginOptions,
              );

              // Health check
              fastify.get('/api/health', async (_request, _reply) => {
                return {
                  status: 'healthy',
                  timestamp: new Date().toISOString(),
                  server: 'unirend-api-with-static',
                };
              });

              // Server info endpoint
              fastify.get('/api/info', async (_request, _reply) => {
                return {
                  name: 'Static Content Demo Server',
                  version: '1.0.0',
                  staticDir: staticFilesDir,
                  features: [
                    'Static file serving via staticContent plugin',
                    'ETag caching for efficient conditional requests',
                    'Content-based hashing for small files',
                    'Multiple plugin instances supported',
                    'Split 404 handling (HTML for web, JSON for API)',
                  ],
                  endpoints: {
                    api: ['/api/health', '/api/info'],
                    static: [
                      '/static/index.html',
                      '/static/styles.css',
                      '/static/logo.svg',
                    ],
                  },
                };
              });

              // Redirect root to static index
              fastify.get('/', async (_request, reply) => {
                return reply.redirect('/static/index.html');
              });

              // Test routes that throw errors (for testing errorHandler)
              fastify.get('/api/throw', () => {
                throw new Error('Intentional API error for testing');
              });

              fastify.get('/throw', () => {
                throw new Error('Intentional web error for testing');
              });
            },
          ],

          // Split handlers - the clean way to handle mixed HTML/JSON servers
          // No catch-all route needed! Uses apiEndpointPrefix to detect API vs web

          // Split error handler for 500 errors
          errorHandler: {
            // API errors get JSON envelope
            api: (request, error, isDevelopment) => {
              return APIResponseHelpers.createAPIErrorResponse({
                request,
                statusCode: 500,
                errorCode: 'internal_error',
                errorMessage: isDevelopment
                  ? error.message
                  : 'An internal error occurred',
                errorDetails: isDevelopment
                  ? { stack: error.stack }
                  : undefined,
              });
            },
            // Web errors get HTML page
            web: (request, error, isDevelopment) => {
              return {
                contentType: 'html',
                content: generateErrorHTML(
                  500,
                  'Server Error',
                  isDevelopment ? error.message : 'An internal error occurred',
                  request.url,
                ),
                statusCode: 500,
              };
            },
          },

          // Split 404 handler
          notFoundHandler: {
            // API requests get JSON envelope
            api: (request, isPageData) => {
              return APIResponseHelpers.createAPIErrorResponse({
                request,
                statusCode: 404,
                errorCode: 'not_found',
                errorMessage: `API endpoint not found: ${request.url}`,
                errorDetails: {
                  path: request.url,
                  method: request.method,
                  isPageData,
                  hint: 'Check the endpoint URL and HTTP method',
                },
              });
            },
            // Web requests get HTML page
            web: (request) => {
              return {
                contentType: 'html',
                content: generate404Html(request.url),
                statusCode: 404,
              };
            },
          },

          fastifyOptions: {
            logger: {
              level: 'info',
            },
          },
        };

        this.server = serveAPI(options);
        await this.server.listen(PORT, '0.0.0.0');

        this.logger.success(
          'API server with static content running at http://localhost:{{port}}',
          { params: { port: PORT } },
        );
        this.logger.info('Open in browser: http://localhost:3002');
        this.logger.info('API endpoints: GET /api/health, GET /api/info');
        this.logger.info(
          'Static files: /static/index.html, /static/styles.css, /static/logo.svg',
        );
        this.logger.info(
          'Error testing: GET /api/throw (JSON error), GET /throw (HTML error)',
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
    // Return the same promise if stop is already running, so concurrent callers
    // (including onShutdownForce) join the in-flight operation
    // instead of starting a second concurrent close.
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
        // local reference so the callback closes the same server instance even if
        // component state changes while shutdown is in progress.
        const server = this.server;
        if (server?.isListening()) {
          await server.stop();
        }

        // Only clear the server reference after a successful close. If close()
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
    // Force-close open connections so server.stop() can finish draining and resolve.
    this.server?.closeAllConnections();
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

// ─── Lifecycle manager ───────────────────────────────────────────────────────

async function main() {
  const manager = new LifecycleManager({
    name: 'api-static-content-demo',
    logger,
    // Attach signal handlers before startup so any signal queued during
    // startAllComponents() is handled correctly once the event loop resumes.
    attachSignalsBeforeStartup: true,
    // Detach signal handlers when the last component stops, otherwise the process hangs.
    detachSignalsOnStop: true,
    // Stop all components gracefully before the process exits when
    // logger.exit() fires (e.g. logger.error with exitCode).
    enableLoggerExitHook: true,
    // Force exit if shutdown requests keep arriving while shutdown is already running
    // (e.g. repeated Ctrl+C). Defaults: 3 requests within 2000ms triggers onForceShutdown.
    repeatedShutdownRequestPolicy: {
      onForceShutdown: () => {
        logger.warn('Multiple shutdown requests received — forcing exit');
        process.exit(1);
      },
    },
    onInfoRequested: async () => {
      const report = await manager.checkAllHealth();

      for (const { name, healthy: isHealthy, message } of report.components) {
        const msg = message ?? (isHealthy ? 'healthy' : 'unhealthy');

        if (isHealthy) {
          logger.success('[{{name}}] {{msg}}', { params: { name, msg } });
        } else {
          logger.warn('[{{name}}] {{msg}}', { params: { name, msg } });
        }
      }
    },
  });

  // Register the API static content demo component.
  // To add a database or other services, register additional components here
  // before startAllComponents — they start in order, so infrastructure (DB, cache, etc.)
  // comes up before the static/API server that uses it.
  await manager.registerComponent(new StaticContentDemoComponent(logger));

  // Start all components
  await manager.startAllComponents();
}

main().catch((error) => {
  logger.error('Failed to start server: {{error}}', {
    params: { error },
    exitCode: 1,
  });
});

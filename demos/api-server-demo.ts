/**
 * Demo of the APIServer functionality
 *
 * This demonstrates how to create an API-only server with full wildcard support
 * using the serveAPI function from unirend.
 *
 * Run with: bun run api-demo
 *
 * Signals:
 *   SIGINT / Ctrl+C / ESC — graceful shutdown
 *   SIGUSR1 / I key       — print component health
 */

import { initDevMode, getDevMode } from 'lifecycleion/dev-mode';
import {
  LifecycleManager,
  BaseComponent,
} from 'lifecycleion/lifecycle-manager';
import { Logger, ConsoleSink, LogLevel } from 'lifecycleion/logger';
import { assertSupportedRuntime } from '../src/utils';
import { serveAPI } from '../src/server';
import type { APIServer, APIServerOptions } from '../src/server';
// import { APIResponseHelpers } from '../src/api-envelope'; // Uncomment when using custom handlers

const PORT = 3001;

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

// ─── APIServerDemoComponent ───────────────────────────────────────────────────

class APIServerDemoComponent extends BaseComponent {
  private server: APIServer | null = null;
  private startPromise: Promise<void> | null = null;
  // Stored so concurrent callers (e.g. onShutdownForce) join the same
  // in-flight promise rather than starting a second concurrent close.
  private stopPromise: Promise<void> | null = null;

  constructor(parentLogger: Logger) {
    super(parentLogger, {
      name: 'api-server',
      // 10s graceful: API requests complete in milliseconds.
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
        const options: APIServerOptions = {
          plugins: [
            // Plugin demonstrating full wildcard support
            (fastify, pluginOptions) => {
              // eslint-disable-next-line no-console
              console.log(
                '📦 Registering API plugin with options:',
                pluginOptions,
              );

              // Root wildcard route - this would be blocked in SSR servers!
              // commented out to test 404 handling
              // fastify.get("*", async (request, _reply) => {
              //   return {
              //     message: "Catch-all route - this works in API servers!",
              //     path: request.url,
              //     method: request.method,
              //     timestamp: new Date().toISOString(),
              //   };
              // });

              // API wildcard routes
              fastify.get('/api/*', async (request, _reply) => {
                return {
                  message: 'API wildcard route',
                  path: request.url,
                  api: true,
                  timestamp: new Date().toISOString(),
                };
              });

              // Specific API endpoints
              fastify.get('/api/users', async (_request, _reply) => {
                return {
                  users: [
                    { id: 1, name: 'Alice' },
                    { id: 2, name: 'Bob' },
                  ],
                };
              });

              fastify.post('/api/users', async (request, _reply) => {
                return {
                  message: 'User created',
                  user: request.body,
                  timestamp: new Date().toISOString(),
                };
              });

              // Health check
              fastify.get('/health', async (_request, _reply) => {
                return {
                  status: 'healthy',
                  timestamp: new Date().toISOString(),
                  server: 'unirend-api',
                };
              });

              // Error testing routes
              fastify.get('/api/error', async (_request, _reply) => {
                throw new Error('This is a test error!');
              });

              fastify.get('/api/error/500', async (_request, _reply) => {
                const error = new Error('Custom 500 error') as Error & {
                  statusCode?: number;
                };
                error.statusCode = 500;
                throw error;
              });

              fastify.get('/api/error/400', async (_request, _reply) => {
                const error = new Error('Bad request error') as Error & {
                  statusCode?: number;
                };
                error.statusCode = 400;
                throw error;
              });

              // Page-data error route (to test envelope detection)
              // Note: page_data endpoints should always be under the API prefix
              fastify.get(
                '/api/v1/page_data/error',
                async (_request, _reply) => {
                  throw new Error('Page data error!');
                },
              );
            },
          ],
          // errorHandler: (request, error, isDevelopment, isPageData) => {
          //   console.error("🚨 API Error:", error.message);

          //   // Return proper envelope response based on request type
          //   if (isPageData) {
          //     // Page data request - return PageErrorResponse
          //     return APIResponseHelpers.createPageErrorResponse({
          //       request,
          //       statusCode: 500,
          //       errorCode: "internal_server_error",
          //       errorMessage: error.message,
          //       pageMetadata: {
          //         title: "Server Error",
          //         description:
          //           "An internal server error occurred while processing your request",
          //       },
          //       errorDetails: {
          //         path: request.url,
          //         method: request.method,
          //         timestamp: new Date().toISOString(),
          //         ...(isDevelopment && { stack: error.stack }),
          //       },
          //     });
          //   } else {
          //     // API request - return APIErrorResponse
          //     return APIResponseHelpers.createAPIErrorResponse({
          //       request,
          //       statusCode: 500,
          //       errorCode: "internal_server_error",
          //       errorMessage: error.message,
          //       errorDetails: {
          //         path: request.url,
          //         method: request.method,
          //         timestamp: new Date().toISOString(),
          //         ...(isDevelopment && { stack: error.stack }),
          //       },
          //     });
          //   }
          // },
          // notFoundHandler: (request, isPageData) => {
          //   console.log("🔍 Custom 404 Handler:", request.url, "isPageData:", isPageData);

          //   // Return proper envelope response based on request type
          //   if (isPageData) {
          //     // Page data request - return PageErrorResponse
          //     return APIResponseHelpers.createPageErrorResponse({
          //       request,
          //       statusCode: 404,
          //       errorCode: "not_found",
          //       errorMessage: `Page data endpoint not found: ${request.url}`,
          //       pageMetadata: {
          //         title: "Page Not Found",
          //         description: "The requested page data could not be found",
          //       },
          //       errorDetails: {
          //         path: request.url,
          //         method: request.method,
          //         isPageRequest: true,
          //         timestamp: new Date().toISOString(),
          //         suggestion:
          //           "Try checking the page route or data loader configuration",
          //       },
          //     });
          //   } else {
          //     // API request - return APIErrorResponse
          //     return APIResponseHelpers.createAPIErrorResponse({
          //       request,
          //       statusCode: 404,
          //       errorCode: "not_found",
          //       errorMessage: `API endpoint not found: ${request.url}`,
          //       errorDetails: {
          //         path: request.url,
          //         method: request.method,
          //         isPageRequest: false,
          //         timestamp: new Date().toISOString(),
          //         suggestion: "Check the API endpoint URL and method",
          //       },
          //     });
          //   }
          // },
          fastifyOptions: {
            logger: {
              level: 'info',
            },
          },
        };

        this.server = serveAPI(options);
        await this.server.listen(PORT, '0.0.0.0');

        this.logger.success('API server running at http://localhost:{{port}}', {
          params: { port: PORT },
        });
        this.logger.info('Working routes:');
        this.logger.info('  GET  http://localhost:3001/health');
        this.logger.info('  GET  http://localhost:3001/api/users');
        this.logger.info('  POST http://localhost:3001/api/users');
        this.logger.info(
          '  GET  http://localhost:3001/api/anything (wildcard)',
        );
        this.logger.info('Error testing routes:');
        this.logger.info(
          '  GET  http://localhost:3001/api/error (throws error)',
        );
        this.logger.info(
          '  GET  http://localhost:3001/api/error/500 (custom 500)',
        );
        this.logger.info(
          '  GET  http://localhost:3001/api/error/400 (custom 400)',
        );
        this.logger.info(
          '  GET  http://localhost:3001/api/v1/page_data/error (page envelope)',
        );
        this.logger.info('404 testing routes:');
        this.logger.info(
          '  GET  http://localhost:3001/not-found (API 404 envelope)',
        );
        this.logger.info(
          '  GET  http://localhost:3001/api/v1/page_data/not-found (Page 404 envelope)',
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
    name: 'api-server-demo',
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

  // Register the API server demo component.
  // To add a database or other services, register additional components here
  // before startAllComponents — they start in order, so infrastructure (DB, cache, etc.)
  // comes up before the API server that uses it.
  await manager.registerComponent(new APIServerDemoComponent(logger));

  // Start all components
  await manager.startAllComponents();
}

main().catch((error) => {
  logger.error('Failed to start server: {{error}}', {
    params: { error },
    exitCode: 1,
  });
});

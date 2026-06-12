import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';
import { buildAppEnvVarName } from '../../internal-utils';

/**
 * Build the source for an SSR app's `server/ssr-component.ts` — the
 * Lifecycleion component that boots the Unirend SSR server, registers
 * routes/page-data handlers, and wires graceful start/stop.
 *
 * SSR-specific; lives in `templates-specific/ssr/`. The component's own
 * `name: 'ssr-server'` stays generic per the naming rule — only the
 * `LifecycleManager` name in `start.ts` incorporates the app name.
 *
 * Per-project substitutions (all derived from `appName`):
 *  • `portEnvVarName` (`buildAppEnvVarName(appName, 'PORT')`) — used as both
 *    the const name and the `process.env[...]` key; replaces raw `SSR_PORT`.
 *  • `srcDirEnvVarName` (`buildAppEnvVarName(appName, 'SRC_DIR')`) — env key
 *    for `SRC_DIR`; replaces raw `SSR_SRC_DIR`.
 *  • `distDirEnvVarName` (`buildAppEnvVarName(appName, 'DIST_DIR')`) — env key
 *    for `DIST_DIR` and the build path comment; replaces raw `SSR_DIST_DIR`.
 *  • `appName` — injected into `build/ssr` path and `ssr:build` script comment.
 *
 * Template-literal escaping required for 4 backtick strings:
 *  • Commented-out `api_endpoint` template literal (line ~137 in raw).
 *  • `healthCheck` ternary (`` `Listening on port ${...}` ``).
 *  • Two `serverLine` data loader strings.
 *
 * @param appName - The app/project name used to derive all env var names and paths
 */
function buildSSRComponentSrc(appName: string): string {
  const portEnvVarName = buildAppEnvVarName(appName, 'PORT');
  const srcDirEnvVarName = buildAppEnvVarName(appName, 'SRC_DIR');
  const distDirEnvVarName = buildAppEnvVarName(appName, 'DIST_DIR');

  return `import { BaseComponent } from 'lifecycleion/lifecycle-manager';
import type { Logger } from 'lifecycleion/logger';
import {
  serveSSRWithHMR,
  serveSSRBuilt,
  UnirendLifecycleionLoggerAdaptor,
} from 'unirend/server';
import type { SSRServer } from 'unirend/server';
import { loadBuildInfo } from 'unirend/build-info';
import { cookies } from 'unirend/plugins';
import path from 'path';
import type { ServerMode } from './start';
import { ENABLE_TEST_ROUTES } from '../consts';
import { themePlugin } from './plugins/theme';
import { get500ErrorPage } from './get-500-error-page.ts';

// Read port from ${portEnvVarName} env var, default 3000.
// Production HTTPS: use a reverse proxy (nginx, Caddy, etc.) for TLS termination,
// or see https://github.com/keverw/unirend/blob/master/docs/https.md to handle it in code.
// If using serveRedirect(), set its targetPort to ${portEnvVarName} and use a separate
// HTTP_REDIRECT_PORT env var with a default. Then run both servers in the same
// component in parallel, or add a dedicated redirect component.
const ${portEnvVarName} = parseInt(process.env['${portEnvVarName}'] ?? '3000', 10);

// ${srcDirEnvVarName} and ${distDirEnvVarName} override __dirname resolution — useful when running
// a bundled server or if the directory locations change relative to the runner.
const SRC_DIR = process.env['${srcDirEnvVarName}'] ?? path.resolve(__dirname, '..');
const DIST_DIR =
  process.env['${distDirEnvVarName}'] ?? path.resolve(__dirname, '../../../../build/${appName}');

interface SSRServerComponentOptions {
  mode: ServerMode;
}

export class SSRServerComponent extends BaseComponent {
  private server: SSRServer | null = null;
  private startPromise: Promise<void> | null = null;
  // Stored so concurrent callers (e.g. onShutdownForce) join the same
  // in-flight promise rather than starting a second concurrent close.
  private stopPromise: Promise<void> | null = null;
  private readonly mode: ServerMode;

  // Mutable sub-object held by reference inside publicAppConfig. Because
  // publicAppConfig is deep-cloned per request, mutating this object between
  // requests (e.g. at midnight) is picked up by all subsequent requests without restart.
  // See: https://github.com/keverw/unirend/blob/master/docs/ssr.md
  private readonly siteInfo = { current_year: new Date().getFullYear() };
  private midnightTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(logger: Logger, options: SSRServerComponentOptions) {
    super(logger, {
      name: 'ssr-server',
      // 30s graceful: gives the server time to drain in-flight requests and active
      // WebSocket connections before force-closing.
      shutdownGracefulTimeoutMS: 30_000,
      // 5s force: after closeAllConnections() kicks in, stop() should resolve almost
      // immediately — this is just a safety net for anything that still hangs.
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
        // Load build info generated by generate:build-info, which always runs first in ${appName}:build.
        // IS_BUILT is injected at bundle time via bun build --define 'IS_BUILT=true|false'.
        // When false or not injected, loadBuildInfo uses safe defaults without attempting
        // the import. See: https://github.com/keverw/unirend/blob/master/docs/build-info.md
        // @ts-expect-error IS_BUILT is a build-time constant injected via bun build --define; not declared in TypeScript source
        const isBuilt = typeof IS_BUILT !== 'undefined' && IS_BUILT === true;
        const buildResult = await loadBuildInfo(isBuilt, () => {
          // When bundling the server (e.g. bun build --target=node),
          // this is inlined at bundle time, unless externalized.
          return import('../current-build-info.ts');
        });

        // Shared constructor options — customize these for your app
        const sharedConfig = {
          containerID: 'root' as const,
          // Client identity (request ID, real client IP, correlation ID, and the
          // X-Request-ID/X-Correlation-ID response headers) is resolved by the server on
          // every request. Trusting forwarded SSR headers (to recover the original client
          // across a separated SSR → API hop) is OFF by default — opt in with
          // clientInfo.trustForwardedHeaders: 'local'.
          // Configure or disable via the clientInfo option (and getConnectionIP / getRequestID).
          // See: https://github.com/keverw/unirend/blob/master/docs/client-identity.md
          // clientInfo: { /* trustForwardedHeaders, setResponseHeaders, ... */ },
          // clientInfo: false, // disable resolution entirely
          apiEndpoints: {
            // Set apiEndpointPrefix to false to disable API handling entirely
            // (e.g. when running a separate dedicated API server).
            apiEndpointPrefix: '/api',
            versioned: true,
            pageDataEndpoint: 'page_data',
          },
          // Extend APIResponseHelpers to inject shared metadata (e.g. auth state, user
          // info) into every envelope response, then pass your subclass here so all routes
          // — including 404s — get it consistently.
          // See: https://github.com/keverw/unirend/blob/master/docs/api-envelope-structure.md
          // See: https://github.com/keverw/unirend/blob/master/docs/data-loaders.md
          // APIResponseHelpersClass: YourCustomAPIResponseHelpers,
          //
          // Safe-to-share config injected into every page. Deep-cloned and deep-frozen per request,
          // so it's safe to mutate sub-objects between requests (the next clone picks up the change).
          //
          // Keep this minimal and non-sensitive, as it's serialized into the page
          // as window.__PUBLIC_APP_CONFIG__.
          //
          // See: https://github.com/keverw/unirend/blob/master/docs/ssr.md
          // Tip: page data loader and API route handlers, as well as custom
          // APIResponseHelpersClass methods, can also read the per-request snapshot
          // via request.publicAppConfig — pass the source object by reference (same
          // idea as siteInfo here) so mutations are picked up without restart. The
          // build-info docs show this pattern for build info, but the same approach
          // works for any shared server state.
          // See: https://github.com/keverw/unirend/blob/master/docs/build-info.md
          publicAppConfig: {
            site_info: this.siteInfo,
            build: {
              version: buildResult.info.version,
              git_hash: buildResult.info.git_hash,
              git_branch: buildResult.info.git_branch,
            },
            // If your API runs on a separate server, see the API_BASE_URL block in routes.tsx —
            // it reads api_endpoint from publicAppConfig on the client and INTERNAL_API_ENDPOINT
            // on the server for when the internal hostname differs from the public URL.
            // Set api_endpoint here so client-side data loaders can reach the API via
            // window.__PUBLIC_APP_CONFIG__. Omit it to fall back to window.location.origin,
            // which works automatically when the API and SSR server are co-located.
            // Use an env var so the value can differ between environments:
            // api_endpoint: process.env.PUBLIC_API_ENDPOINT ?? \`http://localhost:\${${portEnvVarName}}\`,
          },
          //
          // Error page customization — see: https://github.com/keverw/unirend/blob/master/docs/ssr.md
          //
          // Override the default 500 HTML page (rendered when SSR itself fails, before React runs).
          // Your ApplicationError component should use a consistent style with whatever you put here.
          get500ErrorPage,
          //
          // Customize API error and not-found responses (both page-data data loader and plain API routes).
          // Handlers return API envelopes (JSON), not raw HTML — use get500ErrorPage above for
          // the raw-HTML fallback when SSR rendering itself fails before React can run.
          // APIHandling: {
          //   errorHandler: (request, error, isDev, isPageData, params) => {
          //     // isDev mirrors request.isDevelopment elsewhere — convention:
          //     // errorDetails: isDev ? { stack: error.stack } : undefined
          //     // Use params.APIResponseHelpers to build API/Page envelopes.
          //   },
          //   notFoundHandler: (request, isPageData, params) => { ... },
          // },
          //
          // Advanced: resolvePageDataRequestOptions rewrites the API base URL per-request (load balancing)
          // or passes a NodeAdapter from lifecycleion/http-client-node for private-network TLS.
          // Only fires when SSR and API are on separate servers — co-located handlers on the same
          // SSR server short-circuit in-process, bypassing this callback entirely.
          // See: https://github.com/keverw/unirend/blob/master/docs/ssr.md
          // resolvePageDataRequestOptions: ({ pageType, baseURL, fastifyRequest }) => {
          //   return { baseURL: 'http://internal-api:8080', adapter: myNodeAdapter };
          // },
          //
          // Closing handler — customize the response returned to clients that arrive while
          // the server is shutting down. When omitted, Unirend sends a default 503 response.
          //
          // Function form handles web requests. Split form separates web and API handlers for
          // mixed SSR + API servers (when apiEndpointPrefix is set and API routes are enabled).
          // Missing handlers fall back to the default 503 response.
          // See: https://github.com/keverw/unirend/blob/master/docs/ssr.md
          //
          // closingHandler: (_request) => ({
          //   contentType: 'html',
          //   content: '<html><body>Server shutting down. Try again shortly.</body></html>',
          //   statusCode: 503,
          // }),
          //
          // Split form (when mixing web pages and API routes on the same SSR server):
          // closingHandler: {
          //   web: (_request) => ({
          //     contentType: 'html',
          //     content: '<html><body>Server shutting down. Try again shortly.</body></html>',
          //     statusCode: 503,
          //   }),
          //   api: (request, isPageData, params) => {
          //     return params.APIResponseHelpers.createAPIErrorResponse({
          //       request,
          //       statusCode: 503,
          //       errorCode: 'service_unavailable',
          //       errorMessage: 'Server is shutting down. Please try again shortly.',
          //     });
          //   },
          // },
        };

        // This level controls the adapter's gate — what Fastify passes to the Lifecycleion
        // logger. Set to 'debug' so everything gets through and the ConsoleSink's minLevel
        // does the real filtering in one place. 'trace' gives even more verbose Fastify
        // output but is treated as debug on the Lifecycleion logger side since there is no trace level.
        const loggingConfig = {
          logger: UnirendLifecycleionLoggerAdaptor(this.logger),
          level: 'debug' as const,
        };

        // Create the server in the appropriate mode.
        // To host multiple React apps on the same server, call server.registerHMRApp()
        // or server.registerBuiltApp() after construction — matching the same mode branch.
        if (this.mode === 'hmr') {
          this.server = serveSSRWithHMR(
            {
              serverEntry: path.join(SRC_DIR, 'EntrySSR.tsx'),
              template: path.join(SRC_DIR, 'index.html'),
              viteConfig: path.join(SRC_DIR, 'vite.config.ts'),
            },
            {
              ...sharedConfig,
              // See 'unirend/plugins' for built-in plugins (cors, domainValidation, cookies, etc.).
              plugins: [cookies(), themePlugin()],
              logging: loggingConfig,
            },
          );

          // Additional apps: this.server.registerHMRApp({ serverEntry: '...', template: '...', viteConfig: '...' });
        } else {
          this.server = serveSSRBuilt(DIST_DIR, {
            ...sharedConfig,
            serverEntry: 'EntrySSR',
            // See 'unirend/plugins' for built-in plugins (cors, domainValidation, cookies, etc.).
            plugins: [cookies(), themePlugin()],
            logging: loggingConfig,
          });

          // Additional apps: this.server.registerBuiltApp('/path/to/other-app/build/ssr', { serverEntry: 'EntrySSR' });
        }

        // Start the midnight timer so siteInfo.current_year stays current.
        this.scheduleMidnightUpdate();

        // Register data loaders and API routes
        this.registerRoutes(this.server);

        // Start listening for requests
        await this.server.listen(${portEnvVarName}, '0.0.0.0');

        this.logger.success(
          '{{mode}} SSR server running at http://localhost:{{port}}',
          {
            params: {
              mode: this.mode === 'hmr' ? 'HMR' : 'Built',
              port: ${portEnvVarName},
            },
          },
        );
      } catch (error) {
        // Reset promises and references on failure so that startup can be retried.
        // We throw the error so it propagates to the caller.
        this.startPromise = null;
        this.server = null;
        if (this.midnightTimer !== null) {
          clearTimeout(this.midnightTimer);
          this.midnightTimer = null;
        }
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

        // Cancel the midnight year-update timer so it doesn't fire after shutdown.
        if (this.midnightTimer !== null) {
          clearTimeout(this.midnightTimer);
          this.midnightTimer = null;
        }
      } finally {
        // Runs on both success and error. Without this, a thrown error would leave
        // stopPromise pointing at a rejected promise forever. Since there's no catch,
        // errors still propagate normally to any caller awaiting this promise.
        this.stopPromise = null;
      }
    })();

    return this.stopPromise;
  }

  public async onShutdownForce(): Promise<void> {
    // Force-close open connections so server.stop() can finish draining and resolve.
    // The outer ?. handles server not yet assigned (e.g. start() failed) — the inner ?.
    // handles runtimes that don't expose closeAllConnections.
    this.server?.closeAllConnections?.();

    // Join the original stop() — won't start a second close.
    await this.stop();
  }

  // Exposes this component's health status. LifecycleManager uses this internally
  // when checking the overall system health (e.g., printed on SIGUSR1 or exposed
  // via a dedicated health router). If the server is not started yet or has stopped,
  // this naturally returns unhealthy.
  //
  // Production tip: For orchestrators (Kubernetes, ECS, etc.), you can either probe
  // a route on the main port (like the GET /health endpoint below) or run a dedicated
  // internal health check server on a separate port (e.g., 9000) that returns HTTP 200/503
  // based on this healthCheck() result to avoid exposing orchestrator traffic on the main port.
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
        ? \`Listening on port \${${portEnvVarName}}\`
        : 'Server is not listening',
    };
  }

  private scheduleMidnightUpdate() {
    const now = new Date();

    // Schedule the next tick at local midnight so current_year rolls over in real time.
    const midnight = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + 1,
    );
    const msUntilMidnight = midnight.getTime() - now.getTime();

    this.midnightTimer = setTimeout(() => {
      this.siteInfo.current_year = new Date().getFullYear();
      this.scheduleMidnightUpdate();
    }, msUntilMidnight);
  }

  private registerRoutes(server: SSRServer) {
    // Register page data loader handlers and API routes here.
    //
    // Page data loaders (omit version to default to v1, or pass a number for v2+):
    // server.pageDataHandler.register('example', async (request, _reply, params) => {
    //   return params.APIResponseHelpers.createPageSuccessResponse({ request, data: { ... }, pageMetadata: { title: '' } });
    // }); // → POST /api/v1/page_data/example
    // server.pageDataHandler.register('example', 2, async (request, reply, params) => { ... }); // → POST /api/v2/page_data/example
    //
    // API routes (omit version to default to v1, or pass a number for v2+):
    // server.api.get('health', async (request, _reply, params) => {
    //   return params.APIResponseHelpers.createAPISuccessResponse({ request, data: { ok: true } });
    // }); // → GET /api/v1/health
    // server.api.get('health', 2, async (request, _reply, params) => { ... }); // → GET /api/v2/health

    // ─── API routes (via server.api.* shortcuts) ─────────────────────────────

    // GET /api/v1/health
    // Production tip: In a real application, you can also inject the LifecycleManager
    // instance and check/poll the status of other components (e.g., database, cache)
    // via manager.checkAllHealth() to determine the overall SSR service health.
    // See: https://github.com/keverw/lifecycleion/blob/master/docs/lifecycle-manager.md
    server.api.get('health', (request, _reply, params) => {
      return params.APIResponseHelpers.createAPISuccessResponse({
        request,
        data: {
          healthy: true,
          timestamp: new Date().toISOString(),
          build: request.publicAppConfig?.build,
        },
        statusCode: 200,
      });
    });

    // ─── Page data handlers ───────────────────────────────────────────────────

    server.pageDataHandler.register('home', (request, _reply, params) => {
      return params.APIResponseHelpers.createPageSuccessResponse({
        request,
        data: {
          serverLine: \`Home page data loader ran at \${new Date().toISOString()}\`,
        },
        pageMetadata: {
          title: 'Home - Unirend SSR Demo',
          description: 'Welcome to the Unirend SSR demo homepage',
        },
      });
    });

    server.pageDataHandler.register('about', (request, _reply, params) => {
      return params.APIResponseHelpers.createPageSuccessResponse({
        request,
        data: {
          serverLine: \`About page data loader ran at \${new Date().toISOString()}\`,
        },
        pageMetadata: {
          title: 'About - Unirend SSR Demo',
          description: 'About the Unirend SSR demo',
        },
      });
    });

    if (ENABLE_TEST_ROUTES) {
      // Demo route 1: the server handler throws.
      // Unirend converts it into an internal 500 page envelope.
      server.pageDataHandler.register(
        'simulate-dataloader-500-error',
        (_request, _reply, _params) => {
          throw new Error('Simulated data loader throw error');
        },
      );

      // Demo route 2: the server handler returns an explicit 500 page envelope without throwing.
      server.pageDataHandler.register(
        'simulate-dataloader-500-status',
        (request, _reply, params) => {
          return params.APIResponseHelpers.createPageErrorResponse({
            request,
            statusCode: 500,
            errorCode: 'internal_server_error',
            errorMessage: 'Simulated data loader 500 response.',
            errorDetails: {
              reason: 'demo_explicit_500_path',
              stack:
                'Error: Simulated data loader 500 response\\n' +
                '    at simulateDataloader500Handler (ssr-component.ts:1:1)\\n' +
                '    at renderPageData (unirend/server:mock:1:1)',
            },
            pageMetadata: {
              title: '500 - Returned Error Envelope',
              description: 'A demo data loader returned a 500 page envelope.',
            },
          });
        },
      );

      // Demo route 3: the server handler returns an explicit 503 page envelope.
      server.pageDataHandler.register(
        'simulate-dataloader-503-status',
        (request, _reply, params) => {
          return params.APIResponseHelpers.createPageErrorResponse({
            request,
            statusCode: 503,
            errorCode: 'service_unavailable',
            errorMessage: 'Simulated data loader 503 response.',
            errorDetails: {
              reason: 'demo_status_code_path',
            },
            pageMetadata: {
              title: '503 - Service Unavailable',
              description: 'A demo data loader returned a 503 page envelope.',
            },
          });
        },
      );
    }

    // Wildcard 404 handler — used by the catch-all route in routes.tsx to return a
    // consistent 404 envelope. See the wildcard route comment in routes.tsx for more context.
    server.pageDataHandler.register('not-found', (request, _reply, params) => {
      return params.APIResponseHelpers.createPageErrorResponse({
        request,
        statusCode: 404,
        errorCode: 'not_found',
        errorMessage: 'The page you are looking for does not exist.',
        pageMetadata: {
          title: '404 - Page Not Found',
          description: 'The page you are looking for does not exist.',
        },
      });
    });
  }
}
`;
}

/**
 * Ensure an SSR app's `server/ssr-component.ts` exists at
 * `${projectPath}/server/ssr-component.ts`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param appName - The app/project name, used to derive env var names and build path
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSRComponent(
  root: FileRoot,
  projectPath: string,
  appName: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/server/ssr-component.ts`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      buildSSRComponentSrc(appName),
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}

import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';
import { buildAppEnvVarName } from '../../internal-utils';

/**
 * Build the source for an SSG app's `serve.ts` — the static file server entry
 * point that serves pre-built SSG output via Unirend's StaticWebServer under a
 * Lifecycleion LifecycleManager.
 *
 * Per the lifecycle naming rule, the LifecycleManager name incorporates the app
 * name (`${appName}-ssg-serve`) while the registered component keeps its generic
 * `static-web-server` name. The build directory (`build/${appName}/client`) and
 * port env var (e.g. `MY_APP_PORT`) are also derived from `appName`.
 *
 * @param appName - The app/project name to fold into the manager name, build
 *   path, and port env var
 */
function buildSSGServeSrc(appName: string): string {
  const portEnvVarName = buildAppEnvVarName(appName, 'PORT');
  const managerName = `${appName}-ssg-serve`;

  return `/**
 * Static file server for SSG-generated sites.
 * Uses unirend's StaticWebServer with Lifecycleion for lifecycle management and logging.
 *
 * Signals:
 *   SIGHUP / R key        — reload page map and flush file caches (no restart)
 *   SIGINT / Ctrl+C / ESC — graceful shutdown
 *   SIGUSR1 / I key       — print component health
 *   SIGUSR2 / D key       — print server statistics
 */

import {
  StaticWebServer,
  UnirendLifecycleionLoggerAdaptor,
} from 'unirend/server';
import { assertSupportedRuntime } from 'unirend/utils';
import {
  LifecycleManager,
  BaseComponent,
} from 'lifecycleion/lifecycle-manager';
import { initDevMode, getDevMode } from 'lifecycleion/dev-mode';
import { Logger, ConsoleSink, LogLevel } from 'lifecycleion/logger';
import path from 'path';
import { PUBLIC_FILES, PUBLIC_FOLDERS } from './consts';

const BUILD_DIR = path.resolve(__dirname, '../../../build/${appName}/client');
// Read port from ${portEnvVarName} env var, default 3000.
// Production HTTPS: use a reverse proxy (nginx, Caddy, etc.) for TLS termination,
// or see https://github.com/keverw/unirend/blob/master/docs/https.md to handle it in code.
// If using serveRedirect(), set its targetPort to ${portEnvVarName} and use a separate
// HTTP_REDIRECT_PORT env var with a default. Then run both servers in the same
// component in parallel, or add a dedicated redirect component.
const PORT = parseInt(process.env['${portEnvVarName}'] ?? '3000', 10);

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

// ─── StaticWebServer component ───────────────────────────────────────────────

class StaticWebServerComponent extends BaseComponent {
  private server: StaticWebServer | null = null;
  private startPromise: Promise<void> | null = null;
  // Stored so concurrent callers (e.g. onShutdownForce) join the same
  // in-flight promise rather than starting a second concurrent close.
  private stopPromise: Promise<void> | null = null;

  constructor() {
    super(logger, {
      name: 'static-web-server',
      // 10s graceful: static file serving requests complete in milliseconds, so this
      // is generous. No WebSocket connections or long-lived sessions to drain.
      shutdownGracefulTimeoutMS: 10_000,
      // 5s force: after closeAllConnections() kicks in, stop() should resolve almost
      // immediately — this is just a safety net for anything that still hangs.
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
        this.server = new StaticWebServer({
          buildDir: BUILD_DIR,
          pageMapPath: 'page-map.json',
          // public/ files and subfolders (declared in consts.ts), mapped from
          // URL to path relative to BUILD_DIR — public/ content keeps its
          // name, so each entry doubles as both. The server normalizes both
          // sides itself (URL keys get a leading slash and collapsed
          // slashes, paths resolve relative to BUILD_DIR either way), so
          // only whitespace is trimmed here, matching the SSR server and
          // the check:public-assets script, which trim too.
          singleAssets: Object.fromEntries(
            PUBLIC_FILES.map((urlPath) => {
              const entry = urlPath.trim();
              return [entry, entry];
            }),
          ),
          // Immutable-asset detection defaults per folder, like the SSR server:
          // on for /assets (Vite's hashed output folder), off for public folders
          // (verbatim copies, not fingerprinted). Pass a per-folder
          // { path, detectImmutableAssets } object to override.
          assetFolders: {
            '/assets': 'assets',
            ...Object.fromEntries(
              PUBLIC_FOLDERS.map((urlPrefix) => {
                const entry = urlPrefix.trim();
                return [entry, entry];
              }),
            ),
          },
          // This level controls the adapter's gate — what Fastify passes to the Lifecycleion
          // logger. Set to 'debug' so everything gets through and the ConsoleSink's minLevel
          // does the real filtering in one place. 'trace' gives even more verbose Fastify
          // output but is treated as debug on the Lifecycleion logger side since there is no trace level.
          logging: {
            logger: UnirendLifecycleionLoggerAdaptor(this.logger),
            level: 'debug' as const,
          },
        });

        await this.server.listen(PORT, '0.0.0.0');

        this.logger.success(
          'Static server running at http://localhost:{{port}}',
          {
            params: { port: PORT },
          },
        );

        this.logger.info('Serving files from: {{dir}}', {
          params: { dir: BUILD_DIR },
        });

        this.logger.info('Press R or send SIGHUP to reload without restarting');
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
        // stopPromise pointing at a rejected promise forever. Since there's no catch,
        // errors still propagate normally to any caller awaiting this promise.
        this.stopPromise = null;
      }
    })();

    return this.stopPromise;
  }

  public async onShutdownForce(): Promise<void> {
    // Force-close open connections so server.stop() can finish draining and resolve.
    // The outer ?. handles server not yet assigned (e.g. start() failed); the inner ?.
    // handles runtimes that don't expose closeAllConnections.
    this.server?.closeAllConnections?.();

    // Join the original stop() — won't start a second close.
    await this.stop();
  }

  public async onReload() {
    if (!this.server?.isListening()) {
      this.logger.warn('Reload skipped — server is not running');
      return;
    }

    await this.server.reload();
    this.logger.success('Reloaded — page map and file caches refreshed');
  }

  public onDebug() {
    const stats = this.server?.getStats();

    if (!stats) {
      this.logger.warn('Stats unavailable — server is not listening');
      return;
    }

    const fmtBytes = (b: number) =>
      b >= 1_048_576
        ? \`\${(b / 1_048_576).toFixed(1)} MB\`
        : b >= 1024
          ? \`\${(b / 1024).toFixed(1)} KB\`
          : \`\${b} B\`;

    this.logger.info(
      'Stats — {{routeCount}} routes, etag: {{etagItems}} items ({{etagSize}}), content: {{contentItems}} items ({{contentSize}}), stat: {{statItems}} items ({{statSize}})',
      {
        params: {
          routeCount: stats.routeCount,
          etagItems: stats.etag.items,
          etagSize: fmtBytes(stats.etag.byteSize),
          contentItems: stats.content.items,
          contentSize: fmtBytes(stats.content.byteSize),
          statItems: stats.stat.items,
          statSize: fmtBytes(stats.stat.byteSize),
        },
      },
    );
  }

  // Exposes this component's health status. LifecycleManager uses this internally
  // when checking the overall system health (e.g., printed on SIGUSR1 or exposed
  // via a dedicated health router). If the server is not started yet or has stopped,
  // this naturally returns unhealthy.
  //
  // Production tip: For orchestrators (Kubernetes, ECS, etc.), you can either probe
  // a route on the main port (like a custom health route) or run a dedicated
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
        ? \`Listening on port \${PORT}\`
        : 'Server is not listening',
    };
  }
}

// ─── Lifecycle manager ───────────────────────────────────────────────────────

async function main() {
  const manager = new LifecycleManager({
    name: '${managerName}',
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

  // Register the static web server component
  await manager.registerComponent(new StaticWebServerComponent());

  // Start all components
  await manager.startAllComponents();
}

main().catch((error) => {
  // Use exitCode so the logger flushes the sink before the process exits
  logger.error('Failed to start server: {{error}}', {
    params: { error },
    exitCode: 1,
  });
});
`;
}

/**
 * Emit the SSG template's `serve.ts` static file server entry point
 * (create-if-missing).
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param appName - The app/project name, folded into the LifecycleManager name,
 *   build path, and port env var
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSGServe(
  root: FileRoot,
  projectPath: string,
  appName: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/serve.ts`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      buildSSGServeSrc(appName),
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}

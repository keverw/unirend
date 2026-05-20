/**
 * Static file server for SSG-generated sites.
 * Uses unirend's StaticWebServer with Lifecycleion for lifecycle management and logging.
 *
 * Signals:
 *   SIGHUP / R key        — reload page map and flush file caches (no restart)
 *   SIGINT / Ctrl+C / ESC — graceful shutdown
 *   SIGUSR1 / I key       — print component health
 *   SIGUSR2 / D key       — print server statistics
 */

import { StaticWebServer } from '../../src/lib/internal/static-web-server';
import { UnirendLifecycleionLoggerAdaptor } from '../../src/server';
import { assertSupportedRuntime } from '../../src/utils';
import {
  LifecycleManager,
  BaseComponent,
} from 'lifecycleion/lifecycle-manager';
import { initDevMode, getDevMode } from 'lifecycleion/dev-mode';
import { Logger, ConsoleSink, LogLevel } from 'lifecycleion/logger';
import path from 'path';

const BUILD_DIR = path.resolve(__dirname, 'build/client');
const PORT = 3000;

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

  public async start() {
    this.server = new StaticWebServer({
      buildDir: BUILD_DIR,
      pageMapPath: 'page-map.json',
      singleAssets: {
        '/robots.txt': 'robots.txt',
        '/favicon.ico': 'favicon.ico',
      },
      assetFolders: {
        '/assets': 'assets',
      },
      detectImmutableAssets: true,
      // This level controls the adapter's gate — what Fastify passes to the Lifecycleion
      // logger. Set to 'debug' so everything gets through and the ConsoleSink's minLevel
      // does the real filtering in one place.
      logging: {
        logger: UnirendLifecycleionLoggerAdaptor(this.logger),
        level: 'debug' as const,
      },
    });

    await this.server.listen(PORT, '0.0.0.0');

    this.logger.success('Static server running at http://localhost:{{port}}', {
      params: { port: PORT },
    });

    this.logger.info('Serving files from: {{dir}}', {
      params: { dir: BUILD_DIR },
    });

    this.logger.info('Press R or send SIGHUP to reload without restarting');
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
        if (this.server?.isListening()) {
          await this.server.stop();
        }
      } finally {
        // Runs on both success and error. Without this, a thrown error would leave
        // stopPromise pointing at a rejected promise forever. Since there's no catch,
        // errors still propagate normally to any caller awaiting this promise.
        this.server = null;
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
        ? `${(b / 1_048_576).toFixed(1)} MB`
        : b >= 1024
          ? `${(b / 1024).toFixed(1)} KB`
          : `${b} B`;

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

  public healthCheck() {
    const isHealthy = this.server?.isListening() ?? false;

    return {
      healthy: isHealthy,
      message: isHealthy
        ? `Listening on port ${PORT}`
        : 'Server is not listening',
    };
  }

  // Production tip: for container orchestrators (Kubernetes, ECS, etc.) expose
  // a dedicated health check endpoint on a separate port (e.g. 9000) that
  // returns HTTP 200/503 based on healthCheck(). This lets the orchestrator
  // probe liveness/readiness without touching the main serving port.
}

// ─── Lifecycle manager ───────────────────────────────────────────────────────

async function main() {
  const manager = new LifecycleManager({
    name: 'ssg-server',
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

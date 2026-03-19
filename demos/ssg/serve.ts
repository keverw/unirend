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
import {
  UnirendLifecycleionLoggerAdaptor,
  initDevMode,
} from '../../src/server';
import {
  LifecycleManager,
  BaseComponent,
} from 'lifecycleion/lifecycle-manager';
import { Logger, ConsoleSink } from 'lifecycleion/logger';
import path from 'path';

const BUILD_DIR = path.resolve(__dirname, 'build/client');
const PORT = 3000;

initDevMode({ detect: 'cmd', strict: true });

// ─── Logger ──────────────────────────────────────────────────────────────────

const logger = new Logger({
  sinks: [new ConsoleSink({ colors: true, timestamps: true })],
});

// ─── StaticWebServer component ───────────────────────────────────────────────

class StaticWebServerComponent extends BaseComponent {
  private server: StaticWebServer;

  constructor() {
    super(logger, { name: 'static-web-server' });

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
      logging: {
        logger: UnirendLifecycleionLoggerAdaptor(this.logger),
      },
    });
  }

  async start() {
    await this.server.listen(PORT, '0.0.0.0');

    this.logger.success('Static server running at http://localhost:{{port}}', {
      params: { port: PORT },
    });

    this.logger.info('Serving files from: {{dir}}', {
      params: { dir: BUILD_DIR },
    });

    this.logger.info('Press R or send SIGHUP to reload without restarting');
  }

  async stop() {
    if (this.server.isListening()) {
      await this.server.stop();
    }
  }

  async onReload() {
    await this.server.reload();
    this.logger.success('Reloaded — page map and file caches refreshed');
  }

  async onDebug() {
    const stats = this.server.getStats();

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

  async healthCheck() {
    const healthy = this.server.isListening();

    return {
      healthy,
      message: healthy
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
    onInfoRequested: async () => {
      const report = await manager.checkAllHealth();

      for (const { name, healthy, message } of report.components) {
        const msg = message ?? (healthy ? 'healthy' : 'unhealthy');

        if (healthy) {
          logger.success('[{{name}}] {{msg}}', { params: { name, msg } });
        } else {
          logger.warn('[{{name}}] {{msg}}', { params: { name, msg } });
        }
      }
    },
  });

  manager.registerComponent(new StaticWebServerComponent());

  await manager.startAllComponents();
}

main().catch((error) => {
  // Use exitCode so the logger flushes the sink before the process exits
  logger.error('Failed to start server: {{error}}', {
    params: { error },
    exitCode: 1,
  });
});

/**
 * SSR + WebSocket Chat Demo
 *
 * A single-page SSR app served with Vite HMR that also hosts an application
 * WebSocket (an echo endpoint powering the in-page chat). It demonstrates that
 * HMR and your own WebSocket handlers coexist on one port: the HMR socket and
 * `/ws/echo` both run on the main HTTP server.
 *
 * Run with: bun run ssr-ws-chat:serve:dev
 * Then open http://localhost:3005, chat in the box, and edit
 * components/EditMeBanner.tsx to watch it hot-reload while the chat WebSocket
 * (owned by a separate module) stays connected.
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
import { assertSupportedRuntime } from '../../src/utils';
import { serveSSRWithHMR } from '../../src/server';
import type { SSRServer } from '../../src/server';
import type { RawData } from 'ws';
import path from 'path';

const PORT = 3005;
const HOST = '0.0.0.0';

// Source directory for the Vite app (this file's own directory).
const SRC_DIR = import.meta.dirname;

// ─── Bootstrap ───────────────────────────────────────────────────────────────
assertSupportedRuntime();
initDevMode({ detect: 'cmd', strict: true });

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function webSocketMessageToString(message: RawData): string {
  if (typeof message === 'string') {
    return message;
  }

  if (Buffer.isBuffer(message)) {
    return message.toString();
  }

  if (message instanceof ArrayBuffer) {
    return Buffer.from(message).toString();
  }

  return Buffer.concat(message).toString();
}

/**
 * Register the echo WebSocket handler that powers the in-page chat. Every
 * message received is echoed straight back as an `echo` frame.
 */
function registerEchoHandler(server: SSRServer): void {
  server.registerWebSocketHandler({
    path: '/ws/echo',
    handler: (socket) => {
      socket.send(
        JSON.stringify({
          type: 'welcome',
          message: 'Connected — anything you send is echoed back.',
          timestamp: new Date().toISOString(),
        }),
      );

      socket.on('message', (message) => {
        socket.send(
          JSON.stringify({
            type: 'echo',
            original: webSocketMessageToString(message),
            timestamp: new Date().toISOString(),
          }),
        );
      });
    },
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

class SSRWebSocketChatComponent extends BaseComponent {
  private server: SSRServer | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(parentLogger: Logger) {
    super(parentLogger, {
      name: 'ssr-ws-chat',
      shutdownGracefulTimeoutMS: 30_000,
      shutdownForceTimeoutMS: 5_000,
    });
  }

  public async start(): Promise<void> {
    if (this.stopPromise) {
      throw new Error('Cannot start server while shutdown is in progress');
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      try {
        this.server = serveSSRWithHMR(
          {
            serverEntry: path.join(SRC_DIR, 'EntrySSR.tsx'),
            template: path.join(SRC_DIR, 'index.html'),
            viteConfig: path.join(SRC_DIR, 'vite.config.ts'),
          },
          {
            enableWebSockets: true,
          },
        );

        registerEchoHandler(this.server);

        await this.server.listen(PORT, HOST);

        this.logger.success(
          'SSR + WebSocket chat demo running at http://localhost:{{port}}',
          { params: { port: PORT } },
        );
        this.logger.info(
          'Edit components/EditMeBanner.tsx to see HMR; chat uses /ws/echo',
        );
      } catch (error) {
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
        if (this.startPromise) {
          try {
            await this.startPromise;
          } catch {
            // Ignore start errors since we are stopping anyway
          }
        }

        const server = this.server;
        if (server?.isListening()) {
          await server.stop();
        }

        this.server = null;
        this.startPromise = null;
      } finally {
        this.stopPromise = null;
      }
    })();

    return this.stopPromise;
  }

  public async onShutdownForce(): Promise<void> {
    this.server?.closeAllConnections();
    await this.stop();
  }

  public healthCheck() {
    if (!this.server) {
      return { healthy: false, message: 'Server is not started' };
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

// ─── Lifecycle ────────────────────────────────────────────────────────────────

const manager = new LifecycleManager({
  name: 'ssr-ws-chat-demo',
  logger,
  attachSignalsBeforeStartup: true,
  detachSignalsOnStop: true,
  enableLoggerExitHook: true,
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

async function main() {
  try {
    await manager.registerComponent(new SSRWebSocketChatComponent(logger));
    await manager.startAllComponents();
  } catch (error) {
    logger.error('Failed to start SSR + WebSocket chat demo: {{error}}', {
      params: { error },
      exitCode: 1,
    });
  }
}

void main();

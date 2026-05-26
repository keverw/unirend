/**
 * WebSocket Server Demo
 *
 * This demo shows how to use unirend's WebSocket functionality with both
 * SSR and API server configurations. It demonstrates different validation
 * scenarios including always-allow, always-reject, and token-based validation.
 *
 * Run with: bun run ws-demo
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
import { serveSSRDev, serveAPI } from '../src/server';
import type { SSRServer, APIServer, APIRouteHandler } from '../src/server';
import { APIResponseHelpers } from '../src/api-envelope';
import type { RawData, WebSocket } from 'ws';
import path from 'path';

const PORT_SSR = 3001;
const PORT_API = 3002;
const SSR_DEMO_DIR = path.join(import.meta.dirname, 'ssr');

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
 * Helper function to create /stats endpoint handler
 */
function createStatsEndpointHandler(
  server: SSRServer | APIServer,
  serverName: string,
  port: number,
) {
  const handler: APIRouteHandler = (request, _reply) => {
    const clientCount = server?.getWebSocketClients().size ?? 0;

    // eslint-disable-next-line no-console
    console.log(
      `📊 Stats requested: ${clientCount} WebSocket clients connected`,
    );

    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: {
        websocketClients: clientCount,
        timestamp: new Date().toISOString(),
        server: `${serverName} (port ${port})`,
      },
      meta: {
        page: {
          title: 'WebSocket Statistics',
          description: 'Current WebSocket connection statistics',
        },
      },
    });
  };

  return handler;
}

/**
 * Helper function to create a preClose hook handler for graceful WebSocket shutdown.
 * Closes all connected clients with a 1001 Going Away code and waits briefly for
 * them to acknowledge before the server proceeds with shutdown.
 */
function createPreCloseHandler(
  serverName: string,
  componentLogger: Pick<Logger, 'info'>,
) {
  return async (clients: Set<unknown>) => {
    componentLogger.info(
      '{{serverName}} preClose hook: closing {{count}} WebSocket clients',
      { params: { serverName, count: clients.size } },
    );

    for (const client of clients) {
      (client as WebSocket).close(
        1001,
        `${serverName} shutting down gracefully`,
      );
    }

    // Wait a moment for connections to close
    await new Promise((resolve) => setTimeout(resolve, 500));
  };
}

/**
 * Reusable function to register WebSocket handlers on any server instance.
 * This allows the same WebSocket endpoints to be demonstrated on both SSR and API servers.
 */
function registerWebSocketHandlers(server: SSRServer | APIServer) {
  // Path 1: Always allow upgrade
  server.registerWebSocketHandler({
    path: '/ws/always-allow',
    handler: (socket, _request, params, upgradeData) => {
      // eslint-disable-next-line no-console
      console.log('✅ WebSocket connected to /ws/always-allow');
      // eslint-disable-next-line no-console
      console.log('Params:', params);
      // eslint-disable-next-line no-console
      console.log('Upgrade data:', upgradeData);

      socket.send(
        JSON.stringify({
          type: 'welcome',
          message: 'Connected to always-allow endpoint!',
          timestamp: new Date().toISOString(),
        }),
      );

      socket.on('message', (message) => {
        const messageText = webSocketMessageToString(message);
        // eslint-disable-next-line no-console
        console.log('Received message:', messageText);
        socket.send(
          JSON.stringify({
            type: 'echo',
            original: messageText,
            timestamp: new Date().toISOString(),
          }),
        );
      });

      socket.on('close', () => {
        // eslint-disable-next-line no-console
        console.log('❌ WebSocket disconnected from /ws/always-allow');
      });
    },
  });

  // Path 2: Always reject upgrade
  server.registerWebSocketHandler({
    path: '/ws/always-reject',
    preValidate: (request, params) => {
      // eslint-disable-next-line no-console
      console.log('🚫 Rejecting WebSocket at path:', params.path);
      return {
        action: 'reject',
        envelope: params.APIResponseHelpers.createAPIErrorResponse({
          request,
          statusCode: 403,
          errorCode: 'websocket_always_rejected',
          errorMessage: 'This WebSocket endpoint always rejects connections',
          meta: {
            page: {
              title: 'WebSocket Rejected',
              description:
                'This endpoint is configured to always reject WebSocket connections',
            },
          },
        }),
      };
    },
    handler: (socket, _request, params) => {
      // This handler should never be called due to preValidation rejection
      // eslint-disable-next-line no-console
      console.log(
        '🚨 ERROR: Handler called for always-reject endpoint!',
        params,
      );
      socket.close(1008, 'Should not reach this handler');
    },
  });

  // Path 3: Token-based validation
  server.registerWebSocketHandler({
    path: '/ws/token-validation',
    preValidate: (request, params) => {
      const shouldUpgrade = (params.queryParams['should-upgrade'] ||
        '') as string;

      if (shouldUpgrade === 'yes') {
        return {
          action: 'upgrade',
          data: {
            validated: true,
            token: shouldUpgrade,
            validatedAt: new Date().toISOString(),
          },
        };
      } else {
        return {
          action: 'reject',
          envelope: params.APIResponseHelpers.createAPIErrorResponse({
            request,
            statusCode: 401,
            errorCode: 'websocket_invalid_token',
            errorMessage: `Invalid or missing token. Use ?should-upgrade=yes to connect.`,
            errorDetails: {
              providedToken: shouldUpgrade,
              expectedToken: 'yes',
            },
            meta: {
              page: {
                title: 'WebSocket Authentication Failed',
                description: 'Valid token required for WebSocket connection',
              },
            },
          }),
        };
      }
    },
    handler: (socket, _request, params, upgradeData) => {
      // eslint-disable-next-line no-console
      console.log('🔐 WebSocket connected to /ws/token-validation');
      // eslint-disable-next-line no-console
      console.log('Params:', params);
      // eslint-disable-next-line no-console
      console.log('Validated upgrade data:', upgradeData);

      socket.send(
        JSON.stringify({
          type: 'authenticated',
          message: 'Successfully authenticated WebSocket connection!',
          upgradeData,
          timestamp: new Date().toISOString(),
        }),
      );

      socket.on('message', (message) => {
        const messageText = webSocketMessageToString(message);
        // eslint-disable-next-line no-console
        console.log('Authenticated message:', messageText);
        socket.send(
          JSON.stringify({
            type: 'secure-echo',
            original: messageText,
            authenticated: true,
            timestamp: new Date().toISOString(),
          }),
        );
      });

      socket.on('close', () => {
        // eslint-disable-next-line no-console
        console.log('❌ Authenticated WebSocket disconnected');
      });
    },
  });

  // Path 4: Echo with query parameter message
  server.registerWebSocketHandler({
    path: '/ws/echo',
    preValidate: (_request, params) => {
      const message = (params.queryParams['msg'] || '') as string;

      return {
        action: 'upgrade',
        data: {
          initialMessage: message,
          connectedAt: new Date().toISOString(),
        },
      };
    },
    handler: (socket, _request, params, upgradeData) => {
      // eslint-disable-next-line no-console
      console.log('📢 WebSocket connected to /ws/echo');
      // eslint-disable-next-line no-console
      console.log('Params:', params);
      // eslint-disable-next-line no-console
      console.log('Echo upgrade data:', upgradeData);

      // Send the initial message from query parameter if provided
      if (upgradeData?.initialMessage) {
        socket.send(
          JSON.stringify({
            type: 'initial-echo',
            message: upgradeData.initialMessage,
            source: 'query-parameter',
            timestamp: new Date().toISOString(),
          }),
        );
      }

      // Send welcome message
      socket.send(
        JSON.stringify({
          type: 'welcome',
          message:
            'Connected to echo endpoint! Send any message and it will be echoed back.',
          upgradeData,
          timestamp: new Date().toISOString(),
        }),
      );

      socket.on('message', (message) => {
        const messageText = webSocketMessageToString(message);
        // eslint-disable-next-line no-console
        console.log('Echo message:', messageText);
        socket.send(
          JSON.stringify({
            type: 'echo',
            original: messageText,
            timestamp: new Date().toISOString(),
          }),
        );
      });

      socket.on('close', () => {
        // eslint-disable-next-line no-console
        console.log('❌ Echo WebSocket disconnected');
      });
    },
  });
}

// ─── SSRWebSocketDemoComponent ────────────────────────────────────────────────

class SSRWebSocketDemoComponent extends BaseComponent {
  private server: SSRServer | null = null;
  private startPromise: Promise<void> | null = null;
  // Stored so concurrent callers (e.g. onShutdownForce) join the same
  // in-flight promise rather than starting a second concurrent close.
  private stopPromise: Promise<void> | null = null;

  constructor(parentLogger: Logger) {
    super(parentLogger, {
      name: 'ssr-ws-server',
      // 30s graceful: gives time to drain in-flight requests and active WebSocket connections.
      shutdownGracefulTimeoutMS: 30_000,
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
        // Start SSR server with WebSocket support on the SSR demo port.
        this.server = serveSSRDev(
          {
            serverEntry: path.join(SSR_DEMO_DIR, 'EntrySSR.tsx'),
            template: path.join(SSR_DEMO_DIR, 'index.html'),
            viteConfig: path.join(SSR_DEMO_DIR, 'vite.config.ts'),
          },
          {
            fastifyOptions: {
              logger: true,
            },
            enableWebSockets: true,
            webSocketOptions: {
              preClose: createPreCloseHandler('SSR Server', this.logger),
            },
            apiEndpoints: {
              apiEndpointPrefix: '/api',
              versioned: false,
            },
          },
        );

        // Register the reusable WebSocket handlers on the SSR server.
        registerWebSocketHandlers(this.server);

        // Register /stats endpoint on the SSR server.
        this.server.api.get(
          '/stats',
          createStatsEndpointHandler(this.server, 'SSR Server', PORT_SSR),
        );

        // Start listening after all handlers and API routes are registered.
        await this.server.listen(PORT_SSR, '0.0.0.0');

        this.logger.success(
          'SSR WebSocket server running at http://localhost:{{port}}',
          {
            params: { port: PORT_SSR },
          },
        );
        this.logger.info('WebSocket endpoints:');
        this.logger.info('  ws://localhost:3001/ws/always-allow');
        this.logger.info('  ws://localhost:3001/ws/always-reject');
        this.logger.info(
          '  ws://localhost:3001/ws/token-validation?should-upgrade=yes',
        );
        this.logger.info('  ws://localhost:3001/ws/echo?msg=Hello');
        this.logger.info('Stats: GET http://localhost:3001/api/stats');
        this.logger.info(
          'Test with wscat: wscat -c "ws://localhost:3001/ws/always-allow"',
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
    // This is the LifecycleManager replacement for the old manual signal handler.
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
        ? `Listening on port ${PORT_SSR}`
        : 'Server is not listening',
    };
  }
}

// ─── APIWebSocketDemoComponent ────────────────────────────────────────────────

class APIWebSocketDemoComponent extends BaseComponent {
  private server: APIServer | null = null;
  private startPromise: Promise<void> | null = null;
  // Stored so concurrent callers (e.g. onShutdownForce) join the same
  // in-flight promise rather than starting a second concurrent close.
  private stopPromise: Promise<void> | null = null;

  constructor(parentLogger: Logger) {
    super(parentLogger, {
      name: 'api-ws-server',
      // 30s graceful: gives time to drain in-flight requests and active WebSocket connections.
      shutdownGracefulTimeoutMS: 30_000,
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
        // Start API server with WebSocket support on the API demo port.
        this.server = serveAPI({
          fastifyOptions: {
            logger: true,
          },
          enableWebSockets: true,
          webSocketOptions: {
            preClose: createPreCloseHandler('API Server', this.logger),
          },
          apiEndpoints: {
            apiEndpointPrefix: '/api',
            versioned: false,
          },
        });

        // Register the reusable WebSocket handlers on the API server.
        registerWebSocketHandlers(this.server);

        // Register /stats endpoint on the API server.
        this.server.api.get(
          '/stats',
          createStatsEndpointHandler(this.server, 'API Server', PORT_API),
        );

        // Start listening after all handlers and API routes are registered.
        await this.server.listen(PORT_API, '0.0.0.0');

        this.logger.success(
          'API WebSocket server running at http://localhost:{{port}}',
          {
            params: { port: PORT_API },
          },
        );
        this.logger.info('WebSocket endpoints:');
        this.logger.info('  ws://localhost:3002/ws/always-allow');
        this.logger.info('  ws://localhost:3002/ws/always-reject');
        this.logger.info(
          '  ws://localhost:3002/ws/token-validation?should-upgrade=yes',
        );
        this.logger.info('  ws://localhost:3002/ws/echo?msg=Hello');
        this.logger.info('Stats: GET http://localhost:3002/api/stats');
        this.logger.info(
          'Test with wscat: wscat -c "ws://localhost:3002/ws/always-allow"',
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
    // This is the LifecycleManager replacement for the old manual signal handler.
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
        ? `Listening on port ${PORT_API}`
        : 'Server is not listening',
    };
  }
}

// ─── Lifecycle manager ───────────────────────────────────────────────────────

async function main() {
  const manager = new LifecycleManager({
    name: 'ws-demo',
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

  // Register the WebSocket demo components.
  // To add a database or other services, register additional components here
  // before startAllComponents — they start in order, so infrastructure (DB, cache, etc.)
  // comes up before the WebSocket servers that use it.
  await manager.registerComponent(new SSRWebSocketDemoComponent(logger));
  await manager.registerComponent(new APIWebSocketDemoComponent(logger));

  // Start all components
  await manager.startAllComponents();
}

main().catch((error) => {
  logger.error('Failed to start servers: {{error}}', {
    params: { error },
    exitCode: 1,
  });
});

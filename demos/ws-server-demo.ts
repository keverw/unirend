/**
 * WebSocket Server Demo
 *
 * This demo shows how to use unirend's WebSocket functionality with both
 * SSR and API server configurations. It demonstrates different validation
 * scenarios including always-allow, always-reject, and token-based validation.
 */

import { serveSSRDev, serveAPI } from '../src/server';
import type { SSRServer, APIServer } from '../src/server';
import { APIResponseHelpers } from '../src/api-envelope';

/**
 * Helper function to create /stats endpoint handler
 */
function createStatsEndpointHandler(
  server: SSRServer | APIServer,
  serverName: string,
  port: number,
) {
  return async (request, reply) => {
    const clientCount = server?.getWebSocketClients().size ?? 0;

    console.log(
      `📊 Stats requested: ${clientCount} WebSocket clients connected`,
    );

    return APIResponseHelpers.createAPISuccessResponse({
      request: request,
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
}

/**
 * Helper function to create preClose hook handler
 */
function createPreCloseHandler(serverType: 'ssr' | 'api', serverName: string) {
  return async (clients: Set<any>) => {
    console.log(
      `🔄 ${serverName} preClose hook called with ${clients.size} clients`,
    );

    preCloseHookStatus[serverType] = true;

    // Gracefully close all WebSocket connections
    for (const client of clients) {
      (
        client as unknown as {
          close: (code: number, reason: string) => void;
        }
      ).close(1001, `${serverName} shutting down gracefully`);
    }

    // Wait a moment for connections to close
    await new Promise((resolve) => setTimeout(resolve, 500));
  };
}

/**
 * Reusable function to register WebSocket handlers on any server instance
 * This allows us to use the same WebSocket endpoints on both SSR and API servers
 */

// Helper function to register WebSocket handlers on a server
function registerWebSocketHandlers(server: SSRServer | APIServer) {
  // Path 1: Always allow upgrade
  server.registerWebSocketHandler({
    path: '/ws/always-allow',
    handler: (socket, request, upgradeData) => {
      console.log('✅ WebSocket connected to /ws/always-allow');
      console.log('Upgrade data:', upgradeData);

      socket.send(
        JSON.stringify({
          type: 'welcome',
          message: 'Connected to always-allow endpoint!',
          timestamp: new Date().toISOString(),
        }),
      );

      socket.on('message', (message) => {
        console.log('Received message:', message.toString());
        socket.send(
          JSON.stringify({
            type: 'echo',
            original: message.toString(),
            timestamp: new Date().toISOString(),
          }),
        );
      });

      socket.on('close', () => {
        console.log('❌ WebSocket disconnected from /ws/always-allow');
      });
    },
  });

  // Path 2: Always reject upgrade
  server.registerWebSocketHandler({
    path: '/ws/always-reject',
    preValidate: async (request) => {
      return {
        action: 'reject',
        envelope: APIResponseHelpers.createAPIErrorResponse({
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
    handler: (socket) => {
      // This handler should never be called due to preValidation rejection
      console.log('🚨 ERROR: Handler called for always-reject endpoint!');
      socket.close(1008, 'Should not reach this handler');
    },
  });

  // Path 3: Token-based validation
  server.registerWebSocketHandler({
    path: '/ws/token-validation',
    preValidate: async (request) => {
      const shouldUpgrade = (request.query as Record<string, string>)[
        'should-upgrade'
      ];

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
          envelope: APIResponseHelpers.createAPIErrorResponse({
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
    handler: (socket, request, upgradeData) => {
      console.log('🔐 WebSocket connected to /ws/token-validation');
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
        console.log('Authenticated message:', message.toString());
        socket.send(
          JSON.stringify({
            type: 'secure-echo',
            original: message.toString(),
            authenticated: true,
            timestamp: new Date().toISOString(),
          }),
        );
      });

      socket.on('close', () => {
        console.log('❌ Authenticated WebSocket disconnected');
      });
    },
  });

  // Path 4: Echo with query parameter message
  server.registerWebSocketHandler({
    path: '/ws/echo',
    preValidate: async (request) => {
      const message = (request.query as Record<string, string>)['msg'];

      return {
        action: 'upgrade',
        data: {
          initialMessage: message || '',
          connectedAt: new Date().toISOString(),
        },
      };
    },
    handler: (socket, request, upgradeData) => {
      console.log('📢 WebSocket connected to /ws/echo');
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
        const messageText = message.toString();
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
        console.log('❌ Echo WebSocket disconnected');
      });
    },
  });
}

// Track server instances for graceful shutdown
let ssrServer: SSRServer | null = null;
let apiServer: APIServer | null = null;

// Track preClose hook status for each server
const preCloseHookStatus = {
  ssr: false,
  api: false,
};

// Main demo function
async function runWebSocketDemo() {
  console.log('🚀 Starting WebSocket Demo Servers...\n');

  try {
    // Start SSR server with WebSocket support on port 3001
    console.log(
      '📡 Starting SSR Server with WebSocket support on port 3001...',
    );

    ssrServer = serveSSRDev(
      {
        serverEntry: './demos/ssr/src/entry-server.tsx',
        template: './demos/ssr/index.html',
        viteConfig: './demos/ssr/vite.config.ts',
      },
      {
        fastifyOptions: {
          logger: true,
        },
        enableWebSockets: true,
        webSocketOptions: {
          preClose: createPreCloseHandler('ssr', 'SSR Server'),
        },
        apiEndpoints: {
          apiEndpointPrefix: '/api',
          versioned: false,
        },
      },
    );

    // Register WebSocket handlers on SSR server
    registerWebSocketHandlers(ssrServer);

    // Register /stats endpoint on SSR server
    ssrServer.api.get(
      '/stats',
      createStatsEndpointHandler(ssrServer, 'SSR Server', 3001),
    );

    // Start listening on port 3001
    await ssrServer.listen(3001);
    console.log('✅ SSR Server running at http://localhost:3001\n');

    // Start API server with WebSocket support on port 3002
    console.log(
      '🔌 Starting API Server with WebSocket support on port 3002...',
    );

    apiServer = serveAPI({
      fastifyOptions: {
        logger: true,
      },
      enableWebSockets: true,
      webSocketOptions: {
        preClose: createPreCloseHandler('api', 'API Server'),
      },
      apiEndpoints: {
        apiEndpointPrefix: '/api',
        versioned: false,
      },
    });

    // Register WebSocket handlers on API server
    registerWebSocketHandlers(apiServer);

    // Register /stats endpoint on API server
    apiServer.api.get(
      '/stats',
      createStatsEndpointHandler(apiServer, 'API Server', 3002),
    );

    // Start listening on port 3002
    await apiServer.listen(3002);
    console.log('✅ API Server running at http://localhost:3002\n');

    // Print connection instructions
    console.log('🔗 WebSocket Connection Examples:');
    console.log(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    );
    console.log('');
    console.log('📍 SSR Server (port 3001):');
    console.log('   • Always Allow:     ws://localhost:3001/ws/always-allow');
    console.log('   • Always Reject:    ws://localhost:3001/ws/always-reject');
    console.log(
      '   • Token Required:   ws://localhost:3001/ws/token-validation?should-upgrade=yes',
    );
    console.log(
      '   • Token Invalid:    ws://localhost:3001/ws/token-validation?should-upgrade=no',
    );
    console.log('   • Echo (no msg):    ws://localhost:3001/ws/echo');
    console.log(
      '   • Echo (with msg):  ws://localhost:3001/ws/echo?msg=Hello%20World',
    );
    console.log('');
    console.log('📍 API Server (port 3002):');
    console.log('   • Always Allow:     ws://localhost:3002/ws/always-allow');
    console.log('   • Always Reject:    ws://localhost:3002/ws/always-reject');
    console.log(
      '   • Token Required:   ws://localhost:3002/ws/token-validation?should-upgrade=yes',
    );
    console.log(
      '   • Token Invalid:    ws://localhost:3002/ws/token-validation?should-upgrade=no',
    );
    console.log('   • Echo (no msg):    ws://localhost:3002/ws/echo');
    console.log(
      '   • Echo (with msg):  ws://localhost:3002/ws/echo?msg=Hello%20World',
    );
    console.log('');
    console.log('💡 Test with a WebSocket client like wscat:');
    console.log('   npm install -g wscat or bun install -g wscat');
    console.log("   wscat -c 'ws://localhost:3001/ws/always-allow'");
    console.log(
      "   wscat -c 'ws://localhost:3001/ws/token-validation?should-upgrade=yes'",
    );
    console.log(
      "   wscat -c 'ws://localhost:3001/ws/token-validation?should-upgrade=no'",
    );
    console.log(
      "   wscat -c 'ws://localhost:3001/ws/echo?msg=Hello%20from%20wscat'",
    );
    console.log("   wscat -c 'ws://localhost:3001/ws/always-allow'");
    console.log('');
    console.log('📊 Check WebSocket client statistics:');
    console.log('   curl http://localhost:3001/api/stats');
    console.log('   (Shows current WebSocket client count)');
    console.log('');
    console.log(
      '🧪 To run automated tests including client count progression:',
    );
    console.log('   bun run scripts/test-ws-build.ts');
    console.log('');
    console.log(
      '🛑 Press Ctrl+C to stop servers (will trigger preClose hooks)',
    );
  } catch (error) {
    console.error('❌ Failed to start demo servers:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown by stopping both server instances
const shutdown = async (signal: string) => {
  console.log(
    `\n🛑 Received ${signal}. Shutting down WebSocket demo servers...`,
  );

  try {
    if (ssrServer && ssrServer.isListening()) {
      console.log('🛑 Stopping SSR server...');
      await ssrServer.stop();
      ssrServer = null;
    }

    if (apiServer && apiServer.isListening()) {
      console.log('🛑 Stopping API server...');
      await apiServer.stop();
      apiServer = null;
    }

    console.log('✅ All servers stopped gracefully');
    console.log(
      `\n🔄 PreClose hook status: SSR ${preCloseHookStatus.ssr ? '✅ Called' : '❌ Not called'}, API ${preCloseHookStatus.api ? '✅ Called' : '❌ Not called'}`,
    );
  } catch (err) {
    console.error('❌ Error during shutdown:', err);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Run the demo
runWebSocketDemo().catch(console.error);

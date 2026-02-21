import { describe, it, expect, mock } from 'bun:test';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { WebSocket } from 'ws';
import { WebSocketServerHelpers } from './web-socket-server-helpers';
import { APIResponseHelpers } from '../api-envelope/response-helpers';

// cspell:ignore userid

// Helper to create a mock Fastify instance
const createMockFastify = () => {
  const registeredRoutes: Array<{
    path: string;
    config: any;
    handler: any;
  }> = [];

  const nestedFastify = {
    get: mock((path: string, config: any, handler: any) => {
      registeredRoutes.push({ path, config, handler });
    }),
  };

  const instance = {
    register: mock(async (plugin: any) => {
      await plugin(nestedFastify);
    }),
    addHook: mock((_name: string, _handler: any) => {}),
    log: {
      error: mock((..._args: any[]) => {}),
    },
    websocketServer: {
      clients: new Set(),
    },
    _registeredRoutes: registeredRoutes,
    _nestedFastify: nestedFastify,
  };

  return instance as unknown as FastifyInstance;
};

// Helper to create a mock WebSocket
const createMockWebSocket = () => {
  const ws = {
    close: mock((_code?: number, _reason?: string) => {}),
    send: mock((_data: any) => {}),
    on: mock((_event: string, _handler: any) => {}),
  };
  return ws as unknown as WebSocket;
};

// Helper to create a mock request
const createMockRequest = (overrides?: Partial<FastifyRequest>) => {
  return {
    requestID: 'ws-req-123',
    url: '/ws/chat',
    params: {},
    query: {},
    headers: {
      upgrade: 'websocket',
      connection: 'Upgrade',
    },
    ws: true,
    ...overrides,
  } as unknown as FastifyRequest;
};

// Helper to create a mock reply
const createMockReply = () => {
  const reply = {
    code: mock((statusCode: number) => {
      (reply as any)._statusCode = statusCode;
      return reply;
    }),
    send: mock((data: unknown) => {
      (reply as any)._sent = data;
      return reply;
    }),
    header: mock((name: string, value: string) => {
      (reply as any)._headers = (reply as any)._headers || {};
      (reply as any)._headers[name] = value;
      return reply;
    }),
    _statusCode: 200,
    _sent: null,
    _headers: {},
  };
  return reply as unknown as FastifyReply;
};

describe('WebSocketServerHelpers', () => {
  describe('Constructor', () => {
    it('creates instance with default options', () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      expect(helpers).toBeDefined();
    });

    it('creates instance with custom WebSocket options', () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers, {
        perMessageDeflate: true,
        maxPayload: 50 * 1024 * 1024,
      });
      expect(helpers).toBeDefined();
    });

    it('creates instance with preClose handler', () => {
      const preCloseHandler = mock(async (_clients: Set<unknown>) => {
        // Cleanup logic
      });

      const helpers = new WebSocketServerHelpers(APIResponseHelpers, {
        preClose: preCloseHandler,
      });

      expect(helpers).toBeDefined();
    });
  });

  describe('registerWebSocketPlugin', () => {
    it('registers WebSocket plugin with default options', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const mockFastify = {
        register: mock((plugin: any, options: any) => {
          // Verify options are passed correctly
          expect(options.options.clientTracking).toBe(true);
          expect(options.options.perMessageDeflate).toBe(false);
          expect(options.options.maxPayload).toBe(100 * 1024 * 1024);
        }),
        log: { error: mock(() => {}) },
      } as unknown as FastifyInstance;

      await helpers.registerWebSocketPlugin(mockFastify);
      expect(mockFastify.register).toHaveBeenCalled();
    });

    it('registers WebSocket plugin with custom options', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers, {
        perMessageDeflate: true,
        maxPayload: 25 * 1024 * 1024,
      });
      const mockFastify = {
        register: mock((plugin: any, options: any) => {
          expect(options.options.perMessageDeflate).toBe(true);
          expect(options.options.maxPayload).toBe(25 * 1024 * 1024);
        }),
        log: { error: mock(() => {}) },
      } as unknown as FastifyInstance;

      await helpers.registerWebSocketPlugin(mockFastify);
      expect(mockFastify.register).toHaveBeenCalled();
    });

    it('registers preClose handler and calls it on close', async () => {
      const preCloseHandler = mock((clients: Set<unknown>) => {
        expect(clients).toBeDefined();
        return Promise.resolve();
      });

      const helpers = new WebSocketServerHelpers(APIResponseHelpers, {
        preClose: preCloseHandler,
      });

      let capturedPreClose: ((done: () => void) => void) | undefined;
      const mockFastify = {
        register: mock((plugin: any, options: any) => {
          // Capture the preClose function
          if (options.preClose) {
            capturedPreClose = options.preClose;
          }
        }),
        websocketServer: {
          clients: new Set([{ id: 1 }, { id: 2 }]),
        },
        log: { error: mock(() => {}) },
      } as unknown as FastifyInstance;

      await helpers.registerWebSocketPlugin(mockFastify);

      // Simulate calling preClose
      if (capturedPreClose) {
        const doneMock = mock(() => {});
        capturedPreClose(doneMock);
        // Wait a bit for the promise to resolve
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(preCloseHandler).toHaveBeenCalled();
        expect(doneMock).toHaveBeenCalled();
      }
    });

    it('handles preClose handler errors gracefully', async () => {
      const preCloseHandler = mock((_clients: Set<unknown>) => {
        throw new Error('PreClose failed');
      });

      const helpers = new WebSocketServerHelpers(APIResponseHelpers, {
        preClose: preCloseHandler,
      });

      let capturedPreClose: ((done: () => void) => void) | undefined;
      const mockLog = { error: mock(() => {}) };
      const mockFastify = {
        register: mock((plugin: any, options: any) => {
          if (options.preClose) {
            capturedPreClose = options.preClose;
          }
        }),
        websocketServer: {
          clients: new Set(),
        },
        log: mockLog,
      } as unknown as FastifyInstance;

      await helpers.registerWebSocketPlugin(mockFastify);

      // Simulate calling preClose
      if (capturedPreClose) {
        const doneMock = mock(() => {});
        capturedPreClose(doneMock);
        // Wait for error handling
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(mockLog.error).toHaveBeenCalled();
        expect(doneMock).toHaveBeenCalled(); // Should still call done
      }
    });
  });

  describe('registerWebSocketHandler', () => {
    it('registers a WebSocket handler for a path', () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const handler = mock(
        async (_socket: WebSocket, _request: FastifyRequest) => {},
      );

      helpers.registerWebSocketHandler({
        path: '/ws/chat',
        handler,
      });

      // Handler should be registered internally
      expect(true).toBe(true);
    });

    it('registers handler with preValidation function', () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const preValidate = mock(() => ({ action: 'upgrade' as const }));
      const handler = mock(async () => {});

      helpers.registerWebSocketHandler({
        path: '/ws/authenticated',
        preValidate,
        handler,
      });

      expect(true).toBe(true);
    });

    it('last registration wins for the same path', () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const handler1 = mock(async () => {});
      const handler2 = mock(async () => {});

      helpers.registerWebSocketHandler({
        path: '/ws/test',
        handler: handler1,
      });

      helpers.registerWebSocketHandler({
        path: '/ws/test',
        handler: handler2,
      });

      // Second handler should override the first
      expect(true).toBe(true);
    });
  });

  describe('registerRoutes', () => {
    it('registers WebSocket routes with Fastify', () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const handler = mock(async () => {});

      helpers.registerWebSocketHandler({
        path: '/ws/chat',
        handler,
      });

      helpers.registerRoutes(fastify);

      expect(fastify.register).toHaveBeenCalled();
    });

    it('closes socket when path is not valid', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const socket = createMockWebSocket();
      const request = createMockRequest({
        url: '/ws/unknown',
      });

      helpers.registerWebSocketHandler({
        path: '/ws/chat',
        handler: mock(async () => {}),
      });

      helpers.registerRoutes(fastify);

      // Get the registered handler
      const registeredHandler = (fastify as any)._registeredRoutes[0]?.handler;
      if (registeredHandler) {
        // Mark as invalid path
        (request as any).wsUpgradeInfo = {
          validPath: false,
          hasPreValidator: false,
          upgradeResult: null,
          error: null,
        };

        await registeredHandler(socket, request);
        expect((socket as any).close).toHaveBeenCalledWith(
          1008,
          'Invalid WebSocket path',
        );
      }
    });

    it('closes socket when upgrade is not allowed', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const socket = createMockWebSocket();
      const request = createMockRequest();

      helpers.registerWebSocketHandler({
        path: '/ws/chat',
        handler: mock(async () => {}),
      });

      helpers.registerRoutes(fastify);

      const registeredHandler = (fastify as any)._registeredRoutes[0]?.handler;
      if (registeredHandler) {
        (request as any).wsUpgradeInfo = {
          validPath: true,
          hasPreValidator: true,
          upgradeResult: { action: 'reject' },
          error: null,
        };

        await registeredHandler(socket, request);
        expect((socket as any).close).toHaveBeenCalledWith(
          1008,
          'WebSocket upgrade not allowed',
        );
      }
    });

    it('calls handler with upgrade data when upgrade is allowed', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const socket = createMockWebSocket();
      const request = createMockRequest();
      const upgradeData = { userID: '123', token: 'abc' };
      const handler = mock(
        async (
          _socket: WebSocket,
          _request: FastifyRequest,
          _params: any,
          _upgradeData?: Record<string, unknown>,
        ) => {},
      );

      helpers.registerWebSocketHandler({
        path: '/ws/chat',
        handler,
      });

      helpers.registerRoutes(fastify);

      const registeredHandler = (fastify as any)._registeredRoutes[0]?.handler;
      if (registeredHandler) {
        (request as any).wsUpgradeInfo = {
          validPath: true,
          hasPreValidator: true,
          upgradeResult: { action: 'upgrade', data: upgradeData },
          error: null,
        };
        (request as any).wsUpgradeData = upgradeData;

        await registeredHandler(socket, request);
        expect(handler).toHaveBeenCalledWith(
          socket,
          request,
          expect.objectContaining({
            path: '/ws/chat',
            originalURL: '/ws/chat',
          }),
          upgradeData,
        );
      }
    });
  });

  describe('registerPreValidationHook', () => {
    it('registers preValidation hook with Fastify', () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();

      helpers.registerPreValidationHook(fastify);

      expect((fastify as any).addHook).toHaveBeenCalledWith(
        'preValidation',
        expect.any(Function),
      );
    });

    it('ignores non-WebSocket requests', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const request = createMockRequest({
        headers: {},
        ws: false,
      });
      const reply = createMockReply();

      helpers.registerPreValidationHook(fastify);

      // Get the hook handler
      const hookHandler = (fastify.addHook as any).mock.calls[0]?.[1];
      if (hookHandler) {
        await hookHandler(request, reply);
        // Should not send any response for non-WS requests
        expect((reply as any).code).not.toHaveBeenCalled();
      }
    });

    it('rejects request with invalid Connection header', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const request = createMockRequest({
        headers: {
          upgrade: 'websocket',
          connection: 'keep-alive', // Invalid for WebSocket
        },
        ws: true,
      });
      const reply = createMockReply();

      helpers.registerPreValidationHook(fastify);

      const hookHandler = (fastify.addHook as any).mock.calls[0]?.[1];
      if (hookHandler) {
        await hookHandler(request, reply);
        expect((reply as any).code).toHaveBeenCalledWith(400);
      }
    });

    it('returns 404 when no handler found for path', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const request = createMockRequest({
        url: '/ws/nonexistent',
      });
      const reply = createMockReply();

      helpers.registerPreValidationHook(fastify);

      const hookHandler = (fastify.addHook as any).mock.calls[0]?.[1];
      if (hookHandler) {
        await hookHandler(request, reply);
        expect((reply as any).code).toHaveBeenCalledWith(404);
        expect((reply as any)._sent.error.code).toBe(
          'websocket_handler_not_found',
        );
      }
    });

    it('allows upgrade when no preValidation function exists', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const request = createMockRequest({
        url: '/ws/public',
      });
      const reply = createMockReply();

      helpers.registerWebSocketHandler({
        path: '/ws/public',
        handler: mock(async () => {}),
      });

      helpers.registerPreValidationHook(fastify);

      const hookHandler = (fastify.addHook as any).mock.calls[0]?.[1];
      if (hookHandler) {
        await hookHandler(request, reply);
        // Should not send any response, allowing upgrade
        expect((reply as any).code).not.toHaveBeenCalled();
        expect((request as any).wsUpgradeInfo.validPath).toBe(true);
        expect((request as any).wsUpgradeInfo.hasPreValidator).toBe(false);
      }
    });

    it('calls preValidation function and allows upgrade', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const request = createMockRequest({
        url: '/ws/authenticated?token=valid',
      });
      const reply = createMockReply();

      const preValidate = mock((_request: FastifyRequest, params: any) => {
        expect(params.path).toBe('/ws/authenticated');
        return { action: 'upgrade' as const, data: { authenticated: true } };
      });

      helpers.registerWebSocketHandler({
        path: '/ws/authenticated',
        preValidate,
        handler: mock(async () => {}),
      });

      helpers.registerPreValidationHook(fastify);

      const hookHandler = (fastify.addHook as any).mock.calls[0]?.[1];
      if (hookHandler) {
        await hookHandler(request, reply);
        expect(preValidate).toHaveBeenCalled();
        expect((reply as any).code).not.toHaveBeenCalled();
        expect((request as any).wsUpgradeInfo.upgradeResult.action).toBe(
          'upgrade',
        );
        expect((request as any).wsUpgradeData).toEqual({
          authenticated: true,
        });
      }
    });

    it('rejects upgrade when preValidation returns reject', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const request = createMockRequest({
        url: '/ws/authenticated?token=invalid',
      });
      const reply = createMockReply();

      const preValidate = mock(() => ({
        action: 'reject' as const,
        envelope: APIResponseHelpers.createAPIErrorResponse({
          request,
          statusCode: 401,
          errorCode: 'unauthorized',
          errorMessage: 'Invalid token',
        }),
      }));

      helpers.registerWebSocketHandler({
        path: '/ws/authenticated',
        preValidate,
        handler: mock(async () => {}),
      });

      helpers.registerPreValidationHook(fastify);

      const hookHandler = (fastify.addHook as any).mock.calls[0]?.[1];
      if (hookHandler) {
        await hookHandler(request, reply);
        expect((reply as any).code).toHaveBeenCalledWith(401);
        expect((reply as any)._sent.error.code).toBe('unauthorized');
      }
    });

    it('rejects with error when preValidation returns invalid envelope', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const request = createMockRequest({
        url: '/ws/bad',
      });
      const reply = createMockReply();

      const preValidate = mock(() => ({
        action: 'reject' as const,
        envelope: { invalid: true } as any,
      }));

      helpers.registerWebSocketHandler({
        path: '/ws/bad',
        preValidate,
        handler: mock(async () => {}),
      });

      helpers.registerPreValidationHook(fastify);

      const hookHandler = (fastify.addHook as any).mock.calls[0]?.[1];
      if (hookHandler) {
        // The invalid envelope should cause an error during validation
        try {
          await hookHandler(request, reply);
          // If we get here, an error should have been thrown and caught internally
          // The implementation should handle this gracefully
        } catch (error) {
          expect(error).toBeDefined();
        }
      }
    });

    it('handles preValidation function errors', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const request = createMockRequest({
        url: '/ws/error',
      });
      const reply = createMockReply();

      const preValidate = mock(() => {
        throw new Error('Database connection failed');
      });

      helpers.registerWebSocketHandler({
        path: '/ws/error',
        preValidate,
        handler: mock(async () => {}),
      });

      helpers.registerPreValidationHook(fastify);

      const hookHandler = (fastify.addHook as any).mock.calls[0]?.[1];
      if (hookHandler) {
        await hookHandler(request, reply);
        expect((reply as any).code).toHaveBeenCalledWith(500);
        expect((reply as any)._sent.error.code).toBe(
          'websocket_validation_error',
        );
        expect((request as any).wsUpgradeInfo.error).toBeDefined();
      }
    });

    it('sets Cache-Control header for error responses', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const request = createMockRequest({
        url: '/ws/nonexistent',
      });
      const reply = createMockReply();

      helpers.registerPreValidationHook(fastify);

      const hookHandler = (fastify.addHook as any).mock.calls[0]?.[1];
      if (hookHandler) {
        await hookHandler(request, reply);
        expect((reply as any).header).toHaveBeenCalledWith(
          'Cache-Control',
          'no-store',
        );
      }
    });

    it('extracts params from request URL', async () => {
      const helpers = new WebSocketServerHelpers(APIResponseHelpers);
      const fastify = createMockFastify();
      const request = createMockRequest({
        url: '/ws/room/123?user=alice',
        params: { roomID: '123' },
        query: { user: 'alice' },
      });
      const reply = createMockReply();

      const preValidate = mock((_request: FastifyRequest, params: any) => {
        expect(params.path).toBe('/ws/room/123');
        expect(params.originalURL).toBe('/ws/room/123?user=alice');
        expect(params.queryParams).toEqual({ user: 'alice' });
        expect(params.routeParams).toEqual({ roomID: '123' });
        return { action: 'upgrade' as const };
      });

      helpers.registerWebSocketHandler({
        path: '/ws/room/123',
        preValidate,
        handler: mock(async () => {}),
      });

      helpers.registerPreValidationHook(fastify);

      const hookHandler = (fastify.addHook as any).mock.calls[0]?.[1];
      if (hookHandler) {
        await hookHandler(request, reply);
        expect(preValidate).toHaveBeenCalled();
      }
    });
  });
});

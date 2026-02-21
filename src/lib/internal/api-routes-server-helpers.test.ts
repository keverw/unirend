import { describe, it, expect, mock } from 'bun:test';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { APIRoutesServerHelpers } from './api-routes-server-helpers';
import { APIResponseHelpers } from '../api-envelope/response-helpers';

// cspell:ignore userid

// Helper to create a mock Fastify instance
const createMockFastify = () => {
  const routes: Array<{
    method: string;
    path: string;
    handler: (req: FastifyRequest, reply: FastifyReply) => unknown;
  }> = [];

  const instance = {
    get: mock((path: string, handler: any) => {
      routes.push({ method: 'GET', path, handler });
    }),
    post: mock((path: string, handler: any) => {
      routes.push({ method: 'POST', path, handler });
    }),
    put: mock((path: string, handler: any) => {
      routes.push({ method: 'PUT', path, handler });
    }),
    delete: mock((path: string, handler: any) => {
      routes.push({ method: 'DELETE', path, handler });
    }),
    patch: mock((path: string, handler: any) => {
      routes.push({ method: 'PATCH', path, handler });
    }),
    _routes: routes,
  };

  return instance as unknown as FastifyInstance;
};

// Helper to create a mock request
const createMockRequest = (overrides?: Partial<FastifyRequest>) => {
  return {
    requestID: 'test-req-123',
    url: '/api/users',
    params: {},
    query: {},
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
    sent: false,
    _statusCode: 200,
    _sent: null,
    _headers: {},
  };
  return reply as unknown as FastifyReply;
};

describe('APIRoutesServerHelpers', () => {
  describe('Registration API shortcuts', () => {
    it('registers GET handler without version (defaults to version 1)', () => {
      const helpers = new APIRoutesServerHelpers();
      const handler = mock(() => ({
        status: 'success' as const,
        status_code: 200,
        request_id: 'test',
        type: 'api' as const,
        data: { test: true },
        meta: {},
        error: null,
      }));

      helpers.apiMethod.get('users', handler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });

    it('registers GET handler with explicit version', () => {
      const helpers = new APIRoutesServerHelpers();
      const handler = mock(() => ({
        status: 'success' as const,
        status_code: 200,
        request_id: 'test',
        type: 'api' as const,
        data: { test: true },
        meta: {},
        error: null,
      }));

      helpers.apiMethod.get('users', 2, handler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });

    it('registers POST handler without version', () => {
      const helpers = new APIRoutesServerHelpers();
      const handler = mock(() => ({
        status: 'success' as const,
        status_code: 201,
        request_id: 'test',
        type: 'api' as const,
        data: { created: true },
        meta: {},
        error: null,
      }));

      helpers.apiMethod.post('users', handler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });

    it('registers POST handler with explicit version', () => {
      const helpers = new APIRoutesServerHelpers();
      const handler = mock(() => ({
        status: 'success' as const,
        status_code: 201,
        request_id: 'test',
        type: 'api' as const,
        data: { created: true },
        meta: {},
        error: null,
      }));

      helpers.apiMethod.post('users', 2, handler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });

    it('registers PUT handler without version', () => {
      const helpers = new APIRoutesServerHelpers();
      const handler = mock(() => ({
        status: 'success' as const,
        status_code: 200,
        request_id: 'test',
        type: 'api' as const,
        data: { updated: true },
        meta: {},
        error: null,
      }));

      helpers.apiMethod.put('users/:id', handler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });

    it('registers PUT handler with explicit version', () => {
      const helpers = new APIRoutesServerHelpers();
      const handler = mock(() => ({
        status: 'success' as const,
        status_code: 200,
        request_id: 'test',
        type: 'api' as const,
        data: { updated: true },
        meta: {},
        error: null,
      }));

      helpers.apiMethod.put('users/:id', 3, handler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });

    it('registers DELETE handler without version', () => {
      const helpers = new APIRoutesServerHelpers();
      const handler = mock(() => ({
        status: 'success' as const,
        status_code: 204,
        request_id: 'test',
        type: 'api' as const,
        data: null,
        meta: {},
        error: null,
      }));

      helpers.apiMethod.delete('users/:id', handler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });

    it('registers DELETE handler with explicit version', () => {
      const helpers = new APIRoutesServerHelpers();
      const handler = mock(() => ({
        status: 'success' as const,
        status_code: 204,
        request_id: 'test',
        type: 'api' as const,
        data: null,
        meta: {},
        error: null,
      }));

      helpers.apiMethod.delete('users/:id', 2, handler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });

    it('registers PATCH handler without version', () => {
      const helpers = new APIRoutesServerHelpers();
      const handler = mock(() => ({
        status: 'success' as const,
        status_code: 200,
        request_id: 'test',
        type: 'api' as const,
        data: { patched: true },
        meta: {},
        error: null,
      }));

      helpers.apiMethod.patch('users/:id', handler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });

    it('registers PATCH handler with explicit version', () => {
      const helpers = new APIRoutesServerHelpers();
      const handler = mock(() => ({
        status: 'success' as const,
        status_code: 200,
        request_id: 'test',
        type: 'api' as const,
        data: { patched: true },
        meta: {},
        error: null,
      }));

      helpers.apiMethod.patch('users/:id', 4, handler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });
  });

  describe('hasRegisteredHandlers', () => {
    it('returns false when no handlers are registered', () => {
      const helpers = new APIRoutesServerHelpers();
      expect(helpers.hasRegisteredHandlers()).toBe(false);
    });

    it('returns true when handlers are registered', () => {
      const helpers = new APIRoutesServerHelpers();
      helpers.apiMethod.get('test', () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: {},
        }),
      );
      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });
  });

  describe('registerRoutes', () => {
    it('registers versioned routes with default prefix /api', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();

      helpers.apiMethod.get('users', () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: { users: [] },
        }),
      );

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      expect(fastify.get).toHaveBeenCalledWith(
        '/api/v1/users',
        expect.any(Function),
      );
    });

    it('registers non-versioned routes when versioned is false', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();

      helpers.apiMethod.get('items', () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: { items: [] },
        }),
      );

      helpers.registerRoutes(fastify, '/api', { versioned: false });

      expect(fastify.get).toHaveBeenCalledWith(
        '/api/items',
        expect.any(Function),
      );
    });

    it('registers multiple versions of the same endpoint', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();

      helpers.apiMethod.get('users', 1, () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: { version: 1 },
        }),
      );

      helpers.apiMethod.get('users', 2, () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: { version: 2 },
        }),
      );

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      expect(fastify.get).toHaveBeenCalledWith(
        '/api/v1/users',
        expect.any(Function),
      );
      expect(fastify.get).toHaveBeenCalledWith(
        '/api/v2/users',
        expect.any(Function),
      );
    });

    it('registers different HTTP methods for the same endpoint', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();

      helpers.apiMethod.get('users', () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: {},
        }),
      );

      helpers.apiMethod.post('users', () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: {},
        }),
      );

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      expect(fastify.get).toHaveBeenCalledWith(
        '/api/v1/users',
        expect.any(Function),
      );
      expect(fastify.post).toHaveBeenCalledWith(
        '/api/v1/users',
        expect.any(Function),
      );
    });

    it('throws error when wildcard endpoint is registered with root prefix', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();

      helpers.apiMethod.get('*', () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: {},
        }),
      );

      expect(() => {
        helpers.registerRoutes(fastify, '/', { versioned: true });
      }).toThrow(/Wildcard endpoints are not allowed/);
    });

    it('allows wildcard endpoints with non-root prefix', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();

      helpers.apiMethod.get('*', () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: {},
        }),
      );

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      expect(fastify.get).toHaveBeenCalledWith(
        '/api/v1/*',
        expect.any(Function),
      );
    });

    it('allows wildcards when allowWildcardAtRoot is true even with root prefix', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();

      helpers.apiMethod.get('*', () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: {},
        }),
      );

      // Should not throw when allowWildcardAtRoot is true
      expect(() => {
        helpers.registerRoutes(fastify, '/', {
          versioned: true,
          allowWildcardAtRoot: true,
        });
      }).not.toThrow();

      // Root prefix "/" + version "v1" + endpoint "*" = "//v1/*" (needs normalization)
      expect(fastify.get).toHaveBeenCalledWith('//v1/*', expect.any(Function));
    });

    it('throws error when multiple versions exist but versioning is disabled', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();

      helpers.apiMethod.get('users', 1, () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: {},
        }),
      );

      helpers.apiMethod.get('users', 2, () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: {},
        }),
      );

      expect(() => {
        helpers.registerRoutes(fastify, '/api', { versioned: false });
      }).toThrow(/multiple versions.*but versioning is disabled/i);
    });

    it('normalizes endpoints by stripping leading slashes', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();

      helpers.apiMethod.get('/users', () =>
        APIResponseHelpers.createAPISuccessResponse({
          request: createMockRequest(),
          data: {},
        }),
      );

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      expect(fastify.get).toHaveBeenCalledWith(
        '/api/v1/users',
        expect.any(Function),
      );
    });

    it('executes handler and returns envelope', async () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();
      const request = createMockRequest();
      const reply = createMockReply();

      const expectedData = { userID: 123, name: 'Alice' };
      helpers.apiMethod.get('users', (_req, _reply, params) => {
        expect(params.method).toBe('GET');
        expect(params.endpoint).toBe('users');
        expect(params.version).toBe(1);
        expect(params.fullPath).toBe('/api/v1/users');

        return APIResponseHelpers.createAPISuccessResponse({
          request,
          data: expectedData,
        });
      });

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      // Get the registered handler
      const registeredHandler = (fastify as any)._routes[0].handler;

      // Call the handler
      const result = await registeredHandler(request, reply);

      expect(result.status).toBe('success');
      expect(result.data).toEqual(expectedData);
      expect((reply as any).code).toHaveBeenCalledWith(200);
    });

    it('sets Cache-Control header for error responses', async () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();
      const request = createMockRequest();
      const reply = createMockReply();

      helpers.apiMethod.get('error', () =>
        APIResponseHelpers.createAPIErrorResponse({
          request,
          statusCode: 400,
          errorCode: 'bad_request',
          errorMessage: 'Bad request',
        }),
      );

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      const registeredHandler = (fastify as any)._routes[0].handler;
      await registeredHandler(request, reply);

      expect((reply as any).header).toHaveBeenCalledWith(
        'Cache-Control',
        'no-store',
      );
      expect((reply as any).code).toHaveBeenCalledWith(400);
    });

    it('throws error when handler returns invalid envelope', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();
      const request = createMockRequest();
      const reply = createMockReply();

      helpers.apiMethod.get('invalid', () => {
        // Return invalid response (not an envelope)
        return { invalid: true } as any;
      });

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      const registeredHandler = (fastify as any)._routes[0].handler;

      return expect(
        Promise.resolve().then(() => registeredHandler(request, reply)),
      ).rejects.toThrow(/invalid response envelope/i);
    });

    it('handles false return value when reply was sent', async () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();
      const request = createMockRequest();
      const reply = createMockReply();
      (reply as any).sent = true; // Mark as sent

      helpers.apiMethod.get('early-return', () => {
        // Handler already sent response
        return false;
      });

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      const registeredHandler = (fastify as any)._routes[0].handler;
      const result = await registeredHandler(request, reply);

      expect(result).toBeUndefined();
    });

    it('throws error when handler returns false but did not send response', () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();
      const request = createMockRequest();
      const reply = createMockReply();
      (reply as any).sent = false; // Not sent

      helpers.apiMethod.get('bad-false', () => {
        // Handler returns false but didn't send response
        return false;
      });

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      const registeredHandler = (fastify as any)._routes[0].handler;

      return expect(
        Promise.resolve().then(() => registeredHandler(request, reply)),
      ).rejects.toThrow(/returned false but did not send a response/i);
    });

    it('extracts route params and query params from request', async () => {
      const helpers = new APIRoutesServerHelpers();
      const fastify = createMockFastify();
      const request = createMockRequest({
        url: '/api/v1/users/123?filter=active',
        params: { id: '123' },
        query: { filter: 'active' },
      });
      const reply = createMockReply();

      helpers.apiMethod.get('users/:id', (_req, _reply, params) => {
        expect(params.routeParams).toEqual({ id: '123' });
        expect(params.queryParams).toEqual({ filter: 'active' });
        expect(params.requestPath).toBe('/api/v1/users/123');
        expect(params.originalURL).toBe('/api/v1/users/123?filter=active');

        return APIResponseHelpers.createAPISuccessResponse({
          request,
          data: {},
        });
      });

      helpers.registerRoutes(fastify, '/api', { versioned: true });

      const registeredHandler = (fastify as any)._routes[0].handler;
      await registeredHandler(request, reply);
    });
  });
});

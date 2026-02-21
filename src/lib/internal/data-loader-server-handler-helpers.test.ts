import { describe, it, expect, mock } from 'bun:test';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { DataLoaderServerHandlerHelpers } from './data-loader-server-handler-helpers';
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
    post: mock((path: string, handler: any) => {
      routes.push({ method: 'POST', path, handler });
    }),
    log: {
      error: mock((..._args: any[]) => {}),
    },
    _routes: routes,
  };

  return instance as unknown as FastifyInstance;
};

// Helper to create a mock request
const createMockRequest = (overrides?: Partial<FastifyRequest>) => {
  return {
    requestID: 'test-req-456',
    url: '/api/v1/page_data/home',
    body: {
      routeParams: {},
      queryParams: {},
      requestPath: '/home',
      originalURL: '/home',
    },
    clientInfo: {
      isFromSSRServerAPICall: false,
    },
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

describe('DataLoaderServerHandlerHelpers', () => {
  describe('pageDataHandlerMethod getter', () => {
    it('returns object with register method', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const method = helpers.pageDataHandlerMethod;

      expect(method).toBeDefined();
      expect(typeof method.register).toBe('function');
    });
  });

  describe('Registration API', () => {
    it('registers handlers with default and explicit versions', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const defaultVersionHandler = mock(() =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: { content: 'Home page' },
          pageMetadata: { title: 'Home', description: 'Home page' },
        }),
      );
      const explicitVersionHandler = mock(() =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: { content: 'Home v2' },
          pageMetadata: { title: 'Home', description: 'Home page v2' },
        }),
      );

      helpers.pageDataHandlerMethod.register('home', defaultVersionHandler);
      helpers.pageDataHandlerMethod.register('home', 2, explicitVersionHandler);

      expect(helpers.hasRegisteredHandlers()).toBe(true);
      expect(helpers.hasHandler('home', 1)).toBe(true);
      expect(helpers.hasHandler('home', 2)).toBe(true);
    });

    it('throws error when version is provided but handler is missing', () => {
      const helpers = new DataLoaderServerHandlerHelpers();

      // Access the private method through type assertion to test defensive check
      expect(() => {
        (helpers as any).registerDataLoaderHandler('test-page', 2, undefined);
      }).toThrow(/Handler function is required when version is specified/);
    });

    it('throws error when registering with invalid version (< 1)', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const handler = () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Test', description: 'Test' },
        });

      expect(() => {
        helpers.pageDataHandlerMethod.register('test-page', 0, handler);
      }).toThrow(/version must be >= 1/);

      expect(() => {
        helpers.pageDataHandlerMethod.register('test-page', -1, handler);
      }).toThrow(/version must be >= 1/);
    });
  });

  describe('hasRegisteredHandlers', () => {
    it('returns false when no handlers are registered', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      expect(helpers.hasRegisteredHandlers()).toBe(false);
    });

    it('returns true when handlers are registered', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      helpers.pageDataHandlerMethod.register('test', () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Test', description: 'Test page' },
        }),
      );
      expect(helpers.hasRegisteredHandlers()).toBe(true);
    });
  });

  describe('registerRoutes', () => {
    it('registers versioned page data routes', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('home', () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: { content: 'Home' },
          pageMetadata: { title: 'Home', description: 'Home page' },
        }),
      );

      helpers.registerRoutes(fastify, '/api', 'page_data', {
        versioned: true,
      });

      expect(fastify.post).toHaveBeenCalledWith(
        '/api/v1/page_data/home',
        expect.any(Function),
      );
    });

    it('registers non-versioned routes when versioned is false', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('about', () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: { content: 'About' },
          pageMetadata: { title: 'About', description: 'About page' },
        }),
      );

      helpers.registerRoutes(fastify, '/api', 'page_data', {
        versioned: false,
      });

      expect(fastify.post).toHaveBeenCalledWith(
        '/api/page_data/about',
        expect.any(Function),
      );
    });

    it('registers multiple versions of the same page type', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('profile', 1, () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: { version: 1 },
          pageMetadata: { title: 'Profile v1', description: 'Profile page' },
        }),
      );

      helpers.pageDataHandlerMethod.register('profile', 2, () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: { version: 2 },
          pageMetadata: { title: 'Profile v2', description: 'Profile page' },
        }),
      );

      helpers.registerRoutes(fastify, '/api', 'page_data', {
        versioned: true,
      });

      expect(fastify.post).toHaveBeenCalledWith(
        '/api/v1/page_data/profile',
        expect.any(Function),
      );
      expect(fastify.post).toHaveBeenCalledWith(
        '/api/v2/page_data/profile',
        expect.any(Function),
      );
    });

    it('throws error when multiple versions exist but versioning is disabled', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('users', 1, () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Users', description: 'Users page' },
        }),
      );

      helpers.pageDataHandlerMethod.register('users', 2, () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Users', description: 'Users page' },
        }),
      );

      expect(() => {
        helpers.registerRoutes(fastify, '/api', 'page_data', {
          versioned: false,
        });
      }).toThrow(/multiple versions.*but versioning is disabled/i);
    });

    it('normalizes page types by stripping leading slashes', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('/dashboard', () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Dashboard', description: 'Dashboard' },
        }),
      );

      helpers.registerRoutes(fastify, '/api', 'page_data', {
        versioned: true,
      });

      expect(fastify.post).toHaveBeenCalledWith(
        '/api/v1/page_data/dashboard',
        expect.any(Function),
      );
    });
  });

  describe('hasHandler', () => {
    it('returns false when no handler exists', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      expect(helpers.hasHandler('nonexistent')).toBe(false);
    });

    it('returns true when handler exists (no version specified)', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      helpers.pageDataHandlerMethod.register('home', () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Home', description: 'Home' },
        }),
      );

      expect(helpers.hasHandler('home')).toBe(true);
    });

    it('returns true when specific version exists', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      helpers.pageDataHandlerMethod.register('profile', 2, () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Profile', description: 'Profile' },
        }),
      );

      expect(helpers.hasHandler('profile', 2)).toBe(true);
    });

    it('returns false when specific version does not exist', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      helpers.pageDataHandlerMethod.register('profile', 1, () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Profile', description: 'Profile' },
        }),
      );

      expect(helpers.hasHandler('profile', 99)).toBe(false);
    });
  });

  describe('Page type normalization edge cases', () => {
    it('throws error when registering page type that is just a slash', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const handler = () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Test', description: 'Test' },
        });

      expect(() => {
        helpers.pageDataHandlerMethod.register('/', handler);
      }).toThrow(/Page type cannot be empty after normalization/);
    });

    it('throws error when calling handler with page type that is just a slash', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const request = createMockRequest();
      const mockControlledReply = {
        header: mock(() => {}),
        getHeader: mock(() => undefined),
        getHeaders: mock(() => ({})),
        removeHeader: mock(() => {}),
        hasHeader: mock(() => false),
        sent: false,
        raw: { destroyed: false },
      };

      return expect(
        Promise.resolve().then(() =>
          helpers.callHandler({
            originalRequest: request,
            controlledReply: mockControlledReply as any,
            pageType: '/',
            routeParams: {},
            queryParams: {},
            requestPath: '/',
            originalURL: '/',
          }),
        ),
      ).rejects.toThrow(/Page type cannot be empty after normalization/);
    });

    it('throws error when checking if handler exists with just a slash', () => {
      const helpers = new DataLoaderServerHandlerHelpers();

      expect(() => {
        helpers.hasHandler('/');
      }).toThrow(/Page type cannot be empty after normalization/);
    });
  });

  describe('Private method coverage', () => {
    it('getLatestVersion returns undefined for non-existent page type', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const result = (helpers as any).getLatestVersion('nonexistent');
      expect(result).toBeUndefined();
    });

    it('getLatestVersion returns highest version number', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const handler = () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Test', description: 'Test' },
        });

      helpers.pageDataHandlerMethod.register('test', 1, handler);
      helpers.pageDataHandlerMethod.register('test', 3, handler);
      helpers.pageDataHandlerMethod.register('test', 2, handler);

      const result = (helpers as any).getLatestVersion('test');
      expect(result).toBe(3);
    });

    it('normalizePageType strips leading and trailing slashes', () => {
      const helpers = new DataLoaderServerHandlerHelpers();

      expect((helpers as any).normalizePageType('test/')).toBe('test');
      expect((helpers as any).normalizePageType('/test/')).toBe('test');
      expect((helpers as any).normalizePageType('  test  ')).toBe('test');
      expect((helpers as any).normalizePageType('  /test/  ')).toBe('test');
    });
  });

  describe('callHandler', () => {
    it('returns exists: false when handler does not exist', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const request = createMockRequest();
      const mockControlledReply = {
        header: mock(() => {}),
        getHeader: mock(() => undefined),
        getHeaders: mock(() => ({})),
        removeHeader: mock(() => {}),
        hasHeader: mock(() => false),
        sent: false,
        raw: { destroyed: false },
      };

      const result = await helpers.callHandler({
        originalRequest: request,
        controlledReply: mockControlledReply as any,
        pageType: 'nonexistent',
        routeParams: {},
        queryParams: {},
        requestPath: '/nonexistent',
        originalURL: '/nonexistent',
      });

      expect(result.exists).toBe(false);
      expect(result.version).toBeUndefined();
      expect(result.result).toBeUndefined();
    });

    it('calls handler and returns result when handler exists', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const request = createMockRequest();
      const mockControlledReply = {
        header: mock(() => {}),
        getHeader: mock(() => undefined),
        getHeaders: mock(() => ({})),
        removeHeader: mock(() => {}),
        hasHeader: mock(() => false),
        sent: false,
        raw: { destroyed: false },
      };

      helpers.pageDataHandlerMethod.register('test-page', () =>
        APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { test: true },
          pageMetadata: { title: 'Test', description: 'Test page' },
        }),
      );

      const result = await helpers.callHandler({
        originalRequest: request,
        controlledReply: mockControlledReply as any,
        pageType: 'test-page',
        routeParams: {},
        queryParams: {},
        requestPath: '/test-page',
        originalURL: '/test-page',
      });

      expect(result.exists).toBe(true);
      expect(result.version).toBe(1);
      expect(result.result).not.toBe(false);
      if (result.result) {
        expect(result.result.status).toBe('success');
        expect((result.result as any).data).toEqual({ test: true });
      }
    });

    it('selects highest version when registered out of order', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const request = createMockRequest();
      const mockControlledReply = {
        header: mock(() => {}),
        getHeader: mock(() => undefined),
        getHeaders: mock(() => ({})),
        removeHeader: mock(() => {}),
        hasHeader: mock(() => false),
        sent: false,
        raw: { destroyed: false },
      };

      // Register versions out of order: 3, 1, 5, 2
      helpers.pageDataHandlerMethod.register('multi', 3, () =>
        APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { version: 3 },
          pageMetadata: { title: 'V3', description: 'Version 3' },
        }),
      );

      helpers.pageDataHandlerMethod.register('multi', 1, () =>
        APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { version: 1 },
          pageMetadata: { title: 'V1', description: 'Version 1' },
        }),
      );

      helpers.pageDataHandlerMethod.register('multi', 5, () =>
        APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { version: 5 },
          pageMetadata: { title: 'V5', description: 'Version 5' },
        }),
      );

      helpers.pageDataHandlerMethod.register('multi', 2, () =>
        APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { version: 2 },
          pageMetadata: { title: 'V2', description: 'Version 2' },
        }),
      );

      const result = await helpers.callHandler({
        originalRequest: request,
        controlledReply: mockControlledReply as any,
        pageType: 'multi',
        routeParams: {},
        queryParams: {},
        requestPath: '/multi',
        originalURL: '/multi',
      });

      // Should use latest version (5) even though registered out of order
      expect(result.exists).toBe(true);
      expect(result.version).toBe(5);
      expect((result.result as any).data).toEqual({ version: 5 });
    });

    it('returns exists: false when page type is empty', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const request = createMockRequest();
      const mockControlledReply = {
        header: mock(() => {}),
        getHeader: mock(() => undefined),
        getHeaders: mock(() => ({})),
        removeHeader: mock(() => {}),
        hasHeader: mock(() => false),
        sent: false,
        raw: { destroyed: false },
      };

      return expect(
        Promise.resolve().then(() =>
          helpers.callHandler({
            originalRequest: request,
            controlledReply: mockControlledReply as any,
            pageType: '', // Empty page type
            routeParams: {},
            queryParams: {},
            requestPath: '/',
            originalURL: '/',
          }),
        ),
      ).rejects.toThrow(/Page type cannot be empty/);
    });

    it('handles timeout when handler takes too long', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const request = createMockRequest();
      const mockControlledReply = {
        header: mock(() => {}),
        getHeader: mock(() => undefined),
        getHeaders: mock(() => ({})),
        removeHeader: mock(() => {}),
        hasHeader: mock(() => false),
        sent: false,
        raw: { destroyed: false },
      };

      helpers.pageDataHandlerMethod.register('slow-page', async () => {
        // Simulate slow handler
        await new Promise((resolve) => setTimeout(resolve, 100));
        return APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { slow: true },
          pageMetadata: { title: 'Slow', description: 'Slow page' },
        });
      });

      return expect(
        Promise.resolve().then(() =>
          helpers.callHandler({
            originalRequest: request,
            controlledReply: mockControlledReply as any,
            pageType: 'slow-page',
            timeoutMS: 10, // Very short timeout
            routeParams: {},
            queryParams: {},
            requestPath: '/slow',
            originalURL: '/slow',
          }),
        ),
      ).rejects.toThrow(/timeout/i);
    });

    it('completes successfully when handler finishes before timeout', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const request = createMockRequest();
      const mockControlledReply = {
        header: mock(() => {}),
        getHeader: mock(() => undefined),
        getHeaders: mock(() => ({})),
        removeHeader: mock(() => {}),
        hasHeader: mock(() => false),
        sent: false,
        raw: { destroyed: false },
      };

      helpers.pageDataHandlerMethod.register('fast-page', async () => {
        // Fast handler
        await new Promise((resolve) => setTimeout(resolve, 5));
        return APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { fast: true },
          pageMetadata: { title: 'Fast', description: 'Fast page' },
        });
      });

      const result = await helpers.callHandler({
        originalRequest: request,
        controlledReply: mockControlledReply as any,
        pageType: 'fast-page',
        timeoutMS: 1000, // Long timeout
        routeParams: {},
        queryParams: {},
        requestPath: '/fast',
        originalURL: '/fast',
      });

      expect(result.exists).toBe(true);
      expect((result.result as any).data).toEqual({ fast: true });
    });

    it('returns false result when handler returns false with response sent', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const request = createMockRequest();
      const mockControlledReply = {
        header: mock(() => {}),
        getHeader: mock(() => undefined),
        getHeaders: mock(() => ({})),
        removeHeader: mock(() => {}),
        hasHeader: mock(() => false),
        sent: true, // Mark as sent
        raw: { destroyed: false },
      };

      helpers.pageDataHandlerMethod.register(
        'custom-response',
        (_req, reply) => {
          // Simulate handler that sends custom response
          (reply as any).sent = true;
          return false;
        },
      );

      const result = await helpers.callHandler({
        originalRequest: request,
        controlledReply: mockControlledReply as any,
        pageType: 'custom-response',
        routeParams: {},
        queryParams: {},
        requestPath: '/custom',
        originalURL: '/custom',
      });

      expect(result.exists).toBe(true);
      expect(result.version).toBe(1);
      expect(result.result).toBe(false);
    });

    it('throws error when handler returns invalid envelope via callHandler', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const request = createMockRequest();
      const mockControlledReply = {
        header: mock(() => {}),
        getHeader: mock(() => undefined),
        getHeaders: mock(() => ({})),
        removeHeader: mock(() => {}),
        hasHeader: mock(() => false),
        sent: false,
        raw: { destroyed: false },
      };

      helpers.pageDataHandlerMethod.register('bad-envelope', () => {
        return { invalid: 'envelope' } as any;
      });

      return expect(
        Promise.resolve().then(() =>
          helpers.callHandler({
            originalRequest: request,
            controlledReply: mockControlledReply as any,
            pageType: 'bad-envelope',
            routeParams: {},
            queryParams: {},
            requestPath: '/bad',
            originalURL: '/bad',
          }),
        ),
      ).rejects.toThrow(/invalid response envelope/i);
    });
  });

  describe('Handler execution integration tests', () => {
    it('executes handler with valid request body', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      const handlerSpy = mock((_req: any, _reply: any, params: any) => {
        expect(params.routeParams).toEqual({ id: '123' });
        expect(params.queryParams).toEqual({ tab: 'info' });
        expect(params.requestPath).toBe('/users/123');
        expect(params.originalURL).toBe('/users/123?tab=info');
        return APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: { userID: 123 },
          pageMetadata: { title: 'User', description: 'User page' },
        });
      });

      helpers.pageDataHandlerMethod.register('user', handlerSpy);
      helpers.registerRoutes(fastify, '/api', 'page_data', { versioned: true });

      const request = createMockRequest({
        body: {
          route_params: { id: '123' },
          query_params: { tab: 'info' },
          request_path: '/users/123',
          original_url: '/users/123?tab=info',
        },
      });
      const reply = createMockReply();

      const handler = (fastify as any)._routes[0]?.handler;
      if (handler) {
        const result = await handler(request, reply);
        expect(handlerSpy).toHaveBeenCalled();
        expect(result.data).toEqual({ userID: 123 });
      }
    });

    it('returns 400 when request_path is missing', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('test', () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Test', description: 'Test' },
        }),
      );
      helpers.registerRoutes(fastify, '/api', 'page_data', { versioned: true });

      const request = createMockRequest({
        body: {
          // missing request_path
          original_url: '/test',
        },
      });
      const reply = createMockReply();

      const handler = (fastify as any)._routes[0]?.handler;
      if (handler) {
        await handler(request, reply);
        expect((reply as any).code).toHaveBeenCalledWith(400);
        expect((reply as any)._sent.error.code).toBe(
          'invalid_page_data_body_fields',
        );
      }
    });

    it('returns 400 when original_url is missing', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('test', () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Test', description: 'Test' },
        }),
      );
      helpers.registerRoutes(fastify, '/api', 'page_data', { versioned: true });

      const request = createMockRequest({
        body: {
          request_path: '/test',
          // missing original_url
        },
      });
      const reply = createMockReply();

      const handler = (fastify as any)._routes[0]?.handler;
      if (handler) {
        await handler(request, reply);
        expect((reply as any).code).toHaveBeenCalledWith(400);
      }
    });

    it('returns 400 when route_params is invalid type (array)', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('test', () =>
        APIResponseHelpers.createPageSuccessResponse({
          request: createMockRequest(),
          data: {},
          pageMetadata: { title: 'Test', description: 'Test' },
        }),
      );
      helpers.registerRoutes(fastify, '/api', 'page_data', { versioned: true });

      const request = createMockRequest({
        body: {
          request_path: '/test',
          original_url: '/test',
          route_params: ['invalid'], // Should be object, not array
        },
      });
      const reply = createMockReply();

      const handler = (fastify as any)._routes[0]?.handler;
      if (handler) {
        await handler(request, reply);
        expect((reply as any).code).toHaveBeenCalledWith(400);
      }
    });

    it('merges SSR request context when from SSR server', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      const handlerSpy = mock((req: any) => {
        expect(req.requestContext).toEqual({
          userID: '789',
          role: 'admin',
        });
        return APIResponseHelpers.createPageSuccessResponse({
          request: req,
          data: {},
          pageMetadata: { title: 'Test', description: 'Test' },
        });
      });

      helpers.pageDataHandlerMethod.register('test', handlerSpy);
      helpers.registerRoutes(fastify, '/api', 'page_data', { versioned: true });

      const request = createMockRequest({
        body: {
          request_path: '/test',
          original_url: '/test',
          ssr_request_context: { userID: '789', role: 'admin' },
        },
        clientInfo: {
          requestID: 'test-req-123',
          correlationID: 'test-corr-123',
          isFromSSRServerAPICall: true,
          IPAddress: '127.0.0.1',
          userAgent: 'test-agent',
          isIPFromHeader: false,
          isUserAgentFromHeader: false,
        },
      });

      const reply = createMockReply();

      const handler = (fastify as any)._routes[0]?.handler;

      if (handler) {
        await handler(request, reply);
        expect(handlerSpy).toHaveBeenCalled();
      }
    });

    it('does not merge SSR context when not from SSR server', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      const handlerSpy = mock((req: any) => {
        expect(req.requestContext).toBeUndefined();
        return APIResponseHelpers.createPageSuccessResponse({
          request: req,
          data: {},
          pageMetadata: { title: 'Test', description: 'Test' },
        });
      });

      helpers.pageDataHandlerMethod.register('test', handlerSpy);
      helpers.registerRoutes(fastify, '/api', 'page_data', { versioned: true });

      const request = createMockRequest({
        body: {
          request_path: '/test',
          original_url: '/test',
          ssr_request_context: { userID: '789' },
        },
        clientInfo: {
          requestID: 'test-req-456',
          correlationID: 'test-corr-456',
          isFromSSRServerAPICall: false, // Not from SSR
          IPAddress: '192.168.1.1',
          userAgent: 'test-agent',
          isIPFromHeader: false,
          isUserAgentFromHeader: false,
        },
      });
      const reply = createMockReply();

      const handler = (fastify as any)._routes[0]?.handler;
      if (handler) {
        await handler(request, reply);
        expect(handlerSpy).toHaveBeenCalled();
      }
    });

    it('throws error when handler returns false without sending response', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('bad-handler', () => {
        return false; // Returns false but doesn't send response
      });
      helpers.registerRoutes(fastify, '/api', 'page_data', { versioned: true });

      const request = createMockRequest({
        body: {
          request_path: '/test',
          original_url: '/test',
        },
      });
      const reply = createMockReply();
      (reply as any).sent = false; // Mark as not sent

      const handler = (fastify as any)._routes[0]?.handler;
      if (handler) {
        return expect(
          Promise.resolve().then(() => handler(request, reply)),
        ).rejects.toThrow(/returned false but did not send a response/i);
      }
    });

    it('throws error when handler returns invalid envelope', () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('invalid-handler', () => {
        return { invalid: true } as any;
      });
      helpers.registerRoutes(fastify, '/api', 'page_data', { versioned: true });

      const request = createMockRequest({
        body: {
          request_path: '/test',
          original_url: '/test',
        },
      });
      const reply = createMockReply();

      const handler = (fastify as any)._routes[0]?.handler;
      if (handler) {
        return expect(
          Promise.resolve().then(() => handler(request, reply)),
        ).rejects.toThrow(/invalid response envelope/i);
      }
    });

    it('sets Cache-Control header for error responses', async () => {
      const helpers = new DataLoaderServerHandlerHelpers();
      const fastify = createMockFastify();

      helpers.pageDataHandlerMethod.register('error-handler', () =>
        APIResponseHelpers.createPageErrorResponse({
          request: createMockRequest(),
          statusCode: 404,
          errorCode: 'not_found',
          errorMessage: 'Not found',
          pageMetadata: { title: 'Error', description: 'Error' },
        }),
      );
      helpers.registerRoutes(fastify, '/api', 'page_data', { versioned: true });

      const request = createMockRequest({
        body: {
          request_path: '/test',
          original_url: '/test',
        },
      });
      const reply = createMockReply();

      const handler = (fastify as any)._routes[0]?.handler;
      if (handler) {
        await handler(request, reply);
        expect((reply as any).header).toHaveBeenCalledWith(
          'Cache-Control',
          'no-store',
        );
        expect((reply as any).code).toHaveBeenCalledWith(404);
      }
    });
  });
});

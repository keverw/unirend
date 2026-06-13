import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import getPort from 'get-port';
import { serveAPI, servePlain } from '../api';
import type { APIServer } from './api-server';
import { APIResponseHelpers } from '../../api-envelope';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type {
  APIErrorHandlerParams,
  APIServerAPIOptions,
  APIServerWebOptions,
  PlainServerOptions,
  PluginHostInstance,
  WebErrorHandlerFn,
  WebNotFoundHandlerFn,
} from '../types';
import type { PlainServer } from '../api';

class CustomAPIResponseHelpers extends APIResponseHelpers {}

const _apiModeOptionsTypeCheck = {
  errorHandler: (request, error, isDevelopment, isPageData, params) =>
    params.APIResponseHelpers.createAPIErrorResponse({
      request,
      statusCode: 500,
      errorCode: 'typed_api_error',
      errorMessage: isDevelopment && isPageData ? error.message : 'Error',
    }),
} satisfies APIServerAPIOptions;

const _webModeOptionsTypeCheck = {
  apiEndpoints: { apiEndpointPrefix: false },
  errorHandler: (_request: FastifyRequest, error: Error) => ({
    contentType: 'json',
    content: { message: error.message },
    statusCode: 500,
  }),
} satisfies APIServerWebOptions;

const _webModeSplitOptionsTypeCheck = {
  apiEndpoints: { apiEndpointPrefix: false },
  errorHandler: {
    web: (_request: FastifyRequest, error: Error) => ({
      contentType: 'text',
      content: error.message,
      statusCode: 500,
    }),
  },
} satisfies APIServerWebOptions;

const _apiModeRejectsWebFunctionTypeCheck = {
  // @ts-expect-error API mode function-form error handlers must return envelopes.
  errorHandler: () => ({
    contentType: 'json',
    content: { ok: false },
    statusCode: 500,
  }),
} satisfies APIServerAPIOptions;

const _webModeRejectsEnvelopeFunctionTypeCheck = {
  apiEndpoints: { apiEndpointPrefix: false },
  // @ts-expect-error Plain web mode function-form error handlers must return WebResponse.
  errorHandler: (
    request: FastifyRequest,
    _error: Error,
    _isDevelopment: boolean,
    _isPageData: boolean | undefined,
    params: APIErrorHandlerParams,
  ) =>
    params.APIResponseHelpers.createAPIErrorResponse({
      request,
      statusCode: 500,
      errorCode: 'typed_web_error',
      errorMessage: 'Error',
    }),
} satisfies APIServerWebOptions;

const _plainServerOptionsTypeCheck = {
  plugins: [
    (pluginHost: PluginHostInstance<'plain'>) => {
      pluginHost.get('/ok', () => ({ ok: true }));
    },
  ],
  errorHandler: (_request: FastifyRequest, error: Error) => ({
    contentType: 'json',
    content: { message: error.message },
    statusCode: 500,
  }),
} satisfies PlainServerOptions;

const _plainServerRejectsAPIEndpointTypeCheck = {
  // @ts-expect-error servePlain() owns apiEndpointPrefix: false internally.
  apiEndpoints: { apiEndpointPrefix: false },
} satisfies PlainServerOptions;

const _plainServerRejectsSplitHandlerTypeCheck = {
  errorHandler: {
    // @ts-expect-error servePlain() exposes simple web handler functions, not split handlers.
    web: () => ({
      contentType: 'text',
      content: 'error',
      statusCode: 500,
    }),
  },
} satisfies PlainServerOptions;

function _plainServerReturnTypeCheck(server: PlainServer): void {
  // @ts-expect-error PlainServer does not expose envelope API route helpers.
  void server.api;
  // @ts-expect-error PlainServer does not expose page-data route helpers.
  void server.pageDataHandler;
}

/**
 * Covers the public methods on APIServer that are not exercised by the
 * closing/logging test suites: updateAccessLoggingConfig, the `api` and
 * `pageDataHandler` getters, and registerWebSocketHandler's throw path.
 */
describe('APIServer public methods', () => {
  let server: APIServer | null = null;
  let port: number;

  beforeEach(async () => {
    port = await getPort();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  describe('updateAccessLoggingConfig()', () => {
    it('can be called before listen() without throwing', () => {
      const s = serveAPI();
      server = s;
      expect(() => {
        s.updateAccessLoggingConfig({ events: 'none' });
      }).not.toThrow();
    });

    it('can be called after listen() without throwing', async () => {
      const s = serveAPI();
      server = s;
      await s.listen(port, 'localhost');
      expect(() => {
        s.updateAccessLoggingConfig({ events: 'finish' });
      }).not.toThrow();
    });

    it('accepts a partial update with just template', async () => {
      const s = serveAPI();
      server = s;
      await s.listen(port, 'localhost');
      expect(() => {
        s.updateAccessLoggingConfig({
          responseTemplate: '{{method}} {{url}} {{statusCode}}',
        });
      }).not.toThrow();
    });
  });

  describe('.api getter', () => {
    it('returns the apiMethod object before listen()', () => {
      server = serveAPI();
      const api = server.api;
      expect(typeof api).toBe('object');
      expect(api).not.toBeNull();
    });

    it('apiMethod has get/post/put/patch/delete helpers', () => {
      server = serveAPI();
      const api = server.api;
      expect(typeof api.get).toBe('function');
      expect(typeof api.post).toBe('function');
      expect(typeof api.put).toBe('function');
      expect(typeof api.patch).toBe('function');
      expect(typeof api.delete).toBe('function');
    });
  });

  describe('.pageDataHandler getter', () => {
    it('returns the pageDataHandlerMethod object before listen()', () => {
      server = serveAPI();
      const pdh = server.pageDataHandler;
      expect(typeof pdh).toBe('object');
      expect(pdh).not.toBeNull();
    });

    it('pageDataHandlerMethod has a register function', () => {
      server = serveAPI();
      const pdh = server.pageDataHandler;
      expect(typeof pdh.register).toBe('function');
    });
  });

  describe('registerWebSocketHandler()', () => {
    it('throws when WebSocket support is not enabled', () => {
      // serveAPI() does not enable WebSocket by default
      const s = serveAPI();
      server = s;
      expect(() => {
        s.registerWebSocketHandler({
          path: '/ws',
          handler: () => {},
        });
      }).toThrow(/WebSocket support is not enabled/);
    });

    it('error message includes guidance to set enableWebSockets: true', () => {
      server = serveAPI();
      let caught: Error | undefined;
      try {
        server.registerWebSocketHandler({ path: '/ws', handler: () => {} });
      } catch (error) {
        caught = error as Error;
      }
      expect(caught).toBeDefined();
      expect(caught?.message).toContain('enableWebSockets');
    });
  });

  describe('error/not-found handler params', () => {
    it('passes APIResponseHelpersClass to standalone API error handlers', async () => {
      const errorHandler = mock(
        (
          request: FastifyRequest,
          error: Error,
          _isDevelopment: boolean,
          _isPageData: boolean | undefined,
          params: { APIResponseHelpers: typeof APIResponseHelpers },
        ) =>
          params.APIResponseHelpers.createAPIErrorResponse({
            request,
            statusCode: 500,
            errorCode: 'custom_error',
            errorMessage: error.message,
          }),
      );

      server = serveAPI({
        APIResponseHelpersClass: CustomAPIResponseHelpers,
        errorHandler,
      });
      server.api.get('boom', () => {
        throw new Error('boom');
      });
      await server.listen(port, 'localhost');

      const fastify = (
        server as unknown as { fastifyInstance: FastifyInstance }
      ).fastifyInstance;
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/boom',
      });

      expect(response.statusCode).toBe(500);
      expect(errorHandler.mock.calls[0][4]).toEqual({
        APIResponseHelpers: CustomAPIResponseHelpers,
      });
    });

    it('passes APIResponseHelpersClass to standalone API not-found handlers', async () => {
      const notFoundHandler = mock(
        (
          request: FastifyRequest,
          _isPageData: boolean | undefined,
          params: { APIResponseHelpers: typeof APIResponseHelpers },
        ) =>
          params.APIResponseHelpers.createAPIErrorResponse({
            request,
            statusCode: 404,
            errorCode: 'custom_not_found',
            errorMessage: 'Custom not found',
          }),
      );

      server = serveAPI({
        APIResponseHelpersClass: CustomAPIResponseHelpers,
        notFoundHandler,
      });
      await server.listen(port, 'localhost');

      const fastify = (
        server as unknown as { fastifyInstance: FastifyInstance }
      ).fastifyInstance;
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/v1/missing',
      });

      expect(response.statusCode).toBe(404);
      expect(notFoundHandler.mock.calls[0][2]).toEqual({
        APIResponseHelpers: CustomAPIResponseHelpers,
      });
    });
  });

  describe('plain web server mode', () => {
    it('uses function-form WebResponse error handlers when API handling is disabled', async () => {
      server = serveAPI({
        apiEndpoints: { apiEndpointPrefix: false },
        plugins: [
          (pluginHost: PluginHostInstance<'plain'>) => {
            pluginHost.get('/boom', () => {
              throw new Error('boom');
            });
          },
        ],
        errorHandler: ((_request, error, isDevelopment) => ({
          contentType: 'json',
          content: {
            message: error.message,
            isDevelopment,
          },
          statusCode: 418,
        })) as WebErrorHandlerFn,
      });
      await server.listen(port, 'localhost');

      const fastify = (
        server as unknown as { fastifyInstance: FastifyInstance }
      ).fastifyInstance;
      const response = await fastify.inject({
        method: 'GET',
        url: '/boom',
      });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(418);
      expect(response.headers['content-type']).toContain('application/json');
      expect(body).toEqual({
        message: 'boom',
        isDevelopment: false,
      });
      expect(body.status).toBeUndefined();
      expect(body.status_code).toBeUndefined();
    });

    it('uses function-form WebResponse not-found handlers when API handling is disabled', async () => {
      server = serveAPI({
        apiEndpoints: { apiEndpointPrefix: false },
        notFoundHandler: ((request) => ({
          contentType: 'text',
          content: `Missing ${request.url}`,
          statusCode: 410,
        })) as WebNotFoundHandlerFn,
      });
      await server.listen(port, 'localhost');

      const fastify = (
        server as unknown as { fastifyInstance: FastifyInstance }
      ).fastifyInstance;
      const response = await fastify.inject({
        method: 'GET',
        url: '/missing',
      });

      expect(response.statusCode).toBe(410);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.body).toBe('Missing /missing');
    });

    it('uses default web responses when API handling is disabled', async () => {
      server = serveAPI({
        apiEndpoints: { apiEndpointPrefix: false },
        plugins: [
          (pluginHost: PluginHostInstance<'plain'>) => {
            pluginHost.get('/boom', () => {
              throw new Error('boom');
            });
          },
        ],
      });
      await server.listen(port, 'localhost');

      const fastify = (
        server as unknown as { fastifyInstance: FastifyInstance }
      ).fastifyInstance;

      const errorResponse = await fastify.inject({
        method: 'GET',
        url: '/boom',
      });
      const notFoundResponse = await fastify.inject({
        method: 'GET',
        url: '/missing',
      });

      expect(errorResponse.statusCode).toBe(500);
      expect(errorResponse.headers['content-type']).toContain('text/html');
      expect(errorResponse.body).toContain('500 - Internal Server Error');
      expect(notFoundResponse.statusCode).toBe(404);
      expect(notFoundResponse.headers['content-type']).toContain('text/html');
      expect(notFoundResponse.body).toContain('404 - Not Found');
    });

    it('throws immediately when plugins use envelope shortcuts while API handling is disabled', () => {
      server = serveAPI({
        apiEndpoints: { apiEndpointPrefix: false },
        plugins: [
          (pluginHost: PluginHostInstance<'plain'>) => {
            const api = pluginHost.api as unknown as {
              get: (path: string, handler: () => unknown) => void;
            };
            api.get('bad', () => ({ ok: true }));
          },
        ],
      });

      expect(server.listen(port, 'localhost')).rejects.toThrow(
        /Cannot register pluginHost\.api\.\* handlers because API handling is disabled/,
      );
    });

    it('throws immediately when plugins use page data shortcuts while API handling is disabled', () => {
      server = serveAPI({
        apiEndpoints: { apiEndpointPrefix: false },
        plugins: [
          (pluginHost: PluginHostInstance<'plain'>) => {
            const pageDataHandler = pluginHost.pageDataHandler as unknown as {
              register: (pageType: string, handler: () => unknown) => void;
            };
            pageDataHandler.register('bad', () => ({ ok: true }));
          },
        ],
      });

      expect(server.listen(port, 'localhost')).rejects.toThrow(
        /Cannot register pluginHost\.pageDataHandler\.\* handlers because API handling is disabled/,
      );
    });

    it('servePlain() uses plain web mode without requiring apiEndpoints', async () => {
      server = servePlain({
        plugins: [
          (pluginHost: PluginHostInstance<'plain'>) => {
            pluginHost.get('/hello', () => ({ message: 'hello' }));
          },
        ],
        notFoundHandler: (request) => ({
          contentType: 'text',
          content: `Missing ${request.url}`,
          statusCode: 404,
        }),
      }) as APIServer;
      await server.listen(port, 'localhost');

      const fastify = (
        server as unknown as { fastifyInstance: FastifyInstance }
      ).fastifyInstance;

      const okResponse = await fastify.inject({
        method: 'GET',
        url: '/hello',
      });
      const missingResponse = await fastify.inject({
        method: 'GET',
        url: '/missing',
      });

      expect(okResponse.statusCode).toBe(200);
      const okBody: { message: string } = okResponse.json();
      expect(okBody).toEqual({ message: 'hello' });
      expect(missingResponse.statusCode).toBe(404);
      expect(missingResponse.headers['content-type']).toContain('text/plain');
      expect(missingResponse.body).toBe('Missing /missing');
    });
  });
});

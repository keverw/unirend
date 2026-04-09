import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import getPort from 'get-port';
import { overrideDevMode } from 'lifecycleion/dev-mode';
import type { LoaderFunctionArgs } from 'react-router';
import {
  createDefaultLocalPageDataLoaderConfig,
  createDefaultPageDataLoaderConfig,
  createPageDataLoader,
} from './page-data-loader';

function createArgs(
  path = 'https://example.com/local',
  params: Record<string, string> = {},
): LoaderFunctionArgs {
  return {
    request: new Request(path),
    params,
    context: undefined,
    unstable_pattern: '',
  };
}

function createPageEnvelope(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    status: 'success',
    status_code: 200,
    request_id: 'req_page',
    type: 'page',
    data: { ok: true },
    meta: {
      page: {
        title: 'Page',
        description: 'Page description',
      },
    },
    error: null,
    ...overrides,
  };
}

function withWindow<T>(
  value: unknown,
  run: () => Promise<T> | T,
): Promise<T> | T {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value,
    configurable: true,
  });

  const cleanup = () => {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  };

  try {
    const result = run();
    if (result instanceof Promise) {
      return result.finally(cleanup);
    }

    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

describe('createDefaultLocalPageDataLoaderConfig', () => {
  it('returns the defaults required by local page data loaders', () => {
    const config = createDefaultLocalPageDataLoaderConfig();

    expect(config.timeoutMS).toBe(10000);
    expect(config.errorDefaults.internalError.code).toBe(
      'internal_server_error',
    );
    expect(config.connectionErrorMessages?.server).toContain(
      'Unable to connect to the API service',
    );
    expect(config.loginURL).toBe('/login');
  });

  it('deep-clones nested defaults', () => {
    const first = createDefaultLocalPageDataLoaderConfig();
    const second = createDefaultLocalPageDataLoaderConfig();

    first.errorDefaults.internalError.title = 'Changed';

    expect(second.errorDefaults.internalError.title).toBe('Server Error');
  });

  it('applies local overrides', () => {
    const config = createDefaultLocalPageDataLoaderConfig({
      timeoutMS: 8000,
      connectionErrorMessages: {
        server: 'Local timeout',
      },
    });

    expect(config.timeoutMS).toBe(8000);
    expect(config.connectionErrorMessages?.server).toBe('Local timeout');
  });
});

describe('local page data loader', () => {
  afterEach(() => {
    overrideDevMode(false);
  });

  it('converts thrown handler errors into a 500 page envelope', async () => {
    const loader = createPageDataLoader(
      createDefaultLocalPageDataLoaderConfig(),
      () => {
        throw new Error('Boom');
      },
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(500);
    expect(result.type).toBe('page');
    expect(result.error?.code).toBe('internal_server_error');
    expect(result.error?.message).toBe('An internal server error occurred.');
    expect(result.error?.details).toBeUndefined();
  });

  it('includes debug details for thrown handler errors in development mode', async () => {
    overrideDevMode(true);

    const loader = createPageDataLoader(
      createDefaultLocalPageDataLoaderConfig(),
      () => {
        throw new Error('Boom');
      },
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status_code).toBe(500);
    expect(result.error?.details?.message).toBe('Boom');
    expect(result.error?.details?.stack).toContain('Error: Boom');
  });

  it('stringifies non-Error thrown values in development mode', async () => {
    overrideDevMode(true);

    const loader = createPageDataLoader(
      createDefaultLocalPageDataLoaderConfig(),
      () => {
        throw 'Boom string';
      },
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status_code).toBe(500);
    expect(result.error?.details).toEqual({
      value: 'Boom string',
    });
  });

  it('returns invalid response errors for non-envelope local results', async () => {
    const loader = createPageDataLoader(
      createDefaultLocalPageDataLoaderConfig(),
      (() => ({ ok: true })) as any,
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(500);
    expect(result.error?.code).toBe('invalid_response');
  });

  it('preserves redirect envelopes returned by the handler', async () => {
    const loader = createPageDataLoader(
      createDefaultLocalPageDataLoaderConfig(),
      () =>
        ({
          status: 'redirect' as const,
          status_code: 200,
          request_id: 'req_redirect',
          type: 'page' as const,
          data: null,
          meta: {
            page: {
              title: 'Redirect',
              description: 'Redirecting',
            },
          },
          error: null,
          redirect: {
            target: '/next',
            permanent: false,
          },
        }) as any,
    );

    const result = (await loader(createArgs())) as Response;

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe('/next');
  });

  it('preserves explicit 500 page error envelopes returned by the handler', async () => {
    const loader = createPageDataLoader(
      createDefaultLocalPageDataLoaderConfig(),
      () => ({
        status: 'error' as const,
        status_code: 500,
        request_id: 'req_500',
        type: 'page' as const,
        data: null,
        meta: {
          page: {
            title: 'Local 500',
            description: 'Explicit 500 envelope',
          },
        },
        error: {
          code: 'explicit_500',
          message: 'Explicit 500 envelope',
        },
      }),
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(500);
    expect(result.error?.code).toBe('explicit_500');
  });

  it('preserves explicit 503 page error envelopes returned by the handler', async () => {
    const loader = createPageDataLoader(
      createDefaultLocalPageDataLoaderConfig(),
      () => ({
        status: 'error' as const,
        status_code: 503,
        request_id: 'req_503',
        type: 'page' as const,
        data: null,
        meta: {
          page: {
            title: 'Maintenance',
            description: 'Explicit 503 envelope',
          },
        },
        error: {
          code: 'service_unavailable',
          message: 'Service temporarily unavailable',
        },
      }),
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(503);
    expect(result.error?.code).toBe('service_unavailable');
  });

  it('includes timeout debug details in development mode', async () => {
    overrideDevMode(true);

    const loader = createPageDataLoader(
      createDefaultLocalPageDataLoaderConfig({
        timeoutMS: 10,
      }),
      async () => {
        await Bun.sleep(50);
        return createPageEnvelope() as any;
      },
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status_code).toBe(500);
    expect(result.error?.details?.errorCode).toBe('handler_timeout');
    expect(result.error?.details?.timeoutMS).toBe(10);
  });

  it('supports disabling local timeout with timeoutMS 0', async () => {
    const loader = createPageDataLoader(
      createDefaultLocalPageDataLoaderConfig({
        timeoutMS: 0,
      }),
      async () => {
        await Bun.sleep(15);
        return createPageEnvelope({
          request_id: 'req_no_timeout',
        }) as any;
      },
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('success');
    expect(result.request_id).toBe('req_no_timeout');
  });
});

describe('HTTP-backed page data loader', () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let port: number;
  const originalFetch = globalThis.fetch;
  const originalNavigator = globalThis.navigator;

  beforeEach(async () => {
    port = await getPort({ host: '127.0.0.1' });
    overrideDevMode(false);
    globalThis.fetch = originalFetch;
    if (originalNavigator !== undefined) {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  afterEach(() => {
    void server?.stop(true);
    server = null;
    overrideDevMode(false);
    globalThis.fetch = originalFetch;
    if (originalNavigator === undefined) {
      delete (globalThis as { navigator?: unknown }).navigator;
    } else {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  function startServer(
    handler: (request: Request) => Response | Promise<Response>,
  ): string {
    server = Bun.serve({
      port,
      fetch: handler,
    });

    return `http://127.0.0.1:${port}`;
  }

  it('returns successful page envelope responses as-is', async () => {
    const baseURL = startServer(() =>
      Response.json(
        createPageEnvelope({
          request_id: 'req_success',
          data: { message: 'hello' },
        }),
      ),
    );

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'home',
    );

    const result = (await loader(
      createArgs('https://app.example.com/home?tab=latest', { slug: 'home' }),
    )) as Record<string, any>;

    expect(result.status).toBe('success');
    expect(result.status_code).toBe(200);
    expect(result.data).toEqual({ message: 'hello' });
  });

  it('returns invalid response errors for non-envelope JSON responses', async () => {
    const baseURL = startServer(() =>
      Response.json({
        status: 'success',
        type: 'api',
        request_id: 'req_api_success',
        data: { ok: true },
        meta: {},
        error: null,
      }),
    );

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'home',
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(500);
    expect(result.error?.code).toBe('invalid_response');
  });

  it('returns invalid response errors for non-json responses without handlers', async () => {
    const baseURL = startServer(
      () =>
        new Response('<html>bad</html>', {
          status: 502,
          headers: {
            'Content-Type': 'text/html',
          },
        }),
    );

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'home',
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(502);
    expect(result.error?.code).toBe('invalid_response');
  });

  it('processes redirect envelopes into Response redirects', async () => {
    const baseURL = startServer(() =>
      Response.json(
        createPageEnvelope({
          status: 'redirect',
          redirect: {
            target: '/login',
            permanent: false,
          },
        }),
      ),
    );

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'home',
    );

    const result = (await loader(createArgs())) as Response;

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe('/login');
  });

  it('converts 404 API error responses into 404 page envelopes', async () => {
    const baseURL = startServer(() =>
      Response.json(
        {
          status: 'error',
          status_code: 404,
          request_id: 'req_404',
          type: 'api',
          data: null,
          meta: {},
          error: {
            code: 'not_found',
            message: 'Missing',
          },
        },
        { status: 404 },
      ),
    );

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'missing',
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(404);
    expect(result.error?.code).toBe('not_found');
  });

  it('converts 500 API error responses into 500 page envelopes and includes details in development mode', async () => {
    overrideDevMode(true);

    const baseURL = startServer(() =>
      Response.json(
        {
          status: 'error',
          status_code: 500,
          request_id: 'req_500',
          type: 'api',
          data: null,
          meta: {},
          error: {
            code: 'server_error',
            message: 'Boom',
            details: {
              stack: 'stacktrace',
            },
          },
        },
        { status: 500 },
      ),
    );

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'boom',
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(500);
    expect(result.error?.code).toBe('internal_server_error');
    expect(result.error?.details).toEqual({ stack: 'stacktrace' });
  });

  it('returns timeout-based 500 page envelopes when the fetch exceeds timeoutMS', async () => {
    const baseURL = startServer(async () => {
      await Bun.sleep(50);
      return Response.json(createPageEnvelope());
    });

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL, {
        timeoutMS: 10,
        connectionErrorMessages: {
          server: 'Timed out talking to page data service',
        },
      }),
      'slow',
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(500);
    expect(result.error?.code).toBe('internal_server_error');
    expect(result.error?.message).toBe(
      'Timed out talking to page data service',
    );
  });

  it('omits HTTP 500 error details outside development mode', async () => {
    const baseURL = startServer(() =>
      Response.json(
        {
          status: 'error',
          status_code: 500,
          request_id: 'req_500_prod',
          type: 'api',
          data: null,
          meta: {},
          error: {
            code: 'server_error',
            message: 'Boom',
            details: {
              stack: 'stacktrace',
            },
          },
        },
        { status: 500 },
      ),
    );

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'boom',
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(500);
    expect(result.error?.details).toBeUndefined();
  });

  it('applies custom statusCodeHandlers for HTTP responses', async () => {
    const baseURL = startServer(
      () =>
        new Response('teapot', {
          status: 418,
          headers: {
            'Content-Type': 'text/plain',
          },
        }),
    );

    const handler = mock(() => ({
      status: 'error' as const,
      status_code: 418,
      request_id: 'req_teapot',
      type: 'page' as const,
      data: null,
      meta: {
        page: {
          title: 'Teapot',
          description: 'Custom status handler',
        },
      },
      error: {
        code: 'teapot_error',
        message: 'Custom teapot',
      },
    }));

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL, {
        statusCodeHandlers: {
          ['418']: handler,
        },
      }),
      'teapot',
    );

    const result = (await loader(createArgs())) as Record<string, any>;

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('error');
    expect(result.status_code).toBe(418);
    expect(result.error?.code).toBe('teapot_error');
  });

  it('uses SSR short-circuit handlers when available', async () => {
    const callHandler = mock((params: Record<string, unknown>) => ({
      exists: true,
      result: createPageEnvelope({
        request_id: 'req_ssr_short_circuit',
        data: params,
      }),
    }));

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig('http://api.example.com'),
      'home',
    );

    const request = new Request('https://app.example.com/home?tab=latest');
    (
      request as Request & {
        SSRHelpers?: Record<string, unknown>;
      }
    ).SSRHelpers = {
      handlers: {
        hasHandler: () => true,
        callHandler,
      },
      fastifyRequest: {
        requestContext: {
          traceID: 'trace_1',
        },
      },
      controlledReply: {},
    };

    const result = (await loader({
      ...createArgs(),
      request,
      params: {
        slug: 'home',
      },
    })) as Record<string, any>;

    expect(callHandler).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.data.routeParams).toEqual({ slug: 'home' });
    expect(result.data.queryParams).toEqual({ tab: 'latest' });
    expect(result.data.requestPath).toBe('/home');
    expect(result.data.originalURL).toBe(
      'https://app.example.com/home?tab=latest',
    );
  });

  it('processes redirect envelopes returned by SSR short-circuit handlers', async () => {
    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig('http://api.example.com'),
      'home',
    );

    const request = new Request('https://app.example.com/home');
    (
      request as Request & {
        SSRHelpers?: Record<string, unknown>;
      }
    ).SSRHelpers = {
      handlers: {
        hasHandler: () => true,
        callHandler: () => ({
          exists: true,
          result: {
            status: 'redirect' as const,
            status_code: 200,
            request_id: 'req_ssr_redirect',
            type: 'page' as const,
            data: null,
            meta: {
              page: {
                title: 'Redirect',
                description: 'Redirecting',
              },
            },
            error: null,
            redirect: {
              target: '/next',
              permanent: false,
            },
          },
        }),
      },
      fastifyRequest: {},
      controlledReply: {},
    };

    const result = (await loader({
      ...createArgs(),
      request,
    })) as Response;

    expect(result).toBeInstanceOf(Response);
    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe('/next');
  });

  it('falls back to HTTP fetch when the SSR short-circuit handler reports no result', async () => {
    const baseURL = startServer(() =>
      Response.json(
        createPageEnvelope({
          request_id: 'req_fallback_http',
          data: { fallback: true },
        }),
      ),
    );

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'home',
    );

    const request = new Request('https://app.example.com/home');
    const callHandler = mock(() => ({
      exists: false,
      result: null,
    }));

    (
      request as Request & {
        SSRHelpers?: Record<string, unknown>;
      }
    ).SSRHelpers = {
      handlers: {
        hasHandler: () => true,
        callHandler,
      },
      fastifyRequest: {},
      controlledReply: {},
    };

    const result = (await loader({
      ...createArgs(),
      request,
    })) as Record<string, any>;

    expect(callHandler).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.data).toEqual({ fallback: true });
  });

  it('falls back to HTTP fetch when the SSR short-circuit result is malformed', async () => {
    const baseURL = startServer(() =>
      Response.json(
        createPageEnvelope({
          request_id: 'req_malformed_short_circuit',
          data: { fallback: 'malformed' },
        }),
      ),
    );

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'home',
    );

    const request = new Request('https://app.example.com/home');
    const callHandler = mock(() => ({
      exists: true,
      result: null,
    }));

    (
      request as Request & {
        SSRHelpers?: Record<string, unknown>;
      }
    ).SSRHelpers = {
      handlers: {
        hasHandler: () => true,
        callHandler,
      },
      fastifyRequest: {},
      controlledReply: {},
    };

    const result = (await loader({
      ...createArgs(),
      request,
    })) as Record<string, any>;

    expect(callHandler).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.data).toEqual({ fallback: 'malformed' });
  });

  it('falls back to HTTP fetch when the SSR short-circuit result is not a page envelope', async () => {
    const baseURL = startServer(() =>
      Response.json(
        createPageEnvelope({
          request_id: 'req_non_page_short_circuit',
          data: { fallback: 'api' },
        }),
      ),
    );

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'home',
    );

    const request = new Request('https://app.example.com/home');
    const callHandler = mock(() => ({
      exists: true,
      result: {
        status: 'success',
        status_code: 200,
        request_id: 'req_api_result',
        type: 'api',
        data: { ignored: true },
        meta: {},
        error: null,
      },
    }));

    (
      request as Request & {
        SSRHelpers?: Record<string, unknown>;
      }
    ).SSRHelpers = {
      handlers: {
        hasHandler: () => true,
        callHandler,
      },
      fastifyRequest: {},
      controlledReply: {},
    };

    const result = (await loader({
      ...createArgs(),
      request,
    })) as Record<string, any>;

    expect(callHandler).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
    expect(result.data).toEqual({ fallback: 'api' });
  });

  it('merges ssr_request_context back into the SSR request during HTTP fetches', async () => {
    const baseURL = startServer(async (request) => {
      const body = await request.json();

      expect(body).toHaveProperty('ssr_request_context', {
        traceID: 'trace_1',
      });

      return Response.json(
        createPageEnvelope({
          request_id: 'req_context_merge',
          ssr_request_context: {
            locale: 'en-US',
          },
        }),
      );
    });

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'home',
    );

    const request = new Request('https://app.example.com/home');
    const fastifyRequest: {
      requestContext: Record<string, unknown>;
    } = {
      requestContext: {
        traceID: 'trace_1',
      },
    };
    (
      request as Request & {
        SSRHelpers?: Record<string, unknown>;
      }
    ).SSRHelpers = {
      fastifyRequest,
    };

    const result = (await loader({
      ...createArgs(),
      request,
    })) as Record<string, any>;

    expect(result.status).toBe('success');
    expect(fastifyRequest.requestContext).toEqual({
      traceID: 'trace_1',
      locale: 'en-US',
    });
  });

  it('skips sending empty ssr_request_context objects to the HTTP page data endpoint', async () => {
    const baseURL = startServer(async (request) => {
      const body = await request.json();

      expect(body).not.toHaveProperty('ssr_request_context');

      return Response.json(
        createPageEnvelope({
          request_id: 'req_empty_context',
        }),
      );
    });

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'home',
    );

    const request = new Request('https://app.example.com/home');
    (
      request as Request & {
        SSRHelpers?: Record<string, unknown>;
      }
    ).SSRHelpers = {
      fastifyRequest: {
        requestContext: {},
      },
    };

    const result = (await loader({
      ...createArgs(),
      request,
    })) as Record<string, any>;

    expect(result.status).toBe('success');
    expect(result.request_id).toBe('req_empty_context');
  });

  it('forwards SSR request headers to the HTTP page data endpoint', async () => {
    const baseURL = startServer((request) => {
      expect(request.headers.get('X-SSR-Request')).toBe('1');
      expect(request.headers.get('X-SSR-Original-IP')).toBe('203.0.113.10');
      expect(request.headers.get('X-SSR-Forwarded-User-Agent')).toBe(
        'UnitTestAgent/1.0',
      );
      expect(request.headers.get('X-Correlation-ID')).toBe('corr_123');
      expect(request.headers.get('Cookie')).toBe('session=abc');
      expect(request.headers.get('Accept-Language')).toBe('en-US,en;q=0.9');

      return Response.json(
        createPageEnvelope({
          request_id: 'req_forward_headers',
        }),
      );
    });

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig(baseURL),
      'home',
    );

    const request = new Request('https://app.example.com/home', {
      headers: {
        'x-ssr-request': '1',
        'x-ssr-original-ip': '203.0.113.10',
        'user-agent': 'UnitTestAgent/1.0',
        'x-correlation-id': 'corr_123',
        cookie: 'session=abc',
        'accept-language': 'en-US,en;q=0.9',
      },
    });

    const result = (await loader({
      ...createArgs(),
      request,
    })) as Record<string, any>;

    expect(result.status).toBe('success');
    expect(result.request_id).toBe('req_forward_headers');
  });

  it('converts internal SSR short-circuit timeouts into 500 page envelopes', async () => {
    overrideDevMode(true);

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig('http://api.example.com'),
      'home',
    );

    const request = new Request('https://app.example.com/home');
    const timeoutError = new Error('Internal handler timed out') as Error & {
      errorCode?: string;
      timeoutMS?: number;
    };
    timeoutError.errorCode = 'handler_timeout';
    timeoutError.timeoutMS = 25;

    (
      request as Request & {
        SSRHelpers?: Record<string, unknown>;
      }
    ).SSRHelpers = {
      handlers: {
        hasHandler: () => true,
        callHandler: () => {
          throw timeoutError;
        },
      },
      fastifyRequest: {},
      controlledReply: {},
    };

    const result = (await loader({
      ...createArgs(),
      request,
    })) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(500);
    expect(result.error?.message).toBe(
      'Internal server error: Unable to connect to the API service.',
    );
    expect(result.error?.details?.errorCode).toBe('handler_timeout');
    expect(result.error?.details?.timeoutMS).toBe(25);
  });

  it('stringifies non-Error internal SSR short-circuit failures in development mode', async () => {
    overrideDevMode(true);

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig('http://api.example.com'),
      'home',
    );

    const request = new Request('https://app.example.com/home');

    (
      request as Request & {
        SSRHelpers?: Record<string, unknown>;
      }
    ).SSRHelpers = {
      handlers: {
        hasHandler: () => true,
        callHandler: () => {
          throw 'short-circuit string error';
        },
      },
      fastifyRequest: {},
      controlledReply: {},
    };

    const result = (await loader({
      ...createArgs(),
      request,
    })) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(500);
    expect(result.error?.details).toEqual({
      value: 'short-circuit string error',
    });
  });

  it('uses browser fetch behavior with credentials and navigator languages', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(
        Response.json(
          createPageEnvelope({
            request_id: 'req_browser_fetch',
          }),
        ),
      ),
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        languages: ['en-US', 'es-ES'],
        language: 'en-US',
      },
      configurable: true,
    });

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig('https://api.example.com'),
      'browser',
    );

    const result = (await withWindow(
      { location: { href: 'https://app.example.com' } },
      () => loader(createArgs('https://app.example.com/browser')),
    )) as Record<string, any>;

    expect(result.status).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.example.com/api/v1/page_data/browser');
    expect(options.credentials).toBe('include');
    expect((options.headers as Headers).get('Accept-Language')).toBe(
      'en-US,es-ES',
    );
  });

  it('uses navigator.language when navigator.languages is not available', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(Response.json(createPageEnvelope())),
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        language: 'fr-CA',
      },
      configurable: true,
    });

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig('https://api.example.com'),
      'browser',
    );

    await withWindow({ location: { href: 'https://app.example.com' } }, () =>
      loader(createArgs('https://app.example.com/browser')),
    );

    const [, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((options.headers as Headers).get('Accept-Language')).toBe('fr-CA');
  });

  it('omits Accept-Language when no navigator language is available', async () => {
    const fetchMock = mock(() =>
      Promise.resolve(Response.json(createPageEnvelope())),
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;
    Object.defineProperty(globalThis, 'navigator', {
      value: {},
      configurable: true,
    });

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig('https://api.example.com'),
      'browser',
    );

    await withWindow({ location: { href: 'https://app.example.com' } }, () =>
      loader(createArgs('https://app.example.com/browser')),
    );

    const [, options] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect((options.headers as Headers).get('Accept-Language')).toBeNull();
  });

  it('uses client connection messages for browser-side fetch failures', async () => {
    const fetchMock = mock(() =>
      Promise.reject(new Error('fetch failed: socket closed')),
    );

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const loader = createPageDataLoader(
      createDefaultPageDataLoaderConfig('https://api.example.com', {
        connectionErrorMessages: {
          client: 'Client fetch failed',
        },
        timeoutMS: 0,
      }),
      'browser',
    );

    const result = (await withWindow(
      { location: { href: 'https://app.example.com' } },
      () => loader(createArgs('https://app.example.com/browser')),
    )) as Record<string, any>;

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(500);
    expect(result.error?.message).toBe('Client fetch failed');
    expect(result.error?.details).toBeUndefined();
  });
});

describe('createDefaultPageDataLoaderConfig', () => {
  it('extends shared defaults with HTTP-specific fields and overrides', () => {
    const config = createDefaultPageDataLoaderConfig(
      'https://api.example.com',
      {
        timeoutMS: 5000,
        loginURL: '/auth/login',
        pageDataEndpoint: '/api/page-data',
      },
    );

    expect(config.APIBaseURL).toBe('https://api.example.com');
    expect(config.timeoutMS).toBe(5000);
    expect(config.loginURL).toBe('/auth/login');
    expect(config.pageDataEndpoint).toBe('/api/page-data');
  });
});

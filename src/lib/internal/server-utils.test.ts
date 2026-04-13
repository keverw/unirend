import { describe, it, expect, mock } from 'bun:test';
import fastify from 'fastify';
import type { FastifyReply, FastifyRequest, FastifyInstance } from 'fastify';
import {
  createControlledReply,
  classifyRequest,
  normalizeAPIPrefix,
  normalizePageDataEndpoint,
  createDefaultAPIErrorResponse,
  createDefaultAPINotFoundResponse,
  createControlledInstance,
  validateAndRegisterPlugin,
  validateNoHandlersWhenAPIDisabled,
  buildFastifyHTTPSOptions,
  registerClientIPDecoration,
  normalizeCDNBaseURL,
  computeDomainInfo,
} from './server-utils';
import type { HTTPSOptions } from '../types';

// cspell:ignore regs apix datax falsey

describe('normalizeApiPrefix', () => {
  it('adds leading slash if missing', () => {
    expect(normalizeAPIPrefix('api')).toBe('/api');
    expect(normalizeAPIPrefix('v1/api')).toBe('/v1/api');
  });

  it('keeps leading slash if present', () => {
    expect(normalizeAPIPrefix('/api')).toBe('/api');
    expect(normalizeAPIPrefix('/v1/api')).toBe('/v1/api');
  });

  it('removes trailing slash', () => {
    expect(normalizeAPIPrefix('/api/')).toBe('/api');
    expect(normalizeAPIPrefix('api/')).toBe('/api');
  });

  it('handles both missing leading and trailing slash', () => {
    expect(normalizeAPIPrefix('api/')).toBe('/api');
  });

  it('handles whitespace', () => {
    expect(normalizeAPIPrefix('  /api  ')).toBe('/api');
    expect(normalizeAPIPrefix('  api  ')).toBe('/api');
  });

  it('preserves single slash root', () => {
    // Edge case: "/" should remain "/" (don't strip to empty)
    expect(normalizeAPIPrefix('/')).toBe('/');
  });

  it('collapses multiple consecutive slashes', () => {
    expect(normalizeAPIPrefix('//api')).toBe('/api');
    expect(normalizeAPIPrefix('/api//v1')).toBe('/api/v1');
    expect(normalizeAPIPrefix('///api///')).toBe('/api');
    expect(normalizeAPIPrefix('api//routes')).toBe('/api/routes');
  });

  it('returns false when given false (API disabled)', () => {
    expect(normalizeAPIPrefix(false)).toBe(false);
  });

  it('returns default when given null or undefined', () => {
    expect(normalizeAPIPrefix(null)).toBe('/api');
    expect(normalizeAPIPrefix(undefined)).toBe('/api');
  });

  it('returns default when given empty or whitespace-only string', () => {
    expect(normalizeAPIPrefix('')).toBe('/api');
    expect(normalizeAPIPrefix('   ')).toBe('/api');
    expect(normalizeAPIPrefix('\t\n')).toBe('/api');
  });

  it('uses custom default when provided', () => {
    expect(normalizeAPIPrefix(null, '/custom')).toBe('/custom');
    expect(normalizeAPIPrefix('', '/custom')).toBe('/custom');
    expect(normalizeAPIPrefix(undefined, '/v2/api')).toBe('/v2/api');
  });
});

describe('normalizePageDataEndpoint', () => {
  it('removes leading slash if present', () => {
    expect(normalizePageDataEndpoint('/page_data')).toBe('page_data');
    expect(normalizePageDataEndpoint('/loader_data')).toBe('loader_data');
  });

  it('removes trailing slash if present', () => {
    expect(normalizePageDataEndpoint('page_data/')).toBe('page_data');
  });

  it('removes both leading and trailing slashes', () => {
    expect(normalizePageDataEndpoint('/page_data/')).toBe('page_data');
  });

  it('keeps endpoint without slashes unchanged', () => {
    expect(normalizePageDataEndpoint('page_data')).toBe('page_data');
    expect(normalizePageDataEndpoint('loader_data')).toBe('loader_data');
  });

  it('handles whitespace', () => {
    expect(normalizePageDataEndpoint('  page_data  ')).toBe('page_data');
    expect(normalizePageDataEndpoint('  /page_data/  ')).toBe('page_data');
  });

  it('returns default when given null or undefined', () => {
    expect(normalizePageDataEndpoint(null)).toBe('page_data');
    expect(normalizePageDataEndpoint(undefined)).toBe('page_data');
  });

  it('returns default when given empty or whitespace-only string', () => {
    expect(normalizePageDataEndpoint('')).toBe('page_data');
    expect(normalizePageDataEndpoint('   ')).toBe('page_data');
    expect(normalizePageDataEndpoint('\t\n')).toBe('page_data');
  });

  it('uses custom default when provided', () => {
    expect(normalizePageDataEndpoint(null, 'loader_data')).toBe('loader_data');
    expect(normalizePageDataEndpoint('', 'custom_endpoint')).toBe(
      'custom_endpoint',
    );
  });

  it('collapses multiple consecutive slashes', () => {
    expect(normalizePageDataEndpoint('page////data')).toBe('page/data');
    expect(normalizePageDataEndpoint('a//b//c')).toBe('a/b/c');
    expect(normalizePageDataEndpoint('///page///data///')).toBe('page/data');
  });
});

const createMockReply = (isDestroyed = false) => {
  const headers: Record<string, string> = {};
  const reply = {
    // Header methods
    header: mock((name: string, value: string) => {
      headers[name] = value;
      return reply;
    }),
    getHeader: mock((name: string) => headers[name]),
    getHeaders: mock(() => headers),
    removeHeader: mock((name: string) => {
      delete headers[name];
      return reply;
    }),
    hasHeader: mock((name: string) =>
      Object.prototype.hasOwnProperty.call(headers, name),
    ),
    sent: false,
    raw: {
      destroyed: isDestroyed,
    },

    // Cookie helpers
    setCookie: mock(
      (_name: string, _value: string, _opts?: Record<string, unknown>) => {},
    ),
    cookie: mock(
      (_name: string, _value: string, _opts?: Record<string, unknown>) => {},
    ),
    clearCookie: mock((_name: string, _opts?: Record<string, unknown>) => {}),
    signCookie: mock((value: string) => `signed:${value}`),
    unsignCookie: mock((value: string) => {
      if (value?.startsWith('signed:')) {
        return {
          valid: true as const,
          renew: false,
          value: value.slice('signed:'.length),
        };
      }
      return { valid: false as const, renew: false, value: null };
    }),
  };
  return reply as unknown as FastifyReply;
};

describe('createControlledReply', () => {
  it('maps header helpers and exposes sent flag', () => {
    const mockReply = createMockReply();
    const cr = createControlledReply({} as FastifyRequest, mockReply);

    cr.header('X-Test', '1');
    expect(cr.getHeader('X-Test')).toBe('1');
    expect(cr.hasHeader('X-Test')).toBe(true);
    expect(cr.getHeaders()['X-Test']).toBe('1');
    cr.removeHeader('X-Test');
    expect(cr.hasHeader('X-Test')).toBe(false);
    expect(cr.sent).toBe(false);
  });

  it('maps cookie helpers when available', () => {
    const mockReply = createMockReply() as unknown as Record<string, unknown>;
    const cr = createControlledReply({} as FastifyRequest, mockReply as any);

    cr.setCookie?.('a', '1', { path: '/' });
    cr.cookie?.('b', '2', { path: '/' });
    cr.clearCookie?.('a', { path: '/' });

    expect((mockReply as any).setCookie).toHaveBeenCalledWith('a', '1', {
      path: '/',
    });
    expect((mockReply as any).cookie).toHaveBeenCalledWith('b', '2', {
      path: '/',
    });
    expect((mockReply as any).clearCookie).toHaveBeenCalledWith('a', {
      path: '/',
    });
  });

  it('maps signCookie/unsignCookie when available', () => {
    const mockReply = createMockReply() as unknown as Record<string, unknown>;
    const cr = createControlledReply({} as FastifyRequest, mockReply as any);

    const signed = cr.signCookie?.('abc');
    expect(signed).toBe('signed:abc');

    const res1 = cr.unsignCookie?.(signed as string);
    expect(res1).toEqual({ valid: true, renew: false, value: 'abc' });

    const res2 = cr.unsignCookie?.('not-signed');
    expect(res2).toEqual({ valid: false, renew: false, value: null });
  });

  it('omits cookie helpers when not present on underlying reply', () => {
    const base = createMockReply() as unknown as Record<string, unknown>;
    delete base.setCookie;
    delete base.cookie;
    delete base.clearCookie;
    delete base.signCookie;
    delete base.unsignCookie;

    const cr = createControlledReply({} as FastifyRequest, base as any);
    expect(cr.setCookie).toBeUndefined();
    expect(cr.cookie).toBeUndefined();
    expect(cr.clearCookie).toBeUndefined();
    expect(cr.signCookie).toBeUndefined();
    expect(cr.unsignCookie).toBeUndefined();
  });

  it('exposes raw.destroyed property', () => {
    const mockReplyNotDestroyed = createMockReply(false);
    const crNotDestroyed = createControlledReply(
      {} as FastifyRequest,
      mockReplyNotDestroyed,
    );

    expect(crNotDestroyed.raw.destroyed).toBe(false);

    const mockReplyDestroyed = createMockReply(true);
    const crDestroyed = createControlledReply(
      {} as FastifyRequest,
      mockReplyDestroyed,
    );

    expect(crDestroyed.raw.destroyed).toBe(true);
  });
});

describe('classifyRequest', () => {
  it('classifies API requests correctly', () => {
    expect(classifyRequest('/api', '/api', 'page_data')).toEqual({
      isAPI: true,
      isPageData: false,
    });

    expect(classifyRequest('/api/users', '/api', 'page_data')).toEqual({
      isAPI: true,
      isPageData: false,
    });

    expect(classifyRequest('/apix/users', '/api', 'page_data')).toEqual({
      isAPI: false,
      isPageData: false,
    });

    expect(classifyRequest('/', '/api', 'page_data')).toEqual({
      isAPI: false,
      isPageData: false,
    });
  });

  it('classifies page_data endpoints correctly', () => {
    expect(classifyRequest('/api/page_data', '/api', 'page_data')).toEqual({
      isAPI: true,
      isPageData: true,
    });

    expect(classifyRequest('/api/page_data/home', '/api', 'page_data')).toEqual(
      {
        isAPI: true,
        isPageData: true,
      },
    );

    expect(classifyRequest('/api/v1/page_data', '/api', 'page_data')).toEqual({
      isAPI: true,
      isPageData: true,
    });

    expect(
      classifyRequest('/api/v2/page_data/profile', '/api', 'page_data'),
    ).toEqual({
      isAPI: true,
      isPageData: true,
    });
  });

  it('does not match non-page_data API paths as page data', () => {
    expect(classifyRequest('/api/users', '/api', 'page_data')).toEqual({
      isAPI: true,
      isPageData: false,
    });

    // page_datax is not a page_data endpoint (note the extra 'x' in the endpoint name)
    expect(classifyRequest('/api/page_datax', '/api', 'page_data')).toEqual({
      isAPI: true,
      isPageData: false,
    });
  });

  it('returns false for both when path is outside API prefix', () => {
    // Page data is always under API prefix, so non-API paths are never page data
    expect(classifyRequest('/page_data', '/api', 'page_data')).toEqual({
      isAPI: false,
      isPageData: false,
    });

    expect(classifyRequest('/v1/page_data', '/api', 'page_data')).toEqual({
      isAPI: false,
      isPageData: false,
    });

    expect(classifyRequest('/other/page_data', '/api', 'page_data')).toEqual({
      isAPI: false,
      isPageData: false,
    });
  });

  it('handles empty API prefix (returns default, so still matches)', () => {
    // Empty string goes through normalizeApiPrefix which returns default '/api'
    // But classifyRequest expects pre-normalized values, so '' is treated as falsey
    expect(classifyRequest('/api/users', '', 'page_data')).toEqual({
      isAPI: false,
      isPageData: false,
    });
  });

  it('returns false for both when API is disabled (prefix is false)', () => {
    expect(classifyRequest('/api/users', false, 'page_data')).toEqual({
      isAPI: false,
      isPageData: false,
    });

    expect(classifyRequest('/api/page_data/home', false, 'page_data')).toEqual({
      isAPI: false,
      isPageData: false,
    });

    expect(classifyRequest('/anything', false, 'page_data')).toEqual({
      isAPI: false,
      isPageData: false,
    });
  });

  it('supports custom pageDataEndpoint names', () => {
    // Custom endpoint name
    expect(classifyRequest('/api/loader_data', '/api', 'loader_data')).toEqual({
      isAPI: true,
      isPageData: true,
    });

    expect(
      classifyRequest('/api/v1/loader_data/home', '/api', 'loader_data'),
    ).toEqual({
      isAPI: true,
      isPageData: true,
    });

    // Default name doesn't match when custom is configured
    expect(classifyRequest('/api/page_data', '/api', 'loader_data')).toEqual({
      isAPI: true,
      isPageData: false,
    });
  });

  it('handles multi-digit version numbers in page_data paths', () => {
    // Two digits
    expect(classifyRequest('/api/v10/page_data', '/api', 'page_data')).toEqual({
      isAPI: true,
      isPageData: true,
    });

    // Three digits
    expect(
      classifyRequest('/api/v100/page_data/home', '/api', 'page_data'),
    ).toEqual({
      isAPI: true,
      isPageData: true,
    });

    // Four digits
    expect(
      classifyRequest('/api/v9000/page_data/profile', '/api', 'page_data'),
    ).toEqual({
      isAPI: true,
      isPageData: true,
    });

    // Edge case: /v without digits should NOT match as page_data
    expect(classifyRequest('/api/v/page_data', '/api', 'page_data')).toEqual({
      isAPI: true,
      isPageData: false,
    });

    // Edge case: /v1blah - letters after digits should NOT match
    expect(
      classifyRequest('/api/v1blah/page_data', '/api', 'page_data'),
    ).toEqual({
      isAPI: true,
      isPageData: false,
    });

    // Edge case: /v1.1 - decimal versions should NOT match
    expect(classifyRequest('/api/v1.1/page_data', '/api', 'page_data')).toEqual(
      {
        isAPI: true,
        isPageData: false,
      },
    );
  });

  it('treats all paths as API when prefix is "/" (root prefix)', () => {
    // Root prefix "/" matches everything - useful for pure API servers
    expect(classifyRequest('/', '/', 'page_data')).toEqual({
      isAPI: true,
      isPageData: false,
    });

    expect(classifyRequest('/users', '/', 'page_data')).toEqual({
      isAPI: true,
      isPageData: false,
    });

    expect(classifyRequest('/any/deep/path', '/', 'page_data')).toEqual({
      isAPI: true,
      isPageData: false,
    });

    // Page data still works with root prefix
    expect(classifyRequest('/page_data/home', '/', 'page_data')).toEqual({
      isAPI: true,
      isPageData: true,
    });

    expect(classifyRequest('/v1/page_data/home', '/', 'page_data')).toEqual({
      isAPI: true,
      isPageData: true,
    });
  });

  it('correctly strips query strings from URLs', () => {
    // API requests with query strings
    expect(classifyRequest('/api/users?id=123', '/api', 'page_data')).toEqual({
      isAPI: true,
      isPageData: false,
    });

    // Page data with query strings
    expect(
      classifyRequest('/api/page_data/home?version=1', '/api', 'page_data'),
    ).toEqual({
      isAPI: true,
      isPageData: true,
    });

    // Non-API requests with query strings
    expect(classifyRequest('/about?tab=info', '/api', 'page_data')).toEqual({
      isAPI: false,
      isPageData: false,
    });

    // Versioned page data with query strings
    expect(
      classifyRequest(
        '/api/v2/page_data/profile?refresh=true',
        '/api',
        'page_data',
      ),
    ).toEqual({
      isAPI: true,
      isPageData: true,
    });
  });
});

describe('default envelope helpers', () => {
  const HelpersStub = {
    createAPIErrorResponse: (args: any) => ({ kind: 'api', ...args }),
    createPageErrorResponse: (args: any) => ({ kind: 'page', ...args }),
  } as const;

  it('createDefaultAPIErrorResponse: uses page vs api based on path and maps error fields', () => {
    const makeReq = (url: string) => ({ url }) as unknown as FastifyRequest;

    // Page-data path
    const pageRes = createDefaultAPIErrorResponse(
      HelpersStub as unknown as any,
      makeReq('/api/v1/page_data/home'),
      Object.assign(new Error('boom'), { statusCode: 400 }),
      true,
      '/api',
      'page_data',
    ) as any;

    expect(pageRes.kind).toBe('page');
    expect(pageRes.statusCode).toBe(400);
    expect(pageRes.errorCode).toBe('request_error');
    expect(pageRes.errorMessage).toBe('boom');

    // Non page-data path (API)
    const apiRes = createDefaultAPIErrorResponse(
      HelpersStub as unknown as any,
      makeReq('/api/users'),
      new Error('kaboom'),
      false,
      '/api',
      'page_data',
    ) as any;

    expect(apiRes.kind).toBe('api');
    expect(apiRes.statusCode).toBe(500);
    expect(apiRes.errorCode).toBe('internal_server_error');
    expect(apiRes.errorMessage).toBe('Internal Server Error');
  });

  it('createDefaultAPINotFoundResponse: returns 404 and picks page vs api by path', () => {
    const makeReq = (url: string) => ({ url }) as unknown as FastifyRequest;

    const page404 = createDefaultAPINotFoundResponse(
      HelpersStub as unknown as any,
      makeReq('/api/v2/page_data/profile'),
      '/api',
      'page_data',
    ) as any;

    expect(page404.kind).toBe('page');
    expect(page404.statusCode).toBe(404);
    expect(page404.errorCode).toBe('not_found');

    const api404 = createDefaultAPINotFoundResponse(
      HelpersStub as unknown as any,
      makeReq('/api/unknown'),
      '/api',
      'page_data',
    ) as any;

    expect(api404.kind).toBe('api');
    expect(api404.statusCode).toBe(404);
    expect(api404.errorCode).toBe('not_found');
  });
});

describe('createControlledInstance', () => {
  const createFakeFastify = () => {
    const instance: any = {
      _decorations: Object.create(null),
      log: {
        info: mock(() => {}),
        warn: mock(() => {}),
        error: mock(() => {}),
      },
      register: mock((_p: any, _o?: any) => Promise.resolve()),
      addHook: mock((_name: string, _handler: any) => {}),
      decorate: mock((name: string, value: unknown) => {
        instance[name] = value;
        instance._decorations[name] = value;
      }),
      decorateRequest: mock((_name: string, _value: unknown) => {}),
      decorateReply: mock((_name: string, _value: unknown) => {}),
      route: mock((_opts: any) => {}),
      get: mock((_path: string, _handler: any) => {}),
      post: mock((_path: string, _handler: any) => {}),
      put: mock((_path: string, _handler: any) => {}),
      delete: mock((_path: string, _handler: any) => {}),
      patch: mock((_path: string, _handler: any) => {}),
    };
    return instance as unknown as FastifyInstance;
  };

  it('forwards safe methods and blocks dangerous hooks/routes', async () => {
    const f = createFakeFastify();
    const host = createControlledInstance(
      f,
      true,
      { api: true },
      { page: true },
    );

    // register forwards
    await host.register(async () => {}, { x: 1 });
    expect((f as any).register).toHaveBeenCalledTimes(1);

    // addHook allows safe hook
    host.addHook('preHandler', (_req: any, _reply: any) => {});
    expect((f as any).addHook).toHaveBeenCalledWith(
      'preHandler',
      expect.any(Function),
    );

    // addHook blocks onRoute
    expect(() => host.addHook('onRoute', () => {})).toThrow(/cannot register/i);
    // addHook blocks wildcard-like names
    // @ts-expect-error testing invalid hook name
    expect(() => host.addHook('*', () => {})).toThrow(/cannot register/i);

    // route blocks '*' and urls containing '*'
    expect(() =>
      host.route({ method: 'GET', url: '*', handler: () => {} }),
    ).toThrow(/catch-all/);
    expect(() =>
      host.route({ method: 'GET', url: '/a*', handler: () => {} }),
    ).toThrow(/catch-all/);

    // get blocks root wildcards when disabled
    expect(() => host.get('*', () => {})).toThrow(/root wildcard/);
    expect(() => host.get('/*', () => {})).toThrow(/root wildcard/);
    // and allows specific paths
    host.get('/ok', () => {});
    expect((f as any).get).toHaveBeenCalledWith('/ok', expect.any(Function));

    // log is forwarded from the fastify instance
    expect(host.log).toBe((f as any).log);

    // decorations passthrough
    host.decorate('cookiePluginInfo', { signingSecretProvided: true });
    expect(host.hasDecoration('cookiePluginInfo')).toBe(true);
    expect(
      host.getDecoration<{ signingSecretProvided: boolean }>('cookiePluginInfo')
        ?.signingSecretProvided,
    ).toBe(true);

    // decorateRequest and decorateReply
    host.decorateRequest('userId', null);
    host.decorateReply('customProp', 'value');
    expect((f as any).decorateRequest).toHaveBeenCalledWith('userId', null);
    expect((f as any).decorateReply).toHaveBeenCalledWith(
      'customProp',
      'value',
    );

    // post, put, delete, patch methods
    host.post('/api/users', () => {});
    host.put('/api/users/:id', () => {});
    host.delete('/api/users/:id', () => {});
    host.patch('/api/users/:id', () => {});
    expect((f as any).post).toHaveBeenCalledWith(
      '/api/users',
      expect.any(Function),
    );
    expect((f as any).put).toHaveBeenCalledWith(
      '/api/users/:id',
      expect.any(Function),
    );
    expect((f as any).delete).toHaveBeenCalledWith(
      '/api/users/:id',
      expect.any(Function),
    );
    expect((f as any).patch).toHaveBeenCalledWith(
      '/api/users/:id',
      expect.any(Function),
    );
  });

  it('allows wildcard routes when root wildcard is disabled (shouldDisableRootWildcard=false)', () => {
    const f = createFakeFastify();
    const host = createControlledInstance(
      f,
      false, // shouldDisableRootWildcard = false
      { api: true },
      { page: true },
    );

    // Wildcards should be allowed when shouldDisableRootWildcard is false
    host.get('*', () => {});
    host.get('/*', () => {});
    expect((f as any).get).toHaveBeenCalledWith('*', expect.any(Function));
    expect((f as any).get).toHaveBeenCalledWith('/*', expect.any(Function));
  });

  it('allows valid routes without wildcards', () => {
    const f = createFakeFastify();
    const host = createControlledInstance(
      f,
      true, // shouldDisableRootWildcard = true
      { api: true },
      { page: true },
    );

    // Valid routes without wildcards should work
    host.route({ method: 'GET', url: '/api/users', handler: () => {} });
    host.route({ method: 'POST', url: '/api/users/:id', handler: () => {} });
    expect((f as any).route).toHaveBeenCalledTimes(2);
  });

  it('preserves Fastify route-handler context when wrapping handlers', async () => {
    const app = fastify();
    app.decorate('foo', 'bar');

    const host = createControlledInstance(app, false, {}, {});

    host.get('/context', function (this: { foo: string }) {
      return Promise.resolve({
        foo: this.foo,
      });
    });

    const response = await app.inject({
      method: 'GET',
      url: '/context',
    });

    expect(response.statusCode).toBe(200);
    const body: { foo: string } = response.json();
    expect(body).toEqual({ foo: 'bar' });

    await app.close();
  });

  it('lets plugin routes return reply.redirect() without calling send() directly', async () => {
    const app = fastify();
    const host = createControlledInstance(app, false, {}, {});

    host.get('/', async (_request, reply) => {
      return reply.redirect('/dest');
    });

    const response = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/dest');
    expect(response.body).toBe('');

    await app.close();
  });

  it('lets plugin routes return reply.callNotFound() without calling send() directly', async () => {
    const app = fastify();
    const host = createControlledInstance(app, false, {}, {});

    app.setNotFoundHandler(async (_request, reply) => {
      reply.code(404);
      return { notFound: true };
    });

    host.get('/missing', async (_request, reply) => {
      return reply.callNotFound();
    });

    const response = await app.inject({
      method: 'GET',
      url: '/missing',
    });

    expect(response.statusCode).toBe(404);
    const body: { notFound: boolean } = response.json();
    expect(body).toEqual({ notFound: true });

    await app.close();
  });

  it('throws when redirect delegation is not returned immediately', async () => {
    const app = fastify();
    const host = createControlledInstance(app, false, {}, {});

    host.get('/bad-redirect', async (_request, reply) => {
      reply.redirect('/dest');
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/bad-redirect',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json().message).toContain(
      'When using reply.redirect() inside a unirend plugin route handler, return it immediately.',
    );

    await app.close();
  });

  it('throws when callNotFound delegation is not returned immediately', async () => {
    const app = fastify();
    const host = createControlledInstance(app, false, {}, {});

    app.setNotFoundHandler(async (_request, reply) => {
      reply.code(404);
      return { notFound: true };
    });

    host.get('/bad-not-found', async (_request, reply) => {
      reply.callNotFound();
      return { ok: true };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/bad-not-found',
    });

    expect(response.statusCode).toBe(500);
    const body: { message: string } = response.json();
    expect(body.message).toBe(
      'When using reply.callNotFound() inside a unirend plugin route handler, return it immediately.\n' +
        'Do not continue execution or return a payload after delegating the response.',
    );

    await app.close();
  });

  it('throws when plugin routes call reply.send() directly', async () => {
    const app = fastify();
    const host = createControlledInstance(app, false, {}, {});

    host.get('/send', async (_request, reply) => {
      return reply.send({ ok: true });
    });

    const response = await app.inject({
      method: 'GET',
      url: '/send',
    });

    expect(response.statusCode).toBe(500);
    const body: { message: string } = response.json();
    expect(body.message).toBe(
      'Do not call reply.send() inside a unirend plugin route handler.\n' +
        'Set status and headers with reply.code() / reply.header(), then return the payload:\n' +
        '  ✓  reply.code(201); return { ok: true };\n' +
        '  ✗  return reply.send({ ok: true });  // causes double-send race in Fastify 5\n\n' +
        'reply.send() is only safe inside Fastify lifecycle hooks (addHook), not in route handlers.',
    );

    await app.close();
  });
});

describe('validateAndRegisterPlugin', () => {
  it('registers metadata, prevents duplicates, and enforces dependencies', () => {
    const regs: Array<{ name: string; dependsOn?: string | string[] }> = [];

    // No metadata -> no change
    validateAndRegisterPlugin(regs as any, undefined);
    expect(regs.length).toBe(0);

    // Register first plugin
    validateAndRegisterPlugin(regs as any, { name: 'a' });
    expect(regs.map((r) => r.name)).toEqual(['a']);

    // Duplicate should throw
    expect(() => validateAndRegisterPlugin(regs as any, { name: 'a' })).toThrow(
      /already registered/i,
    );

    // Dependency not satisfied should throw
    expect(() =>
      validateAndRegisterPlugin(regs as any, {
        name: 'b',
        dependsOn: 'missing',
      }),
    ).toThrow(/depends on "missing"/i);

    // Register dependency then dependent
    validateAndRegisterPlugin(regs as any, { name: 'base' });
    validateAndRegisterPlugin(regs as any, { name: 'c', dependsOn: 'base' });
    expect(regs.map((r) => r.name)).toEqual(['a', 'base', 'c']);
  });
});

describe('validateNoHandlersWhenAPIDisabled', () => {
  it('does not throw when no handlers are registered', () => {
    const mockAPIRoutes = { hasRegisteredHandlers: () => false };
    const mockPageDataHandlers = { hasRegisteredHandlers: () => false };

    expect(() =>
      validateNoHandlersWhenAPIDisabled(mockAPIRoutes, mockPageDataHandlers),
    ).not.toThrow();
  });

  it('throws when API routes are registered', () => {
    const mockAPIRoutes = { hasRegisteredHandlers: () => true };
    const mockPageDataHandlers = { hasRegisteredHandlers: () => false };

    expect(() =>
      validateNoHandlersWhenAPIDisabled(mockAPIRoutes, mockPageDataHandlers),
    ).toThrow(/API routes were registered but API handling is disabled/i);
  });

  it('throws when page data loader handlers are registered', () => {
    const mockAPIRoutes = { hasRegisteredHandlers: () => false };
    const mockPageDataHandlers = { hasRegisteredHandlers: () => true };

    expect(() =>
      validateNoHandlersWhenAPIDisabled(mockAPIRoutes, mockPageDataHandlers),
    ).toThrow(
      /page data loader handlers were registered but API handling is disabled/i,
    );
  });

  it('throws when both API routes and page data loader handlers are registered', () => {
    const mockAPIRoutes = { hasRegisteredHandlers: () => true };
    const mockPageDataHandlers = { hasRegisteredHandlers: () => true };

    expect(() =>
      validateNoHandlersWhenAPIDisabled(mockAPIRoutes, mockPageDataHandlers),
    ).toThrow(
      /API routes and page data loader handlers were registered but API handling is disabled/i,
    );
  });

  it('includes helpful error message with configuration advice', () => {
    const mockAPIRoutes = { hasRegisteredHandlers: () => true };
    const mockPageDataHandlers = { hasRegisteredHandlers: () => false };

    expect(() =>
      validateNoHandlersWhenAPIDisabled(mockAPIRoutes, mockPageDataHandlers),
    ).toThrow(/Either enable API handling.*or remove the registered handlers/i);
  });
});

describe('buildFastifyHTTPSOptions', () => {
  it('passes through key, cert, and ca without modification', () => {
    const config: HTTPSOptions = {
      key: 'test-key',
      cert: 'test-cert',
      ca: 'test-ca',
    };

    const result = buildFastifyHTTPSOptions(config);

    expect(result.key).toBe('test-key');
    expect(result.cert).toBe('test-cert');
    expect(result.ca).toBe('test-ca');
    expect(result.SNICallback).toBeUndefined();
  });

  it('passes through passphrase option', () => {
    const config: HTTPSOptions = {
      key: 'test-key',
      cert: 'test-cert',
      passphrase: 'secret',
    };

    const result = buildFastifyHTTPSOptions(config);

    expect(result.passphrase).toBe('secret');
  });

  it('does not include sni in the output object', () => {
    const config: HTTPSOptions = {
      key: 'test-key',
      cert: 'test-cert',
      sni: () => ({ context: true }) as any,
    };

    const result = buildFastifyHTTPSOptions(config);

    expect(result.sni).toBeUndefined();
    expect(result.SNICallback).toBeDefined();
  });

  it('creates SNICallback that calls sync sni and invokes callback', () => {
    const mockCtx = { context: 'sync-ctx' };
    const config: HTTPSOptions = {
      key: 'k',
      cert: 'c',
      sni: (_servername: string) => mockCtx as any,
    };

    const result = buildFastifyHTTPSOptions(config);
    const sniCallback = result.SNICallback as (
      servername: string,
      cb?: (err: Error | null, ctx?: unknown) => void,
    ) => unknown;

    const cb = mock((_err: Error | null, _ctx?: unknown) => {});
    sniCallback('example.com', cb);

    expect(cb).toHaveBeenCalledWith(null, mockCtx);
  });

  it('creates SNICallback that returns sync result when callback is undefined', () => {
    const mockCtx = { context: 'sync-ctx' };
    const config: HTTPSOptions = {
      key: 'k',
      cert: 'c',
      sni: (_servername: string) => mockCtx as any,
    };

    const result = buildFastifyHTTPSOptions(config);
    const sniCallback = result.SNICallback as (
      servername: string,
      cb?: (err: Error | null, ctx?: unknown) => void,
    ) => unknown;

    const returned = sniCallback('example.com');
    expect(returned).toBe(mockCtx);
  });

  it('creates SNICallback that handles async sni and invokes callback on success', async () => {
    const mockCtx = { context: 'async-ctx' };
    const config: HTTPSOptions = {
      key: 'k',
      cert: 'c',
      sni: async (_servername: string) => {
        await Promise.resolve();
        return mockCtx as any;
      },
    };

    const result = buildFastifyHTTPSOptions(config);
    const sniCallback = result.SNICallback as (
      servername: string,
      cb?: (err: Error | null, ctx?: unknown) => void,
    ) => unknown;

    const cbResult = await new Promise<{ err: Error | null; ctx?: unknown }>(
      (resolve) => {
        sniCallback('example.com', (err, ctx) => resolve({ err, ctx }));
      },
    );

    expect(cbResult.err).toBeNull();
    expect(cbResult.ctx).toBe(mockCtx);
  });

  it('creates SNICallback that handles async sni error and invokes callback with error', async () => {
    const config: HTTPSOptions = {
      key: 'k',
      cert: 'c',
      sni: async (_servername: string) => {
        await Promise.resolve();
        throw new Error('cert lookup failed');
      },
    };

    const result = buildFastifyHTTPSOptions(config);
    const sniCallback = result.SNICallback as (
      servername: string,
      cb?: (err: Error | null, ctx?: unknown) => void,
    ) => unknown;

    const cbResult = await new Promise<{ err: Error | null; ctx?: unknown }>(
      (resolve) => {
        sniCallback('example.com', (err, ctx) => resolve({ err, ctx }));
      },
    );

    expect(cbResult.err).toBeInstanceOf(Error);
    expect(cbResult.err?.message).toBe('cert lookup failed');
  });

  it('creates SNICallback that wraps non-Error throws into Error objects', async () => {
    const config: HTTPSOptions = {
      key: 'k',
      cert: 'c',
      sni: async (_servername: string) => {
        await Promise.resolve();

        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string error';
      },
    };

    const result = buildFastifyHTTPSOptions(config);
    const sniCallback = result.SNICallback as (
      servername: string,
      cb?: (err: Error | null, ctx?: unknown) => void,
    ) => unknown;

    const cbResult = await new Promise<{ err: Error | null; ctx?: unknown }>(
      (resolve) => {
        sniCallback('example.com', (err, ctx) => resolve({ err, ctx }));
      },
    );

    expect(cbResult.err).toBeInstanceOf(Error);
    expect(cbResult.err?.message).toBe('string error');
  });

  it('creates SNICallback that returns Promise when async sni called without callback', async () => {
    const mockCtx = { context: 'async-no-cb' };
    const config: HTTPSOptions = {
      key: 'k',
      cert: 'c',
      sni: async (_servername: string) => {
        await Promise.resolve();
        return mockCtx as any;
      },
    };

    const result = buildFastifyHTTPSOptions(config);
    const sniCallback = result.SNICallback as (
      servername: string,
      cb?: (err: Error | null, ctx?: unknown) => void,
    ) => unknown;

    const returned = sniCallback('example.com');
    expect(returned).toBeInstanceOf(Promise);
    const resolved = await (returned as Promise<unknown>);
    expect(resolved).toBe(mockCtx);
  });

  it('creates SNICallback that returns rejecting Promise when async sni errors without callback', () => {
    const config: HTTPSOptions = {
      key: 'k',
      cert: 'c',
      sni: async (_servername: string) => {
        await Promise.resolve();
        throw new Error('no-cb error');
      },
    };

    const result = buildFastifyHTTPSOptions(config);
    const sniCallback = result.SNICallback as (
      servername: string,
      cb?: (err: Error | null, ctx?: unknown) => void,
    ) => unknown;

    const returned = sniCallback('example.com') as Promise<unknown>;
    expect(returned).toBeInstanceOf(Promise);
    expect(returned).rejects.toThrow('no-cb error');
  });

  it('passes the correct servername to the sni function', () => {
    const sniSpy = mock((_servername: string) => ({ context: true }) as any);
    const config: HTTPSOptions = {
      key: 'k',
      cert: 'c',
      sni: sniSpy,
    };

    const result = buildFastifyHTTPSOptions(config);
    const sniCallback = result.SNICallback as (
      servername: string,
      cb?: (err: Error | null, ctx?: unknown) => void,
    ) => unknown;

    sniCallback('tenant.example.com', () => {});
    expect(sniSpy).toHaveBeenCalledWith('tenant.example.com');
  });
});

describe('registerClientIPDecoration', () => {
  const createFakeFastify = () => {
    const hooks: Record<string, ((...args: unknown[]) => unknown)[]> = {};

    const instance = {
      decorateRequest: mock((_name: string, _value: unknown) => {}),
      addHook: mock(
        (name: string, handler: (...args: unknown[]) => unknown) => {
          hooks[name] = hooks[name] ?? [];
          hooks[name].push(handler);
        },
      ),
      _hooks: hooks,
    };

    return instance;
  };

  const makeRequest = (ip: string) =>
    ({ ip, clientIP: '' }) as unknown as FastifyRequest;

  it('decorates requests with clientIP and registers an onRequest hook', () => {
    const f = createFakeFastify();
    registerClientIPDecoration(f as any, undefined);

    expect(f.decorateRequest).toHaveBeenCalledWith('clientIP', '');
    expect(f.addHook).toHaveBeenCalledWith('onRequest', expect.any(Function));
  });

  it('defaults clientIP to request.ip when getClientIP is not provided', async () => {
    const f = createFakeFastify();
    registerClientIPDecoration(f as any, undefined);

    const handler = f._hooks['onRequest']?.[0];
    const req = makeRequest('1.2.3.4');
    await handler(req, {});

    expect((req as any).clientIP).toBe('1.2.3.4');
  });

  it('uses the return value of getClientIP when provided', async () => {
    const f = createFakeFastify();
    registerClientIPDecoration(f as any, () => '9.9.9.9');

    const handler = f._hooks['onRequest']?.[0];
    const req = makeRequest('1.2.3.4');
    await handler(req, {});

    expect((req as any).clientIP).toBe('9.9.9.9');
  });

  it('awaits async getClientIP resolvers', async () => {
    const f = createFakeFastify();
    registerClientIPDecoration(
      f as any,
      async () => await Promise.resolve('8.8.8.8'),
    );

    const handler = f._hooks['onRequest']?.[0];
    const req = makeRequest('1.2.3.4');
    await handler(req, {});

    expect((req as any).clientIP).toBe('8.8.8.8');
  });

  it('propagates throws from getClientIP as a normal error (no silent fallback)', () => {
    const f = createFakeFastify();

    registerClientIPDecoration(f as any, () => {
      throw new Error('lookup failed');
    });

    const handler = f._hooks['onRequest']?.[0];
    const req = makeRequest('1.2.3.4');

    expect(handler(req, {})).rejects.toThrow('lookup failed');
    expect((req as any).clientIP).toBe('1.2.3.4');
  });

  it('propagates rejected async getClientIP resolvers as a normal error', () => {
    const f = createFakeFastify();

    registerClientIPDecoration(
      f as any,
      async () => await Promise.reject(new Error('async lookup failed')),
    );

    const handler = f._hooks['onRequest']?.[0];
    const req = makeRequest('1.2.3.4');

    expect(handler(req, {})).rejects.toThrow('async lookup failed');
    expect((req as any).clientIP).toBe('1.2.3.4');
  });
});

describe('normalizeCDNBaseURL', () => {
  it('strips a trailing slash', () => {
    expect(normalizeCDNBaseURL('https://cdn.example.com/')).toBe(
      'https://cdn.example.com',
    );
  });

  it('leaves a URL without a trailing slash unchanged', () => {
    expect(normalizeCDNBaseURL('https://cdn.example.com')).toBe(
      'https://cdn.example.com',
    );
  });

  it('returns empty string for undefined', () => {
    expect(normalizeCDNBaseURL(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(normalizeCDNBaseURL('')).toBe('');
  });

  it('strips only a single trailing slash (not double)', () => {
    expect(normalizeCDNBaseURL('https://cdn.example.com//')).toBe(
      'https://cdn.example.com/',
    );
  });
});

describe('computeDomainInfo', () => {
  it('returns rootDomain without leading dot for a standard domain', () => {
    const result = computeDomainInfo('app.example.com');
    expect(result.hostname).toBe('app.example.com');
    expect(result.rootDomain).toBe('example.com');
  });

  it('returns rootDomain for an apex domain', () => {
    const result = computeDomainInfo('example.com');
    expect(result.hostname).toBe('example.com');
    expect(result.rootDomain).toBe('example.com');
  });

  it('handles multi-part TLDs correctly', () => {
    const result = computeDomainInfo('app.example.co.uk');
    expect(result.hostname).toBe('app.example.co.uk');
    expect(result.rootDomain).toBe('example.co.uk');
  });

  it('handles deeply nested subdomains with multi-part TLDs', () => {
    const result = computeDomainInfo('foo.bar.example.co.uk');
    expect(result.hostname).toBe('foo.bar.example.co.uk');
    expect(result.rootDomain).toBe('example.co.uk');
  });

  it('strips port from hostname', () => {
    const result = computeDomainInfo('app.example.com:3000');
    expect(result.hostname).toBe('app.example.com');
    expect(result.rootDomain).toBe('example.com');
  });

  it('returns empty rootDomain for localhost', () => {
    const result = computeDomainInfo('localhost');
    expect(result.hostname).toBe('localhost');
    expect(result.rootDomain).toBe('');
  });

  it('returns empty rootDomain for localhost with port', () => {
    const result = computeDomainInfo('localhost:3000');
    expect(result.hostname).toBe('localhost');
    expect(result.rootDomain).toBe('');
  });

  it('returns empty rootDomain for an IP address', () => {
    const result = computeDomainInfo('192.168.1.1');
    expect(result.hostname).toBe('192.168.1.1');
    expect(result.rootDomain).toBe('');
  });

  it('returns empty rootDomain for an IPv6 loopback address', () => {
    const result = computeDomainInfo('[::1]');
    expect(result.hostname).toBe('::1');
    expect(result.rootDomain).toBe('');
  });

  it('strips port from a bracketed IPv6 address', () => {
    const result = computeDomainInfo('[::1]:3000');
    expect(result.hostname).toBe('::1');
    expect(result.rootDomain).toBe('');
  });

  it('handles a full IPv6 address with port', () => {
    const result = computeDomainInfo('[2001:db8::1]:8080');
    expect(result.hostname).toBe('2001:db8::1');
    expect(result.rootDomain).toBe('');
  });
});

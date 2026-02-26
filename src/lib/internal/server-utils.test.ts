import { describe, it, expect, mock } from 'bun:test';
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
    const cr = createControlledReply(mockReply);

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
    const cr = createControlledReply(mockReply as any);

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
    const cr = createControlledReply(mockReply as any);

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

    const cr = createControlledReply(base as any);
    expect(cr.setCookie).toBeUndefined();
    expect(cr.cookie).toBeUndefined();
    expect(cr.clearCookie).toBeUndefined();
    expect(cr.signCookie).toBeUndefined();
    expect(cr.unsignCookie).toBeUndefined();
  });

  it('exposes raw.destroyed property', () => {
    const mockReplyNotDestroyed = createMockReply(false);
    const crNotDestroyed = createControlledReply(mockReplyNotDestroyed);
    expect(crNotDestroyed.raw.destroyed).toBe(false);

    const mockReplyDestroyed = createMockReply(true);
    const crDestroyed = createControlledReply(mockReplyDestroyed);
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

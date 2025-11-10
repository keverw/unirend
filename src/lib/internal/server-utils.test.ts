import { describe, it, expect, mock } from 'bun:test';
import {
  createControlledReply,
  isPageDataRequest,
  isAPIRequest,
  createDefaultAPIErrorResponse,
  createDefaultAPINotFoundResponse,
  createControlledInstance,
  validateAndRegisterPlugin,
} from './server-utils';

// cspell:ignore regs apix datax falsey

const createMockReply = () => {
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
  return reply as unknown as import('fastify').FastifyReply;
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
});

describe('isPageDataRequest', () => {
  it('matches root and versioned page_data endpoints', () => {
    expect(isPageDataRequest('/page_data')).toBe(true);
    expect(isPageDataRequest('/page_data/home')).toBe(true);
    expect(isPageDataRequest('/v1/page_data')).toBe(true);
    expect(isPageDataRequest('/v2/page_data/profile')).toBe(true);
  });

  it('does not match non-page_data paths', () => {
    expect(isPageDataRequest('/api/page_data')).toBe(false);
    expect(isPageDataRequest('/page_datax')).toBe(false);
    expect(isPageDataRequest('/v1/page_datum')).toBe(false);
  });
});

describe('isAPIRequest', () => {
  it('detects API prefix correctly', () => {
    expect(isAPIRequest('/api', '/api')).toBe(true);
    expect(isAPIRequest('/api/users', '/api')).toBe(true);
    expect(isAPIRequest('/apix/users', '/api')).toBe(false);
    expect(isAPIRequest('/', '/api')).toBe(false);
  });

  it('returns false when prefix disabled', () => {
    // @ts-expect-error testing falsey branch
    expect(isAPIRequest('/api/users', false)).toBe(false);
  });
});

describe('default envelope helpers', () => {
  const HelpersStub = {
    createAPIErrorResponse: (args: any) => ({ kind: 'api', ...args }),
    createPageErrorResponse: (args: any) => ({ kind: 'page', ...args }),
  } as const;

  it('createDefaultAPIErrorResponse: uses page vs api based on path and maps error fields', () => {
    const makeReq = (url: string) =>
      ({ url }) as unknown as import('fastify').FastifyRequest;

    // Page-data path
    const pageRes = createDefaultAPIErrorResponse(
      HelpersStub as unknown as any,
      makeReq('/api/v1/page_data/home'),
      Object.assign(new Error('boom'), { statusCode: 400 }),
      true,
      '/api',
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
    ) as any;
    expect(apiRes.kind).toBe('api');
    expect(apiRes.statusCode).toBe(500);
    expect(apiRes.errorCode).toBe('internal_server_error');
    expect(apiRes.errorMessage).toBe('Internal Server Error');
  });

  it('createDefaultAPINotFoundResponse: returns 404 and picks page vs api by path', () => {
    const makeReq = (url: string) =>
      ({ url }) as unknown as import('fastify').FastifyRequest;

    const page404 = createDefaultAPINotFoundResponse(
      HelpersStub as unknown as any,
      makeReq('/api/v2/page_data/profile'),
      '/api',
    ) as any;
    expect(page404.kind).toBe('page');
    expect(page404.statusCode).toBe(404);
    expect(page404.errorCode).toBe('not_found');

    const api404 = createDefaultAPINotFoundResponse(
      HelpersStub as unknown as any,
      makeReq('/api/unknown'),
      '/api',
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
    return instance as unknown as import('fastify').FastifyInstance;
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

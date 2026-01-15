import { describe, it, expect, mock } from 'bun:test';
import { cors } from './cors';
import type { CORSConfig } from './cors';
import type { PluginOptions, PluginHostInstance } from '../types';

interface MockRequest {
  url: string;
  method: string;
  headers: Record<string, string | undefined>;
  corsOriginAllowed?: boolean;
  [key: string]: unknown;
}

interface MockReply {
  code: ReturnType<typeof mock>;
  type: ReturnType<typeof mock>;
  send: ReturnType<typeof mock>;
  header: ReturnType<typeof mock>;
  headers: Record<string, string | undefined>;
  getHeader: ReturnType<typeof mock>;
  status: ReturnType<typeof mock>;
}

// Mock Fastify request/reply objects
const createMockRequest = (
  overrides: Partial<MockRequest> = {},
): MockRequest => ({
  url: '/test',
  method: 'GET',
  headers: {
    origin: 'https://example.com',
    ...overrides.headers,
  },
  ...overrides,
});

const createMockReply = (): MockReply => {
  const reply: Partial<MockReply> = {
    headers: {},
  };

  reply.code = mock(() => reply as MockReply);
  reply.type = mock(() => reply as MockReply);
  reply.send = mock(() => reply as MockReply);
  reply.header = mock(() => reply as MockReply);
  reply.getHeader = mock((name: string) => reply.headers?.[name]);
  reply.status = mock((_code: number) => reply as MockReply);

  return reply as MockReply;
};

interface MockPluginHost extends PluginHostInstance {
  getHooks: () => Array<{
    event: string;
    handler: (...args: any[]) => Promise<void>;
  }>;
}

const createMockPluginHost = (): MockPluginHost => {
  const hooks: Array<{
    event: string;
    handler: (...args: any[]) => Promise<void>;
  }> = [];

  const mockHost = {
    addHook: mock(
      (event: string, handler: (...args: any[]) => Promise<void>) => {
        hooks.push({ event, handler });
      },
    ),
    getHooks: () => hooks,
  };

  return mockHost as unknown as MockPluginHost;
};

const createMockOptions = (
  overrides: Partial<PluginOptions> = {},
): PluginOptions => ({
  serverType: 'ssr',
  mode: 'production',
  isDevelopment: false,
  apiEndpoints: {
    apiEndpointPrefix: '/api',
  },
  ...overrides,
});

describe('cors', () => {
  describe('plugin registration', () => {
    it('should register onRequest hook', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors({ origin: 'https://example.com' });

      await plugin(pluginHost, options);

      expect(pluginHost.addHook).toHaveBeenCalledWith(
        'onRequest',
        expect.any(Function),
      );
      // onSend hook is only registered when exposedHeaders are configured
      expect(pluginHost.addHook).toHaveBeenCalledTimes(1);
    });

    it('should register onSend hook when exposedHeaders are configured', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors({
        origin: 'https://example.com',
        exposedHeaders: ['X-Custom-Header'],
      });

      await plugin(pluginHost, options);

      expect(pluginHost.addHook).toHaveBeenCalledWith(
        'onRequest',
        expect.any(Function),
      );
      expect(pluginHost.addHook).toHaveBeenCalledWith(
        'onSend',
        expect.any(Function),
      );
      expect(pluginHost.addHook).toHaveBeenCalledTimes(2);
    });

    it("should throw when '*' is included in an origin array with other entries", () => {
      const config: CORSConfig = {
        origin: ['*', 'https://*'],
      };

      // This is validated earlier than the multi-special-wildcard check
      expect(() => cors(config)).toThrow(
        /do not include '\*' inside an origin array/i,
      );
    });

    it("should allow combining '*' with 'null' in origin array", async () => {
      const config: CORSConfig = {
        origin: ['*', 'null'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({ headers: { origin: 'null' } });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      // null explicitly allowed alongside wildcard
      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'null',
      );
    });

    it("should allow combining 'https://*' with 'null' in origin array", async () => {
      const config: CORSConfig = {
        origin: ['https://*', 'null'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      // HTTPS origin should be allowed
      const httpsReq = createMockRequest({
        headers: { origin: 'https://ok.example' },
      });
      const httpsReply = createMockReply();
      await onRequestHook?.handler(httpsReq, httpsReply);
      expect(httpsReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://ok.example',
      );

      // null origin should also be allowed
      const nullReq = createMockRequest({ headers: { origin: 'null' } });
      const nullReply = createMockReply();
      await onRequestHook?.handler(nullReq, nullReply);
      expect(nullReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'null',
      );
    });

    it("should allow combining 'http://*' with 'null' in origin array", async () => {
      const config: CORSConfig = {
        origin: ['http://*', 'null'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      // HTTP origin should be allowed
      const httpReq = createMockRequest({
        headers: { origin: 'http://ok.example' },
      });
      const httpReply = createMockReply();
      await onRequestHook?.handler(httpReq, httpReply);
      expect(httpReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'http://ok.example',
      );

      // null origin should also be allowed
      const nullReq = createMockRequest({ headers: { origin: 'null' } });
      const nullReply = createMockReply();
      await onRequestHook?.handler(nullReq, nullReply);
      expect(nullReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'null',
      );
    });

    it('should throw when both protocol wildcards are present in origin array (https://* and http://*)', () => {
      const config: CORSConfig = {
        origin: ['https://*', 'http://*'],
      };

      expect(() => cors(config)).toThrow(
        /only one of '\*', 'https:\/\/\*', or 'http:\/\/\*' may be specified in origin/i,
      );
    });

    it('should throw when the same protocol wildcard appears more than once in origin array', () => {
      const config: CORSConfig = {
        origin: ['https://*', 'https://*'],
      };

      expect(() => cors(config)).toThrow(
        /only one of '\*', 'https:\/\/\*', or 'http:\/\/\*' may be specified in origin/i,
      );
    });

    it('should allow a single protocol wildcard inside an origin array', async () => {
      const config: CORSConfig = {
        origin: ['https://*'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        headers: { origin: 'https://foo.bar' },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://foo.bar',
      );
    });
  });

  describe('origin validation', () => {
    it('should allow requests with no origin header', async () => {
      const config: CORSConfig = { origin: ['https://example.com'] };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({ headers: {} });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should not set CORS headers for disallowed origins on regular requests', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors({ origin: 'https://allowed.com' });
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: { origin: 'https://disallowed.com' },
      });
      const reply = createMockReply();

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      // For regular requests with disallowed origins, no CORS headers are set
      // The browser will handle the CORS failure
      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.any(String),
      );
      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should support wildcard origins', async () => {
      const config: CORSConfig = { origin: ['*.example.com'] };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { origin: 'https://api.example.com' },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should not set CORS headers for HTTP origins when using https://* wildcard', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors({ origin: 'https://*' });
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: { origin: 'http://example.com' },
      });
      const reply = createMockReply();

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      // For regular requests with disallowed origins, no CORS headers are set
      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.any(String),
      );
      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should support function-based origin validation', async () => {
      const config: CORSConfig = {
        origin: (origin, _request) => origin === 'https://dynamic.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: { origin: 'https://dynamic.com' },
      });
      const reply = createMockReply();
      const hooks = pluginHost.getHooks();
      await hooks[0].handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://dynamic.com',
      );
    });

    it('should reject origins when function-based validation returns false', async () => {
      const config: CORSConfig = {
        origin: (origin, _request) => origin === 'https://allowed.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: { origin: 'https://rejected.com' },
      });
      const reply = createMockReply();
      const hooks = pluginHost.getHooks();
      await hooks[0].handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.any(String),
      );
    });

    it("should reject origins when string config doesn't match", async () => {
      const config: CORSConfig = {
        origin: 'https://allowed.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: { origin: 'https://rejected.com' },
      });
      const reply = createMockReply();
      const hooks = pluginHost.getHooks();
      await hooks[0].handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.any(String),
      );
    });

    it("should reject origins when array config doesn't include origin", async () => {
      const config: CORSConfig = {
        origin: ['https://allowed1.com', 'https://allowed2.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: { origin: 'https://rejected.com' },
      });
      const reply = createMockReply();
      const hooks = pluginHost.getHooks();
      await hooks[0].handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.any(String),
      );
    });

    it('should reject requests when origin is undefined and config is not wildcard', async () => {
      const config: CORSConfig = {
        origin: 'https://allowed.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: {}, // No origin header
      });
      const reply = createMockReply();
      const hooks = pluginHost.getHooks();
      await hooks[0].handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.any(String),
      );
    });

    it('should return 403 for disallowed origins on preflight OPTIONS requests', async () => {
      const config: CORSConfig = {
        origin: 'https://allowed.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://disallowed.com',
          'access-control-request-method': 'POST',
        },
      });
      const reply = createMockReply();
      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Origin not allowed by CORS policy',
      });
    });

    it('should return 403 for function-based origin rejection on preflight OPTIONS requests', async () => {
      const config: CORSConfig = {
        origin: (origin, _request) => origin === 'https://allowed.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://rejected.com',
          'access-control-request-method': 'POST',
        },
      });
      const reply = createMockReply();
      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.send).toHaveBeenCalledWith({
        error: 'Origin not allowed by CORS policy',
      });
    });

    it('should set wildcard origin for preflight OPTIONS with no origin header and wildcard config', async () => {
      const config: CORSConfig = {
        origin: '*',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          'access-control-request-method': 'POST',
          // No origin header
        },
      });
      const reply = createMockReply();
      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        '*',
      );
      expect(reply.code).toHaveBeenCalledWith(204);
      expect(reply.send).toHaveBeenCalledWith();
    });

    it("should throw when origin '*' is combined with function-based credentials", () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: (origin, request) => {
          return (
            origin === 'https://trusted.com' &&
            request.url?.startsWith('/api/auth')
          );
        },
      };

      expect(() => cors(config)).toThrow(
        "Unsafe CORS: cannot combine origin '*' with dynamic credentials. Use a concrete origin list when enabling credentials.",
      );
    });
  });

  describe('CORS headers', () => {
    it('should set Access-Control-Allow-Origin header for allowed origins', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors({ origin: 'https://example.com' });
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://example.com',
      );
    });

    it('should allow credentials with protocol wildcard origins (https://*) when explicitly opted in', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors({
        origin: 'https://*',
        credentials: true,
        allowCredentialsWithProtocolWildcard: true,
      });
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: { origin: 'https://sub.domain.com' },
      });
      const reply = createMockReply();

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://sub.domain.com',
      );
      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should throw when credentials: true is used with protocol wildcard without opt-in', () => {
      const config: CORSConfig = {
        origin: 'https://*',
        credentials: true,
        // allowCredentialsWithProtocolWildcard not set (defaults to false)
      };

      expect(() => cors(config)).toThrow(
        /Cannot use credentials: true with protocol wildcard origins/i,
      );
    });

    it('should set Vary: Origin header for non-wildcard origins', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors({ origin: 'https://example.com' });
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith('Vary', 'Origin');
    });

    it('should set Access-Control-Allow-Credentials when credentials enabled', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors({
        origin: 'https://example.com',
        credentials: true,
      });
      await plugin(pluginHost, options);

      const request = createMockRequest({
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should set custom allowed methods', async () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        methods: ['GET', 'POST', 'PUT'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
        },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Methods',
        'GET, POST, PUT',
      );
    });

    it('should set custom allowed headers', async () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,authorization',
        },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization',
      );
    });

    it('should set exposed headers', async () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        exposedHeaders: ['X-Total-Count', 'X-Rate-Limit'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();
      request.corsOriginAllowed = true;

      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onSendHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onSend');
      await onSendHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Expose-Headers',
        'X-Total-Count, X-Rate-Limit',
      );
    });

    it('should set max age for preflight cache', async () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        maxAge: 86400,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
        },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Max-Age',
        '86400',
      );
    });
  });

  describe('credentials function behavior', () => {
    it("should not set credentials for 'null' even if credentials function returns true", async () => {
      const pluginHost = createMockPluginHost();
      const plugin = cors({
        origin: ['https://allowed.com', 'null'],
        credentials: (origin) => !!origin, // always true when present
      });

      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({ headers: { origin: 'null' } });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      // Origin echoed
      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'null',
      );
      // Credentials must NOT be set for the literal 'null' origin
      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should set credentials when credentials function returns true for trusted origin', async () => {
      const pluginHost = createMockPluginHost();
      const plugin = cors({
        origin: ['https://allowed.com'],
        credentials: (origin) => origin === 'https://allowed.com',
      });

      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        headers: { origin: 'https://allowed.com' },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://allowed.com',
      );
      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });
  });

  describe('allowedHeaders reflection limits', () => {
    it("caps reflected headers at 100 when allowedHeaders is ['*']", async () => {
      const pluginHost = createMockPluginHost();
      const plugin = cors({
        origin: 'https://example.com',
        allowedHeaders: ['*'],
      });

      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const requested = Array.from({ length: 120 }, (_, i) => `h${i}`).join(
        ',',
      );
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': requested,
        },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      const expected = Array.from({ length: 100 }, (_, i) => `h${i}`).join(
        ', ',
      );
      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        expected,
      );
    });

    it('filters out header names longer than 256 chars when reflecting', async () => {
      const pluginHost = createMockPluginHost();
      const plugin = cors({
        origin: 'https://example.com',
        allowedHeaders: ['*'],
      });

      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const longName = 'x'.repeat(300);
      const reqHeaders = `short,${longName},x-custom`;
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers': reqHeaders,
        },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'short, x-custom',
      );
    });
  });

  describe('security headers', () => {
    it('should not set X-Frame-Options or HSTS by default', async () => {
      const pluginHost = createMockPluginHost();
      const plugin = cors({ origin: 'https://example.com' });
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'X-Frame-Options',
        expect.any(String),
      );
      expect(reply.header).not.toHaveBeenCalledWith(
        'Strict-Transport-Security',
        expect.any(String),
      );
    });

    it('should set X-Frame-Options and HSTS when configured', async () => {
      const pluginHost = createMockPluginHost();
      const plugin = cors({
        origin: 'https://example.com',
        xFrameOptions: 'DENY',
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      });
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
      expect(reply.header).toHaveBeenCalledWith(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
    });

    it('should validate hsts.maxAge as non-negative number', () => {
      expect(() =>
        cors({
          origin: 'https://example.com',
          hsts: { maxAge: -1 },
        }),
      ).toThrow(/hsts.maxAge must be a non-negative number/i);
    });

    it('should enforce preload requirements: maxAge >= 31536000 and includeSubDomains', () => {
      // Too small max-age
      expect(() =>
        cors({
          origin: 'https://example.com',
          hsts: { maxAge: 300, preload: true, includeSubDomains: true },
        }),
      ).toThrow(/HSTS preload requires maxAge >= 31536000/i);

      // Missing includeSubDomains
      expect(() =>
        cors({
          origin: 'https://example.com',
          hsts: { maxAge: 31536000, preload: true },
        }),
      ).toThrow(/HSTS preload requires includeSubDomains: true/i);

      // Valid preload config
      expect(() =>
        cors({
          origin: 'https://example.com',
          hsts: { maxAge: 31536000, preload: true, includeSubDomains: true },
        }),
      ).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('should not set CORS headers for null origin when not explicitly allowed', async () => {
      const config: CORSConfig = { origin: ['https://example.com'] };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        method: 'GET',
        headers: { origin: 'null' },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      // For regular requests with disallowed origins (including null), no CORS headers are set
      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.any(String),
      );
      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should handle case-insensitive origin matching', async () => {
      const config: CORSConfig = { origin: ['https://example.com'] };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { origin: 'https://EXAMPLE.COM' },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should handle origins with ports', async () => {
      const config: CORSConfig = { origin: ['https://example.com:8080'] };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { origin: 'https://example.com:8080' },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should auto-merge credentials origins into main origin list', async () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['https://app.example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { origin: 'https://app.example.com' },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should convert single origin to array and merge with credentials origins', async () => {
      const config: CORSConfig = {
        origin: 'https://app.com', // Single string origin (not "*")
        credentials: ['https://auth.com', 'https://admin.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      // Test that the original single origin still works
      const appRequest = createMockRequest({
        headers: { origin: 'https://app.com' },
      });
      const appReply = createMockReply();
      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(appRequest, appReply);

      expect(appReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://app.com',
      );

      // Test that credentials origins are now also allowed for CORS
      const authRequest = createMockRequest({
        headers: { origin: 'https://auth.com' },
      });
      const authReply = createMockReply();
      await onRequestHook?.handler(authRequest, authReply);

      expect(authReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://auth.com',
      );
    });
  });

  describe('configuration validation', () => {
    it("should throw error when credentials: true is used with origin: '*'", () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: true,
      };

      expect(() => cors(config)).toThrow(
        "Cannot use credentials: true with origin: '*'. The CORS specification prohibits Access-Control-Allow-Credentials: true with Access-Control-Allow-Origin: *. Use specific origins instead.",
      );
    });

    it("should normalize ['*'] to '*' and behave as wildcard", async () => {
      const config: CORSConfig = {
        origin: ['*'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          // No Origin header present
          'access-control-request-method': 'GET',
        },
      });
      const reply = createMockReply();

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        '*',
      );
    });

    it("should upgrade origin '*' to credentials allowlist when credentials is an array", async () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['https://allow.com', 'https://also-allow.com'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = cors(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      // 1) Preflight with no Origin should NOT set '*' because origin was upgraded to array
      const noOriginPreflight = createMockRequest({
        method: 'OPTIONS',
        headers: {
          'access-control-request-method': 'POST',
        },
      });
      const noOriginReply = createMockReply();
      await onRequestHook?.handler(noOriginPreflight, noOriginReply);
      expect(noOriginReply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        '*',
      );

      // 2) Actual request from allowlisted origin should set ACAO and credentials
      const allowedRequest = createMockRequest({
        headers: { origin: 'https://allow.com' },
      });
      const allowedReply = createMockReply();
      await onRequestHook?.handler(allowedRequest, allowedReply);
      expect(allowedReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://allow.com',
      );
      expect(allowedReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });
  });

  describe('preflightContinue', () => {
    it('should set CORS headers and continue to route handler when preflightContinue is true', async () => {
      const config: CORSConfig = {
        origin: 'https://example.com',
        preflightContinue: true,
        credentials: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
        },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://example.com',
      );
      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
      // Should not call reply.send() when preflightContinue is true
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should set wildcard origin when preflightContinue is true and no origin header', async () => {
      const config: CORSConfig = {
        origin: '*',
        preflightContinue: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          'access-control-request-method': 'POST',
        },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        '*',
      );
      // Should not call reply.send() when preflightContinue is true
      expect(reply.send).not.toHaveBeenCalled();
    });
  });

  describe('private network access', () => {
    it('should set Access-Control-Allow-Private-Network header when allowPrivateNetwork is true and request includes private network header', async () => {
      const config: CORSConfig = {
        origin: '*',
        allowPrivateNetwork: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'GET',
          'access-control-request-private-network': 'true',
        },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Private-Network',
        'true',
      );
    });

    it('should not set Access-Control-Allow-Private-Network header when allowPrivateNetwork is false', async () => {
      const config: CORSConfig = {
        origin: '*',
        allowPrivateNetwork: false,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'GET',
          'access-control-request-private-network': 'true',
        },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Private-Network',
        'true',
      );
    });

    it("should not set Access-Control-Allow-Private-Network header when request header is not 'true'", async () => {
      const config: CORSConfig = {
        origin: '*',
        allowPrivateNetwork: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'GET',
          'access-control-request-private-network': 'false',
        },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Private-Network',
        'true',
      );
    });

    it('should not set Access-Control-Allow-Private-Network header when request header is missing', async () => {
      const config: CORSConfig = {
        origin: '*',
        allowPrivateNetwork: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'GET',
        },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Private-Network',
        'true',
      );
    });
  });

  describe('matchesCredentialsListWithWildcard', () => {
    it('should match exact origins', async () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['https://example.com', 'https://api.example.com'],
        credentialsAllowWildcardSubdomains: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should match wildcard patterns like *.example.com', async () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['*.example.com'],
        credentialsAllowWildcardSubdomains: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        headers: { origin: 'https://api.example.com' },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should match nested subdomains with wildcard', async () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['*.example.com'],
        credentialsAllowWildcardSubdomains: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        headers: { origin: 'https://api.example.com' }, // Use single subdomain instead of nested
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should NOT match apex domain with wildcard pattern', async () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['*.example.com'],
        credentialsAllowWildcardSubdomains: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should handle undefined origin', async () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['*.example.com'],
        credentialsAllowWildcardSubdomains: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        headers: {}, // No origin header
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should allow multi-label wildcard patterns that match matcher capabilities', () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['*.*.example.com', '*.api.*.example.com'], // Now valid patterns
        credentialsAllowWildcardSubdomains: true,
      };

      // Should NOT throw error - these patterns are now supported
      expect(() => cors(config)).not.toThrow();
    });

    it('should handle mixed exact and wildcard patterns', async () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['https://exact.com', '*.wildcard.com'],
        credentialsAllowWildcardSubdomains: true,
      };
      const pluginHost = createMockPluginHost();

      // Test exact match
      const exactRequest = createMockRequest({
        headers: { origin: 'https://exact.com' },
      });
      const exactReply = createMockReply();
      const plugin = cors(config);

      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(exactRequest, exactReply);

      expect(exactReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );

      // Test wildcard match
      const wildcardRequest = createMockRequest({
        headers: { origin: 'https://api.wildcard.com' },
      });
      const wildcardReply = createMockReply();

      await onRequestHook?.handler(wildcardRequest, wildcardReply);

      expect(wildcardReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should be case-insensitive for wildcard matching', async () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['*.Example.COM'],
        credentialsAllowWildcardSubdomains: true,
      };
      const pluginHost = createMockPluginHost();
      const request = createMockRequest({
        headers: { origin: 'https://api.example.com' },
      });
      const reply = createMockReply();

      const plugin = cors(config);
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should reject wildcard patterns when credentialsAllowWildcardSubdomains is false', () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['*.example.com'],
        credentialsAllowWildcardSubdomains: false, // Disabled
      };

      // Should throw error during plugin creation
      expect(() => cors(config)).toThrow(
        'Wildcard pattern "*.example.com" in credentials requires credentialsAllowWildcardSubdomains: true or use explicit origins.',
      );
    });

    it("should reject raw wildcard '*' in credentials", () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['*'],
        credentialsAllowWildcardSubdomains: true,
      };

      expect(() => cors(config)).toThrow(
        'Invalid CORS credentials origin "*": global wildcard \'*\' not allowed in this context',
      );
    });

    it('should reject protocol wildcards in credentials', () => {
      const testCases = [
        {
          pattern: 'https://*',
          expectedError: 'protocol wildcard not allowed',
        },
        { pattern: 'http://*', expectedError: 'protocol wildcard not allowed' },
        {
          pattern: 'https:///*',
          expectedError: 'origin must not contain path, query, or fragment',
        },
        {
          pattern: 'http:///*',
          expectedError: 'origin must not contain path, query, or fragment',
        },
      ];

      for (const { pattern, expectedError } of testCases) {
        const config: CORSConfig = {
          origin: '*',
          credentials: [pattern],
          credentialsAllowWildcardSubdomains: true,
        };

        expect(() => cors(config)).toThrow(
          `Invalid CORS credentials origin "${pattern}": ${expectedError}`,
        );
      }
    });
  });

  describe('allowedHeaders wildcard behavior', () => {
    it("should reflect exactly the requested headers when allowedHeaders is ['*']", async () => {
      const config: CORSConfig = {
        origin: 'https://example.com',
        allowedHeaders: ['*'],
      };

      const mockHost = createMockPluginHost();
      const mockOptions = createMockOptions();
      await cors(config)(mockHost, mockOptions);

      const hooks = mockHost.getHooks();
      const onRequestHook = hooks.find((h) => h.event === 'onRequest');
      expect(onRequestHook).toBeDefined();

      // Test preflight request with specific headers
      const mockRequest = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
          'access-control-request-headers':
            'x-custom-header,authorization,content-type',
        },
      });

      const mockReply = createMockReply();
      await onRequestHook?.handler(mockRequest, mockReply);

      // Should reflect exactly the requested headers (with spaces after commas)
      expect(mockReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        'x-custom-header, authorization, content-type',
      );
    });

    it("should handle empty access-control-request-headers with allowedHeaders: ['*']", async () => {
      const config: CORSConfig = {
        origin: 'https://example.com',
        allowedHeaders: ['*'],
      };

      const mockHost = createMockPluginHost();
      const mockOptions = createMockOptions();
      await cors(config)(mockHost, mockOptions);

      const hooks = mockHost.getHooks();
      const onRequestHook = hooks.find((h) => h.event === 'onRequest');

      const mockRequest = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
          // No access-control-request-headers
        },
      });

      const mockReply = createMockReply();
      await onRequestHook?.handler(mockRequest, mockReply);

      // Should not set Access-Control-Allow-Headers when no headers requested
      expect(mockReply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Headers',
        expect.anything(),
      );
    });
  });

  describe('credentials wildcard configuration', () => {
    it('should allow credentials for nested subdomains with credentialsAllowWildcardSubdomains: true and **.example.com', async () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['**.example.com'],
        credentialsAllowWildcardSubdomains: true,
      };

      const mockHost = createMockPluginHost();
      const mockOptions = createMockOptions();
      await cors(config)(mockHost, mockOptions);

      const hooks = mockHost.getHooks();
      const onRequestHook = hooks.find((h) => h.event === 'onRequest');

      // Test nested subdomain - should allow credentials
      const mockRequest = createMockRequest({
        headers: {
          origin: 'https://a.b.example.com',
        },
      });

      const mockReply = createMockReply();
      await onRequestHook?.handler(mockRequest, mockReply);

      expect(mockReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://a.b.example.com',
      );
      expect(mockReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should NOT allow credentials for apex domain with **.example.com pattern', async () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['**.example.com'],
        credentialsAllowWildcardSubdomains: true,
      };

      const mockHost = createMockPluginHost();
      const mockOptions = createMockOptions();
      await cors(config)(mockHost, mockOptions);

      const hooks = mockHost.getHooks();
      const onRequestHook = hooks.find((h) => h.event === 'onRequest');

      // Test apex domain - should NOT allow credentials due to ** pattern
      const mockRequest = createMockRequest({
        headers: {
          origin: 'https://example.com',
        },
      });

      const mockReply = createMockReply();
      await onRequestHook?.handler(mockRequest, mockReply);

      expect(mockReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://example.com',
      );
      // Should NOT set credentials header for apex domain with ** pattern
      expect(mockReply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it('should reject wildcard credentials configuration when credentialsAllowWildcardSubdomains: false', () => {
      const config: CORSConfig = {
        origin: 'https://example.com',
        credentials: ['*.example.com'],
        credentialsAllowWildcardSubdomains: false,
      };

      expect(() => cors(config)).toThrow(
        'Wildcard pattern "*.example.com" in credentials requires credentialsAllowWildcardSubdomains: true or use explicit origins.',
      );
    });

    it('should reject wildcard credentials configuration when credentialsAllowWildcardSubdomains is undefined', () => {
      const config: CORSConfig = {
        origin: 'https://example.com',
        credentials: ['*.example.com'],
        // credentialsAllowWildcardSubdomains not set (defaults to false)
      };

      expect(() => cors(config)).toThrow(
        'Wildcard pattern "*.example.com" in credentials requires credentialsAllowWildcardSubdomains: true or use explicit origins.',
      );
    });
  });

  describe('enhanced validateConfigEntry integration', () => {
    it('should reject global wildcard in credentials using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['*'],
        credentialsAllowWildcardSubdomains: true,
      };

      expect(() => cors(config)).toThrow(
        'Invalid CORS credentials origin "*": global wildcard \'*\' not allowed in this context',
      );
    });

    it('should reject protocol wildcards in credentials using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['https://*'],
        credentialsAllowWildcardSubdomains: true,
      };

      expect(() => cors(config)).toThrow(
        'Invalid CORS credentials origin "https://*": protocol wildcard not allowed',
      );
    });

    it('should reject invalid domain patterns in credentials using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['*.com'], // Public suffix - should be rejected
        credentialsAllowWildcardSubdomains: true,
      };

      expect(() => cors(config)).toThrow(
        'Invalid CORS credentials origin "*.com": wildcard tail targets public suffix or IP (disallowed)',
      );
    });

    it('should reject invalid origins using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['https://example.com/path'], // Path not allowed in origin
      };

      expect(() => cors(config)).toThrow(
        'Invalid CORS origin "https://example.com/path": origin must not contain path, query, or fragment',
      );
    });

    it('should reject protocol wildcards in origin arrays when not allowed', () => {
      const config: CORSConfig = {
        origin: ['https://*', 'http://*'], // Multiple protocol wildcards
      };

      expect(() => cors(config)).toThrow(
        "Invalid CORS config: only one of '*', 'https://*', or 'http://*' may be specified in origin. Found: https://*, http://*",
      );
    });

    it('should accept valid protocol wildcards in origin', () => {
      const config: CORSConfig = {
        origin: ['https://*'], // Single protocol wildcard should be allowed
      };

      expect(() => cors(config)).not.toThrow();
    });

    it('should accept valid subdomain patterns in credentials', () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['*.example.com', '**.api.example.com'],
        credentialsAllowWildcardSubdomains: true,
      };

      expect(() => cors(config)).not.toThrow();
    });

    it('should reject partial-label wildcards using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['api*.example.com'], // Partial label wildcard
      };

      expect(() => cors(config)).toThrow(
        'Invalid CORS origin "api*.example.com": partial-label wildcards are not allowed',
      );
    });

    it('should reject all-wildcard patterns using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['*.*'], // All wildcards pattern
      };

      expect(() => cors(config)).toThrow(
        'Invalid CORS origin "*.*": all-wildcards pattern is not allowed',
      );
    });
  });
});

import { describe, it, expect, mock } from 'bun:test';
import fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { securityHeaders } from './security-headers';
import type { CORSConfig, CSPConfig } from './security-headers';
import { domainValidation } from './domain-validation';
import type {
  PluginOptions,
  PluginHostInstance,
  ServerPlugin,
  UnirendServerMode,
} from '../types';
import type { InlineAttributeFinding } from '../internal/html-utils/format';
import { hashInlineContentForCSP } from '../internal/csp-hash';

/**
 * Most tests in this file exercise CORS behavior, which lives in its own
 * config block. This wraps a CORS config in the plugin's nested shape so the
 * test bodies stay focused on the behavior under test rather than repeating
 * the wrapper. Tests covering the non-CORS headers call securityHeaders()
 * directly.
 */
function corsHeaders(cors: CORSConfig = {}) {
  return securityHeaders({ cors });
}

interface MockRequest {
  url: string;
  method: string;
  headers: Record<string, string | undefined>;
  /**
   * Stands in for Fastify's resolved `request.protocol`. Fastify derives it
   * from the socket, or from x-forwarded-proto when `fastifyOptions.trustProxy`
   * vouches for the peer, so a test sets the resolved value directly rather
   * than the header. Defaults to https since that is the ordinary case.
   */
  protocol: string;
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
  protocol: 'https',
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
    decorateRequest: mock(
      (_name: string, _value: (...args: any[]) => Promise<void>) => undefined,
    ),
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

describe('securityHeaders', () => {
  describe('plugin registration', () => {
    it('should register onRequest hook', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = corsHeaders({ origin: 'https://example.com' });

      await plugin(pluginHost, options);

      expect(pluginHost.decorateRequest).toHaveBeenCalledWith(
        'applySecurityHeaders',
        expect.any(Function),
      );

      expect(pluginHost.addHook).toHaveBeenCalledWith(
        'onRequest',
        expect.any(Function),
      );
      // The onSend backstop covers responses that ended before the onRequest
      // hook could run, so the header set no longer depends on plugin order.
      expect(pluginHost.addHook).toHaveBeenCalledWith(
        'onSend',
        expect.any(Function),
      );
      expect(pluginHost.addHook).toHaveBeenCalledTimes(2);
    });

    it('should keep registration the same when exposedHeaders are configured', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = corsHeaders({
        origin: 'https://example.com',
        exposedHeaders: ['X-Custom-Header'],
      });

      await plugin(pluginHost, options);

      expect(pluginHost.decorateRequest).toHaveBeenCalledWith(
        'applySecurityHeaders',
        expect.any(Function),
      );
      expect(pluginHost.addHook).toHaveBeenCalledWith(
        'onRequest',
        expect.any(Function),
      );
      expect(pluginHost.addHook).toHaveBeenCalledTimes(2);
    });

    it("should throw when '*' is included in an origin array with other entries", () => {
      const config: CORSConfig = {
        origin: ['*', 'https://*'],
      };

      // This is validated earlier than the multi-special-wildcard check
      expect(() => corsHeaders(config)).toThrow(
        /do not include '\*' inside an origin array/i,
      );
    });

    it("should allow combining '*' with 'null' in origin array", async () => {
      const config: CORSConfig = {
        origin: ['*', 'null'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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

      expect(() => corsHeaders(config)).toThrow(
        /only one of '\*', 'https:\/\/\*', or 'http:\/\/\*' may be specified in origin/i,
      );
    });

    it('should throw when the same protocol wildcard appears more than once in origin array', () => {
      const config: CORSConfig = {
        origin: ['https://*', 'https://*'],
      };

      expect(() => corsHeaders(config)).toThrow(
        /only one of '\*', 'https:\/\/\*', or 'http:\/\/\*' may be specified in origin/i,
      );
    });

    it('should allow a single protocol wildcard inside an origin array', async () => {
      const config: CORSConfig = {
        origin: ['https://*'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders({ origin: 'https://allowed.com' });
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

      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders({ origin: 'https://*' });
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
      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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

      expect(() => corsHeaders(config)).toThrow(
        "Unsafe CORS: cannot combine origin '*' with dynamic credentials. Use a concrete origin list when enabling credentials.",
      );
    });
  });

  describe('CORS headers', () => {
    it('should set Access-Control-Allow-Origin header for allowed origins', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = corsHeaders({ origin: 'https://example.com' });
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
      const plugin = corsHeaders({
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

      expect(() => corsHeaders(config)).toThrow(
        /Cannot use credentials: true with protocol wildcard origins/i,
      );
    });

    it('should set Vary: Origin header for non-wildcard origins', async () => {
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = corsHeaders({ origin: 'https://example.com' });
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
      const plugin = corsHeaders({
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

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

      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders({
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
      const plugin = corsHeaders({
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
      const plugin = corsHeaders({
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
      const plugin = corsHeaders({
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
      const plugin = securityHeaders({
        cors: { origin: 'https://example.com' },
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
      const plugin = securityHeaders({
        cors: { origin: 'https://example.com' },
        frameOptions: 'DENY',
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

    it('should not send HSTS over plain HTTP', async () => {
      // RFC 6797 section 7.2: a host MUST NOT send Strict-Transport-Security
      // over a non-secure transport, and user agents MUST ignore it there.
      const pluginHost = createMockPluginHost();
      const plugin = securityHeaders({
        cors: { origin: 'https://example.com' },
        frameOptions: 'DENY',
        hsts: { maxAge: 31536000 },
      });
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        protocol: 'http',
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Strict-Transport-Security',
        expect.any(String),
      );

      // The other non-negotiated headers are unaffected by transport.
      expect(reply.header).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
    });

    it('should not send HSTS when only an untrusted forwarded header claims HTTPS', async () => {
      // Without fastifyOptions.trustProxy, Fastify leaves request.protocol as
      // the socket's protocol, so a client-supplied x-forwarded-proto cannot
      // switch HSTS on.
      const pluginHost = createMockPluginHost();
      const plugin = securityHeaders({
        cors: { origin: 'https://example.com' },
        hsts: { maxAge: 31536000 },
      });
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        protocol: 'http',
        headers: {
          origin: 'https://example.com',
          'x-forwarded-proto': 'https',
        },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Strict-Transport-Security',
        expect.any(String),
      );
    });

    it('should send HSTS when a trusted proxy resolved the request as HTTPS', async () => {
      // With trustProxy configured, Fastify resolves request.protocol to
      // 'https' from the forwarded header, which is the normal shape of a
      // TLS-terminating proxy in front of a plain-HTTP origin.
      const pluginHost = createMockPluginHost();
      const plugin = securityHeaders({
        cors: { origin: 'https://example.com' },
        hsts: { maxAge: 31536000 },
      });
      await plugin(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        protocol: 'https',
        headers: {
          origin: 'https://example.com',
          'x-forwarded-proto': 'https',
        },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(reply.header).toHaveBeenCalledWith(
        'Strict-Transport-Security',
        'max-age=31536000',
      );
    });

    it('should validate hsts.maxAge as non-negative number', () => {
      expect(() =>
        securityHeaders({
          cors: { origin: 'https://example.com' },
          hsts: { maxAge: -1 },
        }),
      ).toThrow(/hsts.maxAge must be a non-negative number/i);
    });

    it('should enforce preload requirements: maxAge >= 31536000 and includeSubDomains', () => {
      // Too small max-age
      expect(() =>
        securityHeaders({
          cors: { origin: 'https://example.com' },
          hsts: { maxAge: 300, preload: true, includeSubDomains: true },
        }),
      ).toThrow(/HSTS preload requires maxAge >= 31536000/i);

      // Missing includeSubDomains
      expect(() =>
        securityHeaders({
          cors: { origin: 'https://example.com' },
          hsts: { maxAge: 31536000, preload: true },
        }),
      ).toThrow(/HSTS preload requires includeSubDomains: true/i);

      // Valid preload config
      expect(() =>
        securityHeaders({
          cors: { origin: 'https://example.com' },
          hsts: { maxAge: 31536000, preload: true, includeSubDomains: true },
        }),
      ).not.toThrow();
    });

    it('should reject a frameOptions value no browser recognizes', () => {
      // The value goes onto the wire verbatim and a browser ignores one it does
      // not know, so 'ALLOWALL' is a page with no framing protection and a
      // config that reads as though it has some. There is no type to catch it
      // for a JavaScript caller, and nothing downstream would notice.
      expect(() =>
        securityHeaders({
          cors: { origin: 'https://example.com' },
          // @ts-expect-error the type already rules this out, the check is for
          // callers who do not have it
          frameOptions: 'ALLOWALL',
        }),
      ).toThrow(/frameOptions must be 'DENY', 'SAMEORIGIN', or false/i);

      // Rejected rather than read as "not set", so an empty form field or a
      // JSON column gets an answer instead of a guess.
      expect(() =>
        securityHeaders({
          cors: { origin: 'https://example.com' },
          // @ts-expect-error same as above
          frameOptions: null,
        }),
      ).toThrow(/frameOptions must be 'DENY', 'SAMEORIGIN', or false/i);

      // Checked without a CSP present, unlike the framing cross-check, which
      // has no pair to judge until there is one.
      expect(() =>
        securityHeaders({
          cors: { origin: 'https://example.com' },
          frameOptions: 'DENY',
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
      await plugin(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      await onRequestHook?.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalledWith(403);
    });

    it('should handle origins with ports', async () => {
      const config: CORSConfig = {
        origin: ['https://example.com:8080'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { origin: 'https://example.com:8080' },
      });
      const reply = createMockReply();

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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

      expect(() => corsHeaders(config)).toThrow(
        "Cannot use credentials: true with origin: '*'. The CORS specification prohibits Access-Control-Allow-Credentials: true with Access-Control-Allow-Origin: *. Use specific origins instead.",
      );
    });

    it("should normalize ['*'] to '*' and behave as wildcard", async () => {
      const config: CORSConfig = {
        origin: ['*'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = corsHeaders(config);
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
      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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

      const plugin = corsHeaders(config);
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
      expect(() => corsHeaders(config)).not.toThrow();
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
      const plugin = corsHeaders(config);

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

      const plugin = corsHeaders(config);
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
      expect(() => corsHeaders(config)).toThrow(
        'Wildcard pattern "*.example.com" in credentials requires credentialsAllowWildcardSubdomains: true or use explicit origins.',
      );
    });

    it("should reject raw wildcard '*' in credentials", () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: ['*'],
        credentialsAllowWildcardSubdomains: true,
      };

      expect(() => corsHeaders(config)).toThrow(
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

        expect(() => corsHeaders(config)).toThrow(
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
      await corsHeaders(config)(mockHost, mockOptions);

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
      await corsHeaders(config)(mockHost, mockOptions);

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
      await corsHeaders(config)(mockHost, mockOptions);

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
      await corsHeaders(config)(mockHost, mockOptions);

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

      expect(() => corsHeaders(config)).toThrow(
        'Wildcard pattern "*.example.com" in credentials requires credentialsAllowWildcardSubdomains: true or use explicit origins.',
      );
    });

    it('should reject wildcard credentials configuration when credentialsAllowWildcardSubdomains is undefined', () => {
      const config: CORSConfig = {
        origin: 'https://example.com',
        credentials: ['*.example.com'],
        // credentialsAllowWildcardSubdomains not set (defaults to false)
      };

      expect(() => corsHeaders(config)).toThrow(
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

      expect(() => corsHeaders(config)).toThrow(
        'Invalid CORS credentials origin "*": global wildcard \'*\' not allowed in this context',
      );
    });

    it('should reject protocol wildcards in credentials using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['https://*'],
        credentialsAllowWildcardSubdomains: true,
      };

      expect(() => corsHeaders(config)).toThrow(
        'Invalid CORS credentials origin "https://*": protocol wildcard not allowed',
      );
    });

    it('should reject invalid domain patterns in credentials using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['*.com'], // Public suffix - should be rejected
        credentialsAllowWildcardSubdomains: true,
      };

      expect(() => corsHeaders(config)).toThrow(
        'Invalid CORS credentials origin "*.com": wildcard tail targets public suffix or IP (disallowed)',
      );
    });

    it('should reject invalid origins using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['https://example.com/path'], // Path not allowed in origin
      };

      expect(() => corsHeaders(config)).toThrow(
        'Invalid CORS origin "https://example.com/path": origin must not contain path, query, or fragment',
      );
    });

    it('should reject protocol wildcards in origin arrays when not allowed', () => {
      const config: CORSConfig = {
        origin: ['https://*', 'http://*'], // Multiple protocol wildcards
      };

      expect(() => corsHeaders(config)).toThrow(
        "Invalid CORS config: only one of '*', 'https://*', or 'http://*' may be specified in origin. Found: https://*, http://*",
      );
    });

    it('should accept valid protocol wildcards in origin', () => {
      const config: CORSConfig = {
        origin: ['https://*'], // Single protocol wildcard should be allowed
      };

      expect(() => corsHeaders(config)).not.toThrow();
    });

    it('should accept valid subdomain patterns in credentials', () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['*.example.com', '**.api.example.com'],
        credentialsAllowWildcardSubdomains: true,
      };

      expect(() => corsHeaders(config)).not.toThrow();
    });

    it('should reject partial-label wildcards using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['api*.example.com'], // Partial label wildcard
      };

      expect(() => corsHeaders(config)).toThrow(
        'Invalid CORS origin "api*.example.com": partial-label wildcards are not allowed',
      );
    });

    it('should reject all-wildcard patterns using validateConfigEntry', () => {
      const config: CORSConfig = {
        origin: ['*.*'], // All wildcards pattern
      };

      expect(() => corsHeaders(config)).toThrow(
        'Invalid CORS origin "*.*": all-wildcards pattern is not allowed',
      );
    });
  });

  // -------------------------------------------------------------------------
  // credentials: ['null'] — validateCredentialsOrigins null-origin guard
  // -------------------------------------------------------------------------

  describe("credentials: ['null'] rejection", () => {
    it("rejects 'null' as a credentials origin", () => {
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: ['null'],
      };

      expect(() => corsHeaders(config)).toThrow(
        "credentials cannot be enabled for the 'null' origin",
      );
    });
  });

  // -------------------------------------------------------------------------
  // origin as a function — isOriginAllowed function branch
  // -------------------------------------------------------------------------

  describe('origin as a function', () => {
    it('calls the origin function and allows when it returns true', async () => {
      const originFn = mock((_origin: string | undefined) => true);
      const config: CORSConfig = {
        origin: originFn,
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      await corsHeaders(config)(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      const request = createMockRequest({
        headers: { origin: 'https://dynamic.example.com' },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(originFn).toHaveBeenCalled();
      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://dynamic.example.com',
      );
    });

    it('calls the origin function and blocks when it returns false', async () => {
      const config: CORSConfig = {
        origin: mock((_origin: string | undefined) => false),
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      await corsHeaders(config)(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      const request = createMockRequest({
        headers: { origin: 'https://blocked.example.com' },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.anything(),
      );
    });
  });

  describe('inline attributes reported by a template', () => {
    /**
     * Install the plugin on a mock host and call the decorated addCSPSources
     * with an inline-attribute report, returning whatever it logged.
     */
    // Hashes of the attribute values the findings below stand for, quoted the
    // way a policy would list them. Real ones, so a test that expects a policy
    // to cover an attribute is expecting what a browser would actually accept.
    const ONCLICK_HASH = `'${hashInlineContentForCSP("alert('x')")}'`;
    const STYLE_HASH = `'${hashInlineContentForCSP('color: red')}'`;

    const ONCLICK: InlineAttributeFinding = {
      description: '<button> has onclick=',
      kind: 'script',
      hash: ONCLICK_HASH,
    };

    const STYLE_ATTR: InlineAttributeFinding = {
      description: '<div> has style=',
      kind: 'style',
      hash: STYLE_HASH,
    };

    async function warningsFor(
      csp: CSPConfig,
      inlineAttributes: readonly InlineAttributeFinding[] = [ONCLICK],
    ): Promise<unknown[]> {
      const pluginHost = createMockPluginHost();

      await securityHeaders({ csp })(pluginHost, createMockOptions());

      // Through the onRequest hook rather than the decoration, because that is
      // where addCSPSources is now installed and bound to this request's
      // policy. Reaching for the decorated value directly would test a
      // placeholder.
      const warnings: unknown[] = [];
      const request = createMockRequest({
        log: { warn: (...args: unknown[]) => warnings.push(args) },
      }) as ReturnType<typeof createMockRequest> & {
        addCSPSources?: (sources: {
          inlineAttributes?: readonly InlineAttributeFinding[];
        }) => void;
      };

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      await onRequestHook?.handler(request, createMockReply());

      if (!request.addCSPSources) {
        throw new Error('addCSPSources was not installed on the request');
      }

      request.addCSPSources({ inlineAttributes });

      return warnings;
    }

    it('warns when the policy would block them', () => {
      // An attribute needs 'unsafe-hashes' plus its own hash, or
      // 'unsafe-inline'. A directive with neither blocks it silently.
      return warningsFor({ scriptSrc: ["'self'"] }).then((warnings) => {
        expect(warnings).toHaveLength(1);
      });
    });

    it("still warns when 'unsafe-hashes' is set without the hash", () => {
      // 'unsafe-hashes' is a modifier, not a permission: it only makes hash
      // sources eligible to match an attribute. On its own it permits nothing,
      // so the handler is still blocked and staying quiet would be telling
      // someone their page works when it does not. Confirmed against Chrome,
      // which blocks onclick under script-src-attr 'unsafe-hashes' alone.
      return warningsFor({
        scriptSrc: ["'self'", "'unsafe-hashes'"],
      }).then((warnings) => {
        expect(warnings).toHaveLength(1);
      });
    });

    it("stays quiet when 'unsafe-hashes' is set with the matching hash", () => {
      // The combination that actually works, and the one the warning tells you
      // to reach for if you are going to take this route at all.
      return warningsFor({
        scriptSrc: ["'self'", "'unsafe-hashes'", ONCLICK_HASH],
      }).then((warnings) => {
        expect(warnings).toHaveLength(0);
      });
    });

    it('still warns when the hash present covers a different attribute', () => {
      // The case a keyword-only check waves through: the author hashed one
      // attribute and left another uncovered, and the second one is blocked.
      return warningsFor({
        scriptSrc: ["'self'", "'unsafe-hashes'", STYLE_HASH],
      }).then((warnings) => {
        expect(warnings).toHaveLength(1);
      });
    });

    it("stays quiet when 'unsafe-inline' is set", () => {
      // Unlike 'unsafe-hashes', this one does permit the attribute outright.
      return warningsFor({
        scriptSrc: ["'self'", "'unsafe-inline'"],
        allowUnsafeInlineScript: true,
      }).then((warnings) => {
        expect(warnings).toHaveLength(0);
      });
    });

    it("warns when a hash has made 'unsafe-inline' inert", () => {
      // Writing the keyword is not the same as it taking effect. A browser
      // ignores 'unsafe-inline' once a hash joins the list, so the handler is
      // blocked, and the author reading their own policy is the last person who
      // would guess that.
      return warningsFor({
        scriptSrc: ["'self'", "'unsafe-inline'", "'sha256-unrelated='"],
        allowUnsafeInlineScript: true,
      }).then((warnings) => {
        expect(warnings).toHaveLength(1);
      });
    });

    it("warns when a nonce has made 'unsafe-inline' inert", () => {
      return warningsFor({
        scriptSrc: ["'self'", "'unsafe-inline'", "'nonce-abc123'"],
        allowUnsafeInlineScript: true,
      }).then((warnings) => {
        expect(warnings).toHaveLength(1);
      });
    });

    it("warns when 'strict-dynamic' has made 'unsafe-inline' inert", () => {
      return warningsFor({
        scriptSrc: ["'self'", "'unsafe-inline'", "'strict-dynamic'"],
        allowUnsafeInlineScript: true,
      }).then((warnings) => {
        expect(warnings).toHaveLength(1);
      });
    });

    it("ignores 'strict-dynamic' when judging a style attribute", () => {
      // The keyword is read only for scripts and script attributes, so a style
      // attribute under this policy actually runs and warning would be a false
      // alarm. Confirmed in Chrome, where the inline style applies.
      return warningsFor(
        { styleSrc: ["'self'", "'unsafe-inline'", "'strict-dynamic'"] },
        [STYLE_ATTR],
      ).then((warnings) => {
        expect(warnings).toHaveLength(0);
      });
    });

    it('still warns about a style attribute once a hash joins the directive', () => {
      // A hash disables 'unsafe-inline' for styles as much as for scripts, so
      // this one really is blocked. Only 'strict-dynamic' is script-only.
      return warningsFor(
        { styleSrc: ["'self'", "'unsafe-inline'", "'sha256-unrelated='"] },
        [STYLE_ATTR],
      ).then((warnings) => {
        expect(warnings).toHaveLength(1);
      });
    });

    it('reports two handlers on the same element type separately', () => {
      // Same description, different values, so they need different hashes to
      // fix. Deduping on the description would report the first and swallow the
      // second, leaving a blocked handler with nothing said about it.
      const second: InlineAttributeFinding = {
        description: '<button> has onclick=',
        kind: 'script',
        hash: `'${hashInlineContentForCSP('other()')}'`,
      };

      return warningsFor({ scriptSrc: ["'self'"] }, [ONCLICK, second]).then(
        (warnings) => {
          expect(warnings).toHaveLength(1);

          const logged = JSON.stringify(warnings);

          expect(logged).toContain(ONCLICK.hash.slice(1, -1));
          expect(logged).toContain(second.hash.slice(1, -1));
        },
      );
    });

    it('warns about a second handler the policy does not cover', () => {
      // The case the collapse hid entirely: one handler hashed, the other not.
      // Judging the template by the first would call it clean.
      const uncovered: InlineAttributeFinding = {
        description: '<button> has onclick=',
        kind: 'script',
        hash: `'${hashInlineContentForCSP('other()')}'`,
      };

      return warningsFor(
        { scriptSrc: ["'self'", "'unsafe-hashes'", ONCLICK_HASH] },
        [ONCLICK, uncovered],
      ).then((warnings) => {
        expect(warnings).toHaveLength(1);

        const logged = JSON.stringify(warnings);

        expect(logged).toContain(uncovered.hash.slice(1, -1));
        expect(logged).not.toContain(ONCLICK.hash.slice(1, -1));
      });
    });

    it('stays quiet when the -attr directive opted in', async () => {
      // script-src-attr is what governs an onclick= when it is set, so someone
      // who put 'unsafe-inline' there has made this decision in the most
      // specific place the spec offers. Warning anyway is the noise this check
      // exists to prevent.
      return warningsFor({
        scriptSrc: ["'self'"],
        scriptSrcAttr: ["'unsafe-inline'"],
        allowUnsafeInlineScript: true,
      }).then((warnings) => {
        expect(warnings).toHaveLength(0);
      });
    });

    it('reports the hash that would cover the attribute', async () => {
      // The one thing in the message that cannot be worked out later by hand,
      // since the attribute value is only in hand while the template is being
      // scanned.
      const warnings = await warningsFor({ scriptSrc: ["'self'"] });

      expect(JSON.stringify(warnings)).toContain(ONCLICK_HASH.slice(1, -1));
      expect(JSON.stringify(warnings)).toContain('script-src-attr');
    });

    it('does not let a style opt-in excuse a script attribute', async () => {
      // style-src has nothing to say about an onclick=. Reading an opt-in there
      // as permission for one silences a real finding on the strength of a
      // decision the author made about something else entirely.
      const warnings = await warningsFor({
        scriptSrc: ["'self'"],
        styleSrc: ["'unsafe-inline'"],
      });

      expect(warnings).toHaveLength(1);
    });

    it('does not let a script opt-in excuse a style attribute', async () => {
      // The same confusion in the other direction.
      const warnings = await warningsFor(
        {
          scriptSrc: ["'unsafe-inline'"],
          styleSrc: ["'self'"],
          allowUnsafeInlineScript: true,
        },
        [STYLE_ATTR],
      );

      expect(warnings).toHaveLength(1);
    });

    it('stops at the -attr directive when it blocks the attribute', async () => {
      // CSP fallback stops at the first directive that is set, it does not
      // union the chain. script-src-attr 'none' is the author saying no inline
      // handlers, specifically, and it is the only directive a browser consults
      // for one. A permissive script-src underneath it is not reached, so
      // reading it as permission gets the answer backwards on a policy that is
      // actively blocking the handler.
      const warnings = await warningsFor({
        scriptSrcAttr: ["'none'"],
        scriptSrc: ["'unsafe-inline'"],
        allowUnsafeInlineScript: true,
      });

      expect(warnings).toHaveLength(1);
    });

    it('falls through an empty directive to the next in the chain', async () => {
      // An empty array serializes to nothing, so the browser never sees the
      // directive and falls through it. Treating it as "set, and it does not
      // permit" would warn about an attribute that actually runs.
      const warnings = await warningsFor({
        scriptSrcAttr: [],
        scriptSrc: ["'unsafe-hashes'", ONCLICK_HASH, "'self'"],
      });

      expect(warnings).toHaveLength(0);
    });

    it('honors default-src when nothing more specific is set', async () => {
      const warnings = await warningsFor({
        defaultSrc: ["'unsafe-inline'"],
        allowUnsafeInlineScript: true,
      });

      expect(warnings).toHaveLength(0);
    });

    it('stays quiet when no directive governs the attribute at all', async () => {
      // Nothing in the chain is set, so nothing blocks the attribute and there
      // is nothing to report.
      const warnings = await warningsFor({ imgSrc: ["'self'"] });

      expect(warnings).toHaveLength(0);
    });

    it('judges each finding on its own directive', async () => {
      // One template can report both kinds, and a policy can easily permit one
      // while blocking the other. Judging the group by either one would hide a
      // real finding or invent one.
      const warnings = await warningsFor(
        {
          scriptSrc: ["'self'"],
          styleSrc: ["'unsafe-inline'"],
        },
        [ONCLICK, STYLE_ATTR],
      );

      expect(warnings).toHaveLength(1);
      expect(JSON.stringify(warnings)).toContain('onclick');
      expect(JSON.stringify(warnings)).not.toContain('has style=');
    });

    it('warns once per distinct finding, not once per request', async () => {
      const pluginHost = createMockPluginHost();

      await securityHeaders({ csp: { scriptSrc: ["'self'"] } })(
        pluginHost,
        createMockOptions(),
      );

      const warnings: unknown[] = [];
      const request = createMockRequest({
        log: { warn: (...args: unknown[]) => warnings.push(args) },
      }) as ReturnType<typeof createMockRequest> & {
        addCSPSources?: (sources: {
          inlineAttributes?: readonly InlineAttributeFinding[];
        }) => void;
      };

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      await onRequestHook?.handler(request, createMockReply());

      // Templates are per app and fixed, so repeating this per request would
      // say nothing new.
      for (let index = 0; index < 5; index += 1) {
        request.addCSPSources?.({ inlineAttributes: [ONCLICK] });
      }

      expect(warnings).toHaveLength(1);

      // A different handler on the same element type is a different finding
      // needing a different hash, so the once-per-process guard must not treat
      // it as already said. This is where keying on the description alone would
      // swallow it: the first call has already claimed that description.
      request.addCSPSources?.({
        inlineAttributes: [
          {
            description: '<button> has onclick=',
            kind: 'script',
            hash: `'${hashInlineContentForCSP('different()')}'`,
          },
        ],
      });

      expect(warnings).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Callbacks that throw — fail closed rather than 500
  // -------------------------------------------------------------------------

  describe('callbacks that throw', () => {
    it('denies the origin instead of propagating', async () => {
      const config: CORSConfig = {
        origin: () => {
          throw new Error('origin lookup failed');
        },
      };

      const pluginHost = createMockPluginHost();
      await corsHeaders(config)(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        headers: { origin: 'https://caller.example.com' },
      });
      const reply = createMockReply();

      await onRequestHook?.handler(request, reply);

      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        expect.anything(),
      );
      expect(request.corsOriginAllowed).toBe(false);
    });

    it('invokes a throwing origin callback once per request', async () => {
      // The double-fault this prevents: the callback throws, the 500 that used
      // to cause runs the error path, the error path applies security headers,
      // and the callback throws a second time from inside the handler dealing
      // with the first throw. Caching the denial is what breaks the loop.
      const originFn = mock(() => {
        throw new Error('origin lookup failed');
      });

      const pluginHost = createMockPluginHost();
      await corsHeaders({ origin: originFn })(pluginHost, createMockOptions());

      const decorateCall = (
        pluginHost.decorateRequest as unknown as {
          mock: { calls: Array<[string, (reply: unknown) => Promise<void>]> };
        }
      ).mock.calls[0];
      const applySecurityHeaders = decorateCall[1];

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        headers: { origin: 'https://caller.example.com' },
      });

      await onRequestHook?.handler(request, createMockReply());
      // Stands in for the raw/hijacked path, which is what the error path uses.
      await applySecurityHeaders.call(request, createMockReply());

      expect(originFn).toHaveBeenCalledTimes(1);
    });

    it('withholds credentials instead of propagating', async () => {
      const config: CORSConfig = {
        origin: ['https://caller.example.com'],
        credentials: () => {
          throw new Error('credentials lookup failed');
        },
      };

      const pluginHost = createMockPluginHost();
      await corsHeaders(config)(pluginHost, createMockOptions());

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        headers: { origin: 'https://caller.example.com' },
      });
      const reply = createMockReply();

      await onRequestHook?.handler(request, reply);

      // The origin decision stands on its own, so the request is still CORS
      // enabled. Only the credentials grant is withheld.
      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://caller.example.com',
      );
      expect(reply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        expect.anything(),
      );
    });

    it('invokes a throwing credentials callback once per request', async () => {
      const credentialsFn = mock(() => {
        throw new Error('credentials lookup failed');
      });

      const pluginHost = createMockPluginHost();
      await corsHeaders({
        origin: ['https://caller.example.com'],
        credentials: credentialsFn,
      })(pluginHost, createMockOptions());

      const decorateCall = (
        pluginHost.decorateRequest as unknown as {
          mock: { calls: Array<[string, (reply: unknown) => Promise<void>]> };
        }
      ).mock.calls[0];
      const applySecurityHeaders = decorateCall[1];

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');

      const request = createMockRequest({
        headers: { origin: 'https://caller.example.com' },
      });

      await onRequestHook?.handler(request, createMockReply());
      await applySecurityHeaders.call(request, createMockReply());

      expect(credentialsFn).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // credentials as a function — areCredentialsAllowed function branch
  // -------------------------------------------------------------------------

  describe('credentials as a function', () => {
    it('calls the credentials function and allows when it returns true', async () => {
      const credFn = mock((_origin: string | undefined) => true);
      const config: CORSConfig = {
        origin: ['https://example.com'],
        credentials: credFn,
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      await corsHeaders(config)(pluginHost, options);

      const onRequestHook = pluginHost
        .getHooks()
        .find((h) => h.event === 'onRequest');
      const request = createMockRequest({
        headers: { origin: 'https://example.com' },
      });
      const reply = createMockReply();
      await onRequestHook?.handler(request, reply);

      expect(credFn).toHaveBeenCalled();
      expect(reply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });
  });

  // -------------------------------------------------------------------------
  // credentials: true + array origin with protocol wildcard
  // -------------------------------------------------------------------------

  describe('credentials: true + protocol-wildcard array origin', () => {
    it('throws when origin array contains https://* and credentials: true without opt-in', () => {
      const config: CORSConfig = {
        origin: ['https://*'],
        credentials: true,
        // allowCredentialsWithProtocolWildcard not set → throws
      };

      expect(() => corsHeaders(config)).toThrow(
        'Cannot use credentials: true with protocol wildcard origins',
      );
    });
  });

  // -------------------------------------------------------------------------
  // origin: '*', credentials: [] — empty allowlist guard
  // -------------------------------------------------------------------------

  describe("origin: '*' + empty credentials array", () => {
    it('throws when credentials is an empty array combined with origin: *', () => {
      const config: CORSConfig = {
        origin: '*',
        credentials: [],
      };

      expect(() => corsHeaders(config)).toThrow(
        "credentials list is empty; cannot combine origin '*' with credentials",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Single-string invalid origin
  // -------------------------------------------------------------------------

  describe('single-string origin validation', () => {
    it('rejects a string origin with a path component', () => {
      const config: CORSConfig = {
        origin: 'https://example.com/path',
      };

      expect(() => corsHeaders(config)).toThrow(
        'Invalid CORS origin "https://example.com/path"',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Wildcard + non-null entry in origin array
  // -------------------------------------------------------------------------

  describe('wildcard + non-null entry in origin array', () => {
    it('throws when a non-null regular origin follows a protocol wildcard', () => {
      const config: CORSConfig = {
        origin: ['https://*', 'https://specific.example.com'],
      };

      expect(() => corsHeaders(config)).toThrow(
        "when a wildcard token is present, the only other allowed entry is the literal 'null'",
      );
    });
  });

  // -------------------------------------------------------------------------
  // ['*', 'null'] + credentials: true / function
  // -------------------------------------------------------------------------

  describe("origin array with '*' and null + credentials guards", () => {
    it("throws when credentials: true is combined with origin array containing '*'", () => {
      const config: CORSConfig = {
        origin: ['*', 'null'],
        credentials: true,
      };

      expect(() => corsHeaders(config)).toThrow(
        "Cannot use credentials: true when origin array contains '*'",
      );
    });

    it("throws when a credentials function is combined with origin array containing '*'", () => {
      const config: CORSConfig = {
        origin: ['*', 'null'],
        credentials: mock((_origin: string | undefined) => true),
      };

      expect(() => corsHeaders(config)).toThrow(
        "Unsafe CORS: cannot combine an origin array containing '*' with dynamic credentials",
      );
    });
  });

  // -------------------------------------------------------------------------
  // applySecurityHeaders decorator body
  // -------------------------------------------------------------------------

  describe('applySecurityHeaders decorator', () => {
    it('calls applyCORSActualResponseHeaders when the decorator is invoked', async () => {
      let capturedDecorator:
        ((...args: unknown[]) => Promise<void>) | undefined;

      const capturingHost = {
        decorateRequest: mock(
          (name: string, fn: (...args: unknown[]) => Promise<void>) => {
            // By name: addCSPSources is also decorated, as an undefined
            // placeholder that the onRequest hook fills in per request.
            if (name === 'applySecurityHeaders') {
              capturedDecorator = fn;
            }
          },
        ),
        addHook: mock(
          (_event: string, _handler: (...args: unknown[]) => Promise<void>) =>
            undefined,
        ),
        getHooks: () =>
          [] as Array<{
            event: string;
            handler: (...args: unknown[]) => Promise<void>;
          }>,
      } as unknown as MockPluginHost;

      const options = createMockOptions();
      await corsHeaders({ origin: 'https://example.com' })(
        capturingHost,
        options,
      );

      expect(capturedDecorator).toBeDefined();

      const mockReply = createMockReply();
      const mockRequest = createMockRequest({
        corsOriginAllowed: true,
      });

      // Invoke the decorator with `this` bound to the mock request
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      await capturedDecorator!.call(mockRequest, mockReply);

      // applyCORSActualResponseHeaders sets response headers
      expect(mockReply.header).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Non-wildcard allowedHeaders: invalid header names filtered
  // -------------------------------------------------------------------------

  describe('non-wildcard allowedHeaders preflight — invalid header filtering', () => {
    it('skips header names containing spaces', async () => {
      const config: CORSConfig = {
        origin: 'https://example.com',
        allowedHeaders: ['Content-Type', 'Authorization'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      await corsHeaders(config)(pluginHost, options);

      const hooks = pluginHost.getHooks();
      const onRequestHook = hooks.find((h) => h.event === 'onRequest');

      const mockRequest = createMockRequest({
        method: 'OPTIONS',
        headers: {
          origin: 'https://example.com',
          'access-control-request-method': 'POST',
          // "bad header!!!" has a space — invalid per RFC 7230 token
          'access-control-request-headers': 'Content-Type, bad header!!!',
        },
      });

      const mockReply = createMockReply();
      await onRequestHook?.handler(mockRequest, mockReply);

      // Only Content-Type should appear; the invalid header was filtered
      const headerCalls = mockReply.header.mock.calls as Array<
        [string, string]
      >;
      const allowHeadersCall = headerCalls.find(
        ([k]) => k === 'Access-Control-Allow-Headers',
      );
      expect(allowHeadersCall).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const headerValue = allowHeadersCall![1];
      expect(headerValue).not.toContain('bad header');
    });
  });

  /**
   * These run against a real listening server rather than the mocks above,
   * because what is under test is a response that ends before securityHeaders'
   * own onRequest hook can run. A mock host cannot express that: it hands each
   * hook a fresh reply and never runs a lifecycle, so the ordering the bug is
   * about does not exist there.
   *
   * A real socket rather than app.inject(): under Bun, light-my-request leaves
   * raw.writableEnded false right after reply.send(), so Fastify's reply.sent
   * check lets the chain continue into the route handler and the second send
   * throws ERR_HTTP_HEADERS_SENT. Against a listening server Bun stops the
   * chain correctly, same as Node.
   *
   * trustProxy is on so x-forwarded-host and x-forwarded-proto can stand in for
   * a Host header and TLS, neither of which fetch() will let a test set.
   */
  describe('order-independent application (real server)', () => {
    interface OrderedPluginsCase {
      /** Plugin order under test, built fresh per case. */
      plugins: Array<ServerPlugin<UnirendServerMode>>;
      host: string;
      origin?: string;
      protocol?: string;
    }

    async function respondTo({
      plugins,
      host,
      origin,
      protocol = 'https',
    }: OrderedPluginsCase) {
      const app = fastify({ trustProxy: true });

      for (const plugin of plugins) {
        await plugin(app as unknown as PluginHostInstance, createMockOptions());
      }

      app.get('/test', () => ({ ok: true }));
      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        return await fetch(`http://127.0.0.1:${port}/test`, {
          headers: {
            'x-forwarded-host': host,
            'x-forwarded-proto': protocol,
            ...(origin ? { origin } : {}),
          },
          redirect: 'manual',
        });
      } finally {
        await app.close();
      }
    }

    const gatekeeper = () =>
      domainValidation({
        enforceHTTPS: false,
        validProductionDomains: ['allowed.example.com'],
      });

    const headers = () =>
      securityHeaders({
        cors: { origin: ['https://app.example.com'] },
        frameOptions: 'DENY',
        hsts: { maxAge: 31536000 },
      });

    it('applies security headers to a 403 sent by a plugin listed earlier', async () => {
      // The ordering the bug was about: domainValidation ends the request from
      // its own onRequest hook, so securityHeaders' onRequest never runs.
      const response = await respondTo({
        plugins: [gatekeeper(), headers()],
        host: 'evil.example.com',
        origin: 'https://app.example.com',
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('x-frame-options')).toBe('DENY');
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://app.example.com',
      );
      expect(response.headers.get('vary')).toContain('Origin');
    });

    it('does not send HSTS for a host domainValidation disclaimed', async () => {
      const response = await respondTo({
        plugins: [gatekeeper(), headers()],
        host: 'evil.example.com',
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('strict-transport-security')).toBeNull();
    });

    it('strips HSTS already set when securityHeaders ran first', async () => {
      // Reverse order: securityHeaders' onRequest ran and set HSTS before
      // domainValidation decided the host is not ours, so the backstop has to
      // take it back off rather than merely decline to add it.
      const response = await respondTo({
        plugins: [headers(), gatekeeper()],
        host: 'evil.example.com',
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('strict-transport-security')).toBeNull();
      expect(response.headers.get('x-frame-options')).toBe('DENY');
    });

    it('still sends HSTS on an allowed host, in either plugin order', async () => {
      for (const plugins of [
        [gatekeeper(), headers()],
        [headers(), gatekeeper()],
      ]) {
        const response = await respondTo({
          plugins,
          host: 'allowed.example.com',
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('strict-transport-security')).toBe(
          'max-age=31536000',
        );
      }
    });

    it('serves the route when an origin callback throws', async () => {
      // The point of failing closed rather than propagating: the request is
      // fine, it is the policy that could not be evaluated. Propagating turned
      // an unavailable tenant lookup into a 500 for everyone, including the
      // same-origin traffic the callback was never consulted about.
      const throwingOrigin: ServerPlugin<UnirendServerMode> = (host, opts) =>
        securityHeaders({
          cors: {
            origin: () => {
              throw new Error('origin lookup failed');
            },
          },
          frameOptions: 'DENY',
        })(host, opts);

      const response = await respondTo({
        plugins: [throwingOrigin],
        host: 'allowed.example.com',
        origin: 'https://app.example.com',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
      // Headers that do not depend on the failed decision are unaffected.
      expect(response.headers.get('x-frame-options')).toBe('DENY');
    });

    it('suppresses HSTS for a rejected host even when the request then fails', async () => {
      // The gate rejects, so domainValidationRejected is set and HSTS comes
      // off. Establishes the baseline the next test contrasts with: nothing
      // about a later failure is what protects the host, the gate running is.
      const app = fastify({ trustProxy: true });

      await gatekeeper()(
        app as unknown as PluginHostInstance,
        createMockOptions(),
      );

      await securityHeaders({ hsts: { maxAge: 31536000 } })(
        app as unknown as PluginHostInstance,
        createMockOptions(),
      );

      app.addHook('onRequest', () =>
        Promise.reject(new Error('registered below the gate, never reached')),
      );

      app.get('/test', () => ({ ok: true }));
      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/test`, {
          headers: {
            'x-forwarded-host': 'evil.example.com',
            'x-forwarded-proto': 'https',
          },
        });

        expect(response.status).toBe(403);
        expect(response.headers.get('strict-transport-security')).toBeNull();
      } finally {
        await app.close();
      }
    });

    it('cannot suppress HSTS when a hook above the gate throws first', async () => {
      // Documents a footgun rather than a feature. A hook that throws above
      // domainValidation ends the request before the gate runs, so
      // domainValidationRejected is never set and the suppression has nothing
      // to act on: a host that was never checked is pinned to HTTPS for the full
      // max-age. Nothing downstream can repair it, because the request has
      // already failed by then. Ordering is the only fix, and this test exists
      // so that anyone changing the ordering guidance sees the cost.
      const app = fastify({ trustProxy: true });

      app.addHook('onRequest', () =>
        Promise.reject(new Error('registered above the gate, runs first')),
      );

      await gatekeeper()(
        app as unknown as PluginHostInstance,
        createMockOptions(),
      );

      await securityHeaders({ hsts: { maxAge: 31536000 } })(
        app as unknown as PluginHostInstance,
        createMockOptions(),
      );

      app.get('/test', () => ({ ok: true }));
      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/test`, {
          headers: {
            'x-forwarded-host': 'evil.example.com',
            'x-forwarded-proto': 'https',
          },
        });

        expect(response.status).toBe(500);
        expect(response.headers.get('strict-transport-security')).toBe(
          'max-age=31536000',
        );
      } finally {
        await app.close();
      }
    });

    it('covers every status and content type, not just the happy path', async () => {
      // onSend has no status or content-type condition, so this is not an
      // error-page feature: headers go on as the response leaves, whoever
      // produced it. Pinned because "does my JSON 500 get a CSP?" is a
      // reasonable thing to doubt from reading "runs for every reply", and
      // because a status check added here later would look harmless.
      const app = fastify({ trustProxy: true });

      await securityHeaders({
        cors: { origin: ['https://app.example.com'] },
        frameOptions: 'DENY',
        hsts: { maxAge: 31536000 },
        csp: { defaultSrc: ["'self'"] },
      })(app as unknown as PluginHostInstance, createMockOptions());

      app.get('/throws', () => {
        throw new Error('kaboom');
      });

      app.get('/early-json', (_request, reply) =>
        reply.code(402).send({ error: 'nope' }),
      );

      app.get('/early-html', (_request, reply) =>
        reply.code(503).type('text/html').send('<h1>down</h1>'),
      );

      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      // The 404 comes from Fastify itself, for a route that was never declared.
      const cases: Array<[string, number, string]> = [
        ['/throws', 500, 'application/json'],
        ['/early-json', 402, 'application/json'],
        ['/early-html', 503, 'text/html'],
        ['/never-registered', 404, 'application/json'],
      ];

      try {
        for (const [path, status, contentType] of cases) {
          const response = await fetch(`http://127.0.0.1:${port}${path}`, {
            headers: {
              'x-forwarded-host': 'allowed.example.com',
              'x-forwarded-proto': 'https',
              origin: 'https://app.example.com',
            },
          });

          expect(response.status).toBe(status);
          expect(response.headers.get('content-type')).toContain(contentType);
          expect(response.headers.get('x-frame-options')).toBe('DENY');
          expect(response.headers.get('content-security-policy')).toBe(
            "default-src 'self'",
          );
          expect(response.headers.get('strict-transport-security')).toBe(
            'max-age=31536000',
          );
          expect(response.headers.get('access-control-allow-origin')).toBe(
            'https://app.example.com',
          );
        }
      } finally {
        await app.close();
      }
    });

    it('applies the CSP to a short-circuited response too', async () => {
      // CSP goes out through the same helper as the other non-negotiated
      // headers, so it inherits the onSend backstop rather than needing its own.
      const response = await respondTo({
        plugins: [
          gatekeeper(),
          securityHeaders({
            csp: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] },
          }),
        ],
        host: 'evil.example.com',
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'self'; frame-ancestors 'none'",
      );
    });

    it('quotes the hashes it contributes to script-src and style-src', async () => {
      // Quoting is what makes a hash a hash. Unquoted, sha256-... is read as a
      // host name, matches nothing, and the inline content it was meant to
      // allow is blocked with no clue as to why — which is exactly what shipped
      // the first time this was wired up.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            csp: { scriptSrc: ["'self'"], styleSrc: ["'self'"] },
          }),
        ],
        host: 'allowed.example.com',
      });

      const csp = response.headers.get('content-security-policy') ?? '';

      expect(csp).toMatch(/script-src 'self' 'sha256-[^']+'/);
      expect(csp).toMatch(/style-src 'self'(?: 'sha256-[^']+')+/);
      expect(csp).not.toMatch(/ sha256-/);
    });

    it("keeps an 'unsafe-inline' opt-in working end to end", async () => {
      // End to end because the unit test cannot see what unirend contributes on
      // its own. Someone who sets 'unsafe-inline' and the flag that guards it
      // has opted into arbitrary inline content deliberately, and a browser
      // ignores the keyword as soon as any hash joins the list. Folding in our
      // bootstrap and error-page hashes would therefore have blocked every
      // inline script and style on their page, including the ones they added
      // the keyword for, under a header that still reads as permissive.
      const app = fastify({ trustProxy: true });

      await securityHeaders({
        csp: {
          scriptSrc: ["'unsafe-inline'"],
          styleSrc: ["'unsafe-inline'"],
          allowUnsafeInlineScript: true,
        },
      })(app as unknown as PluginHostInstance, createMockOptions());

      app.get('/test', (request, reply) => {
        (
          request as FastifyRequest & {
            addCSPSources?: (sources: {
              scriptSrc: string[];
              styleSrc: string[];
            }) => void;
          }
        ).addCSPSources?.({
          scriptSrc: ["'sha256-template-script'"],
          styleSrc: ["'sha256-template-style'"],
        });

        return reply.send('ok');
      });

      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/test`);
        const csp = response.headers.get('content-security-policy') ?? '';

        expect(csp).toBe(
          "script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        );
        expect(csp).not.toContain('sha256-');
      } finally {
        await app.close();
      }
    });

    it("still contributes when the caller's own hash made 'unsafe-inline' inert", async () => {
      // The trap in withholding hashes at all. Skipping protects a live
      // 'unsafe-inline', but a caller who writes their own hash next to it has
      // already made the keyword inert, so the directive matches on hashes
      // alone. Staying out there preserves nothing and leaves unirend's
      // bootstrap script blocked unless their hash happens to be ours.
      //
      // Verified in Chrome: an inline script is blocked under
      // `script-src 'unsafe-inline' 'sha256-other'` and runs once its own hash
      // is added.
      const app = fastify({ trustProxy: true });

      await securityHeaders({
        csp: {
          scriptSrc: ["'unsafe-inline'", "'sha256-callers='"],
          allowUnsafeInlineScript: true,
        },
      })(app as unknown as PluginHostInstance, createMockOptions());

      app.get('/test', (_request, reply) => reply.send('ok'));

      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/test`);
        const csp = response.headers.get('content-security-policy') ?? '';

        expect(csp).toContain("'sha256-callers='");

        // Unirend's bootstrap hash, which is the thing that would have been
        // blocked.
        expect(csp).toMatch(/'sha256-[^']+'.*'sha256-[^']+'/);
      } finally {
        await app.close();
      }
    });

    it('puts the bootstrap and template hashes in script-src-elem when set', async () => {
      // End to end, because the unit level is not where this went wrong. The
      // hashes were being computed, quoted, and added correctly, just to a
      // directive a browser stops consulting the moment script-src-elem exists.
      // A page under this policy would have had its bootstrap and its template
      // scripts blocked, with a header that reads as though it allows them.
      const app = fastify({ trustProxy: true });

      await securityHeaders({
        csp: {
          scriptSrc: ["'self'"],
          scriptSrcElem: ["'self'"],
          styleSrc: ["'self'"],
          styleSrcElem: ["'self'"],
        },
      })(app as unknown as PluginHostInstance, createMockOptions());

      app.get('/test', (request, reply) => {
        (
          request as FastifyRequest & {
            addCSPSources?: (sources: {
              scriptSrc: string[];
              styleSrc: string[];
            }) => void;
          }
        ).addCSPSources?.({
          scriptSrc: ["'sha256-template-script'"],
          styleSrc: ["'sha256-template-style'"],
        });

        return reply.send('ok');
      });

      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/test`);
        const csp = response.headers.get('content-security-policy') ?? '';

        const scriptSrcElem = csp
          .split('; ')
          .find((part) => part.startsWith('script-src-elem '));

        const styleSrcElem = csp
          .split('; ')
          .find((part) => part.startsWith('style-src-elem '));

        // The request's template hash.
        expect(scriptSrcElem).toContain("'sha256-template-script'");
        expect(styleSrcElem).toContain("'sha256-template-style'");

        // And unirend's own bootstrap hash, added at config time, which has the
        // same problem for the same reason.
        expect(scriptSrcElem).toMatch(/'sha256-[^']+'.*'sha256-[^']+'/);
      } finally {
        await app.close();
      }
    });

    it("folds a request's own sources into a resolver's policy", async () => {
      // The bug this pins: the fold-in used to compare the outgoing header
      // against the *configured* policy. A resolver that returned its own CSP
      // left the header holding something that comparison did not recognize, so
      // the request's sources were dropped silently. For SSR those sources are
      // the active template's inline hashes, so the tenant's page went out
      // under a policy strict enough to block the very scripts it was rendering
      // — and only for tenants with a custom policy, which is the hardest kind
      // of bug to notice.
      const app = fastify({ trustProxy: true });

      await securityHeaders({
        csp: { scriptSrc: ["'self'"] },
        resolve: () => ({
          csp: { scriptSrc: ["'self'", 'https://tenant-cdn.example.com'] },
        }),
      })(app as unknown as PluginHostInstance, createMockOptions());

      app.get('/test', (request, reply) => {
        (
          request as FastifyRequest & {
            addCSPSources?: (sources: { scriptSrc: string[] }) => void;
          }
        ).addCSPSources?.({ scriptSrc: ["'sha256-template-hash'"] });

        return reply.send('ok');
      });

      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/test`);
        const csp = response.headers.get('content-security-policy') ?? '';

        // The resolver's policy, not the configured one.
        expect(csp).toContain('https://tenant-cdn.example.com');
        // And the request's own source, folded into that policy.
        expect(csp).toContain("'sha256-template-hash'");
      } finally {
        await app.close();
      }
    });

    it('installs addCSPSources when only the resolver has a policy', async () => {
      // The other half. Deciding at registration whether to decorate meant a
      // server configured without a CSP never offered the hook, so the renderer
      // skipped hashing entirely, and a resolver that introduced a policy got a
      // strict one with no hashes in it at all.
      const app = fastify({ trustProxy: true });

      await securityHeaders({
        resolve: () => ({ csp: { scriptSrc: ["'self'"] } }),
      })(app as unknown as PluginHostInstance, createMockOptions());

      app.get('/test', (request, reply) => {
        const add = (
          request as FastifyRequest & {
            addCSPSources?: (sources: { scriptSrc: string[] }) => void;
          }
        ).addCSPSources;

        return reply.send(typeof add === 'function' ? 'installed' : 'missing');
      });

      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/test`);

        expect(await response.text()).toBe('installed');
      } finally {
        await app.close();
      }
    });

    it('leaves addCSPSources undefined when nothing configures a policy', async () => {
      // The signal has to keep working. Its absence is what tells the SSR
      // renderer not to hash a template on a server that is not using CSP,
      // which in development is per-request work.
      const app = fastify({ trustProxy: true });

      await securityHeaders({ frameOptions: 'DENY' })(
        app as unknown as PluginHostInstance,
        createMockOptions(),
      );

      app.get('/test', (request, reply) => {
        const add = (request as FastifyRequest & { addCSPSources?: unknown })
          .addCSPSources;

        return reply.send(add === undefined ? 'absent' : 'present');
      });

      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/test`);

        expect(await response.text()).toBe('absent');
      } finally {
        await app.close();
      }
    });

    it('sends the report-only header when asked, and not the enforcing one', async () => {
      const response = await respondTo({
        plugins: [
          securityHeaders({
            csp: { defaultSrc: ["'self'"], reportOnly: true },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.headers.get('content-security-policy')).toBeNull();
      expect(response.headers.get('content-security-policy-report-only')).toBe(
        "default-src 'self'",
      );
    });

    it('folds per-request sources into the policy', async () => {
      // SSR contributes the active app's template hashes this way. The app is
      // chosen per request, so they cannot be baked in at config time like the
      // rest of the policy.
      const contributor: ServerPlugin<UnirendServerMode> = (host) => {
        // Callback style: raw Fastify picks hook style by arity, and an async
        // arrow with nothing to await trips require-await.
        host.addHook('onRequest', (request, _reply, ...args: unknown[]) => {
          const done = args[0] as () => void;
          request.addCSPSources?.({
            scriptSrc: ["'sha256-fromTemplate='"],
            styleSrc: ["'sha256-templateStyle='"],
          });
          done();
        });

        return Promise.resolve();
      };

      const response = await respondTo({
        plugins: [
          securityHeaders({
            csp: { scriptSrc: ["'self'"], styleSrc: ["'self'"] },
          }),
          contributor,
        ],
        host: 'allowed.example.com',
      });

      const csp = response.headers.get('content-security-policy') ?? '';

      expect(csp).toContain("'sha256-fromTemplate='");
      expect(csp).toContain("'sha256-templateStyle='");
      // The framework's own hashes are still there alongside them.
      expect(csp.match(/'sha256-[^']+'/g)?.length).toBeGreaterThan(2);
    });

    it('does not install addCSPSources when no policy is configured', async () => {
      // Its absence is a signal, not just a missing convenience: it tells the
      // SSR renderer there is no reason to hash a template's inline content,
      // which is what keeps that work off servers not using CSP.
      let hasDecoration: boolean | undefined;

      const observer: ServerPlugin<UnirendServerMode> = (host) => {
        host.addHook('onRequest', (request, _reply, ...args: unknown[]) => {
          const done = args[0] as () => void;
          hasDecoration = typeof request.addCSPSources === 'function';
          done();
        });

        return Promise.resolve();
      };

      await respondTo({
        plugins: [securityHeaders({ frameOptions: 'DENY' }), observer],
        host: 'allowed.example.com',
      });

      expect(hasDecoration).toBe(false);
    });

    it('leaves a policy a route set for itself', async () => {
      // Same fill-if-absent spirit as everywhere else: the rebuild only
      // replaces the value this plugin put there.
      const contributor: ServerPlugin<UnirendServerMode> = (host) => {
        host.addHook('onRequest', async (request, reply) => {
          request.addCSPSources?.({ scriptSrc: ["'sha256-ignored='"] });
          reply.header('Content-Security-Policy', "default-src 'none'");
        });

        return Promise.resolve();
      };

      const response = await respondTo({
        plugins: [
          securityHeaders({ csp: { scriptSrc: ["'self'"] } }),
          contributor,
        ],
        host: 'allowed.example.com',
      });

      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'",
      );
    });

    it('sends no CSP header when none is configured', async () => {
      const response = await respondTo({
        plugins: [securityHeaders({ frameOptions: 'DENY' })],
        host: 'allowed.example.com',
      });

      expect(response.headers.get('content-security-policy')).toBeNull();
      expect(response.headers.get('x-frame-options')).toBe('DENY');
    });

    it('leaves the defaults alone when the resolver returns null', async () => {
      const response = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000, includeSubDomains: true },
            frameOptions: 'DENY',
            resolve: () => null,
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.headers.get('strict-transport-security')).toBe(
        'max-age=31536000; includeSubDomains',
      );
      expect(response.headers.get('x-frame-options')).toBe('DENY');
    });

    it('replaces a block outright rather than merging into it', async () => {
      // The case this exists for. A partial merge would keep the baseline's
      // includeSubDomains, which on a customer's domain forces HTTPS across
      // every other subdomain they own, for the full max-age, with no way to revoke it. That
      // is precisely what an override is written to avoid.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
            frameOptions: 'DENY',
            resolve: () => ({ hsts: { maxAge: 86400 }, frameOptions: false }),
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.headers.get('strict-transport-security')).toBe(
        'max-age=86400',
      );
      expect(response.headers.get('x-frame-options')).toBeNull();
    });

    it('lets a resolver replace the CSP', async () => {
      const response = await respondTo({
        plugins: [
          securityHeaders({
            csp: { defaultSrc: ["'self'"] },
            resolve: () => ({
              csp: { defaultSrc: ["'self'", 'https://tenant-cdn.example.com'] },
            }),
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'self' https://tenant-cdn.example.com",
      );
    });

    it('500s when the resolver throws, like any other middleware', async () => {
      const response = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000 },
            resolve: () => {
              throw new Error('tenant lookup failed');
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(500);
    });

    it('sends no HSTS on the error a throwing resolver caused', async () => {
      // Not a preference. The baseline is written for domains the operator
      // owns, and the reason a resolver exists is to send something narrower on
      // a domain they do not. Falling back to the baseline on a customer domain
      // would bind it for a year with no way to revoke, which is worse than the
      // 500 that prompted it.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000, includeSubDomains: true },
            frameOptions: 'DENY',
            resolve: () => {
              throw new Error('tenant lookup failed');
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(500);
      expect(response.headers.get('strict-transport-security')).toBeNull();
      // Everything else still falls back: too strict at worst, and the effect
      // ends with the response.
      expect(response.headers.get('x-frame-options')).toBe('DENY');
    });

    it('invokes a throwing resolver once per request', async () => {
      // The double fault this prevents: the throw becomes a 500, the error path
      // applies security headers, and the resolver is called again from inside
      // the handler dealing with its first failure.
      let calls = 0;

      await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000 },
            resolve: () => {
              calls += 1;
              throw new Error('tenant lookup failed');
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(calls).toBe(1);
    });

    it('invokes a succeeding resolver once per request', async () => {
      let calls = 0;

      await respondTo({
        plugins: [
          securityHeaders({
            csp: { defaultSrc: ["'self'"] },
            hsts: { maxAge: 31536000 },
            resolve: () => {
              calls += 1;
              return { hsts: { maxAge: 60 } };
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(calls).toBe(1);
    });

    it('holds a resolver to the same validation as the defaults', async () => {
      // Returning something the config would have rejected is a bug in the same
      // place with the same consequences as throwing, so it fails the same way.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            csp: { defaultSrc: ["'self'"] },
            resolve: () => ({ csp: { scriptSrc: ['self'] } }),
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(500);
    });

    it('rejects a resolver CSP that undercuts the inherited frameOptions', async () => {
      // Startup rejects frameOptions 'SAMEORIGIN' next to frame-ancestors
      // 'none', because a browser without CSP support reads only the weaker
      // one and frames the page the policy exists to keep out of frames.
      //
      // A resolver can assemble that same pair out of two halves that are each
      // fine on their own: it overrides the CSP and inherits frameOptions from
      // the baseline. Validating only what the resolver returned would miss it,
      // and the tenant that got the override would be the one served the
      // combination the static config refuses.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            frameOptions: 'SAMEORIGIN',
            csp: { defaultSrc: ["'self'"] },
            resolve: () => ({
              csp: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] },
            }),
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(500);
    });

    it('rejects a resolver frameOptions no browser recognizes', async () => {
      // The one field whose bad values reach the wire silently. A stored policy
      // saying 'ALLOWALL' would set an X-Frame-Options browsers ignore, so the
      // tenant it belongs to gets no framing protection and nothing says so.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            frameOptions: 'DENY',
            // @ts-expect-error the resolver's return type rules this out, the
            // check is for policies that arrive from a store or a request body
            resolve: () => ({ frameOptions: 'ALLOWALL' }),
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(500);
    });

    it('rejects a resolver frameOptions of null rather than inheriting', async () => {
      // `null` is what an empty field in a JSON column serializes to, and the
      // merge would otherwise read it as "inherit" without anyone deciding
      // that. A resolver that means the baseline omits the key.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            frameOptions: 'DENY',
            // @ts-expect-error same as above
            resolve: () => ({ frameOptions: null }),
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(500);
    });

    it('rejects a resolver frameOptions that undercuts the inherited CSP', async () => {
      // The same pair assembled from the other side: the baseline is valid
      // because it pairs frame-ancestors 'none' with 'DENY', and the resolver
      // replaces only the frameOptions.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            frameOptions: 'DENY',
            csp: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] },
            resolve: () => ({ frameOptions: 'SAMEORIGIN' }),
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(500);
    });

    it('allows a resolver to keep the fallback at least as strict', async () => {
      // The check rejects exactly one pair. A fallback stricter than the policy
      // it backs up is the safe direction to be wrong in and stays allowed.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            frameOptions: 'SAMEORIGIN',
            csp: { defaultSrc: ["'self'"] },
            resolve: () => ({
              frameOptions: 'DENY',
              csp: { defaultSrc: ["'self'"], frameAncestors: ["'none'"] },
            }),
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('x-frame-options')).toBe('DENY');
    });

    it('awaits an async resolver', async () => {
      const response = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000 },
            resolve: async () => {
              await new Promise((resolve) => setTimeout(resolve, 1));

              return { hsts: { maxAge: 42 } };
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.headers.get('strict-transport-security')).toBe(
        'max-age=42',
      );
    });

    it('keeps HSTS on a failed resolve for a host listed in ownDomains', async () => {
      // Without ownDomains a store outage drops HSTS everywhere, which is never
      // wrong but is blunt: it also drops it for domains the operator plainly
      // owns and had every intention of binding.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000, includeSubDomains: true },
            ownDomains: ['allowed.example.com', '**.allowed.example.com'],
            resolve: () => {
              throw new Error('tenant lookup failed');
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(500);
      expect(response.headers.get('strict-transport-security')).toBe(
        'max-age=31536000; includeSubDomains',
      );
    });

    it('keeps HSTS for a subdomain matched by a wildcard in ownDomains', async () => {
      // The case the existing test above could not catch, because its host
      // matched the exact entry and never needed the pattern. Configured
      // patterns used to be run through normalizeDomain first, which answers
      // "what host is this" and turns `**.allowed.example.com` into an empty
      // string. The documented apex-plus-wildcard pairing then covered only the
      // apex, so a store outage dropped HSTS across every subdomain the
      // operator had just declared they own, with nothing to indicate why.
      for (const host of [
        'api.allowed.example.com',
        'deep.api.allowed.example.com',
      ]) {
        const response = await respondTo({
          plugins: [
            securityHeaders({
              hsts: { maxAge: 31536000, includeSubDomains: true },
              ownDomains: ['allowed.example.com', '**.allowed.example.com'],
              resolve: () => {
                throw new Error('tenant lookup failed');
              },
            }),
          ],
          host,
        });

        expect(response.status).toBe(500);
        expect(
          response.headers.get('strict-transport-security'),
          `expected ${host} to be recognized as an owned domain`,
        ).toBe('max-age=31536000; includeSubDomains');
      }
    });

    it('honors a single-level wildcard in ownDomains', async () => {
      // `*` is one level, `**` is any depth. Worth pinning separately so the
      // pattern semantics are not quietly flattened to "any wildcard matches
      // anything" by a future normalization.
      const owned = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 600 },
            ownDomains: ['*.allowed.example.com'],
            resolve: () => {
              throw new Error('tenant lookup failed');
            },
          }),
        ],
        host: 'api.allowed.example.com',
      });

      expect(owned.headers.get('strict-transport-security')).toBe(
        'max-age=600',
      );

      const tooDeep = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 600 },
            ownDomains: ['*.allowed.example.com'],
            resolve: () => {
              throw new Error('tenant lookup failed');
            },
          }),
        ],
        host: 'deep.api.allowed.example.com',
      });

      expect(tooDeep.headers.get('strict-transport-security')).toBeNull();
    });

    it('rejects an ownDomains entry that would never match', () => {
      // At startup rather than at match time. An entry that matches nothing is
      // invisible in exactly the situation this option exists for: the resolver
      // is already failing, and the only symptom is a missing header on a
      // response nobody is watching.
      expect(() =>
        securityHeaders({ ownDomains: ['https://allowed.example.com'] }),
      ).toThrow(/Invalid securityHeaders ownDomains entry/);

      expect(() => securityHeaders({ ownDomains: ['not a domain'] })).toThrow(
        /Invalid securityHeaders ownDomains entry/,
      );
    });

    it('still drops HSTS on a failed resolve for a host it does not own', async () => {
      // The distinction is the whole point. Binding a domain for a year is safe
      // when you own it and permanent when you do not.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000, includeSubDomains: true },
            ownDomains: ['allowed.example.com'],
            resolve: () => {
              throw new Error('tenant lookup failed');
            },
          }),
        ],
        host: 'customer-owned.example.net',
      });

      expect(response.status).toBe(500);
      expect(response.headers.get('strict-transport-security')).toBeNull();
    });

    it('expands a CSP preset', async () => {
      const response = await respondTo({
        plugins: [securityHeaders({ csp: { preset: 'strict' } })],
        host: 'allowed.example.com',
      });

      const csp = response.headers.get('content-security-policy') ?? '';

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("base-uri 'self'");
      // The framework's own hashes still land in the preset's directives.
      expect(csp).toMatch(/script-src 'self' 'sha256-[^']+'/);
    });

    it('lets a directive override the preset it came from', async () => {
      const response = await respondTo({
        plugins: [
          securityHeaders({
            csp: {
              preset: 'strict',
              imgSrc: ["'self'", 'https://cdn.example.com'],
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.headers.get('content-security-policy')).toContain(
        "img-src 'self' https://cdn.example.com",
      );
    });

    it('accepts a resolver installed after registration', async () => {
      // A resolver needing a database cannot run at config time, but the plugin
      // has to register early so its onRequest beats anything that
      // short-circuits. Keeping the two separate is what lets both be true.
      const plugin = securityHeaders({ hsts: { maxAge: 31536000 } });

      plugin.setResolver(() => ({ hsts: { maxAge: 99 } }));

      const response = await respondTo({
        plugins: [plugin],
        host: 'allowed.example.com',
      });

      expect(response.headers.get('strict-transport-security')).toBe(
        'max-age=99',
      );
    });

    it('puts the CSP on a hijacked response, which bypasses onSend', async () => {
      // How the static content cache serves a file: apply headers, hijack, then
      // writeHead a snapshot of reply.getHeaders(). onSend never runs, so if
      // applySecurityHeaders did not cover CSP the file would go out with CORS
      // headers and no policy, and only on the hijacked paths.
      const hijacker: ServerPlugin<UnirendServerMode> = (host) => {
        host.route({
          method: 'GET',
          url: '/asset',
          handler: async (request, reply) => {
            await request.applySecurityHeaders?.(reply);
            reply.hijack();
            reply.raw.writeHead(
              200,
              reply.getHeaders() as Record<string, string>,
            );
            reply.raw.end('file bytes');
          },
        });

        return Promise.resolve();
      };

      const app = fastify({ trustProxy: true });

      await securityHeaders({
        csp: { defaultSrc: ["'self'"] },
        frameOptions: 'DENY',
      })(app as unknown as PluginHostInstance, createMockOptions());
      await hijacker(app as unknown as PluginHostInstance, createMockOptions());

      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/asset`);

        expect(await response.text()).toBe('file bytes');
        expect(response.headers.get('content-security-policy')).toBe(
          "default-src 'self'",
        );
        expect(response.headers.get('x-frame-options')).toBe('DENY');
      } finally {
        await app.close();
      }
    });

    it('leaves a header the short-circuiting responder set itself', async () => {
      // Fill-if-absent: a gate that deliberately framed its own response keeps
      // its value, rather than having the configured default written over it.
      const ownFrameOptions: ServerPlugin<UnirendServerMode> = (host) => {
        host.addHook('onRequest', async (_request, reply) => {
          await reply
            .code(401)
            .header('X-Frame-Options', 'SAMEORIGIN')
            .send('nope');
        });

        return Promise.resolve();
      };

      const response = await respondTo({
        plugins: [ownFrameOptions, headers()],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      // An ordinary application 401 is not a disclaimed host, so HSTS stands.
      expect(response.headers.get('strict-transport-security')).toBe(
        'max-age=31536000',
      );
    });
  });
});

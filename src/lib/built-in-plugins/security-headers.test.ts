import { describe, it, expect, mock } from 'bun:test';
import fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { securityHeaders } from './security-headers';
import type {
  CORSConfig,
  CSPConfig,
  HSTSConfig,
  SecurityHeadersBaseline,
} from './security-headers';
import type { SecurityHeadersPolicyInput } from '../internal/security-headers-validation';
import { domainValidation } from './domain-validation';
import type {
  PluginOptions,
  PluginHostInstance,
  ServerPlugin,
  UnirendServerMode,
} from '../types';
import type { InlineAttributeFinding } from '../internal/html-utils/format';
import { hashInlineContentForCSP } from '../internal/csp-hash';
import { UNIREND_BOOTSTRAP_SCRIPT_HASH } from '../internal/html-utils/context-data-block';
import { UNIREND_ERROR_PAGE_STYLE_HASHES } from '../internal/error-page-utils';

/**
 * The sources unirend contributes for its own inline content, in the order they
 * are serialized: the bootstrap script first, then the error-page styles.
 *
 * Built from the same constants the plugin reads rather than pasted in as
 * literals, so editing the bootstrap or an error page's styles does not turn
 * every CSP assertion in this file red for no reason.
 *
 * These appear in whichever directive actually governs the content. A policy
 * that sets `scriptSrc` and `styleSrc` gets them split between the two; a
 * policy that sets only `defaultSrc` gets both there, because that is the
 * directive a browser consults when nothing more specific is set.
 */
const OWN_INLINE_SOURCES = [
  `'${UNIREND_BOOTSTRAP_SCRIPT_HASH}'`,
  ...UNIREND_ERROR_PAGE_STYLE_HASHES.map((hash) => `'${hash}'`),
].join(' ');

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

    it("keeps origin '*' and gives credentials only to the allowlist", async () => {
      // The shape the two separate lists exist for: an API anyone may read,
      // with cookies for first-party domains only. This used to replace the
      // origin with the credentials list, which quietly turned it into an API
      // nobody else may read, on a config whose plain reading says otherwise.
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

      // 1) No Origin at all still gets the literal wildcard. That response
      //    never carries credentials, which is what keeps '*' and
      //    Access-Control-Allow-Credentials from ever going out together.
      const noOriginPreflight = createMockRequest({
        method: 'OPTIONS',
        headers: {
          'access-control-request-method': 'POST',
        },
      });
      const noOriginReply = createMockReply();
      await onRequestHook?.handler(noOriginPreflight, noOriginReply);
      expect(noOriginReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        '*',
      );
      expect(noOriginReply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );

      // 2) An allowlisted origin gets the echoed origin and credentials.
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

      // 3) Anyone else may still read it, without credentials. This is the half
      //    the rewrite used to remove.
      const otherRequest = createMockRequest({
        headers: { origin: 'https://third-party.example' },
      });
      const otherReply = createMockReply();
      await onRequestHook?.handler(otherRequest, otherReply);
      expect(otherReply.header).toHaveBeenCalledWith(
        'Access-Control-Allow-Origin',
        'https://third-party.example',
      );
      expect(otherReply.header).not.toHaveBeenCalledWith(
        'Access-Control-Allow-Credentials',
        'true',
      );
    });

    it("refuses unbounded credentials with origin '*', in either spelling", () => {
      // The pairing the CORS specification forbids, and the one this whole
      // area is arranged to prevent: an unbounded set of credentialed origins
      // beside a wildcard. `credentials: true` answers yes for everyone, and a
      // credentials function answers for everyone it is asked about.
      //
      // Both spellings, because they did not always agree. Every rule here
      // tests the string `'*'`, and the array form used to be collapsed to it
      // only *after* they had all run, so `origin: ['*']` walked past the lot
      // and shipped Access-Control-Allow-Origin echoing the caller together
      // with Access-Control-Allow-Credentials: true. Any site could read an
      // authenticated response with the user's cookies attached.
      for (const origin of ['*', ['*']] as CORSConfig['origin'][]) {
        const label = JSON.stringify(origin);

        expect(
          () => corsHeaders({ origin, credentials: true }),
          `credentials: true with origin ${label}`,
        ).toThrow(/Cannot use credentials: true with origin/);

        expect(
          () => corsHeaders({ origin, credentials: () => true }),
          `credentials function with origin ${label}`,
        ).toThrow(/cannot combine origin '\*' with dynamic credentials/);
      }
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
    it('accepts an empty credentials array alongside origin: *', () => {
      // An empty allowlist says "nobody gets credentials", which is what
      // `credentials: false` says and is exactly what a wildcard origin should
      // be paired with. It used to throw, because the origin was about to be
      // replaced by this list and an empty one left nothing to replace it with.
      // With the two lists kept separate there is nothing to object to, and a
      // concrete origin list beside an empty credentials list has always been
      // accepted, so this is the spelling agreeing with that one.
      expect(() => corsHeaders({ origin: '*', credentials: [] })).not.toThrow();
      expect(() =>
        corsHeaders({ origin: ['*'], credentials: [] }),
      ).not.toThrow();
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
      /**
       * Receives whatever reached the error handler, for the cases where the
       * status alone does not say which rule fired. A 500 is a 500 whether the
       * resolver threw, returned the wrong shape, or named a key that does not
       * exist, so a test about the message has to read the message.
       */
      onError?: (error: Error) => void;
    }

    async function respondTo({
      plugins,
      host,
      origin,
      protocol = 'https',
      onError,
    }: OrderedPluginsCase) {
      const app = fastify({ trustProxy: true });

      if (onError) {
        app.setErrorHandler((error: unknown, _request, reply) => {
          onError(error instanceof Error ? error : new Error(String(error)));

          return reply.code(500).send({ error: 'error' });
        });
      }

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

    it('suppresses HSTS when a hook above the gate throws first', async () => {
      // The gate never runs here, so domainValidationRejected is never set, and
      // a check that only asked about rejection would send HSTS for a host
      // nothing has vouched for, pinning it to HTTPS for the full max-age with
      // no way to revoke. That is the same outcome the rejection check exists to
      // prevent, reached through a plugin that failed rather than a domain that
      // was refused.
      //
      // What closes it is reading the verdict differently once a response is
      // being sent: by then every onRequest hook that was going to run has run,
      // so domainValidation being registered and never reached is itself the
      // answer.
      // Ordering is still the real fix, and the 500 still happens, but the
      // header no longer outlives it.
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
        expect(response.headers.get('strict-transport-security')).toBeNull();
      } finally {
        await app.close();
      }
    });

    it('still sends HSTS when no gate is registered at all', async () => {
      // The other half of the rule above, and the one that keeps it from being
      // a blunt instrument. isHostUnverified answers false when
      // domainValidation is not registered, so a server that simply does not
      // validate hosts is unaffected: an unset verdict there means the question
      // is not being asked, not that it was asked and went unanswered.
      const app = fastify({ trustProxy: true });

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
            'x-forwarded-host': 'app.example.com',
            'x-forwarded-proto': 'https',
          },
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('strict-transport-security')).toBe(
          'max-age=31536000',
        );
      } finally {
        await app.close();
      }
    });

    it('keeps HSTS on a preflight it answers before a gate below it', async () => {
      // A regression, and a sharp one, because it looked like a security fix.
      //
      // The rule "once a response is being sent, every onRequest hook has run"
      // is false here: this plugin answers a CORS preflight from inside its own
      // onRequest, so a domainValidation registered *below* it legitimately
      // never runs. Reading that unset verdict as "unverified" stripped HSTS
      // from every preflight, on a valid host, in a plugin order the docs
      // explicitly allow. `staticContent` serves files from an onRequest hook
      // too, so it lost HSTS on every asset the same way.
      //
      // Hence the verdict is only read as "unverified" when the gate is
      // registered above this plugin, where anything we can answer has already
      // been through it.
      const app = fastify({ trustProxy: true });

      await securityHeaders({
        hsts: { maxAge: 31536000 },
        cors: { origin: ['https://app.example.com'] },
      })(app as unknown as PluginHostInstance, createMockOptions());

      // Registered *after*, which is the whole point of the case.
      await gatekeeper()(
        app as unknown as PluginHostInstance,
        createMockOptions(),
      );

      app.get('/test', () => ({ ok: true }));
      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/test`, {
          method: 'OPTIONS',
          headers: {
            'x-forwarded-host': 'allowed.example.com',
            'x-forwarded-proto': 'https',
            origin: 'https://app.example.com',
            'access-control-request-method': 'GET',
          },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('strict-transport-security')).toBe(
          'max-age=31536000',
        );
      } finally {
        await app.close();
      }
    });

    it('still drops HSTS for a rejected host whichever order the gate is in', async () => {
      // The ordering rule above governs how an *unset* verdict is read. An
      // explicit rejection is not ambiguous in either order, so the original
      // protection must not have been narrowed by making the unset case
      // conditional.
      for (const isGateFirst of [true, false]) {
        const app = fastify({ trustProxy: true });
        const plugins = isGateFirst
          ? [gatekeeper(), securityHeaders({ hsts: { maxAge: 31536000 } })]
          : [securityHeaders({ hsts: { maxAge: 31536000 } }), gatekeeper()];

        for (const plugin of plugins) {
          await plugin(
            app as unknown as PluginHostInstance,
            createMockOptions(),
          );
        }

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
            `default-src 'self' ${OWN_INLINE_SOURCES}`,
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

    it('starts with a report-only policy alongside an existing SAMEORIGIN', async () => {
      // The documented rollout. A report-only policy enforces nothing, so it
      // cannot supersede X-Frame-Options and the pair is not the one the
      // framing cross-check rejects. Refusing to start here would have made the
      // recommended way to adopt frame-ancestors impossible for anyone who
      // already sends the header.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            frameOptions: 'SAMEORIGIN',
            csp: {
              defaultSrc: ["'self'"],
              frameAncestors: ["'none'"],
              reportOnly: true,
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN');
      expect(
        response.headers.get('content-security-policy-report-only'),
      ).toContain("frame-ancestors 'none'");
      // And the enforcing header is genuinely absent, which is what makes the
      // pairing safe rather than merely tolerated.
      expect(response.headers.get('content-security-policy')).toBeNull();
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
        `default-src 'self' ${OWN_INLINE_SOURCES}; frame-ancestors 'none'`,
      );
    });

    describe('a policy that sets only default-src', () => {
      // The shape the documentation recommends starting from, and the one where
      // withholding the hashes was worst. default-src is what a browser
      // consults for an inline <script> when no script directive is set, so
      // hashes kept out of it are in no directive anything reads: unirend's own
      // bootstrap was blocked, taking every injected global and the router
      // hydration payload with it, under a header that reads as though it
      // allows same-origin content.

      it("covers unirend's own bootstrap script and error-page styles", async () => {
        const response = await respondTo({
          plugins: [securityHeaders({ csp: { defaultSrc: ["'self'"] } })],
          host: 'allowed.example.com',
        });

        const csp = response.headers.get('content-security-policy') ?? '';

        expect(csp).toContain(`'${UNIREND_BOOTSTRAP_SCRIPT_HASH}'`);

        for (const hash of UNIREND_ERROR_PAGE_STYLE_HASHES) {
          expect(csp).toContain(`'${hash}'`);
        }
      });

      it('creates no script-src or style-src of its own', async () => {
        // The other half of the rule, unchanged. Emitting a script-src because
        // a hash exists would create a directive that overrides default-src and
        // blocks everything the author expected default-src to allow.
        const response = await respondTo({
          plugins: [securityHeaders({ csp: { defaultSrc: ["'self'"] } })],
          host: 'allowed.example.com',
        });

        const csp = response.headers.get('content-security-policy') ?? '';

        expect(csp).not.toContain('script-src');
        expect(csp).not.toContain('style-src');
      });

      it('leaves default-src alone once script-src governs scripts', async () => {
        // The chains fall through independently, so the script hashes move to
        // script-src while the style hashes stay where styles are governed.
        const response = await respondTo({
          plugins: [
            securityHeaders({
              csp: { defaultSrc: ["'self'"], scriptSrc: ["'self'"] },
            }),
          ],
          host: 'allowed.example.com',
        });

        const csp = response.headers.get('content-security-policy') ?? '';
        const [defaultSrc, scriptSrc] = csp.split('; ');

        expect(scriptSrc).toContain(`'${UNIREND_BOOTSTRAP_SCRIPT_HASH}'`);
        expect(defaultSrc).not.toContain(`'${UNIREND_BOOTSTRAP_SCRIPT_HASH}'`);
        expect(defaultSrc).toContain(`'${UNIREND_ERROR_PAGE_STYLE_HASHES[0]}'`);
      });
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
        `default-src 'self' ${OWN_INLINE_SOURCES}`,
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

    // `null` is the documented no-override value and the only one. A store miss
    // handing back undefined or '', or a resolver that fell off the end, has not
    // said the defaults are fine, and reading it that way sent the baseline
    // HSTS: a long max-age with includeSubDomains, quite possibly onto a
    // customer's mapped domain, binding it for a year with no way to revoke.
    // That is the one outcome a resolver exists to prevent, reached through a
    // value nobody meant to return.
    const unanswered: Array<[label: string, value: unknown]> = [
      ['undefined', undefined],
      ['an empty string', ''],
      ['false', false],
      ['an array', []],
    ];

    for (const [label, value] of unanswered) {
      it(`fails the request when the resolver returns ${label}`, async () => {
        const response = await respondTo({
          plugins: [
            securityHeaders({
              hsts: { maxAge: 31536000, includeSubDomains: true },
              frameOptions: 'DENY',
              // Cast because the signature already forbids these. The callers
              // who reach here are the ones the type never covered: a JS
              // resolver, or a TS one whose store is typed loosely enough to
              // hand back a miss.
              resolve: (() => value) as unknown as () => null,
            }),
          ],
          host: 'allowed.example.com',
        });

        expect(response.status).toBe(500);
        // Same safe degradation a throwing resolver gets: the fallback stored
        // before the await has already dropped HSTS, so nothing is bound.
        expect(response.headers.get('strict-transport-security')).toBeNull();
        expect(response.headers.get('x-frame-options')).toBe('DENY');
      });
    }

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
        `default-src 'self' https://tenant-cdn.example.com ${OWN_INLINE_SOURCES}`,
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

    it('rejects a resolver that returns a misspelled policy key', async () => {
      // The one mistake that would otherwise produce a *valid* policy. Dropping
      // the unknown key leaves the block absent, and an absent block inherits
      // the baseline, which is exactly what a correct resolver does — so this
      // tenant would silently be sent the baseline's 'DENY' on a resolver whose
      // author believes they turned framing off for them.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            frameOptions: 'DENY',
            // @ts-expect-error the return type rules this out; the check is for
            // policies that arrive from a store or a request body
            resolve: () => ({ frameOption: false }),
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(500);
    });

    it('names every unrecognized key rather than only the first', async () => {
      // A stored policy written against the wrong field names gets them all
      // wrong at once, and being told about one per deploy is a poor way to
      // find that out.
      const errors: string[] = [];

      const response = await respondTo({
        plugins: [
          securityHeaders({
            // @ts-expect-error same as above
            resolve: () => ({ hst: { maxAge: 1 }, frameOption: false }),
          }),
        ],
        host: 'allowed.example.com',
        onError: (error) => errors.push(error.message),
      });

      expect(response.status).toBe(500);
      expect(errors[0]).toContain('"hst"');
      expect(errors[0]).toContain('"frameOption"');
    });

    it('accepts a resolver returning only the keys it means to override', async () => {
      // The other side of the rule: an override that omits a block is the
      // documented way to inherit it, so the key check must not turn a correct
      // partial policy into a failure.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            frameOptions: 'DENY',
            hsts: { maxAge: 31536000, includeSubDomains: true },
            resolve: () => ({ hsts: { maxAge: 86400 } }),
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('x-frame-options')).toBe('DENY');
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

    it('sends no CORS headers when no origin is configured', async () => {
      // The default that matters most, because it is the one nobody chooses.
      // Registering this plugin for `csp` or `hsts` used to echo
      // Access-Control-Allow-Origin back to whatever origin asked, so every
      // response it touched became cross-origin readable, including responses
      // behind a bearer token: a manually attached Authorization header needs no
      // credentials mode, and Authorization is in the default allowedHeaders.
      const off: Array<false | CORSConfig | undefined> = [
        undefined,
        {},
        false,
        { origin: undefined },
      ];

      for (const cors of off) {
        const response = await respondTo({
          plugins: [securityHeaders({ frameOptions: 'DENY', cors })],
          host: 'allowed.example.com',
          origin: 'https://evil.example',
        });

        const label = `cors: ${JSON.stringify(cors)}`;

        expect(
          response.headers.get('access-control-allow-origin'),
          label,
        ).toBeNull();
        // Nothing varies by Origin when nothing reads it, so the header would
        // only split CDN cache entries for a feature that is switched off.
        expect(response.headers.get('vary') ?? '', label).not.toContain(
          'Origin',
        );
        // The rest of the plugin is unaffected.
        expect(response.headers.get('x-frame-options'), label).toBe('DENY');
      }
    });

    it('omits Vary on a hijacked response when CORS is off', async () => {
      // The hijacked path goes through applySecurityHeaders rather than onSend,
      // so it takes its own route to the same header-writing function. Worth
      // pinning separately: a static file server answers this way for most of
      // its traffic, which is exactly where a needless Vary costs the most.
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

      await securityHeaders({ frameOptions: 'DENY' })(
        app as unknown as PluginHostInstance,
        createMockOptions(),
      );
      await hijacker(app as unknown as PluginHostInstance, createMockOptions());
      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/asset`, {
          headers: { origin: 'https://evil.example' },
        });

        expect(await response.text()).toBe('file bytes');
        expect(response.headers.get('vary') ?? '').not.toContain('Origin');
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
        expect(response.headers.get('x-frame-options')).toBe('DENY');
      } finally {
        await app.close();
      }
    });

    it('leaves OPTIONS to the application when CORS is off', async () => {
      // "Off" means the plugin does not handle preflight requests either, so an
      // application's own OPTIONS route runs exactly as it would without this
      // plugin registered. Answering with a 403, or with a bare 204 carrying no
      // Access-Control-Allow-Origin, would both shadow that route and imply a
      // negotiation that is not happening.
      const app = fastify({ trustProxy: true });

      await securityHeaders({ frameOptions: 'DENY' })(
        app as unknown as PluginHostInstance,
        createMockOptions(),
      );

      app.options('/test', (_request, reply) => reply.send('app-options'));
      await app.listen({ port: 0, host: '127.0.0.1' });

      const address = app.server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      try {
        const response = await fetch(`http://127.0.0.1:${port}/test`, {
          method: 'OPTIONS',
          headers: {
            origin: 'https://evil.example',
            'access-control-request-method': 'GET',
          },
        });

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('app-options');
        expect(response.headers.get('access-control-allow-origin')).toBeNull();
      } finally {
        await app.close();
      }
    });

    it('still negotiates CORS once an origin is configured', async () => {
      // The other half: turning the default off must not have turned the
      // feature off. A wildcard is written rather than inherited.
      const allowed = await respondTo({
        plugins: [
          securityHeaders({ cors: { origin: ['https://app.example.com'] } }),
        ],
        host: 'allowed.example.com',
        origin: 'https://app.example.com',
      });

      expect(allowed.headers.get('access-control-allow-origin')).toBe(
        'https://app.example.com',
      );
      expect(allowed.headers.get('vary')).toContain('Origin');

      const denied = await respondTo({
        plugins: [
          securityHeaders({ cors: { origin: ['https://app.example.com'] } }),
        ],
        host: 'allowed.example.com',
        origin: 'https://evil.example',
      });

      expect(denied.headers.get('access-control-allow-origin')).toBeNull();

      for (const wildcard of ['*', ['*']]) {
        const wide = await respondTo({
          plugins: [securityHeaders({ cors: { origin: wildcard } })],
          host: 'allowed.example.com',
          origin: 'https://evil.example',
        });

        expect(
          wide.headers.get('access-control-allow-origin'),
          `origin: ${JSON.stringify(wildcard)}`,
        ).toBe('https://evil.example');
      }
    });

    it('rejects any CORS field configured without an origin', () => {
      // One rule rather than a list of exceptions. With no origin the block
      // negotiates nothing, so every field in it describes a negotiation that
      // never happens, and singling out the security-relevant one left the rest
      // silently inert beside it.
      const inert: CORSConfig[] = [
        { methods: ['GET'] },
        { maxAge: 600 },
        { allowedHeaders: ['X-Thing'] },
        { exposedHeaders: ['X-Thing'] },
        { allowPrivateNetwork: true },
        { preflightContinue: true },
      ];

      for (const cors of inert) {
        expect(() => securityHeaders({ cors }), JSON.stringify(cors)).toThrow(
          /is set but cors\.origin is not/,
        );
      }

      // Named together rather than one per run, so a block with two inert
      // fields is one problem rather than two.
      expect(() =>
        securityHeaders({ cors: { methods: ['GET'], maxAge: 600 } }),
      ).toThrow(/cors\.methods, cors\.maxAge are set but cors\.origin is not/);

      // A field written at its own default says nothing the default did not,
      // so it is not a claim this can contradict. Refusing it would be refusing
      // a config for being explicit.
      expect(() =>
        securityHeaders({ cors: { credentials: false } }),
      ).not.toThrow();
      expect(() =>
        securityHeaders({ cors: { preflightContinue: false } }),
      ).not.toThrow();

      // And nothing at all is just "off".
      expect(() => securityHeaders({ cors: {} })).not.toThrow();
      expect(() => securityHeaders({ cors: false })).not.toThrow();
      expect(() =>
        securityHeaders({ cors: { origin: undefined } }),
      ).not.toThrow();
    });

    it('rejects an origin list that allows nothing', () => {
      // What `origin: allowedOrigins` looks like when the environment variable
      // behind it came back empty: CORS switched on and refusing everyone,
      // which is what off already does without the Vary and the preflight
      // handling.
      expect(() => securityHeaders({ cors: { origin: [] } })).toThrow(
        /origin is an empty list/,
      );
    });

    it('rejects credentials configured without an origin', () => {
      // A block that reads as "these origins may send cookies" and allows
      // nothing, since with CORS off no browser ever attaches credentials.
      expect(() =>
        securityHeaders({ cors: { credentials: ['https://app.example.com'] } }),
      ).toThrow(/cors\.credentials is set but cors\.origin is not/);

      expect(() => securityHeaders({ cors: { credentials: true } })).toThrow(
        /cors\.credentials is set but cors\.origin is not/,
      );

      // Saying it explicitly is fine, and so is the ordinary configured case.
      expect(() =>
        securityHeaders({ cors: { credentials: false } }),
      ).not.toThrow();
      expect(() =>
        securityHeaders({
          cors: {
            origin: ['https://app.example.com'],
            credentials: ['https://app.example.com'],
          },
        }),
      ).not.toThrow();
    });

    it('serves requests when a CORS field is written as undefined', async () => {
      // Validation passed and startup succeeded, then every cross-origin
      // request 500d, because the undefined key was spread over the defaults
      // and deleted the array the request path then dereferenced. Asserted at
      // request time rather than on the normalized config, since that is where
      // it failed and the config-level test alone would not have caught it.
      const optional: string[] | undefined = undefined;

      const response = await respondTo({
        plugins: [
          securityHeaders({
            cors: {
              origin: ['https://app.example.com'],
              exposedHeaders: optional,
              methods: optional,
              allowedHeaders: optional,
            },
          }),
        ],
        host: 'allowed.example.com',
        origin: 'https://app.example.com',
      });

      expect(response.status).toBe(200);
      expect(response.headers.get('access-control-allow-origin')).toBe(
        'https://app.example.com',
      );
    });

    it('hands the resolver the configured policy as a baseline', async () => {
      // The second argument is what an omitted block inherits, so a resolver
      // wanting "the defaults with one field different" can say so rather than
      // retyping the block or closing over the config itself.
      let seen: SecurityHeadersBaseline | undefined;

      await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
            frameOptions: 'DENY',
            contentTypeOptions: true,
            referrerPolicy: 'no-referrer',
            csp: { defaultSrc: ["'self'"] },
            resolve: (_request, baseline) => {
              seen = baseline;

              return null;
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      // toStrictEqual rather than toEqual, which treats a key holding undefined
      // as absent and would make the unset half of this assert nothing.
      expect(seen).toStrictEqual({
        csp: { defaultSrc: ["'self'"] },
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
        frameOptions: 'DENY',
        contentTypeOptions: true,
        referrerPolicy: 'no-referrer',
        permissionsPolicy: undefined,
        crossOriginOpenerPolicy: undefined,
        crossOriginOpenerPolicyReportOnly: undefined,
        crossOriginResourcePolicy: undefined,
        crossOriginEmbedderPolicy: undefined,
        crossOriginEmbedderPolicyReportOnly: undefined,
        reportingEndpoints: undefined,
      });
    });

    it('lets a resolver build an override out of the baseline', async () => {
      // The case the baseline exists for. Spreading is the caller's to write,
      // so what was kept is visible here rather than inferred from what was
      // left out, which is the whole reason blocks replace rather than merge.
      const response = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
            resolve: (_request, baseline) => ({
              hsts: { ...baseline.hsts, maxAge: 86400, preload: false },
            }),
          }),
        ],
        host: 'customer-owned.example.net',
      });

      // includeSubDomains carried over because it was spread in, max-age and
      // preload replaced because they were written after it.
      expect(response.headers.get('strict-transport-security')).toBe(
        'max-age=86400; includeSubDomains',
      );
    });

    it('gives the baseline a CSP preset unexpanded, so it still composes', async () => {
      // Unexpanded is what makes `{ ...baseline.csp, scriptSrc }` work: the
      // preset rides along and is applied again on the way back with the
      // resolver's directives winning. Handing over the expanded form would
      // bake the preset's directives into whatever the resolver returns, where
      // they would stop tracking the preset they came from.
      let seenCSP: unknown;

      const response = await respondTo({
        plugins: [
          securityHeaders({
            csp: { preset: 'strict' },
            resolve: (_request, baseline) => {
              seenCSP = baseline.csp;

              return {
                csp: {
                  ...(baseline.csp as CSPConfig),
                  scriptSrc: ["'self'", 'https://cdn.example.com'],
                },
              };
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(seenCSP).toEqual({ preset: 'strict' });

      const csp = response.headers.get('content-security-policy') ?? '';

      // The resolver's directive won, and the preset still supplied the rest.
      expect(csp).toContain("script-src 'self' https://cdn.example.com");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    it('freezes the baseline all the way down', async () => {
      // A resolver is handed this on every request, so an in-place edit would
      // leak into every later one. The type stops the top-level case where the
      // author is looking; the freeze covers the nested arrays a shallow
      // readonly cannot reach, and covers JavaScript callers besides.
      const thrown: string[] = [];

      const attempt = (label: string, mutate: () => void) => {
        try {
          mutate();
          thrown.push(`${label}: no throw`);
        } catch {
          thrown.push(`${label}: threw`);
        }
      };

      const response = await respondTo({
        plugins: [
          securityHeaders({
            hsts: { maxAge: 31536000, includeSubDomains: true },
            csp: { defaultSrc: ["'self'"], scriptSrc: ["'self'"] },
            resolve: (_request, baseline) => {
              const writable = baseline as SecurityHeadersPolicyInput;

              attempt('block', () => {
                writable.frameOptions = 'SAMEORIGIN';
              });

              attempt('nested field', () => {
                (writable.hsts as HSTSConfig).maxAge = 1;
              });

              attempt('nested array', () => {
                (writable.csp as CSPConfig).scriptSrc?.push("'unsafe-inline'");
              });

              return null;
            },
          }),
        ],
        host: 'allowed.example.com',
      });

      expect(thrown).toEqual([
        'block: threw',
        'nested field: threw',
        'nested array: threw',
      ]);

      // And the policy actually served is the configured one, unharmed.
      expect(response.headers.get('strict-transport-security')).toBe(
        'max-age=31536000; includeSubDomains',
      );
      expect(response.headers.get('content-security-policy')).toContain(
        "script-src 'self' '",
      );
      expect(response.headers.get('content-security-policy')).not.toContain(
        "'unsafe-inline'",
      );
    });

    it('detaches the baseline from the config object it came from', async () => {
      // Frozen as a copy rather than in place. Freezing the caller's own object
      // would reach back out of the plugin and change something they still
      // hold, so a config the application mutates elsewhere would start
      // throwing somewhere with no visible connection to securityHeaders.
      const config = {
        hsts: { maxAge: 31536000, includeSubDomains: true },
        resolve: (
          _request: FastifyRequest,
          baseline: SecurityHeadersBaseline,
        ) => {
          seen = baseline.hsts;

          return null;
        },
      };

      let seen: unknown;

      const plugin = securityHeaders(config);

      // Still writable, because the plugin took a copy.
      expect(Object.isFrozen(config.hsts)).toBe(false);
      config.hsts.maxAge = 1;

      await respondTo({ plugins: [plugin], host: 'allowed.example.com' });

      expect(seen).toEqual({ maxAge: 31536000, includeSubDomains: true });
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
          `default-src 'self' ${OWN_INLINE_SOURCES}`,
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

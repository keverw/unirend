import { describe, it, expect, mock } from 'bun:test';
import {
  domainValidation,
  type DomainValidationConfig,
} from './domain-validation';
import type { PluginOptions, PluginHostInstance } from '../types';

// Mock Fastify request/reply objects
interface MockRequestOverrides {
  url?: string;
  headers?: Record<string, string>;
  protocol?: string;
}

const createMockRequest = (overrides: MockRequestOverrides = {}): unknown => ({
  url: '/test',
  headers: {
    host: 'example.com',
    ...overrides.headers,
  },
  protocol: 'https',
  ...overrides,
});

const createMockReply = () => {
  const reply = {
    code: mock(() => reply),
    type: mock(() => reply),
    send: mock(() => reply),
    redirect: mock(() => reply),
    header: mock(() => reply),
  };
  return reply;
};

const createMockPluginHost = () => {
  const hooks: Array<{
    event: string;
    handler: (req: any, reply: any) => Promise<void>;
  }> = [];

  const mockHost = {
    addHook: mock(
      (event: string, handler: (req: any, reply: any) => Promise<void>) => {
        hooks.push({ event, handler });
      },
    ),
    getHooks: () => hooks,
  };

  // Cast to PluginHostInstance through unknown to satisfy TypeScript
  return mockHost as unknown as PluginHostInstance & {
    getHooks: () => typeof hooks;
  };
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

describe('domainValidation', () => {
  describe('basic functionality', () => {
    it('should register onRequest hook', async () => {
      const config: DomainValidationConfig = {};
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      expect(pluginHost.addHook).toHaveBeenCalledWith(
        'onRequest',
        expect.any(Function),
      );
    });

    it('should skip validation in development mode by default', async () => {
      const config: DomainValidationConfig = {};
      const pluginHost = createMockPluginHost();
      const options = createMockOptions({ isDevelopment: true });
      const request = createMockRequest();
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).not.toHaveBeenCalled();
      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should skip validation for localhost', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'localhost:3000' },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).not.toHaveBeenCalled();
      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should skip validation for 127.0.0.1', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: '127.0.0.1:3000' },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).not.toHaveBeenCalled();
      expect(reply.code).not.toHaveBeenCalled();
    });
  });

  describe('IPv6 and forwarded host handling', () => {
    it('should skip validation for ::1 IPv6 localhost', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: '[::1]:3000' },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).not.toHaveBeenCalled();
      expect(reply.code).not.toHaveBeenCalled();
    });

    it('should accept x-forwarded-host with port when domain matches (trusted)', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
        trustProxyHeaders: true,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: {
          host: 'internal.proxy',
          'x-forwarded-host': 'example.com:8443',
        },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).not.toHaveBeenCalled();
      expect(reply.code).not.toHaveBeenCalled();
    });
    it('should ignore x-forwarded-host when not trusted (default)', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
        // trustProxyHeaders: false by default
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: {
          host: 'internal.proxy',
          'x-forwarded-host': 'example.com',
        },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
    });
  });

  describe('domain validation', () => {
    it('should allow valid domain when config is a single string', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: 'example.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({ headers: { host: 'example.com' } });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });

    it('should support wildcard subdomains when config is a single string', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: '*.example.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'api.example.com' },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });
    it('should block invalid domains', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({ headers: { host: 'evil.com' } });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.type).toHaveBeenCalledWith('text/plain');
      expect(reply.send).toHaveBeenCalledWith(
        'Access denied: This domain is not authorized to access this server',
      );
    });

    it('should allow valid domains', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({ headers: { host: 'example.com' } });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });

    it('should support wildcard subdomains', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['*.example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'api.example.com' },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });

    it('should reject subdomains without wildcard', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'api.example.com' },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('should handle case insensitive domains', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['EXAMPLE.COM'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({ headers: { host: 'example.com' } });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });
  });

  describe('canonical domain redirects', () => {
    it('should redirect to canonical domain', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['staging.com', 'example.com'],
        canonicalDomain: 'example.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'staging.com' },
        url: '/test?param=value',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(301);
      expect(reply.redirect).toHaveBeenCalledWith(
        'https://example.com/test?param=value',
      );
    });

    it('should preserve port when configured', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['staging.com', 'example.com'],
        canonicalDomain: 'example.com',
        preservePort: true,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'staging.com:3000' },
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).toHaveBeenCalledWith(
        'https://example.com:3000/test',
      );
    });

    it('should strip port by default', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['staging.com', 'example.com'],
        canonicalDomain: 'example.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'staging.com:3000' },
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).toHaveBeenCalledWith('https://example.com/test');
    });

    it('uses custom redirect status code', async () => {
      const config: DomainValidationConfig = {
        canonicalDomain: 'example.com',
        redirectStatusCode: 308,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'stage.example.com' },
        url: '/x',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(308);
      expect(reply.redirect).toHaveBeenCalledWith('https://example.com/x');
    });

    it('redirects to canonical even without allowlist', async () => {
      const config: DomainValidationConfig = {
        canonicalDomain: 'example.com',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'alt.com' },
        url: '/t',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(301);
      expect(reply.redirect).toHaveBeenCalledWith('https://example.com/t');
    });

    it('redirects to canonical IPv4 host', async () => {
      const config: DomainValidationConfig = {
        canonicalDomain: '127.0.0.1',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'alt.example' },
        url: '/x',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(301);
      expect(reply.redirect).toHaveBeenCalledWith('https://127.0.0.1/x');
    });

    it('redirects to canonical IPv6 host (unbracketed input)', async () => {
      const config: DomainValidationConfig = {
        canonicalDomain: '2001:db8::1',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'alt.example' },
        url: '/x',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(301);
      expect(reply.redirect).toHaveBeenCalledWith('https://[2001:db8::1]/x');
    });

    it('redirects to canonical IPv6 host (bracketed input)', async () => {
      const config: DomainValidationConfig = {
        canonicalDomain: '[2001:db8::1]',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'alt.example' },
        url: '/x',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(301);
      expect(reply.redirect).toHaveBeenCalledWith('https://[2001:db8::1]/x');
    });
  });

  describe('HTTPS enforcement', () => {
    it('should redirect HTTP to HTTPS', async () => {
      const config: DomainValidationConfig = {
        enforceHttps: true,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'example.com' },
        protocol: 'http',
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).toHaveBeenCalledWith('https://example.com/test');
    });

    it('should always strip port on protocol change', async () => {
      const config: DomainValidationConfig = {
        enforceHttps: true,
        preservePort: true, // Should be ignored for protocol changes
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'example.com:8080' },
        protocol: 'http',
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).toHaveBeenCalledWith('https://example.com/test');
    });

    it('should respect x-forwarded-proto header when trusted', async () => {
      const config: DomainValidationConfig = {
        enforceHttps: true,
        trustProxyHeaders: true,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: {
          host: 'example.com',
          'x-forwarded-proto': 'http',
        },
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).toHaveBeenCalledWith('https://example.com/test');
    });

    it('builds correct redirect URL for IPv6 host with protocol change', async () => {
      const config: DomainValidationConfig = {
        enforceHttps: true,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: '[2001:db8::1]:8080' },
        protocol: 'http',
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).toHaveBeenCalledWith('https://[2001:db8::1]/test');
    });
  });

  describe('WWW handling', () => {
    it('should add www prefix when configured', async () => {
      const config: DomainValidationConfig = {
        wwwHandling: 'add',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'example.com' },
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).toHaveBeenCalledWith(
        'https://www.example.com/test',
      );
    });

    it('should remove www prefix when configured', async () => {
      const config: DomainValidationConfig = {
        wwwHandling: 'remove',
        canonicalDomain: 'example.com', // Set canonical to non-www
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'www.example.com' },
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      // Should redirect to canonical domain (which removes www)
      expect(reply.redirect).toHaveBeenCalledWith('https://example.com/test');
    });

    it('should not modify subdomains', async () => {
      const config: DomainValidationConfig = {
        wwwHandling: 'add',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'api.example.com' },
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.redirect).not.toHaveBeenCalled();
    });

    it('preserves port with WWW add when protocol unchanged', async () => {
      const config: DomainValidationConfig = {
        wwwHandling: 'add',
        preservePort: true,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'example.com:3000' },
        protocol: 'https',
        url: '/p',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(301);
      expect(reply.redirect).toHaveBeenCalledWith(
        'https://www.example.com:3000/p',
      );
    });
  });

  describe('combined redirects', () => {
    it('should perform single redirect for multiple changes', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['staging.com', 'example.com'],
        canonicalDomain: 'example.com',
        enforceHttps: true,
        wwwHandling: 'add',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'staging.com:3000' },
        protocol: 'http',
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      // Should redirect once to final target
      expect(reply.redirect).toHaveBeenCalledTimes(1);
      expect(reply.redirect).toHaveBeenCalledWith(
        'https://www.example.com/test',
      );
    });
  });

  describe('API endpoint detection', () => {
    it('should treat all requests as API when using root prefix "/"', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };

      const pluginHost = createMockPluginHost();

      // Using root prefix "/" means all paths are API endpoints
      const options = createMockOptions({
        serverType: 'api',
        apiEndpoints: { apiEndpointPrefix: '/' },
      });

      const request = createMockRequest({
        headers: { host: 'evil.com' },
        url: '/some/random/path',
      });

      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.type).toHaveBeenCalledWith('application/json');
      expect(reply.send).toHaveBeenCalledWith({
        error: 'invalid_domain',
        message: 'This domain is not authorized to access this server',
      });
    });

    it('should return JSON error for API endpoints', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'evil.com' },
        url: '/api/users',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.type).toHaveBeenCalledWith('application/json');
      expect(reply.send).toHaveBeenCalledWith({
        error: 'invalid_domain',
        message: 'This domain is not authorized to access this server',
      });
    });

    it('should handle API prefix normalization', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions({
        apiEndpoints: { apiEndpointPrefix: 'api' }, // No leading slash
      });
      const request = createMockRequest({
        headers: { host: 'evil.com' },
        url: '/api/users',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.type).toHaveBeenCalledWith('application/json');
    });

    it('should not match false positives', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'evil.com' },
        // cspell:disable-next-line
        url: '/apix', // Should not match /api
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.type).toHaveBeenCalledWith('text/plain');
    });

    it('treats /api?x=1 as API', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'evil.com' },
        url: '/api?x=1',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.type).toHaveBeenCalledWith('application/json');
      expect(reply.send).toHaveBeenCalledWith({
        error: 'invalid_domain',
        message: 'This domain is not authorized to access this server',
      });
    });
  });

  describe('custom error handlers', () => {
    it('should use custom invalidDomainHandler when provided', async () => {
      const customHandler = mock(() => ({
        contentType: 'html' as const,
        content: '<h1>Custom Error Page</h1>',
      }));

      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
        invalidDomainHandler: customHandler,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'evil.com' },
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(customHandler).toHaveBeenCalledWith(
        request,
        'evil.com',
        false,
        false,
      );
      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.type).toHaveBeenCalledWith('text/html');
      expect(reply.send).toHaveBeenCalledWith('<h1>Custom Error Page</h1>');
    });

    it('should return default text error for non-API endpoints', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'evil.com' },
        url: '/regular-page',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.type).toHaveBeenCalledWith('text/plain');
      expect(reply.send).toHaveBeenCalledWith(
        'Access denied: This domain is not authorized to access this server',
      );
    });

    it('should return default JSON error for API endpoints', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'evil.com' },
        url: '/api/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.type).toHaveBeenCalledWith('application/json');
      expect(reply.send).toHaveBeenCalledWith({
        error: 'invalid_domain',
        message: 'This domain is not authorized to access this server',
      });
    });

    it('passes isAPI=true to custom handler on API paths', async () => {
      const customHandler = mock(() => ({
        contentType: 'text' as const,
        content: 'nope',
      }));
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
        invalidDomainHandler: customHandler,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'evil.com' },
        url: '/api/things',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(customHandler).toHaveBeenCalledWith(
        request,
        'evil.com',
        false,
        true,
      );
      expect(reply.code).toHaveBeenCalledWith(403);
      expect(reply.type).toHaveBeenCalledWith('text/plain');
      expect(reply.send).toHaveBeenCalledWith('nope');
    });
  });

  describe('proxy headers', () => {
    it('should respect x-forwarded-host header', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
        trustProxyHeaders: true,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: {
          host: 'internal.proxy.com',
          'x-forwarded-host': 'example.com',
        },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });

    it('should handle comma-separated forwarded headers', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
        trustProxyHeaders: true,
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: {
          host: 'internal.proxy.com',
          'x-forwarded-host': 'example.com, proxy.internal.com',
        },
      });

      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });
  });

  describe('configuration validation', () => {
    it("should reject global wildcard '*' in validProductionDomains", () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['*'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = domainValidation(config);

      expect(plugin(pluginHost, options)).rejects.toThrow(
        /global wildcard '\*' not allowed/i,
      );
    });

    it("should reject protocol wildcard entries like 'https://*'", () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['https://*'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = domainValidation(config);

      expect(plugin(pluginHost, options)).rejects.toThrow(
        /protocols are not allowed in domain context/i,
      );
    });

    it("should reject origin-style entries like 'https://example.com'", () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['https://example.com'],
      };

      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const plugin = domainValidation(config);

      expect(plugin(pluginHost, options)).rejects.toThrow(
        /protocols are not allowed in domain context/i,
      );
    });
  });

  describe('IDN / punycode normalization', () => {
    it('should allow IDN domains when punycode is in allowlist', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['xn--exmple-cua.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'exämple.com' },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });

    it('should allow punycode domains when IDN is in allowlist', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['exämple.com'],
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'xn--exmple-cua.com' },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });
  });

  describe('apex detection with multi-part TLDs', () => {
    it('should add www to apex domain with multi-part TLD', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.co.uk', '*.example.co.uk'],
        wwwHandling: 'add',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'example.co.uk' },
        url: '/test',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(301);
      expect(reply.redirect).toHaveBeenCalledWith(
        'https://www.example.co.uk/test',
      );
    });

    it('should not add www to subdomain with multi-part TLD', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['*.example.co.uk'],
        wwwHandling: 'add',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'shop.example.co.uk' },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });
  });

  describe('WWW handling edge cases', () => {
    it('should not remove www from non-apex subdomains', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['**.example.com'],
        wwwHandling: 'remove',
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'www.api.example.com' },
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).not.toHaveBeenCalled();
      expect(reply.redirect).not.toHaveBeenCalled();
    });
  });

  describe('port preservation edge cases', () => {
    it('should preserve port when protocol unchanged', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['staging.com', 'example.com'],
        canonicalDomain: 'example.com',
        preservePort: true,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'staging.com:4443' },
        url: '/test',
        protocol: 'https',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(301);
      expect(reply.redirect).toHaveBeenCalledWith(
        'https://example.com:4443/test',
      );
    });

    it('should strip port when protocol changes even with preservePort false', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
        enforceHttps: true,
        preservePort: false,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: { host: 'example.com:8080' },
        url: '/test',
        protocol: 'http',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(301);
      expect(reply.redirect).toHaveBeenCalledWith('https://example.com/test');
    });
  });

  describe('comma-separated proxy headers', () => {
    it('should honor first value in comma-separated x-forwarded-proto', async () => {
      const config: DomainValidationConfig = {
        validProductionDomains: ['example.com'],
        enforceHttps: true,
        trustProxyHeaders: true,
      };
      const pluginHost = createMockPluginHost();
      const options = createMockOptions();
      const request = createMockRequest({
        headers: {
          host: 'example.com',
          'x-forwarded-proto': 'http, https',
        },
        url: '/test',
        protocol: 'https',
      });
      const reply = createMockReply();

      const plugin = domainValidation(config);
      await plugin(pluginHost, options);

      const hook = pluginHost.getHooks()[0];
      await hook.handler(request, reply);

      expect(reply.code).toHaveBeenCalledWith(301);
      expect(reply.redirect).toHaveBeenCalledWith('https://example.com/test');
    });
  });
});

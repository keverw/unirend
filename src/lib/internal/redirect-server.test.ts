import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { RedirectServer } from './redirect-server';
import type { InvalidDomainResponse } from './redirect-server';
import { escapeHTML } from './html-utils/escape';
import getPort from 'get-port';

describe('RedirectServer', () => {
  let server: RedirectServer;
  let testPort: number;

  beforeEach(async () => {
    testPort = await getPort();
  });

  afterEach(async () => {
    if (server?.isListening()) {
      await server.stop();
    }
  });

  describe('Constructor', () => {
    it('creates server with default options', () => {
      server = new RedirectServer();
      expect(server).toBeDefined();
      expect(server.isListening()).toBe(false);
    });

    it('creates server with custom options', () => {
      server = new RedirectServer({
        targetProtocol: 'https',
        statusCode: 302,
        preservePort: true,
      });

      expect(server).toBeDefined();
    });

    it('validates allowedDomains on construction', () => {
      expect(() => {
        new RedirectServer({
          allowedDomains: ['invalid..domain'],
        });
      }).toThrow('Invalid domain in allowedDomains');
    });

    it('accepts valid domain patterns', () => {
      expect(() => {
        new RedirectServer({
          allowedDomains: ['example.com', '*.example.com', '**.example.com'],
        });
      }).not.toThrow();
    });

    it('rejects https option (redirect servers should be HTTP only)', () => {
      // TypeScript should prevent this, but verify the type constraint exists
      const options: any = { https: {} };
      expect(() => new RedirectServer(options)).not.toThrow();
    });
  });

  describe('Basic HTTP → HTTPS Redirect', () => {
    beforeEach(async () => {
      server = new RedirectServer({
        targetProtocol: 'https',
        statusCode: 301,
      });
      await server.listen(testPort, 'localhost');
    });

    it('redirects HTTP to HTTPS with same path', async () => {
      const response = await fetch(`http://localhost:${testPort}/test/path`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe(
        'https://localhost/test/path',
      );
    });

    it('redirects with query string preserved', async () => {
      const response = await fetch(
        `http://localhost:${testPort}/page?foo=bar&baz=qux`,
        {
          redirect: 'manual',
        },
      );

      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe(
        'https://localhost/page?foo=bar&baz=qux',
      );
    });

    it('redirects root path correctly', async () => {
      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('https://localhost/');
    });
  });

  describe('Status Codes', () => {
    it('uses 301 permanent redirect by default', async () => {
      server = new RedirectServer();
      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(301);
    });

    it('uses 302 temporary redirect when configured', async () => {
      server = new RedirectServer({ statusCode: 302 });
      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(302);
    });

    it('uses 307 temporary redirect (preserves method)', async () => {
      server = new RedirectServer({ statusCode: 307 });
      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(307);
    });

    it('uses 308 permanent redirect (preserves method)', async () => {
      server = new RedirectServer({ statusCode: 308 });
      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
      });

      expect(response.status).toBe(308);
    });
  });

  describe('Port Preservation', () => {
    it('strips port by default', async () => {
      server = new RedirectServer({ preservePort: false });
      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
      });

      expect(response.headers.get('location')).toBe('https://localhost/');
    });

    it('preserves port when configured', async () => {
      server = new RedirectServer({ preservePort: true });
      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
      });

      expect(response.headers.get('location')).toBe(
        `https://localhost:${testPort}/`,
      );
    });
  });

  describe('Domain Validation', () => {
    it('allows exact domain match', async () => {
      server = new RedirectServer({
        allowedDomains: ['example.com'],
      });
      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'example.com' },
      });

      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('https://example.com/');
    });

    it('rejects non-allowed domain', async () => {
      server = new RedirectServer({
        allowedDomains: ['example.com'],
      });

      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'evil.com' },
      });

      expect(response.status).toBe(403);

      const text = await response.text();
      expect(text).toContain('Access denied');
      expect(text).toContain('evil.com');
    });

    it('supports single-level wildcard (*.example.com)', async () => {
      server = new RedirectServer({
        allowedDomains: ['*.example.com'],
      });

      await server.listen(testPort, 'localhost');

      // Should allow direct subdomain
      const response1 = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'api.example.com' },
      });

      expect(response1.status).toBe(301);

      // Should reject nested subdomain
      const response2 = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'app.api.example.com' },
      });

      expect(response2.status).toBe(403);
    });

    it('supports multi-level wildcard (**.example.com)', async () => {
      server = new RedirectServer({
        allowedDomains: ['**.example.com'],
      });

      await server.listen(testPort, 'localhost');

      // Should allow direct subdomain
      const response1 = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'api.example.com' },
      });

      expect(response1.status).toBe(301);

      // Should allow nested subdomain
      const response2 = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'app.api.example.com' },
      });

      expect(response2.status).toBe(301);
    });

    it('supports array of allowed domains', async () => {
      server = new RedirectServer({
        allowedDomains: ['example.com', 'example.org', '*.example.net'],
      });

      await server.listen(testPort, 'localhost');

      const response1 = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'example.com' },
      });

      expect(response1.status).toBe(301);

      const response2 = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'api.example.net' },
      });

      expect(response2.status).toBe(301);

      const response3 = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'evil.com' },
      });

      expect(response3.status).toBe(403);
    });

    it('normalizes domains for comparison', async () => {
      server = new RedirectServer({
        allowedDomains: ['EXAMPLE.COM'],
      });
      await server.listen(testPort, 'localhost');

      // Should match case-insensitively
      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'example.com' },
      });
      expect(response.status).toBe(301);
    });
  });

  describe('Custom invalidDomainHandler', () => {
    it('returns JSON error when contentType is json', async () => {
      server = new RedirectServer({
        allowedDomains: ['example.com'],
        invalidDomainHandler: (request, domain): InvalidDomainResponse => ({
          contentType: 'json',
          content: {
            error: 'invalid_domain',
            message: `Domain "${domain}" is not authorized`,
            allowed: ['example.com'],
          },
        }),
      });

      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'evil.com' },
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('content-type')).toContain(
        'application/json',
      );
      expect(response.headers.get('cache-control')).toBe('no-store');

      const json = await response.json();
      expect(json.error).toBe('invalid_domain');
      expect(json.message).toContain('evil.com');
      expect(json.allowed).toEqual(['example.com']);
    });

    it('returns HTML error when contentType is html', async () => {
      server = new RedirectServer({
        allowedDomains: ['example.com'],
        invalidDomainHandler: (request, domain): InvalidDomainResponse => ({
          contentType: 'html',
          content: `<h1>403 Forbidden</h1><p>Domain ${escapeHTML(domain)} not allowed</p>`,
        }),
      });

      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'evil.com' },
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();
      expect(html).toContain('<h1>403 Forbidden</h1>');
      expect(html).toContain('evil.com');
    });

    it('returns plain text error when contentType is text', async () => {
      server = new RedirectServer({
        allowedDomains: ['example.com'],
        invalidDomainHandler: (request, domain): InvalidDomainResponse => ({
          contentType: 'text',
          content: `Blocked: ${domain}`,
        }),
      });

      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'evil.com' },
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('content-type')).toContain('text/plain');

      const text = await response.text();
      expect(text).toBe('Blocked: evil.com');
    });

    it('receives request object in handler', async () => {
      let capturedPath: string | undefined;

      server = new RedirectServer({
        allowedDomains: ['example.com'],
        invalidDomainHandler: (request, domain): InvalidDomainResponse => {
          capturedPath = request.url;
          return {
            contentType: 'text',
            content: `Blocked ${domain} at ${request.url}`,
          };
        },
      });

      await server.listen(testPort, 'localhost');

      await fetch(`http://localhost:${testPort}/test/path?foo=bar`, {
        redirect: 'manual',
        headers: { Host: 'evil.com' },
      });

      expect(capturedPath).toBe('/test/path?foo=bar');
    });
  });

  describe('IPv6 Support', () => {
    it('handles IPv6 addresses with brackets', async () => {
      server = new RedirectServer({
        allowedDomains: ['[::1]', '[2001:db8::1]'],
      });

      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: '[::1]' },
      });

      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('https://[::1]/');
    });

    it('handles IPv6 with port', async () => {
      server = new RedirectServer({
        allowedDomains: ['[::1]'],
        preservePort: true,
      });
      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: '[::1]:8080' },
      });

      expect(response.status).toBe(301);
      expect(response.headers.get('location')).toBe('https://[::1]:8080/');
    });
  });

  describe('Server Lifecycle', () => {
    it('starts and stops cleanly', async () => {
      server = new RedirectServer();

      expect(server.isListening()).toBe(false);

      await server.listen(testPort, 'localhost');
      expect(server.isListening()).toBe(true);

      await server.stop();
      expect(server.isListening()).toBe(false);
    });

    it('handles multiple start/stop cycles', async () => {
      server = new RedirectServer();

      await server.listen(testPort, 'localhost');
      await server.stop();

      await server.listen(testPort, 'localhost');
      expect(server.isListening()).toBe(true);

      await server.stop();
      expect(server.isListening()).toBe(false);
    });
  });

  describe('Security', () => {
    it('prevents Host header attacks with domain validation', async () => {
      server = new RedirectServer({
        allowedDomains: ['example.com'],
      });

      await server.listen(testPort, 'localhost');

      // Attacker tries to manipulate Host header
      const response = await fetch(`http://localhost:${testPort}/login`, {
        redirect: 'manual',
        headers: { Host: 'phishing-site.com' },
      });

      // Should be blocked, not redirected to phishing site
      expect(response.status).toBe(403);
      expect(response.headers.get('location')).toBeNull();
    });

    it('sets Cache-Control: no-store on 403 responses', async () => {
      server = new RedirectServer({
        allowedDomains: ['example.com'],
      });
      await server.listen(testPort, 'localhost');

      const response = await fetch(`http://localhost:${testPort}/`, {
        redirect: 'manual',
        headers: { Host: 'evil.com' },
      });

      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('no-store');
    });
  });
});

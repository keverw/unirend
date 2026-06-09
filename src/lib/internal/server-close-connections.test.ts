import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import getPort from 'get-port';
import { StaticWebServer } from './static-web-server';
import { RedirectServer } from './redirect-server';

/**
 * Covers the closeAllConnections() method body on StaticWebServer and
 * RedirectServer, which were previously uncovered (line 403 and 289).
 * Both use optional chaining (this.server?.closeAllConnections()), so
 * calling them on an un-started server is a safe, observable no-op.
 */

describe('StaticWebServer.closeAllConnections()', () => {
  it('does not throw on an un-started server (optional chaining no-op)', () => {
    const server = new StaticWebServer({
      buildDir: '/fake/build',
      pageMapPath: 'page-map.json',
    });
    expect(() => server.closeAllConnections()).not.toThrow();
  });

  it('does not throw and returns undefined', () => {
    const server = new StaticWebServer({
      buildDir: '/fake/build',
      pageMapPath: 'page-map.json',
    });
    const result = server.closeAllConnections();
    expect(result).toBeUndefined();
  });
});

describe('RedirectServer.closeAllConnections()', () => {
  let server: RedirectServer | null = null;
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

  it('does not throw on an un-started server', () => {
    const s = new RedirectServer();
    server = s;
    expect(() => s.closeAllConnections()).not.toThrow();
  });

  it('returns undefined on an un-started server', () => {
    server = new RedirectServer();
    const result = server.closeAllConnections();
    expect(result).toBeUndefined();
  });

  it('does not throw when called on a listening server', async () => {
    const s = new RedirectServer();
    server = s;
    await s.listen(port, 'localhost');
    expect(() => s.closeAllConnections()).not.toThrow();
  });
});

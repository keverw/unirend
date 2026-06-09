import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import getPort from 'get-port';
import { serveAPI } from '../api';
import type { APIServer } from './api-server';

/**
 * Covers the public methods on APIServer that are not exercised by the
 * closing/logging test suites: updateAccessLoggingConfig, the `api` and
 * `pageDataHandler` getters, and registerWebSocketHandler's throw path.
 */
describe('APIServer public methods', () => {
  let server: APIServer | null = null;
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

  describe('updateAccessLoggingConfig()', () => {
    it('can be called before listen() without throwing', () => {
      const s = serveAPI();
      server = s;
      expect(() => {
        s.updateAccessLoggingConfig({ events: 'none' });
      }).not.toThrow();
    });

    it('can be called after listen() without throwing', async () => {
      const s = serveAPI();
      server = s;
      await s.listen(port, 'localhost');
      expect(() => {
        s.updateAccessLoggingConfig({ events: 'finish' });
      }).not.toThrow();
    });

    it('accepts a partial update with just template', async () => {
      const s = serveAPI();
      server = s;
      await s.listen(port, 'localhost');
      expect(() => {
        s.updateAccessLoggingConfig({
          responseTemplate: '{{method}} {{url}} {{statusCode}}',
        });
      }).not.toThrow();
    });
  });

  describe('.api getter', () => {
    it('returns the apiMethod object before listen()', () => {
      server = serveAPI();
      const api = server.api;
      expect(typeof api).toBe('object');
      expect(api).not.toBeNull();
    });

    it('apiMethod has get/post/put/patch/delete helpers', () => {
      server = serveAPI();
      const api = server.api;
      expect(typeof api.get).toBe('function');
      expect(typeof api.post).toBe('function');
      expect(typeof api.put).toBe('function');
      expect(typeof api.patch).toBe('function');
      expect(typeof api.delete).toBe('function');
    });
  });

  describe('.pageDataHandler getter', () => {
    it('returns the pageDataHandlerMethod object before listen()', () => {
      server = serveAPI();
      const pdh = server.pageDataHandler;
      expect(typeof pdh).toBe('object');
      expect(pdh).not.toBeNull();
    });

    it('pageDataHandlerMethod has a register function', () => {
      server = serveAPI();
      const pdh = server.pageDataHandler;
      expect(typeof pdh.register).toBe('function');
    });
  });

  describe('registerWebSocketHandler()', () => {
    it('throws when WebSocket support is not enabled', () => {
      // serveAPI() does not enable WebSocket by default
      const s = serveAPI();
      server = s;
      expect(() => {
        s.registerWebSocketHandler({
          path: '/ws',
          handler: () => {},
        });
      }).toThrow(/WebSocket support is not enabled/);
    });

    it('error message includes guidance to set enableWebSockets: true', () => {
      server = serveAPI();
      let caught: Error | undefined;
      try {
        server.registerWebSocketHandler({ path: '/ws', handler: () => {} });
      } catch (error) {
        caught = error as Error;
      }
      expect(caught).toBeDefined();
      expect(caught?.message).toContain('enableWebSockets');
    });
  });
});

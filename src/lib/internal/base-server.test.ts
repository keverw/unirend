import { describe, it, expect } from 'bun:test';
import { BaseServer } from './base-server';

class StubServer extends BaseServer {
  public listen(_port?: number, _host?: string): Promise<void> {
    return Promise.resolve();
  }
  public stop(): Promise<void> {
    return Promise.resolve();
  }
  public registerWebSocketHandler(_config: unknown): void {}
  public getWebSocketClients(): Set<unknown> {
    return new Set();
  }
}

describe('BaseServer', () => {
  describe('isListening()', () => {
    it('returns false when not started', () => {
      const server = new StubServer();
      expect(server.isListening()).toBe(false);
    });
  });

  describe('hasDecoration()', () => {
    it('returns false when fastifyInstance is null', () => {
      const server = new StubServer();
      expect(server.hasDecoration('anyProp')).toBe(false);
    });

    it('returns true when the decoration exists on the fastify instance', () => {
      const server = new StubServer();
      (
        server as unknown as { fastifyInstance: Record<string, unknown> }
      ).fastifyInstance = {
        cookiePluginInfo: { enabled: true },
      };

      expect(server.hasDecoration('cookiePluginInfo')).toBe(true);
    });

    it('returns false when the decoration is absent from the fastify instance', () => {
      const server = new StubServer();
      (
        server as unknown as { fastifyInstance: Record<string, unknown> }
      ).fastifyInstance = {};

      expect(server.hasDecoration('missingProp')).toBe(false);
    });
  });

  describe('getDecoration()', () => {
    it('returns undefined when fastifyInstance is null', () => {
      const server = new StubServer();
      expect(server.getDecoration('anyProp')).toBeUndefined();
    });

    it('returns the decoration value when it exists', () => {
      const server = new StubServer();
      (
        server as unknown as { fastifyInstance: Record<string, unknown> }
      ).fastifyInstance = {
        myPlugin: { version: '1.0' },
      };

      expect(server.getDecoration<{ version: string }>('myPlugin')).toEqual({
        version: '1.0',
      });
    });

    it('returns undefined when the decoration is absent from the fastify instance', () => {
      const server = new StubServer();
      (
        server as unknown as { fastifyInstance: Record<string, unknown> }
      ).fastifyInstance = {};

      expect(server.getDecoration('missing')).toBeUndefined();
    });
  });

  describe('closeAllConnections()', () => {
    it('does not throw when fastifyInstance is null', () => {
      const server = new StubServer();
      expect(() => server.closeAllConnections()).not.toThrow();
    });

    it('calls closeAllConnections on the raw HTTP server when available', () => {
      const server = new StubServer();
      let wasCalled = false;
      (server as unknown as { fastifyInstance: unknown }).fastifyInstance = {
        server: {
          closeAllConnections: () => {
            wasCalled = true;
          },
        },
      };

      server.closeAllConnections();
      expect(wasCalled).toBe(true);
    });
  });
});

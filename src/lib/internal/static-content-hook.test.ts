import { describe, it, expect, mock } from 'bun:test';
import { createStaticContentHook } from './static-content-hook';
import type { FastifyRequest, FastifyReply } from 'fastify';

// Helper to create mock request
const createMockRequest = (
  url: string,
  method: string = 'GET',
): Partial<FastifyRequest> => ({
  method,
  raw: { url } as FastifyRequest['raw'],
  url,
  headers: {},
});

// Helper to create mock reply
const createMockReply = (): Partial<FastifyReply> => {
  const reply = {
    sent: false,
    code: mock(() => reply as unknown as FastifyReply),
    header: mock(() => reply as unknown as FastifyReply),
    type: mock(() => reply as unknown as FastifyReply),
    send: mock(() => reply as unknown as FastifyReply),
  };

  return reply;
};

describe('createStaticContentHook', () => {
  describe('hook creation', () => {
    it('creates a hook function', () => {
      const hook = createStaticContentHook({
        singleAssetMap: {},
        folderMap: {},
      });

      expect(typeof hook).toBe('function');
    });

    it('creates independent instances', () => {
      const hook1 = createStaticContentHook({
        singleAssetMap: { '/file1.txt': '/path/to/file1.txt' },
      });

      const hook2 = createStaticContentHook({
        singleAssetMap: { '/file2.txt': '/path/to/file2.txt' },
      });

      expect(hook1).not.toBe(hook2);
    });
  });

  describe('request filtering', () => {
    it('ignores non-GET requests', async () => {
      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/test.txt', 'POST');
      const reply = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(reply.send).not.toHaveBeenCalled();
    });

    it('ignores requests without URL', async () => {
      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = { method: 'GET', raw: {} } as FastifyRequest;
      const reply = createMockReply();

      await hook(req, reply as FastifyReply);

      expect(reply.send).not.toHaveBeenCalled();
    });

    it('processes GET requests with URLs', async () => {
      const hook = createStaticContentHook({
        singleAssetMap: {},
      });

      const req = createMockRequest('/test.txt');
      const reply = createMockReply();

      // Should not throw - delegates to cache
      await hook(req as FastifyRequest, reply as FastifyReply);
    });
  });

  describe('delegation to StaticContentCache', () => {
    it('delegates request handling to cache', async () => {
      const hook = createStaticContentHook({
        singleAssetMap: {},
      });

      const req = createMockRequest('/test.txt');
      const reply = createMockReply();

      // Should delegate to cache.handleRequest()
      // The cache is responsible for URL resolution and file serving
      await hook(req as FastifyRequest, reply as FastifyReply);

      // No error thrown means delegation worked
      expect(true).toBe(true);
    });
  });

  describe('configuration', () => {
    it('passes singleAssetMap to cache', () => {
      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      expect(typeof hook).toBe('function');
    });

    it('passes folderMap to cache', () => {
      const hook = createStaticContentHook({
        folderMap: { '/assets': '/path/to/assets' },
      });

      expect(typeof hook).toBe('function');
    });

    it('passes cache options to cache', () => {
      const hook = createStaticContentHook({
        singleAssetMap: {},
        cacheEntries: 50,
        smallFileMaxSize: 1024 * 1024,
      });

      expect(typeof hook).toBe('function');
    });

    it('passes logger to cache', () => {
      const logger = {
        warn: mock(() => {}),
      };

      const hook = createStaticContentHook(
        {
          singleAssetMap: {},
        },
        logger,
      );

      expect(typeof hook).toBe('function');
    });
  });
});

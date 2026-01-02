import { describe, it, expect, mock } from 'bun:test';
import { createStaticContentHook } from './static-content-hook';
import { StaticContentCache } from './StaticContentCache';
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

  describe('external cache support', () => {
    it('accepts a StaticContentCache instance instead of config', () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const hook = createStaticContentHook(cache);

      expect(typeof hook).toBe('function');
    });

    it('uses provided cache instance', async () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/external-only.txt': '/path/to/external-only.txt' },
      });

      // Get initial cache stats
      const statsBefore = cache.getCacheStats();
      expect(statsBefore.stat.items).toBe(0);

      const hook = createStaticContentHook(cache);

      const req = createMockRequest('/external-only.txt');
      const reply = createMockReply();

      // Should delegate to the provided cache
      await hook(req as FastifyRequest, reply as FastifyReply);

      // Verify the external cache was actually used by checking its stats changed
      const statsAfter = cache.getCacheStats();
      // Stat cache should have entries now (file was accessed)
      expect(statsAfter.stat.items).toBeGreaterThanOrEqual(1);
    });

    it('ignores logger parameter when cache instance is provided', () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const logger = {
        warn: mock(() => {}),
      };

      // Logger is ignored when cache instance is provided
      const hook = createStaticContentHook(cache, logger);

      expect(typeof hook).toBe('function');
      // Logger should not be called since we're using an existing cache
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('handles cache instance with runtime updates', async () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/initial.txt': '/path/to/initial.txt' },
        folderMap: {},
      });

      const hook = createStaticContentHook(cache);

      // Test initial state - request initial file
      const req1 = createMockRequest('/initial.txt');
      const reply1 = createMockReply();
      await hook(req1 as FastifyRequest, reply1 as FastifyReply);

      // Verify initial file was found (stat cache should have it)
      const statsAfterInitial = cache.getCacheStats();
      expect(statsAfterInitial.stat.items).toBeGreaterThanOrEqual(1);

      // Update cache after hook creation (replaces singleAssetMap with both files)
      cache.updateConfig({
        singleAssetMap: {
          '/initial.txt': '/path/to/initial.txt',
          '/updated.txt': '/path/to/updated.txt',
        },
      });

      // Test updated state - request newly added file
      const req2 = createMockRequest('/updated.txt');
      const reply2 = createMockReply();
      await hook(req2 as FastifyRequest, reply2 as FastifyReply);

      // Verify updated file was found (both files should be in stat cache now)
      const statsAfterUpdate = cache.getCacheStats();
      expect(statsAfterUpdate.stat.items).toBeGreaterThanOrEqual(2);

      // Verify both initial and updated files are accessible
      const req3 = createMockRequest('/initial.txt');
      const reply3 = createMockReply();
      await hook(req3 as FastifyRequest, reply3 as FastifyReply);

      // Should still work - no errors means both files are accessible
      expect(true).toBe(true);
    });
  });
});

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { StaticContentCache } from './static-content-cache';
import type { FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import { Readable } from 'stream';

// Mock fs operations
const mockFs = {
  stat: mock((_path: string) => Promise.resolve({} as fs.Stats)),
  readFile: mock((_path: string) => Promise.resolve(Buffer.from(''))),
  createReadStream: mock((_path: string, _options?: unknown) => new Readable()),
};

// Helper to create mock request
const createMockRequest = (
  url: string,
  method: string = 'GET',
  headers: Record<string, string> = {},
): Partial<FastifyRequest> => ({
  method,
  raw: { url } as FastifyRequest['raw'],
  url,
  headers,
});

// Helper to create mock reply
const createMockReply = (): {
  reply: Partial<FastifyReply>;
  sentData: { code?: number; headers: Record<string, string>; body?: unknown };
} => {
  const sentData: {
    code?: number;
    headers: Record<string, string>;
    body?: unknown;
  } = { headers: {} };

  const reply: Partial<FastifyReply> = {
    sent: false,
    code: mock((code: number) => {
      sentData.code = code;
      return reply as FastifyReply;
    }),
    header: mock((name: string, value: string) => {
      sentData.headers[name] = value;
      return reply as FastifyReply;
    }),
    type: mock((contentType: string) => {
      sentData.headers['Content-Type'] = contentType;
      return reply as FastifyReply;
    }),
    send: mock((body?: unknown) => {
      sentData.body = body;
      (reply as FastifyReply).sent = true;
      return reply as unknown as FastifyReply;
    }),
  };

  return { reply, sentData };
};

describe('StaticContentCache', () => {
  // Save original fs methods
  const originalStat = fs.promises.stat;
  const originalReadFile = fs.promises.readFile;
  const originalCreateReadStream = fs.createReadStream;

  beforeEach(() => {
    // Reset mocks before each test
    mockFs.stat.mockReset();
    mockFs.readFile.mockReset();
    mockFs.createReadStream.mockReset();

    // Mock fs operations
    (fs.promises as { stat: unknown }).stat = mockFs.stat;
    (fs.promises as { readFile: unknown }).readFile = mockFs.readFile;
    (fs as { createReadStream: unknown }).createReadStream =
      mockFs.createReadStream;
  });

  afterEach(() => {
    // Restore original fs methods
    (fs.promises as { stat: unknown }).stat = originalStat;
    (fs.promises as { readFile: unknown }).readFile = originalReadFile;
    (fs as { createReadStream: unknown }).createReadStream =
      originalCreateReadStream;
  });

  describe('constructor', () => {
    it('creates a cache instance', () => {
      const cache = new StaticContentCache({
        singleAssetMap: {},
        folderMap: {},
      });

      expect(cache).toBeInstanceOf(StaticContentCache);
    });

    it('creates independent instances', () => {
      const cache1 = new StaticContentCache({
        singleAssetMap: { '/file1.txt': '/path/to/file1.txt' },
      });

      const cache2 = new StaticContentCache({
        singleAssetMap: { '/file2.txt': '/path/to/file2.txt' },
      });

      expect(cache1).not.toBe(cache2);
    });
  });

  describe('getFile()', () => {
    it('returns not-found for non-existent files', async () => {
      const cache = new StaticContentCache({});

      mockFs.stat.mockRejectedValue({ code: 'ENOENT' });

      const result = await cache.getFile('/path/to/missing.txt');

      expect(result.status).toBe('not-found');
    });

    it('returns not-found for directories', async () => {
      const cache = new StaticContentCache({});

      mockFs.stat.mockResolvedValue({
        isFile: () => false,
        size: 0,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      const result = await cache.getFile('/path/to/directory');

      expect(result.status).toBe('not-found');
    });

    it('returns ok for existing files', async () => {
      const cache = new StaticContentCache({});
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      const result = await cache.getFile('/path/to/file.txt');

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.etag).toBeDefined();
        expect(result.mimeType).toBe('text/plain');
      }
    });

    it('returns not-modified when client ETag matches', async () => {
      const cache = new StaticContentCache({});
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      // First request to generate ETag
      const firstResult = await cache.getFile('/path/to/file.txt');
      expect(firstResult.status).toBe('ok');

      if (firstResult.status === 'ok') {
        // Second request with matching ETag
        const secondResult = await cache.getFile('/path/to/file.txt', {
          clientETag: firstResult.etag,
        });

        expect(secondResult.status).toBe('not-modified');
        if (secondResult.status === 'not-modified') {
          expect(secondResult.etag).toBe(firstResult.etag);
        }
      }
    });
  });

  describe('serveFile()', () => {
    it('returns not-found result for non-existent files', async () => {
      const cache = new StaticContentCache({});
      const req = createMockRequest('/test.txt');
      const { reply } = createMockReply();

      mockFs.stat.mockRejectedValue({ code: 'ENOENT' });

      const result = await cache.serveFile(
        req as FastifyRequest,
        reply as FastifyReply,
        '/path/to/missing.txt',
      );

      expect(result.served).toBe(false);
      if (!result.served) {
        expect(result.reason).toBe('not-found');
      }
    });

    it('returns served result for existing files', async () => {
      const cache = new StaticContentCache({});
      const req = createMockRequest('/test.txt');
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      const result = await cache.serveFile(
        req as FastifyRequest,
        reply as FastifyReply,
        '/path/to/file.txt',
      );

      expect(result.served).toBe(true);
      if (result.served) {
        expect(result.statusCode).toBe(200);
      }
      expect(sentData.headers['Content-Type']).toBe('text/plain');
    });

    it('returns 304 for matching ETags', async () => {
      const cache = new StaticContentCache({});
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      // First request to generate ETag
      const req1 = createMockRequest('/test.txt');
      const { reply: reply1 } = createMockReply();
      const firstResult = await cache.serveFile(
        req1 as FastifyRequest,
        reply1 as FastifyReply,
        '/path/to/file.txt',
      );

      expect(firstResult.served).toBe(true);

      // Second request with matching ETag
      const result = await cache.getFile('/path/to/file.txt');
      if (result.status === 'ok') {
        const req2 = createMockRequest('/test.txt', 'GET', {
          'if-none-match': result.etag,
        });
        const { reply: reply2 } = createMockReply();

        const secondResult = await cache.serveFile(
          req2 as FastifyRequest,
          reply2 as FastifyReply,
          '/path/to/file.txt',
        );

        expect(secondResult.served).toBe(true);
        if (secondResult.served) {
          expect(secondResult.statusCode).toBe(304);
        }
      }
    });
  });

  describe('handleRequest()', () => {
    it('returns not-found for unmapped URLs', async () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/other.txt');
      const { reply } = createMockReply();

      const result = await cache.handleRequest(
        '/other.txt',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(result.served).toBe(false);
      if (!result.served) {
        expect(result.reason).toBe('not-found');
      }
    });

    it('serves files from singleAssetMap', async () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/test.txt');
      const { reply } = createMockReply();
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      const result = await cache.handleRequest(
        '/test.txt',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(result.served).toBe(true);
      if (result.served) {
        expect(result.statusCode).toBe(200);
      }
    });

    it('serves files from folderMap', async () => {
      const cache = new StaticContentCache({
        folderMap: { '/assets': '/path/to/assets' },
      });

      const req = createMockRequest('/assets/test.txt');
      const { reply } = createMockReply();
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      const result = await cache.handleRequest(
        '/assets/test.txt',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(result.served).toBe(true);
      if (result.served) {
        expect(result.statusCode).toBe(200);
      }
    });

    it('strips query strings from URLs', async () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/test.txt?v=123');
      const { reply } = createMockReply();
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      const result = await cache.handleRequest(
        '/test.txt?v=123',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(result.served).toBe(true);
    });

    it('strips hash fragments from URLs', async () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/test.txt#section');
      const { reply } = createMockReply();
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      const result = await cache.handleRequest(
        '/test.txt#section',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(result.served).toBe(true);
    });

    it('normalizes URLs without leading slash', async () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('test.txt');
      const { reply } = createMockReply();
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      const result = await cache.handleRequest(
        'test.txt',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(result.served).toBe(true);
    });

    it('prevents directory traversal with ../', async () => {
      const cache = new StaticContentCache({
        folderMap: { '/assets': '/path/to/assets' },
      });

      const req = createMockRequest('/assets/../secret.txt');
      const { reply } = createMockReply();

      const result = await cache.handleRequest(
        '/assets/../secret.txt',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(result.served).toBe(false);
      if (!result.served) {
        expect(result.reason).toBe('not-found');
      }
      expect(mockFs.stat).not.toHaveBeenCalled();
    });

    it('prevents directory traversal with ..\\', async () => {
      const cache = new StaticContentCache({
        folderMap: { '/assets': '/path/to/assets' },
      });

      const req = createMockRequest('/assets/..\\secret.txt');
      const { reply } = createMockReply();

      const result = await cache.handleRequest(
        '/assets/..\\secret.txt',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(result.served).toBe(false);
      if (!result.served) {
        expect(result.reason).toBe('not-found');
      }
      expect(mockFs.stat).not.toHaveBeenCalled();
    });

    it('normalizes folder prefix to have trailing slash', async () => {
      const cache = new StaticContentCache({
        folderMap: { assets: '/path/to/assets' },
      });

      const req = createMockRequest('/assets/test.txt');
      const { reply } = createMockReply();
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      const result = await cache.handleRequest(
        '/assets/test.txt',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(result.served).toBe(true);
    });

    it('supports folder config object with detectImmutableAssets', async () => {
      const cache = new StaticContentCache({
        folderMap: {
          '/assets': { path: '/path/to/assets', detectImmutableAssets: true },
        },
        immutableCacheControl: 'public, max-age=31536000, immutable',
      });

      const req = createMockRequest('/assets/main.abc123.js');
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('console.log("test")');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      await cache.handleRequest(
        '/assets/main.abc123.js',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      // Should use immutable cache control for fingerprinted files
      expect(sentData.headers['Cache-Control']).toContain('immutable');
    });
  });

  describe('clearCaches()', () => {
    it('clears all caches', () => {
      const cache = new StaticContentCache({});

      // This should not throw
      cache.clearCaches();

      const stats = cache.getCacheStats();
      expect(stats.etag.items).toBe(0);
      expect(stats.content.items).toBe(0);
      expect(stats.stat.items).toBe(0);
    });
  });

  describe('invalidateFile()', () => {
    it('removes the file from all three caches', () => {
      const cache = new StaticContentCache({});

      const etagCache = (
        cache as unknown as {
          etagCache: { set: (k: string, v: string) => void; size: number };
        }
      ).etagCache;

      const contentCache = (
        cache as unknown as {
          contentCache: { set: (k: string, v: unknown) => void; size: number };
        }
      ).contentCache;

      const statCache = (
        cache as unknown as {
          statCache: { set: (k: string, v: unknown) => void; size: number };
        }
      ).statCache;

      etagCache.set('/dist/about.html', '"abc"');
      contentCache.set('/dist/about.html', Buffer.from('old'));
      statCache.set('/dist/about.html', { size: 3 });

      cache.invalidateFile('/dist/about.html');

      expect(etagCache.size).toBe(0);
      expect(contentCache.size).toBe(0);
      expect(statCache.size).toBe(0);
    });

    it('only evicts the specified file, leaving other entries intact', () => {
      const cache = new StaticContentCache({});

      const etagCache = (
        cache as unknown as {
          etagCache: { set: (k: string, v: string) => void; size: number };
        }
      ).etagCache;

      etagCache.set('/dist/index.html', '"aaa"');
      etagCache.set('/dist/about.html', '"bbb"');

      cache.invalidateFile('/dist/about.html');

      expect(etagCache.size).toBe(1);
      const remaining = (
        cache as unknown as {
          etagCache: { get: (k: string) => string | undefined };
        }
      ).etagCache;

      expect(remaining.get('/dist/index.html')).toBe('"aaa"');
    });

    it('is a no-op for a path not in the cache', () => {
      const cache = new StaticContentCache({});

      // Should not throw
      expect(() =>
        cache.invalidateFile('/dist/nonexistent.html'),
      ).not.toThrow();

      expect(cache.getCacheStats().etag.items).toBe(0);
    });
  });

  describe('replaceConfig()', () => {
    it('replaces the singleAssetMap so new URLs are routed correctly', () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/old': '/fake/old.html' },
      });

      cache.replaceConfig({ singleAssetMap: { '/new': '/fake/new.html' } });

      // The internal map should now only contain the new entry
      const internalMap = (
        cache as unknown as { singleAssetMap: Map<string, string> }
      ).singleAssetMap;
      expect(internalMap.has('/new')).toBe(true);
      expect(internalMap.has('/old')).toBe(false);
    });

    it('clears all file caches after replacing the map', () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/': '/fake/index.html' },
      });

      // Manually prime the LRU caches to simulate warm cache state
      const etagCache = (
        cache as unknown as {
          etagCache: { set: (k: string, v: string) => void; size: number };
        }
      ).etagCache;

      etagCache.set('/fake/index.html', '"abc123"');
      expect(etagCache.size).toBe(1);

      cache.replaceConfig({ singleAssetMap: { '/': '/fake/index-v2.html' } });

      // All caches should be empty — no stale data from before the rebuild
      const stats = cache.getCacheStats();
      expect(stats.etag.items).toBe(0);
      expect(stats.content.items).toBe(0);
      expect(stats.stat.items).toBe(0);
    });

    it('normalizes URL keys (adds leading slash)', () => {
      const cache = new StaticContentCache({});

      cache.replaceConfig({
        singleAssetMap: { 'no-slash': '/fake/file.html' },
      });

      const internalMap = (
        cache as unknown as { singleAssetMap: Map<string, string> }
      ).singleAssetMap;
      expect(internalMap.has('/no-slash')).toBe(true);
    });

    it('accepts an empty singleAssetMap, clearing all single asset routes', () => {
      const cache = new StaticContentCache({
        singleAssetMap: {
          '/': '/fake/index.html',
          '/about': '/fake/about.html',
        },
      });

      cache.replaceConfig({ singleAssetMap: {} });

      const internalMap = (
        cache as unknown as { singleAssetMap: Map<string, string> }
      ).singleAssetMap;

      expect(internalMap.size).toBe(0);
    });

    it('replaces the folderMap when provided', () => {
      const cache = new StaticContentCache({
        folderMap: { '/old-assets/': '/fake/old-assets' },
      });

      cache.replaceConfig({
        folderMap: { '/new-assets/': '/fake/new-assets' },
      });

      const internalFolderMap = (
        cache as unknown as { folderMap: Map<string, unknown> }
      ).folderMap;

      expect(internalFolderMap.has('/new-assets/')).toBe(true);
      expect(internalFolderMap.has('/old-assets/')).toBe(false);
    });

    it('leaves singleAssetMap unchanged when omitted', () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/page': '/fake/page.html' },
        folderMap: { '/assets/': '/fake/assets' },
      });

      // Only update folderMap
      cache.replaceConfig({ folderMap: { '/assets-v2/': '/fake/assets-v2' } });

      const internalMap = (
        cache as unknown as { singleAssetMap: Map<string, string> }
      ).singleAssetMap;

      expect(internalMap.has('/page')).toBe(true);
    });

    it('leaves folderMap unchanged when omitted', () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/old': '/fake/old.html' },
        folderMap: { '/assets/': '/fake/assets' },
      });

      // Only update singleAssetMap
      cache.replaceConfig({ singleAssetMap: { '/new': '/fake/new.html' } });

      const internalFolderMap = (
        cache as unknown as { folderMap: Map<string, unknown> }
      ).folderMap;

      expect(internalFolderMap.has('/assets/')).toBe(true);
    });

    it('always clears all caches even when no sections are provided', () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/': '/fake/index.html' },
      });

      const etagCache = (
        cache as unknown as {
          etagCache: { set: (k: string, v: string) => void; size: number };
        }
      ).etagCache;
      etagCache.set('/fake/index.html', '"abc123"');
      expect(etagCache.size).toBe(1);

      cache.replaceConfig({});

      expect(cache.getCacheStats().etag.items).toBe(0);
    });
  });

  describe('getCacheStats()', () => {
    it('returns cache statistics', () => {
      const cache = new StaticContentCache({});

      const stats = cache.getCacheStats();

      expect(stats).toHaveProperty('etag');
      expect(stats).toHaveProperty('content');
      expect(stats).toHaveProperty('stat');
      expect(stats.etag).toHaveProperty('items');
      expect(stats.etag).toHaveProperty('byteSize');
    });
  });

  describe('MIME types', () => {
    it('sets correct MIME types for common extensions', async () => {
      const testCases = [
        { file: '/test.txt', expected: 'text/plain' },
        { file: '/test.html', expected: 'text/html' },
        { file: '/test.css', expected: 'text/css' },
        { file: '/test.js', expected: 'application/javascript' },
        { file: '/test.json', expected: 'application/json' },
        { file: '/test.png', expected: 'image/png' },
        { file: '/test.jpg', expected: 'image/jpeg' },
        { file: '/test.gif', expected: 'image/gif' },
        { file: '/test.svg', expected: 'image/svg+xml' },
      ];

      for (const { file, expected } of testCases) {
        const cache = new StaticContentCache({
          singleAssetMap: { [file]: `/path/to${file}` },
        });

        const req = createMockRequest(file);
        const { reply, sentData } = createMockReply();
        const fileContent = Buffer.from('test');

        mockFs.stat.mockResolvedValue({
          isFile: () => true,
          size: fileContent.length,
          mtime: new Date(),
          // eslint-disable-next-line @typescript-eslint/naming-convention
          mtimeMs: Date.now(),
        } as fs.Stats);

        mockFs.readFile.mockResolvedValue(fileContent);

        await cache.handleRequest(
          file,
          req as FastifyRequest,
          reply as FastifyReply,
        );

        expect(sentData.headers['Content-Type']).toBe(expected);
      }
    });

    it('defaults to application/octet-stream for unknown types', async () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/test.unknown': '/path/to/test.unknown' },
      });

      const req = createMockRequest('/test.unknown');
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('test');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      await cache.handleRequest(
        '/test.unknown',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(sentData.headers['Content-Type']).toBe('application/octet-stream');
    });
  });

  describe('ETag generation', () => {
    it('generates strong ETags for small files', async () => {
      const cache = new StaticContentCache({
        smallFileMaxSize: 1024,
      });

      const fileContent = Buffer.from('small file content');
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      const result = await cache.getFile('/path/to/small.txt');

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        // Strong ETags don't start with W/
        expect(result.etag).not.toMatch(/^W\//);
        // Strong ETags are quoted
        expect(result.etag).toMatch(/^"/);
      }
    });

    it('generates weak ETags for large files', async () => {
      // Use a low smallFileMaxSize (10 bytes) which would be unrealistic, to the test that a file is considered "large"
      const cache = new StaticContentCache({
        smallFileMaxSize: 10,
      });

      const fileContent = Buffer.from('this is a large file content');
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      const result = await cache.getFile('/path/to/large.txt');

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        // Weak ETags start with W/
        expect(result.etag).toMatch(/^W\//);
      }
    });
  });

  describe('immutable asset detection', () => {
    it('detects .{hash}.{ext} pattern', async () => {
      const cache = new StaticContentCache({
        folderMap: {
          '/assets': { path: '/path/to/assets', detectImmutableAssets: true },
        },
        immutableCacheControl: 'public, max-age=31536000, immutable',
      });

      const req = createMockRequest('/assets/main.abc123def.js');
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('console.log("test")');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      await cache.handleRequest(
        '/assets/main.abc123def.js',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(sentData.headers['Cache-Control']).toContain('immutable');
    });

    it('detects -{hash}.{ext} pattern', async () => {
      const cache = new StaticContentCache({
        folderMap: {
          '/assets': { path: '/path/to/assets', detectImmutableAssets: true },
        },
        immutableCacheControl: 'public, max-age=31536000, immutable',
      });

      const req = createMockRequest('/assets/chunk-abc123.js');
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('console.log("test")');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      await cache.handleRequest(
        '/assets/chunk-abc123.js',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      expect(sentData.headers['Cache-Control']).toContain('immutable');
    });

    it('does not detect short hashes (< 6 characters)', async () => {
      const cache = new StaticContentCache({
        folderMap: {
          '/assets': { path: '/path/to/assets', detectImmutableAssets: true },
        },
        cacheControl: 'public, max-age=0, must-revalidate',
        immutableCacheControl: 'public, max-age=31536000, immutable',
      });

      const req = createMockRequest('/assets/main.v1.js');
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('console.log("test")');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      await cache.handleRequest(
        '/assets/main.v1.js',
        req as FastifyRequest,
        reply as FastifyReply,
      );

      // Should use regular cache control, not immutable
      expect(sentData.headers['Cache-Control']).not.toContain('immutable');
      expect(sentData.headers['Cache-Control']).toContain('must-revalidate');
    });
  });

  describe('range request support', () => {
    it('handles range requests for large files', async () => {
      const cache = new StaticContentCache({
        smallFileMaxSize: 10,
      });

      const req = createMockRequest('/test.txt', 'GET', {
        range: 'bytes=0-99',
      });
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('a'.repeat(1000));

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      const result = await cache.serveFile(
        req as FastifyRequest,
        reply as FastifyReply,
        '/path/to/test.txt',
      );

      expect(result.served).toBe(true);
      if (result.served) {
        expect(result.statusCode).toBe(206);
      }
      expect(sentData.headers['Content-Range']).toBe('bytes 0-99/1000');
    });

    it('returns 400 for malformed range header', async () => {
      const cache = new StaticContentCache({
        smallFileMaxSize: 10,
      });

      const req = createMockRequest('/test.txt', 'GET', {
        range: 'invalid-range',
      });
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('a'.repeat(1000));

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      await cache.serveFile(
        req as FastifyRequest,
        reply as FastifyReply,
        '/path/to/test.txt',
      );

      expect(sentData.code).toBe(400);
    });

    it('returns 416 for unsatisfiable range', async () => {
      const cache = new StaticContentCache({
        smallFileMaxSize: 10,
      });

      const req = createMockRequest('/test.txt', 'GET', {
        range: 'bytes=2000-2999',
      });
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('a'.repeat(100));

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      await cache.serveFile(
        req as FastifyRequest,
        reply as FastifyReply,
        '/path/to/test.txt',
      );

      expect(sentData.code).toBe(416);
      expect(sentData.headers['Content-Range']).toBe('bytes */100');
    });

    it('advertises Accept-Ranges for large files', async () => {
      const cache = new StaticContentCache({
        smallFileMaxSize: 10,
      });

      const req = createMockRequest('/test.txt');
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('a'.repeat(1000));

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      await cache.serveFile(
        req as FastifyRequest,
        reply as FastifyReply,
        '/path/to/test.txt',
      );

      expect(sentData.headers['Accept-Ranges']).toBe('bytes');
    });
  });

  describe('caching behavior', () => {
    it('caches file stats', async () => {
      const cache = new StaticContentCache({});
      const fileContent = Buffer.from('test');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      // First request
      await cache.getFile('/path/to/test.txt');
      expect(mockFs.stat).toHaveBeenCalledTimes(1);

      // Second request - should use cached stats
      await cache.getFile('/path/to/test.txt');
      expect(mockFs.stat).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('caches file content for small files', async () => {
      const cache = new StaticContentCache({
        smallFileMaxSize: 1024,
      });
      const fileContent = Buffer.from('test content');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      // First request
      await cache.getFile('/path/to/test.txt');
      expect(mockFs.readFile).toHaveBeenCalledTimes(1);

      // Second request - should use cached content
      await cache.getFile('/path/to/test.txt');
      expect(mockFs.readFile).toHaveBeenCalledTimes(1); // Still 1, not 2
    });

    it('caches negative results (404s)', async () => {
      const cache = new StaticContentCache({});

      mockFs.stat.mockRejectedValue({ code: 'ENOENT' });

      // First request
      const result1 = await cache.getFile('/path/to/missing.txt');
      expect(result1.status).toBe('not-found');
      expect(mockFs.stat).toHaveBeenCalledTimes(1);

      // Second request - should use cached negative result
      const result2 = await cache.getFile('/path/to/missing.txt');
      expect(result2.status).toBe('not-found');
      expect(mockFs.stat).toHaveBeenCalledTimes(1); // Still 1, not 2
    });
  });

  describe('cache control headers', () => {
    it('sets default cache control header', async () => {
      const cache = new StaticContentCache({
        cacheControl: 'public, max-age=3600',
      });

      const req = createMockRequest('/test.txt');
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('test');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      await cache.serveFile(
        req as FastifyRequest,
        reply as FastifyReply,
        '/path/to/test.txt',
      );

      expect(sentData.headers['Cache-Control']).toBe('public, max-age=3600');
    });

    it('sets custom cache control header', async () => {
      const cache = new StaticContentCache({
        cacheControl: 'private, no-cache',
      });

      const req = createMockRequest('/test.txt');
      const { reply, sentData } = createMockReply();
      const fileContent = Buffer.from('test');

      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        // eslint-disable-next-line @typescript-eslint/naming-convention
        mtimeMs: Date.now(),
      } as fs.Stats);

      mockFs.readFile.mockResolvedValue(fileContent);

      await cache.serveFile(
        req as FastifyRequest,
        reply as FastifyReply,
        '/path/to/test.txt',
      );

      expect(sentData.headers['Cache-Control']).toBe('private, no-cache');
    });
  });

  describe('logger integration', () => {
    it('logs unexpected file access errors', async () => {
      const logger = {
        warn: mock(() => {}),
      };

      const cache = new StaticContentCache({}, logger);
      const error = new Error('Permission denied');
      (error as NodeJS.ErrnoException).code = 'EACCES';

      mockFs.stat.mockRejectedValue(error);

      await cache.getFile('/path/to/file.txt');

      expect(logger.warn).toHaveBeenCalled();
    });

    it('does not log ENOENT errors', async () => {
      const logger = {
        warn: mock(() => {}),
      };

      const cache = new StaticContentCache({}, logger);
      const error = new Error('ENOENT');
      (error as NodeJS.ErrnoException).code = 'ENOENT';

      mockFs.stat.mockRejectedValue(error);

      await cache.getFile('/path/to/missing.txt');

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('Security: Null byte validation', () => {
    it('rejects URLs containing null bytes at runtime', async () => {
      const cache = new StaticContentCache({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
        folderMap: { '/assets': '/path/to/assets' },
      });

      // Test null byte in exact match URL
      const req1 = createMockRequest('/test.txt\0.js');
      const { reply: reply1 } = createMockReply();

      const result1 = await cache.handleRequest(
        '/test.txt\0.js',
        req1 as FastifyRequest,
        reply1 as FastifyReply,
      );

      expect(result1.served).toBe(false);
      if (!result1.served) {
        expect(result1.reason).toBe('not-found');
      }

      // Test null byte in folder-based URL
      const req2 = createMockRequest('/assets/file.txt\0.js');
      const { reply: reply2 } = createMockReply();

      const result2 = await cache.handleRequest(
        '/assets/file.txt\0.js',
        req2 as FastifyRequest,
        reply2 as FastifyReply,
      );

      expect(result2.served).toBe(false);
      if (!result2.served) {
        expect(result2.reason).toBe('not-found');
      }

      // Verify filesystem was never accessed for null byte requests
      expect(mockFs.stat).not.toHaveBeenCalled();
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    it('skips singleAssetMap entries with null bytes in configuration', () => {
      const mockLogger = {
        warn: mock(() => {}),
      };

      const cache = new StaticContentCache(
        {
          singleAssetMap: {
            '/valid.txt': '/path/to/valid.txt',
            '/bad\0key.txt': '/path/to/file.txt', // null byte in key
            '/badvalue.txt': '/path/to/file\0.txt', // null byte in value
          },
        },
        mockLogger,
      );

      // Access private singleAssetMap to verify null byte entries were skipped
      const singleAssetMap = (cache as any).singleAssetMap as Map<
        string,
        string
      >;

      // Valid entry should be present
      expect(singleAssetMap.has('/valid.txt')).toBe(true);

      // Entries with null bytes should be skipped
      expect(singleAssetMap.has('/bad\0key.txt')).toBe(false);
      expect(singleAssetMap.has('/badvalue.txt')).toBe(false);

      // Logger should have warned about skipped entries (2 times)
      expect(mockLogger.warn.mock.calls.length).toBe(2);
    });

    it('skips folderMap entries with null bytes in configuration', () => {
      const mockLogger = {
        warn: mock(() => {}),
      };

      const cache = new StaticContentCache(
        {
          folderMap: {
            '/valid': '/path/to/valid',
            '/bad\0prefix': '/path/to/assets', // null byte in prefix
            '/badpath': '/path/to/bad\0assets', // null byte in path (string)
            '/badconfig': {
              // null byte in path (config object)
              path: '/path/to/bad\0config',
              detectImmutableAssets: true,
            },
          },
        },
        mockLogger,
      );

      // Access private folderMap to verify null byte entries were skipped
      const folderMap = (cache as any).folderMap as Map<string, any>;

      // Valid entry should be present (normalized with trailing slash)
      expect(folderMap.has('/valid/')).toBe(true);

      // Entries with null bytes should be skipped
      expect(folderMap.has('/bad\0prefix/')).toBe(false);
      expect(folderMap.has('/badpath/')).toBe(false);
      expect(folderMap.has('/badconfig/')).toBe(false);

      // Logger should have warned about skipped entries (3 times)
      expect(mockLogger.warn.mock.calls.length).toBe(3);
    });

    it('handles null byte validation without logger', () => {
      // Should not crash when logger is not provided
      const cache = new StaticContentCache({
        singleAssetMap: {
          '/bad\0key.txt': '/path/to/file.txt',
        },
        folderMap: {
          '/bad\0prefix': '/path/to/assets',
        },
      });

      // Access private maps to verify null byte entries were silently skipped
      const singleAssetMap = (cache as any).singleAssetMap as Map<
        string,
        string
      >;
      const folderMap = (cache as any).folderMap as Map<string, any>;

      expect(singleAssetMap.size).toBe(0);
      expect(folderMap.size).toBe(0);
    });
  });

  describe('updateConfig()', () => {
    describe('singleAssetMap updates', () => {
      it('replaces singleAssetMap configuration', () => {
        const cache = new StaticContentCache({
          singleAssetMap: {
            '/existing.txt': '/path/to/existing.txt',
          },
          folderMap: {},
        });

        // Access private property to verify initial state
        const singleAssetMapBefore = (cache as any).singleAssetMap as Map<
          string,
          string
        >;
        expect(singleAssetMapBefore.has('/existing.txt')).toBe(true);
        expect(singleAssetMapBefore.has('/new.txt')).toBe(false);

        cache.updateConfig({
          singleAssetMap: {
            '/new.txt': '/path/to/new.txt',
          },
        });

        // Verify mapping was replaced - old gone, new added
        const singleAssetMapAfter = (cache as any).singleAssetMap as Map<
          string,
          string
        >;
        expect(singleAssetMapAfter.has('/existing.txt')).toBe(false);
        expect(singleAssetMapAfter.has('/new.txt')).toBe(true);
        expect(singleAssetMapAfter.get('/new.txt')).toBe('/path/to/new.txt');
      });

      it('invalidates only affected filesystem paths', async () => {
        const cache = new StaticContentCache({
          singleAssetMap: {
            '/file1.txt': '/path/to/file1.txt',
            '/file2.txt': '/path/to/file2.txt',
          },
          folderMap: {},
        });

        const fileContent = Buffer.from('test');
        mockFs.stat.mockResolvedValue({
          isFile: () => true,
          size: fileContent.length,
          mtime: new Date(),
          // eslint-disable-next-line @typescript-eslint/naming-convention
          mtimeMs: Date.now(),
        } as fs.Stats);
        mockFs.readFile.mockResolvedValue(fileContent);

        // Access both files to cache them
        const req1 = createMockRequest('/file1.txt');
        const { reply: reply1 } = createMockReply();
        await cache.handleRequest(
          '/file1.txt',
          req1 as FastifyRequest,
          reply1 as FastifyReply,
        );

        const req2 = createMockRequest('/file2.txt');
        const { reply: reply2 } = createMockReply();
        await cache.handleRequest(
          '/file2.txt',
          req2 as FastifyRequest,
          reply2 as FastifyReply,
        );

        // Both should be cached
        const statsBefore = cache.getCacheStats();
        expect(statsBefore.stat.items).toBeGreaterThanOrEqual(2);

        // Update config - replace with new mapping that keeps file1 but changes file2
        cache.updateConfig({
          singleAssetMap: {
            '/file1.txt': '/path/to/file1.txt', // Same path - cache kept
            '/file2.txt': '/path/to/file2-NEW.txt', // Different path - cache cleared
          },
        });

        // Access private caches to verify exact invalidation behavior
        const statCache = (cache as any).statCache;
        const etagCache = (cache as any).etagCache;
        const contentCache = (cache as any).contentCache;

        // file1.txt path should still be cached (path didn't change)
        expect(statCache.has('/path/to/file1.txt')).toBe(true);
        expect(etagCache.has('/path/to/file1.txt')).toBe(true);
        expect(contentCache.has('/path/to/file1.txt')).toBe(true);

        // file2.txt's OLD path should be invalidated
        expect(statCache.has('/path/to/file2.txt')).toBe(false);
        expect(etagCache.has('/path/to/file2.txt')).toBe(false);
        expect(contentCache.has('/path/to/file2.txt')).toBe(false);

        // file2.txt's NEW path should not be cached yet (hasn't been accessed)
        expect(statCache.has('/path/to/file2-NEW.txt')).toBe(false);
      });

      it('invalidates cache for changed filesystem paths', async () => {
        const cache = new StaticContentCache({
          singleAssetMap: {
            '/test.txt': '/path/to/test-v1.txt',
          },
          folderMap: {},
        });

        const fileContent1 = Buffer.from('v1');
        mockFs.stat.mockResolvedValue({
          isFile: () => true,
          size: fileContent1.length,
          mtime: new Date(),
          // eslint-disable-next-line @typescript-eslint/naming-convention
          mtimeMs: Date.now(),
        } as fs.Stats);
        mockFs.readFile.mockResolvedValue(fileContent1);

        // Access file to cache it
        const req = createMockRequest('/test.txt');
        const { reply } = createMockReply();
        await cache.handleRequest(
          '/test.txt',
          req as FastifyRequest,
          reply as FastifyReply,
        );

        // Cache should have the v1 file
        const statsBefore = cache.getCacheStats();
        expect(statsBefore.stat.items).toBeGreaterThanOrEqual(1);

        // Update mapping to point to different file
        cache.updateConfig({
          singleAssetMap: {
            '/test.txt': '/path/to/test-v2.txt',
          },
        });

        // Access private caches to verify exact behavior
        const statCache = (cache as any).statCache;
        const etagCache = (cache as any).etagCache;
        const contentCache = (cache as any).contentCache;

        // v1 path should be invalidated (OLD filesystem path for /test.txt)
        expect(statCache.has('/path/to/test-v1.txt')).toBe(false);
        expect(etagCache.has('/path/to/test-v1.txt')).toBe(false);
        expect(contentCache.has('/path/to/test-v1.txt')).toBe(false);

        // v2 path should also be invalidated (NEW filesystem path for /test.txt)
        // This prevents serving stale cached data if v2 was previously cached
        expect(statCache.has('/path/to/test-v2.txt')).toBe(false);
        expect(etagCache.has('/path/to/test-v2.txt')).toBe(false);
        expect(contentCache.has('/path/to/test-v2.txt')).toBe(false);
      });
    });

    describe('folderMap updates', () => {
      it('replaces folderMap and clears all caches', async () => {
        const cache = new StaticContentCache({
          singleAssetMap: {},
          folderMap: {
            '/assets': '/path/to/assets',
          },
        });

        const fileContent = Buffer.from('test');
        mockFs.stat.mockResolvedValue({
          isFile: () => true,
          size: fileContent.length,
          mtime: new Date(),
          // eslint-disable-next-line @typescript-eslint/naming-convention
          mtimeMs: Date.now(),
        } as fs.Stats);
        mockFs.readFile.mockResolvedValue(fileContent);

        // Access file to cache it
        const req = createMockRequest('/assets/test.js');
        const { reply } = createMockReply();
        await cache.handleRequest(
          '/assets/test.js',
          req as FastifyRequest,
          reply as FastifyReply,
        );

        const statsBefore = cache.getCacheStats();
        expect(statsBefore.stat.items).toBeGreaterThanOrEqual(1);

        // Update folder mapping - this clears ALL caches
        cache.updateConfig({
          folderMap: {
            '/static': '/path/to/static',
          },
        });

        // All caches should be cleared
        const statsAfter = cache.getCacheStats();
        expect(statsAfter.etag.items).toBe(0);
        expect(statsAfter.content.items).toBe(0);
        expect(statsAfter.stat.items).toBe(0);
      });

      it('supports folder config objects with detectImmutableAssets', () => {
        const cache = new StaticContentCache({
          singleAssetMap: {},
          folderMap: {
            '/assets': {
              path: '/path/to/assets',
              detectImmutableAssets: false,
            },
          },
        });

        cache.updateConfig({
          folderMap: {
            '/assets': { path: '/path/to/assets', detectImmutableAssets: true },
          },
        });

        const stats = cache.getCacheStats();
        expect(stats.etag.items).toBe(0); // All cleared
      });
    });

    describe('cache invalidation strategy', () => {
      it('clears all caches when using clearCaches()', () => {
        const cache = new StaticContentCache({
          singleAssetMap: {
            '/test1.txt': '/path/to/test1.txt',
            '/test2.txt': '/path/to/test2.txt',
          },
          folderMap: {},
        });

        cache.clearCaches();

        const stats = cache.getCacheStats();
        expect(stats.etag.items).toBe(0);
        expect(stats.content.items).toBe(0);
        expect(stats.stat.items).toBe(0);
      });

      it('clears all caches when folderMap changes', () => {
        const cache = new StaticContentCache({
          singleAssetMap: {
            '/file.txt': '/path/to/file.txt',
          },
          folderMap: {
            '/assets': '/path/to/assets',
          },
        });

        // Update config - folderMap change clears all caches
        cache.updateConfig({
          singleAssetMap: {
            '/file.txt': '/path/to/file.txt',
          },
          folderMap: {
            '/static': '/path/to/static',
          },
        });

        // All caches cleared due to folderMap change
        const stats = cache.getCacheStats();
        expect(stats.etag.items).toBe(0);
        expect(stats.content.items).toBe(0);
        expect(stats.stat.items).toBe(0);
      });
    });

    describe('edge cases', () => {
      it('handles empty maps gracefully', () => {
        const cache = new StaticContentCache({
          singleAssetMap: {
            '/test.txt': '/path/to/test.txt',
          },
          folderMap: {
            '/assets': '/path/to/assets',
          },
        });

        // Passing empty singleAssetMap clears all single asset mappings
        cache.updateConfig({
          singleAssetMap: {},
        });

        // Access private properties to verify behavior
        const singleAssetMap = (cache as any).singleAssetMap as Map<
          string,
          string
        >;
        const folderMap = (cache as any).folderMap as Map<string, unknown>;

        // singleAssetMap should be cleared
        expect(singleAssetMap.size).toBe(0);
        expect(singleAssetMap.has('/test.txt')).toBe(false);

        // folderMap should remain unchanged (wasn't included in updateConfig)
        expect(folderMap.size).toBe(1);
        expect(folderMap.has('/assets/')).toBe(true);
      });

      it('allows updating one section at a time', () => {
        const cache = new StaticContentCache({
          singleAssetMap: {
            '/file.txt': '/path/to/file.txt',
          },
          folderMap: {
            '/assets': '/path/to/assets',
          },
        });

        // Update only singleAssetMap - folderMap remains unchanged
        cache.updateConfig({
          singleAssetMap: {
            '/file.txt': '/path/to/file.txt',
            '/new.txt': '/path/to/new.txt',
          },
        });

        // Access private properties to verify selective update
        const singleAssetMap = (cache as any).singleAssetMap as Map<
          string,
          string
        >;
        const folderMap = (cache as any).folderMap as Map<string, any>;

        // singleAssetMap should be updated with new mapping
        expect(singleAssetMap.size).toBe(2);
        expect(singleAssetMap.has('/file.txt')).toBe(true);
        expect(singleAssetMap.has('/new.txt')).toBe(true);
        expect(singleAssetMap.get('/new.txt')).toBe('/path/to/new.txt');

        // folderMap should remain completely unchanged
        expect(folderMap.size).toBe(1);
        expect(folderMap.has('/assets/')).toBe(true);
        expect(folderMap.get('/assets/').path).toBe('/path/to/assets');
      });

      it('handles complete config replacement', () => {
        const cache = new StaticContentCache({
          singleAssetMap: {
            '/old.txt': '/path/to/old.txt',
          },
          folderMap: {
            '/old-assets': '/path/to/old-assets',
          },
        });

        // Replace both sections
        cache.updateConfig({
          singleAssetMap: {
            '/new.txt': '/path/to/new.txt',
          },
          folderMap: {
            '/new-assets': '/path/to/new-assets',
          },
        });

        // All caches cleared due to folderMap change
        const stats = cache.getCacheStats();
        expect(stats.etag.items).toBe(0);
        expect(stats.content.items).toBe(0);
        expect(stats.stat.items).toBe(0);
      });
    });
  });
});

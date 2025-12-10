import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { createStaticContentHook } from './static-content-hook';
import type { FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import path from 'path';
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
      return reply as FastifyReply;
    }),
  };

  return { reply, sentData };
};

describe('createStaticContentHook', () => {
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

  describe('hook creation', () => {
    it('creates a hook function', () => {
      const hook = createStaticContentHook({
        singleAssetMap: {},
        folderMap: {},
      });

      expect(typeof hook).toBe('function');
    });

    it('creates independent instances with separate caches', () => {
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
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(reply.send).not.toHaveBeenCalled();
    });

    it('ignores requests without URL', async () => {
      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = { method: 'GET', raw: {} } as FastifyRequest;
      const { reply } = createMockReply();

      await hook(req, reply as FastifyReply);

      expect(reply.send).not.toHaveBeenCalled();
    });

    it('falls through for unmapped URLs', async () => {
      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/other.txt');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(reply.send).not.toHaveBeenCalled();
    });
  });

  describe('singleAssetMap', () => {
    it('serves exact URL matches', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('file content'));

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/test.txt');
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(mockFs.stat).toHaveBeenCalledWith('/path/to/test.txt');
      expect(reply.send).toHaveBeenCalled();
      expect(sentData.body).toEqual(Buffer.from('file content'));
    });

    it('normalizes URLs without leading slash', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        singleAssetMap: { 'test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/test.txt');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(mockFs.stat).toHaveBeenCalledWith('/path/to/test.txt');
    });

    it('strips query strings from URLs', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/test.txt?v=123');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(mockFs.stat).toHaveBeenCalledWith('/path/to/test.txt');
    });
  });

  describe('folderMap', () => {
    it('serves files under configured prefix', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        folderMap: { '/static': '/path/to/static' },
      });

      const req = createMockRequest('/static/file.txt');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(mockFs.stat).toHaveBeenCalledWith(
        path.join('/path/to/static', 'file.txt'),
      );
    });

    it('prevents directory traversal with ../', async () => {
      const hook = createStaticContentHook({
        folderMap: { '/static': '/path/to/static' },
      });

      const req = createMockRequest('/static/../../../etc/passwd');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(mockFs.stat).not.toHaveBeenCalled();
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('prevents directory traversal with ..\\', async () => {
      const hook = createStaticContentHook({
        folderMap: { '/static': '/path/to/static' },
      });

      const req = createMockRequest('/static/..\\..\\etc\\passwd');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(mockFs.stat).not.toHaveBeenCalled();
    });

    it('normalizes folder prefix to have trailing slash', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        folderMap: { static: '/path/to/static' },
      });

      const req = createMockRequest('/static/file.txt');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(mockFs.stat).toHaveBeenCalled();
    });

    it('supports folder config object with detectImmutableAssets', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        folderMap: {
          '/assets': { path: '/path/to/assets', detectImmutableAssets: true },
        },
      });

      const req = createMockRequest('/assets/main.abc123.js');
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.headers['Cache-Control']).toBe(
        'public, max-age=31536000, immutable',
      );
    });
  });

  describe('file serving', () => {
    it('returns 404 for non-existent files', async () => {
      const error = new Error('ENOENT');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      mockFs.stat.mockRejectedValue(error);

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/test.txt');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(reply.send).not.toHaveBeenCalled();
    });

    it('does not serve directories', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => false,
        size: 0,
        mtime: new Date(),
        mtimeMs: Date.now(),
      } as fs.Stats);

      const hook = createStaticContentHook({
        singleAssetMap: { '/test': '/path/to/test' },
      });

      const req = createMockRequest('/test');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(reply.send).not.toHaveBeenCalled();
    });

    it('sets correct MIME types', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        singleAssetMap: {
          '/test.js': '/path/to/test.js',
          '/test.css': '/path/to/test.css',
          '/test.json': '/path/to/test.json',
          '/test.html': '/path/to/test.html',
        },
      });

      // Test JS
      let req = createMockRequest('/test.js');
      let { reply, sentData } = createMockReply();
      await hook(req as FastifyRequest, reply as FastifyReply);
      expect(sentData.headers['Content-Type']).toBe('application/javascript');

      // Test CSS
      req = createMockRequest('/test.css');
      ({ reply, sentData } = createMockReply());
      await hook(req as FastifyRequest, reply as FastifyReply);
      expect(sentData.headers['Content-Type']).toBe('text/css');

      // Test JSON
      req = createMockRequest('/test.json');
      ({ reply, sentData } = createMockReply());
      await hook(req as FastifyRequest, reply as FastifyReply);
      expect(sentData.headers['Content-Type']).toBe('application/json');
    });

    it('defaults to application/octet-stream for unknown types', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.xyz': '/path/to/test.xyz' },
      });

      const req = createMockRequest('/test.xyz');
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.headers['Content-Type']).toBe('application/octet-stream');
    });
  });

  describe('ETag support', () => {
    it('generates strong ETags for small files', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
        smallFileMaxSize: 1024,
      });

      const req = createMockRequest('/test.txt');
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.headers['ETag']).toBeDefined();
      expect(sentData.headers['ETag']).toMatch(/^"[A-Za-z0-9+/=]+"$/);
    });

    it('generates weak ETags for large files', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 10 * 1024 * 1024, // 10MB
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);

      const hook = createStaticContentHook({
        singleAssetMap: { '/large.bin': '/path/to/large.bin' },
        smallFileMaxSize: 1024,
      });

      const req = createMockRequest('/large.bin');
      const { reply, sentData } = createMockReply();
      mockFs.createReadStream.mockReturnValue(new Readable());

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.headers['ETag']).toBeDefined();
      expect(sentData.headers['ETag']).toMatch(/^W\//);
    });

    it('returns 304 when If-None-Match matches ETag', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      // First request to get ETag
      const req1 = createMockRequest('/test.txt');
      const { reply: reply1, sentData: sentData1 } = createMockReply();
      await hook(req1 as FastifyRequest, reply1 as FastifyReply);
      const etag = sentData1.headers['ETag'];

      // Second request with If-None-Match
      const req2 = createMockRequest('/test.txt', 'GET', {
        'if-none-match': etag,
      });
      const { reply: reply2, sentData: sentData2 } = createMockReply();
      await hook(req2 as FastifyRequest, reply2 as FastifyReply);

      expect(sentData2.code).toBe(304);
      expect(sentData2.body).toBeUndefined();
    });
  });

  describe('cache control headers', () => {
    it('sets default cache control header', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      const req = createMockRequest('/test.txt');
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.headers['Cache-Control']).toBe(
        'public, max-age=0, must-revalidate',
      );
    });

    it('sets custom cache control header', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
        cacheControl: 'public, max-age=3600',
      });

      const req = createMockRequest('/test.txt');
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.headers['Cache-Control']).toBe('public, max-age=3600');
    });
  });

  describe('immutable asset detection', () => {
    it('detects .{hash}.{ext} pattern', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        folderMap: {
          '/assets': { path: '/path/to/assets', detectImmutableAssets: true },
        },
      });

      const req = createMockRequest('/assets/main.abc123def.js');
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.headers['Cache-Control']).toBe(
        'public, max-age=31536000, immutable',
      );
    });

    it('detects -{hash}.{ext} pattern', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        folderMap: {
          '/assets': { path: '/path/to/assets', detectImmutableAssets: true },
        },
      });

      const req = createMockRequest('/assets/chunk-abc123.js');
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.headers['Cache-Control']).toBe(
        'public, max-age=31536000, immutable',
      );
    });

    it('does not detect short hashes', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        folderMap: {
          '/assets': { path: '/path/to/assets', detectImmutableAssets: true },
        },
      });

      const req = createMockRequest('/assets/main.v1.js');
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.headers['Cache-Control']).toBe(
        'public, max-age=0, must-revalidate',
      );
    });
  });

  describe('range request support', () => {
    it('handles range requests for large files', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 10000,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);

      const mockStream = new Readable();
      mockFs.createReadStream.mockReturnValue(mockStream);

      const hook = createStaticContentHook({
        singleAssetMap: { '/video.mp4': '/path/to/video.mp4' },
        smallFileMaxSize: 1024,
      });

      const req = createMockRequest('/video.mp4', 'GET', {
        range: 'bytes=0-999',
      });
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.code).toBe(206);
      expect(sentData.headers['Content-Range']).toBe('bytes 0-999/10000');
      expect(sentData.headers['Content-Length']).toBe('1000');
      expect(mockFs.createReadStream).toHaveBeenCalledWith(
        '/path/to/video.mp4',
        { start: 0, end: 999 },
      );
    });

    it('returns 400 for malformed range header', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 10000,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);

      const hook = createStaticContentHook({
        singleAssetMap: { '/video.mp4': '/path/to/video.mp4' },
        smallFileMaxSize: 1024,
      });

      const req = createMockRequest('/video.mp4', 'GET', {
        range: 'invalid',
      });
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.code).toBe(400);
    });

    it('returns 416 for unsatisfiable range', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 1000,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);

      const hook = createStaticContentHook({
        singleAssetMap: { '/video.mp4': '/path/to/video.mp4' },
        smallFileMaxSize: 100,
      });

      const req = createMockRequest('/video.mp4', 'GET', {
        range: 'bytes=2000-3000',
      });
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.code).toBe(416);
      expect(sentData.headers['Content-Range']).toBe('bytes */1000');
    });

    it('advertises Accept-Ranges for large files', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 10000,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);

      const mockStream = new Readable();
      mockFs.createReadStream.mockReturnValue(mockStream);

      const hook = createStaticContentHook({
        singleAssetMap: { '/video.mp4': '/path/to/video.mp4' },
        smallFileMaxSize: 1024,
      });

      const req = createMockRequest('/video.mp4');
      const { reply, sentData } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(sentData.headers['Accept-Ranges']).toBe('bytes');
    });
  });

  describe('caching behavior', () => {
    it('caches file stats', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      // First request
      const req1 = createMockRequest('/test.txt');
      const { reply: reply1 } = createMockReply();
      await hook(req1 as FastifyRequest, reply1 as FastifyReply);

      // Second request
      const req2 = createMockRequest('/test.txt');
      const { reply: reply2 } = createMockReply();
      await hook(req2 as FastifyRequest, reply2 as FastifyReply);

      // Should only call stat once (cached on second call)
      expect(mockFs.stat).toHaveBeenCalledTimes(1);
    });

    it('caches file content for small files', async () => {
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: 100,
        mtime: new Date('2024-01-01'),
        mtimeMs: Date.parse('2024-01-01'),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(Buffer.from('content'));

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
        smallFileMaxSize: 1024,
      });

      // First request
      const req1 = createMockRequest('/test.txt');
      const { reply: reply1 } = createMockReply();
      await hook(req1 as FastifyRequest, reply1 as FastifyReply);

      // Second request
      const req2 = createMockRequest('/test.txt');
      const { reply: reply2 } = createMockReply();
      await hook(req2 as FastifyRequest, reply2 as FastifyReply);

      // Should only read file once
      expect(mockFs.readFile).toHaveBeenCalledTimes(1);
    });

    it('caches negative results (404s)', async () => {
      const error = new Error('ENOENT');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      mockFs.stat.mockRejectedValue(error);

      const hook = createStaticContentHook({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      // First request
      const req1 = createMockRequest('/test.txt');
      const { reply: reply1 } = createMockReply();
      await hook(req1 as FastifyRequest, reply1 as FastifyReply);

      // Second request
      const req2 = createMockRequest('/test.txt');
      const { reply: reply2 } = createMockReply();
      await hook(req2 as FastifyRequest, reply2 as FastifyReply);

      // Should only call stat once (cached 404)
      expect(mockFs.stat).toHaveBeenCalledTimes(1);
    });
  });

  describe('non-existent configured paths', () => {
    it('treats singleAssetMap pointing to non-existent file as 404', async () => {
      const error = new Error('ENOENT');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      mockFs.stat.mockRejectedValue(error);

      const hook = createStaticContentHook({
        // Config points to a file that doesn't exist on disk
        singleAssetMap: { '/favicon.ico': '/non/existent/path/favicon.ico' },
      });

      const req = createMockRequest('/favicon.ico');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      // Should fall through (no response sent) - Fastify will handle as 404
      expect(reply.send).not.toHaveBeenCalled();
      expect(mockFs.stat).toHaveBeenCalledWith(
        '/non/existent/path/favicon.ico',
      );
    });

    it('treats folderMap pointing to non-existent directory as 404', async () => {
      const error = new Error('ENOENT');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      mockFs.stat.mockRejectedValue(error);

      const hook = createStaticContentHook({
        // Config points to a directory that doesn't exist on disk
        folderMap: { '/assets': '/non/existent/assets/directory' },
      });

      const req = createMockRequest('/assets/main.js');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      // Should fall through (no response sent) - Fastify will handle as 404
      expect(reply.send).not.toHaveBeenCalled();
      expect(mockFs.stat).toHaveBeenCalledWith(
        path.join('/non/existent/assets/directory', 'main.js'),
      );
    });
  });

  describe('logger integration', () => {
    it('logs unexpected file access errors', async () => {
      const error = new Error('Permission denied');
      (error as NodeJS.ErrnoException).code = 'EACCES';
      mockFs.stat.mockRejectedValue(error);

      const mockLogger = { warn: mock(() => {}) };

      const hook = createStaticContentHook(
        {
          singleAssetMap: { '/test.txt': '/path/to/test.txt' },
        },
        mockLogger,
      );

      const req = createMockRequest('/test.txt');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        {
          err: error,
          path: '/path/to/test.txt',
        },
        'Unexpected error accessing static file',
      );
    });

    it('does not log ENOENT errors', async () => {
      const error = new Error('ENOENT');
      (error as NodeJS.ErrnoException).code = 'ENOENT';
      mockFs.stat.mockRejectedValue(error);

      const mockLogger = { warn: mock(() => {}) };

      const hook = createStaticContentHook(
        {
          singleAssetMap: { '/test.txt': '/path/to/test.txt' },
        },
        mockLogger,
      );

      const req = createMockRequest('/test.txt');
      const { reply } = createMockReply();

      await hook(req as FastifyRequest, reply as FastifyReply);

      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { staticContent, StaticContentCache } from './static-content';
import type { StaticContentRouterOptions } from './static-content';
import type { PluginHostInstance, PluginOptions } from '../types';
import type { FastifyRequest, FastifyReply } from 'fastify';
import fs from 'fs';
import { Readable } from 'stream';

interface MockPluginHost extends PluginHostInstance {
  _hooks?: Array<{ name: string; handler: unknown }>;
  _decorations?: Record<string, unknown>;
}

const createMockPluginHost = (): MockPluginHost => {
  const host: Partial<MockPluginHost> = {};

  host.register = mock(() => Promise.resolve());
  host.decorate = mock((property: string, value: unknown) => {
    const decorations =
      (host as MockPluginHost)._decorations ||
      (Object.create(null) as Record<string, unknown>);
    decorations[property] = value;
    (host as MockPluginHost)._decorations = decorations;
  });

  host.addHook = mock((name: string, handler: unknown) => {
    const hooks = (host as MockPluginHost)._hooks || [];
    hooks.push({ name, handler });
    (host as MockPluginHost)._hooks = hooks;
  });

  host.getDecoration = (<T = unknown>(property: string): T | undefined => {
    const decorations = (host as MockPluginHost)._decorations;
    return decorations?.[property] as T | undefined;
  }) as typeof host.getDecoration;

  host.hasDecoration = mock((property: string) => {
    const decorations = (host as MockPluginHost)._decorations;
    return decorations ? property in decorations : false;
  });

  host.decorateRequest = mock(() => {});
  host.decorateReply = mock(() => {});
  host.route = mock(() => {});
  host.get = mock(() => {});
  host.post = mock(() => {});
  host.put = mock(() => {});
  host.delete = mock(() => {});
  host.patch = mock(() => {});

  return host as MockPluginHost;
};

const createMockOptions = (
  overrides: Partial<PluginOptions> = {},
): PluginOptions => ({
  serverType: 'ssr',
  mode: 'production',
  isDevelopment: false,
  apiEndpoints: { apiEndpointPrefix: '/api' },
  ...overrides,
});

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
      // Default to 200 if no code was explicitly set
      if (sentData.code === undefined) {
        sentData.code = 200;
      }
      (reply as FastifyReply).sent = true;
      return reply as unknown as FastifyReply;
    }),
  };

  return { reply, sentData };
};

/**
 * Helper to invoke the registered onRequest hook(s) with a mock request
 * If multiple hooks are registered, invokes them in order until one serves the file
 * Returns the reply data so we can assert on what was sent
 */
const invokeRegisteredHook = async (
  host: MockPluginHost,
  url: string,
  method: string = 'GET',
  headers: Record<string, string> = {},
): Promise<{
  code?: number;
  headers: Record<string, string>;
  body?: unknown;
  sent: boolean;
}> => {
  const hooks = host._hooks || [];
  const onRequestHooks = hooks.filter((h) => h.name === 'onRequest');

  if (onRequestHooks.length === 0) {
    throw new Error('No onRequest hook registered');
  }

  const req = createMockRequest(url, method, headers);
  const { reply, sentData } = createMockReply();

  // Invoke all onRequest hooks in order (mimics Fastify behavior)
  for (const hook of onRequestHooks) {
    if (typeof hook.handler === 'function') {
      await (hook.handler as (req: unknown, reply: unknown) => Promise<void>)(
        req,
        reply,
      );

      // If reply was sent, stop processing (first hook that served wins)
      if (reply.sent) {
        break;
      }
    }
  }

  return {
    ...sentData,
    sent: reply.sent || false,
  };
};

// Mock fs operations for file serving
const mockFs = {
  stat: mock((_path: string) => Promise.resolve({} as fs.Stats)),
  readFile: mock((_path: string) => Promise.resolve(Buffer.from(''))),
  createReadStream: mock((_path: string, _options?: unknown) => new Readable()),
};

describe('staticContent plugin', () => {
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
  it('registers onRequest hook and returns unique metadata', async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();
    const config: StaticContentRouterOptions = {
      folderMap: { '/static': './static' },
    };

    const plugin = staticContent(config);
    const meta = await plugin(host, options);

    // Should return metadata with unique name
    expect(meta).toBeDefined();
    expect(meta?.name).toBeDefined();
    expect(meta?.name).toMatch(/^static-content-\d+-[a-z0-9]+$/);

    // Should register onRequest hook
    expect(host.addHook).toHaveBeenCalledTimes(1);
    const hooks = host._hooks;
    expect(hooks).toBeDefined();
    expect(hooks?.[0].name).toBe('onRequest');
    expect(typeof hooks?.[0].handler).toBe('function');
  });

  it('retrieves logger from plugin host when available', async () => {
    const host = createMockPluginHost();
    const mockLogger = { warn: mock(() => {}) };

    host.getDecoration = mock((property: string) => {
      if (property === 'log') {
        return mockLogger;
      }
      return undefined;
    }) as typeof host.getDecoration;

    const options = createMockOptions();
    const config: StaticContentRouterOptions = {
      folderMap: { '/static': './static' },
    };

    const plugin = staticContent(config);
    await plugin(host, options);

    expect(host.getDecoration).toHaveBeenCalledWith('log');
  });

  it('works when logger is not available', async () => {
    const host = createMockPluginHost();
    host.getDecoration = mock(() => undefined) as typeof host.getDecoration;

    const options = createMockOptions();
    const config: StaticContentRouterOptions = {
      folderMap: { '/static': './static' },
    };

    const plugin = staticContent(config);
    await plugin(host, options);

    expect(host.addHook).toHaveBeenCalledTimes(1);
  });

  it('creates independent instances with unique IDs', async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();

    const plugin1 = staticContent({ folderMap: { '/uploads': './uploads' } });
    const meta1 = await plugin1(host, options);

    const plugin2 = staticContent({ folderMap: { '/static': './static' } });
    const meta2 = await plugin2(host, options);

    // Each instance should have unique name
    expect(meta1?.name).not.toBe(meta2?.name);

    // Should register two separate hooks
    expect(host.addHook).toHaveBeenCalledTimes(2);
  });

  it('supports custom plugin names', async () => {
    const host = createMockPluginHost();
    const options = createMockOptions();

    const plugin = staticContent(
      { folderMap: { '/uploads': './uploads' } },
      'uploads-handler',
    );
    const meta = await plugin(host, options);

    expect(meta?.name).toBe('uploads-handler');
  });

  it('validates custom names are non-empty strings', () => {
    expect(() =>
      staticContent({ folderMap: { '/static': './static' } }, ''),
    ).toThrow(
      'staticContent plugin name must be a non-empty string if provided',
    );

    expect(() =>
      staticContent({ folderMap: { '/static': './static' } }, '   '),
    ).toThrow(
      'staticContent plugin name must be a non-empty string if provided',
    );
  });

  describe('external cache support', () => {
    it('accepts a StaticContentCache instance and serves files through it', async () => {
      const host = createMockPluginHost();
      const options = createMockOptions();

      // Create external cache
      const cache = new StaticContentCache({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
      });

      // Mock file system for the file in the cache
      const fileContent = Buffer.from('test file content');
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(fileContent);

      // Pass cache instance to plugin
      const plugin = staticContent(cache, 'custom-cache');
      const meta = await plugin(host, options);

      // Should return metadata with name
      expect(meta).toBeDefined();
      expect(meta?.name).toBe('custom-cache');

      // Should register onRequest hook
      expect(host.addHook).toHaveBeenCalledTimes(1);

      // Verify the hook actually serves the file from the cache
      const result = await invokeRegisteredHook(host, '/test.txt');
      expect(result.sent).toBe(true);
      expect(result.code).toBe(200);
      expect(result.headers['Content-Type']).toBe('text/plain');
      expect(result.body).toBe(fileContent);
    });

    it('returns metadata for config-based creation', async () => {
      const host = createMockPluginHost();
      const options = createMockOptions();

      const plugin = staticContent({
        folderMap: { '/static': './static' },
      });

      const meta = await plugin(host, options);

      // Should return metadata with generated name
      expect(meta).toBeDefined();
      expect(meta?.name).toMatch(/^static-content-\d+-[a-z0-9]+$/);
    });

    it('allows cache updates when external cache is used', async () => {
      const host = createMockPluginHost();
      const options = createMockOptions();

      // Mock file system
      const fileContent1 = Buffer.from('file 1 content');
      const fileContent2 = Buffer.from('file 2 content');

      mockFs.stat.mockImplementation((path: string) => {
        if (path === '/path/to/file1.txt' || path === '/path/to/file2.txt') {
          return Promise.resolve({
            isFile: () => true,
            size: path.includes('file1')
              ? fileContent1.length
              : fileContent2.length,
            mtime: new Date(),
            mtimeMs: Date.now(),
          } as fs.Stats);
        } else {
          const error = new Error('ENOENT');
          (error as NodeJS.ErrnoException).code = 'ENOENT';
          return Promise.reject(error);
        }
      });

      mockFs.readFile.mockImplementation((path: string) => {
        if (path === '/path/to/file1.txt') {
          return Promise.resolve(fileContent1);
        } else if (path === '/path/to/file2.txt') {
          return Promise.resolve(fileContent2);
        } else {
          const error = new Error('ENOENT');
          (error as NodeJS.ErrnoException).code = 'ENOENT';
          return Promise.reject(error);
        }
      });

      // Create external cache with file1
      const cache = new StaticContentCache({
        singleAssetMap: { '/file1.txt': '/path/to/file1.txt' },
        folderMap: {},
      });

      // Register plugin with external cache
      const plugin = staticContent(cache);
      await plugin(host, options);

      // Verify file1 is served
      const result1 = await invokeRegisteredHook(host, '/file1.txt');
      expect(result1.sent).toBe(true);
      expect(result1.code).toBe(200);
      expect(result1.body).toBe(fileContent1);

      // Verify file2 is not found yet
      const result2Before = await invokeRegisteredHook(host, '/file2.txt');
      expect(result2Before.sent).toBe(false);

      // Update the cache to replace file1 with file2
      cache.updateConfig({
        singleAssetMap: {
          '/file2.txt': '/path/to/file2.txt',
        },
      });

      // Now file1 should not be found
      const result1After = await invokeRegisteredHook(host, '/file1.txt');
      expect(result1After.sent).toBe(false);

      // And file2 should be served
      const result2After = await invokeRegisteredHook(host, '/file2.txt');
      expect(result2After.sent).toBe(true);
      expect(result2After.code).toBe(200);
      expect(result2After.body).toBe(fileContent2);
    });

    it('creates hooks for both config and cache-based plugins', async () => {
      const host = createMockPluginHost();
      const options = createMockOptions();

      // Mock file system for both files
      const fileContent1 = Buffer.from('file 1 content');
      const fileContent2 = Buffer.from('file 2 content');

      mockFs.stat.mockImplementation((path: string) => {
        if (path === '/path/to/file1.txt' || path === '/path/to/file2.txt') {
          return Promise.resolve({
            isFile: () => true,
            size: path.includes('file1')
              ? fileContent1.length
              : fileContent2.length,
            mtime: new Date(),
            mtimeMs: Date.now(),
          } as fs.Stats);
        } else {
          const error = new Error('ENOENT');
          (error as NodeJS.ErrnoException).code = 'ENOENT';
          return Promise.reject(error);
        }
      });

      mockFs.readFile.mockImplementation((path: string) => {
        if (path === '/path/to/file1.txt') {
          return Promise.resolve(fileContent1);
        } else if (path === '/path/to/file2.txt') {
          return Promise.resolve(fileContent2);
        } else {
          const error = new Error('ENOENT');
          (error as NodeJS.ErrnoException).code = 'ENOENT';
          return Promise.reject(error);
        }
      });

      // Config-based plugin
      const plugin1 = staticContent({
        singleAssetMap: { '/file1.txt': '/path/to/file1.txt' },
      });

      // Cache-based plugin
      const cache = new StaticContentCache({
        singleAssetMap: { '/file2.txt': '/path/to/file2.txt' },
      });
      const plugin2 = staticContent(cache);

      await plugin1(host, options);
      await plugin2(host, options);

      // Both should register hooks
      expect(host.addHook).toHaveBeenCalledTimes(2);

      // Verify both hooks work (they're called in order)
      // Note: Both hooks will be invoked, but only the matching one will serve the file
      const result1 = await invokeRegisteredHook(host, '/file1.txt');
      expect(result1.sent).toBe(true);
      expect(result1.body).toBe(fileContent1);

      const result2 = await invokeRegisteredHook(host, '/file2.txt');
      expect(result2.sent).toBe(true);
      expect(result2.body).toBe(fileContent2);
    });

    it('works with external cache and uses cache logger not host logger', async () => {
      const host = createMockPluginHost();
      const mockHostLogger = { warn: mock(() => {}) };

      host.getDecoration = mock((property: string) => {
        if (property === 'log') {
          return mockHostLogger;
        }

        return undefined;
      }) as typeof host.getDecoration;

      const options = createMockOptions();

      // Mock file system
      const fileContent = Buffer.from('test content');
      mockFs.stat.mockResolvedValue({
        isFile: () => true,
        size: fileContent.length,
        mtime: new Date(),
        mtimeMs: Date.now(),
      } as fs.Stats);
      mockFs.readFile.mockResolvedValue(fileContent);

      // Create cache with its own logger (provided at cache creation time)
      const cacheLogger = { warn: mock(() => {}) };
      const cache = new StaticContentCache(
        {
          singleAssetMap: { '/test.txt': '/path/to/test.txt' },
        },
        cacheLogger,
      );

      // Plugin should use the provided cache as-is (doesn't use host logger)
      const plugin = staticContent(cache);
      const meta = await plugin(host, options);

      expect(meta).toBeDefined();
      expect(meta?.name).toBeDefined();

      // Hook should be registered
      expect(host.addHook).toHaveBeenCalledTimes(1);

      // Verify the hook works with the external cache
      const result = await invokeRegisteredHook(host, '/test.txt');
      expect(result.sent).toBe(true);
      expect(result.code).toBe(200);
      expect(result.body).toBe(fileContent);

      // Host logger should not be called when using external cache
      // (the cache was created with its own logger)
      expect(mockHostLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('Security: Null byte validation', () => {
    it('rejects URLs containing null bytes at runtime', async () => {
      const host = createMockPluginHost();
      const options = createMockOptions();

      const plugin = staticContent({
        singleAssetMap: { '/test.txt': '/path/to/test.txt' },
        folderMap: { '/assets': '/path/to/assets' },
      });

      await plugin(host, options);

      // Test null byte in exact match URL
      const result1 = await invokeRegisteredHook(host, '/test.txt\0.js');
      expect(result1.sent).toBe(false);

      // Test null byte in folder-based URL
      const result2 = await invokeRegisteredHook(host, '/assets/file.txt\0.js');
      expect(result2.sent).toBe(false);

      // Test URL-encoded null byte (already decoded by the time it reaches our code)
      const result3 = await invokeRegisteredHook(host, '/assets/file.txt\0.js');
      expect(result3.sent).toBe(false);

      // Verify filesystem was never accessed for null byte requests
      expect(mockFs.stat).not.toHaveBeenCalled();
      expect(mockFs.readFile).not.toHaveBeenCalled();
    });

    it('skips singleAssetMap entries with null bytes in configuration', async () => {
      const host = createMockPluginHost();
      const options = createMockOptions();
      const mockLogger = {
        warn: mock(() => {}),
      };

      // Add logger to host decorations so it gets picked up by the plugin
      host.getDecoration = mock((property: string) => {
        if (property === 'log') {
          return mockLogger;
        }
        return undefined;
      }) as typeof host.getDecoration;

      const fileContent = Buffer.from('valid content');

      // Mock fs operations for valid file
      mockFs.stat.mockImplementation((path: string) => {
        if (path === '/path/to/valid.txt') {
          return Promise.resolve({
            isFile: () => true,
            size: fileContent.length,
            mtime: new Date('2024-01-01'),
            mtimeMs: new Date('2024-01-01').getTime(),
          } as fs.Stats);
        }
        const error = new Error('ENOENT');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        return Promise.reject(error);
      });

      mockFs.readFile.mockImplementation((path: string) => {
        if (path === '/path/to/valid.txt') {
          return Promise.resolve(fileContent);
        }
        const error = new Error('ENOENT');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        return Promise.reject(error);
      });

      const plugin = staticContent({
        singleAssetMap: {
          '/valid.txt': '/path/to/valid.txt',
          '/bad\0key.txt': '/path/to/file.txt', // null byte in key
          '/badvalue.txt': '/path/to/file\0.txt', // null byte in value
        },
      });

      await plugin(host, options);

      // Valid file should work
      const validResult = await invokeRegisteredHook(host, '/valid.txt');
      expect(validResult.sent).toBe(true);
      expect(validResult.code).toBe(200);

      // Files with null bytes should be skipped (not found)
      const badKeyResult = await invokeRegisteredHook(host, '/bad\0key.txt');
      expect(badKeyResult.sent).toBe(false);

      const badValueResult = await invokeRegisteredHook(host, '/badvalue.txt');
      expect(badValueResult.sent).toBe(false);

      // Logger should have warned about skipped entries (2 times)
      expect(mockLogger.warn.mock.calls.length).toBe(2);
    });

    it('skips folderMap entries with null bytes in configuration', async () => {
      const host = createMockPluginHost();
      const options = createMockOptions();
      const mockLogger = {
        warn: mock(() => {}),
      };

      // Add logger to host decorations so it gets picked up by the plugin
      host.getDecoration = mock((property: string) => {
        if (property === 'log') {
          return mockLogger;
        }
        return undefined;
      }) as typeof host.getDecoration;

      const fileContent = Buffer.from('valid content');

      // Mock fs operations for valid file
      mockFs.stat.mockImplementation((path: string) => {
        if (path.includes('/path/to/valid/')) {
          return Promise.resolve({
            isFile: () => true,
            size: fileContent.length,
            mtime: new Date('2024-01-01'),
            mtimeMs: new Date('2024-01-01').getTime(),
          } as fs.Stats);
        }
        const error = new Error('ENOENT');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        return Promise.reject(error);
      });

      mockFs.readFile.mockImplementation((path: string) => {
        if (path.includes('/path/to/valid/')) {
          return Promise.resolve(fileContent);
        }
        const error = new Error('ENOENT');
        (error as NodeJS.ErrnoException).code = 'ENOENT';
        return Promise.reject(error);
      });

      const plugin = staticContent({
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
      });

      await plugin(host, options);

      // Valid folder should work
      const validResult = await invokeRegisteredHook(host, '/valid/file.txt');
      expect(validResult.sent).toBe(true);
      expect(validResult.code).toBe(200);

      // Folders with null bytes should be skipped (not found)
      const badPrefixResult = await invokeRegisteredHook(
        host,
        '/bad\0prefix/file.txt',
      );
      expect(badPrefixResult.sent).toBe(false);

      const badPathResult = await invokeRegisteredHook(
        host,
        '/badpath/file.txt',
      );
      expect(badPathResult.sent).toBe(false);

      const badConfigResult = await invokeRegisteredHook(
        host,
        '/badconfig/file.txt',
      );
      expect(badConfigResult.sent).toBe(false);

      // Logger should have warned about skipped entries (3 times)
      expect(mockLogger.warn.mock.calls.length).toBe(3);
    });

    it('handles null byte validation without logger', async () => {
      const host = createMockPluginHost();
      const options = createMockOptions();

      // No logger provided - should not crash
      const plugin = staticContent({
        singleAssetMap: {
          '/bad\0key.txt': '/path/to/file.txt',
        },
        folderMap: {
          '/bad\0prefix': '/path/to/assets',
        },
      });

      await plugin(host, options);

      // Should silently skip invalid entries
      const result1 = await invokeRegisteredHook(host, '/bad\0key.txt');
      expect(result1.sent).toBe(false);

      const result2 = await invokeRegisteredHook(host, '/bad\0prefix/file.txt');
      expect(result2.sent).toBe(false);
    });
  });
});

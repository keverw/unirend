import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { StaticWebServer } from './static-web-server';
import { StaticContentCache } from './static-content-cache';
import fs from 'fs';
import getPort from 'get-port';

// ─── fs mock ──────────────────────────────────────────────────────────────────
//
// readJSONFile and readHTMLFile (used by buildMaps) both delegate to
// fs.promises.readFile internally, so we can control them by replacing
// that single method on the fs.promises object.

function makeEnoent(): NodeJS.ErrnoException {
  return Object.assign(new Error('ENOENT: no such file or directory'), {
    code: 'ENOENT',
  });
}

// Created once; implementation swapped per-test via mockImplementation()
const mockReadFile = mock(
  (_path: unknown, _options?: unknown): Promise<Buffer | string> => {
    return Promise.reject(makeEnoent());
  },
);

const originalReadFile = fs.promises.readFile;

// Minimal valid page map (URL → filename relative to buildDir)
const VALID_PAGE_MAP = JSON.stringify({
  '/': 'index.html',
  '/about': 'about.html',
});

/**
 * Set up mockReadFile to return specific content per filename suffix.
 * Unmatched paths throw ENOENT (simulating absent files).
 *
 * When readFile is called with an encoding option (e.g. 'utf8'), it returns
 * a string; without encoding it returns a Buffer. This mirrors real fs behavior
 * and lets readHTMLFile (which passes 'utf8') and readJSONFile (which doesn't)
 * both work correctly with the same mock.
 */
function setReadFileMock(files: Record<string, string>): void {
  mockReadFile.mockImplementation((filePath: unknown, options?: unknown) => {
    const fp = String(filePath);
    for (const [suffix, content] of Object.entries(files)) {
      if (fp.endsWith(suffix)) {
        const encoding =
          typeof options === 'string'
            ? options
            : (options as { encoding?: string } | undefined)?.encoding;

        return Promise.resolve(encoding ? content : Buffer.from(content));
      }
    }

    return Promise.reject(makeEnoent());
  });
}

beforeEach(() => {
  mockReadFile.mockReset();
  // Default: every read fails with ENOENT
  mockReadFile.mockImplementation((_path?: unknown, _options?: unknown) => {
    return Promise.reject(makeEnoent());
  });
  (fs.promises as { readFile: unknown }).readFile = mockReadFile;
});

afterEach(() => {
  (fs.promises as { readFile: unknown }).readFile = originalReadFile;
});

// ─── helpers ──────────────────────────────────────────────────────────────────

const BUILD_DIR = '/fake/build';

function makeServer(
  overrides: Partial<ConstructorParameters<typeof StaticWebServer>[0]> = {},
): StaticWebServer {
  return new StaticWebServer({
    buildDir: BUILD_DIR,
    pageMapPath: 'page-map.json',
    ...overrides,
  });
}

// ─── tests ────────────────────────────────────────────────────────────────────

describe('StaticWebServer', () => {
  let server: StaticWebServer | null = null;
  let testPort: number;

  beforeEach(async () => {
    testPort = await getPort();
  });

  afterEach(async () => {
    if (server?.isListening()) {
      await server.stop();
    }

    server = null;
  });

  // ─── Constructor ────────────────────────────────────────────────────────────

  describe('Constructor', () => {
    it('creates a server with valid minimal options without throwing', () => {
      expect(() => makeServer()).not.toThrow();
    });

    it('throws TypeError if pageMapPath is empty string', () => {
      expect(
        () => new StaticWebServer({ buildDir: BUILD_DIR, pageMapPath: '' }),
      ).toThrow(TypeError);
    });

    it('throws TypeError if pageMapPath is not a string', () => {
      expect(
        () =>
          new StaticWebServer({
            buildDir: BUILD_DIR,
            pageMapPath: 42 as unknown as string,
          }),
      ).toThrow(TypeError);
    });

    it('throws TypeError if buildDir is empty string', () => {
      expect(
        () =>
          new StaticWebServer({ buildDir: '', pageMapPath: 'page-map.json' }),
      ).toThrow(TypeError);
    });

    it('throws TypeError if buildDir is not a string', () => {
      expect(
        () =>
          new StaticWebServer({
            buildDir: null as unknown as string,
            pageMapPath: 'page-map.json',
          }),
      ).toThrow(TypeError);
    });

    it('throws TypeError if notFoundPage is not a string', () => {
      expect(() =>
        makeServer({ notFoundPage: 42 as unknown as string }),
      ).toThrow(TypeError);
    });

    it('throws TypeError if errorPage is not a string', () => {
      expect(() => makeServer({ errorPage: 42 as unknown as string })).toThrow(
        TypeError,
      );
    });

    it('throws TypeError if singleAssets is an array', () => {
      expect(() =>
        makeServer({ singleAssets: [] as unknown as Record<string, string> }),
      ).toThrow(TypeError);
    });

    it('throws TypeError if a singleAssets value is not a string', () => {
      expect(() =>
        makeServer({
          singleAssets: { '/foo': 42 as unknown as string },
        }),
      ).toThrow(TypeError);
    });

    it('throws TypeError if assetFolders is an array', () => {
      expect(() =>
        makeServer({
          assetFolders: [] as unknown as Record<string, string>,
        }),
      ).toThrow(TypeError);
    });

    it('throws TypeError if an assetFolders value is not a string', () => {
      expect(() =>
        makeServer({
          assetFolders: { '/assets': 42 as unknown as string },
        }),
      ).toThrow(TypeError);
    });
  });

  // ─── isListening() ──────────────────────────────────────────────────────────

  describe('isListening()', () => {
    it('returns false before listen() is called', () => {
      server = makeServer();
      expect(server.isListening()).toBe(false);
    });

    it('returns true after a successful listen()', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });

      server = makeServer();
      await server.listen(testPort);

      expect(server.isListening()).toBe(true);
    });

    it('returns false after stop()', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();

      await server.listen(testPort);
      await server.stop();

      expect(server.isListening()).toBe(false);
    });
  });

  // ─── listen() ───────────────────────────────────────────────────────────────

  describe('listen()', () => {
    it('throws if page-map.json is not found', () => {
      // mockReadFile default: ENOENT for everything
      server = makeServer();

      expect(server.listen(testPort)).rejects.toThrow(
        'Failed to load page map',
      );
    });

    it('throws if page-map.json contains invalid JSON', () => {
      setReadFileMock({ 'page-map.json': 'not-valid-json{{{' });
      server = makeServer();
      expect(server.listen(testPort)).rejects.toThrow(
        'Failed to load page map',
      );
    });

    it('throws TypeError if page-map.json is a JSON array instead of object', () => {
      setReadFileMock({ 'page-map.json': '["foo","bar"]' });
      server = makeServer();

      expect(server.listen(testPort)).rejects.toThrow(
        'Invalid page map format',
      );
    });

    it('throws TypeError if a page-map.json entry value is not a string', () => {
      setReadFileMock({
        'page-map.json': JSON.stringify({ '/': 42 }),
      });

      server = makeServer();

      expect(server.listen(testPort)).rejects.toThrow('Invalid page map entry');
    });

    it('starts the server successfully with a valid page map', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();

      await server.listen(testPort);
      expect(server.isListening()).toBe(true);
    });

    it('creates a StaticContentCache instance on listen', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();
      await server.listen(testPort);

      expect((server as unknown as { cache: unknown }).cache).toBeInstanceOf(
        StaticContentCache,
      );
    });

    it('delegates double-listen error to APIServer', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();

      await server.listen(testPort);

      expect(server.listen(testPort)).rejects.toThrow();
    });

    it('sets notFoundHTML when notFoundPage file is found', async () => {
      setReadFileMock({
        'page-map.json': VALID_PAGE_MAP,
        'custom-404.html': '<html>Custom 404</html>',
      });

      server = makeServer({ notFoundPage: 'custom-404.html' });
      await server.listen(testPort);

      expect(
        (server as unknown as { notFoundHTML: unknown }).notFoundHTML,
      ).toBe('<html>Custom 404</html>');
    });

    it('sets errorHTML when errorPage file is found', async () => {
      setReadFileMock({
        'page-map.json': VALID_PAGE_MAP,
        'custom-500.html': '<html>Custom 500</html>',
      });

      server = makeServer({ errorPage: 'custom-500.html' });
      await server.listen(testPort);

      expect((server as unknown as { errorHTML: unknown }).errorHTML).toBe(
        '<html>Custom 500</html>',
      );
    });

    it('leaves notFoundHTML undefined when no 404 page is found', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });

      server = makeServer();
      await server.listen(testPort);

      expect(
        (server as unknown as { notFoundHTML: unknown }).notFoundHTML,
      ).toBeUndefined();
    });

    it('leaves errorHTML undefined when no 500 page is found', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });

      server = makeServer();
      await server.listen(testPort);

      expect(
        (server as unknown as { errorHTML: unknown }).errorHTML,
      ).toBeUndefined();
    });

    it('removes the SSG-generated /404 URL from the cache route map', async () => {
      // Page map includes /404 → 404.html, and that file exists
      const pageMapWith404 = JSON.stringify({
        '/': 'index.html',
        '/404': '404.html',
      });

      setReadFileMock({
        'page-map.json': pageMapWith404,
        '404.html': '<html>404</html>',
      });

      server = makeServer();
      await server.listen(testPort);

      const cache = (server as unknown as { cache: StaticContentCache }).cache;
      const internalMap = (
        cache as unknown as { singleAssetMap: Map<string, string> }
      ).singleAssetMap;

      // /404 should NOT be in the normal route map (served via error handler only)
      expect(internalMap.has('/404')).toBe(false);

      // Other routes should still be present
      expect(internalMap.has('/')).toBe(true);
    });

    it('removes the SSG-generated /500 URL from the cache route map', async () => {
      const pageMapWith500 = JSON.stringify({
        '/': 'index.html',
        '/500': '500.html',
      });

      setReadFileMock({
        'page-map.json': pageMapWith500,
        '500.html': '<html>500</html>',
      });

      server = makeServer();
      await server.listen(testPort);

      const cache = (server as unknown as { cache: StaticContentCache }).cache;
      const internalMap = (
        cache as unknown as { singleAssetMap: Map<string, string> }
      ).singleAssetMap;

      expect(internalMap.has('/500')).toBe(false);
    });
  });

  // ─── stop() ─────────────────────────────────────────────────────────────────

  describe('stop()', () => {
    it('is a no-op when server is not running', () => {
      server = makeServer();
      expect(server.stop()).resolves.toBeUndefined();
    });

    it('stops a running server', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();

      await server.listen(testPort);
      await server.stop();

      expect(server.isListening()).toBe(false);
    });

    it('clears the internal cache reference after stop', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();

      await server.listen(testPort);
      await server.stop();

      expect((server as unknown as { cache: unknown }).cache).toBeNull();
    });

    it('clears notFoundHTML after stop', async () => {
      setReadFileMock({
        'page-map.json': VALID_PAGE_MAP,
        'custom-404.html': '<html>404</html>',
      });

      server = makeServer({ notFoundPage: 'custom-404.html' });
      await server.listen(testPort);
      await server.stop();

      expect(
        (server as unknown as { notFoundHTML: unknown }).notFoundHTML,
      ).toBeUndefined();
    });

    it('clears errorHTML after stop', async () => {
      setReadFileMock({
        'page-map.json': VALID_PAGE_MAP,
        'custom-500.html': '<html>500</html>',
      });

      server = makeServer({ errorPage: 'custom-500.html' });
      await server.listen(testPort);
      await server.stop();

      expect(
        (server as unknown as { errorHTML: unknown }).errorHTML,
      ).toBeUndefined();
    });
  });

  // ─── reload() ───────────────────────────────────────────────────────────────

  describe('reload()', () => {
    it('throws if the server is not running', () => {
      server = makeServer();
      expect(server.reload()).rejects.toThrow('Server is not running');
    });

    it('throws if page-map.json cannot be read during reload', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();
      await server.listen(testPort);

      // Make page-map.json unreadable
      mockReadFile.mockImplementation((_p?: unknown, _o?: unknown) => {
        return Promise.reject(makeEnoent());
      });

      expect(server.reload()).rejects.toThrow('Failed to load page map');
    });

    it('throws if page-map.json is invalid during reload', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();
      await server.listen(testPort);

      setReadFileMock({ 'page-map.json': '["bad","format"]' });
      expect(server.reload()).rejects.toThrow('Invalid page map format');
    });

    it('preserves old cache reference when reload fails', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();
      await server.listen(testPort);

      const cacheBefore = (server as unknown as { cache: unknown }).cache;

      mockReadFile.mockImplementation((_p?: unknown, _o?: unknown) => {
        return Promise.reject(makeEnoent());
      });

      expect(server.reload()).rejects.toThrow();

      expect((server as unknown as { cache: unknown }).cache).toBe(cacheBefore);
    });

    it('preserves notFoundHTML when reload fails', async () => {
      setReadFileMock({
        'page-map.json': VALID_PAGE_MAP,
        'custom-404.html': '<html>Old 404</html>',
      });

      server = makeServer({ notFoundPage: 'custom-404.html' });
      await server.listen(testPort);

      const htmlBefore = (server as unknown as { notFoundHTML: unknown })
        .notFoundHTML;

      mockReadFile.mockImplementation((_p?: unknown, _o?: unknown) => {
        return Promise.reject(makeEnoent());
      });

      expect(server.reload()).rejects.toThrow();

      expect(
        (server as unknown as { notFoundHTML: unknown }).notFoundHTML,
      ).toBe(htmlBefore);
    });

    it('resolves without throwing on a successful reload', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();
      await server.listen(testPort);

      expect(server.reload()).resolves.toBeUndefined();
    });

    it('server remains listening after a successful reload', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();
      await server.listen(testPort);
      await server.reload();
      expect(server.isListening()).toBe(true);
    });

    it('calls cache.replaceConfig with the new singleAssetMap on reload', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();
      await server.listen(testPort);

      const cache = (server as unknown as { cache: StaticContentCache }).cache;
      const replaceConfigSpy = mock(cache.replaceConfig.bind(cache));
      (cache as unknown as { replaceConfig: unknown }).replaceConfig =
        replaceConfigSpy;

      const newPageMap = JSON.stringify({
        '/': 'index-v2.html',
        '/contact': 'contact.html',
      });

      setReadFileMock({ 'page-map.json': newPageMap });
      await server.reload();

      expect(replaceConfigSpy).toHaveBeenCalledTimes(1);
      const arg = replaceConfigSpy.mock.calls[0][0] as {
        singleAssetMap: Record<string, string>;
      };

      // Paths are resolved absolute
      expect(arg.singleAssetMap['/contact']).toContain('contact.html');
    });

    it('does not call cache.replaceConfig when reload fails', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();
      await server.listen(testPort);

      const cache = (server as unknown as { cache: StaticContentCache }).cache;
      const replaceConfigSpy = mock(cache.replaceConfig.bind(cache));
      (cache as unknown as { replaceConfig: unknown }).replaceConfig =
        replaceConfigSpy;

      mockReadFile.mockImplementation((_p?: unknown, _o?: unknown) => {
        return Promise.reject(makeEnoent());
      });

      expect(server.reload()).rejects.toThrow();

      expect(replaceConfigSpy).not.toHaveBeenCalled();
    });

    it('updates notFoundHTML when a new error page becomes available on reload', async () => {
      // Start: no 404 page
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = new StaticWebServer({
        buildDir: BUILD_DIR,
        pageMapPath: 'page-map.json',
        notFoundPage: 'custom-404.html',
      });

      await server.listen(testPort);

      expect(
        (server as unknown as { notFoundHTML: unknown }).notFoundHTML,
      ).toBeUndefined();

      // Reload: 404 page now available
      setReadFileMock({
        'page-map.json': VALID_PAGE_MAP,
        'custom-404.html': '<html>New 404</html>',
      });

      await server.reload();

      expect(
        (server as unknown as { notFoundHTML: unknown }).notFoundHTML,
      ).toBe('<html>New 404</html>');
    });

    it('clears notFoundHTML on reload when the error page file disappears', async () => {
      // Start: 404 page exists
      setReadFileMock({
        'page-map.json': VALID_PAGE_MAP,
        'custom-404.html': '<html>Old 404</html>',
      });

      server = new StaticWebServer({
        buildDir: BUILD_DIR,
        pageMapPath: 'page-map.json',
        notFoundPage: 'custom-404.html',
      });

      await server.listen(testPort);

      expect(
        (server as unknown as { notFoundHTML: unknown }).notFoundHTML,
      ).toBe('<html>Old 404</html>');

      // Reload: 404 page is gone
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      await server.reload();

      expect(
        (server as unknown as { notFoundHTML: unknown }).notFoundHTML,
      ).toBeUndefined();
    });

    it('supports multiple consecutive reloads without errors', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer();
      await server.listen(testPort);

      for (let i = 0; i < 3; i++) {
        const pm = JSON.stringify({ '/': `index-v${i}.html` });
        setReadFileMock({ 'page-map.json': pm });
        expect(server.reload()).resolves.toBeUndefined();
      }

      expect(server.isListening()).toBe(true);
    });
  });

  // ─── HTTP response behavior ─────────────────────────────────────────────────

  describe('HTTP response behavior', () => {
    it('returns default 404 HTML for unmatched routes', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer({ logErrors: false });
      await server.listen(testPort);

      const response = await fetch(
        `http://localhost:${testPort}/does-not-exist`,
      );

      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).toContain('404 Not Found');
    });

    it('returns custom notFoundHTML for unmatched routes when notFoundPage is configured', async () => {
      setReadFileMock({
        'page-map.json': VALID_PAGE_MAP,
        'custom-404.html': '<html>Custom 404</html>',
      });

      server = makeServer({
        notFoundPage: 'custom-404.html',
        logErrors: false,
      });

      await server.listen(testPort);

      const response = await fetch(
        `http://localhost:${testPort}/does-not-exist`,
      );

      expect(response.status).toBe(404);
      const body = await response.text();
      expect(body).toBe('<html>Custom 404</html>');
    });

    it('returns default 500 HTML when the cache throws and no errorPage is configured', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer({ logErrors: false });
      await server.listen(testPort);

      const cache = (server as unknown as { cache: StaticContentCache }).cache;
      const orig = cache.handleRequest.bind(cache);

      (cache as unknown as { handleRequest: unknown }).handleRequest =
        () => {
          throw new Error('Simulated cache error');
        };

      try {
        const response = await fetch(`http://localhost:${testPort}/`);
        expect(response.status).toBe(500);
        const body = await response.text();
        expect(body).toContain('500 Internal Server Error');
      } finally {
        (cache as unknown as { handleRequest: unknown }).handleRequest = orig;
      }
    });

    it('includes an escaped stack trace in the 500 page when isDevelopment is true', async () => {
      setReadFileMock({ 'page-map.json': VALID_PAGE_MAP });
      server = makeServer({ isDevelopment: true, logErrors: false });
      await server.listen(testPort);

      const cache = (server as unknown as { cache: StaticContentCache }).cache;
      const orig = cache.handleRequest.bind(cache);

      (cache as unknown as { handleRequest: unknown }).handleRequest =
        () => {
          throw new Error('Dev mode error');
        };

      try {
        const response = await fetch(`http://localhost:${testPort}/`);
        expect(response.status).toBe(500);
        const body = await response.text();
        expect(body).toContain('<pre>');
        expect(body).toContain('Dev mode error');
      } finally {
        (cache as unknown as { handleRequest: unknown }).handleRequest = orig;
      }
    });

    it('returns custom errorHTML when errorPage is configured and the cache throws', async () => {
      setReadFileMock({
        'page-map.json': VALID_PAGE_MAP,
        'custom-500.html': '<html>Custom 500</html>',
      });

      server = makeServer({ errorPage: 'custom-500.html', logErrors: false });
      await server.listen(testPort);

      const cache = (server as unknown as { cache: StaticContentCache }).cache;
      const orig = cache.handleRequest.bind(cache);

      (cache as unknown as { handleRequest: unknown }).handleRequest =
        () => {
          throw new Error('Simulated cache error');
        };

      try {
        const response = await fetch(`http://localhost:${testPort}/`);
        expect(response.status).toBe(500);
        const body = await response.text();
        expect(body).toBe('<html>Custom 500</html>');
      } finally {
        (cache as unknown as { handleRequest: unknown }).handleRequest = orig;
      }
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import {
  validatePublicFiles,
  validatePublicFolders,
  assertNoRootFolderMount,
  buildProdStaticRouterConfig,
  validateProdAppStaticConfig,
  assertPublicPathsExist,
  findShadowedPublicPaths,
} from './static-router-config-utils';
import { serveSSRBuilt } from '../ssr';

const CLIENT_ROOT = '/fake/build/client';

// ---------------------------------------------------------------------------
// validatePublicFiles()
// ---------------------------------------------------------------------------

describe('validatePublicFiles()', () => {
  it('passes through valid entries unchanged', () => {
    expect(
      validatePublicFiles(['/favicon.svg', '/robots.txt'], 'the default app'),
    ).toEqual(['/favicon.svg', '/robots.txt']);
  });

  it('normalizes a missing leading slash', () => {
    expect(validatePublicFiles(['favicon.svg'], 'the default app')).toEqual([
      '/favicon.svg',
    ]);
  });

  it('allows nested paths (public/ subdirectories)', () => {
    expect(
      validatePublicFiles(['/icons/apple-touch.png'], 'the default app'),
    ).toEqual(['/icons/apple-touch.png']);
  });

  it('rejects "." path segments (browsers normalize them, so the key never matches)', () => {
    expect(() => validatePublicFiles(['./favicon.ico'], 'the app')).toThrow(
      /"\." or "\.\." path segment/,
    );
    expect(() => validatePublicFiles(['/icons/./logo.png'], 'the app')).toThrow(
      /"\." or "\.\." path segment/,
    );
    expect(() => validatePublicFolders(['/icons/.'], 'the app')).toThrow(
      /"\." or "\.\." path segment/,
    );
  });

  it('rejects ".." path segments', () => {
    expect(() =>
      validatePublicFiles(['/../secrets.txt'], 'the default app'),
    ).toThrow(/"\.\." path segment/);
  });

  it('rejects null bytes', () => {
    expect(() =>
      validatePublicFiles(['/favicon\0.svg'], 'the default app'),
    ).toThrow(/null byte/);
  });

  it('rejects backslashes', () => {
    expect(() =>
      validatePublicFiles(['\\favicon.svg'], 'the default app'),
    ).toThrow(/backslash/);
  });

  it('rejects a bare "/"', () => {
    expect(() => validatePublicFiles(['/'], 'the default app')).toThrow(
      /directory path/,
    );
  });

  it('rejects trailing slashes (directories belong in publicFolders)', () => {
    expect(() => validatePublicFiles(['/icons/'], 'the default app')).toThrow(
      /publicFolders/,
    );
  });

  it('rejects empty strings and non-strings', () => {
    expect(() => validatePublicFiles([''], 'the default app')).toThrow(
      /non-empty strings/,
    );
    expect(() =>
      validatePublicFiles([42 as unknown as string], 'the default app'),
    ).toThrow(/non-empty strings/);
  });

  it('rejects a non-array value', () => {
    expect(() =>
      validatePublicFiles(
        '/favicon.svg' as unknown as string[],
        'the default app',
      ),
    ).toThrow(/expected an array/);
  });

  it('rejects /index.html (the raw HTML template)', () => {
    expect(() => validatePublicFiles(['/index.html'], 'the app')).toThrow(
      /raw HTML template/,
    );
    expect(() => validatePublicFiles(['index.html'], 'the app')).toThrow(
      /raw HTML template/,
    );
  });

  it('rejects anything under .vite/', () => {
    expect(() =>
      validatePublicFiles(['/.vite/manifest.json'], 'the app'),
    ).toThrow(/build metadata/);
  });

  it('allows a nested index.html (only the root template is reserved)', () => {
    expect(validatePublicFiles(['/docs/index.html'], 'the app')).toEqual([
      '/docs/index.html',
    ]);
  });

  it('rejects entries under /assets (generated output, already served)', () => {
    expect(() =>
      validatePublicFiles(['/assets/index-abc123.js'], 'the app'),
    ).toThrow(/under \/assets/);
    expect(() => validatePublicFiles(['/assets'], 'the app')).toThrow(
      /under \/assets/,
    );
  });

  it('rejects reserved paths case-insensitively (case-insensitive filesystems)', () => {
    expect(() => validatePublicFiles(['/INDEX.HTML'], 'the app')).toThrow(
      /raw HTML template/,
    );
    expect(() =>
      validatePublicFiles(['/.VITE/manifest.json'], 'the app'),
    ).toThrow(/build metadata/);
    expect(() =>
      validatePublicFiles(['/ASSETS/index-abc123.js'], 'the app'),
    ).toThrow(/under \/assets/);
  });

  it('collapses repeated slashes before checking reserved paths', () => {
    // '/assets//x' normalizes to the same mount as '/assets/x' in the cache,
    // so it must not dodge the reserved check.
    expect(() =>
      validatePublicFiles(['/assets//index-abc123.js'], 'the app'),
    ).toThrow(/under \/assets/);
    expect(validatePublicFiles(['//favicon.svg'], 'the app')).toEqual([
      '/favicon.svg',
    ]);
  });

  it('rejects characters browsers percent-encode (they could never match the raw-URL matcher)', () => {
    // '/og image.png' would pass the boot existence check but the browser
    // requests '/og%20image.png', so it would 404 silently in production.
    expect(() => validatePublicFiles(['/og image.png'], 'the app')).toThrow(
      /percent-encode/,
    );
    expect(() => validatePublicFiles(['/file%20name.png'], 'the app')).toThrow(
      /percent-encode/,
    );
    expect(() => validatePublicFiles(['/notes#1.txt'], 'the app')).toThrow(
      /percent-encode/,
    );
    expect(() => validatePublicFiles(['/what?.txt'], 'the app')).toThrow(
      /percent-encode/,
    );
    expect(() => validatePublicFiles(['/héllo.png'], 'the app')).toThrow(
      /percent-encode/,
    );
    expect(() => validatePublicFolders(['/my docs'], 'the app')).toThrow(
      /percent-encode/,
    );
  });

  it('allows the URL-safe punctuation browsers send raw', () => {
    expect(
      validatePublicFiles(
        ["/apple-touch-icon.png", "/file's_(v2)~final,ok.txt"],
        'the app',
      ),
    ).toEqual(['/apple-touch-icon.png', "/file's_(v2)~final,ok.txt"]);
    // The WHATWG URL path percent-encode set leaves these raw too, so a
    // browser really requests '/icon[1].png' verbatim.
    expect(
      validatePublicFiles(['/icon[1].png', '/a|b.txt'], 'the app'),
    ).toEqual(['/icon[1].png', '/a|b.txt']);
    // '^' is NOT left raw — the serializer encodes '/a^b' as '/a%5Eb'.
    expect(() => validatePublicFiles(['/a^b.txt'], 'the app')).toThrow(
      /percent-encode/,
    );
  });
});

// ---------------------------------------------------------------------------
// validatePublicFolders()
// ---------------------------------------------------------------------------

describe('validatePublicFolders()', () => {
  it('normalizes leading and trailing slashes', () => {
    expect(
      validatePublicFolders(
        ['/.well-known', '.well-known', '/.well-known/'],
        'the default app',
      ),
    ).toEqual(['/.well-known', '/.well-known', '/.well-known']);
  });

  it('allows nested subfolders', () => {
    expect(validatePublicFolders(['/media/icons'], 'the app')).toEqual([
      '/media/icons',
    ]);
  });

  it('rejects a bare "/" (never mount the client build root)', () => {
    expect(() => validatePublicFolders(['/'], 'the app')).toThrow(
      /client build root/,
    );
  });

  it('rejects slash-collapsed root mounts like "//" (they normalize to "/")', () => {
    expect(() => validatePublicFolders(['//'], 'the app')).toThrow(
      /client build root/,
    );
    expect(() => validatePublicFolders(['///'], 'the app')).toThrow(
      /client build root/,
    );
  });

  it('rejects /assets (already the default mount)', () => {
    expect(() => validatePublicFolders(['/assets'], 'the app')).toThrow(
      /already served by default/,
    );
    expect(() => validatePublicFolders(['/assets/'], 'the app')).toThrow(
      /already served by default/,
    );
    // Slash-collapsed and case variants normalize to the same mount
    expect(() => validatePublicFolders(['/assets//'], 'the app')).toThrow(
      /already served by default/,
    );
    expect(() => validatePublicFolders(['/ASSETS'], 'the app')).toThrow(
      /already served by default/,
    );
  });

  it('rejects subpaths of /assets (longest-prefix matching would beat the default mount)', () => {
    expect(() => validatePublicFolders(['/assets/foo'], 'the app')).toThrow(
      /already served by default/,
    );
    expect(() => validatePublicFolders(['/ASSETS/foo'], 'the app')).toThrow(
      /already served by default/,
    );
  });

  it('rejects .vite', () => {
    expect(() => validatePublicFolders(['/.vite'], 'the app')).toThrow(
      /build metadata/,
    );
  });

  it('rejects ".." segments, null bytes, and backslashes', () => {
    expect(() => validatePublicFolders(['/../x'], 'the app')).toThrow(
      /"\.\." path segment/,
    );
    expect(() => validatePublicFolders(['/x\0y'], 'the app')).toThrow(
      /null byte/,
    );
    expect(() => validatePublicFolders(['\\x'], 'the app')).toThrow(
      /backslash/,
    );
  });

  it('rejects a non-array value', () => {
    expect(() =>
      validatePublicFolders('/.well-known' as unknown as string[], 'the app'),
    ).toThrow(/expected an array/);
  });
});

// ---------------------------------------------------------------------------
// assertNoRootFolderMount()
// ---------------------------------------------------------------------------

describe('assertNoRootFolderMount()', () => {
  it('allows a normal /assets mount', () => {
    expect(() =>
      assertNoRootFolderMount(
        { '/assets': path.join(CLIENT_ROOT, 'assets') },
        CLIENT_ROOT,
        'the default app',
      ),
    ).not.toThrow();
  });

  it('rejects a "/" prefix', () => {
    expect(() =>
      assertNoRootFolderMount({ '/': '/somewhere' }, CLIENT_ROOT, 'app "x"'),
    ).toThrow(/publicFiles/);
  });

  it('rejects an empty prefix and slash-collapsed variants', () => {
    expect(() =>
      assertNoRootFolderMount({ '': '/somewhere' }, CLIENT_ROOT, 'app "x"'),
    ).toThrow(/mounts the root/);
    expect(() =>
      assertNoRootFolderMount({ '//': '/somewhere' }, CLIENT_ROOT, 'app "x"'),
    ).toThrow(/mounts the root/);
  });

  it('rejects a folder path that resolves to the client build root', () => {
    expect(() =>
      assertNoRootFolderMount(
        { '/static': { path: CLIENT_ROOT } },
        CLIENT_ROOT,
        'the default app',
      ),
    ).toThrow(/client build root/);
  });

  it('is a no-op without a folderMap', () => {
    expect(() =>
      assertNoRootFolderMount(undefined, CLIENT_ROOT, 'the default app'),
    ).not.toThrow();
  });

  it('rejects a symlink that resolves to the client build root', async () => {
    // path.resolve alone would let a symlinked directory dodge the guard and
    // expose /index.html and /.vite/manifest.json.
    const tmpDir = await createTempDir({
      prefix: 'unirend-root-mount-',
      unsafeCleanup: true,
    });

    try {
      const realRoot = path.join(tmpDir.path, 'client');
      const link = path.join(tmpDir.path, 'client-link');

      await fs.promises.mkdir(realRoot);
      await fs.promises.symlink(realRoot, link);

      expect(() =>
        assertNoRootFolderMount(
          { '/static': { path: link } },
          realRoot,
          'the default app',
        ),
      ).toThrow(/client build root/);
    } finally {
      await tmpDir.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// buildProdStaticRouterConfig()
// ---------------------------------------------------------------------------

describe('buildProdStaticRouterConfig()', () => {
  it('produces the /assets default with immutable caching when no custom config is given', () => {
    const config = buildProdStaticRouterConfig(
      undefined,
      {},
      CLIENT_ROOT,
      true,
    );

    expect(config.folderMap).toEqual({
      '/assets': {
        path: path.join(CLIENT_ROOT, 'assets'),
        detectImmutableAssets: true,
      },
    });
    expect(config.singleAssetMap).toEqual({});
    expect(config.compression).toBe(true);
  });

  it('resolves publicFiles entries under the client root as single assets', () => {
    const config = buildProdStaticRouterConfig(
      undefined,
      { publicFiles: ['/favicon.svg', '/icons/logo.png'] },
      CLIENT_ROOT,
      undefined,
    );

    expect(config.singleAssetMap).toEqual({
      '/favicon.svg': path.join(CLIENT_ROOT, 'favicon.svg'),
      '/icons/logo.png': path.join(CLIENT_ROOT, 'icons', 'logo.png'),
    });
  });

  it('mounts publicFolders alongside the /assets default, without immutable detection', () => {
    const config = buildProdStaticRouterConfig(
      undefined,
      { publicFolders: ['/.well-known'] },
      CLIENT_ROOT,
      true,
    );

    expect(config.folderMap).toEqual({
      '/assets': {
        path: path.join(CLIENT_ROOT, 'assets'),
        detectImmutableAssets: true,
      },
      '/.well-known': {
        path: path.join(CLIENT_ROOT, '.well-known'),
      },
    });
  });

  it('replaces the defaults with a custom config (no implicit /assets)', () => {
    const config = buildProdStaticRouterConfig(
      { folderMap: { '/downloads': '/data/downloads' } },
      {},
      CLIENT_ROOT,
      true,
    );

    expect(config.folderMap).toEqual({
      '/downloads': '/data/downloads',
    });
  });

  it('keeps the /assets default for a tuning-only custom config (no maps)', () => {
    const config = buildProdStaticRouterConfig(
      { cacheEntries: 500, positiveCacheTtl: 60_000 },
      { publicFiles: ['/favicon.svg'] },
      CLIENT_ROOT,
      true,
    );

    // Tuning fields pass through, but the config doesn't count as custom
    // maps, so the /assets default and public declarations still apply.
    expect(config.cacheEntries).toBe(500);
    expect(config.positiveCacheTtl).toBe(60_000);
    expect(config.folderMap).toEqual({
      '/assets': {
        path: path.join(CLIENT_ROOT, 'assets'),
        detectImmutableAssets: true,
      },
    });
    expect(config.singleAssetMap).toEqual({
      '/favicon.svg': path.join(CLIENT_ROOT, 'favicon.svg'),
    });
  });

  it('treats empty singleAssetMap/folderMap objects as tuning-only too', () => {
    const config = buildProdStaticRouterConfig(
      { singleAssetMap: {}, folderMap: {}, smallFileMaxSize: 1024 },
      {},
      CLIENT_ROOT,
      true,
    );

    expect(config.smallFileMaxSize).toBe(1024);
    expect(config.folderMap).toEqual({
      '/assets': {
        path: path.join(CLIENT_ROOT, 'assets'),
        detectImmutableAssets: true,
      },
    });
  });

  it('folds publicFiles and publicFolders into a custom config', () => {
    const config = buildProdStaticRouterConfig(
      { folderMap: { '/downloads': '/data/downloads' } },
      { publicFiles: ['/favicon.svg'], publicFolders: ['/.well-known'] },
      CLIENT_ROOT,
      true,
    );

    expect(config.folderMap).toEqual({
      '/downloads': '/data/downloads',
      '/.well-known': { path: path.join(CLIENT_ROOT, '.well-known') },
    });
    expect(config.singleAssetMap).toEqual({
      '/favicon.svg': path.join(CLIENT_ROOT, 'favicon.svg'),
    });
  });

  it('lets custom singleAssetMap/folderMap entries win over public declarations', () => {
    const config = buildProdStaticRouterConfig(
      {
        singleAssetMap: { '/robots.txt': '/elsewhere/robots.txt' },
        folderMap: { '/.well-known': '/elsewhere/well-known' },
      },
      {
        publicFiles: ['/robots.txt', '/favicon.svg'],
        publicFolders: ['/.well-known'],
      },
      CLIENT_ROOT,
      true,
    );

    expect(config.singleAssetMap).toEqual({
      '/favicon.svg': path.join(CLIENT_ROOT, 'favicon.svg'),
      '/robots.txt': '/elsewhere/robots.txt',
    });
    expect(config.folderMap).toEqual({
      '/.well-known': '/elsewhere/well-known',
    });
  });

  it('prefers custom compression over the server-wide default', () => {
    const config = buildProdStaticRouterConfig(
      { compression: false },
      {},
      CLIENT_ROOT,
      true,
    );

    expect(config.compression).toBe(false);
  });

  it('carries other custom options through', () => {
    const config = buildProdStaticRouterConfig(
      { cacheEntries: 7 },
      {},
      CLIENT_ROOT,
      true,
    );

    expect(config.cacheEntries).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// findShadowedPublicPaths()
// ---------------------------------------------------------------------------

describe('findShadowedPublicPaths()', () => {
  const clientRoot = '/fake/build/client';

  it('returns publicFiles entries overridden by explicit singleAssetMap keys', () => {
    expect(
      findShadowedPublicPaths(
        { singleAssetMap: { '/robots.txt': '/elsewhere/robots.txt' } },
        { publicFiles: ['/favicon.svg', '/robots.txt'] },
        clientRoot,
      ),
    ).toEqual(['/robots.txt']);
  });

  it('returns publicFolders entries overridden by explicit folderMap prefixes', () => {
    expect(
      findShadowedPublicPaths(
        { folderMap: { '/.well-known/': '/elsewhere' } },
        { publicFolders: ['/.well-known'] },
        clientRoot,
      ),
    ).toEqual(['/.well-known']);
  });

  it('counts folderMap keys with repeated slashes (the cache collapses them)', () => {
    // '//.well-known' normalizes to the same mount as '/.well-known' inside
    // StaticContentCache, so it shadows the declaration and must warn.
    expect(
      findShadowedPublicPaths(
        { folderMap: { '//.well-known': '/elsewhere' } },
        { publicFolders: ['/.well-known'] },
        clientRoot,
      ),
    ).toEqual(['/.well-known']);
  });

  it('counts custom keys given without a leading slash', () => {
    expect(
      findShadowedPublicPaths(
        { singleAssetMap: { 'robots.txt': '/elsewhere/robots.txt' } },
        { publicFiles: ['/robots.txt'] },
        clientRoot,
      ),
    ).toEqual(['/robots.txt']);
  });

  it('skips a same-directory folderMap entry that enables immutable detection', () => {
    // The documented pattern: enable detectImmutableAssets on a declared
    // public folder while keeping the declaration for the drift check.
    expect(
      findShadowedPublicPaths(
        {
          folderMap: {
            '/downloads': {
              path: `${clientRoot}/downloads`,
              detectImmutableAssets: true,
            },
          },
        },
        { publicFolders: ['/downloads'] },
        clientRoot,
      ),
    ).toEqual([]);
  });

  it('still reports a same-directory folderMap entry that changes nothing', () => {
    // Duplication with no effect — a plain string, a config without the
    // detection flag, and an explicit false all warn.
    expect(
      findShadowedPublicPaths(
        { folderMap: { '/downloads': `${clientRoot}/downloads` } },
        { publicFolders: ['/downloads'] },
        clientRoot,
      ),
    ).toEqual(['/downloads']);
    expect(
      findShadowedPublicPaths(
        { folderMap: { '/downloads': { path: `${clientRoot}/downloads` } } },
        { publicFolders: ['/downloads'] },
        clientRoot,
      ),
    ).toEqual(['/downloads']);
    expect(
      findShadowedPublicPaths(
        {
          folderMap: {
            '/downloads': {
              path: `${clientRoot}/downloads`,
              detectImmutableAssets: false,
            },
          },
        },
        { publicFolders: ['/downloads'] },
        clientRoot,
      ),
    ).toEqual(['/downloads']);
  });

  it('still reports folderMap entries pointing at a different directory', () => {
    // A different directory is a real conflict even with detection enabled.
    expect(
      findShadowedPublicPaths(
        {
          folderMap: {
            '/downloads': {
              path: '/elsewhere/downloads',
              detectImmutableAssets: true,
            },
          },
        },
        { publicFolders: ['/downloads'] },
        clientRoot,
      ),
    ).toEqual(['/downloads']);
  });

  it('singleAssetMap file shadows have no same-path exemption', () => {
    // A publicFiles entry duplicated as a singleAssetMap key is a shadow even
    // when it points at the same file — there are no per-file knobs to gain.
    expect(
      findShadowedPublicPaths(
        { singleAssetMap: { '/robots.txt': `${clientRoot}/robots.txt` } },
        { publicFiles: ['/robots.txt'] },
        clientRoot,
      ),
    ).toEqual(['/robots.txt']);
  });

  it('returns empty without overlap, custom config, or declarations', () => {
    expect(
      findShadowedPublicPaths(
        { singleAssetMap: { '/sitemap.xml': '/x/sitemap.xml' } },
        { publicFiles: ['/favicon.svg'] },
        clientRoot,
      ),
    ).toEqual([]);
    expect(
      findShadowedPublicPaths(
        undefined,
        { publicFiles: ['/favicon.svg'] },
        clientRoot,
      ),
    ).toEqual([]);
    expect(
      findShadowedPublicPaths(
        { singleAssetMap: { '/favicon.svg': '/x/favicon.svg' } },
        {},
        clientRoot,
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// validateProdAppStaticConfig()
// ---------------------------------------------------------------------------

describe('validateProdAppStaticConfig()', () => {
  it('throws when publicFiles is combined with staticContentRouter: false', () => {
    expect(() =>
      validateProdAppStaticConfig(
        'the default app',
        '/fake/build',
        'client',
        false,
        ['/favicon.svg'],
        undefined,
      ),
    ).toThrow(/staticContentRouter is false/);
  });

  it('throws when publicFolders is combined with staticContentRouter: false', () => {
    expect(() =>
      validateProdAppStaticConfig(
        'the default app',
        '/fake/build',
        'client',
        false,
        undefined,
        ['/.well-known'],
      ),
    ).toThrow(/staticContentRouter is false/);
  });

  it('allows staticContentRouter: false without public declarations', () => {
    expect(
      validateProdAppStaticConfig(
        'the default app',
        '/fake/build',
        'client',
        false,
        undefined,
        undefined,
      ),
    ).toEqual({ publicFiles: undefined, publicFolders: undefined });
  });

  it('returns normalized publicFiles and publicFolders', () => {
    expect(
      validateProdAppStaticConfig(
        'the default app',
        '/fake/build',
        'client',
        undefined,
        ['favicon.svg'],
        ['.well-known/'],
      ),
    ).toEqual({
      publicFiles: ['/favicon.svg'],
      publicFolders: ['/.well-known'],
    });
  });

  it('runs the root-mount guard against the custom folderMap', () => {
    expect(() =>
      validateProdAppStaticConfig(
        'the default app',
        '/fake/build',
        'client',
        { folderMap: { '/': '/fake/build/client' } },
        undefined,
        undefined,
      ),
    ).toThrow(/mounts the root/);
  });
});

// ---------------------------------------------------------------------------
// assertPublicPathsExist()
// ---------------------------------------------------------------------------

describe('assertPublicPathsExist()', () => {
  let tmpDir: TmpDir;

  beforeAll(async () => {
    // unsafeCleanup: the fixture files below are still there at cleanup time
    tmpDir = await createTempDir({
      prefix: 'unirend-public-paths-',
      unsafeCleanup: true,
    });
    await fs.promises.writeFile(
      path.join(tmpDir.path, 'favicon.svg'),
      '<svg/>',
    );
    await fs.promises.mkdir(path.join(tmpDir.path, 'icons'));
  });

  afterAll(async () => {
    await tmpDir.cleanup();
  });

  it('resolves when all declared files and folders exist', async () => {
    expect(
      await assertPublicPathsExist(
        { publicFiles: ['/favicon.svg'], publicFolders: ['/icons'] },
        tmpDir.path,
        'the default app',
      ),
    ).toBeUndefined();
  });

  it('throws listing every missing file', () => {
    expect(
      assertPublicPathsExist(
        { publicFiles: ['/favicon.svg', '/robots.txt', '/logo.svg'] },
        tmpDir.path,
        'the default app',
      ),
    ).rejects.toThrow(/\/robots\.txt[\s\S]*\/logo\.svg/);
  });

  it('flags file entries that exist but are directories', () => {
    expect(
      assertPublicPathsExist(
        { publicFiles: ['/icons'] },
        tmpDir.path,
        'the default app',
      ),
    ).rejects.toThrow(/not a file/);
  });

  it('flags missing folders and folder entries that are files', () => {
    expect(
      assertPublicPathsExist(
        { publicFolders: ['/.well-known'] },
        tmpDir.path,
        'the default app',
      ),
    ).rejects.toThrow(/\.well-known \(folder\)/);
    expect(
      assertPublicPathsExist(
        { publicFolders: ['/favicon.svg'] },
        tmpDir.path,
        'the default app',
      ),
    ).rejects.toThrow(/not a directory/);
  });
});

// ---------------------------------------------------------------------------
// Config-time integration via serveSSRBuilt() / registerBuiltApp()
// ---------------------------------------------------------------------------

describe('SSR server config-time static validation', () => {
  it('serveSSRBuilt throws on a traversal publicFiles entry', () => {
    expect(() =>
      serveSSRBuilt('/fake/build', { publicFiles: ['/../etc/passwd'] }),
    ).toThrow(/"\.\." path segment/);
  });

  it('serveSSRBuilt throws on a root publicFolders entry', () => {
    expect(() =>
      serveSSRBuilt('/fake/build', { publicFolders: ['/'] }),
    ).toThrow(/client build root/);
  });

  it('serveSSRBuilt throws on a root folderMap mount', () => {
    expect(() =>
      serveSSRBuilt('/fake/build', {
        staticContentRouter: { folderMap: { '/': '/fake/build/client' } },
      }),
    ).toThrow(/publicFiles/);
  });

  it('serveSSRBuilt throws when the folderMap targets the client build root', () => {
    expect(() =>
      serveSSRBuilt('/fake/build', {
        staticContentRouter: {
          folderMap: { '/static': '/fake/build/client' },
        },
      }),
    ).toThrow(/client build root/);
  });

  it('registerBuiltApp throws on invalid publicFiles for the added app', () => {
    const server = serveSSRBuilt('/fake/build');
    expect(() =>
      server.registerBuiltApp('marketing', '/fake/build-marketing', {
        publicFiles: ['/icons/'],
      }),
    ).toThrow(/app "marketing"/);
  });

  it('accepts a valid publicFiles/publicFolders config', () => {
    expect(() =>
      serveSSRBuilt('/fake/build', {
        publicFiles: ['/favicon.svg', '/favicon.ico', '/robots.txt'],
        publicFolders: ['/.well-known'],
      }),
    ).not.toThrow();
  });
});

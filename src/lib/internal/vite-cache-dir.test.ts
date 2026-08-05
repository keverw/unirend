import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { InlineConfig, Plugin } from 'vite';
import {
  cacheDirNameForKey,
  cacheKeyFromConfigFile,
  cacheKeyFromRoot,
  defaultViteCacheDir,
  resolveAppCacheDir,
  viteConfigCacheDirPlugin,
} from './vite-cache-dir';

/**
 * Invoke a plugin's `config` hook the way Vite does. Vite accepts both the bare
 * function and the `{ handler }` object form, so normalize before calling.
 */
function runConfigHook(plugin: Plugin, config: InlineConfig) {
  const hook = plugin.config;
  const handler = typeof hook === 'function' ? hook : hook?.handler;

  return (
    handler?.call(
      // The hooks here read only their `config` argument, so the plugin
      // context Vite would normally bind is unused.
      undefined as never,
      config,
      { command: 'serve', mode: 'development' } as never,
    ) ?? undefined
  );
}

describe('cacheDirNameForKey', () => {
  it('uses filesystem-safe keys verbatim', () => {
    expect(cacheDirNameForKey('__unidentified__')).toBe('__unidentified__');
    expect(cacheDirNameForKey('marketing')).toBe('marketing');
    expect(cacheDirNameForKey('app-b.v2')).toBe('app-b.v2');
  });

  it('sanitizes keys that are not usable as a directory name', () => {
    const name = cacheDirNameForKey('team/app b');

    expect(name).toMatch(/^team_app_b-[0-9a-f]{8}$/);
    expect(name).not.toContain('/');
  });

  it('never emits a traversal segment', () => {
    expect(cacheDirNameForKey('..')).toMatch(/^app-[0-9a-f]{8}$/);
    expect(cacheDirNameForKey('.')).toMatch(/^app-[0-9a-f]{8}$/);
    expect(cacheDirNameForKey('../../etc')).not.toContain('/');
  });

  it('transforms keys that Windows would strip a trailing dot from', () => {
    // Windows drops the trailing dot, so left verbatim these would be one
    // directory there and two everywhere else.
    expect(cacheDirNameForKey('admin.')).not.toBe('admin.');
    expect(cacheDirNameForKey('admin.')).not.toBe(cacheDirNameForKey('admin'));
    expect(cacheDirNameForKey('admin.')).toMatch(/^admin_-[0-9a-f]{8}$/);
  });

  it('transforms Windows reserved device names', () => {
    // These cannot be created as directories on Windows at all, with or
    // without an extension, in any casing.
    for (const reserved of ['con', 'PRN', 'aux', 'NUL', 'com1', 'lpt9']) {
      expect(cacheDirNameForKey(reserved)).toMatch(/-[0-9a-f]{8}$/);
    }
  });

  it('strips dots when transforming, so a reserved name cannot survive as the leading segment', () => {
    // Windows applies the device-name rule to the part before the first dot,
    // so `nul.cache-<digest>` would still be reserved. Dropping the dot is
    // what makes the digest actually rescue the name.
    const name = cacheDirNameForKey('nul.cache');

    expect(name).toMatch(/^nul_cache-[0-9a-f]{8}$/);
    expect(name).not.toContain('.');
  });

  it('leaves names that merely start with a reserved word alone', () => {
    // `console` and `command` are ordinary names — only the exact device
    // names, optionally with an extension, are reserved.
    expect(cacheDirNameForKey('console')).toBe('console');
    expect(cacheDirNameForKey('command')).toBe('command');
    expect(cacheDirNameForKey('com10')).toBe('com10');
  });

  it('falls back to "app" when the prefix would say nothing', () => {
    // The prefix is only there to be read. Once sanitizing has left no letters
    // or digits it carries no information the digest does not already hold, so
    // "app" is strictly more useful than a row of underscores. The empty key
    // additionally avoids a name starting with a dash, which reads as an
    // option on a command line.
    for (const key of ['', '///', '...', '   ', '-', '_-_']) {
      expect(cacheDirNameForKey(key)).toMatch(/^app-[0-9a-f]{8}$/);
    }
  });

  it('keeps a prefix that still holds something readable', () => {
    expect(cacheDirNameForKey('a/b')).toMatch(/^a_b-[0-9a-f]{8}$/);
    expect(cacheDirNameForKey('../../etc')).toMatch(/^_+etc-[0-9a-f]{8}$/);
  });

  it('keeps degenerate keys distinct from each other', () => {
    // They share the "app" prefix, so the digest is the only thing keeping
    // them apart — exactly the case it exists for.
    const names = ['', '///', '...', '   '].map(cacheDirNameForKey);

    expect(new Set(names).size).toBe(names.length);
  });

  it('bounds a long key instead of passing it through to fail later', () => {
    // Every character is safe, so nothing else here would transform it. Left
    // verbatim it would exceed the filesystem's 255-byte component limit and
    // fail when Vite created the optimizer cache, not when the name was built.
    const long = 'a'.repeat(300);
    const name = cacheDirNameForKey(long);

    expect(name).not.toBe(long);
    expect(name.length).toBeLessThanOrEqual(41);
    expect(name).toMatch(/^a{32}-[0-9a-f]{8}$/);
  });

  it('keeps long keys distinct once truncated', () => {
    // Truncation alone would map every key sharing a prefix onto one name,
    // which is the collision the digest is there to prevent.
    const a = cacheDirNameForKey(`${'a'.repeat(100)}-one`);
    const b = cacheDirNameForKey(`${'a'.repeat(100)}-two`);

    expect(a).not.toBe(b);
  });

  it('keeps a key at the length bound verbatim', () => {
    const atBound = 'a'.repeat(64);

    expect(cacheDirNameForKey(atBound)).toBe(atBound);
    expect(cacheDirNameForKey(`${atBound}a`)).not.toBe(`${atBound}a`);
  });

  it('produces a name that is itself safe', () => {
    // The transformed form has to survive the same check, or the digest just
    // moved the problem.
    for (const key of ['admin.', 'con', 'NUL.txt', '..', 'a/b', '...']) {
      expect(cacheDirNameForKey(cacheDirNameForKey(key))).toBe(
        cacheDirNameForKey(key),
      );
    }
  });

  it('keeps distinct keys distinct after sanitizing', () => {
    // Both sanitize to the same slug, so only the digest keeps them apart.
    // A collision here would put two apps back in one cache directory.
    expect(cacheDirNameForKey('a/b')).not.toBe(cacheDirNameForKey('a b'));
  });

  it('is stable for the same key', () => {
    expect(cacheDirNameForKey('a/b')).toBe(cacheDirNameForKey('a/b'));
  });
});

describe('directory resolution', () => {
  let tempDir: string;
  let repoDir: string;
  let appDir: string;

  beforeAll(async () => {
    // Real directories on disk: resolution walks the filesystem looking for
    // package.json, exactly as Vite's own resolution does.
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unirend-cache-dir-'));
    repoDir = path.join(tempDir, 'repo');
    appDir = path.join(repoDir, 'src', 'apps', 'web');

    await fs.mkdir(appDir, { recursive: true });
    // An ordinary folder whose name happens to begin with two dots, which is
    // legal everywhere and must not be mistaken for a step outside the package.
    await fs.mkdir(path.join(repoDir, '..admin'), { recursive: true });
    await fs.writeFile(path.join(repoDir, 'package.json'), '{}');
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('defaultViteCacheDir', () => {
    it('resolves to the nearest ancestor package.json', () => {
      expect(defaultViteCacheDir(appDir)).toBe(
        path.join(repoDir, 'node_modules', '.vite'),
      );
    });

    it('gives sibling app roots the same directory, which is the bug', () => {
      // Both apps live under one package.json, so Vite hands them the same
      // cache. This is what the per-app subdirectory exists to split up.
      expect(defaultViteCacheDir(appDir)).toBe(
        defaultViteCacheDir(path.join(repoDir, 'src', 'apps', 'admin')),
      );
    });
  });

  describe('resolveAppCacheDir', () => {
    it('nests the app directory inside the default cache directory', () => {
      expect(resolveAppCacheDir(appDir, 'web')).toBe(
        path.join(repoDir, 'node_modules', '.vite', 'web'),
      );
    });

    it('separates apps that share one package root', () => {
      const web = resolveAppCacheDir(appDir, 'web');
      const admin = resolveAppCacheDir(appDir, 'admin');

      expect(web).not.toBe(admin);
      expect(path.dirname(web)).toBe(path.dirname(admin));
    });
  });

  describe('cacheKeyFromRoot', () => {
    it('derives the app path relative to its package', () => {
      expect(cacheKeyFromRoot(appDir)).toBe('src/apps/web');
    });

    it('opts out when there is no root, since the cwd is not stable', () => {
      // Vite would fall back to the cwd, which names the same app differently
      // depending on where the process started and names different apps
      // identically when one server starts them all from the repo root.
      expect(cacheKeyFromRoot(undefined)).toBeNull();
    });

    it('opts out when the root is the package directory itself', () => {
      // Single-app project: the default cache is already unshared.
      expect(cacheKeyFromRoot(repoDir)).toBeNull();
    });

    it('keeps a directory whose name starts with two dots', () => {
      // `..admin` is inside the package, not a step above it. Treating it as
      // outside would drop the app onto the shared unidentified cache.
      expect(cacheKeyFromRoot(path.join(repoDir, '..admin'))).toBe('..admin');
    });
  });

  describe('cacheKeyFromConfigFile', () => {
    it('derives the config file path relative to its package, without the extension', () => {
      expect(
        cacheKeyFromConfigFile(path.join(repoDir, 'vite.marketing.config.ts')),
      ).toBe('vite.marketing.config');
    });

    it('separates configs that sit side by side in one folder', () => {
      // The case root cannot answer: same folder, same root, different config.
      expect(
        cacheKeyFromConfigFile(path.join(repoDir, 'vite.config.ts')),
      ).not.toBe(
        cacheKeyFromConfigFile(path.join(repoDir, 'vite.marketing.config.ts')),
      );
    });

    it('ignores the extension so .ts and .mts key the same', () => {
      expect(cacheKeyFromConfigFile(path.join(repoDir, 'vite.config.ts'))).toBe(
        cacheKeyFromConfigFile(path.join(repoDir, 'vite.config.mts')),
      );
    });

    it('keeps a config under a directory whose name starts with two dots', () => {
      expect(
        cacheKeyFromConfigFile(path.join(repoDir, '..admin', 'vite.config.ts')),
      ).toBe('..admin/vite.config');
    });

    it('treats an absent or disabled config file as nothing to derive from', () => {
      // `configFile: false` means there is no config file, not one named false.
      expect(cacheKeyFromConfigFile(undefined)).toBeNull();
      expect(cacheKeyFromConfigFile(false)).toBeNull();
      expect(cacheKeyFromConfigFile('')).toBeNull();
    });
  });

  describe('viteConfigCacheDirPlugin', () => {
    it('uses an explicit app key', () => {
      expect(
        runConfigHook(viteConfigCacheDirPlugin('admin'), { root: appDir }),
      ).toEqual({
        cacheDir: path.join(repoDir, 'node_modules', '.vite', 'admin'),
      });
    });

    it('falls back to a key derived from the root', () => {
      expect(
        runConfigHook(viteConfigCacheDirPlugin(undefined), { root: appDir }),
      ).toEqual({
        cacheDir: path.join(
          repoDir,
          'node_modules',
          '.vite',
          cacheDirNameForKey('src/apps/web'),
        ),
      });
    });

    it('uses the named unidentified cache when it has no key or usable root', () => {
      // Do not use Vite's bare default cache directly. This keeps all
      // Unirend-managed caches in subdirectories, although multiple apps in
      // this fallback still need explicit keys to be distinct.
      expect(runConfigHook(viteConfigCacheDirPlugin(undefined), {})).toEqual({
        cacheDir: resolveAppCacheDir(undefined, '__unidentified__'),
      });
    });

    it('falls back to the config file when several apps share one root', () => {
      // Both apps sit in the package directory itself, so root derives nothing
      // and the config file is the only thing telling them apart.
      const forConfig = (name: string) =>
        runConfigHook(viteConfigCacheDirPlugin(undefined), {
          root: repoDir,
          configFile: path.join(repoDir, name),
        });

      expect(forConfig('vite.config.ts')).toEqual({
        cacheDir: path.join(
          repoDir,
          'node_modules',
          '.vite',
          cacheDirNameForKey('vite.config'),
        ),
      });

      expect(forConfig('vite.config.ts')).not.toEqual(
        forConfig('vite.marketing.config.ts'),
      );
    });

    it('prefers the root over the config file so a key does not move', () => {
      // Vite leaves configFile undefined for an auto-discovered config, so
      // preferring it would key the same app differently under plain `vite`.
      expect(
        runConfigHook(viteConfigCacheDirPlugin(undefined), {
          root: appDir,
          configFile: path.join(appDir, 'vite.config.ts'),
        }),
      ).toEqual(
        runConfigHook(viteConfigCacheDirPlugin(undefined), { root: appDir }),
      );
    });

    it('treats a blank app key as no key rather than naming a directory after its digest', () => {
      expect(
        runConfigHook(viteConfigCacheDirPlugin('   '), { root: appDir }),
      ).toEqual({
        cacheDir: path.join(
          repoDir,
          'node_modules',
          '.vite',
          cacheDirNameForKey('src/apps/web'),
        ),
      });
    });

    it('applies with no root when an app key was given', () => {
      expect(runConfigHook(viteConfigCacheDirPlugin('admin'), {})).toEqual({
        cacheDir: resolveAppCacheDir(undefined, 'admin'),
      });
    });

    it('defers to a cacheDir the project set for itself', () => {
      // Vite merges a config hook's result over the user config, so returning
      // anything here would override the project's own choice.
      expect(
        runConfigHook(viteConfigCacheDirPlugin('admin'), {
          root: appDir,
          cacheDir: '/somewhere/else',
        }),
      ).toBeUndefined();
    });
  });
});

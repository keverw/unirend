import { describe, expect, it } from 'bun:test';
import type { Plugin, UserConfig } from 'vite';
import { withUnirendViteConfig } from './config-vite';
import { resolveAppCacheDir } from '../lib/internal/vite-cache-dir';

describe('withUnirendViteConfig', () => {
  it('adds unirend SSR package dedupe defaults', () => {
    const config = withUnirendViteConfig();

    expect(config.resolve?.dedupe).toEqual([
      'react',
      'react-dom',
      'react-router',
    ]);
    expect(config.ssr?.noExternal).toEqual(['unirend']);
  });

  it('merges with user resolve.alias config', () => {
    const config = withUnirendViteConfig({
      resolve: {
        alias: {
          '@': '/src',
        },
      },
    });

    expect(config.resolve?.alias).toEqual({
      '@': '/src',
    });
    expect(config.resolve?.dedupe).toEqual([
      'react',
      'react-dom',
      'react-router',
    ]);
  });

  it('preserves and deduplicates user dedupe entries', () => {
    const config = withUnirendViteConfig({
      resolve: {
        dedupe: ['react-router', 'scheduler'],
      },
    });

    expect(config.resolve?.dedupe).toEqual([
      'react',
      'react-dom',
      'react-router',
      'scheduler',
    ]);
  });

  it('preserves and deduplicates user ssr.noExternal array entries', () => {
    const config = withUnirendViteConfig({
      ssr: {
        noExternal: ['unirend', 'some-package'],
      },
    });

    expect(config.ssr?.noExternal).toEqual(['unirend', 'some-package']);
  });

  it('preserves user ssr.noExternal string entries', () => {
    const config = withUnirendViteConfig({
      ssr: {
        noExternal: 'some-package',
      },
    });

    expect(config.ssr?.noExternal).toEqual(['unirend', 'some-package']);
  });

  it('respects user ssr.noExternal true', () => {
    const config = withUnirendViteConfig({
      ssr: {
        noExternal: true,
      },
    });

    expect(config.ssr?.noExternal).toBe(true);
  });

  describe('per-app dep-optimizer cache', () => {
    // Vite's PluginOption is deeply recursive, so flatten through `unknown[]`
    // rather than the declared type — flat(Infinity) over it blows TypeScript's
    // instantiation depth limit.
    function flattenPlugins(config: UserConfig): Plugin[] {
      return ((config.plugins ?? []) as unknown[])
        .flat(Infinity)
        .filter(
          (plugin): plugin is Plugin =>
            typeof plugin === 'object' && plugin !== null && 'name' in plugin,
        );
    }

    function cacheDirPluginNames(config: UserConfig): string[] {
      return flattenPlugins(config)
        .map((plugin) => plugin.name)
        .filter((name) => name === 'unirend:per-app-cache-dir');
    }

    it('adds the cache directory plugin', () => {
      expect(cacheDirPluginNames(withUnirendViteConfig())).toEqual([
        'unirend:per-app-cache-dir',
      ]);
    });

    it('keeps the user plugins alongside it', () => {
      const userPlugin: Plugin = { name: 'user-plugin' };
      const config = withUnirendViteConfig({ plugins: [userPlugin] });

      expect(config.plugins).toContain(userPlugin);
      expect(cacheDirPluginNames(config)).toHaveLength(1);
    });

    it('points the app key at its own cache directory', () => {
      const config = withUnirendViteConfig(
        { root: import.meta.dirname },
        { appKey: 'admin' },
      );
      const [plugin] = flattenPlugins(config);
      const hook = plugin.config;
      const handler = typeof hook === 'function' ? hook : hook?.handler;
      const result = handler?.call(
        undefined as never,
        { root: import.meta.dirname },
        { command: 'serve', mode: 'development' } as never,
      );

      expect(result).toEqual({
        cacheDir: resolveAppCacheDir(import.meta.dirname, 'admin'),
      });
    });
  });
});

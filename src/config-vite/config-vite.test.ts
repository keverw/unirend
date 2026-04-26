import { describe, expect, it } from 'bun:test';
import { withUnirendViteConfig } from './config-vite';

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
});

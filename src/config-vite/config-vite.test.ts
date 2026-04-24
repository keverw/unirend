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
});

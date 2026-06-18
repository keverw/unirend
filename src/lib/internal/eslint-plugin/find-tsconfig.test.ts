import { beforeEach, describe, expect, it } from 'bun:test';
import { join } from 'path';
import { clearTsconfigDirCache, findNearestTsconfigDir } from './find-tsconfig';

// Build a fake existsSync backed by an explicit set of present files, counting
// calls so cache behavior can be asserted.
function fakeExists(presentFiles: string[]): {
  existsSync: (path: string) => boolean;
  callCount: () => number;
} {
  const present = new Set(presentFiles);
  let calls = 0;

  return {
    existsSync: (path: string): boolean => {
      calls++;

      return present.has(path);
    },
    callCount: (): number => calls,
  };
}

describe('findNearestTsconfigDir', () => {
  // The cache is process-global; isolate each test.
  beforeEach(() => {
    clearTsconfigDirCache();
  });

  it('returns the nearest ancestor with a tsconfig.json (the app dir)', () => {
    const { existsSync } = fakeExists([
      join('/repo/src/apps/blog', 'tsconfig.json'),
      join('/repo', 'tsconfig.json'),
    ]);

    expect(
      findNearestTsconfigDir('/repo/src/apps/blog/pages', existsSync),
    ).toBe('/repo/src/apps/blog');
  });

  it('falls back to the repo root when no app-level tsconfig exists', () => {
    const { existsSync } = fakeExists([join('/repo', 'tsconfig.json')]);

    expect(
      findNearestTsconfigDir('/repo/src/apps/blog/pages', existsSync),
    ).toBe('/repo');
  });

  it('returns null when no tsconfig is found up to the filesystem root', () => {
    const { existsSync } = fakeExists([]);

    expect(
      findNearestTsconfigDir('/repo/src/apps/blog', existsSync),
    ).toBeNull();
  });

  it('memoizes every directory walked, so sibling lookups need no new stats', () => {
    const { existsSync, callCount } = fakeExists([
      join('/repo/src/apps/blog', 'tsconfig.json'),
    ]);

    // First walk from pages/: stats pages → pages's parent (blog) → hit.
    expect(
      findNearestTsconfigDir('/repo/src/apps/blog/pages', existsSync),
    ).toBe('/repo/src/apps/blog');
    const afterFirst = callCount();
    expect(afterFirst).toBeGreaterThan(0);

    // Sibling under the same dir is fully cached — no further existsSync calls.
    expect(
      findNearestTsconfigDir('/repo/src/apps/blog/pages', existsSync),
    ).toBe('/repo/src/apps/blog');
    expect(callCount()).toBe(afterFirst);

    // A cousin whose nearest tsconfig is the same boundary also benefits: the
    // cached boundary short-circuits the walk before re-stating known dirs.
    expect(
      findNearestTsconfigDir(
        '/repo/src/apps/blog/components/Header',
        existsSync,
      ),
    ).toBe('/repo/src/apps/blog');
  });

  it('clearTsconfigDirCache forces a fresh walk', () => {
    const first = fakeExists([join('/repo', 'tsconfig.json')]);
    expect(findNearestTsconfigDir('/repo/src/x', first.existsSync)).toBe(
      '/repo',
    );

    clearTsconfigDirCache();

    // After clearing, a different filesystem is observed rather than the cache.
    const second = fakeExists([join('/repo/src', 'tsconfig.json')]);
    expect(findNearestTsconfigDir('/repo/src/x', second.existsSync)).toBe(
      '/repo/src',
    );
  });
});

import { describe, expect, it } from 'bun:test';
import { analyzeRelativeImport } from './analyze-import';

// A typical app file living under its own tsconfig boundary.
const importerFile = '/repo/src/apps/blog/pages/Home.tsx';
const boundaryDir = '/repo/src/apps/blog';

describe('analyzeRelativeImport', () => {
  it('leaves non-relative (bare/aliased) imports untouched', () => {
    for (const importSource of ['react', '@/libs/util', 'node:fs']) {
      expect(
        analyzeRelativeImport({ importerFile, importSource, boundaryDir }),
      ).toEqual({ shouldUseAlias: false });
    }
  });

  it('allows relative imports that stay within the boundary', () => {
    for (const importSource of [
      './Sibling',
      '../components/Header',
      '../Routes',
    ]) {
      expect(
        analyzeRelativeImport({ importerFile, importSource, boundaryDir }),
      ).toEqual({ shouldUseAlias: false });
    }
  });

  it('flags a relative import that escapes into shared src/libs', () => {
    expect(
      analyzeRelativeImport({
        importerFile,
        importSource: '../../../libs/format',
        boundaryDir,
      }),
    ).toEqual({ shouldUseAlias: true, aliasedSource: '@/libs/format' });
  });

  it('flags a relative import that escapes into a sibling app', () => {
    expect(
      analyzeRelativeImport({
        importerFile,
        importSource: '../../shop/utils/price',
        boundaryDir,
      }),
    ).toEqual({
      shouldUseAlias: true,
      aliasedSource: '@/apps/shop/utils/price',
    });
  });

  it('does not flag escapes that fall outside rootDir (no alias exists)', () => {
    // Resolves to /repo/scripts/seed — outside src/, so there is no `@/` form.
    expect(
      analyzeRelativeImport({
        importerFile,
        importSource: '../../../../scripts/seed',
        boundaryDir,
      }),
    ).toEqual({ shouldUseAlias: false });
  });

  it('honors custom rootDir and prefix', () => {
    expect(
      analyzeRelativeImport({
        importerFile: '/repo/app/features/foo/Foo.tsx',
        importSource: '../../shared/util',
        boundaryDir: '/repo/app/features/foo',
        rootDir: 'app',
        prefix: '~/',
      }),
    ).toEqual({ shouldUseAlias: true, aliasedSource: '~/shared/util' });
  });

  it('ignores a rootDir-named segment in the checkout path', () => {
    // Project cloned into a dir that itself contains "/src/" — the alias must
    // be built from the workspace's own src, not the outer one.
    expect(
      analyzeRelativeImport({
        importerFile: '/Users/me/src/my-app/src/apps/blog/pages/Home.tsx',
        importSource: '../../../libs/format',
        boundaryDir: '/Users/me/src/my-app/src/apps/blog',
      }),
    ).toEqual({ shouldUseAlias: true, aliasedSource: '@/libs/format' });
  });

  it('ignores a rootDir-named checkout segment for sibling-app escapes too', () => {
    expect(
      analyzeRelativeImport({
        importerFile: '/Users/me/src/my-app/src/apps/blog/pages/Home.tsx',
        importSource: '../../shop/utils/price',
        boundaryDir: '/Users/me/src/my-app/src/apps/blog',
      }),
    ).toEqual({
      shouldUseAlias: true,
      aliasedSource: '@/apps/shop/utils/price',
    });
  });

  it('normalizes Windows-style paths', () => {
    expect(
      analyzeRelativeImport({
        importerFile: 'C:\\repo\\src\\apps\\blog\\pages\\Home.tsx',
        importSource: '../../../libs/format',
        boundaryDir: 'C:\\repo\\src\\apps\\blog',
      }),
    ).toEqual({ shouldUseAlias: true, aliasedSource: '@/libs/format' });
  });
});

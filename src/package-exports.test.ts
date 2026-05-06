import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { basename, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import tsupConfig from '../tsup.config';

type PackageExport = {
  types: string;
  import: string;
  require: string;
};

type PackageJSON = {
  exports: Record<string, PackageExport>;
};

type TsupEntry = {
  entry?: string[] | Record<string, string>;
  outDir?: string;
  dts?: unknown;
};

type PublicLibraryEntry = TsupEntry & {
  entry: [string];
  outDir: string;
};

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const packageJSON = JSON.parse(
  readFileSync(join(repoRoot, 'package.json'), 'utf-8'),
) as PackageJSON;

// Normalize tsup's config shape so the test can handle either a single config
// object or the array of entrypoint configs this project currently uses.
const configs = (
  Array.isArray(tsupConfig) ? [...tsupConfig] : [tsupConfig]
) as TsupEntry[];

// Public library entrypoints are the tsup entries that emit declarations.
// The CLI is intentionally excluded because it is registered through `bin`,
// not through package `exports`.
const publicLibraryEntries = configs.filter(
  (config): config is PublicLibraryEntry =>
    config.dts !== false &&
    Array.isArray(config.entry) &&
    config.entry.length === 1 &&
    typeof config.outDir === 'string',
);

// Each public tsup entrypoint builds into dist/<subpath>/<entry-name>.*.
// Package exports must mirror that layout so documented imports like
// `unirend/build-info` resolve for ESM, CJS, and TypeScript consumers.
const expectedExports = Object.fromEntries(
  publicLibraryEntries.map((config) => {
    const outDir = config.outDir;
    const exportPath = `./${basename(outDir)}`;
    const fileName = basename(config.entry[0], '.ts');

    return [
      exportPath,
      {
        types: `./${outDir}/${fileName}.d.ts`,
        import: `./${outDir}/${fileName}.js`,
        require: `./${outDir}/${fileName}.cjs`,
      },
    ];
  }),
);

describe('package exports', () => {
  it('registers every public tsup library entrypoint', () => {
    expect(packageJSON.exports).toEqual(expectedExports);
  });
});

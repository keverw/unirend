import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import { checkNullBytes } from './check-null-bytes';

// ---------------------------------------------------------------------------
// checkNullBytes — run the exported check against a fake repo. The scaffolded
// scripts/check-null-bytes.ts is a thin wrapper over this function (asserted
// in starter-templates/templates-shared/check-null-bytes.test.ts), so its
// behavior is tested here at the function level.
//
// Every NUL below is written with the \u0000 escape rather than embedded
// literally, for exactly the reason the check exists: a literal one in this
// file would make git treat the test suite itself as binary and stop showing
// its diffs.
// ---------------------------------------------------------------------------

const NUL = '\u0000';

describe('checkNullBytes', () => {
  let tmpDir: TmpDir;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'unirend-check-null-bytes-',
      unsafeCleanup: true,
    });
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  async function write(relPath: string, content: string) {
    const filePath = path.join(tmpDir.path, ...relPath.split('/'));
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, content);
  }

  function run(options?: Parameters<typeof checkNullBytes>[0]) {
    const lines: string[] = [];

    return checkNullBytes({
      rootDir: tmpDir.path,
      log: (message) => lines.push(message),
      logError: (message) => lines.push(message),
      ...options,
    }).then((result) => ({ result, output: lines.join('\n') }));
  }

  test('passes a repo with no null bytes', async () => {
    await write('src/app.ts', 'const a = 1;\n');
    await write('README.md', '# hello\n');

    const { result, output } = await run();

    expect(result.success).toBe(true);
    expect(result.offenders).toEqual([]);
    expect(result.scannedCount).toBe(2);
    expect(output).toContain('null-byte check passed');
  });

  test('fails and reports the file and line of the first null byte', async () => {
    await write('src/app.ts', `const a = 1;\nconst b = \`x${NUL}y\`;\n`);

    const { result, output } = await run();

    expect(result.success).toBe(false);
    expect(result.offenders).toEqual([
      { file: 'src/app.ts', line: 2, count: 1 },
    ]);
    // The byte is invisible on screen, so the line number is what makes the
    // report actionable.
    expect(output).toContain('src/app.ts:2');
    expect(output).toContain('null-byte check failed');
  });

  test('counts multiple occurrences but reports the first line', async () => {
    await write('a.ts', `one${NUL}\ntwo\nthree${NUL}\n`);

    const { result, output } = await run();

    expect(result.offenders).toEqual([{ file: 'a.ts', line: 1, count: 2 }]);
    expect(output).toContain('(2 occurrences)');
  });

  test('scans every TypeScript and JavaScript module extension', async () => {
    // The ESM/CJS-specific variants are easy to leave out of the allowlist,
    // and a missing one is silent: the file is skipped and the run still
    // reports success, which is the failure mode this whole check exists to
    // prevent.
    for (const ext of ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs']) {
      await write(`src/app.${ext}`, `x${NUL}`);
    }

    const { result } = await run();

    expect(result.offenders.map((offender) => offender.file)).toEqual([
      'src/app.cjs',
      'src/app.cts',
      'src/app.js',
      'src/app.jsx',
      'src/app.mjs',
      'src/app.mts',
      'src/app.ts',
      'src/app.tsx',
    ]);
  });

  test('ignores binary files, which legitimately contain null bytes', async () => {
    // The allowlist is the point: a .png full of NULs is not a source bug.
    await write('logo.png', `PNG${NUL}${NUL}data`);
    await write('fonts/x.woff2', `wOF2${NUL}`);

    const { result } = await run();

    expect(result.success).toBe(true);
    expect(result.scannedCount).toBe(0);
  });

  test('skips dependency and build directories', async () => {
    await write('node_modules/pkg/index.js', `x${NUL}`);
    await write('dist/bundle.js', `x${NUL}`);
    await write('vendor/lib.php', `<?php ${NUL}`);
    await write('src/ok.ts', 'fine\n');

    const { result } = await run();

    expect(result.success).toBe(true);
    expect(result.scannedCount).toBe(1);
  });

  test('scans dotfiles that have no separate extension', async () => {
    await write('.gitignore', `node_modules${NUL}\n`);

    const { result } = await run();

    expect(result.success).toBe(false);
    expect(result.offenders[0].file).toBe('.gitignore');
  });

  test('scans common extensionless text files and text lockfiles', async () => {
    await write('Dockerfile', `FROM oven/bun${NUL}\n`);
    await write('LICENSE', `All rights reserved${NUL}\n`);
    await write('bun.lock', `{${NUL}}\n`);

    const { result } = await run();

    expect(result.success).toBe(false);
    expect(result.offenders.map((offender) => offender.file)).toEqual([
      'bun.lock',
      'Dockerfile',
      'LICENSE',
    ]);
  });

  test('extraFileNames adds an extensionless text file', async () => {
    await write('Justfile', `build:${NUL}\n`);

    expect((await run()).result.success).toBe(true);

    const withExtra = await run({ extraFileNames: ['Justfile'] });
    expect(withExtra.result.success).toBe(false);
    expect(withExtra.result.offenders[0].file).toBe('Justfile');
  });

  test('fileNames replaces the built-in exact-name list', async () => {
    await write('Dockerfile', `FROM oven/bun${NUL}\n`);
    await write('Justfile', `build:${NUL}\n`);

    const { result } = await run({ fileNames: ['Justfile'] });

    expect(result.offenders.map((offender) => offender.file)).toEqual([
      'Justfile',
    ]);
  });

  test('extraExtensions adds a format without restating the defaults', async () => {
    await write('config.custom', `x${NUL}`);
    await write('src/app.ts', 'fine\n');

    const withoutExtra = await run();
    expect(withoutExtra.result.success).toBe(true);

    const withExtra = await run({ extraExtensions: ['custom'] });
    expect(withExtra.result.success).toBe(false);
    expect(withExtra.result.offenders[0].file).toBe('config.custom');
    // The defaults are still in effect alongside it.
    expect(withExtra.result.scannedCount).toBe(2);
  });

  test('extensions replaces the built-in list entirely', async () => {
    await write('src/app.ts', `x${NUL}`);
    await write('notes.txt', `y${NUL}`);

    const { result } = await run({ extensions: ['txt'] });

    expect(result.scannedCount).toBe(1);
    expect(result.offenders).toEqual([
      { file: 'notes.txt', line: 1, count: 1 },
    ]);
  });

  test('reports offenders sorted by path', async () => {
    await write('z.ts', `${NUL}`);
    await write('a.ts', `${NUL}`);
    await write('m.ts', `${NUL}`);

    const { result } = await run();

    expect(result.offenders.map((entry) => entry.file)).toEqual([
      'a.ts',
      'm.ts',
      'z.ts',
    ]);
  });

  test('passes cleanly on an empty repo', async () => {
    const { result } = await run();

    expect(result.success).toBe(true);
    expect(result.scannedCount).toBe(0);
  });
});

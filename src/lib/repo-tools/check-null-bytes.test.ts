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

  test('skips dependency directories by name, without any ignore rules', async () => {
    // The short built-in list is insurance for a project with no .gitignore:
    // a dependency directory is never hand-authored and is enormous, so
    // walking one is pure cost no matter what the rules say.
    await write('node_modules/pkg/index.js', `x${NUL}`);
    await write('vendor/lib.php', `<?php ${NUL}`);
    await write('src/ok.ts', 'fine\n');

    const { result } = await run();

    expect(result.success).toBe(true);
    expect(result.scannedCount).toBe(1);
  });

  test('leaves build output to the ignore rules rather than the name list', async () => {
    // `dist` and `build` are deliberately NOT skipped by name: those are the
    // names that collide with committed source. With no rule saying otherwise
    // they get scanned, which is the safe direction, and one line of
    // .gitignore is what excludes real output.
    await write('dist/bundle.js', `x${NUL}`);

    const withoutRules = await run();
    expect(withoutRules.result.offenders.map((entry) => entry.file)).toEqual([
      'dist/bundle.js',
    ]);

    await write('.gitignore', 'dist/\n');

    const withRules = await run();
    expect(withRules.result.success).toBe(true);
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

  test('does not follow a symlink out of the tree', async () => {
    // readdir reports a symlink as neither file nor directory, so it is never
    // collected. That matters because the target can sit outside the repo
    // entirely, and git stores the target PATH for a link rather than its
    // contents, so a NUL over there is not a NUL in this repo.
    const outside = await createTempDir({
      prefix: 'unirend-null-bytes-outside-',
      unsafeCleanup: true,
    });

    try {
      const target = path.join(outside.path, 'target.ts');
      await fs.promises.writeFile(target, `secret${NUL}`);
      await fs.promises.symlink(target, path.join(tmpDir.path, 'link.ts'));
      await write('real.ts', 'fine\n');

      const { result } = await run();

      expect(result.success).toBe(true);
      expect(result.scannedCount).toBe(1);
    } finally {
      await outside.cleanup();
    }
  });

  describe('gitignore rules', () => {
    test('skips files an ignore rule excludes', async () => {
      await write('.gitignore', 'secret.ts\n');
      await write('secret.ts', `x${NUL}`);
      await write('kept.ts', 'fine\n');

      const { result } = await run();

      expect(result.success).toBe(true);
      expect(result.scannedCount).toBe(2);
    });

    test('tells two directories of the same name apart', async () => {
      // The reason rules beat a name list. Both directories are called
      // "build"; only the ignore rules say which one is generated output and
      // which is committed source. A skip-by-name list hides both, which is
      // how a NUL in a tracked fixture went unreported while the check passed.
      await write('.gitignore', 'demos/*/build/\n');
      await write('demos/ssg/build/generated.js', `output${NUL}`);
      await write('tests/fixtures/build/page.html', `<p>x${NUL}</p>`);

      const { result } = await run();

      expect(result.offenders.map((entry) => entry.file)).toEqual([
        'tests/fixtures/build/page.html',
      ]);
    });

    test('honors a negation that re-includes an ignored directory', async () => {
      // The shape this repo needs: a broad rule excludes every "build", and a
      // negation rescues the one holding committed fixtures. The directory has
      // to be re-included before its contents, because neither git nor this
      // walk descends into an excluded directory to reconsider what is inside.
      await write('.gitignore', 'build/\n!/keep/build/\n!/keep/build/**\n');
      await write('gen/build/out.js', `x${NUL}`);
      await write('keep/build/fixture.html', `y${NUL}`);

      const { result } = await run();

      expect(result.offenders.map((entry) => entry.file)).toEqual([
        'keep/build/fixture.html',
      ]);
    });

    test('a nested gitignore overrides a broader rule above it', async () => {
      // Git reads every .gitignore from the root down and lets the deepest one
      // win, which is why the rules are consulted deepest-first rather than
      // merged into one list.
      await write('.gitignore', '*.txt\n');
      await write('logs/.gitignore', '!keep.txt\n');
      await write('logs/keep.txt', `kept${NUL}`);
      await write('logs/drop.txt', `dropped${NUL}`);

      const { result } = await run();

      expect(result.offenders.map((entry) => entry.file)).toEqual([
        'logs/keep.txt',
      ]);
    });

    test('applies .git/info/exclude alongside .gitignore', async () => {
      // The per-clone rule file, deliberately kept out of version control.
      await fs.promises.mkdir(path.join(tmpDir.path, '.git', 'info'), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(tmpDir.path, '.git', 'info', 'exclude'),
        'local-only.ts\n',
      );
      await write('local-only.ts', `x${NUL}`);
      await write('shared.ts', 'fine\n');

      const { result } = await run();

      expect(result.success).toBe(true);
      expect(result.scannedCount).toBe(1);
    });

    test('lets .gitignore override .git/info/exclude, not the reverse', async () => {
      // Git ranks a repository's .gitignore ABOVE the per-clone exclude file,
      // so a negation in .gitignore rescues a file the exclude list dropped.
      // With last-match-wins that is purely a question of load order, and
      // getting it backwards silently skips a file git would show.
      await fs.promises.mkdir(path.join(tmpDir.path, '.git', 'info'), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(tmpDir.path, '.git', 'info', 'exclude'),
        'fixture.ts\n',
      );
      await write('.gitignore', '!fixture.ts\n');
      await write('fixture.ts', `x${NUL}`);

      const { result } = await run();

      expect(result.offenders.map((entry) => entry.file)).toEqual([
        'fixture.ts',
      ]);
    });

    test('follows a .git file to the common dir for info/exclude', async () => {
      // A linked worktree (git worktree add) and a submodule both have .git as
      // a FILE holding a "gitdir:" pointer, so <root>/.git/info/exclude does
      // not exist there at all. Reading it naively means every locally excluded
      // file gets scanned, and can be reported, in exactly the checkouts where
      // nobody would think to look. The worktree's own git dir holds only
      // per-worktree state, with the shared one named by commondir, and git
      // honors only that one (verified against git 2.51).
      const gitDir = path.join(tmpDir.path, 'git-dirs', 'linked');
      const commonDir = path.join(tmpDir.path, 'git-dirs', 'common');

      await fs.promises.mkdir(path.join(commonDir, 'info'), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(commonDir, 'info', 'exclude'),
        'local-only.ts\n',
      );

      // Where the shared dir lives, written relative as git writes it.
      await fs.promises.mkdir(gitDir, { recursive: true });
      await fs.promises.writeFile(
        path.join(gitDir, 'commondir'),
        '../common\n',
      );
      await write('.git', `gitdir: ${gitDir}\n`);

      await write('local-only.ts', `x${NUL}`);
      await write('shared.ts', 'fine\n');

      const { result } = await run();

      expect(result.success).toBe(true);
      expect(result.scannedCount).toBe(1);
    });

    test('reads info/exclude from the git dir itself when there is no commondir', async () => {
      // A submodule's .git file points at a git dir that IS the common one, so
      // there is no commondir to follow and info/exclude sits right there.
      const gitDir = path.join(tmpDir.path, 'modules', 'sub');

      await fs.promises.mkdir(path.join(gitDir, 'info'), { recursive: true });
      await fs.promises.writeFile(
        path.join(gitDir, 'info', 'exclude'),
        'local-only.ts\n',
      );
      await write('.git', `gitdir: ${gitDir}\n`);

      await write('local-only.ts', `x${NUL}`);
      await write('shared.ts', 'fine\n');

      const { result } = await run();

      expect(result.success).toBe(true);
      expect(result.scannedCount).toBe(1);
    });

    test('ignores a .git file that points nowhere useful', async () => {
      // A malformed or dangling pointer should leave the scan running on
      // .gitignore alone rather than throwing: this check is about file
      // contents, and a broken git dir is not its problem to report.
      await write('.git', 'not a gitdir line\n');
      await write('.gitignore', 'skipped.ts\n');
      await write('skipped.ts', `x${NUL}`);
      await write('scanned.ts', `x${NUL}`);

      const { result } = await run();

      expect(result.offenders.map((entry) => entry.file)).toEqual([
        'scanned.ts',
      ]);
    });

    test('treats leading whitespace in a pattern as significant', async () => {
      // Git does not strip it: " leading.ts" names a file whose name starts
      // with a space and does NOT match "leading.ts" (verified). Trimming the
      // line before handing it over would quietly widen the rule to both.
      await write('sub/.gitignore', ' leading.ts\n');
      await write('sub/leading.ts', `x${NUL}`);
      await write('sub/ leading.ts', `y${NUL}`);

      const { result } = await run();

      expect(result.offenders.map((entry) => entry.file)).toEqual([
        'sub/leading.ts',
      ]);
    });

    test('scans everything when there are no ignore rules at all', async () => {
      await write('src/app.ts', `x${NUL}`);

      const { result } = await run();

      expect(result.offenders.map((entry) => entry.file)).toEqual([
        'src/app.ts',
      ]);
    });

    test('skipDirectories applies on top of the rules', async () => {
      await write('fixtures/bad.ts', `x${NUL}`);

      const { result } = await run({ skipDirectories: ['fixtures'] });

      expect(result.success).toBe(true);
    });
  });
});

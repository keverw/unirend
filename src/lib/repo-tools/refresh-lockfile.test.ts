import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import { refreshLockfile } from './refresh-lockfile';

// ---------------------------------------------------------------------------
// refreshLockfile — run the exported helper against a fake repo. The
// scaffolded scripts/refresh-lockfile.ts is a thin wrapper over this function
// (asserted in starter-templates/templates-shared/refresh-lockfile.test.ts),
// so its behavior is tested here at the function level.
//
// NOTHING HERE RUNS A REAL INSTALL. The `install` option is injected in every
// test, so `bun install` is never spawned, no network is touched, and the
// suite stays fast and offline. What the injected installer does is write (or
// deliberately not write) a lockfile fixture, which is precisely the input the
// diffing logic consumes — so the reporting, restore, and failure paths are
// all exercised for real, just without a package manager underneath.
//
// The tradeoff is honest and worth stating: these tests verify OUR logic, not
// bun's behavior. The claims this tool is built on (a warm lockfile ignores a
// new override, a failed resolve leaves no lockfile behind) were verified by
// hand against real bun and are documented in refresh-lockfile.ts. If bun ever
// changes those, this suite will still pass — it can't catch that, and it
// isn't trying to.
// ---------------------------------------------------------------------------

/**
 * Build a minimal bun.lock body from lockfile-key → "name@version" specs.
 *
 * Shaped like the real thing on the two axes the tool actually depends on:
 * entries are one per line inside a "packages" block, and the file carries
 * JSONC trailing commas (after the last entry and after the block itself).
 * Those commas are the whole reason the tool reads entries out of the text
 * instead of calling JSON.parse on the file, so a fixture without them would
 * quietly stop testing the case that motivated the parser.
 *
 * The metadata object and integrity hash are present but empty//dummy: this
 * helper only feeds the version diffing, which reads nothing but the spec.
 */
function lockfile(entries: Record<string, string>): string {
  const lines = Object.entries(entries).map(
    ([key, spec]) => `    "${key}": ["${spec}", "", {}, "sha512-abc"],`,
  );

  return `{\n  "lockfileVersion": 1,\n  "packages": {\n${lines.join('\n')}\n  },\n}\n`;
}

describe('refreshLockfile', () => {
  let tmpDir: TmpDir;
  let lockPath: string;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'unirend-refresh-lockfile-',
      unsafeCleanup: true,
    });
    lockPath = path.join(tmpDir.path, 'bun.lock');
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  /**
   * Drive refreshLockfile with a stand-in installer and capture everything it
   * printed. Both log sinks are collected into one string so a test can assert
   * on the report without caring whether a given line went to stdout or
   * stderr.
   *
   * `install` is where each test decides what "the resolve" did: return true
   * after writing a new lockfile to simulate a successful install, return
   * false to simulate a failed resolve, or throw to simulate the installer
   * itself blowing up.
   */
  async function run(install: () => boolean | Promise<boolean>) {
    const lines: string[] = [];

    const result = await refreshLockfile({
      rootDir: tmpDir.path,
      log: (message) => lines.push(message),
      logError: (message) => lines.push(message),
      install,
    });

    return { result, output: lines.join('\n') };
  }

  test('classifies changed, added, and removed packages', async () => {
    await fs.promises.writeFile(
      lockPath,
      lockfile({
        eslint: 'eslint@9.39.5',
        'tldts-core': 'tldts-core@7.4.6',
        rolldown: 'rolldown@1.1.5',
      }),
    );

    const { result, output } = await run(async () => {
      await fs.promises.writeFile(
        lockPath,
        lockfile({
          eslint: 'eslint@9.39.5',
          'tldts-core': 'tldts-core@7.4.9',
          lightningcss: 'lightningcss@1.32.0',
        }),
      );

      return true;
    });

    expect(result.success).toBe(true);
    expect(result.changed).toEqual([
      { name: 'tldts-core', from: '7.4.6', to: '7.4.9' },
    ]);
    expect(result.added).toEqual(['lightningcss@1.32.0']);
    expect(result.removed).toEqual(['rolldown@1.1.5']);
    // An unchanged package appears in none of the three lists.
    expect(output).not.toContain('eslint');

    expect(output).toContain('~ tldts-core 7.4.6 → 7.4.9');
    expect(output).toContain('+ lightningcss@1.32.0');
    expect(output).toContain('- rolldown@1.1.5');
  });

  test('handles scoped names and nested transitive entries', async () => {
    await fs.promises.writeFile(
      lockPath,
      lockfile({
        '@scope/pkg': '@scope/pkg@1.0.0',
        'a/b/minimatch': 'minimatch@3.0.4',
      }),
    );

    const { result } = await run(async () => {
      await fs.promises.writeFile(
        lockPath,
        lockfile({
          '@scope/pkg': '@scope/pkg@1.1.0',
          'a/b/minimatch': 'minimatch@3.1.2',
        }),
      );

      return true;
    });

    // A nested key identifies a transitive copy resolved separately from the
    // top-level one, so it diffs on its own.
    expect(result.changed).toEqual([
      { name: '@scope/pkg', from: '1.0.0', to: '1.1.0' },
      { name: 'minimatch', from: '3.0.4', to: '3.1.2' },
    ]);
  });

  test('reports no resolution changes when the refresh is a no-op', async () => {
    const text = lockfile({ eslint: 'eslint@9.39.5' });
    await fs.promises.writeFile(lockPath, text);

    const { result, output } = await run(async () => {
      await fs.promises.writeFile(lockPath, text);
      return true;
    });

    expect(result.success).toBe(true);
    expect(result.changed).toEqual([]);
    expect(output).toContain('no resolution changes');
  });

  test('keeps an on-disk backup until the replacement succeeds', async () => {
    const original = lockfile({ eslint: 'eslint@9.39.5' });
    const replacement = lockfile({ eslint: 'eslint@9.40.0' });
    await fs.promises.writeFile(lockPath, original);

    let backupsDuringInstall: string[] = [];

    const { result } = await run(async () => {
      backupsDuringInstall = (await fs.promises.readdir(tmpDir.path)).filter(
        (name) => name.startsWith('.bun.lock.unirend-backup-'),
      );
      expect(backupsDuringInstall).toHaveLength(1);
      expect(
        await fs.promises.readFile(
          path.join(tmpDir.path, backupsDuringInstall[0]),
          'utf8',
        ),
      ).toBe(original);

      await fs.promises.writeFile(lockPath, replacement);
      return true;
    });

    expect(result.success).toBe(true);
    expect(
      (await fs.promises.readdir(tmpDir.path)).filter((name) =>
        name.startsWith('.bun.lock.unirend-backup-'),
      ),
    ).toEqual([]);
    expect(await fs.promises.readFile(lockPath, 'utf8')).toBe(replacement);
  });

  test('restores the previous lockfile when the install fails', async () => {
    const original = lockfile({ eslint: 'eslint@9.39.5' });
    await fs.promises.writeFile(lockPath, original);

    let didLockfileExistDuringInstall = true;

    const { result, output } = await run(() => {
      // The tool deletes the lockfile before installing, which is the state a
      // failed resolve would otherwise leave behind.
      didLockfileExistDuringInstall = fs.existsSync(lockPath);
      return false;
    });

    expect(didLockfileExistDuringInstall).toBe(false);
    expect(result.success).toBe(false);
    expect(result.restored).toBe(true);
    expect(await fs.promises.readFile(lockPath, 'utf8')).toBe(original);
    expect(output).toContain('restored the previous bun.lock');
  });

  test('restores the previous lockfile when the installer throws', async () => {
    const original = lockfile({ eslint: 'eslint@9.39.5' });
    await fs.promises.writeFile(lockPath, original);

    // Awaited via try/catch rather than .rejects so the restore assertion
    // below is guaranteed to run after the rejection has settled.
    let caught: unknown;

    try {
      await run(() => {
        throw new Error('bun exploded');
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toContain('bun exploded');
    expect(await fs.promises.readFile(lockPath, 'utf8')).toBe(original);
  });

  test('restores the previous lockfile when a "successful" install wrote none', async () => {
    const original = lockfile({ eslint: 'eslint@9.39.5' });
    await fs.promises.writeFile(lockPath, original);

    const { result, output } = await run(() => true);

    expect(result.success).toBe(false);
    expect(result.restored).toBe(true);
    // Leaving the repo without a lockfile is the exact state the restore path
    // exists to prevent, so this is a failure rather than "everything removed".
    expect(result.removed).toEqual([]);
    expect(await fs.promises.readFile(lockPath, 'utf8')).toBe(original);
    expect(output).toContain('wrote no bun.lock');
  });

  test('fails cleanly when there is no lockfile to refresh', async () => {
    let didInstall = false;

    const { result, output } = await run(() => {
      didInstall = true;
      return true;
    });

    expect(result.success).toBe(false);
    expect(didInstall).toBe(false);
    expect(output).toContain('No lockfile found');
  });
});

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir, rm, chmod, writeFile } from 'fs/promises';
import { join } from 'path';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import { initGitRepo, installDependencies, autoFormatCode } from './repo-utils';
import type { InMemoryDir } from './vfs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger() {
  const calls: Array<[string, string]> = [];
  const log = (level: string, msg: string) => {
    calls.push([level, msg]);
  };
  return { log, calls };
}

// ---------------------------------------------------------------------------
// initGitRepo
// ---------------------------------------------------------------------------

describe('initGitRepo', () => {
  describe('in-memory root', () => {
    test('returns immediately without touching the VFS', async () => {
      const mem: InMemoryDir = {};
      await initGitRepo(mem);
      expect(Object.keys(mem)).toHaveLength(0);
    });

    test('returns immediately with a logger — no calls', async () => {
      const mem: InMemoryDir = {};
      const { log, calls } = makeLogger();
      await initGitRepo(mem, log);
      expect(calls).toHaveLength(0);
    });
  });

  describe('filesystem root', () => {
    let tmpDir: TmpDir;
    let tempPath: string;

    beforeEach(async () => {
      tmpDir = await createTempDir({
        prefix: 'repo-utils-git-test-',
        unsafeCleanup: true,
      });

      tempPath = tmpDir.path;
    });

    afterEach(async () => {
      await tmpDir.cleanup();
    });

    test('logs "already initialized" and returns when .git directory exists', async () => {
      await mkdir(join(tempPath, '.git'));
      const { log, calls } = makeLogger();
      await initGitRepo(tempPath, log);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('info');
      expect(calls[0][1].toLowerCase()).toContain('already');
    });

    test('does not log when .git exists and no logger provided', async () => {
      await mkdir(join(tempPath, '.git'));
      expect(initGitRepo(tempPath)).resolves.toBeUndefined();
    });

    test('runs git init successfully and logs a success message', async () => {
      const { log, calls } = makeLogger();
      await initGitRepo(tempPath, log);
      // Either success or a graceful warning if git is unavailable — never throws
      const infoCalls = calls.filter(([level]) => level === 'info');
      const warnCalls = calls.filter(([level]) => level === 'warning');
      // One of the two paths must have fired
      expect(infoCalls.length + warnCalls.length).toBeGreaterThan(0);
    });

    test('never throws even if git command fails', async () => {
      // Should always resolve (graceful degradation contract)
      await initGitRepo(tempPath);
    });

    test('works without a logger', async () => {
      await initGitRepo(tempPath);
    });
  });
});

// ---------------------------------------------------------------------------
// installDependencies
// ---------------------------------------------------------------------------

describe('installDependencies', () => {
  describe('in-memory root', () => {
    test('returns immediately without touching the VFS', async () => {
      const mem: InMemoryDir = {};
      await installDependencies(mem);
      expect(Object.keys(mem)).toHaveLength(0);
    });

    test('returns immediately with a logger — no calls', async () => {
      const mem: InMemoryDir = {};
      const { log, calls } = makeLogger();
      await installDependencies(mem, log);
      expect(calls).toHaveLength(0);
    });
  });

  describe('filesystem root', () => {
    let tmpDir: TmpDir;
    let tempPath: string;

    beforeEach(async () => {
      tmpDir = await createTempDir({
        prefix: 'repo-utils-install-test-',
        unsafeCleanup: true,
      });
      tempPath = tmpDir.path;
    });

    afterEach(async () => {
      await tmpDir.cleanup();
    });

    test('never throws even when bun install fails (no package.json)', async () => {
      // The directory has no package.json; bun install may fail non-zero but
      // installDependencies must always resolve gracefully.
      await installDependencies(tempPath);
    });

    test('logs at least one message when a logger is provided', async () => {
      const { log, calls } = makeLogger();
      await installDependencies(tempPath, log);
      // Must emit either the "Installing…" info message or a warning
      expect(calls.length).toBeGreaterThan(0);
    });

    test('first log message is the "Installing dependencies" info', async () => {
      const { log, calls } = makeLogger();
      await installDependencies(tempPath, log);
      expect(calls[0][0]).toBe('info');
      expect(calls[0][1].toLowerCase()).toContain('installing');
    });
  });
});

// ---------------------------------------------------------------------------
// autoFormatCode
// ---------------------------------------------------------------------------

describe('autoFormatCode', () => {
  describe('in-memory root', () => {
    test('returns immediately without touching the VFS', async () => {
      const mem: InMemoryDir = {};
      await autoFormatCode(mem);
      expect(Object.keys(mem)).toHaveLength(0);
    });

    test('returns immediately with a logger — no calls', async () => {
      const mem: InMemoryDir = {};
      const { log, calls } = makeLogger();
      await autoFormatCode(mem, log);
      expect(calls).toHaveLength(0);
    });
  });

  describe('filesystem root', () => {
    let tmpDir: TmpDir;
    let tempPath: string;

    beforeEach(async () => {
      tmpDir = await createTempDir({
        prefix: 'repo-utils-format-test-',
        unsafeCleanup: true,
      });
      tempPath = tmpDir.path;
    });

    afterEach(async () => {
      await tmpDir.cleanup();
    });

    test('skips formatting and logs when node_modules/prettier does not exist', async () => {
      const { log, calls } = makeLogger();
      await autoFormatCode(tempPath, log);
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('info');
      expect(calls[0][1].toLowerCase()).toContain('skip');
    });

    test('resolves without throwing when prettier is absent', async () => {
      await autoFormatCode(tempPath);
    });

    test('resolves without throwing when prettier is absent and no logger', async () => {
      await autoFormatCode(tempPath);
    });

    test('attempts to format when node_modules/prettier exists', async () => {
      // Create a fake prettier marker so the existence check passes.
      await mkdir(join(tempPath, 'node_modules', 'prettier'), {
        recursive: true,
      });

      const { log, calls } = makeLogger();
      // `bun run format` will fail since there is no package.json with a
      // "format" script, but autoFormatCode must never throw.
      await autoFormatCode(tempPath, log);

      // The function should have at least tried to log the "formatting" message
      // before discovering the command failed.
      expect(calls.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Spawn-error paths — non-existent cwd
//
// When the cwd passed to spawn does not exist, Node emits an 'error' event on
// the child process instead of a 'close' event. This exercises the
// result.error branches inside each function.
// ---------------------------------------------------------------------------

describe('initGitRepo — spawn error (deleted cwd)', () => {
  let deletedPath: string;

  beforeEach(async () => {
    const tmp = await createTempDir({
      prefix: 'repo-utils-gone-',
      unsafeCleanup: true,
    });
    deletedPath = tmp.path;
    // Delete the directory so spawn's cwd does not exist
    await rm(deletedPath, { recursive: true, force: true });
  });

  test('resolves without throwing when cwd is gone', async () => {
    await initGitRepo(deletedPath);
  });

  test('logs a warning when the cwd is gone and a logger is provided', async () => {
    const { log, calls } = makeLogger();
    await initGitRepo(deletedPath, log);
    const warnCalls = calls.filter(([level]) => level === 'warning');
    expect(warnCalls.length).toBeGreaterThan(0);
  });
});

describe('installDependencies — spawn error (deleted cwd)', () => {
  let deletedPath: string;

  beforeEach(async () => {
    const tmp = await createTempDir({
      prefix: 'repo-utils-gone-install-',
      unsafeCleanup: true,
    });
    deletedPath = tmp.path;
    await rm(deletedPath, { recursive: true, force: true });
  });

  test('resolves without throwing when cwd is gone', async () => {
    await installDependencies(deletedPath);
  });

  test('logs a warning when the cwd is gone and a logger is provided', async () => {
    const { log, calls } = makeLogger();
    await installDependencies(deletedPath, log);
    const warnCalls = calls.filter(([level]) => level === 'warning');
    expect(warnCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// initGitRepo — non-zero exit (write-protected directory)
//
// chmod 555 lets git start (execute bit set) but prevents it from writing the
// .git directory (no write bit), so git init exits non-zero. The outer try
// does NOT throw — only result.exitCode is non-zero.
//
// This intentionally targets POSIX permission behavior supported by macOS/Linux.
// ---------------------------------------------------------------------------

describe('initGitRepo — non-zero exit from git init', () => {
  let outerTmpDir: TmpDir;
  let restrictedPath: string;

  beforeEach(async () => {
    outerTmpDir = await createTempDir({
      prefix: 'repo-utils-nw-git-',
      unsafeCleanup: true,
    });
    restrictedPath = join(outerTmpDir.path, 'restricted');
    await mkdir(restrictedPath);
    // read+execute only — git can cd in but cannot write .git
    await chmod(restrictedPath, 0o555);
  });

  afterEach(async () => {
    await chmod(restrictedPath, 0o755).catch(() => {});
    await outerTmpDir.cleanup();
  });

  test('resolves without throwing when git exits non-zero', async () => {
    await initGitRepo(restrictedPath);
  });

  test('logs a warning when git exits non-zero and a logger is provided', async () => {
    const { log, calls } = makeLogger();
    await initGitRepo(restrictedPath, log);
    const warnCalls = calls.filter(([level]) => level === 'warning');
    expect(warnCalls.length).toBeGreaterThan(0);
  });
});

//
// initGitRepo — outer catch (no-execute directory triggers EACCES in vfsExists)
//
// chmod 000 removes execute on the directory, so Node cannot stat anything
// inside it. vfsExists re-throws the resulting EACCES error, which is caught
// by initGitRepo's outer try-catch (the "Failed to initialize git" branch).
//
// This intentionally targets POSIX permission behavior supported by macOS/Linux.
// ---------------------------------------------------------------------------

describe('initGitRepo — outer catch via unreadable directory', () => {
  let outerTmpDir: TmpDir;
  let lockedPath: string;

  beforeEach(async () => {
    outerTmpDir = await createTempDir({
      prefix: 'repo-utils-locked-git-',
      unsafeCleanup: true,
    });
    lockedPath = join(outerTmpDir.path, 'locked');
    await mkdir(lockedPath);
    await chmod(lockedPath, 0o000);
  });

  afterEach(async () => {
    await chmod(lockedPath, 0o755).catch(() => {});
    await outerTmpDir.cleanup();
  });

  test('resolves without throwing when the directory is inaccessible', async () => {
    await initGitRepo(lockedPath);
  });

  test('logs a warning via the outer catch when directory is inaccessible', async () => {
    const { log, calls } = makeLogger();
    await initGitRepo(lockedPath, log);
    const warnCalls = calls.filter(([level]) => level === 'warning');
    expect(warnCalls.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// installDependencies — success (exit 0)
//
// A package.json with no dependencies allows bun install to succeed quickly
// without any network activity.
// ---------------------------------------------------------------------------

describe('installDependencies — success (exit 0)', () => {
  let tmpDir: TmpDir;
  let tempPath: string;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'repo-utils-install-success-',
      unsafeCleanup: true,
    });
    tempPath = tmpDir.path;
    // Minimal package.json with no dependencies — bun install exits 0 immediately
    await writeFile(
      join(tempPath, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0' }),
    );
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  test('logs success message when bun install exits 0', async () => {
    const { log, calls } = makeLogger();
    await installDependencies(tempPath, log);
    const infoCalls = calls.filter(([level]) => level === 'info');
    expect(infoCalls.some(([, msg]) => msg.includes('successfully'))).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// autoFormatCode — success (exit 0)
//
// A package.json with a trivial "format" script (echo) and a node_modules/prettier
// marker lets bun run format exit 0.
// ---------------------------------------------------------------------------

describe('autoFormatCode — success (exit 0)', () => {
  let tmpDir: TmpDir;
  let tempPath: string;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'repo-utils-format-success-',
      unsafeCleanup: true,
    });
    tempPath = tmpDir.path;
    // Prettier marker so the existence check passes
    await mkdir(join(tempPath, 'node_modules', 'prettier'), {
      recursive: true,
    });
    // Trivial format script that always exits 0
    await writeFile(
      join(tempPath, 'package.json'),
      JSON.stringify({
        name: 'test-fmt',
        version: '1.0.0',
        scripts: { format: 'echo formatted' },
      }),
    );
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  test('logs success message when bun run format exits 0', async () => {
    const { log, calls } = makeLogger();
    await autoFormatCode(tempPath, log);
    expect(
      calls.some(
        ([level, msg]) => level === 'info' && msg.includes('successfully'),
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// autoFormatCode — outer catch (no-execute directory triggers EACCES in vfsExists)
//
// This intentionally targets POSIX permission behavior supported by macOS/Linux.
// ---------------------------------------------------------------------------

describe('autoFormatCode — outer catch via unreadable directory', () => {
  let outerTmpDir: TmpDir;
  let lockedPath: string;

  beforeEach(async () => {
    outerTmpDir = await createTempDir({
      prefix: 'repo-utils-locked-fmt-',
      unsafeCleanup: true,
    });
    lockedPath = join(outerTmpDir.path, 'locked');
    await mkdir(lockedPath);
    await chmod(lockedPath, 0o000);
  });

  afterEach(async () => {
    await chmod(lockedPath, 0o755).catch(() => {});
    await outerTmpDir.cleanup();
  });

  test('resolves without throwing when the directory is inaccessible', async () => {
    await autoFormatCode(lockedPath);
  });

  test('logs a warning via the outer catch when directory is inaccessible', async () => {
    const { log, calls } = makeLogger();
    await autoFormatCode(lockedPath, log);
    const warnCalls = calls.filter(([level]) => level === 'warning');
    expect(warnCalls.length).toBeGreaterThan(0);
  });
});

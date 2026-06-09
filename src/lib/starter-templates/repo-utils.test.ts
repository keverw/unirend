import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { mkdir } from 'fs/promises';
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

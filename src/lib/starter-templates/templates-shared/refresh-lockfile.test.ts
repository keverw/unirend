import { describe, expect, test } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { createTempDir } from 'lifecycleion/tmp-dir';
import { ensureRefreshLockfile } from './refresh-lockfile';
import type { InMemoryDir } from '../vfs';

/** Collect log calls for assertions. */
function makeLogger() {
  const calls: Array<[string, string]> = [];
  const log = (level: string, msg: string) => {
    calls.push([level, msg]);
  };

  return { log, calls };
}

// ---------------------------------------------------------------------------
// ensureRefreshLockfile — create-if-missing behavior. The helper itself lives
// in unirend/repo-tools (src/lib/repo-tools/refresh-lockfile.ts) and is
// behavior-tested there; the generated script is only a wrapper.
// ---------------------------------------------------------------------------

describe('ensureRefreshLockfile', () => {
  test('creates scripts/refresh-lockfile.ts as a repo-tools wrapper', async () => {
    const mem: InMemoryDir = {};
    await ensureRefreshLockfile(mem);

    const src = mem['scripts/refresh-lockfile.ts'];
    expect(typeof src).toBe('string');

    // The wrapper delegates to the packaged helper (so repos pick up fixes by
    // upgrading unirend) and turns its result into an exit code.
    expect(src as string).toContain(
      "import { refreshLockfile } from 'unirend/repo-tools';",
    );
    expect(src as string).toContain('await refreshLockfile({');
    // Anchored to the repo root so direct invocation from a subfolder works
    expect(src as string).toContain(
      "rootDir: join(import.meta.dirname, '..'),",
    );
    expect(src as string).toContain('process.exit(1)');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureRefreshLockfile(mem, log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('refresh-lockfile.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const mem: InMemoryDir = { 'scripts/refresh-lockfile.ts': existing };
    await ensureRefreshLockfile(mem);
    expect(mem['scripts/refresh-lockfile.ts']).toBe(existing);
  });

  test('wraps write failures with the file path', async () => {
    // A regular file as the root makes creating scripts/ under it fail
    const tmpDir = await createTempDir({
      prefix: 'unirend-refresh-lockfile-fail-',
      unsafeCleanup: true,
    });

    try {
      const notADir = path.join(tmpDir.path, 'not-a-dir');
      await fs.promises.writeFile(notADir, 'file, not a directory');

      expect(ensureRefreshLockfile(notADir)).rejects.toThrow(
        /Failed to ensure scripts\/refresh-lockfile\.ts/,
      );
    } finally {
      await tmpDir.cleanup();
    }
  });
});

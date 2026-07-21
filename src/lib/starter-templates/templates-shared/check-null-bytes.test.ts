import { describe, expect, test } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { createTempDir } from 'lifecycleion/tmp-dir';
import { ensureCheckNullBytes } from './check-null-bytes';
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
// ensureCheckNullBytes — create-if-missing behavior. The check itself lives in
// unirend/repo-tools (src/lib/repo-tools/check-null-bytes.ts) and is
// behavior-tested there; the generated script is only a wrapper.
// ---------------------------------------------------------------------------

describe('ensureCheckNullBytes', () => {
  test('creates scripts/check-null-bytes.ts as a repo-tools wrapper', async () => {
    const mem: InMemoryDir = {};
    await ensureCheckNullBytes(mem);

    const src = mem['scripts/check-null-bytes.ts'];
    expect(typeof src).toBe('string');

    // The wrapper delegates to the packaged check (so repos pick up fixes by
    // upgrading unirend) and turns its result into the exit code CI needs.
    expect(src as string).toContain(
      "import { checkNullBytes } from 'unirend/repo-tools';",
    );
    expect(src as string).toContain('await checkNullBytes({');
    // Anchored to the repo root so direct invocation from a subfolder works
    expect(src as string).toContain(
      "rootDir: join(import.meta.dirname, '..'),",
    );
    expect(src as string).toContain('process.exit(1)');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureCheckNullBytes(mem, log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('check-null-bytes.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const mem: InMemoryDir = { 'scripts/check-null-bytes.ts': existing };
    await ensureCheckNullBytes(mem);
    expect(mem['scripts/check-null-bytes.ts']).toBe(existing);
  });

  test('wraps write failures with the file path', async () => {
    // A regular file as the root makes creating scripts/ under it fail
    const tmpDir = await createTempDir({
      prefix: 'unirend-check-null-bytes-fail-',
      unsafeCleanup: true,
    });

    try {
      const notADir = path.join(tmpDir.path, 'not-a-dir');
      await fs.promises.writeFile(notADir, 'file, not a directory');

      expect(ensureCheckNullBytes(notADir)).rejects.toThrow(
        /Failed to ensure scripts\/check-null-bytes\.ts/,
      );
    } finally {
      await tmpDir.cleanup();
    }
  });
});

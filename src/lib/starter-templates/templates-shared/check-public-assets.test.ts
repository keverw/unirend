import { describe, expect, test } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { createTempDir } from 'lifecycleion/tmp-dir';
import { ensureCheckPublicAssets } from './check-public-assets';
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
// ensureCheckPublicAssets — create-if-missing behavior. The check itself
// lives in unirend/repo-tools (src/lib/repo-tools/check-public-assets.ts) and
// is behavior-tested there; the generated script is only a wrapper.
// ---------------------------------------------------------------------------

describe('ensureCheckPublicAssets', () => {
  test('creates scripts/check-public-assets.ts as a repo-tools wrapper', async () => {
    const mem: InMemoryDir = {};
    await ensureCheckPublicAssets(mem);

    const src = mem['scripts/check-public-assets.ts'];
    expect(typeof src).toBe('string');

    // The wrapper delegates to the packaged check (so repos pick up fixes by
    // upgrading unirend) and turns its result into the exit code CI needs.
    expect(src as string).toContain(
      "import { checkPublicAssets } from 'unirend/repo-tools';",
    );
    expect(src as string).toContain('await checkPublicAssets({');
    // Anchored to the repo root so direct invocation from a subfolder works
    expect(src as string).toContain(
      "rootDir: join(import.meta.dirname, '..'),",
    );
    expect(src as string).toContain('process.exit(1)');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureCheckPublicAssets(mem, log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('check-public-assets.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const mem: InMemoryDir = { 'scripts/check-public-assets.ts': existing };
    await ensureCheckPublicAssets(mem);
    expect(mem['scripts/check-public-assets.ts']).toBe(existing);
  });

  test('wraps write failures with the file path', async () => {
    // A regular file as the root makes creating scripts/ under it fail
    const tmpDir = await createTempDir({
      prefix: 'unirend-check-public-fail-',
      unsafeCleanup: true,
    });

    try {
      const notADir = path.join(tmpDir.path, 'not-a-dir');
      await fs.promises.writeFile(notADir, 'file, not a directory');

      expect(ensureCheckPublicAssets(notADir)).rejects.toThrow(
        /Failed to ensure scripts\/check-public-assets\.ts/,
      );
    } finally {
      await tmpDir.cleanup();
    }
  });
});

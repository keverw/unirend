import { describe, expect, test } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { createTempDir } from 'lifecycleion/tmp-dir';
import { ensurePublicAssetsConfig } from './public-assets-config';
import type { InMemoryDir } from '../vfs';

/** Collect log calls for assertions. */
function makeLogger() {
  const calls: Array<[string, string]> = [];
  const log = (level: string, msg: string) => {
    calls.push([level, msg]);
  };

  return { log, calls };
}

describe('ensurePublicAssetsConfig', () => {
  test('creates public-assets.config.json with the default single-app entry', async () => {
    const mem: InMemoryDir = {};
    await ensurePublicAssetsConfig(mem, 'src/apps/web');

    const raw = mem['src/apps/web/public-assets.config.json'];
    expect(typeof raw).toBe('string');

    // The scaffolded entry spells out every field (JSON has no comments, so
    // explicit values are the documentation) and must mirror the checker's
    // defaults exactly.
    const parsed = JSON.parse(raw as string);
    expect(parsed).toEqual({
      default: {
        publicDir: 'public',
        constsFile: 'consts.ts',
        filesExport: 'PUBLIC_FILES',
        foldersExport: 'PUBLIC_FOLDERS',
      },
    });
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensurePublicAssetsConfig(mem, 'src/apps/web', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('public-assets.config.json');
  });

  test('is a no-op when file already exists', async () => {
    // Never overwrite: a multi-app project has replaced the default entry
    // with its own per-app entries.
    const existing = '{"app-a": {"publicDir": "app-a/public"}}';
    const mem: InMemoryDir = {
      'src/apps/web/public-assets.config.json': existing,
    };
    await ensurePublicAssetsConfig(mem, 'src/apps/web');
    expect(mem['src/apps/web/public-assets.config.json']).toBe(existing);
  });

  test('wraps write failures with the file path', async () => {
    // A regular file as the root makes creating the app dir under it fail
    const tmpDir = await createTempDir({
      prefix: 'unirend-public-assets-config-fail-',
      unsafeCleanup: true,
    });

    try {
      const notADir = path.join(tmpDir.path, 'not-a-dir');
      await fs.promises.writeFile(notADir, 'file, not a directory');

      expect(ensurePublicAssetsConfig(notADir, 'src/apps/web')).rejects.toThrow(
        /Failed to ensure src\/apps\/web\/public-assets\.config\.json/,
      );
    } finally {
      await tmpDir.cleanup();
    }
  });
});

import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
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
// ensureCheckPublicAssets — create-if-missing behavior
// ---------------------------------------------------------------------------

describe('ensureCheckPublicAssets', () => {
  test('creates scripts/check-public-assets.ts when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureCheckPublicAssets(mem);
    expect(typeof mem['scripts/check-public-assets.ts']).toBe('string');
    expect(mem['scripts/check-public-assets.ts'] as string).toContain(
      'PUBLIC_FILES',
    );
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

// ---------------------------------------------------------------------------
// Generated script behavior — run it with bun against a fake repo
// ---------------------------------------------------------------------------

describe('check-public-assets script behavior', () => {
  let tmpDir: TmpDir;
  let repoDir: string;

  beforeEach(async () => {
    // unsafeCleanup: the fake repo is full of files by the time cleanup runs
    tmpDir = await createTempDir({
      prefix: 'unirend-check-public-',
      unsafeCleanup: true,
    });
    repoDir = tmpDir.path;

    // Emit the real generated script into the fake repo
    const mem: InMemoryDir = {};
    await ensureCheckPublicAssets(mem);
    await fs.promises.mkdir(path.join(repoDir, 'scripts'));
    await fs.promises.writeFile(
      path.join(repoDir, 'scripts', 'check-public-assets.ts'),
      mem['scripts/check-public-assets.ts'] as string,
    );
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  async function writeApp(options: {
    name?: string;
    templateID?: string;
    constsSrc?: string;
    publicFiles?: Record<string, string>;
  }) {
    const {
      name = 'web',
      templateID = 'ssr',
      constsSrc,
      publicFiles = {},
    } = options;
    const appDir = path.join(repoDir, 'src', 'apps', name);

    await fs.promises.mkdir(path.join(appDir, 'public'), { recursive: true });

    if (constsSrc !== undefined) {
      await fs.promises.writeFile(path.join(appDir, 'consts.ts'), constsSrc);
    }

    for (const [relPath, content] of Object.entries(publicFiles)) {
      const filePath = path.join(appDir, 'public', ...relPath.split('/'));
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, content);
    }

    await fs.promises.writeFile(
      path.join(repoDir, 'unirend-repo.json'),
      JSON.stringify({
        manifestVersion: '1',
        name: 'fake',
        created: '2026-01-01T00:00:00.000Z',
        projects: {
          [name]: { templateID, path: `src/apps/${name}` },
        },
      }),
    );
  }

  async function runCheck(): Promise<{ exitCode: number; output: string }> {
    const proc = Bun.spawn(['bun', 'run', 'scripts/check-public-assets.ts'], {
      cwd: repoDir,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exitCode, output: stdout + stderr };
  }

  test('passes when declared and actual files match', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/favicon.svg', '/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'favicon.svg': '<svg/>', 'robots.txt': 'User-agent: *' },
    });

    const { exitCode, output } = await runCheck();
    expect(output).toContain('public-assets check passed');
    expect(exitCode).toBe(0);
  });

  test('fails when a file is declared but missing from public/', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/favicon.svg', '/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('missing from public/');
    expect(output).toContain('/favicon.svg');
  });

  test('fails when a public/ file is not declared (the production 404 case)', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        'favicon.svg': '<svg/>',
        'icons/logo.png': 'png',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('present in public/ but not declared');
    expect(output).toContain('/favicon.svg');
    expect(output).toContain('/icons/logo.png');
  });

  test('fails on "." segments in either array (browsers normalize them away)', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/icons/./logo.png'];\n" +
        "export const PUBLIC_FOLDERS = ['./well-known'];\n",
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain(
      'PUBLIC_FILES entry "/icons/./logo.png" contains a "." or ".." segment',
    );
    expect(output).toContain(
      'PUBLIC_FOLDERS entry "./well-known" contains a "." or ".." segment',
    );
  });

  test('fails on backslashes in either array (the built server rejects them at boot)', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/icons\\\\logo.png'];\n" +
        "export const PUBLIC_FOLDERS = ['/.well\\\\known'];\n",
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain(
      'PUBLIC_FILES entry "/icons\\\\logo.png" contains a "." or ".." segment, backslash, or null byte',
    );
    expect(output).toContain(
      'PUBLIC_FOLDERS entry "/.well\\\\known" contains a "." or ".." segment, backslash, or null byte',
    );
  });

  test('fails on slash-collapsed and case-variant reserved paths', async () => {
    // '//' normalizes to the root mount, '/assets//' to the /assets mount,
    // and reserved names compare case-insensitively — all mirror the server.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/INDEX.HTML', '/assets//x.js'];\n" +
        "export const PUBLIC_FOLDERS = ['//', '/ASSETS'];\n",
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('"/INDEX.HTML" exposes build internals');
    expect(output).toContain('"/assets//x.js" is under /assets');
    expect(output).toContain('"//" mounts the whole public/ root');
    expect(output).toContain('"/ASSETS" is reserved');
  });

  test('fails on entries that expose a whole folder at the root', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/', '/icons/'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('is a folder path');
  });

  test('files under a declared PUBLIC_FOLDERS prefix are exempt from PUBLIC_FILES', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        "export const PUBLIC_FOLDERS = ['/.well-known'];\n",
      publicFiles: {
        'robots.txt': 'User-agent: *',
        '.well-known/security.txt': 'Contact: mailto:security@example.com',
        '.well-known/apple-app-site-association': '{}',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(output).toContain('public-assets check passed');
    expect(exitCode).toBe(0);
  });

  test('fails when a PUBLIC_FOLDERS entry is missing from public/', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        "export const PUBLIC_FOLDERS = ['/.well-known'];\n",
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('"/.well-known" is missing from public/');
  });

  test('fails when a PUBLIC_FOLDERS entry is actually a file', async () => {
    await writeApp({
      constsSrc:
        'export const PUBLIC_FILES = [];\n' +
        "export const PUBLIC_FOLDERS = ['/robots.txt'];\n",
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('is a file — declare it in PUBLIC_FILES');
  });

  test('fails on reserved PUBLIC_FOLDERS entries (/assets, .vite, root)', async () => {
    await writeApp({
      constsSrc:
        'export const PUBLIC_FILES = [];\n' +
        "export const PUBLIC_FOLDERS = ['/assets', '/.vite', '/'];\n",
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('is reserved');
    expect(output).toContain('mounts the whole public/ root');
  });

  test('fails when public/ contains an assets/ folder (collides with build output)', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        'assets/logo.png': 'png',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('collides with the build');
    expect(output).toContain('/assets/logo.png');
    expect(output).toContain('Rename the folder');
    expect(output).not.toContain('Add them to PUBLIC_FILES');
  });

  test('fails when public/ contains a case-variant ASSETS/ folder', async () => {
    // Same collision as public/assets/ on case-insensitive filesystems, and
    // "add it to PUBLIC_FILES" would suggest a declaration the server rejects.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        'ASSETS/logo.png': 'png',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('collides with the build');
    expect(output).toContain('/ASSETS/logo.png');
    expect(output).not.toContain('Add them to PUBLIC_FILES');
  });

  test('fails when PUBLIC_FILES declares generated /assets content', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/assets/index-abc123.js', '/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('Vite generates at build time');
    expect(output).toContain('/assets/index-abc123.js');
    expect(output).not.toContain('missing from public/');
  });

  test('fails with guidance when consts.ts has no PUBLIC_FOLDERS export', async () => {
    await writeApp({
      constsSrc: "export const PUBLIC_FILES = ['/robots.txt'];\n",
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('does not export a PUBLIC_FOLDERS string array');
  });

  test('fails on entries that point at a directory', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/icons'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'icons/logo.png': 'png' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('is a directory');
  });

  test('fails when PUBLIC_FILES declares reserved paths (/index.html, .vite)', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/index.html', '/.vite/manifest.json'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('exposes build internals');
    expect(output).toContain('/index.html');
    expect(output).toContain('/.vite/manifest.json');
  });

  test('fails when public/ itself contains a reserved file, without advising to declare it', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        'index.html': '<html></html>',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('Remove them from public/');
    expect(output).toContain('/index.html');
    expect(output).not.toContain('Add them to PUBLIC_FILES');
  });

  test('fails with guidance when consts.ts has no PUBLIC_FILES export', async () => {
    await writeApp({
      constsSrc: 'export const ENABLE_TEST_ROUTES = true;\n',
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('does not export a PUBLIC_FILES string array');
  });

  test('fails with guidance when PUBLIC_FOLDERS is exported but not a string array', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        "export const PUBLIC_FOLDERS = '/.well-known';\n",
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('does not export a PUBLIC_FOLDERS string array');
  });

  test('skips api projects (no public-file surface)', async () => {
    await writeApp({ templateID: 'api' });

    const { exitCode, output } = await runCheck();
    expect(output).toContain('public-assets check passed');
    expect(exitCode).toBe(0);
  });

  test('no-ops without a unirend-repo.json', async () => {
    const { exitCode, output } = await runCheck();
    expect(output).toContain('nothing to check');
    expect(exitCode).toBe(0);
  });
});

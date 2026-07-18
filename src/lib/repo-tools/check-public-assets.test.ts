import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import fs from 'fs';
import { execFileSync } from 'child_process';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import { checkPublicAssets } from './check-public-assets';

// ---------------------------------------------------------------------------
// checkPublicAssets — run the exported check against a fake repo. The
// scaffolded scripts/check-public-assets.ts is a thin wrapper over this
// function (asserted in templates-shared/check-public-assets.test.ts), so
// its behavior is tested here at the function level.
// ---------------------------------------------------------------------------

describe('check-public-assets script behavior', () => {
  let tmpDir: TmpDir;
  let repoDir: string;
  let savedGitConfigGlobal: string | undefined;
  let savedGitConfigSystem: string | undefined;

  beforeEach(async () => {
    // unsafeCleanup: the fake repo is full of files by the time cleanup runs
    tmpDir = await createTempDir({
      prefix: 'unirend-check-public-',
      unsafeCleanup: true,
    });
    repoDir = tmpDir.path;

    // Neutralize the developer's global/system git excludes (many macOS
    // setups gitignore .DS_Store globally) so the gitignore-aware tests see
    // only the repo's own .gitignore and stay deterministic across machines.
    // The check spawns git inheriting this env, so these apply to it too.
    savedGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
    savedGitConfigSystem = process.env.GIT_CONFIG_SYSTEM;
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    process.env.GIT_CONFIG_SYSTEM = '/dev/null';
  });

  afterEach(async () => {
    await tmpDir.cleanup();

    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    };

    restore('GIT_CONFIG_GLOBAL', savedGitConfigGlobal);
    restore('GIT_CONFIG_SYSTEM', savedGitConfigSystem);
  });

  async function writeApp(options: {
    name?: string;
    templateID?: string;
    constsSrc?: string;
    publicFiles?: Record<string, string>;
    /**
     * Contents for the app's public-assets.config.json. Defaults to the
     * scaffolded single-app config; pass `null` to omit the file (the
     * opt-out case), a string to write raw (malformed-JSON tests), or an
     * object for custom shapes.
     */
    assetsConfig?: unknown;
  }) {
    const {
      name = 'web',
      templateID = 'ssr',
      constsSrc,
      publicFiles = {},
      assetsConfig = {
        default: {
          publicDir: 'public',
          constsFile: 'consts.ts',
          filesExport: 'PUBLIC_FILES',
          foldersExport: 'PUBLIC_FOLDERS',
        },
      },
    } = options;
    const appDir = path.join(repoDir, 'src', 'apps', name);

    await fs.promises.mkdir(path.join(appDir, 'public'), { recursive: true });

    if (constsSrc !== undefined) {
      await fs.promises.writeFile(path.join(appDir, 'consts.ts'), constsSrc);
    }

    if (assetsConfig !== null) {
      await fs.promises.writeFile(
        path.join(appDir, 'public-assets.config.json'),
        typeof assetsConfig === 'string'
          ? assetsConfig
          : JSON.stringify(assetsConfig, null, 2),
      );
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

  // Same result shape the old spawn-based harness produced (the wrapper maps
  // success to the process exit code), so the assertions below carry over
  // from when these tests exercised the generated standalone script.
  async function runCheck(): Promise<{ exitCode: number; output: string }> {
    const lines: string[] = [];
    const sink = (message: string) => {
      lines.push(message);
    };

    const result = await checkPublicAssets({
      rootDir: repoDir,
      log: sink,
      logError: sink,
    });

    return { exitCode: result.success ? 0 : 1, output: lines.join('\n') };
  }

  // Turn the fake repo into an actual git repo so the check's gitignore-aware
  // junk handling has something to query. Without this the temp dir isn't a
  // repo and the check falls back to flagging every junk file.
  function gitInit(gitignore?: string): void {
    execFileSync('git', ['init', '-q'], { cwd: repoDir });

    if (gitignore !== undefined) {
      fs.writeFileSync(path.join(repoDir, '.gitignore'), gitignore);
    }
  }

  function gitAdd(relPath: string): void {
    // -f so an ignored path can still be staged, reproducing a junk file that
    // was committed before it was gitignored (git then treats it as tracked).
    execFileSync('git', ['add', '-f', relPath], { cwd: repoDir });
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
    // SSR apps validate declarations at boot, so predict the boot failure
    expect(output).toContain('the built server refuses to boot on these');
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

  test('counts a declared symlinked file as present', async () => {
    // readdir dirents report symlinks as neither file nor directory — the
    // listing must stat through the link so a symlinked robots.txt is not
    // reported as "missing from public/".
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
    });

    const sharedFile = path.join(repoDir, 'shared-robots.txt');
    await fs.promises.writeFile(sharedFile, 'User-agent: *');
    await fs.promises.symlink(
      sharedFile,
      path.join(repoDir, 'src', 'apps', 'web', 'public', 'robots.txt'),
    );

    const { exitCode, output } = await runCheck();
    expect(output).toContain('public-assets check passed');
    expect(exitCode).toBe(0);
  });

  test('reports an undeclared symlinked file as undeclared', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const sharedFile = path.join(repoDir, 'shared-extra.txt');
    await fs.promises.writeFile(sharedFile, 'extra');
    await fs.promises.symlink(
      sharedFile,
      path.join(repoDir, 'src', 'apps', 'web', 'public', 'extra.txt'),
    );

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('present in public/ but not declared');
    expect(output).toContain('/extra.txt');
  });

  test('recurses into symlinked directories and reports their undeclared files', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const sharedDir = path.join(repoDir, 'shared-icons');
    await fs.promises.mkdir(sharedDir);
    await fs.promises.writeFile(path.join(sharedDir, 'logo.png'), 'png');
    await fs.promises.symlink(
      sharedDir,
      path.join(repoDir, 'src', 'apps', 'web', 'public', 'icons'),
    );

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('present in public/ but not declared');
    expect(output).toContain('/icons/logo.png');
  });

  test('reports a symlinked directory cycle as an error instead of recursing forever', async () => {
    // public/loop -> public/ would recurse until path-length or resource
    // exhaustion without the ancestry guard — and Vite's public copier has
    // no such guard, so the cycle must fail the check, not be skipped.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const publicDir = path.join(repoDir, 'src', 'apps', 'web', 'public');
    await fs.promises.symlink(publicDir, path.join(publicDir, 'loop'));

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('symlinked directory cycle');
    expect(output).toContain('/loop');
  });

  test('allows raw URL path characters like [, ], and |', async () => {
    // The WHATWG URL path percent-encode set leaves [, ], and | raw, so
    // '/icon[1].png' is requested verbatim and matches the raw-URL router.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/icon[1].png', '/a|b.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'icon[1].png': 'png', 'a|b.txt': 'txt' },
    });

    const { exitCode, output } = await runCheck();
    expect(output).toContain('public-assets check passed');
    expect(exitCode).toBe(0);
  });

  test('rejects URL path characters like ^ that browsers percent-encode', async () => {
    // '^' is encoded ('/a^b' serializes as '/a%5Eb'), so it is rejected.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/a^b.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'a^b.txt': 'txt' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('percent-encode');
  });

  test('reports a dangling symlink as an error (the Vite build fails on it)', async () => {
    // Vite's public copier stats each entry when copying, so a broken link
    // fails the build — the check must predict that, not silently skip it.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const publicDir = path.join(repoDir, 'src', 'apps', 'web', 'public');
    await fs.promises.symlink(
      path.join(repoDir, 'does-not-exist.txt'),
      path.join(publicDir, 'broken.txt'),
    );

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('dangling symlink');
    expect(output).toContain('/broken.txt');
  });

  test('lists both sibling symlinks to the same directory (aliases are distinct URL trees)', async () => {
    // Cycle detection must track recursion ancestry only — a global visited
    // set would list the shared directory once and hide the second alias's
    // undeclared files (or report its declared files as missing).
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const sharedDir = path.join(repoDir, 'shared-assets');
    await fs.promises.mkdir(sharedDir);
    await fs.promises.writeFile(path.join(sharedDir, 'logo.png'), 'png');

    const publicDir = path.join(repoDir, 'src', 'apps', 'web', 'public');
    await fs.promises.symlink(sharedDir, path.join(publicDir, 'alias-a'));
    await fs.promises.symlink(sharedDir, path.join(publicDir, 'alias-b'));

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('present in public/ but not declared');
    expect(output).toContain('/alias-a/logo.png');
    expect(output).toContain('/alias-b/logo.png');
  });

  test('fails on entries with URL-unsafe characters (SSR wording)', async () => {
    // The server rejects these at boot: browsers request '/og image.png' as
    // '/og%20image.png', so the declared key could never match.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/og image.png'];\n" +
        "export const PUBLIC_FOLDERS = ['/my docs'];\n",
      publicFiles: { 'og image.png': 'png', 'my docs/readme.txt': 'hi' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('percent-encode');
    expect(output).toContain('the server rejects it at boot');
    expect(output).toContain('Rename the file in public/');
    expect(output).toContain('Rename the folder in public/');
  });

  test('fails on entries with URL-unsafe characters (SSG wording)', async () => {
    await writeApp({
      templateID: 'ssg',
      constsSrc:
        "export const PUBLIC_FILES = ['/og image.png'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'og image.png': 'png' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('percent-encode');
    expect(output).toContain('requests for it just 404');
    expect(output).not.toContain('rejects it at boot');
  });

  test('flags URL-unsafe filenames under a declared folder', async () => {
    // The folder declaration itself is valid, so no boot check catches this:
    // the file is served by URL and 404s on the percent-encoded request.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        "export const PUBLIC_FOLDERS = ['/docs'];\n",
      publicFiles: {
        'robots.txt': 'User-agent: *',
        'docs/og image.png': 'png',
        'docs/fine.png': 'png',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('covered by PUBLIC_FOLDERS');
    expect(output).toContain('/docs/og image.png');
    expect(output).toContain('percent-encode');
    expect(output).not.toContain('/docs/fine.png');
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
    // SSR apps get the boot-time prediction (SSG apps get a 404 one)
    expect(output).toContain('the server rejects it at boot');
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

  test('fails on OS junk with gitignore guidance instead of declaration advice', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        '.ds_store': 'finder metadata',
        'THUMBS.DB': 'explorer metadata',
        'ehthumbs.db': 'explorer metadata',
        'desktop.ini': 'explorer metadata',
        '._logo.png': 'appledouble metadata',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('public/ contains OS metadata files');
    expect(output).toContain('/.ds_store');
    expect(output).toContain('/THUMBS.DB');
    expect(output).toContain('/ehthumbs.db');
    expect(output).toContain('/desktop.ini');
    expect(output).toContain('/._logo.png');
    expect(output).toContain('Add the OS metadata name to .gitignore');
    expect(output).toContain('Do not declare them');
    expect(output).not.toContain('Add them to PUBLIC_FILES');
  });

  test('fails on OS junk inside a declared PUBLIC_FOLDERS subfolder', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        "export const PUBLIC_FOLDERS = ['/images'];\n",
      publicFiles: {
        'robots.txt': 'User-agent: *',
        'images/logo.png': 'png',
        'images/.DS_Store': 'finder metadata',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('/images/.DS_Store');
    expect(output).toContain('public/ contains OS metadata files');
    expect(output).not.toContain('present in public/ but not declared');
    expect(output).not.toContain('Add them to PUBLIC_FILES');
  });

  test('fails on files inside an OS junk directory (clean basename)', async () => {
    // .AppleDouble is a directory: a file inside it has a clean basename but
    // the path segment is junk, so it must be caught as junk, not reported as
    // ordinary undeclared drift.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        '.AppleDouble/metadata': 'resource fork data',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('/.AppleDouble/metadata');
    expect(output).toContain('public/ contains OS metadata files');
    // Must be classed as junk, not ordinary undeclared drift.
    expect(output).not.toContain('present in public/ but not declared');
  });

  test('fails when PUBLIC_FILES explicitly declares an OS junk file', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt', '/.DS_Store'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        '.DS_Store': 'finder metadata',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain(
      'PUBLIC_FILES entry "/.DS_Store" is or is under OS metadata',
    );
    expect(output).toContain('public/ contains OS metadata files');
    expect(output).toContain('Do not declare');
    expect(output).not.toContain('present in public/ but not declared');
    expect(output).not.toContain('Add them to PUBLIC_FILES');
  });

  test('skips gitignored OS junk instead of failing', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        '.DS_Store': 'finder metadata',
      },
    });
    // A root .gitignore covering .DS_Store means the untracked junk file can
    // never be committed, so it stays out of a clean checkout and the check must pass.
    gitInit('.DS_Store\n');

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(0);
    expect(output).not.toContain('public/ contains OS metadata files');
    // The skip is logged so the opt-out is visible in CI output.
    expect(output).toContain('gitignored');
    expect(output).toContain('/.DS_Store');
  });

  test('skips a gitignored junk path with a non-ASCII name (git -z, no quoting)', async () => {
    // git quotes non-ASCII paths by default, which would make the echoed path
    // not match what the check sent and flip this into a false hard failure.
    // The -z NUL-delimited mode disables quoting; this locks that in.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        '.AppleDouble/café.txt': 'resource fork data',
      },
    });
    gitInit('.AppleDouble\n');

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(0);
    expect(output).not.toContain('public/ contains OS metadata files');
    expect(output).toContain('gitignored');
  });

  test('still fails on OS junk that git would commit (not gitignored)', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        '.DS_Store': 'finder metadata',
      },
    });
    // A git repo whose .gitignore does NOT cover .DS_Store — the junk file
    // would be committed, so it reaches every build and stays a hard error.
    gitInit('node_modules\n');

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('public/ contains OS metadata files');
    expect(output).toContain('/.DS_Store');
    expect(output).toContain('.gitignore');
  });

  test('fails on OS junk already tracked by git even when now gitignored', async () => {
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        '.DS_Store': 'finder metadata',
      },
    });
    gitInit('.DS_Store\n');
    // Staged despite the ignore rule: git treats a tracked path as not
    // ignored, so it still ships and must still fail.
    gitAdd('src/apps/web/public/.DS_Store');

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('public/ contains OS metadata files');
    expect(output).toContain('/.DS_Store');
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
    expect(output).toContain('the built server refuses to boot on this');
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
        "export const PUBLIC_FOLDERS = ['/assets', '/assets/foo', '/.vite', '/'];\n",
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('is reserved');
    expect(output).toContain('"/assets/foo" is reserved');
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

  test('fails when public/assets is a bare file, with file (not folder) advice', async () => {
    // The same output-dir collision, but the offender is a FILE named
    // public/assets — the advice must not tell the user to rename a folder.
    await writeApp({
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: {
        'robots.txt': 'User-agent: *',
        assets: 'not a folder',
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('collides with the build');
    expect(output).toContain('Rename the file');
    expect(output).toContain('PUBLIC_FILES');
    expect(output).not.toContain('Rename the folder');
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

  test('checks ssg apps too, with SSG-appropriate reserved-path guidance', async () => {
    // SSG apps have no boot-time reserved check (that is SSR-only), so this
    // CI check is their only guard — and the message explains the SSG
    // failure mode (build collision) rather than just the SSR one.
    await writeApp({
      templateID: 'ssg',
      constsSrc:
        "export const PUBLIC_FILES = ['/index.html'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('exposes build internals');
    expect(output).toContain('in an SSG app it collides with the build output');
  });

  test('ssg apps get request-time 404 wording for missing declared files', async () => {
    // The SSG static server does no boot-time validation, so "the built
    // server refuses to boot" would be a wrong prediction — it just 404s.
    await writeApp({
      templateID: 'ssg',
      constsSrc:
        "export const PUBLIC_FILES = ['/favicon.svg'];\n" +
        "export const PUBLIC_FOLDERS = ['/.well-known'];\n",
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('missing from public/');
    expect(output).toContain(
      'these 404 in production — the SSG static server has no boot check',
    );
    expect(output).toContain(
      'requests under it 404 in production — the SSG static server has no boot check',
    );
    expect(output).not.toContain('refuses to boot');
  });

  test('ssg apps get request-time 404 wording for invalid entries', async () => {
    await writeApp({
      templateID: 'ssg',
      constsSrc:
        "export const PUBLIC_FILES = ['/icons\\\\logo.png'];\n" +
        "export const PUBLIC_FOLDERS = ['/assets'];\n",
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain(
      'the SSG static server does no boot-time validation, so requests for it just 404',
    );
    expect(output).toContain(
      'the SSG static server does no boot-time validation, so requests under it just 404',
    );
    expect(output).not.toContain('rejects it at boot');
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

  // -------------------------------------------------------------------------
  // public-assets.config.json handling
  // -------------------------------------------------------------------------

  test('skips a project without public-assets.config.json, and says so', async () => {
    // Drift that would normally fail — the missing config opts the project
    // out, but the skip must show in the output rather than pass silently.
    await writeApp({
      assetsConfig: null,
      constsSrc:
        'export const PUBLIC_FILES: string[] = [];\n' +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'undeclared.txt': 'x' },
    });

    const { exitCode, output } = await runCheck();
    expect(output).toContain(
      'web: no src/apps/web/public-assets.config.json — skipping this project',
    );
    expect(output).toContain('public-assets check passed');
    expect(exitCode).toBe(0);
  });

  test('all config fields are optional and default to the single-app convention', async () => {
    await writeApp({
      assetsConfig: { default: {} },
      constsSrc:
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const { exitCode, output } = await runCheck();
    expect(output).toContain('public-assets check passed');
    expect(exitCode).toBe(0);
  });

  test('fails on malformed public-assets.config.json', async () => {
    await writeApp({
      assetsConfig: '{ not json',
      constsSrc:
        'export const PUBLIC_FILES: string[] = [];\n' +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain(
      'could not parse src/apps/web/public-assets.config.json',
    );
  });

  test('fails when the config is not an object mapping labels to entries', async () => {
    await writeApp({ assetsConfig: ['nope'] });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain(
      'must be a JSON object mapping app labels to entries',
    );
  });

  test('fails when an app entry is not an object', async () => {
    await writeApp({ assetsConfig: { default: 'public' } });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('must be a JSON object (fields: publicDir');
  });

  test('fails on unknown and non-string config fields (typo guard)', async () => {
    // A typo'd field name would otherwise silently fall back to its default,
    // which is exactly the invisible-drift failure the check exists to catch.
    await writeApp({
      assetsConfig: {
        default: { files_export: 'PUBLIC_FILES', publicDir: 42 },
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('unknown field "files_export"');
    expect(output).toContain('field "publicDir"');
    expect(output).toContain('must be a non-empty string');
  });

  test('fails when publicDir or constsFile escapes the app folder', async () => {
    await writeApp({
      assetsConfig: {
        default: { publicDir: '../other-app/public', constsFile: '/etc/x.ts' },
      },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain(
      'publicDir "../other-app/public" in src/apps/web/public-assets.config.json must be a relative path inside the project folder',
    );
    expect(output).toContain(
      'constsFile "/etc/x.ts" in src/apps/web/public-assets.config.json must be a relative path inside the project folder',
    );
  });

  test('fails when the configured publicDir does not exist, even with empty lists', async () => {
    // listPublicFiles treats an unreadable directory as empty, so a typo'd
    // publicDir plus empty declared arrays would otherwise pass while the
    // real public/ goes unchecked.
    await writeApp({
      assetsConfig: { default: { publicDir: 'pubic' } },
      constsSrc:
        'export const PUBLIC_FILES: string[] = [];\n' +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'undeclared.txt': 'x' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain(
      'publicDir "pubic" in src/apps/web/public-assets.config.json does not exist',
    );
  });

  test('fails when the configured publicDir is a file', async () => {
    await writeApp({
      assetsConfig: { default: { publicDir: 'public/robots.txt' } },
      constsSrc:
        'export const PUBLIC_FILES: string[] = [];\n' +
        'export const PUBLIC_FOLDERS: string[] = [];\n',
      publicFiles: { 'robots.txt': 'User-agent: *' },
    });

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain(
      'publicDir "public/robots.txt" in src/apps/web/public-assets.config.json exists but is not a directory',
    );
  });

  test('notes a config that defines no apps instead of passing silently', async () => {
    await writeApp({ assetsConfig: {} });

    const { exitCode, output } = await runCheck();
    expect(output).toContain(
      'src/apps/web/public-assets.config.json defines no apps',
    );
    expect(output).toContain('public-assets check passed');
    expect(exitCode).toBe(0);
  });

  test('checks every app in a multi-app config, with qualified labels', async () => {
    // One project hosting two Vite roots (the multi-app SSR layout): app-a is
    // in sync, app-b has an undeclared file — only app-b may be flagged, and
    // under its qualified name/appKey label.
    await writeApp({
      assetsConfig: {
        'app-a': { publicDir: 'app-a/public', constsFile: 'app-a/consts.ts' },
        'app-b': { publicDir: 'app-b/public', constsFile: 'app-b/consts.ts' },
      },
    });

    const projectDir = path.join(repoDir, 'src', 'apps', 'web');

    for (const app of ['app-a', 'app-b'] as const) {
      await fs.promises.mkdir(path.join(projectDir, app, 'public'), {
        recursive: true,
      });
      await fs.promises.writeFile(
        path.join(projectDir, app, 'consts.ts'),
        "export const PUBLIC_FILES = ['/robots.txt'];\n" +
          'export const PUBLIC_FOLDERS: string[] = [];\n',
      );
      await fs.promises.writeFile(
        path.join(projectDir, app, 'public', 'robots.txt'),
        'User-agent: *',
      );
    }

    await fs.promises.writeFile(
      path.join(projectDir, 'app-b', 'public', 'stray.txt'),
      'x',
    );

    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain('web/app-b: present in public/ but not declared');
    expect(output).toContain('/stray.txt');
    expect(output).not.toContain('web/app-a');
  });

  test('supports a shared consts file with per-app export names', async () => {
    await writeApp({
      assetsConfig: {
        'app-a': {
          publicDir: 'app-a/public',
          constsFile: 'shared-consts.ts',
          filesExport: 'APP_A_FILES',
          foldersExport: 'APP_A_FOLDERS',
        },
        'app-b': {
          publicDir: 'app-b/public',
          constsFile: 'shared-consts.ts',
          filesExport: 'APP_B_FILES',
          foldersExport: 'APP_B_FOLDERS',
        },
      },
    });

    const projectDir = path.join(repoDir, 'src', 'apps', 'web');

    await fs.promises.writeFile(
      path.join(projectDir, 'shared-consts.ts'),
      "export const APP_A_FILES = ['/robots.txt'];\n" +
        'export const APP_A_FOLDERS: string[] = [];\n',
    );

    for (const app of ['app-a', 'app-b'] as const) {
      await fs.promises.mkdir(path.join(projectDir, app, 'public'), {
        recursive: true,
      });
    }

    await fs.promises.writeFile(
      path.join(projectDir, 'app-a', 'public', 'robots.txt'),
      'User-agent: *',
    );

    // app-a's exports exist and match; app-b's don't exist at all — the
    // guidance must name the configured export, not the default.
    const { exitCode, output } = await runCheck();
    expect(exitCode).toBe(1);
    expect(output).toContain(
      'web/app-b: src/apps/web/shared-consts.ts does not export a APP_B_FILES string array',
    );
    expect(output).not.toContain('web/app-a');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import { serveSSRWithHMR, serveSSRBuilt } from '../ssr';

/**
 * Tests for SSRServer's private methods using @ts-expect-error to access them,
 * following the same pattern already used in generate.test.ts.
 *
 * Covers: loadProductionRenderFunction, loadHTMLTemplate, validateAppKey.
 * handleSSRError / generate500ErrorPage require FastifyRequest/Reply mocks
 * and are deferred — those branches live inside the live request path.
 */

const FAKE_HMR_PATHS = {
  serverEntry: '/fake/EntrySSR.tsx',
  template: '/fake/index.html',
  viteConfig: '/fake/vite.config.ts',
};

const MINIMAL_HTML = `<!DOCTYPE html>
<html>
  <head><!--ss-head--></head>
  <body>
    <div id="root"><!--ss-outlet--></div>
  </body>
</html>`;

// ---------------------------------------------------------------------------
// loadProductionRenderFunction
// ---------------------------------------------------------------------------

describe('SSRServer.loadProductionRenderFunction() (private)', () => {
  let tmpDir: TmpDir;
  let tempPath: string;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'ssr-render-fn-test-',
      unsafeCleanup: true,
    });
    tempPath = tmpDir.path;
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  it('throws when called on a development (HMR) server', async () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    const fakeConfig = { sourcePaths: FAKE_HMR_PATHS };

    let caughtError: unknown;

    try {
      // @ts-expect-error — accessing private method for testing
      await server.loadProductionRenderFunction(fakeConfig);
    } catch (error) {
      caughtError = error;
    }

    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(/production mode/);
  });

  it('returns the cached render function without hitting the filesystem', async () => {
    const server = serveSSRBuilt(tempPath);
    const cachedFn = () =>
      Promise.resolve({ resultType: 'page' as const, html: '<div/>' });
    const fakeConfig = {
      buildDir: tempPath,
      cachedRenderFunction: cachedFn,
    };

    // @ts-expect-error — accessing private method for testing
    const result = await server.loadProductionRenderFunction(fakeConfig);
    expect(result).toBe(cachedFn);
  });

  it('throws when the server manifest is missing', async () => {
    const server = serveSSRBuilt(tempPath);
    const fakeConfig = { buildDir: tempPath, serverFolderName: 'server' };

    let caughtError: unknown;
    try {
      // @ts-expect-error — accessing private method for testing
      await server.loadProductionRenderFunction(fakeConfig);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(/manifest/i);
  });

  it('throws when the entry is not found in the manifest', async () => {
    const server = serveSSRBuilt(tempPath);
    const serverDir = join(tempPath, 'server');
    const viteDir = join(serverDir, '.vite');
    await mkdir(viteDir, { recursive: true });
    // Manifest that has no entry matching 'EntrySSR'
    await writeFile(
      join(viteDir, 'manifest.json'),
      JSON.stringify({ 'SomeOtherFile.tsx': { file: 'assets/other.js' } }),
    );

    const fakeConfig = { buildDir: tempPath, serverFolderName: 'server' };

    let caughtError: unknown;
    try {
      // @ts-expect-error — accessing private method for testing
      await server.loadProductionRenderFunction(fakeConfig);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(
      /EntrySSR.*not found|not found.*EntrySSR/i,
    );
  });

  it("throws when the entry module doesn't export a render function", async () => {
    const server = serveSSRBuilt(tempPath);
    const serverDir = join(tempPath, 'server');
    const assetsDir = join(serverDir, 'assets');
    const viteDir = join(serverDir, '.vite');
    await mkdir(assetsDir, { recursive: true });
    await mkdir(viteDir, { recursive: true });

    const entryFile = join(assetsDir, 'EntrySSR.js');
    // Module exists but has no render export
    await writeFile(entryFile, 'export const notRender = () => {};');
    await writeFile(
      join(viteDir, 'manifest.json'),
      JSON.stringify({
        'EntrySSR.tsx': { file: 'assets/EntrySSR.js' },
      }),
    );

    const fakeConfig = { buildDir: tempPath, serverFolderName: 'server' };

    let caughtError: unknown;
    try {
      // @ts-expect-error — accessing private method for testing
      await server.loadProductionRenderFunction(fakeConfig);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(/render/i);
  });

  it('returns and caches a render function when the entry exports render', async () => {
    const server = serveSSRBuilt(tempPath);
    const serverDir = join(tempPath, 'server');
    const assetsDir = join(serverDir, 'assets');
    const viteDir = join(serverDir, '.vite');
    await mkdir(assetsDir, { recursive: true });
    await mkdir(viteDir, { recursive: true });

    const entryFile = join(assetsDir, 'EntrySSR.js');
    await writeFile(
      entryFile,
      'export async function render(req) { return { html: "<div/>" }; }',
    );
    await writeFile(
      join(viteDir, 'manifest.json'),
      JSON.stringify({
        'EntrySSR.tsx': { file: 'assets/EntrySSR.js' },
      }),
    );

    const fakeConfig: Record<string, unknown> = {
      buildDir: tempPath,
      serverFolderName: 'server',
    };

    // @ts-expect-error — accessing private method for testing
    const renderFn = await server.loadProductionRenderFunction(fakeConfig);
    expect(typeof renderFn).toBe('function');
    // Should have been cached on the config object
    expect(fakeConfig.cachedRenderFunction).toBe(renderFn);
  });
});

// ---------------------------------------------------------------------------
// loadHTMLTemplate
// ---------------------------------------------------------------------------

describe('SSRServer.loadHTMLTemplate() (private)', () => {
  let tmpDir: TmpDir;
  let tempPath: string;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'ssr-html-template-test-',
      unsafeCleanup: true,
    });
    tempPath = tmpDir.path;
  });

  afterEach(async () => {
    await tmpDir.cleanup();
  });

  it('throws on invalid app config (no sourcePaths on dev server)', async () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    // appConfig has neither sourcePaths nor buildDir → falls through to throw
    let caughtError: unknown;
    try {
      // @ts-expect-error — accessing private method for testing
      await server.loadHTMLTemplate({});
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(/Invalid app config/);
  });

  it('throws on invalid app config (no buildDir on prod server)', async () => {
    const server = serveSSRBuilt(tempPath);
    let caughtError: unknown;
    try {
      // @ts-expect-error — accessing private method for testing
      await server.loadHTMLTemplate({});
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(/Invalid app config/);
  });

  it('throws when the HTML template file does not exist (prod, default path)', async () => {
    const server = serveSSRBuilt(tempPath);
    // No client/index.html created in tempPath
    const fakeConfig = { buildDir: tempPath, clientFolderName: 'client' };

    let caughtError: unknown;
    try {
      // @ts-expect-error — accessing private method for testing
      await server.loadHTMLTemplate(fakeConfig);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(/not found|template/i);
  });

  it('throws when the HTML template file does not exist (dev, sourcePaths.template)', async () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    const fakeConfig = {
      sourcePaths: {
        ...FAKE_HMR_PATHS,
        template: join(tempPath, 'nonexistent.html'),
      },
    };

    let caughtError: unknown;
    try {
      // @ts-expect-error — accessing private method for testing
      await server.loadHTMLTemplate(fakeConfig);
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(/not found|template/i);
  });

  it('loads and processes the template in production mode (default client path)', async () => {
    const server = serveSSRBuilt(tempPath);
    const clientDir = join(tempPath, 'client');
    await mkdir(clientDir, { recursive: true });
    await writeFile(join(clientDir, 'index.html'), MINIMAL_HTML);

    const fakeConfig = { buildDir: tempPath, clientFolderName: 'client' };

    // @ts-expect-error — accessing private method for testing
    const result = await server.loadHTMLTemplate(fakeConfig);
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
    expect(typeof result.path).toBe('string');
    expect(result.path).toContain('index.html');
  });

  it('loads and processes the template in development mode', async () => {
    const templatePath = join(tempPath, 'index.html');
    await writeFile(templatePath, MINIMAL_HTML);

    const server = serveSSRWithHMR({
      ...FAKE_HMR_PATHS,
      template: templatePath,
    });
    const fakeConfig = {
      sourcePaths: { ...FAKE_HMR_PATHS, template: templatePath },
    };

    // @ts-expect-error — accessing private method for testing
    const result = await server.loadHTMLTemplate(fakeConfig);
    expect(typeof result.content).toBe('string');
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.path).toBe(templatePath);
  });

  it('uses a custom template path when appConfig.template is set (prod)', async () => {
    const server = serveSSRBuilt(tempPath);
    const customDir = join(tempPath, 'custom');
    await mkdir(customDir, { recursive: true });
    await writeFile(join(customDir, 'app.html'), MINIMAL_HTML);

    const fakeConfig = {
      buildDir: tempPath,
      template: 'custom/app.html',
      clientFolderName: 'client',
    };

    // @ts-expect-error — accessing private method for testing
    const result = await server.loadHTMLTemplate(fakeConfig);
    expect(result.path).toContain('app.html');
    expect(result.content.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// validateAppKey (private) — exercises branches reachable from the private method
// directly, in addition to the indirect coverage from registerHMRApp/registerBuiltApp
// ---------------------------------------------------------------------------

describe('SSRServer.validateAppKey() (private)', () => {
  it('throws for whitespace-only keys (empty after trim is caught by caller)', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    // validateAppKey receives already-trimmed keys; empty string triggers its own guard
    expect(() => {
      // @ts-expect-error — accessing private method for testing
      server.validateAppKey('');
    }).toThrow(/empty/i);
  });

  it('throws for the __default__ reserved key', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => {
      // @ts-expect-error — accessing private method for testing
      server.validateAppKey('__default__');
    }).toThrow(/__default__/);
  });

  it('throws for keys containing forward slashes', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => {
      // @ts-expect-error — accessing private method for testing
      server.validateAppKey('my/app');
    }).toThrow(/path separators/);
  });

  it('throws for keys containing backslashes', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => {
      // @ts-expect-error — accessing private method for testing
      server.validateAppKey('my\\app');
    }).toThrow(/path separators/);
  });

  it('throws when the key is already registered', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    server.registerHMRApp('marketing', FAKE_HMR_PATHS);
    expect(() => {
      // @ts-expect-error — accessing private method for testing
      server.validateAppKey('marketing');
    }).toThrow(/already registered/);
  });

  it('does not throw for a valid fresh key', () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    expect(() => {
      // @ts-expect-error — accessing private method for testing
      server.validateAppKey('marketing');
    }).not.toThrow();
  });
});

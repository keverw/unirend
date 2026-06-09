import { describe, it, expect } from 'bun:test';
import type { InMemoryDir } from './vfs';
import {
  getTemplateConfig,
  createProjectSpecificFiles,
} from './internal-helpers';

// ---------------------------------------------------------------------------
// getTemplateConfig — SSR branch
// ---------------------------------------------------------------------------

describe('getTemplateConfig — ssr', () => {
  it('returns ssr project scripts for bun target', () => {
    const config = getTemplateConfig('my-app', 'ssr', 'src/apps/my-app', 'bun');

    expect(config.projectScripts).toBeDefined();
    expect(config.projectScripts?.['my-app:build']).toBeDefined();
    expect(config.projectScripts?.['my-app:serve:dev']).toContain(
      'serve-hmr.ts',
    );
    // bun target: no --target=node flag in serve:dev
    expect(config.projectScripts?.['my-app:serve:dev']).not.toContain(
      '--target=node',
    );
  });

  it('returns ssr project scripts for node target', () => {
    const config = getTemplateConfig(
      'my-app',
      'ssr',
      'src/apps/my-app',
      'node',
    );

    expect(config.projectScripts?.['my-app:serve:dev']).toContain(
      '--target=node',
    );
    // node runner uses `node` in the built-serve scripts
    expect(config.projectScripts?.['my-app:serve:built:dev']).toMatch(/^node /);
  });

  it('includes the shared generate:build-info script', () => {
    const config = getTemplateConfig('my-app', 'ssr', 'src/apps/my-app', 'bun');

    expect(config.sharedScripts).toHaveProperty('generate:build-info');
  });

  it('includes gitignore and prettierignore entries for the build-info file', () => {
    const config = getTemplateConfig('my-app', 'ssr', 'src/apps/my-app', 'bun');

    expect(config.gitignoreEntries).toContain(
      'src/apps/my-app/current-build-info.ts',
    );
    expect(config.prettierignoreEntries).toContain(
      'src/apps/my-app/current-build-info.ts',
    );
  });

  it('includes ssr cspell words', () => {
    const config = getTemplateConfig('my-app', 'ssr', 'src/apps/my-app', 'bun');

    expect(Array.isArray(config.cspellWords)).toBe(true);
    expect(config.cspellWords?.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// getTemplateConfig — API branch
// ---------------------------------------------------------------------------

describe('getTemplateConfig — api', () => {
  it('returns api project scripts for bun target', () => {
    const config = getTemplateConfig('my-api', 'api', 'src/apps/my-api', 'bun');

    expect(config.projectScripts).toBeDefined();
    expect(config.projectScripts?.['my-api:serve:dev']).toContain(
      'serve.ts dev',
    );
    // bun target: no --target=node flag
    expect(config.projectScripts?.['my-api:serve:dev']).not.toContain(
      '--target=node',
    );
  });

  it('returns api project scripts for node target', () => {
    const config = getTemplateConfig(
      'my-api',
      'api',
      'src/apps/my-api',
      'node',
    );

    expect(config.projectScripts?.['my-api:serve:dev']).toContain(
      '--target=node',
    );
    expect(config.projectScripts?.['my-api:serve:built:dev']).toMatch(/^node /);
  });

  it('includes the shared generate:build-info script', () => {
    const config = getTemplateConfig('my-api', 'api', 'src/apps/my-api', 'bun');

    expect(config.sharedScripts).toHaveProperty('generate:build-info');
  });

  it('includes gitignore and prettierignore entries for the build-info file', () => {
    const config = getTemplateConfig('my-api', 'api', 'src/apps/my-api', 'bun');

    expect(config.gitignoreEntries).toContain(
      'src/apps/my-api/current-build-info.ts',
    );
    expect(config.prettierignoreEntries).toContain(
      'src/apps/my-api/current-build-info.ts',
    );
  });

  it('has no template-specific cspell words', () => {
    const config = getTemplateConfig('my-api', 'api', 'src/apps/my-api', 'bun');

    // API template ships no cspellWords (no HTML/React pages)
    expect(config.cspellWords).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getTemplateConfig — unknown template (exhaustive fallback)
// ---------------------------------------------------------------------------

describe('getTemplateConfig — unknown template', () => {
  it('throws for an unrecognized templateID', () => {
    expect(() =>
      // @ts-expect-error — intentionally passing invalid template
      getTemplateConfig('app', 'does-not-exist', 'src/apps/app', 'bun'),
    ).toThrow(/Unknown template/);
  });
});

// ---------------------------------------------------------------------------
// createProjectSpecificFiles — SSR
// ---------------------------------------------------------------------------

describe('createProjectSpecificFiles — ssr', () => {
  it('writes ssr-specific files into an in-memory root', async () => {
    const root: InMemoryDir = {};

    await createProjectSpecificFiles(
      root,
      'src/apps/my-app',
      'my-app',
      'ssr',
      'bun',
    );

    // Routes.tsx is ssr-specific
    expect(root['src/apps/my-app/Routes.tsx']).toBeDefined();

    // Shared Vite-template files
    expect(root['src/apps/my-app/vite.config.ts']).toBeDefined();
    expect(root['src/apps/my-app/index.html']).toBeDefined();

    // serve-built.ts is ssr-specific (not present in ssg)
    expect(root['src/apps/my-app/serve-built.ts']).toBeDefined();
  });

  it('includes the generate-build-info script file for ssr', async () => {
    const root: InMemoryDir = {};

    await createProjectSpecificFiles(
      root,
      'src/apps/my-app',
      'my-app',
      'ssr',
      'bun',
    );

    // Shared across server templates
    expect(root['scripts/generate-build-info.ts']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createProjectSpecificFiles — API
// ---------------------------------------------------------------------------

describe('createProjectSpecificFiles — api', () => {
  it('writes api-specific files into an in-memory root', async () => {
    const root: InMemoryDir = {};

    await createProjectSpecificFiles(
      root,
      'src/apps/my-api',
      'my-api',
      'api',
      'bun',
    );

    // api-component.ts and serve.ts are api-specific
    expect(root['src/apps/my-api/api-component.ts']).toBeDefined();
    expect(root['src/apps/my-api/serve.ts']).toBeDefined();
  });

  it('does not write vite/html files for api template', async () => {
    const root: InMemoryDir = {};

    await createProjectSpecificFiles(
      root,
      'src/apps/my-api',
      'my-api',
      'api',
      'bun',
    );

    // API template has no Vite config or HTML template
    expect(root['src/apps/my-api/vite.config.ts']).toBeUndefined();
    expect(root['src/apps/my-api/index.html']).toBeUndefined();
  });

  it('includes the generate-build-info script file for api', async () => {
    const root: InMemoryDir = {};

    await createProjectSpecificFiles(
      root,
      'src/apps/my-api',
      'my-api',
      'api',
      'bun',
    );

    expect(root['scripts/generate-build-info.ts']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// createProjectSpecificFiles — unknown template (exhaustive fallback)
// ---------------------------------------------------------------------------

describe('createProjectSpecificFiles — unknown template', () => {
  it('throws for an unrecognized templateID', async () => {
    const root: InMemoryDir = {};
    let caughtError: unknown;
    try {
      // @ts-expect-error — intentionally passing invalid template
      await createProjectSpecificFiles(
        root,
        'src/apps/app',
        'app',
        'does-not-exist',
        'bun',
      );
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(/Unknown template/);
  });
});

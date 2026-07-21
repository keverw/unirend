import { describe, expect, test } from 'bun:test';
import {
  createProject,
  TEMPLATE_IDS,
  REPO_CONFIG_FILE,
  templateExists,
  getTemplateInfo,
  listAvailableTemplatesWithInfo,
  readRepoConfig,
  initRepo,
} from './starter-templates';
import type { TemplateID } from './starter-templates';
import type { InMemoryDir } from './lib/starter-templates/vfs';

describe('createProject', () => {
  test('returns a failure object for unknown template IDs', async () => {
    const repoRoot: InMemoryDir = {};

    const result = await createProject({
      templateID: 'missing-template' as TemplateID,
      projectName: 'demo',
      repoRoot,
      serverBuildTarget: 'node',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result).toEqual({
      success: false,
      error: 'Template "missing-template" not found',
      metadata: {
        templateID: 'missing-template',
        projectName: 'demo',
        repoPath: '[in-memory]',
      },
    });
    expect(repoRoot).toEqual({});
  });

  test('auto-initializes a fresh repo and writes a valid package.json', async () => {
    // Exercises the not_found auto-init path, where the up-front package.json
    // read is threaded through initRepo and back into the base-file pass.
    const repoRoot: InMemoryDir = {};

    const result = await createProject({
      templateID: 'ssg',
      projectName: 'web',
      repoRoot,
      serverBuildTarget: 'node',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(true);

    // Root package.json was created and is valid JSON with the defaults
    expect('package.json' in repoRoot).toBe(true);
    const pkg = JSON.parse(repoRoot['package.json'] as string);
    expect(pkg.name).toBe('unirend-projects');
    expect(pkg.scripts['type-check']).toBe('tsc --noEmit');

    // Repo config records the new project
    const repoConfig = JSON.parse(repoRoot['unirend-repo.json'] as string);
    expect(repoConfig.projects.web).toBeDefined();
    expect(repoConfig.projects.web.templateID).toBe('ssg');
  });

  test('fails early on invalid root package.json before writing anything', async () => {
    // The up-front read must surface a parse error and abort before any files
    // (repo config, base files) are written.
    const repoRoot: InMemoryDir = {
      'package.json': 'not valid json{',
    };

    const result = await createProject({
      templateID: 'ssg',
      projectName: 'web',
      repoRoot,
      serverBuildTarget: 'node',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result).toEqual({
      success: false,
      error: 'Root package.json contains invalid JSON',
      metadata: {
        templateID: 'ssg',
        projectName: 'web',
        repoPath: '[in-memory]',
      },
    });

    // Nothing else should have been written
    expect(Object.keys(repoRoot)).toEqual(['package.json']);
    expect(repoRoot['package.json']).toBe('not valid json{');
  });
});

describe('templateExists', () => {
  test('returns true for every known template ID', () => {
    for (const templateID of TEMPLATE_IDS) {
      expect(templateExists(templateID)).toBe(true);
    }
  });

  test('returns false for unknown and inherited object property names', () => {
    const invalidTemplateIDs = [
      '',
      'missing-template',
      // Template IDs are case-sensitive.
      'SSG',
      'toString',
      'hasOwnProperty',
      '__proto__',
    ];

    for (const templateID of invalidTemplateIDs) {
      expect(templateExists(templateID)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// createProject — ssr and api templates
// ---------------------------------------------------------------------------

describe('createProject — ssr template', () => {
  test('scaffolds an ssr project into a fresh in-memory root', async () => {
    const repoRoot: InMemoryDir = {};

    const result = await createProject({
      templateID: 'ssr',
      projectName: 'web',
      repoRoot,
      serverBuildTarget: 'bun',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(true);
    expect(result.metadata.templateID).toBe('ssr');

    // Repo config records the project
    const repoConfig = JSON.parse(repoRoot[REPO_CONFIG_FILE] as string);
    expect(repoConfig.projects.web.templateID).toBe('ssr');

    // SSR-specific file must exist
    expect(repoRoot['src/apps/web/Routes.tsx']).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// PUBLIC_FILES/PUBLIC_FOLDERS ↔ public/ sync (the templates must pass their
// own check)
// ---------------------------------------------------------------------------

describe('createProject — PUBLIC_FILES/PUBLIC_FOLDERS stay in sync with public/', () => {
  /** Extract a PUBLIC_FILES/PUBLIC_FOLDERS array from a generated consts.ts source. */
  function parsePublicConst(constsSrc: string, constName: string): string[] {
    // Tolerate an optional type annotation (PUBLIC_FOLDERS is emitted as
    // `: string[]` since its default is empty).
    const match = constsSrc.match(
      new RegExp(
        `export const ${constName}(?:: string\\[\\])? = (\\[[^\\]]*\\]);`,
      ),
    );
    expect(match).not.toBeNull();
    return JSON.parse((match as RegExpMatchArray)[1].replace(/'/g, '"'));
  }

  for (const templateID of ['ssr', 'ssg'] as const) {
    test(`${templateID} template declares exactly the public/ files it emits`, async () => {
      const repoRoot: InMemoryDir = {};

      const result = await createProject({
        templateID,
        projectName: 'web',
        repoRoot,
        serverBuildTarget: 'node',
        initGit: false,
        installDependencies: false,
        autoFormat: false,
      });
      expect(result.success).toBe(true);

      const constsSrc = repoRoot['src/apps/web/consts.ts'] as string;
      const declaredFiles = parsePublicConst(constsSrc, 'PUBLIC_FILES');
      const declaredFolders = parsePublicConst(constsSrc, 'PUBLIC_FOLDERS');

      // Every file emitted under public/ (as a URL path)
      const emitted = Object.keys(repoRoot)
        .filter((key) => key.startsWith('src/apps/web/public/'))
        .map((key) => key.slice('src/apps/web/public'.length));

      // Same coverage rule as the generated check script: a file counts as
      // declared if listed in PUBLIC_FILES or under a PUBLIC_FOLDERS prefix.
      const uncoveredByFolders = emitted.filter(
        (urlPath) =>
          !declaredFolders.some((prefix) => urlPath.startsWith(`${prefix}/`)),
      );

      expect(declaredFiles.sort()).toEqual(uncoveredByFolders.sort());
      expect(declaredFiles.length).toBeGreaterThan(0);

      // A declared folder with nothing emitted under it would fail the
      // generated check script (and the SSR boot check) in a fresh repo.
      for (const prefix of declaredFolders) {
        expect(
          emitted.some((urlPath) => urlPath.startsWith(`${prefix}/`)),
        ).toBe(true);
      }
    });
  }

  test('ssr template wires PUBLIC_FILES/PUBLIC_FOLDERS into the built server, ssg into serve.ts', async () => {
    const repoRoot: InMemoryDir = {};

    await createProject({
      templateID: 'ssr',
      projectName: 'web',
      repoRoot,
      serverBuildTarget: 'node',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    await createProject({
      templateID: 'ssg',
      projectName: 'site',
      repoRoot,
      serverBuildTarget: 'node',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    const ssrComponentSrc = repoRoot[
      'src/apps/web/server/ssr-component.ts'
    ] as string;
    expect(ssrComponentSrc).toContain('publicFiles: PUBLIC_FILES');
    expect(ssrComponentSrc).toContain('publicFolders: PUBLIC_FOLDERS');

    const ssgServeSrc = repoRoot['src/apps/site/serve.ts'] as string;
    expect(ssgServeSrc).toContain('PUBLIC_FILES.map');
    expect(ssgServeSrc).toContain('PUBLIC_FOLDERS.map');

    // Each Vite app gets a public-assets.config.json pointing the check at
    // its lists, with the default entry mirroring the scaffolded layout.
    for (const appPath of ['src/apps/web', 'src/apps/site'] as const) {
      const assetsConfig = JSON.parse(
        repoRoot[`${appPath}/public-assets.config.json`] as string,
      );

      expect(assetsConfig).toEqual({
        default: {
          publicDir: 'public',
          constsFile: 'consts.ts',
          filesExport: 'PUBLIC_FILES',
          foldersExport: 'PUBLIC_FOLDERS',
        },
      });
    }

    // The repo-level check script and its package.json wiring exist
    expect(typeof repoRoot['scripts/check-public-assets.ts']).toBe('string');
    const pkg = JSON.parse(repoRoot['package.json'] as string);
    expect(pkg.scripts['check:public-assets']).toBe(
      'bun run scripts/check-public-assets.ts',
    );
    expect(pkg.scripts.check).toContain('bun run check:public-assets');

    // Same for the overrides check
    expect(typeof repoRoot['scripts/check-overrides.ts']).toBe('string');
    expect(pkg.scripts['check:overrides']).toBe(
      'bun run scripts/check-overrides.ts',
    );
    expect(pkg.scripts.check).toContain('bun run check:overrides');

    // Same for the null-byte check
    expect(typeof repoRoot['scripts/check-null-bytes.ts']).toBe('string');
    expect(pkg.scripts['check:null-bytes']).toBe(
      'bun run scripts/check-null-bytes.ts',
    );
    expect(pkg.scripts.check).toContain('bun run check:null-bytes');

    // The lockfile refresher is scaffolded too, but stays out of the check
    // chain — it mutates the lockfile.
    expect(typeof repoRoot['scripts/refresh-lockfile.ts']).toBe('string');
    expect(pkg.scripts['install:fresh']).toBe(
      'bun run scripts/refresh-lockfile.ts',
    );
    expect(pkg.scripts.check).not.toContain('install:fresh');
  });
});

describe('createProject — api template', () => {
  test('scaffolds an api project into a fresh in-memory root', async () => {
    const repoRoot: InMemoryDir = {};

    const result = await createProject({
      templateID: 'api',
      projectName: 'backend',
      repoRoot,
      serverBuildTarget: 'bun',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(true);
    expect(result.metadata.templateID).toBe('api');

    // API-specific file must exist
    expect(repoRoot['src/apps/backend/api-component.ts']).toBeDefined();
    expect(repoRoot['src/apps/backend/serve.ts']).toBeDefined();

    // API apps have no public-file surface, so no public-assets config
    expect(
      repoRoot['src/apps/backend/public-assets.config.json'],
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// createProject — error paths
// ---------------------------------------------------------------------------

describe('createProject — error paths', () => {
  test('returns failure for an invalid project name', async () => {
    const repoRoot: InMemoryDir = {};

    const result = await createProject({
      templateID: 'ssg',
      projectName: 'Invalid Name!',
      repoRoot,
      serverBuildTarget: 'bun',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(false);
    expect(result.metadata.projectName).toBe('Invalid Name!');
    // Nothing written — root stays empty
    expect(Object.keys(repoRoot)).toHaveLength(0);
  });

  test('returns failure when project directory already exists', async () => {
    // vfsExists for in-memory checks for an exact key match, so we need a key
    // at exactly the project path to simulate an existing directory.
    const repoRoot: InMemoryDir = {
      'src/apps/web': '',
    };

    const result = await createProject({
      templateID: 'ssg',
      projectName: 'web',
      repoRoot,
      serverBuildTarget: 'bun',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toMatch(/already exists/);
  });

  test('returns failure when repo config contains invalid JSON', async () => {
    const repoRoot: InMemoryDir = {
      [REPO_CONFIG_FILE]: 'not valid json{',
    };

    const result = await createProject({
      templateID: 'ssg',
      projectName: 'web',
      repoRoot,
      serverBuildTarget: 'bun',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toMatch(/invalid JSON/i);
  });

  test('returns failure when script names conflict with existing scripts', async () => {
    const repoRoot: InMemoryDir = {
      'package.json': JSON.stringify({
        name: 'my-repo',
        scripts: {
          // web:build is a project-specific script that will conflict
          'web:build': 'echo existing',
        },
      }),
      [REPO_CONFIG_FILE]: JSON.stringify({
        manifestVersion: '1.0',
        name: 'my-repo',
        created: new Date().toISOString(),
        projects: {},
      }),
    };

    const result = await createProject({
      templateID: 'ssg',
      projectName: 'web',
      repoRoot,
      serverBuildTarget: 'bun',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toMatch(
      /Script name conflict/,
    );
  });

  test('writes provided starterFiles into the VFS by explicit base', async () => {
    const repoRoot: InMemoryDir = {};

    const result = await createProject({
      templateID: 'ssg',
      projectName: 'web',
      repoRoot,
      serverBuildTarget: 'bun',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
      starterFiles: {
        repoRoot: {
          'README.md': '# Workspace',
        },
        projectRoot: {
          'custom.ts': '// custom starter file',
        },
      },
    });

    expect(result.success).toBe(true);
    expect(repoRoot['README.md']).toBe('# Workspace');
    expect(repoRoot['src/apps/web/custom.ts']).toBe('// custom starter file');
  });
});

// ---------------------------------------------------------------------------
// readRepoConfig
// ---------------------------------------------------------------------------

describe('readRepoConfig', () => {
  test('returns not_found when no config file exists', async () => {
    const root: InMemoryDir = {};
    const result = await readRepoConfig(root);
    expect(result.status).toBe('not_found');
  });

  test('returns found with parsed config when file is valid JSON', async () => {
    const config = {
      manifestVersion: '1.0',
      name: 'my-repo',
      created: new Date().toISOString(),
      projects: {},
    };
    const root: InMemoryDir = {
      [REPO_CONFIG_FILE]: JSON.stringify(config),
    };

    const result = await readRepoConfig(root);
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.config.name).toBe('my-repo');
    }
  });

  test('normalizes a legacy manifest with `version` into `manifestVersion`', async () => {
    // Manifest generated before the `version` → `manifestVersion` rename.
    const legacyConfig = {
      version: '1.0',
      name: 'my-repo',
      created: new Date().toISOString(),
      projects: {},
    };
    const root: InMemoryDir = {
      [REPO_CONFIG_FILE]: JSON.stringify(legacyConfig),
    };

    const result = await readRepoConfig(root);
    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.config.manifestVersion).toBe('1.0');
      // Legacy key is dropped so a re-written manifest doesn't carry both.
      expect((result.config as { version?: unknown }).version).toBeUndefined();
      // The generating version genuinely isn't recorded for legacy manifests.
      expect(result.config.createdWith).toBeUndefined();
    }
  });

  test('returns parse_error when config file contains invalid JSON', async () => {
    const root: InMemoryDir = {
      [REPO_CONFIG_FILE]: 'not valid{',
    };

    const result = await readRepoConfig(root);
    expect(result.status).toBe('parse_error');
  });
});

// ---------------------------------------------------------------------------
// getTemplateInfo and listAvailableTemplatesWithInfo
// ---------------------------------------------------------------------------

describe('getTemplateInfo', () => {
  test('returns template info for each known template', () => {
    for (const id of TEMPLATE_IDS) {
      const info = getTemplateInfo(id);
      expect(info).toBeDefined();
      expect(typeof info.name).toBe('string');
    }
  });
});

describe('listAvailableTemplatesWithInfo', () => {
  test('returns an array of template info objects matching TEMPLATE_IDS length', () => {
    const infos = listAvailableTemplatesWithInfo();
    expect(infos.length).toBe(TEMPLATE_IDS.length);
    for (const info of infos) {
      expect(typeof info.name).toBe('string');
    }
  });
});

// ---------------------------------------------------------------------------
// initRepo
// ---------------------------------------------------------------------------

describe('initRepo', () => {
  test('initializes a fresh in-memory repo and returns success', async () => {
    const root: InMemoryDir = {};
    const result = await initRepo(root, {
      name: 'test-repo',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.config.name).toBe('test-repo');
    }
    expect(root[REPO_CONFIG_FILE]).toBeDefined();
  });

  test('returns failure when called on an already-initialized repo', async () => {
    const config = {
      manifestVersion: '1.0',
      name: 'existing-repo',
      created: new Date().toISOString(),
      projects: {},
    };
    const root: InMemoryDir = {
      [REPO_CONFIG_FILE]: JSON.stringify(config),
    };

    const result = await initRepo(root, {
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('already_exists');
    }
  });

  test('returns failure when repo config file contains invalid JSON', async () => {
    const root: InMemoryDir = {
      [REPO_CONFIG_FILE]: 'bad json{',
    };

    const result = await initRepo(root, {
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('parse_error');
    }
  });

  test('returns failure for an invalid repo name', async () => {
    const root: InMemoryDir = {};

    const result = await initRepo(root, {
      name: 'INVALID NAME!!!',
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('invalid_name');
    }
  });

  test('returns failure when directory is not empty-ish', async () => {
    const root: InMemoryDir = {
      'src/existing-file.ts': '// existing',
    };

    const result = await initRepo(root, {
      initGit: false,
      installDependencies: false,
      autoFormat: false,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe('unsafe_directory');
    }
  });
});

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
        version: '1.0',
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

  test('writes provided starterFiles into the VFS', async () => {
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
        'src/apps/web/custom.ts': '// custom starter file',
      },
    });

    expect(result.success).toBe(true);
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
      version: '1.0',
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
      version: '1.0',
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

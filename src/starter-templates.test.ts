import { describe, expect, test } from 'bun:test';
import {
  createProject,
  TEMPLATE_IDS,
  templateExists,
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

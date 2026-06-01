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

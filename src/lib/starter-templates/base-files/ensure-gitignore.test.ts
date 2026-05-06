import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureGitignore } from './ensure-gitignore';
import type { InMemoryDir } from '../vfs';
import type { LogLevel } from '../types';

const defaultGitignoreSrc = `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Dependencies
node_modules

# Package manager lockfiles
# This project uses Bun - ignore npm/yarn/pnpm lockfiles to avoid confusion
package-lock.json
yarn.lock
pnpm-lock.yaml
# Ignore Bun's binary lockfile (bun.lock JSON format is preferred and should be committed)
bun.lockb

# Environment variables
# Keep secrets out of source control! Document required variables in README or create .env.example
*.local
.env
.env.local
.env.*.local

# AI Development Tools
# Claude Code local settings (personal preferences not shared with team)
.claude/**/*.local*

# Build outputs
dist/
build/
coverage/
.nyc_output/
*.tsbuildinfo
.eslintcache

# Editor directories and files
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea
.DS_Store
Thumbs.db
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Temporary files
tmp/`;

describe('ensureGitignore', () => {
  const createLog = (): Array<{ level: LogLevel; message: string }> => [];

  test('creates .gitignore with default entries', async () => {
    const memRoot: InMemoryDir = {};

    await ensureGitignore(memRoot);

    expect(memRoot['.gitignore']).toBe(defaultGitignoreSrc);
  });

  test('logs when creating .gitignore', async () => {
    const memRoot: InMemoryDir = {};
    const logs = createLog();

    await ensureGitignore(memRoot, {
      log: (level, message) => logs.push({ level, message }),
    });

    expect(logs).toEqual([
      { level: 'info', message: 'Created repo root .gitignore' },
    ]);
  });

  test('creates .gitignore with template-specific entries', async () => {
    const memRoot: InMemoryDir = {};

    await ensureGitignore(memRoot, {
      templateEntries: ['.unirend-ssg.json', 'public/generated/'],
    });

    expect(memRoot['.gitignore']).toBe(
      `${defaultGitignoreSrc}\n\n# Template-specific\n.unirend-ssg.json\npublic/generated/`,
    );
  });

  test('appends missing template-specific entries to an existing .gitignore', async () => {
    const memRoot: InMemoryDir = {
      '.gitignore': 'node_modules\n',
    };

    await ensureGitignore(memRoot, {
      templateEntries: ['.unirend-ssg.json'],
    });

    expect(memRoot['.gitignore']).toBe(
      'node_modules\n\n# Template-specific\n.unirend-ssg.json',
    );
  });

  test('adds a blank line before a new template section', async () => {
    const memRoot: InMemoryDir = {
      '.gitignore': '# Local files\n.env.local',
    };

    await ensureGitignore(memRoot, {
      templateEntries: ['public/generated/'],
    });

    expect(memRoot['.gitignore']).toBe(
      '# Local files\n.env.local\n\n# Template-specific\npublic/generated/',
    );
  });

  test('does not duplicate existing entries', async () => {
    const memRoot: InMemoryDir = {
      '.gitignore': 'node_modules\n.unirend-ssg.json\n',
    };

    await ensureGitignore(memRoot, {
      templateEntries: ['.unirend-ssg.json'],
    });

    expect(memRoot['.gitignore']).toBe('node_modules\n.unirend-ssg.json\n');
  });

  test('leaves an existing .gitignore unchanged when no template entries are provided', async () => {
    const memRoot: InMemoryDir = {
      '.gitignore': 'node_modules\n',
    };

    await ensureGitignore(memRoot);

    expect(memRoot['.gitignore']).toBe('node_modules\n');
  });

  test('does not duplicate the template-specific header', async () => {
    const memRoot: InMemoryDir = {
      '.gitignore': 'node_modules\n\n# Template-specific\n.unirend-ssg.json\n',
    };

    await ensureGitignore(memRoot, {
      templateEntries: ['public/generated/'],
    });

    expect(memRoot['.gitignore']).toBe(
      'node_modules\n\n# Template-specific\n.unirend-ssg.json\npublic/generated/',
    );
  });

  test('logs when updating .gitignore with missing template entries', async () => {
    const memRoot: InMemoryDir = {
      '.gitignore': 'node_modules\n',
    };
    const logs = createLog();

    await ensureGitignore(memRoot, {
      log: (level, message) => logs.push({ level, message }),
      templateEntries: ['.unirend-ssg.json'],
    });

    expect(logs).toEqual([
      {
        level: 'info',
        message: 'Updated repo root .gitignore (added template entries)',
      },
    ]);
  });

  test('groups new entries under an existing template-specific header', async () => {
    const memRoot: InMemoryDir = {
      '.gitignore':
        'node_modules\n\n# Template-specific\n.unirend-ssg.json\n\n# Build outputs\ndist/\n',
    };

    await ensureGitignore(memRoot, {
      templateEntries: ['public/generated/'],
    });

    expect(memRoot['.gitignore']).toBe(
      'node_modules\n\n# Template-specific\n.unirend-ssg.json\npublic/generated/\n\n# Build outputs\ndist/',
    );
  });

  test('groups new entries before the next header when there is no blank line', async () => {
    const memRoot: InMemoryDir = {
      '.gitignore':
        'node_modules\n\n# Template-specific\n.unirend-ssg.json\n# Build outputs\ndist/\n',
    };

    await ensureGitignore(memRoot, {
      templateEntries: ['public/generated/'],
    });

    expect(memRoot['.gitignore']).toBe(
      'node_modules\n\n# Template-specific\n.unirend-ssg.json\npublic/generated/\n\n# Build outputs\ndist/',
    );
  });

  test('groups new entries under an empty existing template section', async () => {
    const memRoot: InMemoryDir = {
      '.gitignore':
        'node_modules\n\n# Template-specific\n# Build outputs\ndist/\n',
    };

    await ensureGitignore(memRoot, {
      templateEntries: ['public/generated/'],
    });

    expect(memRoot['.gitignore']).toBe(
      'node_modules\n\n# Template-specific\npublic/generated/\n\n# Build outputs\ndist/',
    );
  });

  test('uses a custom template section header', async () => {
    const memRoot: InMemoryDir = {
      '.gitignore':
        'node_modules\n\n# SSG generated files\n.unirend-ssg.json\n\n# Build outputs\ndist/\n',
    };

    await ensureGitignore(memRoot, {
      templateSectionHeader: '# SSG generated files',
      templateEntries: ['public/generated/'],
    });

    expect(memRoot['.gitignore']).toBe(
      'node_modules\n\n# SSG generated files\n.unirend-ssg.json\npublic/generated/\n\n# Build outputs\ndist/',
    );
  });

  test('wraps read errors when an existing .gitignore cannot be read as a file', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'unirend-gitignore-'));

    try {
      // Put a directory where the helper expects the .gitignore file. That
      // reliably makes vfsReadText return a read error instead of ENOENT, so
      // this exercises the error branch without OS-specific permission setup.
      await mkdir(join(tempRoot, '.gitignore'));

      // The helper should keep its public error shape while wrapping the
      // lower-level filesystem problem.
      expect(
        ensureGitignore(tempRoot, {
          templateEntries: ['.unirend-ssg.json'],
        }),
      ).rejects.toThrow('Failed to ensure .gitignore');
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

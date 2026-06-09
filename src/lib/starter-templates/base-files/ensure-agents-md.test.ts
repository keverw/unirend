import { describe, expect, test } from 'bun:test';
import { ensureAgentsMD } from './ensure-agents-md';
import type { InMemoryDir } from '../vfs';
import type { LogLevel } from '../types';

const expectedSrc = `# Agent Guidelines

Guidelines and constraints for AI coding agents working in this repository.

## Git Workflow

- **Use Git as Read-Only / Non-Destructive:** Treat Git as read-only by default. Use Git for inspection unless a command is explicitly allowed below.
- **Do Not Modify Repository State:** Do not stage changes, commit changes, discard local changes, reset state, clean files, or switch branches (e.g., do not run \`git add\`, \`git commit\`, \`git checkout\`, \`git reset\`, \`git clean\`, etc.). The human developer is the peer programmer who will review all changes, provide feedback, and handle normal staging, committing, and checkout actions manually.
- **Exception for Renames:** \`git mv\` is allowed for intentional file renames, including case-only renames on case-insensitive filesystems. This command updates Git's index, but is acceptable because it preserves Git's view of the move during refactors.

## Language Style

- **Use American English:** Use American English spelling in code, comments, documentation, tests, and generated text. Keep existing American spellings intact and do not rewrite them to another English locale.
`;

describe('ensureAgentsMD', () => {
  const createLog = (): Array<{ level: LogLevel; message: string }> => [];

  test('creates AGENTS.md if not exists', async () => {
    const memRoot: InMemoryDir = {};

    await ensureAgentsMD(memRoot);

    expect(memRoot['AGENTS.md']).toBe(expectedSrc);
  });

  test('logs when creating AGENTS.md', async () => {
    const memRoot: InMemoryDir = {};
    const logs = createLog();

    await ensureAgentsMD(memRoot, (level, message) => {
      logs.push({ level, message });
    });

    expect(logs).toEqual([
      { level: 'info', message: 'Created repo root AGENTS.md' },
    ]);
  });

  test('does not overwrite existing AGENTS.md', async () => {
    const memRoot: InMemoryDir = {
      'AGENTS.md': 'custom content',
    };
    const logs = createLog();

    await ensureAgentsMD(memRoot, (level, message) => {
      logs.push({ level, message });
    });

    expect(memRoot['AGENTS.md']).toBe('custom content');
    expect(logs).toEqual([]);
  });
});

import { describe, expect, test } from 'bun:test';
import { ensureClaudeMD } from './ensure-claude-md';
import type { InMemoryDir } from '../vfs';
import type { LogLevel } from '../types';

const expectedSrc = `# Claude Code Guidelines

This project keeps its agent guidelines in \`AGENTS.md\` so they're shared across tools. As of June 2026, Claude Code does not read \`AGENTS.md\` automatically, so this file pulls it in:

@AGENTS.md
`;

describe('ensureClaudeMD', () => {
  const createLog = (): Array<{ level: LogLevel; message: string }> => [];

  test('creates CLAUDE.md if not exists', async () => {
    const memRoot: InMemoryDir = {};

    await ensureClaudeMD(memRoot);

    expect(memRoot['CLAUDE.md']).toBe(expectedSrc);
  });

  test('logs when creating CLAUDE.md', async () => {
    const memRoot: InMemoryDir = {};
    const logs = createLog();

    await ensureClaudeMD(memRoot, (level, message) => {
      logs.push({ level, message });
    });

    expect(logs).toEqual([
      { level: 'info', message: 'Created repo root CLAUDE.md' },
    ]);
  });

  test('does not overwrite existing CLAUDE.md', async () => {
    const memRoot: InMemoryDir = {
      'CLAUDE.md': 'custom content',
    };
    const logs = createLog();

    await ensureClaudeMD(memRoot, (level, message) => {
      logs.push({ level, message });
    });

    expect(memRoot['CLAUDE.md']).toBe('custom content');
    expect(logs).toEqual([]);
  });
});

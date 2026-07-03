import { describe, expect, test } from 'bun:test';
import { ensureReadmeMD } from './ensure-readme-md';
import type { InMemoryDir } from '../vfs';
import type { LogLevel } from '../types';

describe('ensureReadmeMD', () => {
  const createLog = (): Array<{ level: LogLevel; message: string }> => [];

  test('creates README.md titled with the repo name when none exists', async () => {
    const memRoot: InMemoryDir = {};

    await ensureReadmeMD(memRoot, 'my-workspace', false);

    const contents = memRoot['README.md'];
    expect(typeof contents).toBe('string');
    expect(contents).toContain('# my-workspace');
    expect(contents).toContain('scaffolded with [unirend]');
    expect(contents).toContain('See [LICENSE](./LICENSE)');
  });

  test('logs when creating README.md', async () => {
    const memRoot: InMemoryDir = {};
    const logs = createLog();

    await ensureReadmeMD(memRoot, 'my-workspace', false, (level, message) => {
      logs.push({ level, message });
    });

    expect(logs).toEqual([
      { level: 'info', message: 'Created repo root README.md' },
    ]);
  });

  test('does nothing when hasReadme is true (an existing readme was detected)', async () => {
    const memRoot: InMemoryDir = {
      'readme.md': 'lowercase readme',
    };
    const logs = createLog();

    await ensureReadmeMD(memRoot, 'my-workspace', true, (level, message) => {
      logs.push({ level, message });
    });

    expect(memRoot['README.md']).toBeUndefined();
    expect(memRoot['readme.md']).toBe('lowercase readme');
    expect(logs).toEqual([]);
  });
});

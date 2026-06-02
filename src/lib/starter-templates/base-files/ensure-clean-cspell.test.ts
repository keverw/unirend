import { describe, expect, test } from 'bun:test';
import { ensureCleanCspell } from './ensure-clean-cspell';
import type { InMemoryDir } from '../vfs';
import type { LogLevel } from '../types';

describe('ensureCleanCspell', () => {
  const createLog = (): Array<{ level: LogLevel; message: string }> => [];

  test('creates scripts/clean-cspell.ts if not exists', async () => {
    const memRoot: InMemoryDir = {};

    await ensureCleanCspell(memRoot);

    expect('scripts/clean-cspell.ts' in memRoot).toBe(true);
    const content = memRoot['scripts/clean-cspell.ts'] as string;
    expect(content).toContain("import picomatch from 'picomatch';");
    expect(content).toContain('async function getFiles(');
  });

  test('logs when creating scripts/clean-cspell.ts', async () => {
    const memRoot: InMemoryDir = {};
    const logs = createLog();

    await ensureCleanCspell(memRoot, (level, message) => {
      logs.push({ level, message });
    });

    expect(logs).toEqual([
      { level: 'info', message: 'Created scripts/clean-cspell.ts' },
    ]);
  });

  test('does not overwrite existing scripts/clean-cspell.ts', async () => {
    const memRoot: InMemoryDir = {
      'scripts/clean-cspell.ts': 'custom content',
    };
    const logs = createLog();

    await ensureCleanCspell(memRoot, (level, message) => {
      logs.push({ level, message });
    });

    expect(memRoot['scripts/clean-cspell.ts']).toBe('custom content');
    expect(logs).toEqual([]);
  });
});

import { describe, expect, test } from 'bun:test';
import { ensureLicense } from './ensure-license';
import type { InMemoryDir } from '../vfs';
import type { LogLevel } from '../types';

describe('ensureLicense', () => {
  const createLog = (): Array<{ level: LogLevel; message: string }> => [];

  test('creates a LICENSE placeholder when none exists', async () => {
    const memRoot: InMemoryDir = {};

    await ensureLicense(memRoot, false);

    const contents = memRoot['LICENSE'];
    expect(typeof contents).toBe('string');
    expect(contents).toContain('UNLICENSED');
    expect(contents).toContain('All rights reserved.');
    expect(contents).toContain('choose a real license');
  });

  test('logs when creating LICENSE', async () => {
    const memRoot: InMemoryDir = {};
    const logs = createLog();

    await ensureLicense(memRoot, false, (level, message) => {
      logs.push({ level, message });
    });

    expect(logs).toEqual([
      { level: 'info', message: 'Created repo root LICENSE' },
    ]);
  });

  test('does nothing when hasLicense is true (an existing license variant was detected)', async () => {
    const memRoot: InMemoryDir = {
      'LICENSE.md': '# MIT License',
    };
    const logs = createLog();

    await ensureLicense(memRoot, true, (level, message) => {
      logs.push({ level, message });
    });

    expect(memRoot['LICENSE']).toBeUndefined();
    expect(memRoot['LICENSE.md']).toBe('# MIT License');
    expect(logs).toEqual([]);
  });
});

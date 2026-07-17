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

    // The wrapper delegates to the packaged scan (so repos pick up fixes by
    // upgrading unirend), parses the fix flags, and sets the exit code.
    expect(content).toContain(
      "import { cleanCspell } from 'unirend/repo-tools';",
    );
    expect(content).toContain("process.argv.includes('--write')");
    expect(content).toContain('await cleanCspell({');
    // Anchored to the repo root so direct invocation from a subfolder works
    expect(content).toContain("rootDir: join(import.meta.dirname, '..'),");
    expect(content).toContain('fix: isFix,');
    expect(content).toContain('process.exit(1)');
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

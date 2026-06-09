import { describe, expect, test } from 'bun:test';
import { ensureGenerateBuildInfo } from './generate-build-info';
import type { InMemoryDir } from '../vfs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger() {
  const calls: Array<[string, string]> = [];
  const log = (level: string, msg: string) => {
    calls.push([level, msg]);
  };
  return { log, calls };
}

// ---------------------------------------------------------------------------
// ensureGenerateBuildInfo
// ---------------------------------------------------------------------------

describe('ensureGenerateBuildInfo', () => {
  test('creates scripts/generate-build-info.ts when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureGenerateBuildInfo(mem);
    const key = 'scripts/generate-build-info.ts';
    expect(typeof mem[key]).toBe('string');
  });

  test('generated script contains GenerateBuildInfo usage', async () => {
    const mem: InMemoryDir = {};
    await ensureGenerateBuildInfo(mem);
    const src = mem['scripts/generate-build-info.ts'] as string;
    expect(src).toContain('GenerateBuildInfo');
  });

  test('generated script reads from build-info.config.json', async () => {
    const mem: InMemoryDir = {};
    await ensureGenerateBuildInfo(mem);
    const src = mem['scripts/generate-build-info.ts'] as string;
    expect(src).toContain('build-info.config.json');
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureGenerateBuildInfo(mem, log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('generate-build-info.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const key = 'scripts/generate-build-info.ts';
    const mem: InMemoryDir = { [key]: existing };
    await ensureGenerateBuildInfo(mem);
    expect(mem[key]).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const key = 'scripts/generate-build-info.ts';
    const mem: InMemoryDir = { [key]: 'existing' };
    const { log, calls } = makeLogger();
    await ensureGenerateBuildInfo(mem, log);
    expect(calls).toHaveLength(0);
  });

  test('calling twice is idempotent', async () => {
    const mem: InMemoryDir = {};
    await ensureGenerateBuildInfo(mem);
    const firstContent = mem['scripts/generate-build-info.ts'] as string;
    await ensureGenerateBuildInfo(mem);
    expect(mem['scripts/generate-build-info.ts']).toBe(firstContent);
  });

  test('works without a log argument', async () => {
    const mem: InMemoryDir = {};
    await ensureGenerateBuildInfo(mem);
    expect('scripts/generate-build-info.ts' in mem).toBe(true);
  });
});

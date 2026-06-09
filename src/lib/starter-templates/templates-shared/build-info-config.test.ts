import { describe, expect, test } from 'bun:test';
import { ensureBuildInfoOutput } from './build-info-config';
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

function readJSON(mem: InMemoryDir, path: string): unknown {
  const raw = mem[path];
  if (typeof raw !== 'string') {
    throw new TypeError(`${path} not found or not a string`);
  }
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// ensureBuildInfoOutput
// ---------------------------------------------------------------------------

describe('ensureBuildInfoOutput', () => {
  test('creates build-info.config.json with the given outputPath when file does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureBuildInfoOutput(mem, 'src/apps/my-app/current-build-info.ts');

    const config = readJSON(mem, 'build-info.config.json') as {
      outputs: string[];
    };
    expect(Array.isArray(config.outputs)).toBe(true);
    expect(config.outputs).toContain('src/apps/my-app/current-build-info.ts');
    expect(config.outputs).toHaveLength(1);
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureBuildInfoOutput(
      mem,
      'src/apps/my-app/current-build-info.ts',
      log,
    );
    expect(calls.some(([level]) => level === 'info')).toBe(true);
    expect(
      calls.some(([, msg]) => msg.includes('build-info.config.json')),
    ).toBe(true);
  });

  test('appends outputPath when file exists with a valid outputs array', async () => {
    const initial = JSON.stringify({
      outputs: ['src/apps/existing-app/current-build-info.ts'],
    });
    const mem: InMemoryDir = { 'build-info.config.json': initial };

    await ensureBuildInfoOutput(mem, 'src/apps/new-app/current-build-info.ts');

    const config = readJSON(mem, 'build-info.config.json') as {
      outputs: string[];
    };
    expect(config.outputs).toContain(
      'src/apps/existing-app/current-build-info.ts',
    );
    expect(config.outputs).toContain('src/apps/new-app/current-build-info.ts');
    expect(config.outputs).toHaveLength(2);
  });

  test('logs info when outputPath is appended to existing file', async () => {
    const initial = JSON.stringify({ outputs: [] });
    const mem: InMemoryDir = { 'build-info.config.json': initial };
    const { log, calls } = makeLogger();
    await ensureBuildInfoOutput(
      mem,
      'src/apps/my-app/current-build-info.ts',
      log,
    );
    expect(calls.some(([level]) => level === 'info')).toBe(true);
  });

  test('is a no-op when outputPath is already in the array', async () => {
    const path = 'src/apps/my-app/current-build-info.ts';
    const initial = JSON.stringify({ outputs: [path] });
    const mem: InMemoryDir = { 'build-info.config.json': initial };

    await ensureBuildInfoOutput(mem, path);

    const config = readJSON(mem, 'build-info.config.json') as {
      outputs: string[];
    };
    expect(config.outputs).toHaveLength(1);
    // File content should be unchanged
    expect(mem['build-info.config.json']).toBe(initial);
  });

  test('does not log when outputPath is already present', async () => {
    const path = 'src/apps/my-app/current-build-info.ts';
    const initial = JSON.stringify({ outputs: [path] });
    const mem: InMemoryDir = { 'build-info.config.json': initial };
    const { log, calls } = makeLogger();
    await ensureBuildInfoOutput(mem, path, log);
    expect(calls).toHaveLength(0);
  });

  test('handles a file with an absent outputs key (treated as empty array)', async () => {
    const initial = JSON.stringify({});
    const mem: InMemoryDir = { 'build-info.config.json': initial };

    await ensureBuildInfoOutput(mem, 'src/apps/my-app/current-build-info.ts');

    const config = readJSON(mem, 'build-info.config.json') as {
      outputs: string[];
    };
    expect(Array.isArray(config.outputs)).toBe(true);
    expect(config.outputs).toContain('src/apps/my-app/current-build-info.ts');
  });

  test('throws when outputs is present but not an array', async () => {
    const initial = JSON.stringify({ outputs: 'not-an-array' });
    const mem: InMemoryDir = { 'build-info.config.json': initial };

    let caughtError: unknown;
    try {
      await ensureBuildInfoOutput(mem, 'src/apps/my-app/current-build-info.ts');
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
  });

  test('error message includes "outputs" context when outputs is wrong type', async () => {
    const initial = JSON.stringify({ outputs: 42 });
    const mem: InMemoryDir = { 'build-info.config.json': initial };

    let error: Error | undefined;
    try {
      await ensureBuildInfoOutput(mem, 'src/apps/my-app/current-build-info.ts');
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('outputs');
  });

  test('throws when build-info.config.json contains invalid JSON', async () => {
    const mem: InMemoryDir = { 'build-info.config.json': 'not valid json{' };

    let caughtError: unknown;
    try {
      await ensureBuildInfoOutput(mem, 'src/apps/my-app/current-build-info.ts');
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
  });

  test('error message mentions build-info.config.json on invalid JSON', async () => {
    const mem: InMemoryDir = { 'build-info.config.json': '{broken' };

    let error: Error | undefined;
    try {
      await ensureBuildInfoOutput(mem, 'src/apps/my-app/current-build-info.ts');
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('build-info.config.json');
  });

  test('multiple distinct outputPaths accumulate correctly', async () => {
    const mem: InMemoryDir = {};
    await ensureBuildInfoOutput(mem, 'src/apps/app-a/current-build-info.ts');
    await ensureBuildInfoOutput(mem, 'src/apps/app-b/current-build-info.ts');
    await ensureBuildInfoOutput(mem, 'src/apps/app-c/current-build-info.ts');

    const config = readJSON(mem, 'build-info.config.json') as {
      outputs: string[];
    };
    expect(config.outputs).toHaveLength(3);
    expect(config.outputs).toContain('src/apps/app-a/current-build-info.ts');
    expect(config.outputs).toContain('src/apps/app-b/current-build-info.ts');
    expect(config.outputs).toContain('src/apps/app-c/current-build-info.ts');
  });

  test('calling with the same path multiple times is idempotent', async () => {
    const mem: InMemoryDir = {};
    const path = 'src/apps/my-app/current-build-info.ts';
    await ensureBuildInfoOutput(mem, path);
    await ensureBuildInfoOutput(mem, path);
    await ensureBuildInfoOutput(mem, path);

    const config = readJSON(mem, 'build-info.config.json') as {
      outputs: string[];
    };
    expect(config.outputs).toHaveLength(1);
  });
});

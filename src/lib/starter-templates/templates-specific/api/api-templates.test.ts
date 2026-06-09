import { describe, expect, test } from 'bun:test';
import { ensureAPIComponent } from './api-component';
import { ensureAPIServe } from './api-serve';
import type { InMemoryDir } from '../../vfs';

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
// ensureAPIComponent
// ---------------------------------------------------------------------------

describe('ensureAPIComponent', () => {
  test('creates api-component.ts when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureAPIComponent(mem, 'src/apps/api', 'api');
    const key = 'src/apps/api/api-component.ts';
    expect(typeof mem[key]).toBe('string');
    expect(mem[key] as string).toContain('APIServerComponent');
  });

  test('interpolates appName-derived PORT env var into the source', async () => {
    const mem: InMemoryDir = {};
    await ensureAPIComponent(mem, 'src/apps/api', 'api');
    const src = mem['src/apps/api/api-component.ts'] as string;
    // buildAppEnvVarName('api', 'PORT') → 'API_PORT'
    expect(src).toContain('API_PORT');
  });

  test('uses a different appName to produce a different env var', async () => {
    const mem: InMemoryDir = {};
    await ensureAPIComponent(mem, 'src/apps/my-api', 'my-api');
    const src = mem['src/apps/my-api/api-component.ts'] as string;
    expect(src).toContain('MY_API_PORT');
  });

  test('uses the correct projectPath prefix in the file path', async () => {
    const mem: InMemoryDir = {};
    await ensureAPIComponent(mem, 'src/apps/other', 'other');
    expect('src/apps/other/api-component.ts' in mem).toBe(true);
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureAPIComponent(mem, 'src/apps/api', 'api', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('api-component.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const key = 'src/apps/api/api-component.ts';
    const mem: InMemoryDir = { [key]: existing };
    await ensureAPIComponent(mem, 'src/apps/api', 'api');
    expect(mem[key]).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const key = 'src/apps/api/api-component.ts';
    const mem: InMemoryDir = { [key]: 'existing' };
    const { log, calls } = makeLogger();
    await ensureAPIComponent(mem, 'src/apps/api', 'api', log);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// ensureAPIServe
// ---------------------------------------------------------------------------

describe('ensureAPIServe', () => {
  test('creates serve.ts when it does not exist', async () => {
    const mem: InMemoryDir = {};
    await ensureAPIServe(mem, 'src/apps/api', 'api');
    const key = 'src/apps/api/serve.ts';
    expect(typeof mem[key]).toBe('string');
    expect(mem[key] as string).toContain('LifecycleManager');
  });

  test('interpolates appName into the LifecycleManager name', async () => {
    const mem: InMemoryDir = {};
    await ensureAPIServe(mem, 'src/apps/api', 'api');
    const src = mem['src/apps/api/serve.ts'] as string;
    expect(src).toContain('api-api-server');
  });

  test('uses a different appName to produce a different manager name', async () => {
    const mem: InMemoryDir = {};
    await ensureAPIServe(mem, 'src/apps/my-api', 'my-api');
    const src = mem['src/apps/my-api/serve.ts'] as string;
    expect(src).toContain('my-api-api-server');
  });

  test('uses the correct projectPath prefix in the file path', async () => {
    const mem: InMemoryDir = {};
    await ensureAPIServe(mem, 'src/apps/other', 'other');
    expect('src/apps/other/serve.ts' in mem).toBe(true);
  });

  test('logs info when file is created', async () => {
    const mem: InMemoryDir = {};
    const { log, calls } = makeLogger();
    await ensureAPIServe(mem, 'src/apps/api', 'api', log);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe('info');
    expect(calls[0][1]).toContain('serve.ts');
  });

  test('is a no-op when file already exists', async () => {
    const existing = 'existing content';
    const key = 'src/apps/api/serve.ts';
    const mem: InMemoryDir = { [key]: existing };
    await ensureAPIServe(mem, 'src/apps/api', 'api');
    expect(mem[key]).toBe(existing);
  });

  test('does not log when file already exists', async () => {
    const key = 'src/apps/api/serve.ts';
    const mem: InMemoryDir = { [key]: 'existing' };
    const { log, calls } = makeLogger();
    await ensureAPIServe(mem, 'src/apps/api', 'api', log);
    expect(calls).toHaveLength(0);
  });
});

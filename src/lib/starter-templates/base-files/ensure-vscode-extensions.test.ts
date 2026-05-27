import { describe, test, expect } from 'bun:test';
import { ensureVSCodeExtensions } from './ensure-vscode-extensions';
import type { InMemoryDir } from '../vfs';
import type { LogLevel } from '../types';

describe('ensureVSCodeExtensions', () => {
  const createLog = (): Array<{ level: LogLevel; message: string }> => [];

  test('creates .vscode/extensions.json with default recommendations if not exists', async () => {
    const memRoot: InMemoryDir = {};

    await ensureVSCodeExtensions(memRoot);

    expect('.vscode/extensions.json' in memRoot).toBe(true);

    const extensions = JSON.parse(memRoot['.vscode/extensions.json'] as string);
    expect(extensions.recommendations).toContain('dbaeumer.vscode-eslint');
    expect(extensions.recommendations).toContain('esbenp.prettier-vscode');
    expect(extensions.recommendations).toContain(
      'streetsidesoftware.code-spell-checker',
    );
  });

  test('adds missing recommendations without removing existing ones', async () => {
    const memRoot: InMemoryDir = {
      '.vscode/extensions.json': JSON.stringify({
        recommendations: ['custom.extension'],
      }),
    };

    await ensureVSCodeExtensions(memRoot);

    const extensions = JSON.parse(memRoot['.vscode/extensions.json'] as string);
    expect(extensions.recommendations).toContain('custom.extension');
    expect(extensions.recommendations).toContain('dbaeumer.vscode-eslint');
  });

  test('logs when creating .vscode/extensions.json', async () => {
    const memRoot: InMemoryDir = {};
    const logs = createLog();

    await ensureVSCodeExtensions(memRoot, (level, message) => {
      logs.push({ level, message });
    });

    expect(logs).toEqual([
      { level: 'info', message: 'Created .vscode/extensions.json' },
    ]);
  });

  test('handles invalid JSON with proper error', () => {
    const memRoot: InMemoryDir = {
      '.vscode/extensions.json': 'invalid json{',
    };

    expect(ensureVSCodeExtensions(memRoot)).rejects.toThrow(
      'Failed to ensure .vscode/extensions.json: Invalid JSON in .vscode/extensions.json',
    );
  });
});

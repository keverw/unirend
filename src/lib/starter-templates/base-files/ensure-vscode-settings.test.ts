import { describe, test, expect } from 'bun:test';
import { ensureVSCodeSettings } from './ensure-vscode-settings';
import type { InMemoryDir } from '../vfs';
import type { LogLevel } from '../types';

describe('ensureVSCodeSettings', () => {
  const createLog = (): Array<{ level: LogLevel; message: string }> => [];

  test('creates .vscode/settings.json with default settings if not exists', async () => {
    const memRoot: InMemoryDir = {};

    await ensureVSCodeSettings(memRoot);

    expect('.vscode/settings.json' in memRoot).toBe(true);

    const settings = JSON.parse(memRoot['.vscode/settings.json'] as string);
    expect(settings['editor.defaultFormatter']).toBe('esbenp.prettier-vscode');
    expect(settings['prettier.requireConfig']).toBe(true);
    expect(settings['jestrunner.jestCommand']).toBe('bun test');
  });

  test('adds missing settings without overwriting existing ones', async () => {
    const memRoot: InMemoryDir = {
      '.vscode/settings.json': JSON.stringify({
        'editor.defaultFormatter': 'custom.formatter',
      }),
    };

    await ensureVSCodeSettings(memRoot);

    const settings = JSON.parse(memRoot['.vscode/settings.json'] as string);
    expect(settings['editor.defaultFormatter']).toBe('custom.formatter');
    expect(settings['prettier.requireConfig']).toBe(true);
  });

  test('logs when creating .vscode/settings.json', async () => {
    const memRoot: InMemoryDir = {};
    const logs = createLog();

    await ensureVSCodeSettings(memRoot, (level, message) => {
      logs.push({ level, message });
    });

    expect(logs).toEqual([
      { level: 'info', message: 'Created .vscode/settings.json' },
    ]);
  });

  test('handles invalid JSON with proper error', () => {
    const memRoot: InMemoryDir = {
      '.vscode/settings.json': 'invalid json{',
    };

    expect(ensureVSCodeSettings(memRoot)).rejects.toThrow(
      'Failed to ensure .vscode/settings.json: Invalid JSON in .vscode/settings.json',
    );
  });
});

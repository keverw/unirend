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

  test('replaces a superseded extension with its replacement', async () => {
    const memRoot: InMemoryDir = {
      '.vscode/extensions.json': JSON.stringify({
        recommendations: ['Gruntfuggly.todo-tree', 'custom.extension'],
      }),
    };

    await ensureVSCodeExtensions(memRoot);

    const extensions = JSON.parse(memRoot['.vscode/extensions.json'] as string);
    expect(extensions.recommendations).not.toContain('Gruntfuggly.todo-tree');
    expect(extensions.recommendations).toContain(
      'FanaticPythoner.better-todo-tree',
    );

    // Unrelated entries the user added survive the replacement
    expect(extensions.recommendations).toContain('custom.extension');
  });

  test('matches a superseded extension case-insensitively', async () => {
    const memRoot: InMemoryDir = {
      '.vscode/extensions.json': JSON.stringify({
        // VS Code treats publisher.name as case-insensitive, so a hand-edited
        // file disagreeing with our casing must still be recognized
        recommendations: ['gruntfuggly.TODO-Tree'],
      }),
    };

    await ensureVSCodeExtensions(memRoot);

    const extensions = JSON.parse(memRoot['.vscode/extensions.json'] as string);
    expect(
      extensions.recommendations.filter((ext: string) =>
        ext.toLowerCase().includes('todo-tree'),
      ),
    ).toEqual(['FanaticPythoner.better-todo-tree']);
  });

  test('does not duplicate an existing entry that differs only by case', async () => {
    const memRoot: InMemoryDir = {
      '.vscode/extensions.json': JSON.stringify({
        recommendations: ['DBAEUMER.VSCode-ESLint'],
      }),
    };

    await ensureVSCodeExtensions(memRoot);

    const extensions = JSON.parse(memRoot['.vscode/extensions.json'] as string);
    expect(
      extensions.recommendations.filter(
        (ext: string) => ext.toLowerCase() === 'dbaeumer.vscode-eslint',
      ),
    ).toEqual(['DBAEUMER.VSCode-ESLint']);
  });

  test('leaves the file alone when nothing needs changing', async () => {
    const memRoot: InMemoryDir = {};
    await ensureVSCodeExtensions(memRoot);

    const afterCreate = memRoot['.vscode/extensions.json'] as string;
    const logs = createLog();

    await ensureVSCodeExtensions(memRoot, (level, message) => {
      logs.push({ level, message });
    });

    expect(memRoot['.vscode/extensions.json']).toBe(afterCreate);
    expect(logs).toEqual([]);
  });

  test('logs what it added and removed', async () => {
    const memRoot: InMemoryDir = {
      '.vscode/extensions.json': JSON.stringify({
        recommendations: ['Gruntfuggly.todo-tree'],
      }),
    };
    const logs = createLog();

    await ensureVSCodeExtensions(memRoot, (level, message) => {
      logs.push({ level, message });
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('info');
    expect(logs[0].message).toContain('removed Gruntfuggly.todo-tree');
    expect(logs[0].message).toContain('FanaticPythoner.better-todo-tree');
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

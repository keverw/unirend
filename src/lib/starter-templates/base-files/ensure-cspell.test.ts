import { describe, test, expect } from 'bun:test';
import { ensureCspell } from './ensure-cspell';
import type { InMemoryDir } from '../vfs';
import type { LogLevel } from '../types';

describe('ensureCspell', () => {
  const createLog = (): Array<{ level: LogLevel; message: string }> => [];
  const expectedDefaultWords = [
    'bradlc',
    'dbaeumer',
    'esbenp',
    'eslintcache',
    'firsttris',
    'Gruntfuggly',
    'jestrunner',
    'jmbeach',
    'Lifecycleion',
    'treemap',
    'Unirend',
  ];

  const sortWords = (words: string[]): string[] =>
    [...words].sort((a, b) => a.localeCompare(b));

  test('creates cspell.json with default configuration if not exists', async () => {
    const memRoot: InMemoryDir = {};

    await ensureCspell(memRoot);

    expect('cspell.json' in memRoot).toBe(true);

    const config = JSON.parse(memRoot['cspell.json'] as string);
    expect(config.version).toBe('0.2');
    expect(config.language).toBe('en');
    expect(config.words).toEqual(sortWords(expectedDefaultWords));
    expect(config.ignorePaths).toEqual([
      '**/node_modules/**',
      '**/build/**',
      '**/dist/**',
      '**/coverage/**',
      '**/tmp/**',
      '**/current-build-info.*',
      'bun.lock',
      'bun.lockb',
    ]);
  });

  test('logs when creating cspell.json', async () => {
    const memRoot: InMemoryDir = {};
    const logs = createLog();

    await ensureCspell(memRoot, {
      log: (level, message) => {
        logs.push({ level, message });
      },
    });

    expect(logs).toEqual([{ level: 'info', message: 'Created cspell.json' }]);
  });

  test('merges default words and ignorePaths into an existing cspell.json', async () => {
    const memRoot: InMemoryDir = {
      'cspell.json': JSON.stringify({
        version: '0.2',
        language: 'en',
        words: ['customword'],
        ignorePaths: ['custompath'],
      }),
    };

    await ensureCspell(memRoot);

    const config = JSON.parse(memRoot['cspell.json'] as string);
    expect(config.words).toEqual(
      sortWords(['customword', ...expectedDefaultWords]),
    );
    expect(config.ignorePaths).toContain('custompath');
    expect(config.ignorePaths).toContain('**/node_modules/**');
    expect(config.ignorePaths).toContain('bun.lock');
  });

  test('merges custom template-specific words and sorts them', async () => {
    const memRoot: InMemoryDir = {
      'cspell.json': JSON.stringify({
        version: '0.2',
        language: 'en',
        words: ['zebra', 'apple'],
      }),
    };

    await ensureCspell(memRoot, {
      templateCspellWords: ['banana', 'Unirend'], // Unirend is already a default, banana is template specific
    });

    const config = JSON.parse(memRoot['cspell.json'] as string);
    // Should be sorted alphabetically and deduplicated
    expect(config.words).toEqual(
      sortWords(['apple', 'banana', ...expectedDefaultWords, 'zebra']),
    );
  });

  test('deduplicates input words', async () => {
    const memRoot: InMemoryDir = {};

    await ensureCspell(memRoot, {
      templateCspellWords: ['Unirend', 'Unirend', 'apple', 'apple'],
    });

    const config = JSON.parse(memRoot['cspell.json'] as string);
    expect(config.words).toEqual(sortWords(['apple', ...expectedDefaultWords]));
  });

  test('logs when updating cspell.json', async () => {
    const memRoot: InMemoryDir = {
      'cspell.json': JSON.stringify({
        version: '0.2',
        language: 'en',
        words: ['existing'],
      }),
    };
    const logs = createLog();

    await ensureCspell(memRoot, {
      templateCspellWords: ['newword'],
      log: (level, message) => {
        logs.push({ level, message });
      },
    });

    expect(logs).toEqual([
      {
        level: 'info',
        message: 'Updated cspell.json with missing settings/words',
      },
    ]);
  });

  test('does not update cspell.json if no changes are needed', async () => {
    const memRoot: InMemoryDir = {
      'cspell.json': JSON.stringify({
        version: '0.2',
        language: 'en',
        words: sortWords(expectedDefaultWords),
        ignorePaths: [
          '**/node_modules/**',
          '**/build/**',
          '**/dist/**',
          '**/coverage/**',
          '**/tmp/**',
          '**/current-build-info.*',
          'bun.lock',
          'bun.lockb',
        ],
      }),
    };
    const logs = createLog();

    await ensureCspell(memRoot, {
      log: (level, message) => {
        logs.push({ level, message });
      },
    });

    // Content should remain identical (with formatting differences handled by stringify)
    const config = JSON.parse(memRoot['cspell.json'] as string);
    expect(config.words).toEqual(sortWords(expectedDefaultWords));
    expect(logs).toEqual([]); // No logs since no write occurred
  });

  test('handles invalid JSON with proper error', () => {
    const memRoot: InMemoryDir = {
      'cspell.json': 'invalid json{',
    };

    expect(ensureCspell(memRoot)).rejects.toThrow(
      'Failed to ensure cspell.json: Invalid JSON in cspell.json',
    );
  });
});

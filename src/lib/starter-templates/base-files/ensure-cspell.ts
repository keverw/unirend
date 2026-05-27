import { vfsReadJSON, vfsWriteJSON } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

export interface CSpellConfig {
  version?: string;
  language?: string;
  words?: string[];
  ignorePaths?: string[];
  [key: string]: unknown;
}

export interface EnsureCspellOptions {
  log?: LoggerFunction;
  templateCspellWords?: string[];
}

const defaultWords = [
  'bradlc',
  'dbaeumer',
  'esbenp',
  'firsttris',
  'Gruntfuggly',
  'jmbeach',
  'Lifecycleion',
  'treemap',
  'Unirend',
];

const defaultIgnorePaths = [
  '**/node_modules/**',
  '**/build/**',
  '**/dist/**',
  '**/coverage/**',
  '**/tmp/**',
  '**/current-build-info.*',
  'bun.lock',
  'bun.lockb',
];

/**
 * Ensure cspell.json exists at the repo root.
 * If the file exists, merges in any missing default and template-specific words.
 * Also ensures standard ignore paths are present.
 * Keeps words sorted and duplicate-free.
 *
 * @throws {Error} If file read/write fails
 */
export async function ensureCspell(
  repoRoot: FileRoot,
  options?: EnsureCspellOptions,
): Promise<void> {
  const filePath = 'cspell.json';
  const targetWords = [
    ...defaultWords,
    ...(options?.templateCspellWords ?? []),
  ];

  try {
    const readResult = await vfsReadJSON<CSpellConfig>(repoRoot, filePath);

    if (!readResult.ok) {
      if (readResult.code !== 'ENOENT') {
        if (readResult.code === 'PARSE_ERROR') {
          throw new Error(`Invalid JSON in cspell.json: ${readResult.message}`);
        }

        throw new Error(`Failed to read cspell.json: ${readResult.message}`);
      }

      // File doesn't exist, create it with target words (sorted and unique)
      const words = Array.from(new Set(targetWords)).sort((a, b) =>
        a.localeCompare(b),
      );

      const config: CSpellConfig = {
        version: '0.2',
        language: 'en',
        words,
        ignorePaths: [...defaultIgnorePaths],
      };

      await vfsWriteJSON(repoRoot, filePath, config);

      if (options?.log) {
        options.log('info', 'Created cspell.json');
      }

      return;
    }

    if (readResult.data) {
      // File exists, merge configuration
      const config = readResult.data;
      let didChange = false;

      if (!config.version) {
        config.version = '0.2';
        didChange = true;
      }

      if (!config.language) {
        config.language = 'en';
        didChange = true;
      }

      if (!config.words || !Array.isArray(config.words)) {
        config.words = [];
        didChange = true;
      }

      // Add missing words
      for (const word of targetWords) {
        if (!config.words.includes(word)) {
          config.words.push(word);
          didChange = true;
        }
      }

      // If change occurred, sort and deduplicate the words
      if (didChange) {
        config.words = Array.from(new Set(config.words)).sort((a, b) =>
          a.localeCompare(b),
        );
      }

      // Ensure ignorePaths exists and has defaults
      if (!config.ignorePaths || !Array.isArray(config.ignorePaths)) {
        config.ignorePaths = [...defaultIgnorePaths];
        didChange = true;
      } else {
        for (const path of defaultIgnorePaths) {
          if (!config.ignorePaths.includes(path)) {
            config.ignorePaths.push(path);
            didChange = true;
          }
        }
      }

      if (didChange) {
        await vfsWriteJSON(repoRoot, filePath, config);
        if (options?.log) {
          options.log(
            'info',
            'Updated cspell.json with missing settings/words',
          );
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure cspell.json: ${errorMessage}`);
  }
}

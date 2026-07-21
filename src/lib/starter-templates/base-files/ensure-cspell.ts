import { vfsReadJSON, vfsWriteJSON } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

export interface CSpellConfig {
  version?: string;
  language?: string;
  words?: string[];
  /** Skip files the repo's own `.gitignore` rules exclude. */
  useGitignore?: boolean;
  ignorePaths?: string[];
  [key: string]: unknown;
}

export interface EnsureCspellOptions {
  log?: LoggerFunction;
  templateCspellWords?: string[];
}

// Every word here must actually appear in the scaffolded output — a fresh
// repo's own cspell:clean flags anything seeded that no generated file uses.
const defaultWords = [
  'bradlc',
  'bunx',
  'dbaeumer',
  'esbenp',
  'eslintcache',
  'extensionless',
  'firsttris',
  'Gruntfuggly',
  'jestrunner',
  'jmbeach',
  'Lifecycleion',
  'treemap',
  'Unirend',
];

// Deliberately short, because `useGitignore` below covers the rest: your
// .gitignore already lists what is generated, per path rather than per name.
// A `**/build/**` here would also skip a committed fixture tree that happens
// to be named build, which is exactly the kind of file worth spellchecking.
//
// What stays is what .gitignore cannot cover: node_modules as cheap insurance
// for a repo whose ignore file is missing or incomplete, and the lockfiles,
// which are tracked and so never excluded by ignore rules.
const defaultIgnorePaths = ['**/node_modules/**', 'bun.lock', 'bun.lockb'];

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
        useGitignore: true,
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

      // Turn on .gitignore awareness for a repo scaffolded before it was the
      // default. Safe to add to an existing config because it only ever
      // excludes more: whatever ignorePaths they already have is untouched, so
      // this cannot start flagging words in a file that used to pass. Their
      // existing broad entries stay as written, since removing one is a
      // judgment call about their repo rather than a missing default.
      if (config.useGitignore === undefined) {
        config.useGitignore = true;
        didChange = true;
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

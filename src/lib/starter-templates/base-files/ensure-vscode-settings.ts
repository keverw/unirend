import { isPlainObject } from 'lifecycleion/is-plain-object';
import { vfsReadJSON, vfsWriteJSON } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

// jestrunner.jestCommand assumes bun, as current scope is bun being used for dev/build tooling
const defaultSettings = {
  'css.lint.unknownAtRules': 'ignore',
  'editor.defaultFormatter': 'esbenp.prettier-vscode',
  'editor.formatOnSave': true,
  'editor.formatOnPaste': true,
  'editor.codeActionsOnSave': {
    'source.fixAll.eslint': 'explicit',
  },
  'editor.snippetSuggestions': 'top',
  'files.autoSave': 'afterDelay',
  'prettier.prettierPath': './node_modules/prettier',
  'prettier.requireConfig': true,
  'jestrunner.jestCommand': 'bun test',
  // Auto-imports stay relative within an app, but switch to the `@/` alias when
  // they'd reach outside the app's tsconfig directory (e.g. into shared
  // src/libs/*). Each app ships its own tsconfig so this boundary lands on the
  // app folder; see app-tsconfig.ts and the API tsconfig note.
  'typescript.preferences.importModuleSpecifier': 'project-relative',
  'javascript.preferences.importModuleSpecifier': 'project-relative',
  // Prettier uses proseWrap: 'never', so Markdown paragraphs are single long
  // lines; soft-wrap them in the editor (Markdown only) for readability.
  '[markdown]': {
    'editor.wordWrap': 'on',
  },
};

interface VSCodeSettings {
  [key: string]: unknown;
}

/**
 * Recursively add keys from `defaults` that are missing in `target`, without
 * overwriting anything the user already set. Nested plain objects (e.g. the
 * `[markdown]` scope or `editor.codeActionsOnSave`) are merged key-by-key so a
 * pre-existing block just gains the missing sub-keys. Returns true if anything
 * was added.
 */
function mergeMissing(
  target: Record<string, unknown>,
  defaults: Record<string, unknown>,
): boolean {
  let didChange = false;

  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in target)) {
      target[key] = value;
      didChange = true;
    } else if (isPlainObject(target[key]) && isPlainObject(value)) {
      if (mergeMissing(target[key], value)) {
        didChange = true;
      }
    }

    // Otherwise the key exists with a non-object (or mismatched) value: leave
    // the user's value untouched.
  }

  return didChange;
}

/**
 * Ensure .vscode/settings.json exists at the repo root with recommended settings.
 * If the file exists, merges in any missing settings from the default list.
 * Never overwrites existing settings - only adds missing ones.
 *
 * @throws {Error} If file read/write fails
 */
export async function ensureVSCodeSettings(
  repoRoot: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  try {
    const filePath = '.vscode/settings.json';
    const readResult = await vfsReadJSON(repoRoot, filePath);

    let settingsData: VSCodeSettings;
    let didChange = false;

    if (!readResult.ok) {
      if (readResult.code !== 'ENOENT') {
        if (readResult.code === 'PARSE_ERROR') {
          throw new Error(
            `Invalid JSON in .vscode/settings.json: ${readResult.message}`,
          );
        }

        throw new Error(
          `Failed to read .vscode/settings.json: ${readResult.message}`,
        );
      }

      // File doesn't exist, create it. Deep-clone so nested blocks (e.g.
      // [markdown], editor.codeActionsOnSave) don't share references with the
      // module-level defaultSettings.
      settingsData = structuredClone(defaultSettings);

      await vfsWriteJSON(repoRoot, filePath, settingsData);

      if (log) {
        log('info', 'Created .vscode/settings.json');
      }

      return;
    }

    // File exists, merge settings
    settingsData = readResult.data as VSCodeSettings;

    // Add missing settings recursively (only fills gaps, never overwrites)
    didChange = mergeMissing(settingsData, defaultSettings);

    if (didChange) {
      await vfsWriteJSON(repoRoot, filePath, settingsData);

      if (log) {
        log('info', 'Updated .vscode/settings.json with missing settings');
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure .vscode/settings.json: ${errorMessage}`);
  }
}

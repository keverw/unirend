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
};

interface VSCodeSettings {
  [key: string]: unknown;
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

    if (readResult.ok && readResult.data) {
      // File exists, merge settings
      settingsData = readResult.data as VSCodeSettings;

      // Add missing settings (only if key doesn't exist)
      for (const [key, value] of Object.entries(defaultSettings)) {
        if (!(key in settingsData)) {
          settingsData[key] = value;
          didChange = true;
        }
      }

      if (didChange) {
        await vfsWriteJSON(repoRoot, filePath, settingsData);

        if (log) {
          log('info', 'Updated .vscode/settings.json with missing settings');
        }
      }
    } else {
      // File doesn't exist, create it
      settingsData = { ...defaultSettings };

      await vfsWriteJSON(repoRoot, filePath, settingsData);

      if (log) {
        log('info', 'Created .vscode/settings.json');
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure .vscode/settings.json: ${errorMessage}`);
  }
}

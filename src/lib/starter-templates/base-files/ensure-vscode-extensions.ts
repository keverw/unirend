import { vfsReadJSON, vfsWriteJSON, type FileRoot } from '../vfs';
import type { Logger } from '../types';

const defaultExtensions = [
  'dbaeumer.vscode-eslint',
  'esbenp.prettier-vscode',
  'streetsidesoftware.code-spell-checker',
  'Gruntfuggly.todo-tree',
  'jmbeach.list-symbols',
  'firsttris.vscode-jest-runner',
  'bradlc.vscode-tailwindcss',
];

interface VSCodeExtensions {
  recommendations?: string[];
  [key: string]: unknown;
}

/**
 * Ensure .vscode/extensions.json exists at the repo root with recommended extensions.
 * If the file exists, merges in any missing extensions from the default list.
 * Never removes existing extensions.
 *
 * @throws {Error} If file read/write fails
 */
export async function ensureVSCodeExtensions(
  repoRoot: FileRoot,
  log?: Logger,
): Promise<void> {
  try {
    const filePath = '.vscode/extensions.json';
    const readResult = await vfsReadJSON(repoRoot, filePath);

    let extensionsData: VSCodeExtensions;
    let didChange = false;

    if (readResult.ok && readResult.data) {
      // File exists, merge extensions
      extensionsData = readResult.data as VSCodeExtensions;

      // Ensure recommendations array exists
      if (!Array.isArray(extensionsData.recommendations)) {
        extensionsData.recommendations = [];
        didChange = true;
      }

      // Add missing extensions
      const existingExtensions = new Set(extensionsData.recommendations);
      for (const ext of defaultExtensions) {
        if (!existingExtensions.has(ext)) {
          extensionsData.recommendations.push(ext);
          didChange = true;
        }
      }

      if (didChange) {
        // Sort recommendations alphabetically for consistency
        extensionsData.recommendations.sort();

        await vfsWriteJSON(repoRoot, filePath, extensionsData);

        if (log) {
          log(
            'info',
            'Updated .vscode/extensions.json with missing extensions',
          );
        }
      }
    } else {
      // File doesn't exist, create it
      extensionsData = {
        recommendations: [...defaultExtensions].sort(),
      };

      await vfsWriteJSON(repoRoot, filePath, extensionsData);

      if (log) {
        log('info', 'Created .vscode/extensions.json');
      }
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to ensure .vscode/extensions.json: ${errorMessage}`,
    );
  }
}

import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

const fileSrc = `/** @type {import("prettier").Config} */
export default {
  // Intentionally minimal: rely on Prettier 3 defaults except:
  singleQuote: true, // Use single quotes in JS/TS
  jsxSingleQuote: false, // Keep double quotes in JSX (HTML convention)
};
`;

/**
 * Ensure prettier.config.js exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites.
 * @throws {Error} If file creation fails
 */
export async function ensurePrettierConfig(
  repoRoot: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  try {
    const didWrite = await vfsWriteIfNotExists(
      repoRoot,
      'prettier.config.js',
      fileSrc,
    );

    if (didWrite && log) {
      log('info', 'Created repo root prettier.config.js');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure prettier.config.js: ${errorMessage}`);
  }
}

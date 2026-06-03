import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for a Vite app's `prettier.config.js`.
 *
 * Identical across the Vite-based templates (SSG, SSR), so it lives in
 * `templates-shared/` rather than being duplicated per template. It extends the
 * repo-root prettier config and layers on the Tailwind plugin (which needs the
 * app's stylesheet path). The API template doesn't ship one — it has no
 * Tailwind/CSS surface and just uses the repo-root config.
 */
const fileSrc = `import baseConfig from '../../../prettier.config.js';

/** @type {import("prettier").Config & import("prettier-plugin-tailwindcss").PluginOptions} */
export default {
  ...baseConfig,
  plugins: ['prettier-plugin-tailwindcss'],
  // Tailwind CSS v4 requires specifying the stylesheet path
  tailwindStylesheet: './index.css',
};
`;

/**
 * Ensure a Vite app's `prettier.config.js` exists at
 * `${projectPath}/prettier.config.js`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppPrettierConfig(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/prettier.config.js`;

  try {
    const didWrite = await vfsWriteIfNotExists(root, relPath, fileSrc);

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}

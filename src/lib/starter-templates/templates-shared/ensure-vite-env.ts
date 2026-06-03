import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for an app's `vite-env.d.ts`.
 *
 * Identical across every Vite-based template (SSG, SSR), so it lives in
 * `templates-shared/` rather than being duplicated per template. It pulls in
 * Vite's client-side ambient types (e.g. `import.meta.env`, asset imports).
 */
const fileSrc = `/// <reference types="vite/client" />\n`;

/**
 * Ensure an app's `vite-env.d.ts` exists at `${projectPath}/vite-env.d.ts`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureViteEnv(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/vite-env.d.ts`;

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

import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for a Vite app's `public/favicon.svg`.
 *
 * Static and byte-identical across the Vite-based templates (SSG, SSR), so it
 * lives in `templates-shared/` rather than being duplicated per template. The
 * API template doesn't ship one — it has no public/static-file surface.
 */
const fileSrc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="20" fill="#333" />
  <circle cx="78" cy="30" r="9" fill="white" />
  <path d="M10 80 L35 40 L60 80 Z" fill="white" />
  <path d="M50 80 L70 55 L90 80 Z" fill="#bfbfbf" />
</svg>
`;

/**
 * Ensure a Vite app's `public/favicon.svg` exists at `${projectPath}/public/favicon.svg`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppPublicFavicon(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/public/favicon.svg`;

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

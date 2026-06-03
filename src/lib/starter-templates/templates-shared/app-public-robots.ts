import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for a Vite app's `public/robots.txt`.
 *
 * Static and byte-identical across the Vite-based templates (SSG, SSR), so it
 * lives in `templates-shared/` rather than being duplicated per template. The
 * API template doesn't ship one — it has no public/static-file surface.
 */
const fileSrc = `# https://www.robotstxt.org/robotstxt.html
User-agent: *
Allow: /
`;

/**
 * Ensure a Vite app's `public/robots.txt` exists at `${projectPath}/public/robots.txt`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppPublicRobots(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/public/robots.txt`;

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

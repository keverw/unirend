import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSR template's `serve-built.ts`.
 *
 * Thin entry point that starts the SSR server in built mode, serving
 * pre-built assets from `build/`. Delegates entirely to `server/start.ts`.
 * Paired with `serve-hmr.ts` which starts in HMR mode instead.
 */
const fileSrc = `// Starts the SSR server in built mode — serves pre-built assets from build/
// To use Vite HMR with source files instead, use serve-hmr.ts.
import { startApp } from './server/start';

void startApp('built');
`;

/**
 * Emit the SSR template's `serve-built.ts` entry point (create-if-missing).
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSRServeBuilt(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/serve-built.ts`;

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

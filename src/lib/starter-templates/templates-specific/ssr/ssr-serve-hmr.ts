import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSR template's `serve-hmr.ts`.
 *
 * Thin entry point that starts the SSR server in HMR mode, letting Vite
 * serve source files directly with hot module replacement. Delegates entirely
 * to `server/start.ts`. Paired with `serve-built.ts` which starts in built
 * mode instead.
 */
const fileSrc = `// Starts the SSR server in HMR mode — Vite serves source files directly with hot module replacement.
// To serve pre-built assets instead, use serve-built.ts.
import { startApp } from './server/start';

void startApp('hmr');
`;

/**
 * Emit the SSR template's `serve-hmr.ts` entry point (create-if-missing).
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSRServeHMR(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/serve-hmr.ts`;

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

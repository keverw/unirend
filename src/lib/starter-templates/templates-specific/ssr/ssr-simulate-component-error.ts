import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSR app's `pages/SimulateComponentError.tsx`.
 *
 * SSR-specific — lives in `templates-specific/ssr/`. Throws unconditionally on
 * both server and client, triggering the `ApplicationError` boundary. No
 * `window` guard needed — SSR renders per-request (not at build time), so there
 * is no pre-render phase where throwing would break the generator. Contrast with
 * the SSG version, which guards the throw behind a `typeof window` check so the
 * SSG build can render a static placeholder.
 */
const fileSrc = `// Throws immediately (server and client) to trigger the ApplicationError boundary.
// No SSG-style window check needed since SSR renders per-request, not at build time.
export function SimulateComponentError(): never {
  throw new Error('Simulated component error');
}
`;

/**
 * Ensure the SSR app's `pages/SimulateComponentError.tsx` exists at
 * `${projectPath}/pages/SimulateComponentError.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSRSimulateComponentError(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/pages/SimulateComponentError.tsx`;

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

import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for `pages/SimulateDataloaderError.tsx`.
 *
 * Shared across SSG and SSR (byte-identical). The component is a fallback
 * view — it only renders if the demo loader unexpectedly does not throw.
 * In practice the loader always throws and Unirend converts it to a 500
 * envelope intercepted by `AppLayout`, so this page body is never seen in
 * normal operation. API ships none — it has no client-side rendering.
 */
const fileSrc = `import { UnirendHead } from 'unirend/client';

export function SimulateDataloaderError() {
  return (
    <>
      <UnirendHead>
        <title>Simulate Dataloader Throw</title>
      </UnirendHead>
      <main>
        <h1>Simulate Dataloader Throw</h1>
        <p>If you see this page, the demo loader did not throw as expected.</p>
      </main>
    </>
  );
}
`;

/**
 * Ensure `pages/SimulateDataloaderError.tsx` exists at
 * `${projectPath}/pages/SimulateDataloaderError.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppSimulateDataloaderError(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/pages/SimulateDataloaderError.tsx`;

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

import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for `pages/SimulateDataloader500.tsx`.
 *
 * Shared across SSG and SSR (byte-identical). The component is a fallback
 * view — it only renders if the demo loader unexpectedly does not return a 500
 * error envelope. In practice the loader always produces the envelope and
 * `AppLayout` intercepts it, so this page body is never seen in normal
 * operation. API ships none — it has no client-side rendering.
 */
const fileSrc = `import { UnirendHead } from 'unirend/client';

export function SimulateDataloader500() {
  return (
    <>
      <UnirendHead>
        <title>Simulate Dataloader 500</title>
      </UnirendHead>
      <main>
        <h1>Simulate Dataloader 500</h1>
        <p>
          If you see this page, the demo loader did not return the expected 500
          error envelope.
        </p>
      </main>
    </>
  );
}
`;

/**
 * Ensure `pages/SimulateDataloader500.tsx` exists at
 * `${projectPath}/pages/SimulateDataloader500.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppSimulateDataloader500(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/pages/SimulateDataloader500.tsx`;

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

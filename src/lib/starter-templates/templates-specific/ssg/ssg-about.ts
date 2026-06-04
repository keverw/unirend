import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSG app's `pages/About.tsx`.
 *
 * SSG-specific — lives in `templates-specific/ssg/`. Fully static at build
 * time — no loader data. Describes the SSG rendering model (pre-rendered to
 * HTML at build time, hydrated on the client). Contrast with the SSR version,
 * which uses `useLoaderData` and displays a "From Server" line.
 */
const fileSrc = `import { UnirendHead } from 'unirend/client';

export function About() {
  return (
    <>
      <UnirendHead>
        <title>About - Unirend SSG Starter</title>
        <meta name="description" content="About the Unirend SSG starter" />
      </UnirendHead>

      <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
        <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
          About
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          This is a standard SSG page, pre-rendered to HTML at build time and
          hydrated on the client.
        </p>
      </div>
    </>
  );
}
`;

/**
 * Ensure the SSG app's `pages/About.tsx` exists at
 * `${projectPath}/pages/About.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSGAbout(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/pages/About.tsx`;

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

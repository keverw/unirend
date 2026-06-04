import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSR app's `pages/About.tsx`.
 *
 * SSR-specific — lives in `templates-specific/ssr/`. Uses `useLoaderData` to
 * display a "From Server" line seeded by the page-data loader. Describes the
 * SSR rendering model (rendered on the server on each request, hydrated on
 * the client). Contrast with the SSG version, which is fully static with no
 * loader data.
 */
const fileSrc = `import { useLoaderData } from 'react-router';
import { UnirendHead } from 'unirend/client';

interface AboutLoaderEnvelope {
  data: {
    serverLine: string;
  };
}

export function About() {
  const { data } = useLoaderData<AboutLoaderEnvelope>();

  return (
    <>
      <UnirendHead>
        <title>About - Unirend SSR Starter</title>
        <meta name="description" content="About the Unirend SSR starter" />
      </UnirendHead>

      <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
        <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
          About
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          This is a standard SSR page, rendered on the server on each request
          and hydrated on the client.
        </p>
        <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
          From Server: {data.serverLine}
        </p>
      </div>
    </>
  );
}
`;

/**
 * Ensure the SSR app's `pages/About.tsx` exists at
 * `${projectPath}/pages/About.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSRAbout(
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

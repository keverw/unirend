import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for a Vite app's `components/error-pages/NotFound.tsx`.
 *
 * Static and byte-identical across the Vite-based templates (SSG, SSR), so it
 * lives in `templates-shared/react-components/`. Rendered by AppLayout for 404
 * error envelopes from page-data loaders, and also wired as the React Router
 * error element for thrown 404s. Accepts both a `data` prop (loader error
 * envelopes) and an `error` prop (thrown router errors); only `data` is used to
 * populate the page — `error` is accepted to satisfy the error element
 * signature. The API template doesn't ship one — it has no client-side
 * rendering.
 */
const fileSrc = `import { Link } from 'react-router';
import { UnirendHead } from 'unirend/client';
import type { PageErrorResponse } from 'unirend/api-envelope';

interface NotFoundProps {
  error?: unknown;
  data?: PageErrorResponse | null;
}

export function NotFound({ data }: NotFoundProps) {
  // Use envelope data if available, otherwise use defaults
  const title = data?.meta?.page?.title || '404 - Page Not Found';
  const description =
    data?.meta?.page?.description ||
    'The page you are looking for does not exist.';

  return (
    <>
      <UnirendHead>
        <title>{title}</title>
        <meta name="description" content={description} />
      </UnirendHead>
      <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
        <h1 className="mb-2 text-4xl font-bold text-gray-800 dark:text-gray-100">
          404
        </h1>
        <h2 className="mb-4 text-2xl font-bold text-gray-800 dark:text-gray-100">
          Page Not Found
        </h2>
        <p className="mb-6 text-gray-600 dark:text-gray-400">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          to="/"
          className="rounded border-4 border-dashed border-teal-500 px-4 py-2 text-gray-700 dark:text-gray-300"
        >
          Go Home
        </Link>
      </div>
    </>
  );
}
`;

/**
 * Ensure a Vite app's `components/error-pages/NotFound.tsx` exists at
 * `${projectPath}/components/error-pages/NotFound.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppNotFound(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/components/error-pages/NotFound.tsx`;

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

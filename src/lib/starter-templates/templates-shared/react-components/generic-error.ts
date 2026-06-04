import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for a Vite app's `components/error-pages/GenericError.tsx`.
 *
 * Static and byte-identical across the Vite-based templates (SSG, SSR), so it
 * lives in `templates-shared/react-components/`. Rendered by AppLayout when a
 * page-data loader returns an error envelope after hydration (e.g. a
 * server-returned 5xx/4xx such as 500, 401, or 403 — anything non-404). Shows
 * the error code, message, and a dev-only stack trace. Contrast with
 * `ApplicationError`, which handles React component crashes caught by the
 * client-side error boundary (during or after hydration). For initial
 * server-side renders, crashes are handled differently: SSR calls
 * `get500ErrorPage` (raw HTML outside React) if configured, otherwise falls
 * back to the framework's built-in default, and SSG fails generation
 * outright (`render-error` — file never written).
 * The API template doesn't ship one — it has no client-side rendering.
 */
const fileSrc = `import { Link } from 'react-router';
import { UnirendHead, useIsDevelopment } from 'unirend/client';
import type { PageErrorResponse } from 'unirend/api-envelope';

interface GenericErrorProps {
  data: PageErrorResponse | null;
}

export function GenericError({ data }: GenericErrorProps) {
  const isDevelopment = useIsDevelopment();
  const title = data?.meta?.page?.title || 'Error';
  const description = data?.meta?.page?.description || 'An error occurred.';
  const message =
    data?.error?.message || 'Something went wrong. Please try again later.';
  const requestID = data?.request_id;
  const errorCode = data?.error?.code?.toUpperCase() || 'UNKNOWN';

  // Show stack trace only in development. Upstream data loaders typically gate
  // details on isDevelopment too, but we guard here as well in case a custom
  // loader, external API, or a remote server running in dev mode leaks details.
  const stackTrace =
    data?.error?.details &&
    typeof data.error.details === 'object' &&
    !Array.isArray(data.error.details) &&
    'stack' in data.error.details
      ? (data.error.details.stack as string)
      : null;

  return (
    <>
      <UnirendHead>
        <title>{title}</title>
        <meta name="description" content={description} />
      </UnirendHead>
      <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
        <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
          Error: {errorCode}
        </h1>
        <p className="mb-2 text-gray-600 dark:text-gray-400">{message}</p>
        <p className="mb-6 text-gray-600 dark:text-gray-400">
          Please try again later or contact support if the problem persists.
        </p>

        {isDevelopment && stackTrace && (
          <details
            open
            className="mb-6 rounded-lg border-4 border-dashed border-red-400 p-4"
          >
            <summary className="mb-2 cursor-pointer font-semibold text-gray-800 dark:text-gray-100">
              Stack Trace
            </summary>
            <pre className="overflow-auto text-sm text-gray-600 dark:text-gray-400">
              {stackTrace}
            </pre>
          </details>
        )}

        {requestID && (
          <p className="mb-6 text-sm text-gray-600 dark:text-gray-400">
            Request ID: {requestID}
          </p>
        )}

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
 * Ensure a Vite app's `components/error-pages/GenericError.tsx` exists at
 * `${projectPath}/components/error-pages/GenericError.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppGenericError(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/components/error-pages/GenericError.tsx`;

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

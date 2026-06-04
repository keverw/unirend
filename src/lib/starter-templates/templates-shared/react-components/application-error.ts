import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for a Vite app's `components/error-pages/ApplicationError.tsx`.
 *
 * Static and byte-identical across the Vite-based templates (SSG, SSR), so it
 * lives in `templates-shared/react-components/`. Client-side only — caught by
 * the `RouteErrorBoundary` in the browser (during or after hydration). On SSR,
 * the server-side equivalent is `get500ErrorPage` (raw HTML returned outside
 * the React pipeline) if configured, otherwise the framework's built-in
 * default. On SSG, a component throw fails generation outright
 * (`render-error` result — file never written). Standalone (not wrapped in
 * AppLayout) to avoid cascading failures if the layout itself throws; shows a
 * dev-only error details panel. The API template doesn't ship one — it has no
 * client-side rendering.
 */
const fileSrc = `import { useEffect } from 'react';
import { UnirendHead, useIsDevelopment } from 'unirend/client';

interface ApplicationErrorProps {
  error: unknown;
}

/**
 * Rendered by RouteErrorBoundary for thrown/uncaught React errors.
 *
 * This is standalone — it is NOT wrapped in AppLayout, so it must be fully self-contained.
 *
 * Being standalone avoids cascading errors: if AppLayout or the home page itself throws,
 * rendering inside AppLayout would just error again.
 *
 * For SSR: your server's get500ErrorPage should visually match this component.
 */
export function ApplicationError({ error }: ApplicationErrorProps) {
  const isDevelopment = useIsDevelopment();
  const errorMessage =
    error instanceof Error ? error.message : 'An unexpected error occurred';

  // Scroll to top when error component mounts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, []);

  return (
    <>
      <UnirendHead>
        <title>500 - Application Error</title>
      </UnirendHead>
      <div className="min-h-screen bg-white p-8 dark:bg-gray-900">
        <div className="rounded-lg border-4 border-dashed border-orange-500 p-8">
          <h1 className="mb-4 text-4xl font-bold text-gray-800 dark:text-gray-100">
            Something went wrong
          </h1>
          <p className="mb-6 text-gray-600 dark:text-gray-400">
            An unexpected error occurred. Please try again or contact support if
            the problem persists.
          </p>

          {isDevelopment && (
            <details
              open
              className="mb-6 rounded-lg border-4 border-dashed border-red-400 p-4"
            >
              <summary className="mb-2 cursor-pointer font-semibold text-gray-800 dark:text-gray-100">
                Development Error Details
              </summary>
              <pre className="overflow-auto text-sm text-gray-600 dark:text-gray-400">
                {errorMessage}
              </pre>
              {error instanceof Error && error.stack && (
                <pre className="mt-2 overflow-auto text-sm text-gray-600 dark:text-gray-400">
                  {error.stack}
                </pre>
              )}
            </details>
          )}

          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => window.location.reload()}
              className="rounded border-4 border-dashed border-yellow-500 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              Try Again
            </button>
            <a
              href="/"
              className="rounded border-4 border-dashed border-teal-500 px-4 py-2 text-gray-700 dark:text-gray-300"
            >
              Go Home
            </a>
          </div>
        </div>
      </div>
    </>
  );
}
`;

/**
 * Ensure a Vite app's `components/error-pages/ApplicationError.tsx` exists at
 * `${projectPath}/components/error-pages/ApplicationError.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppApplicationError(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/components/error-pages/ApplicationError.tsx`;

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

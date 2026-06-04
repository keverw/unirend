import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for a Vite app's `components/AppLayout.tsx`.
 *
 * Static and byte-identical across the Vite-based templates (SSG, SSR), so it
 * lives in `templates-shared/react-components/`. Handles both thrown router errors (via
 * `RouteErrorBoundary`) and page-data loader error envelopes, rendering the
 * appropriate error page. The API template doesn't ship one — it has no
 * client-side layout.
 */
const fileSrc = `import { Outlet, useLocation } from 'react-router';
import { useDataLoaderEnvelopeError } from 'unirend/router-utils';
import { NotFound } from './error-pages/NotFound';
import { GenericError } from './error-pages/GenericError';
import { Header } from './Header';
import { Footer } from './Footer';
import { useEffect } from 'react';

export function AppLayout() {
  // RouteErrorBoundary handles thrown router errors and receives an \`error\` prop.
  // Page-data loaders can also return error envelopes, which stay in loader data,
  // so the layout renders those with a \`data\` prop instead.
  const { hasError, is404, errorResponse } = useDataLoaderEnvelopeError();
  const location = useLocation();

  // Scroll to top when route changes.
  useEffect(() => {
    // Regular pages scroll to top
    window.scrollTo({
      top: 0,
      behavior: 'instant',
    });
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen flex-col bg-white p-8 dark:bg-gray-900">
      <Header />
      <main className="mb-8 min-h-[500px] flex-grow rounded-lg border-4 border-dashed border-lime-500 p-8">
        {hasError ? (
          is404 ? (
            <NotFound data={errorResponse} />
          ) : (
            <GenericError data={errorResponse} />
          )
        ) : (
          <Outlet />
        )}
      </main>
      <Footer />
    </div>
  );
}
`;

/**
 * Ensure a Vite app's `components/AppLayout.tsx` exists at
 * `${projectPath}/components/AppLayout.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppLayout(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/components/AppLayout.tsx`;

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

import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSG template's `Routes.tsx`.
 *
 * SSG-specific: uses static loaders from `./loaders/error-demo-loaders` for
 * the error-demo test routes (rather than `createPageDataLoader`), includes a
 * `Dashboard` route and a static `404` route (generated as a normal SSG page
 * so it shares the app chrome), and leaves the wildcard `*` route commented
 * out. No SSR page-data-loader wiring or `API_BASE_URL` block.
 */
const fileSrc = `import type { RouteObject } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { Home } from './pages/Home';
import { About } from './pages/About';
import { Dashboard } from './pages/Dashboard';
import { RouteErrorBoundary } from 'unirend/router-utils';
import { NotFound } from './components/error-pages/NotFound';
import { ApplicationError } from './components/error-pages/ApplicationError';
import { ENABLE_TEST_ROUTES } from './consts';
import { SimulateDataloaderError } from './pages/SimulateDataloaderError';
import { SimulateDataloader500 } from './pages/SimulateDataloader500';
import { SimulateDataloader503 } from './pages/SimulateDataloader503';
import { SimulateComponentError } from './pages/SimulateComponentError';
import {
  simulateDataloader500Loader,
  simulateDataloader503Loader,
  simulateDataloaderThrowLoader,
} from './loaders/error-demo-loaders';

// Dev tip: Since this is a monorepo, you can import from other libs in the codebase:
// import { formatCount } from '@/libs/utils/format';
// import { useTheme } from '@/libs/hooks/useTheme';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    errorElement: (
      // Handle both application component errors and not found errors
      <RouteErrorBoundary
        NotFoundComponent={NotFound}
        ApplicationErrorComponent={ApplicationError}
      />
    ),
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: 'about',
        element: <About />,
      },
      {
        path: 'dashboard',
        element: <Dashboard />,
      },
      // 404 route — generated as a normal SSG page so it shares the app chrome.
      // StaticWebServer and unirend/php-static-server auto-detect it from the page map
      // and serve it with a 404 status. Other setups (Apache, nginx, etc.) can point at
      // it manually. A 404 means the server is healthy so external assets still load.
      // No real error data is ever injected — purely decorative.
      {
        path: '404',
        element: <NotFound />,
      },
      // Note: 500 is intentionally absent here — it's generated as a self-contained html page
      // (no React bundle) so it survives real server failures where assets may not load.
      // See generate-ssg.ts for the { type: 'html' } entry and error-pages/500.html.
      ...(ENABLE_TEST_ROUTES
        ? [
            {
              path: 'simulate-component-error',
              element: <SimulateComponentError />,
            },
            {
              path: 'simulate-dataloader-500-error',
              loader: simulateDataloaderThrowLoader,
              element: <SimulateDataloaderError />,
            },
            {
              path: 'simulate-dataloader-500-status',
              loader: simulateDataloader500Loader,
              element: <SimulateDataloader500 />,
            },
            {
              path: 'simulate-dataloader-503-status',
              loader: simulateDataloader503Loader,
              element: <SimulateDataloader503 />,
            },
          ]
        : []),

      // Wildcard 404 route — catches any URL that doesn't match a defined route.
      // If omitted, unmatched routes bubble up to the errorElement above and
      // NotFoundComponent picks it up anyway — so this is optional, but useful
      // when you want more control (e.g. a loader, custom logic, etc.).
      //
      // For SSG: this only fires for pages that were never generated at build time,
      // or when navigating client-side via React Router (since the static host serves
      // the pre-built HTML and never hits the router for hard navigation to unknown paths).
      //
      // For SSR: you'd typically add a data loader here instead of rendering NotFound
      // directly — useful for logging 404s to your backend (marketing insight: what are
      // users looking for?). If you tailor your APIResponseHelpers to include auth state
      // or other shared metadata, you can return a consistent loader shape across all
      // routes — including 404s — so the shell always has what it needs (e.g. a logged-in
      // nav bar). See: https://github.com/keverw/unirend/blob/master/docs/data-loaders.md
      // {
      //   path: '*',
      //   element: <NotFound />,
      // },
    ],
  },
];
`;

/**
 * Ensure the SSG template's `Routes.tsx` exists.
 * Only creates the file if it doesn't exist — never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSGRoutes(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/Routes.tsx`;

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

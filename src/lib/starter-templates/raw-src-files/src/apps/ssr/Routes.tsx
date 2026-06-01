import type { RouteObject } from 'react-router';
import { AppLayout } from './components/AppLayout';
import { Home } from './pages/Home';
import { About } from './pages/About';
import {
  RouteErrorBoundary,
  createPageDataLoader,
  createDefaultPageDataLoaderConfig,
} from 'unirend/router-utils';
import { NotFound } from './components/error-pages/NotFound';
import { ApplicationError } from './components/error-pages/ApplicationError';
import { ENABLE_TEST_ROUTES } from './consts';
import { SimulateDataloaderError } from './pages/SimulateDataloaderError';
import { SimulateDataloader500 } from './pages/SimulateDataloader500';
import { SimulateDataloader503 } from './pages/SimulateDataloader503';
import { SimulateComponentError } from './pages/SimulateComponentError';

// Dev tip: Since this is a monorepo, you can import from other libs in the codebase:
// import { formatCount } from '@/libs/utils/format';
// import { useTheme } from '@/libs/hooks/useTheme';

// Client: reads api_endpoint from publicAppConfig when set (e.g. when the API runs on
// a separate server). Falls back to window.location.origin for same-server setups —
// no config needed. Set api_endpoint in publicAppConfig in ssr-component.ts to override.
//
// Server: uses INTERNAL_API_ENDPOINT when set — useful when running SSR and API in
// separate server pools where the internal hostname differs from the public URL.
// Falls back to a localhost URL as a best-effort default for the co-located case.
// In co-located setups the handler short-circuits on the same instance anyway, so
// the exact fallback URL rarely matters. Set INTERNAL_API_ENDPOINT to be explicit.
//
// See: https://github.com/keverw/unirend/blob/master/README.md#public-app-config-pattern
const API_BASE_URL =
  typeof window !== 'undefined'
    ? // eslint-disable-next-line @typescript-eslint/naming-convention
      ((window as Window & { __PUBLIC_APP_CONFIG__?: Record<string, unknown> })
        .__PUBLIC_APP_CONFIG__?.api_endpoint as string) ||
      window.location.origin
    : (process.env.INTERNAL_API_ENDPOINT ?? 'http://localhost:3000');

const pageDataLoaderConfig = createDefaultPageDataLoaderConfig(API_BASE_URL);

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
        // On SSR, short-circuits to the registered handler when on the same server
        // instance. On client-side navigation, calls POST /api/v1/page_data/home.
        loader: createPageDataLoader(pageDataLoaderConfig, 'home'),
        element: <Home />,
      },
      {
        path: 'about',
        loader: createPageDataLoader(pageDataLoaderConfig, 'about'),
        element: <About />,
      },
      ...(ENABLE_TEST_ROUTES
        ? [
            {
              path: 'simulate-component-error',
              element: <SimulateComponentError />,
            },
            {
              path: 'simulate-dataloader-500-error',
              loader: createPageDataLoader(
                pageDataLoaderConfig,
                'simulate-dataloader-500-error',
              ),
              element: <SimulateDataloaderError />,
            },
            {
              path: 'simulate-dataloader-500-status',
              loader: createPageDataLoader(
                pageDataLoaderConfig,
                'simulate-dataloader-500-status',
              ),
              element: <SimulateDataloader500 />,
            },
            {
              path: 'simulate-dataloader-503-status',
              loader: createPageDataLoader(
                pageDataLoaderConfig,
                'simulate-dataloader-503-status',
              ),
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
      {
        path: '*',
        loader: createPageDataLoader(pageDataLoaderConfig, 'not-found'),
        element: <NotFound />,
      },
    ],
  },
];

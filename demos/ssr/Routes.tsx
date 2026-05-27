import type { RouteObject } from 'react-router';
import {
  RouteErrorBoundary,
  createPageDataLoader,
  createDefaultPageDataLoaderConfig,
} from '../../src/router-utils';
import { Home } from './pages/Home';
import { About } from './pages/About';
import { Contact } from './pages/Contact';
import { ContextDemo } from './pages/ContextDemo';
import { AppLayout } from './components/AppLayout';
import { NotFound } from './components/error-pages/NotFound';
import { ApplicationError } from './components/error-pages/ApplicationError';
import { PageDataDisplay } from './components/PageDataDisplay';

const API_BASE_URL =
  typeof window !== 'undefined'
    ? // eslint-disable-next-line @typescript-eslint/naming-convention
      ((window as Window & { __PUBLIC_APP_CONFIG__?: Record<string, unknown> })
        .__PUBLIC_APP_CONFIG__?.api_endpoint as string) ||
      window.location.origin
    : (process.env.INTERNAL_API_ENDPOINT ?? 'http://localhost:3000');

const pageDataLoaderConfig = {
  ...createDefaultPageDataLoaderConfig(API_BASE_URL),
  pageDataEndpoint: '/api/v1/page_data',
};

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    errorElement: (
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
        path: 'contact',
        element: <Contact />,
      },
      {
        path: 'context-demo',
        element: <ContextDemo />,
      },
      // test routes
      {
        path: 'test-local-loader',
        element: <PageDataDisplay />,
        loader: createPageDataLoader(pageDataLoaderConfig, (params) => {
          // Simple local-only loader example
          return {
            status: 'success' as const,
            status_code: 200,
            request_id: `local_${Date.now()}`,
            type: 'page' as const,
            data: {
              message: 'Local page data loader response (no HTTP)',
              page_type: params.pageType,
              invocation_origin: params.invocationOrigin,
              request: {
                route_params: params.routeParams,
                query_params: params.queryParams,
                request_path: params.requestPath,
                original_url: params.originalURL,
              },
            },
            meta: {
              page: {
                title: 'Local Loader Demo',
                description:
                  'This page demonstrates a local-only page data loader without HTTP',
              },
            },
            error: null,
          };
        }),
      },
      {
        path: 'test-local-loader-throws',
        element: <PageDataDisplay />,
        loader: createPageDataLoader(pageDataLoaderConfig, (_params) => {
          // Simulated error thrown from a local-only loader
          throw new Error(
            'Simulated error thrown from local page data loader (no HTTP)',
          );
        }),
      },
      {
        path: 'test-local-nonstd',
        element: <PageDataDisplay />,
        loader: createPageDataLoader(pageDataLoaderConfig, () => {
          // Local-only loader returning a non-standard HTTP status code.
          // Note: Cookies cannot be set from local loaders since there is no HTTP response;
          // use the HTTP-backed loader (API fetch) if you need to set cookies via Set-Cookie.
          return {
            status: 'error' as const,
            status_code: 418, // Non-standard status code (I'm a teapot)
            request_id: `local_${Date.now()}`,
            type: 'page' as const,
            data: null,
            meta: {
              page: {
                title: "I'm a Teapot",
                description: 'Non-standard status demo from local loader',
              },
            },
            error: {
              code: 'teapot',
              message: "I'm a teapot",
            },
          };
        }),
      },
      {
        path: 'test-page-loader',
        element: <PageDataDisplay />,
        loader: createPageDataLoader(pageDataLoaderConfig, 'test'),
      },
      {
        path: 'test-page-loader/:id',
        element: <PageDataDisplay />,
        loader: createPageDataLoader(pageDataLoaderConfig, 'test'),
      },
      {
        path: 'test-error-thrown',
        element: null,
        loader: () => {
          throw new Error(
            'Simulated error thrown from test-error-thrown loader',
          );
        },
      },
      {
        path: 'test-500',
        element: null, // Should show an error handled by the App.tsx file
        loader: createPageDataLoader(pageDataLoaderConfig, 'test-500'),
      },
      {
        path: 'test-stacktrace',
        element: null, // Should show an error handled by the App.tsx file
        loader: createPageDataLoader(pageDataLoaderConfig, 'test-stacktrace'),
      },
      {
        path: 'test-generic-error',
        element: null, // Should show an error handled by the App.tsx file
        loader: createPageDataLoader(
          pageDataLoaderConfig,
          'test-generic-error',
        ),
      },
      // 404 handler route
      {
        // have the code before the outlet detect not found or generic errors instead
        path: '*',
        element: null,
        loader: createPageDataLoader(pageDataLoaderConfig, 'not-found'),
      },
    ],
  },
];

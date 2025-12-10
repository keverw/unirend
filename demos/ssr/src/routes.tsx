import { RouteObject, Outlet, useLoaderData, useParams } from 'react-router';
import { Helmet } from 'react-helmet-async';
import RouteErrorBoundary from '../../../src/lib/router-utils/RouteErrorBoundary';
import {
  createPageDataLoader,
  createDefaultPageDataLoaderConfig,
} from '../../../src/router-utils';
import Home from './pages/Home';
import About from './pages/About';
import Contact from './pages/Contact';
import ContextDemo from './pages/ContextDemo';
import AppLayout from './components/AppLayout';
import CustomNotFound from './components/CustomNotFound';
import CustomApplicationError from './components/CustomApplicationError';
import GenericError from './components/GenericError';
import { useDataloaderEnvelopeError } from '../../../src/lib/router-utils/useDataloaderEnvelopeError';

// App layout component that passes Outlet to AppLayout as children
function App() {
  const { hasError, is404, errorResponse } = useDataloaderEnvelopeError();

  return (
    <AppLayout>
      {hasError ? (
        is404 ? (
          <CustomNotFound data={errorResponse} />
        ) : (
          <GenericError data={errorResponse} />
        )
      ) : (
        <Outlet />
      )}
    </AppLayout>
  );
}

// Component to display page data JSON with proper layout and SEO
const PageDataDisplay = () => {
  const data = useLoaderData();
  const params = useParams();

  // Extract meta information for document title
  const title = data?.meta?.page?.title || 'Test Page Data';
  const description =
    data?.meta?.page?.description || 'Test page response data';

  return (
    <>
      <Helmet>
        <title>{title}</title>
        <meta name="description" content={description} />
      </Helmet>

      <main className="main-content">
        <h1 className="hero-title">
          {params.id ? `Test Page Data (ID: ${params.id})` : 'Test Page Data'}
        </h1>
        <p className="hero-subtitle">
          Debug page showing page data loader request and response details
        </p>

        <div className="card">
          <h2>📋 Page Metadata</h2>
          <p>
            <strong>Title:</strong> {title}
          </p>
          <p>
            <strong>Description:</strong> {description}
          </p>
        </div>

        <div className="card">
          <h2>🧭 Environment</h2>
          <p>
            <strong>Mode:</strong> {data?.meta?.app?.environment || 'unknown'}
          </p>
        </div>

        <div className="card">
          <h2>🔍 Full Response Data</h2>
          <pre
            style={{
              backgroundColor: 'rgba(255, 255, 255, 0.1)',
              padding: '1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              overflow: 'auto',
              textAlign: 'left',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              maxHeight: '70vh',
              border: '1px solid rgba(255, 255, 255, 0.2)',
            }}
          >
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      </main>
    </>
  );
};

// Shared page data loader config
const pageDataLoaderConfig = {
  ...createDefaultPageDataLoaderConfig('http://localhost:3000'),
  pageDataEndpoint: '/api/v1/page_data',
};

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    errorElement: (
      <RouteErrorBoundary
        NotFoundComponent={CustomNotFound}
        ApplicationErrorComponent={CustomApplicationError}
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
        loader: createPageDataLoader(pageDataLoaderConfig, async (params) => {
          // Simple local-only loader example
          return {
            status: 'success' as const,
            status_code: 200,
            request_id: `local_${Date.now()}`,
            type: 'page' as const,
            data: {
              message: 'Local page data loader response (no HTTP)',
              pageType: params.pageType,
              invocation_origin: params.invocation_origin,
              request: {
                route_params: params.route_params,
                query_params: params.query_params,
                request_path: params.request_path,
                original_url: params.original_url,
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
        loader: createPageDataLoader(pageDataLoaderConfig, async (_params) => {
          // Simulated error thrown from a local-only loader
          throw new Error(
            'Simulated error thrown from local page data loader (no HTTP)',
          );
        }),
      },
      {
        path: 'test-local-nonstd',
        element: <PageDataDisplay />,
        loader: createPageDataLoader(pageDataLoaderConfig, async () => {
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
        loader: async () => {
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

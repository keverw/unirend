import { Outlet, useLocation } from 'react-router';
import { useDataLoaderEnvelopeError } from 'unirend/router-utils';
import { NotFound } from './error-pages/NotFound';
import { GenericError } from './error-pages/GenericError';
import { Header } from './Header';
import { Footer } from './Footer';
import { useEffect } from 'react';

export function AppLayout() {
  // RouteErrorBoundary handles thrown router errors and receives an `error` prop.
  // Page-data loaders can also return error envelopes, which stay in loader data,
  // so the layout renders those with a `data` prop instead.
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

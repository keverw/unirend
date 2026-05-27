import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useDataLoaderEnvelopeError } from '../../../src/lib/router-utils/use-data-loader-envelope-error-hook';
import { Header } from './Header';
import { Footer } from './Footer';
import { NotFound } from './error-pages/NotFound';
import { GenericError } from './error-pages/GenericError';

export function AppLayout() {
  // RouteErrorBoundary handles thrown router errors and receives an `error` prop.
  // Page-data loaders can also return error envelopes, which stay in loader data,
  // so the layout renders those with a `data` prop instead.
  const { hasError, is404, errorResponse } = useDataLoaderEnvelopeError();
  const location = useLocation();

  // Scroll to top when route changes.
  useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: 'instant',
    });
  }, [location.pathname]);

  return (
    <>
      <Header />
      {hasError ? (
        is404 ? (
          <NotFound data={errorResponse} />
        ) : (
          <GenericError data={errorResponse} />
        )
      ) : (
        <Outlet />
      )}
      <Footer />
    </>
  );
}

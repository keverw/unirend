import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useDataLoaderEnvelopeError } from '../../../../src/lib/router-utils/use-data-loader-envelope-error-hook';
import { Header } from './Header';
import { Footer } from './Footer';
import NotFound from '../pages/NotFound';
import GenericError from './GenericError';

export function AppLayout() {
  // if an error occurs, outside the error boundary since as sent by a data loader API,
  // we must handle those too
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

import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useDataLoaderEnvelopeError } from '../../../../src/lib/router-utils/use-data-loader-envelope-error-hook';
import Header from './Header';
import Footer from './Footer';
import CustomNotFound from './CustomNotFound';
import GenericError from './GenericError';

interface AppLayoutProps {
  children?: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const { hasError, is404, errorResponse } = useDataLoaderEnvelopeError();
  const location = useLocation();

  // Scroll to top when route changes
  useEffect(() => {
    // Regular pages scroll to top
    window.scrollTo({
      top: 0,
      behavior: 'instant',
    });
  }, [location.pathname]);

  return (
    <>
      <Header />
      {children ??
        (hasError ? (
          is404 ? (
            <CustomNotFound data={errorResponse} />
          ) : (
            <GenericError data={errorResponse} />
          )
        ) : (
          <Outlet />
        ))}
      <Footer />
    </>
  );
};

export default AppLayout;

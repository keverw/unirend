import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { Header } from './Header';
import { Footer } from './Footer';

export function AppLayout() {
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
      <Outlet />
      <Footer />
    </>
  );
}

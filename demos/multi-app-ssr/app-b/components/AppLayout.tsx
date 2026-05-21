import { Outlet, useLocation } from 'react-router';
import { useEffect } from 'react';
import Sidebar from './Sidebar';

export function AppLayout() {
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);

  return (
    <>
      <Sidebar />
      <div className="content-area">
        <Outlet />
        <footer className="content-footer">
          Unirend multi-app SSR demo — App B workspace
        </footer>
      </div>
    </>
  );
}

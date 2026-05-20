import { RouteObject } from 'react-router';
import Home from './pages/Home';
import About from './pages/About';
import Contact from './pages/Contact';
import Dashboard from './pages/Dashboard';
import AppPage from './pages/App';
import NotFound from './pages/NotFound';
import ContextDemo from './pages/ContextDemo';
import { AppLayout } from './components/AppLayout';
import RouteErrorBoundary from '../../../src/lib/router-utils/RouteErrorBoundary';
import CustomApplicationError from './components/CustomApplicationError';

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppLayout />,
    errorElement: (
      <RouteErrorBoundary
        NotFoundComponent={NotFound}
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
        path: 'dashboard',
        element: <Dashboard />,
      },
      {
        path: 'app',
        element: <AppPage />,
      },
      {
        path: 'context-demo',
        element: <ContextDemo />,
      },
      {
        path: '404', // Dedicated 404 route for SSG
        element: <NotFound />,
      },
      {
        path: '*', // Catch-all route for 404
        element: <NotFound />,
      },
    ],
  },
];

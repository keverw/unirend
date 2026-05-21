import type { RouteObject } from 'react-router';
import RouteErrorBoundary from '../../../src/lib/router-utils/RouteErrorBoundary';
import { AppLayout } from './components/AppLayout';
import NotFound from './components/error-pages/NotFound';
import ApplicationError from './components/error-pages/ApplicationError';
import Home from './pages/Home';
import TestAppThrow from './pages/TestAppThrow';

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
        path: 'test-app-throw',
        element: <TestAppThrow />,
      },
      {
        path: '*',
        element: <NotFound />,
      },
    ],
  },
];

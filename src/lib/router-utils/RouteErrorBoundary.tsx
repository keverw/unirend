import React from "react";
import { isRouteErrorResponse, useRouteError } from "react-router";
import DefaultNotFound from "./DefaultNotFound";
import DefaultApplicationError from "./DefaultApplicationError";

/**
 * Props for RouteErrorBoundary component
 *
 * For consistent user experience, custom error components should ideally match
 * the styling and behavior of your server-side error pages (configured via
 * `get500ErrorPage` in ServeSSROptions for SSR applications).
 */
export interface RouteErrorBoundaryProps {
  /** Custom component to render for 404 Not Found errors */
  NotFoundComponent?: React.ComponentType<{ error?: unknown }>;
  /** Custom component to render for application errors */
  ApplicationErrorComponent?: React.ComponentType<{ error: unknown }>;
}

/**
 * Customizable route error boundary that handles 404s and application errors
 *
 * Consider matching server-side error pages (get500ErrorPage in ServeSSROptions) for consistent UX.
 *
 * @param NotFoundComponent - Custom component for 404 errors (receives error prop)
 * @param ApplicationErrorComponent - Custom component for application errors (receives error prop)
 */
export default function RouteErrorBoundary({
  NotFoundComponent = DefaultNotFound,
  ApplicationErrorComponent = DefaultApplicationError,
}: RouteErrorBoundaryProps = {}) {
  const error = useRouteError();

  // For 404 errors, show the NotFound component with regular app layout
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundComponent error={error} />;
  }

  // For all other errors (application errors, other HTTP errors),
  // show the standalone error page without wrapping in AppLayout
  // This is because if there's an error in the app layout, it will
  // cause an infinite loop of errors
  return <ApplicationErrorComponent error={error} />;
}

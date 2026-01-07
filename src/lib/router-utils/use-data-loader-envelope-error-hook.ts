import { useMatches } from 'react-router';
import {
  PageErrorResponse,
  PageResponseEnvelope,
} from '../api-envelope/api-envelope-types';

export interface RouteErrorState {
  hasError: boolean;
  is404: boolean;
  errorResponse: PageErrorResponse | null;
}

/**
 * Detects envelope-based errors from any route in the current hierarchy.
 *
 * Typically used by a parent layout component to detect errors from child routes.
 * Uses useMatches() instead of useLoaderData() because useLoaderData() only returns
 * the current route's data, but we need to inspect data from child routes.
 */
export function useDataLoaderEnvelopeError() {
  const matches = useMatches();

  // Find error response from any active route
  let errorResponse: PageErrorResponse | null = null;

  // We need to check all matches because the error could be in any child route
  for (const match of matches) {
    const data = match.data as PageResponseEnvelope | undefined;

    if (data?.status === 'error') {
      errorResponse = data;
      break;
    }
  }

  // Determine if we have an error and what type
  const hasError = !!errorResponse;
  const is404 = hasError && errorResponse?.status_code === 404;

  return {
    hasError,
    is404,
    errorResponse,
  };
}

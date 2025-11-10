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

export function useDataloaderEnvelopeError() {
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

/**
 * Shared utility for getting API response helpers class from request
 *
 * This is used by file upload helpers and validation hooks to create
 * consistent error responses using the user's custom APIResponseHelpersClass
 * if decorated on the request, or the default APIResponseHelpers.
 */

import type { FastifyRequest } from 'fastify';
import { APIResponseHelpers } from '../api-envelope/response-helpers';
import type { APIErrorResponse } from '../api-envelope/api-envelope-types';

/**
 * Type for the API response helpers class
 */
export interface APIResponseHelpersClassType {
  createAPIErrorResponse: (params: {
    request: FastifyRequest;
    statusCode: number;
    errorCode: string;
    errorMessage: string;
    errorDetails?: Record<string, unknown>;
  }) => APIErrorResponse;
}

/**
 * Get the APIResponseHelpersClass to use for creating error responses.
 *
 * Priority:
 * 1. Custom class decorated on the request (if available)
 * 2. Default APIResponseHelpers class
 *
 * @param request - Fastify request object
 * @returns The helpers class to use
 */
export function getAPIResponseHelpersClass(
  request: FastifyRequest,
): APIResponseHelpersClassType {
  // Try to get custom class from request decoration
  const decoratedClass = (
    request as FastifyRequest & {
      APIResponseHelpersClass?: APIResponseHelpersClassType;
    }
  ).APIResponseHelpersClass;

  if (decoratedClass?.createAPIErrorResponse) {
    return decoratedClass;
  }

  // Fall back to default helpers
  return APIResponseHelpers;
}

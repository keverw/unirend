/**
 * Shared utility for getting API response helpers class from request
 *
 * This is used by file upload helpers and validation hooks to create
 * consistent error responses using the user's custom APIResponseHelpersClass
 * if decorated on the request, or the default APIResponseHelpers.
 */

import type { FastifyRequest } from 'fastify';
import { APIResponseHelpers } from '../api-envelope/response-helpers';
import type { APIResponseHelpersClass } from '../types';

/**
 * Get the APIResponseHelpersClass to use for creating error responses.
 *
 * The decoration is how code that only holds a request reaches the class its
 * server was configured with. It is set once at startup and unirend never
 * varies it per request, so this is plumbing rather than an override point.
 * Code that already has the configured class in hand should use that directly
 * instead of looking it up here.
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
): APIResponseHelpersClass {
  // Try to get custom class from request decoration
  const decoratedClass = (
    request as FastifyRequest & {
      APIResponseHelpersClass?: APIResponseHelpersClass;
    }
  ).APIResponseHelpersClass;

  if (decoratedClass?.createAPIErrorResponse) {
    return decoratedClass;
  }

  // Fall back to default helpers
  return APIResponseHelpers;
}

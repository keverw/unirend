import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { FileUploadsConfig } from '../types';
import multipart from '@fastify/multipart';
import { APIResponseHelpers } from '../api-envelope/response-helpers';

/**
 * Normalize a URL path for route matching
 * - Removes query strings
 * - Removes trailing slashes (except for root path "/")
 * - Collapses multiple consecutive slashes
 * @param path - The path to normalize
 * @returns Normalized path
 */
function normalizePath(path: string): string {
  // Remove query string
  let normalized = path.split('?')[0];

  // Collapse multiple consecutive slashes to single slash
  normalized = normalized.replace(/\/+/g, '/');

  // Remove trailing slash (unless it's the root path "/")
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Check if a URL matches a route pattern (supports wildcards)
 * @param url - The URL to check (will be normalized before matching)
 * @param pattern - The pattern to match against (will be normalized, supports * wildcard)
 * @returns true if the URL matches the pattern
 */
export function matchesRoutePattern(url: string, pattern: string): boolean {
  // Normalize both URL and pattern for consistent matching
  const normalizedPath = normalizePath(url);
  const normalizedPattern = normalizePath(pattern);

  // Exact match
  if (normalizedPattern === normalizedPath) {
    return true;
  } else if (!normalizedPattern.includes('*')) {
    // No wildcard and not an exact match
    return false;
  } else {
    // Wildcard pattern - convert to regex
    // Example: /api/workspace/*/upload -> /api/workspace/[^/]+/upload
    const regexPattern = normalizedPattern
      .split('/')
      .map((segment) =>
        segment === '*'
          ? '[^/]+'
          : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('/');

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  }
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
function getAPIResponseHelpersClass(request: FastifyRequest): {
  createAPIErrorResponse: (params: {
    request: FastifyRequest;
    statusCode: number;
    errorCode: string;
    errorMessage: string;
    errorDetails?: Record<string, unknown>;
  }) => unknown;
} {
  // Try to get custom class from request decoration
  const decoratedClass = (
    request as FastifyRequest & {
      APIResponseHelpersClass?: {
        createAPIErrorResponse: (params: {
          request: FastifyRequest;
          statusCode: number;
          errorCode: string;
          errorMessage: string;
          errorDetails?: Record<string, unknown>;
        }) => unknown;
      };
    }
  ).APIResponseHelpersClass;

  if (decoratedClass?.createAPIErrorResponse) {
    return decoratedClass;
  }

  // Fall back to default helpers
  return APIResponseHelpers;
}

/**
 * Register file upload validation hooks after user plugins
 * This ensures user plugin hooks (auth, etc.) run before upload validation
 * @param fastifyInstance - The Fastify instance to register hooks on
 * @param fileUploadsConfig - The file uploads configuration
 */
export function registerFileUploadValidationHooks(
  fastifyInstance: FastifyInstance,
  fileUploadsConfig: FileUploadsConfig,
): void {
  const earlyValidation = fileUploadsConfig.earlyValidation;
  const allowedRoutes = fileUploadsConfig.allowedRoutes;

  // Only register hook if there's something to validate
  if (!earlyValidation && (!allowedRoutes || allowedRoutes.length === 0)) {
    return;
  }

  fastifyInstance.addHook(
    'preHandler',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const isMultipart = request.headers['content-type']?.startsWith(
        'multipart/form-data',
      );

      if (isMultipart) {
        // Check allowed routes FIRST (no point validating if route not allowed)
        if (allowedRoutes && allowedRoutes.length > 0) {
          // matchesRoutePattern handles normalization (query strings, trailing slashes, etc.)
          const isAllowedRoute = allowedRoutes.some((pattern) =>
            matchesRoutePattern(request.url, pattern),
          );

          if (!isAllowedRoute) {
            const helpersClass = getAPIResponseHelpersClass(request);
            const errorEnvelope = helpersClass.createAPIErrorResponse({
              request,
              statusCode: 400,
              errorCode: 'multipart_not_allowed',
              errorMessage: 'Multipart uploads not allowed on this endpoint',
            });

            return reply
              .code(400)
              .header('Cache-Control', 'no-store')
              .send(errorEnvelope);
          }
        }

        // Then run early validation if provided (useful for header-based auth, rate limiting, etc.)
        if (earlyValidation) {
          const result = await earlyValidation(request);

          if (result !== true) {
            const helpersClass = getAPIResponseHelpersClass(request);
            const errorEnvelope = helpersClass.createAPIErrorResponse({
              request,
              statusCode: result.statusCode,
              errorCode: result.error,
              errorMessage: result.message,
            });

            return reply
              .code(result.statusCode)
              .header('Cache-Control', 'no-store')
              .send(errorEnvelope);
          }
        }
      }
    },
  );
}

/**
 * Register the @fastify/multipart plugin with default limits
 * @param fastifyInstance - The Fastify instance to register the plugin on
 * @param fileUploadsConfig - The file uploads configuration
 */
export async function registerMultipartPlugin(
  fastifyInstance: FastifyInstance,
  fileUploadsConfig: FileUploadsConfig,
): Promise<void> {
  const limits = fileUploadsConfig.limits || {};

  await fastifyInstance.register(multipart, {
    throwFileSizeLimit: false,
    limits: {
      fileSize: limits.fileSize ?? 10 * 1024 * 1024, // 10MB default
      files: limits.files ?? 10, // default
      fields: limits.fields ?? 10, // default
      fieldSize: limits.fieldSize ?? 1024, // 1KB default
    },
  });

  // Decorate to indicate multipart is available
  fastifyInstance.decorate('multipartEnabled', true);
}

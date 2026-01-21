import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { FileUploadsConfig } from '../types';
import multipart from '@fastify/multipart';
import { getAPIResponseHelpersClass } from './api-response-helpers-utils';

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
 *
 * Wildcard patterns:
 * - Single asterisk (*) matches exactly one path segment
 *   Example: "/api/star/upload" matches "/api/foo/upload" but NOT "/api/foo/bar/upload"
 * - Double asterisk (**) matches zero or more path segments
 *   Example: "/api/**" matches "/api", "/api/foo", "/api/foo/bar", etc.
 *
 * @param url - The URL to check (will be normalized before matching)
 * @param pattern - The pattern to match against (will be normalized, supports * and ** wildcards)
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
    // Process segments to handle * and ** wildcards
    const segments = normalizedPattern.split('/');
    const regexParts: string[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (segment === '**') {
        if (isLast) {
          // ** at end: match "/" followed by anything, or nothing at all
          regexParts.push('(?:/.*)?');
        } else {
          // ** in middle: match anything (including slashes) non-greedy
          regexParts.push('(?:.*?)');
        }
      } else if (segment === '*') {
        // * matches exactly one path segment (no slashes)
        regexParts.push('[^/]+');
      } else {
        // Escape regex special characters for literal matching
        regexParts.push(segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      }
    }

    // Join with slashes, but handle ** specially (it already includes slash handling)
    let regexPattern = '';
    for (const [i, part] of regexParts.entries()) {
      const originalSegment = segments[i];

      if (i > 0 && originalSegment !== '**' && segments[i - 1] !== '**') {
        regexPattern += '/';
      } else if (
        i > 0 &&
        originalSegment !== '**' &&
        segments[i - 1] === '**'
      ) {
        // After ** in middle, need a slash before the next segment
        regexPattern += '/';
      }
      regexPattern += part;
    }

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(normalizedPath);
  }
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
          // Support both sync and async validation functions (matches onComplete pattern)
          // Wrap in Promise.resolve().then() to normalize sync/async and catch sync throws
          const result = await Promise.resolve().then(() =>
            earlyValidation(request),
          );

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

import picomatch from 'picomatch';
import type { FastifyRequest } from 'fastify';

export type StaticRequestMatcher = (pathname: string) => boolean;

/** Build and validate the early pathname classifier shared by server types. */
export function createStaticRequestMatcher(
  patterns: string[] | undefined,
): StaticRequestMatcher {
  if (!patterns?.length) {
    return () => false;
  }

  for (const pattern of patterns) {
    if (
      typeof pattern !== 'string' ||
      !pattern.startsWith('/') ||
      pattern.includes('?') ||
      pattern.includes('#') ||
      pattern.includes('\0')
    ) {
      throw new Error(
        'staticRequestPaths entries must be absolute URL paths without query strings, fragments, or null bytes',
      );
    }
  }

  try {
    return picomatch(patterns);
  } catch (error) {
    throw new Error(
      `Invalid staticRequestPaths pattern: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Set the early pathname classification before user plugins run. */
export function setStaticRequestClassification(
  request: FastifyRequest,
  matchesPath: StaticRequestMatcher,
): void {
  try {
    const pathname = new URL(request.url, 'http://unirend.local').pathname;
    request.isStaticRequest = matchesPath(pathname);
  } catch {
    request.isStaticRequest = false;
  }
}

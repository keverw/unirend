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
        // `?` is rejected on purpose even though picomatch reads it as a
        // single-character wildcard: a pattern only ever sees the pathname, so
        // a `?` in one is far more likely to be a query string than a wildcard.
        'staticRequestPaths entries must be absolute URL paths and cannot contain "?" (unsupported here, including query strings), fragments, or null bytes',
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
    // The origin is prefixed rather than passed as a base URL: a request path
    // that starts with '//' is a path here, not an authority, so resolving it
    // against a base would classify '//host/assets/x' as '/assets/x' while
    // Fastify still routes the original path.
    const pathname = new URL(`http://unirend.local${request.url}`).pathname;
    request.isStaticRequest = matchesPath(pathname);
  } catch {
    request.isStaticRequest = false;
  }
}

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
    // `dot: true` so a segment beginning with '.' is matched by '*' and '**'.
    // Picomatch's default hides paths like '/.well-known/acme-challenge/token'
    // from a '/**' pattern, which is surprising for URL path matching.
    //
    // `windows: false` because these are URL paths, never filesystem paths.
    // Picomatch otherwise picks the mode from `process.platform`, and its
    // Windows mode rewrites a backslash in the input to '/' before matching.
    // Fastify routes '/assets\main.js' as that literal path, so letting it be
    // read as '/assets/main.js' would classify a request that really reaches
    // the catch-all route, and only on a Windows host. Pinning POSIX also
    // keeps pattern parsing identical everywhere, since the two modes disagree
    // on whether a backslash is an escape or a separator.
    return picomatch(patterns, { dot: true, windows: false });
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
  // The raw path is matched after stripping the query and fragment, the same
  // way static routing resolves a URL. Parsing through `URL` instead would
  // apply RFC 3986 normalization, collapsing '/foo/../assets/x.js' (and the
  // percent-encoded '/assets/%2e%2e/x') to a different path than the one
  // Fastify routes, so a request that actually reaches the catch-all route
  // would be classified as an asset. It also keeps '//host/assets/x' a path
  // rather than an authority.
  const rawURL = request.url ?? '';
  const cleanedURL = rawURL.split('?')[0].split('#')[0];
  const pathname = cleanedURL.startsWith('/') ? cleanedURL : `/${cleanedURL}`;

  request.isStaticRequest = matchesPath(pathname);
}

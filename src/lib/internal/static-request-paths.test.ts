import { describe, expect, it } from 'bun:test';
import type { FastifyRequest } from 'fastify';
import {
  createStaticRequestMatcher,
  setStaticRequestClassification,
} from './static-request-paths';

describe('createStaticRequestMatcher()', () => {
  it('matches exact paths and picomatch globs', () => {
    const matches = createStaticRequestMatcher(['/favicon.ico', '/assets/**']);

    expect(matches('/favicon.ico')).toBe(true);
    expect(matches('/assets/app/main.js')).toBe(true);
    expect(matches('/ordinary-route')).toBe(false);
  });

  it('defaults to false when no patterns are configured', () => {
    expect(createStaticRequestMatcher(undefined)('/favicon.ico')).toBe(false);
    expect(createStaticRequestMatcher([])('/favicon.ico')).toBe(false);
  });

  it('rejects non-path patterns at startup', () => {
    for (const pattern of ['assets/**', '/assets/**?v=1', '/assets/#hash']) {
      expect(() => createStaticRequestMatcher([pattern])).toThrow(
        'staticRequestPaths entries must be absolute URL paths',
      );
    }
  });

  it('classifies the pathname without considering the query string', () => {
    const request = {
      url: '/assets/main.js?v=1',
      isStaticRequest: false,
    } as FastifyRequest;
    setStaticRequestClassification(
      request,
      createStaticRequestMatcher(['/assets/**']),
    );
    expect(request.isStaticRequest).toBe(true);
  });

  it('treats a leading double slash as a path, not an authority', () => {
    // '//evil.com/assets/x.js' is routed by Fastify as that whole path, so
    // reading an authority out of it would classify a request that actually
    // reaches the catch-all route as a static asset.
    const matches = createStaticRequestMatcher(['/assets/**']);

    for (const url of ['//evil.com/assets/x.js', '//assets/x.js']) {
      const request = { url, isStaticRequest: false } as FastifyRequest;
      setStaticRequestClassification(request, matches);
      expect(request.isStaticRequest).toBe(false);
    }
  });

  it('leaves dot segments unresolved so classification matches routing', () => {
    // Fastify routes '/foo/../assets/x.js' as that literal path, and static
    // routing matches prefixes against it unchanged, so normalizing it here
    // would classify a request that really reaches the catch-all route.
    // Note: `fastify.inject()` normalizes the URL, a raw socket request does
    // not, so this has to be asserted at the classifier.
    const matches = createStaticRequestMatcher(['/assets/**']);

    for (const url of ['/foo/../assets/x.js', '/./foo/./../assets/x.js']) {
      const request = { url, isStaticRequest: false } as FastifyRequest;
      setStaticRequestClassification(request, matches);
      expect(request.isStaticRequest).toBe(false);
    }

    // A traversal-shaped URL under the pattern's own prefix relies on
    // picomatch refusing to let '*' or '**' match a '..' segment, which holds
    // with `dot: true`. Asserted so an upstream change cannot silently widen
    // classification to these URLs.
    expect(matches('/assets/../secret')).toBe(false);
  });

  it('matches dot segments in a path, unlike picomatch defaults', () => {
    const matches = createStaticRequestMatcher(['/assets/**', '/**']);

    expect(matches('/assets/.hidden.js')).toBe(true);
    expect(matches('/.well-known/acme-challenge/token')).toBe(true);
  });
});

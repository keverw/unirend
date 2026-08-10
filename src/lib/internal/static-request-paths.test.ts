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
    for (const pattern of [
      'assets/**',
      '/assets/**?v=1',
      '/assets/#hash',
      // A null byte truncates a path for the C library underneath the
      // filesystem calls, so a pattern carrying one must never compile.
      '/assets/\0/x.js',
      '/assets/**\0',
    ]) {
      expect(() => createStaticRequestMatcher([pattern])).toThrow(
        'staticRequestPaths entries must be absolute URL paths',
      );
    }
  });

  it('rejects an entry that is not a string', () => {
    // The option is typed as string[], so this guards a value arriving from
    // JSON config or plain JavaScript, where the type is not enforced.
    for (const pattern of [42, null, undefined, {}, ['/assets/**']]) {
      expect(() =>
        createStaticRequestMatcher([pattern] as unknown as string[]),
      ).toThrow('staticRequestPaths entries must be absolute URL paths');
    }
  });

  it('wraps a pattern picomatch itself refuses to compile', () => {
    // Picomatch caps a pattern at 65536 characters and throws a SyntaxError
    // past that. The entry clears every check above (a string, absolute, no
    // '?', '#', or null byte), so this is the compile failure the try/catch
    // exists for, and the wrapper names the option the bad entry came from.
    const overLongPattern = `/${'x'.repeat(70000)}`;

    expect(() => createStaticRequestMatcher([overLongPattern])).toThrow(
      'Invalid staticRequestPaths pattern:',
    );
    expect(() => createStaticRequestMatcher([overLongPattern])).toThrow(
      'exceeds maximum allowed length',
    );
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

  it('treats a backslash as an ordinary character on a Windows host', () => {
    // Picomatch picks its mode from the host platform unless told otherwise,
    // and its Windows mode rewrites a backslash in the input to '/' before
    // matching. Fastify routes '/assets\\main.js' as that literal path, so
    // reading it as '/assets/main.js' would classify a request that really
    // reaches the catch-all route.
    //
    // The host has to be faked, because on a POSIX machine the unpinned
    // default is already POSIX and this passes whether or not the matcher
    // pins it. Picomatch reads `navigator.platform` before `process.platform`
    // and does the detection when the matcher is built, so stubbing the
    // global around the call is enough.
    const originalNavigator = Object.getOwnPropertyDescriptor(
      globalThis,
      'navigator',
    );

    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Win32' },
      configurable: true,
      writable: true,
    });

    try {
      const matches = createStaticRequestMatcher(['/assets/**']);

      expect(matches('/assets\\main.js')).toBe(false);
      expect(matches('/assets/main.js')).toBe(true);

      const request = {
        url: '/assets\\main.js',
        isStaticRequest: false,
      } as FastifyRequest;
      setStaticRequestClassification(request, matches);
      expect(request.isStaticRequest).toBe(false);
    } finally {
      if (originalNavigator) {
        Object.defineProperty(globalThis, 'navigator', originalNavigator);
      } else {
        delete (globalThis as { navigator?: unknown }).navigator;
      }
    }
  });

  it('matches dot segments in a path, unlike picomatch defaults', () => {
    const matches = createStaticRequestMatcher(['/assets/**', '/**']);

    expect(matches('/assets/.hidden.js')).toBe(true);
    expect(matches('/.well-known/acme-challenge/token')).toBe(true);
  });
});

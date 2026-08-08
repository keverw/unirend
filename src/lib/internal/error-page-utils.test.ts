import { describe, it, expect } from 'bun:test';
import type { FastifyRequest } from 'fastify';
import {
  generateDefault404NotFoundPage,
  generateDefault500ErrorPage,
  generateDefault503ClosingPage,
  UNIREND_ERROR_PAGE_STYLE_HASHES,
} from './error-page-utils';
import { hashInlineContentForCSP } from './csp-hash';

function makeRequest(
  overrides: Partial<{ url: string; method: string }> = {},
): FastifyRequest {
  return {
    url: overrides.url ?? '/test-path',
    method: overrides.method ?? 'GET',
  } as unknown as FastifyRequest;
}

describe('generateDefault500ErrorPage', () => {
  it('returns a valid HTML document', () => {
    const html = generateDefault500ErrorPage(
      makeRequest(),
      new Error('test error'),
      false,
    );

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('includes 500 status text in production mode', () => {
    const html = generateDefault500ErrorPage(
      makeRequest(),
      new Error('secret details'),
      false,
    );

    expect(html).toContain('500');
    expect(html).not.toContain('secret details');
  });

  it('does not expose error details in production mode', () => {
    const html = generateDefault500ErrorPage(
      makeRequest(),
      new Error('confidential stack info'),
      false,
    );

    expect(html).not.toContain('confidential stack info');
    expect(html).not.toContain('Stack Trace');
  });

  it('includes error message in development mode', () => {
    const html = generateDefault500ErrorPage(
      makeRequest(),
      new Error('dev error message'),
      true,
    );

    expect(html).toContain('dev error message');
  });

  it('includes stack trace in development mode', () => {
    const err = new Error('stack test');
    const html = generateDefault500ErrorPage(makeRequest(), err, true);

    expect(html).toContain('Stack Trace');
  });

  it('includes request URL and method in development mode', () => {
    const html = generateDefault500ErrorPage(
      makeRequest({ url: '/my/path', method: 'POST' }),
      new Error('x'),
      true,
    );

    expect(html).toContain('/my/path');
    expect(html).toContain('POST');
  });

  it('escapes HTML special characters in the error message', () => {
    const html = generateDefault500ErrorPage(
      makeRequest(),
      new Error('<script>alert(1)</script>'),
      true,
    );

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes HTML special characters in the request URL', () => {
    const html = generateDefault500ErrorPage(
      makeRequest({ url: '/path?q=<xss>' }),
      new Error('x'),
      true,
    );

    expect(html).not.toContain('<xss>');
    expect(html).toContain('&lt;xss&gt;');
  });

  it('handles an error with no stack trace', () => {
    const err = new Error('no stack');
    err.stack = undefined;
    const html = generateDefault500ErrorPage(makeRequest(), err, true);

    expect(html).toContain('No stack trace available');
  });

  it('shows dev mode note in development mode', () => {
    const html = generateDefault500ErrorPage(
      makeRequest(),
      new Error('x'),
      true,
    );

    expect(html).toContain('only shown in development mode');
  });

  it('does not show dev mode note in production mode', () => {
    const html = generateDefault500ErrorPage(
      makeRequest(),
      new Error('x'),
      false,
    );

    expect(html).not.toContain('only shown in development mode');
  });

  describe('the Refresh Page link', () => {
    /**
     * Resolve the refresh link the way a browser would, which is the only
     * question that matters. Asserting on the raw attribute would pass for a
     * sanitizer that escapes the characters without changing what the URL
     * means.
     */
    function refreshTarget(url: string): URL {
      const html = generateDefault500ErrorPage(
        makeRequest({ url }),
        new Error('x'),
        false,
      );

      const href = /<a class="ep-btn" href="([^"]*)"/.exec(html)?.[1];

      if (href === undefined) {
        throw new Error('no refresh link found in the rendered page');
      }

      return new URL(href, 'https://good.example/current/page?q=1');
    }

    // Fastify hands over the request target verbatim, so every one of these is
    // something a client can actually send. In an anchor they resolve to
    // another origin, which would turn this button into an open redirect on a
    // page that is reached precisely when something has already gone wrong.
    const hostileTargets = [
      // Protocol-relative.
      '//attacker.example/path',
      // Absolute-form, legal in a request line.
      'http://attacker.example/path',
      // A URL parser folds backslashes into slashes for http(s), so these are
      // protocol-relative too, without containing a single "//".
      '/\\/attacker.example',
      '/\\attacker.example',
      '/\\\\attacker.example',
      // Neither escaping nor a scheme check would catch this one.
      '//attacker.example',
    ];

    for (const url of hostileTargets) {
      it(`stays on this origin for ${JSON.stringify(url)}`, () => {
        expect(refreshTarget(url).origin).toBe('https://good.example');
      });
    }

    it('points at the current document', () => {
      // What "refresh" means, and the reason an empty href is the right answer
      // rather than merely the safe one: the browser reloads the URL it is
      // actually on, query string included.
      expect(refreshTarget('/current/page?q=1').href).toBe(
        'https://good.example/current/page?q=1',
      );
    });
  });
});

describe('generateDefault503ClosingPage', () => {
  it('returns a valid HTML document', () => {
    const html = generateDefault503ClosingPage();

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
    expect(html).toContain('</html>');
  });

  it('includes 503 status text', () => {
    const html = generateDefault503ClosingPage();

    expect(html).toContain('503');
    expect(html).toContain('Service Unavailable');
  });

  it('mentions server shutting down', () => {
    const html = generateDefault503ClosingPage();

    expect(html).toContain('shutting down');
  });

  it('is a deterministic pure function', () => {
    expect(generateDefault503ClosingPage()).toBe(
      generateDefault503ClosingPage(),
    );
  });
});

describe('CSP compatibility', () => {
  /**
   * Pull out what a browser would treat as the element's text content: the
   * exact bytes between the tags, with no trimming, since that is what the
   * digest covers.
   */
  function inlineStyleContents(html: string): string[] {
    return [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  }

  const pages: Array<[string, string]> = [
    [
      '500',
      generateDefault500ErrorPage(makeRequest(), new Error('boom'), false),
    ],
    [
      '500 (development)',
      generateDefault500ErrorPage(makeRequest(), new Error('boom'), true),
    ],
    ['404', generateDefault404NotFoundPage(makeRequest())],
    ['503', generateDefault503ClosingPage()],
  ];

  for (const [label, html] of pages) {
    it(`publishes a matching style-src hash for the ${label} page`, () => {
      // The regression this exists for: someone reformats the template, the
      // delivered bytes shift, and the published hash silently stops matching.
      // Nothing fails at runtime, the page just renders unstyled under CSP, on
      // exactly the requests where something has already gone wrong.
      const blocks = inlineStyleContents(html);

      expect(blocks).toHaveLength(1);
      expect(UNIREND_ERROR_PAGE_STYLE_HASHES).toContain(
        hashInlineContentForCSP(blocks[0]),
      );
    });
  }

  it('has no inline event handler attributes', () => {
    // CSP hashes cover <script> and <style> elements, never an on* attribute,
    // so an inline handler needs 'unsafe-hashes' or it simply does not run.
    // The 500 page's refresh control used to be a button with onclick.
    for (const [, html] of pages) {
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
    }
  });

  it('offers refresh as a link rather than a scripted reload', () => {
    const html = generateDefault500ErrorPage(
      makeRequest({ url: '/orders?page=2' }),
      new Error('boom'),
      false,
    );

    // An anchor rather than a scripted reload, which also avoids re-submitting
    // a POST that failed. The href is empty on purpose, so it resolves to the
    // current document instead of to a target the client got to choose. See
    // the "Refresh Page link" tests above for why that matters.
    expect(html).toContain('<a class="ep-btn" href="">Refresh Page</a>');
    expect(html).not.toContain('/orders?page=2');
  });

  it('does not put the request URL in the production page at all', () => {
    // It was previously the refresh target, escaped. Escaping stopped it from
    // breaking out of the attribute but not from pointing at another origin,
    // so the URL is no longer used here in any form.
    const html = generateDefault500ErrorPage(
      makeRequest({ url: '/x"><script>alert(1)</script>' }),
      new Error('boom'),
      false,
    );

    expect(html).not.toContain('"><script>alert(1)');
    expect(html).not.toContain('alert(1)');
  });
});

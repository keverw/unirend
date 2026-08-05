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

  it('offers refresh as a link back to the same URL', () => {
    const html = generateDefault500ErrorPage(
      makeRequest({ url: '/orders?page=2' }),
      new Error('boom'),
      false,
    );

    // An anchor rather than a scripted reload, which also avoids re-submitting
    // a POST that failed.
    expect(html).toContain('<a class="ep-btn" href="/orders?page=2">');
  });

  it('escapes the refresh target, which is attacker-controlled', () => {
    const html = generateDefault500ErrorPage(
      makeRequest({ url: '/x"><script>alert(1)</script>' }),
      new Error('boom'),
      false,
    );

    expect(html).not.toContain('"><script>alert(1)');
  });
});

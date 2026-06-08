import { describe, it, expect } from 'bun:test';
import type { FastifyRequest } from 'fastify';
import {
  generateDefault500ErrorPage,
  generateDefault503ClosingPage,
} from './error-page-utils';

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

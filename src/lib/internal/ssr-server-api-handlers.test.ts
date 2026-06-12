/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, mock } from 'bun:test';
import { serveSSRBuilt } from '../ssr';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { APIResponseHelpers } from '../../api-envelope';

/**
 * Tests for SSRServer's handleAPIError and handleAPINotFound private methods.
 *
 * Uses @ts-expect-error for private method access, following the pattern in
 * ssr-server-private.test.ts and ssr-server-private-more.test.ts.
 */

function makeMockRequest(
  overrides: Record<string, unknown> = {},
): FastifyRequest {
  return {
    method: 'GET',
    url: '/api/test',
    isDevelopment: false,
    log: {
      error: mock((..._args: unknown[]) => {}),
    },
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeMockReply(): FastifyReply {
  const reply = {
    code: mock((_n: number) => reply),
    header: mock((_k: string, _v: string) => reply),
  };
  return reply as unknown as FastifyReply;
}

class CustomAPIResponseHelpers extends APIResponseHelpers {}

// ---------------------------------------------------------------------------
// handleAPIError
// ---------------------------------------------------------------------------

describe('SSRServer.handleAPIError() (private)', () => {
  it('returns a default error response and sets Cache-Control header', async () => {
    const server = serveSSRBuilt('/fake/build');
    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    const result = await server.handleAPIError(
      request,
      reply,
      new Error('boom'),
    );

    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(reply.code).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('calls the custom error handler and returns its envelope', async () => {
    const customResponse = { status_code: 422, error: 'validation failed' };
    const server = serveSSRBuilt('/fake/build', {
      APIHandling: {
        // @ts-expect-error — simplified mock return type for testing
        errorHandler: mock(() => customResponse),
      },
    });

    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    const result = await server.handleAPIError(request, reply, new Error('e'));

    expect(reply.code).toHaveBeenCalledWith(422);
    expect(result).toBe(customResponse);
  });

  it('passes the configured APIResponseHelpersClass to the custom error handler params', async () => {
    const customResponse = { status_code: 500, error: 'custom error' };
    const customHandler = mock(
      (
        _request: FastifyRequest,
        _error: Error,
        _isDevelopment: boolean,
        _isPageData: boolean | undefined,
        _params: unknown,
      ) => customResponse,
    );
    const server = serveSSRBuilt('/fake/build', {
      APIResponseHelpersClass: CustomAPIResponseHelpers,
      APIHandling: {
        // @ts-expect-error — simplified mock return type for testing
        errorHandler: customHandler,
      },
    });

    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    await server.handleAPIError(request, reply, new Error('e'));

    expect(customHandler.mock.calls[0][4]).toEqual({
      APIResponseHelpers: CustomAPIResponseHelpers,
    });
  });

  it('defaults status to 500 when the custom response has no status_code', async () => {
    const server = serveSSRBuilt('/fake/build', {
      APIHandling: {
        // @ts-expect-error — simplified mock return type for testing
        errorHandler: mock(() => ({ error: 'no status code' })),
      },
    });

    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    await server.handleAPIError(request, reply, new Error('e'));

    expect(reply.code).toHaveBeenCalledWith(500);
  });

  it('falls back to default handler when the custom error handler throws', async () => {
    const logError = mock((..._args: unknown[]) => {});
    const server = serveSSRBuilt('/fake/build', {
      APIHandling: {
        // simplified mock for testing
        errorHandler: mock(() => {
          throw new Error('handler crashed');
        }),
      },
    });

    const request = makeMockRequest({ log: { error: logError } });
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    const result = await server.handleAPIError(
      request,
      reply,
      new Error('original'),
    );

    // Custom handler was called and threw; the fallback default response is returned
    expect(logError).toHaveBeenCalledTimes(1);
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(result).toBeDefined();
  });

  it('handles isDevelopment: true on the request', async () => {
    const server = serveSSRBuilt('/fake/build');
    const request = makeMockRequest({ isDevelopment: true });
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    const result = await server.handleAPIError(
      request,
      reply,
      new Error('dev'),
    );

    expect(result).toBeDefined();
  });

  it('classifies a page-data URL and passes isPageData to the custom handler', async () => {
    const customHandler = mock(
      (
        _request: FastifyRequest,
        _error: Error,
        _isDevelopment: boolean,
        _isPageData: boolean,
      ) => ({ status_code: 500 }),
    );
    const server = serveSSRBuilt('/fake/build', {
      APIHandling: {
        // @ts-expect-error — simplified mock return type for testing
        errorHandler: customHandler,
      },
    });

    // page_data endpoint is the default normalized endpoint
    const request = makeMockRequest({ url: '/api/page_data/home' });
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    await server.handleAPIError(request, reply, new Error('e'));

    expect(customHandler).toHaveBeenCalledTimes(1);
    expect(customHandler.mock.calls[0][3]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// handleAPINotFound
// ---------------------------------------------------------------------------

describe('SSRServer.handleAPINotFound() (private)', () => {
  it('returns a default 404 response and sets Cache-Control header', async () => {
    const server = serveSSRBuilt('/fake/build');
    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    const result = await server.handleAPINotFound(request, reply);

    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(reply.code).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('calls the custom not-found handler and returns its envelope', async () => {
    const customResponse = { status_code: 404, error: 'custom not found' };
    const server = serveSSRBuilt('/fake/build', {
      APIHandling: {
        // @ts-expect-error — simplified mock return type for testing
        notFoundHandler: mock(() => customResponse),
      },
    });

    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    const result = await server.handleAPINotFound(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
    expect(result).toBe(customResponse);
  });

  it('passes the configured APIResponseHelpersClass to the custom not-found handler params', async () => {
    const customResponse = { status_code: 404, error: 'custom not found' };
    const customHandler = mock(
      (
        _request: FastifyRequest,
        _isPageData: boolean | undefined,
        _params: unknown,
      ) => customResponse,
    );
    const server = serveSSRBuilt('/fake/build', {
      APIResponseHelpersClass: CustomAPIResponseHelpers,
      APIHandling: {
        // @ts-expect-error — simplified mock return type for testing
        notFoundHandler: customHandler,
      },
    });

    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    await server.handleAPINotFound(request, reply);

    expect(customHandler.mock.calls[0][2]).toEqual({
      APIResponseHelpers: CustomAPIResponseHelpers,
    });
  });

  it('uses a non-404 status code from the custom response envelope', async () => {
    const server = serveSSRBuilt('/fake/build', {
      APIHandling: {
        // @ts-expect-error — simplified mock return type for testing
        notFoundHandler: mock(() => ({ status_code: 410 })),
      },
    });

    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    await server.handleAPINotFound(request, reply);

    expect(reply.code).toHaveBeenCalledWith(410);
  });

  it('defaults status to 404 when custom response has no status_code', async () => {
    const server = serveSSRBuilt('/fake/build', {
      APIHandling: {
        // @ts-expect-error — simplified mock return type for testing
        notFoundHandler: mock(() => ({ error: 'gone' })),
      },
    });

    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    await server.handleAPINotFound(request, reply);

    expect(reply.code).toHaveBeenCalledWith(404);
  });

  it('falls back to default handler when the custom not-found handler throws', async () => {
    const logError = mock((..._args: unknown[]) => {});
    const server = serveSSRBuilt('/fake/build', {
      APIHandling: {
        // simplified mock for testing
        notFoundHandler: mock(() => {
          throw new Error('handler blew up');
        }),
      },
    });

    const request = makeMockRequest({ log: { error: logError } });
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    const result = await server.handleAPINotFound(request, reply);

    expect(logError).toHaveBeenCalledTimes(1);
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(result).toBeDefined();
  });
});

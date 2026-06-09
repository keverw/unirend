import { describe, it, expect, mock } from 'bun:test';
import fastify from 'fastify';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { serveSSRWithHMR, serveSSRBuilt } from '../ssr';

/**
 * Tests for the remaining private methods on SSRServer:
 *   - registerPlugins()
 *   - handleSSRError()
 *   - generate500ErrorPage()
 *
 * Uses the same @ts-expect-error pattern as ssr-server-private.test.ts and
 * the same mock-Fastify pattern established in web-socket-server-helpers.test.ts.
 */

const FAKE_HMR_PATHS = {
  serverEntry: '/fake/EntrySSR.tsx',
  template: '/fake/index.html',
  viteConfig: '/fake/vite.config.ts',
};

// ---------------------------------------------------------------------------
// Minimal mock builders
// ---------------------------------------------------------------------------

function makeMockFastify(): FastifyInstance {
  return {
    register: mock(async (_plugin: unknown) => {}),
    addHook: mock((_name: string, _handler: unknown) => {}),
    route: mock((_config: unknown) => {}),
    log: {
      error: mock((..._args: unknown[]) => {}),
      warn: mock((..._args: unknown[]) => {}),
      info: mock((..._args: unknown[]) => {}),
    },
  } as unknown as FastifyInstance;
}

function makeMockRequest(
  overrides: Record<string, unknown> = {},
): FastifyRequest {
  return {
    method: 'GET',
    url: '/test',
    log: {
      error: mock((..._args: unknown[]) => {}),
    },
    isDevelopment: false,
    ...overrides,
  } as unknown as FastifyRequest;
}

function makeMockReply(overrides: Record<string, unknown> = {}): FastifyReply {
  const reply = {
    sent: false,
    raw: { headersSent: false },
    code: mock((_n: number) => reply),
    header: mock((_k: string, _v: string) => reply),
    ...overrides,
  };
  return reply as unknown as FastifyReply;
}

// ---------------------------------------------------------------------------
// registerPlugins()
// ---------------------------------------------------------------------------

describe('SSRServer.registerPlugins() (private)', () => {
  it('returns early when fastifyInstance is not set', async () => {
    const server = serveSSRBuilt('/fake/build');
    // fastifyInstance is null before listen() — this is the early-return path
    // @ts-expect-error — accessing private method for testing
    const result = await server.registerPlugins();
    expect(result).toBeUndefined();
  });

  it('returns early when plugins array is not provided', async () => {
    // No plugins option → sharedOptions.plugins is undefined
    const server = serveSSRBuilt('/fake/build');
    // @ts-expect-error — setting private field for testing
    server.fastifyInstance = makeMockFastify();
    // @ts-expect-error — accessing private method for testing
    const result = await server.registerPlugins();
    expect(result).toBeUndefined();
  });

  it('calls each plugin with a controlled instance and plugin options', async () => {
    const pluginFn = mock(async (_host: unknown, _opts: unknown) => {});
    const server = serveSSRBuilt('/fake/build', { plugins: [pluginFn] });
    // @ts-expect-error — setting private field for testing
    server.fastifyInstance = makeMockFastify();

    // @ts-expect-error — accessing private method for testing
    await server.registerPlugins();
    expect(pluginFn).toHaveBeenCalledTimes(1);

    const [_host, opts] = (pluginFn as ReturnType<typeof mock>).mock.calls[0];
    expect((opts as Record<string, unknown>).serverType).toBe('ssr');
  });

  it('registers multiple plugins in order', async () => {
    const order: number[] = [];
    const plugin1 = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(1);
    });
    const plugin2 = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(2);
    });
    const plugin3 = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      order.push(3);
    });

    const server = serveSSRBuilt('/fake/build', {
      plugins: [plugin1, plugin2, plugin3],
    });
    // @ts-expect-error — setting private field for testing
    server.fastifyInstance = makeMockFastify();

    // @ts-expect-error — accessing private method for testing
    await server.registerPlugins();
    expect(order).toEqual([1, 2, 3]);
  });

  it('wraps and rethrows a plugin error', async () => {
    const badPlugin = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      throw new Error('plugin exploded');
    });

    const server = serveSSRBuilt('/fake/build', { plugins: [badPlugin] });
    // @ts-expect-error — setting private field for testing
    server.fastifyInstance = makeMockFastify();

    let caughtError: unknown;
    try {
      // @ts-expect-error — accessing private method for testing
      await server.registerPlugins();
    } catch (error) {
      caughtError = error;
    }
    expect(caughtError).toBeInstanceOf(Error);
    expect((caughtError as Error).message).toMatch(
      /Plugin registration failed.*plugin exploded/i,
    );
  });

  it('uses a real fastify instance without throwing', async () => {
    const pluginFn = mock(async () => {});
    const server = serveSSRBuilt('/fake/build', { plugins: [pluginFn] });
    const realFastify = fastify();
    // @ts-expect-error — setting private field for testing
    server.fastifyInstance = realFastify;

    // @ts-expect-error — accessing private method for testing
    const result = await server.registerPlugins();
    expect(result).toBeUndefined();

    await realFastify.close();
  });
});

// ---------------------------------------------------------------------------
// handleSSRError()
// ---------------------------------------------------------------------------

describe('SSRServer.handleSSRError() (private)', () => {
  const testError = new Error('test render error');

  it('returns undefined when reply.sent is true (already sent, bail)', async () => {
    const server = serveSSRBuilt('/fake/build');
    const request = makeMockRequest();
    const reply = makeMockReply({ sent: true });

    // @ts-expect-error — accessing private method for testing
    const result = await server.handleSSRError(request, reply, testError, {});
    expect(result).toBeUndefined();
  });

  it('returns undefined when reply.raw.headersSent is true', async () => {
    const server = serveSSRBuilt('/fake/build');
    const request = makeMockRequest();
    const reply = makeMockReply({ raw: { headersSent: true } });

    // @ts-expect-error — accessing private method for testing
    const result = await server.handleSSRError(request, reply, testError, {});
    expect(result).toBeUndefined();
  });

  it('logs the error via request.log.error by default', async () => {
    const server = serveSSRBuilt('/fake/build');
    const logError = mock((..._args: unknown[]) => {});
    const request = makeMockRequest({ log: { error: logError } });
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    await server.handleSSRError(request, reply, testError, {});
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('includes requestID in log meta when present on request', async () => {
    const server = serveSSRBuilt('/fake/build');
    const logError = mock((..._args: unknown[]) => {});
    const request = makeMockRequest({
      requestID: 'req-abc-123',
      log: { error: logError },
    });
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    await server.handleSSRError(request, reply, testError, {});
    const [meta] = (logError as ReturnType<typeof mock>).mock.calls[0];
    expect((meta as Record<string, unknown>).requestID).toBe('req-abc-123');
  });

  it('calls vite.ssrFixStacktrace on a dev server when viteDevServer is present', async () => {
    const server = serveSSRWithHMR(FAKE_HMR_PATHS);
    const ssrFixStacktrace = mock((_err: Error) => {});
    const request = makeMockRequest();
    const reply = makeMockReply();
    const appConfig = {
      sourcePaths: FAKE_HMR_PATHS,
      viteDevServer: { ssrFixStacktrace },
    };

    // @ts-expect-error — accessing private method for testing
    await server.handleSSRError(request, reply, testError, appConfig);
    expect(ssrFixStacktrace).toHaveBeenCalledWith(testError);
  });

  it('does NOT call ssrFixStacktrace on a production server', async () => {
    const server = serveSSRBuilt('/fake/build');
    const ssrFixStacktrace = mock((_err: Error) => {});
    const request = makeMockRequest();
    const reply = makeMockReply();
    // Even if someone passes viteDevServer on a prod config, mode guard prevents it
    const appConfig = {
      buildDir: '/fake',
      viteDevServer: { ssrFixStacktrace },
    };

    // @ts-expect-error — accessing private method for testing
    await server.handleSSRError(request, reply, testError, appConfig);
    expect(ssrFixStacktrace).toHaveBeenCalledTimes(0);
  });

  it('sets 500 status and content-type headers on the reply', async () => {
    const server = serveSSRBuilt('/fake/build');
    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    await server.handleSSRError(request, reply, testError, {});
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(reply.code).toHaveBeenCalledWith(500);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'text/html');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('returns HTML string from the error page', async () => {
    const server = serveSSRBuilt('/fake/build');
    const request = makeMockRequest();
    const reply = makeMockReply();

    // @ts-expect-error — accessing private method for testing
    const result = await server.handleSSRError(request, reply, testError, {});
    expect(typeof result).toBe('string');
    expect(result).toContain('500');
  });
});

// ---------------------------------------------------------------------------
// generate500ErrorPage()
// ---------------------------------------------------------------------------

describe('SSRServer.generate500ErrorPage() (private)', () => {
  const testError = new Error('render boom');

  it('uses the custom get500ErrorPage handler when provided', async () => {
    const server = serveSSRBuilt('/fake/build');
    const customHandler = mock(
      (_req: unknown, _err: unknown, _isDev: boolean) => '<custom-error/>',
    );
    const request = makeMockRequest();
    const appConfig = { buildDir: '/fake', get500ErrorPage: customHandler };

    // @ts-expect-error — accessing private method for testing
    const html = await server.generate500ErrorPage(
      request,
      testError,
      appConfig,
    );
    expect(html).toBe('<custom-error/>');
    expect(customHandler).toHaveBeenCalledTimes(1);
  });

  it('falls back to the built-in page when no custom handler is set', async () => {
    const server = serveSSRBuilt('/fake/build');
    const request = makeMockRequest();

    // @ts-expect-error — accessing private method for testing
    const html = await server.generate500ErrorPage(request, testError, {});
    expect(typeof html).toBe('string');
    expect(html).toContain('500');
    expect(html).toContain('Internal Server Error');
  });

  it('passes isDevelopment=true through to the handler', async () => {
    const server = serveSSRBuilt('/fake/build');
    let isDevReceived: boolean | undefined;
    const customHandler = mock(
      (_req: unknown, _err: unknown, isDev: boolean) => {
        isDevReceived = isDev;
        return '<dev-error/>';
      },
    );
    const request = makeMockRequest({ isDevelopment: true });

    // @ts-expect-error — accessing private method for testing
    await server.generate500ErrorPage(request, testError, {
      get500ErrorPage: customHandler,
    });
    expect(isDevReceived).toBe(true);
  });

  it('falls back to the default page and logs when the custom handler throws', async () => {
    const server = serveSSRBuilt('/fake/build');
    const logError = mock((..._args: unknown[]) => {});
    const request = makeMockRequest({ log: { error: logError } });
    const throwingHandler = mock(() => {
      throw new Error('handler crashed');
    });

    // @ts-expect-error — accessing private method for testing
    const html = await server.generate500ErrorPage(request, testError, {
      get500ErrorPage: throwingHandler,
    });

    // Should still return valid HTML despite handler crash
    expect(typeof html).toBe('string');
    expect(html).toContain('500');
    // The crash should be logged
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it('includes error details in dev mode via built-in page', async () => {
    const server = serveSSRBuilt('/fake/build');
    const request = makeMockRequest({ isDevelopment: true });

    // @ts-expect-error — accessing private method for testing
    const html = await server.generate500ErrorPage(request, testError, {});
    expect(html).toContain('render boom');
  });

  it('does NOT include error details in production mode via built-in page', async () => {
    const server = serveSSRBuilt('/fake/build');
    const request = makeMockRequest({ isDevelopment: false });

    // @ts-expect-error — accessing private method for testing
    const html = await server.generate500ErrorPage(request, testError, {});
    // The error message should NOT appear in production output
    expect(html).not.toContain('render boom');
  });
});

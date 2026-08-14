/**
 * Phase 3 coverage for `request.trigger404()`: the sentinel itself, the request
 * decoration, and each of the three wrapper sites.
 *
 * The full byte-equality matrix across both servers and every not-found config
 * lives in the Phase 4 suite. These prove the plumbing at each site works.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import getPort from 'get-port';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from 'lifecycleion/tmp-dir';
import { serveAPI, servePlain } from '../api';
import { StaticWebServer } from './static-web-server';
import type { APIServer } from './api-server';
import { APIResponseHelpers } from '../../api-envelope';
import type { ControlledReply, PluginHostInstance } from '../types';
import {
  DataLoaderServerHandlerHelpers,
  type PageDataHandler,
} from './data-loader-server-handler-helpers';
import type { APIRouteHandler } from './api-routes-server-helpers';
import {
  TRIGGER_404_BRAND,
  TRIGGER_404_SIGNAL,
  closeTrigger404Scope,
  isTrigger404Signal,
  markTrigger404Requested,
  openTrigger404Scope,
  runInTrigger404Scope,
} from './trigger-404';

const OUT_OF_HANDLER_MESSAGE =
  'request.trigger404() is only available inside an API route handler or a page data handler. In a plugin route, call reply.callNotFound() instead.';

// Compile-time checks, sync and async for both handler types. The whole point
// of the feature is a handler that triggers on one branch and answers normally
// on the other, which in the async case infers a single Promise over the union
// — a return type built as one Promise per union member would reject it.
const _syncAPIHandlerTypeCheck = ((request, _reply, params) => {
  if (request.headers['x-gate'] !== 'open') {
    return request.trigger404();
  }

  return params.APIResponseHelpers.createAPISuccessResponse({
    request,
    data: { ok: true },
  });
}) satisfies APIRouteHandler;

const _asyncAPIHandlerTypeCheck = (async (request, _reply, params) => {
  const gate = await Promise.resolve(request.headers['x-gate']);

  if (gate !== 'open') {
    return request.trigger404();
  }

  return params.APIResponseHelpers.createAPISuccessResponse({
    request,
    data: { ok: true },
  });
}) satisfies APIRouteHandler;

const _syncPageDataHandlerTypeCheck = ((request, _reply, params) => {
  if (request.headers['x-gate'] !== 'open') {
    return request.trigger404();
  }

  return params.APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { ok: true },
    pageMetadata: { title: 'Thing', description: 'A thing' },
  });
}) satisfies PageDataHandler;

const _asyncPageDataHandlerTypeCheck = (async (request, _reply, params) => {
  const gate = await Promise.resolve(request.headers['x-gate']);

  if (gate !== 'open') {
    return request.trigger404();
  }

  return params.APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { ok: true },
    pageMetadata: { title: 'Thing', description: 'A thing' },
  });
}) satisfies PageDataHandler;

const pageDataBody = {
  route_params: {},
  query_params: {},
  request_path: '/thing',
  original_url: '/thing',
};

describe('trigger-404 sentinel', () => {
  it('is frozen and stable across calls', () => {
    expect(Object.isFrozen(TRIGGER_404_SIGNAL)).toBe(true);
    expect(TRIGGER_404_SIGNAL[TRIGGER_404_BRAND]).toBe(true);
  });

  it('recognizes a structurally branded clone, not just its own instance', () => {
    // The dual-bundle guard: a second copy of unirend in the tree produces its
    // own object, and Symbol.for gives both copies the same brand.
    const clone = { [Symbol.for('unirend.trigger404')]: true };

    expect(isTrigger404Signal(TRIGGER_404_SIGNAL)).toBe(true);
    expect(isTrigger404Signal(clone)).toBe(true);
  });

  it('rejects everything else a handler could return', () => {
    expect(isTrigger404Signal(undefined)).toBe(false);
    expect(isTrigger404Signal(null)).toBe(false);
    expect(isTrigger404Signal(false)).toBe(false);
    expect(isTrigger404Signal({})).toBe(false);
    expect(isTrigger404Signal({ status: 'success' })).toBe(false);
    expect(isTrigger404Signal({ [Symbol.for('unirend.trigger404')]: 1 })).toBe(
      false,
    );
  });

  it('throws when the trigger window was never opened', () => {
    expect(() => markTrigger404Requested()).toThrow(OUT_OF_HANDLER_MESSAGE);

    const scope = openTrigger404Scope();

    runInTrigger404Scope(scope, () => {
      expect(markTrigger404Requested()).toBe(TRIGGER_404_SIGNAL);
    });

    expect(scope.wasRequested).toBe(true);

    // A handler that keeps working past its own return finds the window shut.
    closeTrigger404Scope(scope);
    runInTrigger404Scope(scope, () => {
      expect(() => markTrigger404Requested()).toThrow(OUT_OF_HANDLER_MESSAGE);
    });
  });

  it('keeps interleaved invocations from seeing each other\u2019s scope', async () => {
    // The shape of an SSR render: several page data loaders in flight at once
    // on one request, each awaiting before it decides.
    const scopeA = openTrigger404Scope();
    const scopeB = openTrigger404Scope();

    let releaseA: () => void = () => {};
    const gateA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const invocationA = runInTrigger404Scope(scopeA, async () => {
      await gateA;

      return markTrigger404Requested();
    });

    // B runs to completion, and closes, entirely inside A's await.
    const invocationB = runInTrigger404Scope(scopeB, async () => {
      await Promise.resolve();

      return 'plain result';
    });

    expect(await invocationB).toBe('plain result');
    closeTrigger404Scope(scopeB);

    // A's window is still open even though B's is shut, and A's request lands
    // on A's scope rather than on B's.
    releaseA();
    expect(await invocationA).toBe(TRIGGER_404_SIGNAL);
    expect(scopeA.wasRequested).toBe(true);
    expect(scopeB.wasRequested).toBe(false);
  });
});

describe('trigger404 on APIServer', () => {
  let server: APIServer | null = null;
  let port = 0;

  beforeEach(async () => {
    port = await getPort();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  const getFastify = (instance: APIServer): FastifyInstance =>
    (instance as unknown as { fastifyInstance: FastifyInstance })
      .fastifyInstance;

  it('answers an API route the way an unregistered route answers', async () => {
    server = serveAPI({});
    server.api.get('thing', (request) => request.trigger404());
    await server.listen(port, 'localhost');

    const fastify = getFastify(server);

    const triggered = await fastify.inject({
      method: 'GET',
      url: '/api/v1/thing',
    });
    const unregistered = await fastify.inject({
      method: 'GET',
      url: '/api/v1/nope',
    });

    expect(triggered.statusCode).toBe(404);
    expect(triggered.headers['cache-control']).toBe('no-store');
    expect(triggered.headers['content-type']).toBe(
      unregistered.headers['content-type'],
    );

    const body = triggered.json<{
      status: string;
      status_code: number;
      type: string;
      error: { code: string };
    }>();
    const baseline = unregistered.json<typeof body>();

    expect(body.status).toBe(baseline.status);
    expect(body.status_code).toBe(baseline.status_code);
    expect(body.type).toBe(baseline.type);
    expect(body.error.code).toBe(baseline.error.code);
  });

  it('routes a triggered 404 through a custom notFoundHandler', async () => {
    const notFoundHandler = mock(
      (
        request: FastifyRequest,
        _isPageData: boolean | undefined,
        params: { APIResponseHelpers: typeof APIResponseHelpers },
      ) =>
        params.APIResponseHelpers.createAPIErrorResponse({
          request,
          statusCode: 404,
          errorCode: 'custom_not_found',
          errorMessage: 'Custom not found',
        }),
    );

    server = serveAPI({ notFoundHandler });
    server.api.get('thing', (request) => request.trigger404());
    await server.listen(port, 'localhost');

    const response = await getFastify(server).inject({
      method: 'GET',
      url: '/api/v1/thing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'custom_not_found',
    );
    expect(notFoundHandler).toHaveBeenCalledTimes(1);
    expect(notFoundHandler.mock.calls[0][1]).toBe(false);
    expect(notFoundHandler.mock.calls[0][2]).toEqual({
      APIResponseHelpers,
    });
  });

  it('answers a page data handler the way an unregistered page type answers', async () => {
    server = serveAPI({});
    server.pageDataHandler.register('thing', (request) => request.trigger404());
    await server.listen(port, 'localhost');

    const fastify = getFastify(server);

    const triggered = await fastify.inject({
      method: 'POST',
      url: '/api/v1/page_data/thing',
      payload: pageDataBody,
    });
    const unregistered = await fastify.inject({
      method: 'POST',
      url: '/api/v1/page_data/nope',
      payload: pageDataBody,
    });

    expect(triggered.statusCode).toBe(404);
    expect(triggered.headers['cache-control']).toBe('no-store');

    const body = triggered.json<{
      type: string;
      error: { code: string };
      meta: { page: { title: string } };
    }>();
    const baseline = unregistered.json<typeof body>();

    // The page branch, not the API one — proof the shared path carried
    // isPageData through.
    expect(body.type).toBe('page');
    expect(body.type).toBe(baseline.type);
    expect(body.error.code).toBe(baseline.error.code);
    expect(body.meta.page.title).toBe(baseline.meta.page.title);
  });

  it('gates a sync handler, triggering on one branch and answering on the other', async () => {
    server = serveAPI({});
    server.api.get('thing', (request, _reply, params) => {
      if (request.headers['x-gate'] !== 'open') {
        return request.trigger404();
      }

      return params.APIResponseHelpers.createAPISuccessResponse({
        request,
        data: { ok: true },
      });
    });
    await server.listen(port, 'localhost');

    const fastify = getFastify(server);

    const gated = await fastify.inject({
      method: 'GET',
      url: '/api/v1/thing',
    });
    const allowed = await fastify.inject({
      method: 'GET',
      url: '/api/v1/thing',
      headers: { 'x-gate': 'open' },
    });

    expect(gated.statusCode).toBe(404);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<{ data: { ok: boolean } }>().data.ok).toBe(true);
  });

  it('gates an async handler that awaits before deciding', async () => {
    server = serveAPI({});
    server.api.get('thing', async (request, _reply, params) => {
      const gate = await Promise.resolve(request.headers['x-gate']);

      if (gate !== 'open') {
        return request.trigger404();
      }

      return params.APIResponseHelpers.createAPISuccessResponse({
        request,
        data: { ok: true },
      });
    });
    await server.listen(port, 'localhost');

    const fastify = getFastify(server);

    // Both in flight at once: the per-request flag must not leak between them.
    const [gated, allowed] = await Promise.all([
      fastify.inject({ method: 'GET', url: '/api/v1/thing' }),
      fastify.inject({
        method: 'GET',
        url: '/api/v1/thing',
        headers: { 'x-gate': 'open' },
      }),
    ]);

    expect(gated.statusCode).toBe(404);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<{ data: { ok: boolean } }>().data.ok).toBe(true);
  });

  it('gates an async page data handler that awaits before deciding', async () => {
    server = serveAPI({});
    server.pageDataHandler.register(
      'thing',
      async (request, _reply, params) => {
        const gate = await Promise.resolve(request.headers['x-gate']);

        if (gate !== 'open') {
          return request.trigger404();
        }

        return params.APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { ok: true },
          pageMetadata: { title: 'Thing', description: 'A thing' },
        });
      },
    );
    await server.listen(port, 'localhost');

    const fastify = getFastify(server);

    const [gated, allowed] = await Promise.all([
      fastify.inject({
        method: 'POST',
        url: '/api/v1/page_data/thing',
        payload: pageDataBody,
      }),
      fastify.inject({
        method: 'POST',
        url: '/api/v1/page_data/thing',
        payload: pageDataBody,
        headers: { 'x-gate': 'open' },
      }),
    ]);

    expect(gated.statusCode).toBe(404);
    expect(gated.json<{ error: { code: string } }>().error.code).toBe(
      'not_found',
    );
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json<{ data: { ok: boolean } }>().data.ok).toBe(true);
  });

  it('serves the 404 anyway when the handler forgot to return the signal', async () => {
    server = serveAPI({});
    server.api.get('thing', (request, _reply, params) => {
      request.trigger404();

      return params.APIResponseHelpers.createAPISuccessResponse({
        request,
        data: { secret: 'must not ship' },
      });
    });
    await server.listen(port, 'localhost');

    const response = await getFastify(server).inject({
      method: 'GET',
      url: '/api/v1/thing',
    });

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('must not ship');
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'not_found',
    );
  });

  it('leaves an already-sent response alone', async () => {
    server = serveAPI({});
    server.api.get('thing', async (request, reply) => {
      await reply._sendErrorEnvelope(
        418,
        APIResponseHelpers.createAPIErrorResponse({
          request,
          statusCode: 418,
          errorCode: 'already_sent',
          errorMessage: 'Already sent',
        }),
      );

      return request.trigger404();
    });
    await server.listen(port, 'localhost');

    const response = await getFastify(server).inject({
      method: 'GET',
      url: '/api/v1/thing',
    });

    expect(response.statusCode).toBe(418);
    expect(response.json<{ error: { code: string } }>().error.code).toBe(
      'already_sent',
    );
  });

  it('throws with the documented message outside a handler', async () => {
    server = serveAPI({
      plugins: [
        (pluginHost: PluginHostInstance<'api'>) => {
          pluginHost.get('/probe', (request: FastifyRequest) => {
            try {
              request.trigger404();

              return { threw: false, message: '' };
            } catch (error) {
              return { threw: true, message: (error as Error).message };
            }
          });
        },
      ],
    });
    await server.listen(port, 'localhost');

    const response = await getFastify(server).inject({
      method: 'GET',
      url: '/probe',
    });

    expect(response.json<{ threw: boolean; message: string }>()).toEqual({
      threw: true,
      message: OUT_OF_HANDLER_MESSAGE,
    });
  });
});

describe('trigger404 on the plain web servers', () => {
  // StaticWebServer and RedirectServer are both APIServer in plain web mode,
  // and the decoration is installed unconditionally, so the method is present
  // on their requests too. They run no envelope handlers, so it always throws —
  // the point of these tests is that it is the documented error rather than a
  // TypeError on a missing property. RedirectServer accepts no user plugins at
  // all, so no user code can reach it there.
  const probeRoute = (pluginHost: PluginHostInstance<'plain'>) => {
    pluginHost.get('/probe', (request: FastifyRequest) => {
      const kind = typeof request.trigger404;

      try {
        request.trigger404();

        return { kind, threw: false, message: '' };
      } catch (error) {
        return { kind, threw: true, message: (error as Error).message };
      }
    });
  };

  it('throws the documented error on a plain web server', async () => {
    const port = await getPort();
    const server = servePlain({ plugins: [probeRoute] });

    try {
      await server.listen(port, 'localhost');

      const fastify = (
        server as unknown as { fastifyInstance: FastifyInstance }
      ).fastifyInstance;
      const response = await fastify.inject({ method: 'GET', url: '/probe' });

      expect(
        response.json<{ kind: string; threw: boolean; message: string }>(),
      ).toEqual({
        kind: 'function',
        threw: true,
        message: OUT_OF_HANDLER_MESSAGE,
      });
    } finally {
      await server.stop();
    }
  });

  it('throws the documented error on a StaticWebServer', async () => {
    const port = await getPort();
    const tmpDir = await createTempDir({
      prefix: 'unirend-trigger-404-static-',
      unsafeCleanup: true,
    });

    await writeFile(
      join(tmpDir.path, 'page-map.json'),
      JSON.stringify({ '/': 'index.html' }),
    );
    await writeFile(join(tmpDir.path, 'index.html'), '<html></html>');

    const server = new StaticWebServer({
      buildDir: tmpDir.path,
      plugins: [probeRoute],
    });

    try {
      await server.listen(port, 'localhost');

      const fastify = (
        server as unknown as { server: { fastifyInstance: FastifyInstance } }
      ).server.fastifyInstance;
      const response = await fastify.inject({ method: 'GET', url: '/probe' });

      expect(
        response.json<{ kind: string; threw: boolean; message: string }>(),
      ).toEqual({
        kind: 'function',
        threw: true,
        message: OUT_OF_HANDLER_MESSAGE,
      });
    } finally {
      await server.stop();
      await tmpDir.cleanup();
    }
  });
});

describe('trigger404 on the internal short-circuit path', () => {
  // callHandler() is the third wrapper site. It has no reply of its own, so it
  // resolves the envelope and hands it back rather than sending anything.
  const createMockRequest = () => {
    const request = {
      requestID: 'test-req-trigger',
      // The page route, not the page-data endpoint — the classification has to
      // be forced for this path or the resolver would build an API envelope.
      url: '/thing',
      log: { error: mock(() => {}) },
      // Stands in for the decoration both servers install.
      trigger404: markTrigger404Requested,
    };

    return request as unknown as FastifyRequest;
  };

  const controlledReply = {
    sent: false,
    header: () => {},
    getHeader: () => undefined,
    getHeaders: () => ({}),
    removeHeader: () => {},
    hasHeader: () => false,
    raw: { destroyed: false },
    _sendErrorEnvelope: async () => {},
  } as unknown as ControlledReply;

  const callWith = async (handlers: DataLoaderServerHandlerHelpers) => {
    return handlers.callHandler({
      originalRequest: createMockRequest(),
      controlledReply,
      pageType: 'thing',
      routeParams: {},
      queryParams: {},
      requestPath: '/thing',
      originalURL: '/thing',
    });
  };

  it('returns the page not-found envelope instead of the handler result', async () => {
    const handlers = new DataLoaderServerHandlerHelpers();
    handlers.setNotFoundResolution({
      serverLabel: 'test',
      HelpersClass: APIResponseHelpers,
      apiPrefix: '/api',
      pageDataEndpoint: 'page_data',
    });
    handlers.pageDataHandlerMethod.register('thing', (request) =>
      request.trigger404(),
    );

    const outcome = await callWith(handlers);

    expect(outcome.exists).toBe(true);

    const envelope = outcome.result as {
      status: string;
      status_code: number;
      type: string;
      error: { code: string };
    };

    expect(envelope.type).toBe('page');
    expect(envelope.status).toBe('error');
    expect(envelope.status_code).toBe(404);
    expect(envelope.error.code).toBe('not_found');
  });

  it('keeps parallel page data loaders on one request isolated', async () => {
    // The regression: React Router runs its loaders in parallel during an SSR
    // render, so these two callHandler() invocations share one FastifyRequest
    // and interleave. Request-wide trigger state made the finished invocation
    // shut the window on the one still awaiting.
    const handlers = new DataLoaderServerHandlerHelpers();
    handlers.setNotFoundResolution({
      serverLabel: 'test',
      HelpersClass: APIResponseHelpers,
      apiPrefix: '/api',
      pageDataEndpoint: 'page_data',
    });

    let releaseGated: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGated = resolve;
    });

    handlers.pageDataHandlerMethod.register('gated', async (request) => {
      // Still awaiting while the other loader runs to completion.
      await gate;

      return request.trigger404();
    });

    handlers.pageDataHandlerMethod.register(
      'plain',
      (request, _reply, params) =>
        params.APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { ok: true },
          pageMetadata: { title: 'Plain', description: 'A plain page' },
        }),
    );

    // One request, both loaders — exactly what an SSR render does.
    const sharedRequest = createMockRequest();

    const call = (pageType: string) =>
      handlers.callHandler({
        originalRequest: sharedRequest,
        controlledReply,
        pageType,
        routeParams: {},
        queryParams: {},
        requestPath: '/thing',
        originalURL: '/thing',
      });

    const gatedCall = call('gated');
    const plainOutcome = await call('plain');

    // The plain loader finished and closed its own scope first.
    expect(
      (plainOutcome.result as { status: string; data: { ok: boolean } }).status,
    ).toBe('success');

    releaseGated();

    const gatedOutcome = await gatedCall;
    const envelope = gatedOutcome.result as {
      status_code: number;
      error: { code: string };
    };

    expect(envelope.status_code).toBe(404);
    expect(envelope.error.code).toBe('not_found');
  });

  it('routes through the configured notFoundHandler', async () => {
    const handlers = new DataLoaderServerHandlerHelpers();
    handlers.setNotFoundResolution({
      handler: (request, isPageData, params) =>
        params.APIResponseHelpers.createPageErrorResponse({
          request,
          statusCode: 404,
          errorCode: isPageData ? 'custom_page_not_found' : 'custom_not_found',
          errorMessage: 'Custom not found',
          pageMetadata: {
            title: 'Nope',
            description: 'The requested page could not be found',
          },
        }),
      serverLabel: 'test',
      HelpersClass: APIResponseHelpers,
      apiPrefix: '/api',
      pageDataEndpoint: 'page_data',
    });
    handlers.pageDataHandlerMethod.register('thing', (request) =>
      request.trigger404(),
    );

    const outcome = await callWith(handlers);
    const envelope = outcome.result as { error: { code: string } };

    // The isPageData branch was reached, so the internal path classifies the
    // same way the HTTP fallback for this page type would.
    expect(envelope.error.code).toBe('custom_page_not_found');
  });
});

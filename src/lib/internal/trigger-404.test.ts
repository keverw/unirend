/**
 * `request.trigger404()` on `APIServer`: the sentinel itself, the request
 * decoration, each of the three wrapper sites, and the byte-equality matrix
 * across every not-found configuration an API server can be built with.
 *
 * The `SSRServer` half of the matrix, which needs a real production build to
 * run against, lives in trigger-404-ssr.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import getPort from 'get-port';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from 'lifecycleion/tmp-dir';
import { overrideDevMode } from 'lifecycleion/dev-mode';
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
  API_HELPERS_MARKER,
  MarkerHelpers,
  PAGE_HELPERS_MARKER,
  assertIndistinguishable,
  captureResponse,
  createCapturingLogging,
  findLogRecord,
  pageDataBody,
  pinnedRequestID,
  type CapturedResponse,
} from './trigger-404-equality-harness';
import {
  TRIGGER_404_BRAND,
  checkTrigger404,
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

// A handler whose entire body is the trigger returns no envelope at all, which
// is the shape the feature is for and the one the widened return unions have to
// accept on their own.
const _sentinelOnlyAPIHandlerTypeCheck = ((request) =>
  request.trigger404()) satisfies APIRouteHandler;

const _sentinelOnlyPageDataHandlerTypeCheck = ((request) =>
  request.trigger404()) satisfies PageDataHandler;

const _asyncSentinelOnlyAPIHandlerTypeCheck = (async (request) => {
  await Promise.resolve();

  return request.trigger404();
}) satisfies APIRouteHandler;

// The negative: calling the trigger and discarding it leaves the handler
// returning nothing, and `undefined` is not a member of either return union.
// Without this the widening could quietly accept a handler that never returns.
const _discardedAPITriggerTypeCheck = ((request) => {
  request.trigger404();
  // @ts-expect-error A discarded trigger404() leaves the handler returning void.
}) satisfies APIRouteHandler;

const _discardedPageDataTriggerTypeCheck = ((request) => {
  request.trigger404();
  // @ts-expect-error A discarded trigger404() leaves the handler returning void.
}) satisfies PageDataHandler;

// The widening admits exactly one new value, the branded sentinel — not
// "anything 404-shaped". A hand-rolled 404 object is still rejected, which is
// the point: the only way to reach the not-found path is the trigger, so the
// response cannot be something the handler assembled itself.
const _handRolled404TypeCheck =
  // @ts-expect-error A 404-shaped object is not the sentinel and not an envelope.
  (() => ({
    status_code: 404,
    status: 'error',
    error: { code: 'not_found', message: 'Resource Not Found' },
  })) satisfies APIRouteHandler;

const _arbitraryValueTypeCheck =
  // @ts-expect-error The union gained the sentinel, not unknown.
  (() => ({ anything: 'at all' })) satisfies APIRouteHandler;

const _bareSymbolTypeCheck =
  // @ts-expect-error The brand is a property on the value, not the value itself.
  (() => Symbol.for('unirend.trigger404')) satisfies APIRouteHandler;

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

  it('throws trigger_404_unconfigured when the registry has no resolution', async () => {
    // A framework invariant, not a user path: both servers install the
    // resolution on both registries before any route is registered. Reached
    // directly here because nothing a user can write gets to it.
    const scope = openTrigger404Scope();

    runInTrigger404Scope(scope, () => markTrigger404Requested());

    const request = {
      log: { error: mock(() => {}) },
    } as unknown as FastifyRequest;

    let caught: unknown;

    try {
      await checkTrigger404({
        request,
        scope,
        isResponseSent: false,
        resolution: undefined,
        handlerResult: TRIGGER_404_SIGNAL,
        route: 'GET /api/v1/thing',
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toBe(
      'request.trigger404() was called for GET /api/v1/thing but no not-found resolution was configured on this registry.',
    );
    expect((caught as { errorCode?: string }).errorCode).toBe(
      'trigger_404_unconfigured',
    );
    expect((caught as { route?: string }).route).toBe('GET /api/v1/thing');
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

/**
 * Phase 4: the byte-equality matrix on `APIServer`.
 *
 * Every cell runs the same request against two servers built from the same
 * options: one with the route registered to a handler whose entire body is
 * `return request.trigger404()`, one where the route was never registered at
 * all. The two responses have to be indistinguishable down to the raw bytes.
 *
 * Drift guard: the custom-handler cells below are what keeps
 * `resolveAPINotFoundResponse` and `trigger404()` from growing separate 404
 * behavior. A distinctive envelope configured on the server has to appear on
 * the triggered response, which is only true while both paths call the same
 * resolver. See the note above `resolveAPINotFoundResponse` in server-utils.ts.
 */
describe('trigger404 byte-equality matrix on APIServer', () => {
  const fastifyOf = (server: unknown): FastifyInstance =>
    (server as { fastifyInstance: FastifyInstance }).fastifyInstance;

  interface ServerUnderTest {
    listen(port: number, host: string): Promise<void>;
    stop(): Promise<void>;
  }

  interface Injection {
    method: 'GET' | 'POST';
    url: string;
    payload?: Record<string, unknown>;
    headers?: Record<string, string>;
  }

  const apiRouteInjection: Injection = {
    method: 'GET',
    url: '/api/v1/thing',
  };

  const pageDataInjection: Injection = {
    method: 'POST',
    url: '/api/v1/page_data/thing',
    payload: pageDataBody,
  };

  const registerTriggeringAPIRoute = (server: APIServer) => {
    server.api.get('thing', (request) => request.trigger404());
  };

  const registerTriggeringPageDataHandler = (server: APIServer) => {
    server.pageDataHandler.register('thing', (request) => request.trigger404());
  };

  /**
   * Builds the two servers from one factory, injects the same request into
   * both, and hands back what a caller would have seen from each.
   */
  const runCell = async <S extends ServerUnderTest>(
    createServer: () => S,
    register: (server: S) => void,
    injection: Injection,
  ): Promise<{
    triggered: CapturedResponse;
    unregistered: CapturedResponse;
  }> => {
    const registered = createServer();
    register(registered);

    const bare = createServer();

    await registered.listen(await getPort(), 'localhost');
    await bare.listen(await getPort(), 'localhost');

    try {
      return {
        triggered: captureResponse(
          await fastifyOf(registered).inject(injection),
        ),
        unregistered: captureResponse(await fastifyOf(bare).inject(injection)),
      };
    } finally {
      await registered.stop();
      await bare.stop();
    }
  };

  /** The custom not-found handler used by the function-form and split cells. */
  const createNotFoundSpy = () =>
    mock(
      (
        request: FastifyRequest,
        isPageData: boolean | undefined,
        params: { APIResponseHelpers: typeof APIResponseHelpers },
      ) =>
        isPageData
          ? params.APIResponseHelpers.createPageErrorResponse({
              request,
              statusCode: 404,
              errorCode: 'custom_not_found',
              errorMessage: 'Custom not found',
              pageMetadata: {
                title: 'Custom Not Found',
                description: 'Custom not-found copy',
              },
            })
          : params.APIResponseHelpers.createAPIErrorResponse({
              request,
              statusCode: 404,
              errorCode: 'custom_not_found',
              errorMessage: 'Custom not found',
            }),
    );

  /**
   * The handler ran on the triggered server rather than its output being
   * reproduced somewhere else. `spies[0]` is the registered server, built first.
   */
  const expectHandlerSpyArgs = (
    spy: ReturnType<typeof createNotFoundSpy>,
    expected: {
      url: string;
      isPageData: boolean;
      HelpersClass: typeof APIResponseHelpers;
    },
  ) => {
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0].url).toBe(expected.url);
    expect(spy.mock.calls[0][1]).toBe(expected.isPageData);
    expect(spy.mock.calls[0][2]).toEqual({
      APIResponseHelpers: expected.HelpersClass,
    });
  };

  describe('API route', () => {
    it('matches the unregistered route with the default not-found response', async () => {
      const { triggered, unregistered } = await runCell(
        () => serveAPI({ getRequestID: pinnedRequestID }),
        registerTriggeringAPIRoute,
        apiRouteInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'api',
        errorCode: 'not_found',
      });
    });

    it('matches with a function-form notFoundHandler', async () => {
      const spies: Array<ReturnType<typeof createNotFoundSpy>> = [];

      const { triggered, unregistered } = await runCell(
        () => {
          const notFoundHandler = createNotFoundSpy();
          spies.push(notFoundHandler);

          return serveAPI({ getRequestID: pinnedRequestID, notFoundHandler });
        },
        registerTriggeringAPIRoute,
        apiRouteInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'api',
        errorCode: 'custom_not_found',
      });
      expectHandlerSpyArgs(spies[0], {
        url: '/api/v1/thing',
        isPageData: false,
        HelpersClass: APIResponseHelpers,
      });
    });

    it('matches with a split notFoundHandler carrying an api entry', async () => {
      const spies: Array<ReturnType<typeof createNotFoundSpy>> = [];

      const { triggered, unregistered } = await runCell(
        () => {
          const api = createNotFoundSpy();
          spies.push(api);

          return serveAPI({
            getRequestID: pinnedRequestID,
            notFoundHandler: { api },
          });
        },
        registerTriggeringAPIRoute,
        apiRouteInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'api',
        errorCode: 'custom_not_found',
      });
      expectHandlerSpyArgs(spies[0], {
        url: '/api/v1/thing',
        isPageData: false,
        HelpersClass: APIResponseHelpers,
      });
    });

    it('matches on the fallback path when the notFoundHandler throws', async () => {
      const { triggered, unregistered } = await runCell(
        () =>
          serveAPI({
            getRequestID: pinnedRequestID,
            notFoundHandler: () => {
              throw new Error('not-found handler boom');
            },
          }),
        registerTriggeringAPIRoute,
        apiRouteInjection,
      );

      // Both sides fall through to the default envelope, and neither leaks the
      // handler failure to the caller.
      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'api',
        errorCode: 'not_found',
      });
      expect(triggered.body).not.toContain('boom');
    });

    it('matches with a custom APIResponseHelpers class', async () => {
      const { triggered, unregistered } = await runCell(
        () =>
          serveAPI({
            getRequestID: pinnedRequestID,
            APIResponseHelpersClass: MarkerHelpers,
          }),
        registerTriggeringAPIRoute,
        apiRouteInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'api',
        errorCode: 'not_found',
        helpersMarker: API_HELPERS_MARKER,
      });
    });

    it('hands the custom helpers class to a custom notFoundHandler', async () => {
      const spies: Array<ReturnType<typeof createNotFoundSpy>> = [];

      const { triggered, unregistered } = await runCell(
        () => {
          const notFoundHandler = createNotFoundSpy();
          spies.push(notFoundHandler);

          return serveAPI({
            getRequestID: pinnedRequestID,
            APIResponseHelpersClass: MarkerHelpers,
            notFoundHandler,
          });
        },
        registerTriggeringAPIRoute,
        apiRouteInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'api',
        errorCode: 'custom_not_found',
        helpersMarker: API_HELPERS_MARKER,
      });
      expectHandlerSpyArgs(spies[0], {
        url: '/api/v1/thing',
        isPageData: false,
        HelpersClass: MarkerHelpers,
      });
    });
  });

  describe('page data', () => {
    it('matches the unregistered page type with the default not-found response', async () => {
      const { triggered, unregistered } = await runCell(
        () => serveAPI({ getRequestID: pinnedRequestID }),
        registerTriggeringPageDataHandler,
        pageDataInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'page',
        errorCode: 'not_found',
      });
    });

    it('matches with a function-form notFoundHandler', async () => {
      const spies: Array<ReturnType<typeof createNotFoundSpy>> = [];

      const { triggered, unregistered } = await runCell(
        () => {
          const notFoundHandler = createNotFoundSpy();
          spies.push(notFoundHandler);

          return serveAPI({ getRequestID: pinnedRequestID, notFoundHandler });
        },
        registerTriggeringPageDataHandler,
        pageDataInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'page',
        errorCode: 'custom_not_found',
      });
      // isPageData true is what proves the page branch was reached through the
      // shared path rather than the API one.
      expectHandlerSpyArgs(spies[0], {
        url: '/api/v1/page_data/thing',
        isPageData: true,
        HelpersClass: APIResponseHelpers,
      });
    });

    it('matches with a split notFoundHandler carrying an api entry', async () => {
      const spies: Array<ReturnType<typeof createNotFoundSpy>> = [];

      const { triggered, unregistered } = await runCell(
        () => {
          const api = createNotFoundSpy();
          spies.push(api);

          return serveAPI({
            getRequestID: pinnedRequestID,
            notFoundHandler: { api },
          });
        },
        registerTriggeringPageDataHandler,
        pageDataInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'page',
        errorCode: 'custom_not_found',
      });
      expectHandlerSpyArgs(spies[0], {
        url: '/api/v1/page_data/thing',
        isPageData: true,
        HelpersClass: APIResponseHelpers,
      });
    });

    it('matches on the fallback path when the notFoundHandler throws', async () => {
      const { triggered, unregistered } = await runCell(
        () =>
          serveAPI({
            getRequestID: pinnedRequestID,
            notFoundHandler: () => {
              throw new Error('not-found handler boom');
            },
          }),
        registerTriggeringPageDataHandler,
        pageDataInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'page',
        errorCode: 'not_found',
      });
      expect(triggered.body).not.toContain('boom');
    });

    it('matches with a custom APIResponseHelpers class', async () => {
      const { triggered, unregistered } = await runCell(
        () =>
          serveAPI({
            getRequestID: pinnedRequestID,
            APIResponseHelpersClass: MarkerHelpers,
          }),
        registerTriggeringPageDataHandler,
        pageDataInjection,
      );

      // The page marker, not the API one: the isPageData branch of the custom
      // class was the one that built this envelope.
      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'page',
        errorCode: 'not_found',
        helpersMarker: PAGE_HELPERS_MARKER,
      });
    });

    it('hands the custom helpers class to a custom notFoundHandler', async () => {
      const spies: Array<ReturnType<typeof createNotFoundSpy>> = [];

      const { triggered, unregistered } = await runCell(
        () => {
          const notFoundHandler = createNotFoundSpy();
          spies.push(notFoundHandler);

          return serveAPI({
            getRequestID: pinnedRequestID,
            APIResponseHelpersClass: MarkerHelpers,
            notFoundHandler,
          });
        },
        registerTriggeringPageDataHandler,
        pageDataInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'page',
        errorCode: 'custom_not_found',
        helpersMarker: PAGE_HELPERS_MARKER,
      });
      expectHandlerSpyArgs(spies[0], {
        url: '/api/v1/page_data/thing',
        isPageData: true,
        HelpersClass: MarkerHelpers,
      });
    });
  });

  describe('handler bugs and concurrency', () => {
    /**
     * The forgotten-`return` and already-sent paths are only fully observable
     * in the log, so these assert the records rather than the response alone.
     */
    const runWithCapturedLog = async (
      register: (server: APIServer) => void,
      injection: Injection,
    ) => {
      const captured = createCapturingLogging();
      const server = serveAPI({
        getRequestID: pinnedRequestID,
        logging: captured.logging,
      });

      register(server);
      await server.listen(await getPort(), 'localhost');

      try {
        return {
          response: captureResponse(await fastifyOf(server).inject(injection)),
          records: captured.records,
        };
      } finally {
        await server.stop();
      }
    };

    /** The same request against a server that never registered the route. */
    const baselineFor = async (injection: Injection) => {
      const server = serveAPI({ getRequestID: pinnedRequestID });
      await server.listen(await getPort(), 'localhost');

      try {
        return captureResponse(await fastifyOf(server).inject(injection));
      } finally {
        await server.stop();
      }
    };

    /** Calls the trigger, ignores it, and answers with data it meant to withhold. */
    const registerForgetfulHandler = (server: APIServer) => {
      server.api.get('thing', (request, _reply, params) => {
        request.trigger404();

        return params.APIResponseHelpers.createAPISuccessResponse({
          request,
          data: { secret: 'must not ship' },
        });
      });
    };

    it('serves the byte-identical 404 and logs trigger_404_missing_return', async () => {
      const { response, records } = await runWithCapturedLog(
        registerForgetfulHandler,
        apiRouteInjection,
      );

      // Fails closed: identical to a genuine miss, so dev and prod cannot be
      // told apart either.
      assertIndistinguishable(
        expect,
        response,
        await baselineFor(apiRouteInjection),
        { statusCode: 404, type: 'api', errorCode: 'not_found' },
      );
      expect(response.body).not.toContain('must not ship');

      const [missingReturn, ...extra] = findLogRecord(
        records,
        'trigger_404_missing_return',
      );

      expect(extra).toEqual([]);
      expect(missingReturn.level).toBe('error');
      expect(missingReturn.message).toContain('/api/v1/thing');
      expect(missingReturn.message).toContain('return request.trigger404();');
      expect(missingReturn.context?.route).toBe('GET /api/v1/thing');
    });

    it('serves the 404 when the handler triggers and returns nothing at all', async () => {
      // TypeScript rejects this shape (the @ts-expect-error checks at the top
      // of this file), but a JavaScript consumer can still write it, so the
      // runtime has to fail closed rather than send an empty body.
      const { response, records } = await runWithCapturedLog((server) => {
        server.api.get('thing', ((request: FastifyRequest) => {
          request.trigger404();
        }) as unknown as APIRouteHandler);
      }, apiRouteInjection);

      assertIndistinguishable(
        expect,
        response,
        await baselineFor(apiRouteInjection),
        { statusCode: 404, type: 'api', errorCode: 'not_found' },
      );
      expect(findLogRecord(records, 'trigger_404_missing_return')).toHaveLength(
        1,
      );
    });

    it('prefers the 404 over the false-without-sending error when both apply', async () => {
      // Two handler-bug detectors overlap here: the handler triggered without
      // returning the signal, and it returned `false` claiming to have sent a
      // response it never sent. The trigger check runs first by design, so the
      // request fails closed into the 404 instead of erroring into a 500 — the
      // withheld data is the thing worth protecting, and a 500 would be
      // distinguishable from a genuine miss besides.
      const { response, records } = await runWithCapturedLog((server) => {
        server.api.get('thing', (request) => {
          request.trigger404();

          return false;
        });
      }, apiRouteInjection);

      assertIndistinguishable(
        expect,
        response,
        await baselineFor(apiRouteInjection),
        { statusCode: 404, type: 'api', errorCode: 'not_found' },
      );
      expect(findLogRecord(records, 'trigger_404_missing_return')).toHaveLength(
        1,
      );
      expect(findLogRecord(records, 'trigger_404_after_response_sent')).toEqual(
        [],
      );
      expect(response.body).not.toContain('did not send a response');
    });

    it('keeps the discarded return value out of the log in production', async () => {
      // The discarded value is arbitrary application data, and on this path it
      // is specifically the data the 404 exists to withhold — so it must not
      // reach a log sink in production, where these records are routinely
      // forwarded to third parties. The type name always ships, which together
      // with the route is what identifies the offending handler.
      overrideDevMode(false);

      const { records } = await runWithCapturedLog(
        registerForgetfulHandler,
        apiRouteInjection,
      );
      const [missingReturn] = findLogRecord(
        records,
        'trigger_404_missing_return',
      );

      expect(missingReturn.context?.handlerResponseType).toBe('object');
      expect(missingReturn.context).not.toHaveProperty('handlerResponse');

      // Belt and braces: the secret must not appear anywhere in any record.
      expect(JSON.stringify(records)).not.toContain('must not ship');
    });

    it('includes the discarded return value in the log in development', async () => {
      overrideDevMode(true);

      try {
        const { records } = await runWithCapturedLog(
          registerForgetfulHandler,
          apiRouteInjection,
        );
        const [missingReturn] = findLogRecord(
          records,
          'trigger_404_missing_return',
        );

        expect(missingReturn.context?.handlerResponseType).toBe('object');
        expect(
          (missingReturn.context?.handlerResponse as { data: unknown }).data,
        ).toEqual({ secret: 'must not ship' });
      } finally {
        // Every other test in the process expects production mode.
        overrideDevMode(false);
      }
    });

    it('leaves an already-sent response alone and logs trigger_404_after_response_sent', async () => {
      const { response, records } = await runWithCapturedLog((server) => {
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
      }, apiRouteInjection);

      // The sent response stands, and nothing tried to send a second time.
      expect(response.statusCode).toBe(418);
      expect(
        (JSON.parse(response.body) as { error: { code: string } }).error.code,
      ).toBe('already_sent');

      const [afterSent, ...extra] = findLogRecord(
        records,
        'trigger_404_after_response_sent',
      );

      expect(extra).toEqual([]);
      expect(afterSent.level).toBe('error');
      expect(afterSent.message).toContain('/api/v1/thing');
      expect(afterSent.context?.route).toBe('GET /api/v1/thing');
    });

    it('honors a returned signal that never went through trigger404()', async () => {
      // The mirror image of the forgotten `return`: the signal comes back but
      // the trigger was never called. This is the dual-bundle case — a second
      // copy of unirend in the tree marks its own scope, and only the returned
      // brand reaches this one — so the 404 is served on the return value alone
      // and nothing is logged as a bug. A handler that hand-builds the brand
      // gets the same 404 it asked for, which is the only thing returning the
      // sentinel ever means.
      const { response, records } = await runWithCapturedLog((server) => {
        server.api.get('thing', () => TRIGGER_404_SIGNAL);
      }, apiRouteInjection);

      assertIndistinguishable(
        expect,
        response,
        await baselineFor(apiRouteInjection),
        { statusCode: 404, type: 'api', errorCode: 'not_found' },
      );
      expect(findLogRecord(records, 'trigger_404_missing_return')).toEqual([]);
      expect(findLogRecord(records, 'trigger_404_after_response_sent')).toEqual(
        [],
      );
    });

    it('does not mistake an unbranded 404-shaped return for the sentinel', async () => {
      // The runtime half of the type-level negatives above. Recognition is on
      // the brand, never on the shape, so an object that merely looks like a
      // 404 is not a trigger — it is just an invalid envelope, and it fails the
      // way any invalid envelope fails rather than quietly serving a 404.
      const { response, records } = await runWithCapturedLog((server) => {
        server.api.get(
          'thing',
          () =>
            ({
              status: 'error',
              status_code: 404,
              error: { code: 'not_found', message: 'Resource Not Found' },
            }) as unknown as ReturnType<APIRouteHandler>,
        );
      }, apiRouteInjection);

      expect(response.statusCode).toBe(500);
      expect(findLogRecord(records, 'trigger_404_missing_return')).toEqual([]);
    });

    it('leaves a hand-built 404 envelope on the ordinary path, unremarked', async () => {
      // A handler that builds its own 404 stays entirely valid. trigger404() is
      // an addition, not a replacement: this response never enters the trigger
      // path at all, so nothing intercepts it, nothing warns, and nothing is
      // logged. What it does not get is byte-equality with a genuine miss, and
      // closing that gap is the only reason trigger404() exists.
      const { response, records } = await runWithCapturedLog((server) => {
        server.api.get('thing', (request, _reply, params) =>
          params.APIResponseHelpers.createAPIErrorResponse({
            request,
            statusCode: 404,
            errorCode: 'hand_built_not_found',
            errorMessage: 'Hand-built 404',
          }),
        );
      }, apiRouteInjection);

      expect(response.statusCode).toBe(404);
      expect(
        (JSON.parse(response.body) as { error: { code: string } }).error.code,
      ).toBe('hand_built_not_found');

      // Ships as written, so it is distinguishable from a genuine miss.
      expect(response.body).not.toBe(
        (await baselineFor(apiRouteInjection)).body,
      );

      // No warning, no deprecation, nothing from the trigger machinery at all.
      // (The access log's own 4xx line is still there, as it is for any 404.)
      expect(
        records.filter((entry) => {
          const errorCode = entry.context?.errorCode;

          return (
            typeof errorCode === 'string' && errorCode.startsWith('trigger_404')
          );
        }),
      ).toEqual([]);
      expect(records.filter((entry) => entry.level === 'error')).toEqual([]);
    });

    it('keeps two concurrent requests isolated while both sit inside the handler', async () => {
      // Both requests are held inside the handler at the same time on a shared
      // deferred, so trigger state that lived on anything wider than the
      // invocation would leak from one to the other.
      let releaseGate: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        releaseGate = resolve;
      });
      let arrived = 0;

      const server = serveAPI({ getRequestID: pinnedRequestID });

      server.api.get('thing', async (request, _reply, params) => {
        arrived += 1;

        if (arrived === 2) {
          // Neither has decided yet, so the windows genuinely overlap.
          releaseGate();
        }

        await gate;

        if (request.headers['x-gate'] !== 'open') {
          return request.trigger404();
        }

        return params.APIResponseHelpers.createAPISuccessResponse({
          request,
          data: { ok: true },
        });
      });

      await server.listen(await getPort(), 'localhost');

      try {
        const fastify = fastifyOf(server);
        const [gated, allowed] = await Promise.all([
          fastify.inject(apiRouteInjection),
          fastify.inject({
            ...apiRouteInjection,
            headers: { 'x-gate': 'open' },
          }),
        ]);

        expect(arrived).toBe(2);
        expect(gated.statusCode).toBe(404);
        expect(gated.json<{ error: { code: string } }>().error.code).toBe(
          'not_found',
        );
        expect(allowed.statusCode).toBe(200);
        expect(allowed.json<{ data: { ok: boolean } }>().data.ok).toBe(true);
      } finally {
        await server.stop();
      }
    });
  });
});

/**
 * `request.trigger404()` on `SSRServer`.
 *
 * The byte-equality matrix here is the same one `trigger-404.test.ts` runs on
 * `APIServer`, against the other server that hosts the same two registries. It
 * needs a real production build to boot against, so it lives in its own file.
 *
 * The internal short-circuit is the case only SSR has: during a render, a
 * registered page type is resolved in-process by `callHandler()` rather than
 * over HTTP, so a trigger there has no reply of its own to answer with. What it
 * has to produce is the envelope this server's not-found resolution produces for
 * this request, matching the HTTP fallback an unregistered page type gets in
 * every field except `request_id` and `request_timestamp` — the two that
 * necessarily differ because the fallback is a second Fastify request.
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import getPort from 'get-port';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { serveSSRBuilt } from '../ssr';
import type { SSRServer } from './ssr-server';
import { APIResponseHelpers } from '../../api-envelope';
import {
  API_HELPERS_MARKER,
  MarkerHelpers,
  PAGE_HELPERS_MARKER,
  assertIndistinguishable,
  captureResponse,
  pageDataBody,
  pinnedRequestID,
  type CapturedResponse,
} from './trigger-404-equality-harness';

/**
 * A minimal but genuine production build.
 *
 * The render entry drives the internal short-circuit directly: it resolves the
 * page type off the URL, and when a handler is registered for it, calls
 * `callHandler()` exactly as `pageDataLoader` does during a real render. The
 * resolved envelope is embedded in the HTML so a test can read what the render
 * actually received, and the rendered copy and status code follow from it.
 */
async function writeBuild(buildDir: string): Promise<void> {
  const clientDir = join(buildDir, 'client');
  const serverDir = join(buildDir, 'server');

  await mkdir(join(clientDir, '.vite'), { recursive: true });
  await mkdir(join(clientDir, 'assets'), { recursive: true });
  await mkdir(join(serverDir, '.vite'), { recursive: true });
  await mkdir(join(serverDir, 'assets'), { recursive: true });

  await writeFile(
    join(clientDir, 'index.html'),
    `<!DOCTYPE html>
<html>
  <head><!--ss-head--></head>
  <body>
    <div id="root"><!--ss-outlet--></div>
  </body>
</html>`,
  );

  await writeFile(join(clientDir, 'assets', 'present.js'), 'export const a=1;');

  await writeFile(
    join(clientDir, '.vite', 'manifest.json'),
    JSON.stringify({
      'index.html': { file: 'assets/present.js', isEntry: true },
    }),
  );

  await writeFile(
    join(serverDir, 'assets', 'EntrySSR.js'),
    `export async function render(renderRequest) {
      const url = new URL(renderRequest.fetchRequest.url);
      const pageType = url.pathname.replace(/^\\//, '') || 'home';
      const SSRHelpers = renderRequest.fetchRequest.SSRHelpers;

      if (!SSRHelpers || !SSRHelpers.handlers.hasHandler(pageType)) {
        return {
          resultType: 'page',
          html: '<p>no internal handler for ' + pageType + '</p>',
        };
      }

      const outcome = await SSRHelpers.handlers.callHandler({
        originalRequest: SSRHelpers.fastifyRequest,
        controlledReply: SSRHelpers.controlledReply,
        pageType,
        routeParams: {},
        queryParams: {},
        requestPath: url.pathname,
        originalURL: url.pathname,
      });

      const envelope = outcome.result;
      const statusCode = (envelope && envelope.status_code) || 200;

      return {
        resultType: 'page',
        statusCode,
        html:
          '<h1>' + (statusCode === 404 ? 'Not Found' : 'Loaded') + '</h1>' +
          '<script id="page-envelope" type="application/json">' +
          JSON.stringify(envelope) +
          '</script>',
      };
    }`,
  );

  await writeFile(
    join(serverDir, '.vite', 'manifest.json'),
    JSON.stringify({ 'EntrySSR.tsx': { file: 'assets/EntrySSR.js' } }),
  );
}

interface Injection {
  method: 'GET' | 'POST';
  url: string;
  payload?: Record<string, unknown>;
}

const apiRouteInjection: Injection = { method: 'GET', url: '/api/v1/thing' };

const pageDataInjection: Injection = {
  method: 'POST',
  url: '/api/v1/page_data/thing',
  payload: pageDataBody,
};

/** The custom not-found handler used by the `APIHandling.notFoundHandler` cells. */
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

describe('trigger404 byte-equality matrix on SSRServer', () => {
  let tmpDir: TmpDir;
  let buildDir: string;
  const started: SSRServer[] = [];

  const fastifyOf = (server: SSRServer): FastifyInstance =>
    (server as unknown as { fastifyInstance: FastifyInstance }).fastifyInstance;

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'trigger-404-ssr-test-',
      unsafeCleanup: true,
    });

    buildDir = join(tmpDir.path, 'app');
    await writeBuild(buildDir);
  });

  afterEach(async () => {
    await Promise.all(started.splice(0).map((server) => server.stop()));
    await tmpDir.cleanup();
  });

  const start = async (server: SSRServer): Promise<SSRServer> => {
    started.push(server);
    await server.listen(await getPort(), '127.0.0.1');

    return server;
  };

  const registerTriggeringAPIRoute = (server: SSRServer) => {
    server.api.get('thing', (request) => request.trigger404());
  };

  const registerTriggeringPageDataHandler = (server: SSRServer) => {
    server.pageDataHandler.register('thing', (request) => request.trigger404());
  };

  /**
   * Builds the two servers from one factory, injects the same request into
   * both, and hands back what a caller would have seen from each.
   */
  const runCell = async (
    createServer: () => SSRServer,
    register: (server: SSRServer) => void,
    injection: Injection,
  ): Promise<{
    triggered: CapturedResponse;
    unregistered: CapturedResponse;
  }> => {
    const registered = createServer();
    register(registered);

    const bare = createServer();

    await start(registered);
    await start(bare);

    return {
      triggered: captureResponse(await fastifyOf(registered).inject(injection)),
      unregistered: captureResponse(await fastifyOf(bare).inject(injection)),
    };
  };

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
        () => serveSSRBuilt(buildDir, { getRequestID: pinnedRequestID }),
        registerTriggeringAPIRoute,
        apiRouteInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'api',
        errorCode: 'not_found',
      });
    });

    it('matches with an APIHandling.notFoundHandler', async () => {
      const spies: Array<ReturnType<typeof createNotFoundSpy>> = [];

      const { triggered, unregistered } = await runCell(
        () => {
          const notFoundHandler = createNotFoundSpy();
          spies.push(notFoundHandler);

          return serveSSRBuilt(buildDir, {
            getRequestID: pinnedRequestID,
            APIHandling: { notFoundHandler },
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

    it('matches with a custom APIResponseHelpers class', async () => {
      const { triggered, unregistered } = await runCell(
        () =>
          serveSSRBuilt(buildDir, {
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
  });

  describe('page data', () => {
    it('matches the unregistered page type with the default not-found response', async () => {
      const { triggered, unregistered } = await runCell(
        () => serveSSRBuilt(buildDir, { getRequestID: pinnedRequestID }),
        registerTriggeringPageDataHandler,
        pageDataInjection,
      );

      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'page',
        errorCode: 'not_found',
      });
    });

    it('matches with an APIHandling.notFoundHandler', async () => {
      const spies: Array<ReturnType<typeof createNotFoundSpy>> = [];

      const { triggered, unregistered } = await runCell(
        () => {
          const notFoundHandler = createNotFoundSpy();
          spies.push(notFoundHandler);

          return serveSSRBuilt(buildDir, {
            getRequestID: pinnedRequestID,
            APIHandling: { notFoundHandler },
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
      // isPageData true is what proves the page branch was reached through the
      // shared path rather than the API one.
      expectHandlerSpyArgs(spies[0], {
        url: '/api/v1/page_data/thing',
        isPageData: true,
        HelpersClass: APIResponseHelpers,
      });
    });

    it('matches with a custom APIResponseHelpers class', async () => {
      const { triggered, unregistered } = await runCell(
        () =>
          serveSSRBuilt(buildDir, {
            getRequestID: pinnedRequestID,
            APIResponseHelpersClass: MarkerHelpers,
          }),
        registerTriggeringPageDataHandler,
        pageDataInjection,
      );

      // The page marker, not the API one: the custom class was entered through
      // its isPageData branch.
      assertIndistinguishable(expect, triggered, unregistered, {
        statusCode: 404,
        type: 'page',
        errorCode: 'not_found',
        helpersMarker: PAGE_HELPERS_MARKER,
      });
    });
  });

  describe('internal short-circuit during a render', () => {
    /**
     * The two envelopes cannot be byte-equal: the HTTP fallback is a second
     * Fastify request with its own id and receive time. Everything else has to
     * match, which is the honest guarantee for this path.
     */
    const withoutPerRequestFields = (envelope: Record<string, unknown>) => {
      // Present on both sides, just not comparable between them.
      expect(typeof envelope.request_id).toBe('string');
      expect(typeof envelope.request_timestamp).toBe('string');

      const rest = { ...envelope };

      delete rest.request_id;
      delete rest.request_timestamp;

      return rest;
    };

    const readRenderedEnvelope = (html: string): Record<string, unknown> => {
      const match = html.match(
        /<script id="page-envelope" type="application\/json">([\s\S]*?)<\/script>/,
      );

      if (!match) {
        throw new Error(`No embedded envelope in the rendered HTML: ${html}`);
      }

      return JSON.parse(match[1]) as Record<string, unknown>;
    };

    it('produces the same envelope the HTTP fallback produces, and renders the 404', async () => {
      const server = await start(
        serveSSRBuilt(buildDir, { getRequestID: pinnedRequestID }),
      );

      server.pageDataHandler.register('thing', (request) =>
        request.trigger404(),
      );

      const fastify = fastifyOf(server);

      // Registered: the render short-circuits into callHandler(), which has no
      // reply of its own and resolves the envelope in-process.
      const rendered = await fastify.inject({ method: 'GET', url: '/thing' });

      // Unregistered: the same page type over HTTP, which is what an app whose
      // loader found no internal handler falls back to.
      const fallback = await fastify.inject({
        method: 'POST',
        url: '/api/v1/page_data/other',
        payload: pageDataBody,
      });

      // The render reflects the 404 rather than quietly rendering a page.
      expect(rendered.statusCode).toBe(404);
      expect(rendered.body).toContain('<h1>Not Found</h1>');

      const internal = readRenderedEnvelope(rendered.body);
      const overHTTP = fallback.json<Record<string, unknown>>();

      expect(withoutPerRequestFields(internal)).toEqual(
        withoutPerRequestFields(overHTTP),
      );
      expect(internal.type).toBe('page');
      expect((internal.error as { code: string }).code).toBe('not_found');
    });

    it('carries a custom notFoundHandler onto the internal path too', async () => {
      const notFoundHandler = createNotFoundSpy();
      const server = await start(
        serveSSRBuilt(buildDir, {
          getRequestID: pinnedRequestID,
          APIHandling: { notFoundHandler },
        }),
      );

      server.pageDataHandler.register('thing', (request) =>
        request.trigger404(),
      );

      const fastify = fastifyOf(server);
      const rendered = await fastify.inject({ method: 'GET', url: '/thing' });
      const fallback = await fastify.inject({
        method: 'POST',
        url: '/api/v1/page_data/other',
        payload: pageDataBody,
      });

      const internal = readRenderedEnvelope(rendered.body);

      expect(rendered.statusCode).toBe(404);
      expect((internal.error as { code: string }).code).toBe(
        'custom_not_found',
      );
      expect(withoutPerRequestFields(internal)).toEqual(
        withoutPerRequestFields(fallback.json<Record<string, unknown>>()),
      );

      // The render path and the HTTP path each called it once, both with
      // isPageData true — the classification override in the resolver is what
      // keeps the internal path from building an API envelope for a page.
      expect(notFoundHandler).toHaveBeenCalledTimes(2);
      expect(notFoundHandler.mock.calls[0][1]).toBe(true);
      expect(notFoundHandler.mock.calls[1][1]).toBe(true);
    });

    it('renders the page normally when the handler does not trigger', async () => {
      const server = await start(
        serveSSRBuilt(buildDir, { getRequestID: pinnedRequestID }),
      );

      server.pageDataHandler.register('thing', (request, _reply, params) =>
        params.APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { ok: true },
          pageMetadata: { title: 'Thing', description: 'A thing' },
        }),
      );

      const rendered = await fastifyOf(server).inject({
        method: 'GET',
        url: '/thing',
      });

      expect(rendered.statusCode).toBe(200);
      expect(rendered.body).toContain('<h1>Loaded</h1>');
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { chmod, mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import getPort from 'get-port';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import { serveSSRBuilt } from '../ssr';
import type { SSRServer } from './ssr-server';
import type { ServerPlugin } from '../types';
import type { FastifyRequest } from 'fastify';

/**
 * `getStaticNotFoundPage` end to end through a real production SSR server.
 *
 * The pieces below are unit tested elsewhere — the cache reports
 * `matched-not-found`, and the request marker is asserted for API/plain servers.
 * What only shows up here is the wiring: that a mapped-but-missing asset is
 * intercepted in the static onRequest hook instead of falling through to the
 * catch-all React route, that the response carries the asset-specific status and
 * headers, that the handler is picked from the app the request selected, and
 * that a throwing handler still lands on normal SSR error handling.
 */

/** A minimal but genuine production build that renders a marker page. */
async function writeBuild(buildDir: string, marker: string): Promise<void> {
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

  // A real asset under the default '/assets' mount, so the served path is
  // covered alongside the missing one.
  await writeFile(join(clientDir, 'assets', 'present.js'), 'export const a=1;');

  await writeFile(
    join(clientDir, '.vite', 'manifest.json'),
    JSON.stringify({
      'index.html': { file: 'assets/present.js', isEntry: true },
    }),
  );

  await writeFile(
    join(serverDir, 'assets', 'EntrySSR.js'),
    `export async function render() {
      return { resultType: 'page', html: '<p>${marker}</p>' };
    }`,
  );

  await writeFile(
    join(serverDir, '.vite', 'manifest.json'),
    JSON.stringify({ 'EntrySSR.tsx': { file: 'assets/EntrySSR.js' } }),
  );
}

/** Selects app B the way a tenant plugin would, before static routing runs. */
const selectAppByHeader: ServerPlugin<'ssr'> = (pluginHost) => {
  pluginHost.addHook('onRequest', (request: FastifyRequest) => {
    if (request.headers['x-app'] === 'b') {
      request.setActiveSSRApp('b');
    }

    return Promise.resolve();
  });
};

describe('SSR static not-found page for a mapped missing asset', () => {
  let tmpDir: TmpDir;
  let server: SSRServer | undefined;
  let port: number;

  async function startServer(
    getStaticNotFoundPage: (
      request: FastifyRequest,
      isDevelopment: boolean,
    ) => string | Promise<string>,
  ) {
    server = serveSSRBuilt(join(tmpDir.path, 'app-a'), {
      getStaticNotFoundPage,
      get500ErrorPage: () => '<p>custom 500</p>',
      plugins: [selectAppByHeader],
    });

    server.registerBuiltApp('b', join(tmpDir.path, 'app-b'), {
      getStaticNotFoundPage: () => '<p>app B asset 404</p>',
    });

    port = await getPort();
    await server.listen(port, '127.0.0.1');
  }

  /**
   * Starts a single-app server without a static not-found handler, for the
   * cases about fall-through, classification, and error handling rather than
   * about the handler itself.
   */
  async function startBareServer(plugins: Array<ServerPlugin<'ssr'>> = []) {
    server = serveSSRBuilt(join(tmpDir.path, 'app-a'), {
      get500ErrorPage: () => '<p>custom 500</p>',
      staticRequestPaths: ['/assets/**', '/favicon.ico'],
      plugins,
    });

    port = await getPort();
    await server.listen(port, '127.0.0.1');
  }

  async function get(path: string, app?: 'b') {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: app === undefined ? {} : { 'x-app': app },
    });

    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      cacheControl: response.headers.get('cache-control') ?? '',
      body: await response.text(),
    };
  }

  beforeEach(async () => {
    tmpDir = await createTempDir({
      prefix: 'ssr-static-not-found-test-',
      unsafeCleanup: true,
    });

    await writeBuild(join(tmpDir.path, 'app-a'), 'app A rendered');
    await writeBuild(join(tmpDir.path, 'app-b'), 'app B rendered');
  });

  afterEach(async () => {
    // Guarded because a test may assert on construction alone and never listen.
    if (server) {
      await server.stop();
      server = undefined;
    }

    await tmpDir.cleanup();
  });

  it('answers a mapped missing asset with the configured standalone page', async () => {
    await startServer(() => '<p>app A asset 404</p>');

    const response = await get('/assets/missing.js');

    expect(response.status).toBe(404);
    expect(response.contentType).toBe('text/html; charset=utf-8');
    expect(response.cacheControl).toBe('no-store');
    expect(response.body).toBe('<p>app A asset 404</p>');

    // The point of the interception: React never runs for this request.
    expect(response.body).not.toContain('app A rendered');
  });

  it('passes the request and dev flag to the handler', async () => {
    await startServer(
      (request, isDevelopment) =>
        `<p>${request.url} ${String(isDevelopment)}</p>`,
    );

    const response = await get('/assets/missing.js?v=1');

    expect(response.body).toBe('<p>/assets/missing.js?v=1 false</p>');
  });

  it('uses the handler of the app the request selected', async () => {
    await startServer(() => '<p>app A asset 404</p>');

    const response = await get('/assets/missing.js', 'b');

    expect(response.status).toBe(404);
    expect(response.body).toBe('<p>app B asset 404</p>');
  });

  it('leaves served assets and ordinary routes alone', async () => {
    await startServer(() => '<p>app A asset 404</p>');

    const asset = await get('/assets/present.js');

    expect(asset.status).toBe(200);
    expect(asset.body).toContain('export const a=1;');

    // Not a mapped static path, so this keeps the normal React response.
    const page = await get('/some/page');

    expect(page.status).toBe(200);
    expect(page.body).toContain('app A rendered');
  });

  it('falls back to normal SSR error handling when the handler throws', async () => {
    await startServer(() => {
      throw new Error('handler boom');
    });

    const response = await get('/assets/missing.js');

    expect(response.status).toBe(500);
    expect(response.body).toContain('custom 500');
  });

  it('keeps the React 404 for a mapped missing asset when no handler is configured', async () => {
    // The interception is opt-in. Without a handler the request has to keep
    // falling through to the catch-all route, which is the behavior every app
    // that never configures one depends on.
    await startBareServer();

    const response = await get('/assets/missing.js');

    expect(response.body).toContain('app A rendered');
    expect(response.contentType).toContain('text/html');
  });

  it('escalates a mapped asset that exists but cannot be read', async () => {
    // A read fault is a server fault, not a miss, so it has to reach normal SSR
    // error handling rather than an asset 404 or a page render that would hide
    // a real filesystem problem.
    const locked = join(tmpDir.path, 'app-a', 'client', 'assets', 'locked.js');

    await writeFile(locked, 'export const locked = 1;');
    await chmod(locked, 0o000);

    try {
      await startBareServer();

      const response = await get('/assets/locked.js');

      expect(response.status).toBe(500);
      expect(response.body).toContain('custom 500');
    } finally {
      // Restored so the temp directory cleanup is not left fighting the mode.
      await chmod(locked, 0o644);
    }
  });

  it('classifies configured static paths before user plugins run', async () => {
    // staticRequestPaths is the early hint, so it has to be set by the time a
    // user onRequest hook sees the request. isStaticContentMatch is the late
    // mapping marker and must still be false there, even for an asset that is
    // about to be served, or the two markers would be indistinguishable.
    const observed: Array<{
      url: string;
      isStaticRequest: boolean;
      isStaticContentMatch: boolean;
    }> = [];

    const recordClassification: ServerPlugin<'ssr'> = (pluginHost) => {
      pluginHost.addHook('onRequest', (request: FastifyRequest) => {
        observed.push({
          url: request.url,
          isStaticRequest: request.isStaticRequest,
          isStaticContentMatch: request.isStaticContentMatch,
        });

        return Promise.resolve();
      });
    };

    await startBareServer([recordClassification]);

    await get('/assets/present.js');
    await get('/assets/missing.js');
    await get('/some/page');

    expect(observed).toEqual([
      {
        url: '/assets/present.js',
        isStaticRequest: true,
        isStaticContentMatch: false,
      },
      {
        url: '/assets/missing.js',
        isStaticRequest: true,
        isStaticContentMatch: false,
      },
      {
        url: '/some/page',
        isStaticRequest: false,
        isStaticContentMatch: false,
      },
    ]);
  });

  it('rejects an invalid staticRequestPaths entry when the server is constructed', () => {
    // A bad pattern is a configuration error, so it fails at startup instead of
    // silently classifying nothing for the life of the process.
    expect(() =>
      serveSSRBuilt(join(tmpDir.path, 'app-a'), {
        staticRequestPaths: ['assets/**'],
      }),
    ).toThrow('staticRequestPaths entries must be absolute URL paths');
  });

  it('stops the request pipeline once a static asset is served', async () => {
    // A served static response hijacks the socket, so nothing after the static
    // hook may run for it. preHandler is the first stage past that point, and it
    // still has to run for an ordinary route.
    //
    // What enforces this is the hijack itself: Fastify skips the remaining hooks
    // and the route handler once `reply.sent` is true. The explicit early return
    // in the static hook is belt-and-braces on top of that, so removing it does
    // not change the observable behavior this test pins.
    const preHandlerURLs: string[] = [];

    const recordPreHandler: ServerPlugin<'ssr'> = (pluginHost) => {
      pluginHost.addHook('preHandler', (request: FastifyRequest) => {
        preHandlerURLs.push(request.url);

        return Promise.resolve();
      });
    };

    await startBareServer([recordPreHandler]);

    const asset = await get('/assets/present.js');

    expect(asset.status).toBe(200);
    expect(asset.body).toContain('export const a=1;');
    expect(preHandlerURLs).toEqual([]);

    // The same hook still fires for a request the static hook does not answer.
    await get('/some/page');

    expect(preHandlerURLs).toEqual(['/some/page']);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'fs/promises';
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
  let server: SSRServer;
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
    await server.stop();
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
});

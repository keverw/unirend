import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import getPort from 'get-port';
import { createTempDir } from 'lifecycleion/tmp-dir';
import type { TmpDir } from 'lifecycleion/tmp-dir';
import { serveSSRBuilt } from '../ssr';
import { serveAPI } from '../api';
import type { SSRServer } from './ssr-server';
import type { APIServer } from './api-server';
import type { ServerPlugin } from '../types';

/**
 * The SSR not-found path for everything the `GET '*'` catch-all does not claim.
 *
 * The catch-all only answers GET, so before this existed every non-GET miss and
 * every `reply.callNotFound()` from a plugin route fell through to Fastify's
 * stock `{"message":"Route POST:… not found"}` JSON — on a server whose whole
 * premise is that a 404 renders React, and with `reply.callNotFound()` already
 * documented as supported inside plugin route handlers. These pin that those
 * requests now classify exactly like a GET does: an API path gets the envelope,
 * a web path renders the app's own 404 page.
 *
 * `APIServer` is covered at the bottom because it has always registered a
 * not-found handler, so the gap should never have reached it. That is asserted
 * rather than assumed.
 */

/** A minimal but genuine production build that renders a 404 page on demand. */
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

  // Any path containing "missing" is the app's own 404 route, so a request that
  // reaches React at all is distinguishable from one that never got there.
  await writeFile(
    join(serverDir, 'assets', 'EntrySSR.js'),
    `export async function render(renderRequest) {
      const pathname = new URL(renderRequest.fetchRequest.url).pathname;
      // Echoed so a test can pin which method actually reached React. React
      // Router runs a route action for a non-GET request, so the method the
      // render receives is the whole guard against a request Fastify never routed
      // executing the app's mutation code.
      const method = '<p>method:' + renderRequest.fetchRequest.method + '</p>';

      if (pathname.includes('missing')) {
        return {
          resultType: 'page',
          statusCode: 404,
          html: '<p>app 404 page</p>' + method,
        };
      }

      return { resultType: 'page', html: '<p>app rendered</p>' + method };
    }`,
  );

  await writeFile(
    join(serverDir, '.vite', 'manifest.json'),
    JSON.stringify({ 'EntrySSR.tsx': { file: 'assets/EntrySSR.js' } }),
  );
}

/**
 * Raw plugin routes that hand the request back to the framework, the form
 * `guardRouteHandler`'s docblock blesses. One on each side of the API/web
 * classification split.
 */
const delegatingRoutes: ServerPlugin<'ssr'> = (pluginHost) => {
  pluginHost.get('/plugin-missing-page', (_request, reply) => {
    return reply.callNotFound();
  });

  pluginHost.get('/api/v1/plugin-delegates', (_request, reply) => {
    return reply.callNotFound();
  });
};

const delegatingAPIRoutes: ServerPlugin<'api'> = (pluginHost) => {
  pluginHost.get('/api/v1/plugin-delegates', (_request, reply) => {
    return reply.callNotFound();
  });
};

interface Response {
  status: number;
  contentType: string;
  cacheControl: string;
  body: string;
}

describe('SSR not-found handling for requests the catch-all does not match', () => {
  let tmpDir: TmpDir;
  let server: SSRServer | undefined;
  let port: number;

  async function startServer(plugins: Array<ServerPlugin<'ssr'>> = []) {
    server = serveSSRBuilt(join(tmpDir.path, 'app'), {
      get500ErrorPage: () => '<p>custom 500</p>',
      plugins,
    });

    port = await getPort();
    await server.listen(port, '127.0.0.1');
  }

  async function request(method: string, path: string): Promise<Response> {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
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
      prefix: 'ssr-not-found-test-',
      unsafeCleanup: true,
    });

    await writeBuild(join(tmpDir.path, 'app'));
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }

    await tmpDir.cleanup();
  });

  it('answers a non-GET page-data miss with the API envelope', async () => {
    await startServer();

    const response = await request('POST', '/api/v1/page_data/nope');

    expect(response.status).toBe(404);
    expect(response.contentType).toContain('application/json');
    expect(response.cacheControl).toBe('no-store');

    const body = JSON.parse(response.body) as {
      status: string;
      status_code: number;
      type: string;
      error: { code: string };
    };

    expect(body.status).toBe('error');
    expect(body.status_code).toBe(404);
    expect(body.type).toBe('page');
    expect(body.error.code).toBe('not_found');

    // Fastify's stock 404 shape, which is what this used to return.
    expect(response.body).not.toContain('Route POST:');
  });

  it('answers a non-GET API miss with the API envelope', async () => {
    await startServer();

    const response = await request('DELETE', '/api/v1/nope');

    expect(response.status).toBe(404);
    expect(response.contentType).toContain('application/json');
    expect(response.cacheControl).toBe('no-store');

    const body = JSON.parse(response.body) as {
      status: string;
      status_code: number;
      type: string;
      error: { code: string };
    };

    expect(body.status).toBe('error');
    expect(body.status_code).toBe(404);
    expect(body.type).toBe('api');
    expect(body.error.code).toBe('not_found');
    expect(response.body).not.toContain('Route DELETE:');
  });

  it('renders the same 404 page for a non-GET web miss as for a GET', async () => {
    await startServer();

    const get = await request('GET', '/missing-page');
    const post = await request('POST', '/missing-page');

    expect(get.status).toBe(404);
    expect(get.contentType).toContain('text/html');
    expect(get.body).toContain('app 404 page');

    expect(post.status).toBe(get.status);
    expect(post.contentType).toBe(get.contentType);
    expect(post.cacheControl).toBe(get.cacheControl);
    expect(post.body).toContain('app 404 page');
    expect(post.body).not.toContain('Route POST:');
  });

  it('renders an unmatched non-GET as a GET, so no route action can run', async () => {
    // The guard that matters. React Router's static handler runs the matched
    // route's `action` for a non-GET request — that is how <Form method="post">
    // works — so handing it the original method would let a request Fastify
    // never routed execute the app's mutation code. Rendering as a GET makes
    // that structurally impossible rather than merely discouraged.
    await startServer();

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await request(method, '/missing-page');

      expect(response.status).toBe(404);
      expect(response.body).toContain('method:GET');
      expect(response.body).not.toContain(`method:${method}`);
    }
  });

  it('answers 404 for a non-GET to a path that does render', async () => {
    // The render ran as a GET, so a URL that is a real page renders normally
    // and would come back 200 on its own. It is still a method this server has
    // no route for, so the status is forced to 404.
    await startServer();

    const get = await request('GET', '/real-page');
    const post = await request('POST', '/real-page');

    expect(get.status).toBe(200);
    expect(get.body).toContain('app rendered');

    expect(post.status).toBe(404);
    expect(post.cacheControl).toBe('no-store');
    expect(post.body).toContain('method:GET');
  });

  it('classifies a web plugin route that returns reply.callNotFound()', async () => {
    // The bug this closes: `return reply.callNotFound()` is documented as
    // supported inside a plugin route handler, but with no not-found handler
    // registered it landed in Fastify's stock JSON rather than the app's page.
    await startServer([delegatingRoutes]);

    const response = await request('GET', '/plugin-missing-page');

    expect(response.status).toBe(404);
    expect(response.contentType).toContain('text/html');
    expect(response.body).toContain('app 404 page');
    expect(response.body).not.toContain('Route GET:');
  });

  it('classifies an API plugin route that returns reply.callNotFound()', async () => {
    await startServer([delegatingRoutes]);

    const response = await request('GET', '/api/v1/plugin-delegates');

    expect(response.status).toBe(404);
    expect(response.contentType).toContain('application/json');
    expect(response.cacheControl).toBe('no-store');

    const body = JSON.parse(response.body) as {
      status: string;
      error: { code: string };
    };

    expect(body.status).toBe('error');
    expect(body.error.code).toBe('not_found');
    expect(response.body).not.toContain('Route GET:');
  });

  it('routes the not-found path through a custom APIHandling.notFoundHandler', async () => {
    // Proves the classified path reaches the server's own not-found
    // resolution rather than reproducing a default envelope of its own.
    server = serveSSRBuilt(join(tmpDir.path, 'app'), {
      APIHandling: {
        notFoundHandler: (_request, isPageData, { APIResponseHelpers }) => {
          return isPageData
            ? APIResponseHelpers.createPageErrorResponse({
                request: _request,
                statusCode: 404,
                errorCode: 'custom_page_miss',
                errorMessage: 'custom page miss',
                pageMetadata: {
                  title: 'Missing',
                  description: 'Nothing here',
                },
              })
            : APIResponseHelpers.createAPIErrorResponse({
                request: _request,
                statusCode: 404,
                errorCode: 'custom_api_miss',
                errorMessage: 'custom api miss',
              });
        },
      },
    });

    port = await getPort();
    await server.listen(port, '127.0.0.1');

    const apiResponse = await request('DELETE', '/api/v1/nope');
    const pageResponse = await request('POST', '/api/v1/page_data/nope');

    expect(
      (JSON.parse(apiResponse.body) as { error: { code: string } }).error.code,
    ).toBe('custom_api_miss');

    expect(
      (JSON.parse(pageResponse.body) as { error: { code: string } }).error.code,
    ).toBe('custom_page_miss');
  });

  it('leaves matched routes and ordinary GETs alone', async () => {
    await startServer([delegatingRoutes]);

    const page = await request('GET', '/some/page');

    expect(page.status).toBe(200);
    expect(page.body).toContain('app rendered');

    const asset = await request('GET', '/assets/present.js');

    expect(asset.status).toBe(200);
    expect(asset.body).toContain('export const a=1;');
  });
});

describe('APIServer already classifies its not-found path', () => {
  let server: APIServer | undefined;
  let port: number;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = undefined;
    }
  });

  async function request(method: string, path: string): Promise<Response> {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
    });

    return {
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      cacheControl: response.headers.get('cache-control') ?? '',
      body: await response.text(),
    };
  }

  it('answers a plugin route that returns reply.callNotFound() with the envelope', async () => {
    // APIServer has always registered a not-found handler, so it never had the
    // SSR gap. Asserted rather than assumed, since both servers share the same
    // resolver and a regression in one should be visible in the other.
    server = serveAPI({ plugins: [delegatingAPIRoutes] });

    port = await getPort();
    await server.listen(port, '127.0.0.1');

    const delegated = await request('GET', '/api/v1/plugin-delegates');
    const missed = await request('DELETE', '/api/v1/nope');

    for (const response of [delegated, missed]) {
      expect(response.status).toBe(404);
      expect(response.contentType).toContain('application/json');
      expect(response.cacheControl).toBe('no-store');

      const body = JSON.parse(response.body) as {
        status: string;
        error: { code: string };
      };

      expect(body.status).toBe('error');
      expect(body.error.code).toBe('not_found');
      expect(response.body).not.toContain('Route ');
    }
  });
});

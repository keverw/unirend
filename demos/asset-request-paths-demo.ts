/**
 * Advanced asset request-path demo. Run this against two built SSR fixtures.
 * App selection runs before static routing, while only user-session work reads
 * the early classification.
 */
// This demo intentionally imports the workspace sources, so `bun run
// asset-request-paths-demo` exercises the checked-out implementation without
// requiring a separate package build first.
import { serveSSRBuilt, type ServerPlugin } from '../src/server';
import { cookies } from '../src/plugins';

const requestAudit = {
  tenantSelections: 0,
  userSessionsResolved: 0,
  userSessionsSkipped: 0,
  lastSelectedApp: 'a',
  lastSessionAction: 'resolved',
};

const selectApp: ServerPlugin<'ssr'> = (host) => {
  host.addHook('onRequest', (request) => {
    const selectedApp = request.cookies['asset_demo_app'] === 'b' ? 'b' : 'a';
    requestAudit.tenantSelections += 1;
    requestAudit.lastSelectedApp = selectedApp;

    if (selectedApp === 'b') {
      request.setActiveSSRApp('b');
    }
  });
};

const resolveUser: ServerPlugin<'ssr'> = (host) => {
  host.addHook('onRequest', (request) => {
    if (request.isStaticRequest) {
      requestAudit.userSessionsSkipped += 1;
      requestAudit.lastSessionAction = 'skipped for a classified asset path';
      return;
    }

    requestAudit.userSessionsResolved += 1;
    requestAudit.lastSessionAction = 'resolved for an ordinary request';
    request.requestContext.user = { id: 'demo-user' };
  });
};

const publishAudit: ServerPlugin<'ssr'> = (host) => {
  host.addHook('onRequest', (request) => {
    request.requestContext.assetRequestPathsAudit = { ...requestAudit };
  });
};

const static404 = (appName: string) => () =>
  `<!doctype html><html lang="en"><head><title>404 - Asset Not Found</title></head><body><h1>404 - Asset Not Found</h1><p>${appName} selected this mapped asset, but its file is absent.</p><p>This response bypassed React SSR.</p><p><a href="/">Return to the demo</a></p></body></html>`;

const server = serveSSRBuilt('./demos/asset-request-paths/build-a', {
  staticRequestPaths: ['/assets/**', '/favicon.ico', '/present.txt'],
  getStaticNotFoundPage: static404('App A'),
  apiEndpoints: { apiEndpointPrefix: '/api' },
  publicFiles: ['/present.txt'],
  publicAppConfig: {
    appKey: 'a',
    appName: 'App A',
  },
  plugins: [cookies(), selectApp, resolveUser, publishAudit],
});

server.registerBuiltApp('b', './demos/asset-request-paths/build-b', {
  getStaticNotFoundPage: static404('App B'),
  publicFiles: ['/present.txt'],
  publicAppConfig: {
    appKey: 'b',
    appName: 'App B',
  },
});

// App A is the default build. App B is registered separately and selected with
// asset_demo_app. Its selection controls the public-file lookup and static404
// handler. /unknown still reaches React, and /api/missing retains the API
// envelope.
// Override PORT when this default is already occupied locally.
const port = Number(process.env.PORT ?? 4200);
await server.listen(port, 'localhost');
// eslint-disable-next-line no-console
console.log(`Asset request paths demo listening on http://localhost:${port}`);

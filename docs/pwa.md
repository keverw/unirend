# PWA Support Ideas

Future design notes for possible Progressive Web App support in Unirend.

Unirend does not currently provide first-class PWA helpers. This document is a parking lot for a possible low-risk design that preserves the existing SSR, SSG, React Router, and page data loader model. It is not a roadmap commitment.

<!-- toc -->

- [Possible Goals](#possible-goals)
- [Non-Goals](#non-goals)
- [Possible API Shape](#possible-api-shape)
- [Vite Integration](#vite-integration)
- [Basic PWA Layer](#basic-pwa-layer)
- [Offline Page Data Layer](#offline-page-data-layer)
- [Debugging and Operations Ideas](#debugging-and-operations-ideas)
- [Possible Package Exports](#possible-package-exports)
- [Envelope Behavior](#envelope-behavior)

<!-- tocstop -->

## Possible Goals

- Make Unirend apps installable when the application opts in.
- Help cache the app shell and static Vite assets without changing route definitions.
- Explore a special shell/cache/installable bundle format that can be consumed by service worker tooling.
- Keep page data storage, sync, and invalidation in application code.
- Keep React Router loaders as the single page data entry point.
- Preserve the Page Response Envelope contract whether data comes from the network, a cache, or an offline fallback.
- Make offline page data behavior opt-in by page type, not a required second routing layer.

## Non-Goals

- Do not make every Unirend app offline-first.
- Do not move server handlers into the browser.
- Do not expose server cookies, secrets, Fastify request/reply objects, or SSR-only context to offline handlers.
- Do not decide what page data should be cached.
- Do not own application data storage, sync, conflict resolution, or invalidation.
- Do not automatically cache authenticated or user-specific page data.
- Do not require every route to implement offline support.

## Possible API Shape

A basic app could use normal Vite PWA tooling for installability and static asset caching:

```ts
import { VitePWA } from 'vite-plugin-pwa';
import { withUnirendViteConfig } from 'unirend/config-vite';

export default withUnirendViteConfig({
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Example App',
        short_name: 'Example',
      },
    }),
  ],
});
```

Apps that need selected offline page data could wire a service worker manager with application-owned storage:

```ts
import { UnirendServiceWorkerManager } from 'unirend/pwa-worker';

const manager = new UnirendServiceWorkerManager();

manager.pageDataHandler('jobs/list', async ({ queryParams }) => {
  return {
    status: 'success',
    status_code: 200,
    request_id: 'offline_jobs_list',
    type: 'page',
    data: await readCachedJobs(queryParams),
    meta: {
      page: {
        title: 'Jobs',
        description: 'Cached job list',
      },
    },
    error: null,
  };
});
```

## Vite Integration

Unirend should probably not own the full PWA build pipeline. Vite already has an established ecosystem for this, especially `vite-plugin-pwa`, which can generate or compile a service worker, handle registration, inject a precache manifest, and generate app manifest assets.

The Unirend-specific layer should focus on helpers that understand Unirend conventions:

- Page Response Envelopes.
- Page data endpoint naming.
- App shell and static asset cache wiring.
- Service worker manager primitives.
- Offline error envelope creation.
- Utilities for authoring custom service workers that need to recognize Unirend page data requests.

This keeps `withUnirendViteConfig(...)` focused on Unirend's React/SSR/SSG Vite defaults. PWA support could be documented as composition with `vite-plugin-pwa` rather than merged directly into that helper.

## Basic PWA Layer

The first useful version should be mostly build/runtime plumbing:

- Document `vite-plugin-pwa` setup for Unirend apps.
- Provide optional helpers for manual service worker registration when an app does not want plugin auto-registration.
- Help cache the app shell, Vite assets, manifest, icons, and optional offline page.
- Optionally generate a shell/cache/installable bundle manifest for service worker code to consume.
- Leave page data cache decisions in user code.
- Provide utilities for custom service worker code.
- Provide an offline document fallback.
- Leave page data requests online-only unless explicitly configured.

This keeps PWA support useful without changing the data loader model.

Possible user-authored page data fallback:

```ts
self.addEventListener('fetch', (event) => {
  const match = matchPageDataRequest(event.request);

  if (!match || !appSupportsOfflinePageData(match.pageType)) {
    return;
  }

  event.respondWith(handlePageDataWithAppStorage(event.request, match));
});
```

`vite-plugin-pwa` would still handle service worker compilation and registration. Unirend could help with shell/asset caching and provide helpers like page data request matching and offline envelope creation. The app owns data storage and sync choices, such as IndexedDB, SQLite/WebAssembly-backed storage, OPFS-backed storage, remote sync queues, cache keys, invalidation, and conflict handling.

## Offline Page Data Layer

Offline page data should be a later, explicit layer. A service worker manager could follow this lookup order:

1. Run the normal page data loader network request.
2. If the manager has a page data handler for the page type, call it when the network path fails or when app code chooses offline mode.
3. Otherwise return a standard offline Page Response Envelope.

Offline handlers should be browser-safe functions registered on the manager. They should receive route params, query params, request path, and original URL. They should return the same Page Response Envelope shape as server handlers, but they should not share the server handler API. Any actual cached records should come from application-managed storage.

Design boundaries:

- Unirend page data is read-oriented loader data, even if the framework endpoint uses `POST` internally.
- Mutations, form submissions, login, uploads, and other custom writes stay outside the PWA page-data helper layer.
- Application code is the source of truth for actual offline behavior.

## Debugging and Operations Ideas

The service worker layer would benefit from explicit debugging and operational hooks:

- A service worker debugger route, such as `/_tools/sw-debugger`, that can inspect service worker state without relying on browser devtools alone.
- A service-worker-safe logger that persists recent logs in IndexedDB and can stream new log entries to controlled clients.
- Message-based controls for common actions, including update checks, forced shell asset refreshes, log streaming toggles, log reads/clears, and fetch bypass toggles.
- A fetch bypass mode for debugging broken caches, with an emergency query parameter to turn bypass back off when offline tooling needs to load.
- Initialization state reporting so the UI can distinguish unsupported browsers, uncontrolled pages, normal startup, and startup timeouts.
- A shell asset manifest with build timestamp, ETags, critical app assets, debugger assets, and fallback HTML.
- Critical asset verification before serving the cached shell. If required shell assets are missing, serve an app-not-downloaded fallback or offline envelope instead of a broken app shell.
- Update checks with throttling and an in-progress lock so multiple fetches or clients do not trigger concurrent cache refreshes.
- Concurrency-limited asset downloads with retry behavior.
- Cache cleanup based on the current shell asset manifest.
- Client notifications when the latest build is available.
- Configurable request strategies for API and custom write paths, including network-only handling where appropriate.
- Cross-origin requests should usually pass through to `fetch(...)`.
- A final unhandled rejection/error path that logs service worker crashes.

These are optional helper ideas, not requirements for a first implementation. The most valuable reusable pieces are likely the logger, debugger UI conventions, bypass mode, forced update flow, and shell asset manifest validation.

## Possible Package Exports

If this becomes a real feature, it should probably use separate package subpaths instead of being mixed into `unirend/client` or `unirend/router-utils`.

Main-thread helpers:

```ts
import {
  registerServiceWorker,
  type UnirendServiceWorkerRegistrationOptions,
} from 'unirend/pwa';
```

Service-worker-safe helpers:

```ts
import {
  createOfflinePageErrorEnvelope,
  isPageDataRequest,
  matchPageDataRequest,
  UnirendServiceWorkerManager,
} from 'unirend/pwa-worker';
```

The split matters because the app thread can depend on browser window APIs and registration lifecycle behavior. The service worker bundle runs in a worker global scope, cannot access `window`, and should only import helpers or manager classes that are safe for service worker code.

That would require:

- A new `src/pwa.ts` public entry point.
- A new `src/pwa-worker.ts` public entry point.
- Matching `./pwa` and `./pwa-worker` exports in `package.json`.
- A `dist/pwa` entry in `tsup.config.ts`.
- A `dist/pwa-worker` entry in `tsup.config.ts`.

The helper layer could be useful even when an app uses `vite-plugin-pwa` for the service worker build and registration mechanics.

## Envelope Behavior

Pages without offline data support should still receive a predictable envelope rather than an unstructured network error. The page should be able to tell the difference between:

- Normal network data.
- Data returned from a service worker cache.
- Data returned by a browser-side offline page data handler.
- A synthetic offline fallback because the page has no offline support.

Possible shape:

```ts
{
  status: 'error',
  status_code: 503,
  request_id: 'offline_unavailable',
  type: 'page',
  data: null,
  meta: {
    page: {
      title: 'Offline',
      description: 'This page is not available offline.',
    },
    offline: {
      state: 'unsupported',
      source: 'service-worker',
    },
  },
  error: {
    code: 'offline_unavailable',
    message: 'This page is not available offline.',
  },
}
```

Potential `meta.offline.state` values:

- `unsupported`: The page has no offline handler or cached page data.
- `cached`: The response came from cached page data.
- `handler`: The response came from a manager-provided offline page data handler.

Potential `meta.offline.source` values:

- `network`: The loader reached the network. Usually omitted because this is the normal case.
- `service-worker`: A service worker returned the response.
- `offline-handler`: A main-thread offline handler returned the response.

The safest first step is probably a standard `error.code` plus `meta.offline` inside the existing Page Response Envelope. A new top-level property should only be added if components or framework helpers need to distinguish offline behavior without inspecting metadata.

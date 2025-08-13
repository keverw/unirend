# Server-Side Rendering (SSR)

<!-- toc -->

- [Overview](#overview)
- [Server Classes](#server-classes)
  - [Shared Plugin Interface](#shared-plugin-interface)
  - [Common Methods](#common-methods)
- [Create SSR Server](#create-ssr-server)
  - [Create Production SSR Server](#create-production-ssr-server)
  - [Create Development SSR Server](#create-development-ssr-server)
  - [Organization Suggestion](#organization-suggestion)
  - [SSRServer Class](#ssrserver-class)
  - [Construction](#construction)
  - [Options (shared)](#options-shared)
  - [Options (prod-only)](#options-prod-only)
  - [Header and Cookies Forwarding](#header-and-cookies-forwarding)
  - [Environment flag in handlers](#environment-flag-in-handlers)
  - [Page Data Handlers and Versioning](#page-data-handlers-and-versioning)
  - [Short-Circuit Data Handlers](#short-circuit-data-handlers)
- [Standalone API (APIServer)](#standalone-api-apiserver)
  - [Basic usage](#basic-usage)
  - [Options](#options)

<!-- tocstop -->

## Overview

**Server-Side Rendering (SSR)** renders your routes on each request and returns HTML with proper status codes and SEO metadata. Unirend provides dev and prod server helpers that return an `SSRServer` instance you can extend with plugins and page data handlers.

## Server Classes

Unirend provides two server classes with a shared plugin surface and common lifecycle methods:

- `SSRServer` (via `serveSSRDev`/`serveSSRProd`): Full SSR server that renders HTML responses for React Router routes. It can additionally be used to host your API endpoints, with the benefit of data loader handlers being short circuited.
- `APIServer` (via `serveAPI`): JSON API server for data loader endpoints and custom API routes (e.g., login, forms) that you wish to run as a separate standalone API server, separate from the server used for SSR rendering.

### Shared Plugin Interface

See the shared plugin guide for both SSR and API servers: [docs/server-plugins.md](./server-plugins.md)

### Common Methods

Both server classes expose the same operational methods:

- `listen(port?: number, host?: string): Promise<void>` — Start the server
- `stop(): Promise<void>` — Stop the server
- `registerDataLoaderHandler(pageType, handler)` and `registerDataLoaderHandler(pageType, version, handler)` — Register page data handlers used by the page data endpoint

## Create SSR Server

### Create Production SSR Server

Create a server file that uses the `serveSSRProd` function:

```typescript
import { serveSSRProd } from "unirend/server";
import path from "path";

async function main() {
  // Point to the build directory (contains both client/ and server/ subdirectories)
  const buildDir = path.resolve(__dirname, "build");

  // Set up global app config (available to both server and client)
  globalThis.__APP_CONFIG__ = {
    apiUrl: process.env.API_URL || "https://api.example.com",
    environment: "production",
  };

  const server = await serveSSRProd(buildDir, {
    // Optional: Custom server entry name (default: "entry-server")
    // serverEntry: "custom-entry",

    // Frontend app configuration (injected as window.__APP_CONFIG__)
    // NOTE: This only works in production. In dev, use import.meta.env
    frontendAppConfig: globalThis.__APP_CONFIG__,
  });

  const port = Number(process.env.PORT || 3000);
  await server.listen(port, "localhost");
  console.log(`SSR server running on http://localhost:${port}`);
}

main().catch(console.error);
```

### Create Development SSR Server

Use `serveSSRDev(paths, options)` to run the SSR server in development with Vite middleware and HMR:

```typescript
import { serveSSRDev } from "unirend/server";

async function main() {
  const server = await serveSSRDev(
    {
      serverEntry: "./src/entry-server.tsx",
      template: "./index.html",
      viteConfig: "./vite.config.ts",
    },
    {
      // Optional: same options surface as production where applicable
      // e.g., pageDataHandlers, APIHandling, containerID, plugins, fastifyOptions
      // pageDataHandlers: { endpoint: "page_data", versioned: true, defaultVersion: 1 },
      // APIHandling: { prefix: "/api" },
      // plugins: [myPlugin],
      // fastifyOptions: { logger: true },
    },
  );

  await server.listen(3000, "localhost");
}

main().catch(console.error);
```

Notes:

- In dev, Vite serves client assets with middleware and `vite.ssrLoadModule` is used for the server entry.
- HMR is available; stack traces are mapped for easier debugging.
- `frontendAppConfig` is not injected in development (`serveSSRDev`). Use `import.meta.env` (or a dev-only config shim) on the client during dev. Injection happens only in production via the template processor.

### Organization Suggestion

Since your project will most likely use both `serveSSRDev` and `serveSSRProd`, consider these options:

- Single entry script that switches on an env/arg (dev vs prod) and calls `serveSSRDev` or `serveSSRProd`.
- Separate scripts (e.g., `serve-dev.ts` and `serve-prod.ts`).
- For production binaries, you can bundle your server script with a tool like Bun:
  - `bun build server.ts --outdir ./dist` and `bun run dist/server.js`

See a complete example with plugins and data handler registration in `demos/ssr/serve.ts`.

### SSRServer Class

The `SSRServer` class powers both dev and prod servers created via `serveSSRDev` (dev) or `serveSSRProd` (prod), which passes the proper configuration.

### Construction

- Dev: `serveSSRDev({ serverEntry, template, viteConfig }, options)`
  - Uses Vite middleware and `vite.ssrLoadModule` for HMR.
- Prod: `serveSSRProd(buildDir, options)`
  - Loads server entry from the Vite server manifest in `buildDir/<serverFolderName>`.

### Options (shared)

- `pageDataHandlers?: PageDataHandlersConfig`
  - Configure page data loader endpoint and versioning (e.g., `endpoint: "page_data"`, `versioned: true`, `defaultVersion`).
- `APIHandling?: { prefix?: string | false; errorHandler?; notFoundHandler? }`
  - `prefix` (default `"/api"`) determines which paths are treated as API. Set `false` to disable API handling.
  - `errorHandler` and `notFoundHandler` return standardized API/Page error envelopes instead of HTML based context.
- `plugins?: SSRPlugin[]`
  - Register Fastify plugins via a controlled interface (see [plugins](./server-plugins.md)).
- `get500ErrorPage?: (request, error, isDevelopment) => string | Promise<string>`
  - Provide custom HTML for SSR 500 responses.
- `cookieForwarding?: { allowCookieNames?: string[]; blockCookieNames?: string[] | true }`
  - Controls which cookies are forwarded on SSR fetches and which `Set-Cookie` headers are returned to the browser.
- `containerID?: string`
  - Client container element ID (default `"root"`).
- `clientFolderName?: string`, `serverFolderName?: string`
  - Names of subfolders inside the Vite build output (defaults: `client` and `server`).
- `fastifyOptions?: { logger?: boolean | FastifyLoggerOptions; trustProxy?; bodyLimit?; keepAliveTimeout? }`
  - Safe subset of Fastify server options.

### Options (prod-only)

- `frontendAppConfig?: Record<string, unknown>`
  - Injects `window.__APP_CONFIG__` into the page (production only).
- `serverEntry?: string`
  - Name of the server entry in manifest (default `"entry-server"`).
- `staticContentRouter?: StaticContentRouterOptions | false`
  - Serves static assets (images, CSS, JS) in production. Not related to React Router’s StaticRouter.
  - Set to `false` to disable built‑in static serving (e.g., when using a CDN).
  - Options (StaticContentRouterOptions):
    - `singleAssetMap?: Record<string, string>`: Exact URL → absolute file path
    - `folderMap?: Record<string, string | FolderConfig>`: URL prefix → directory path (or folder config)
      - `FolderConfig`: `{ path: string; detectImmutableAssets?: boolean }`
    - `smallFileMaxSize?: number`: Inline/ETag cut‑off for small assets
    - `cacheEntries?: number`: Max entries in in‑memory caches
    - `contentCacheMaxSize?: number`: Max total bytes for content cache
    - `statCacheEntries?: number`: Max entries for fs stat cache
    - `negativeCacheTtl?: number`: TTL ms for negative stat cache entries
    - `positiveCacheTtl?: number`: TTL ms for positive stat cache entries
    - `cacheControl?: string`: Default Cache‑Control header
    - `immutableCacheControl?: string`: Cache‑Control for hashed/immutable assets
  - Path matching notes:
    - `singleAssetMap` keys are normalized to include a leading slash (you may provide with or without it).
    - `folderMap` prefixes are normalized to ensure both leading and trailing slash, so `/assets` and `assets/` are treated as `/assets/`.
    - The incoming request URL is normalized to ensure a leading slash before matching.
    - The relative path slice is guarded against accidental leading `/` to prevent absolute path resolution on POSIX.

### Header and Cookies Forwarding

Unirend forwards a curated set of headers and supports configurable cookie forwarding for SSR.

- Headers added by SSR to requests sent to your backend API server:
  - `X-SSR-Request`: Set to `true` on SSR-originated HTTP requests to your API (i.e., when not using short-circuit handlers). Not present on browser requests or internal short-circuit calls.
  - `X-Original-IP`: The originating client IP
  - `X-Forwarded-User-Agent`: The client user agent
  - `X-Correlation-ID`: Unique request ID (useful for tracing)

  Notes:
  - Incoming spoofed values for these headers are removed; trusted server values are set before making request to SSR API backend.
  - See `src/lib/internal/SSRServer.ts` and `src/lib/router-utils/pageDataLoader.ts` for where they are set and forwarded.

- Cookie forwarding policy (SSR):
  - Configure via `cookieForwarding` in the SSR options (dev and prod):

    ```ts
    // serveSSRDev(paths, options) or serveSSRProd(buildDir, options)
    {
      cookieForwarding: {
        // If both are empty/undefined: allow all cookies
        allowCookieNames: ["sid", "theme"],
        // Always takes precedence over allow list; can also be true to block ALL cookies
        blockCookieNames: ["csrf_token"] // or: true
      }
    }
    ```

  - Behavior:
    - If both `allowCookieNames` and `blockCookieNames` are empty/undefined, all cookies are forwarded
    - If `allowCookieNames` is non-empty, only those names are allowed
    - `blockCookieNames` always takes precedence and blocks those names
    - `blockCookieNames: true` blocks all cookies regardless of allow list

  - Where the policy applies:
    - Incoming `Cookie` header forwarded from SSR to backend during loader fetches
    - Outgoing `Set-Cookie` headers sent to the browser
      - Cookies produced by loaders via `ssOnlyData.cookies` (array of `Set-Cookie` strings)
      - Cookies present in a `Response` returned by the app’s server entry (e.g., redirects)

  - Notes about values:
    - Empty cookie values (e.g., `name=`) are allowed and forwarded if the name passes policy
    - Name-based filtering only; attributes on `Set-Cookie` are preserved as-is

### Environment flag in handlers

Within your request handlers (including page data handlers), you can check a boolean environment flag on the request to tailor behavior:

```ts
server.registerDataLoaderHandler("example", (request, params) => {
  const isDev = (request as FastifyRequest & { isDevelopment?: boolean })
    .isDevelopment;
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { environment: isDev ? "development" : "production" },
    pageMetadata: { title: "Env", description: "Env demo" },
  });
});
```

Notes:

- On the SSR server this reflects whether the server is running in development or production mode.
- On the API server this reflects `options.isDevelopment` (defaults to false).

### Page Data Handlers and Versioning

The server can automatically expose versioned and non‑versioned page data endpoints based on your configuration:

- Endpoint base: `pageDataHandlers.endpoint` (default: `"page_data"`)
- Versioning: when `pageDataHandlers.versioned: true`, routes are exposed under `/v{n}/` using `defaultVersion` as the implicit fallback
- Endpoint prefix: controlled by `pageDataHandlers.endpointPrefix` (default: `"/api"`)

Handler signature and return type:

- `registerDataLoaderHandler(pageType, handler)` or `registerDataLoaderHandler(pageType, version, handler)`
- Handler signature: `(originalRequest, params) => PageResponseEnvelope | APIResponseEnvelope`
  - `params.pageType`: the page type string you registered
  - `params.version`: version number used for this invocation
  - `params.invocation_origin`: `"http" | "internal"`
  - `params.route_params`: dynamic route params
  - `params.query_params`: URL query params
  - `params.request_path`: resolved request path used by the loader
  - `params.original_url`: full original URL

Guidance:

- Treat `params` as the authoritative routing context produced by the page data loader
- Do not reconstruct routing info from `originalRequest`
- Use `originalRequest` only for transport/ambient data (cookies, headers, IP, auth tokens)
- During SSR, `originalRequest` is the same request that initiated the render; after hydration, client-side loader fetches include their own transport context

Recommendation:

- Prefer using `APIResponseHelpers` (see README’s API Envelope section) to construct envelopes. These helpers also auto-populate `request_id` from `request.requestID` that your request registered middleware/plugins may populate.

Examples:

```ts
import { APIResponseHelpers } from "unirend/api-envelope";

// Unversioned handler (uses defaultVersion under the hood if versioned=true)
server.registerDataLoaderHandler("test", function (request, params) {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: "v-default", version: params.version },
    pageMetadata: { title: "Test", description: "Default version" },
  });
});

// Versioned handlers
server.registerDataLoaderHandler("test", 1, function (request, params) {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: "v1", version: params.version },
    pageMetadata: { title: "Test v1", description: "Version 1" },
  });
});

server.registerDataLoaderHandler("test", 2, function (request, params) {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: "v2", version: params.version },
    pageMetadata: { title: "Test v2", description: "Version 2" },
  });
});
```

With defaults (`pageDataHandlers.endpointPrefix = "/api"`, `pageDataHandlers.endpoint = "page_data"`, `versioned = true`), the following endpoints are available after the registration above:

- `POST /api/v1/page_data/test` → invokes version 1 handler
- `POST /api/v2/page_data/test` → invokes version 2 handler

If you disable versioning (`pageDataHandlers.versioned = false`), a single non‑versioned endpoint is exposed instead:

- `POST /api/page_data/test` → invokes the registered handler

Request body shape (from data loader):

```json
{
  "route_params": {
    /* dynamic segments */
  },
  "query_params": {
    /* URL query params */
  },
  "request_path": "/some/path",
  "original_url": "https://example.com/some/path?x=1"
}
```

Return a standardized Page Response Envelope. Status codes in the envelope are preserved and used for SSR HTTP status.

### Short-Circuit Data Handlers

When page data handlers are registered on the same `SSRServer` instance instead of a standalone API server, SSR can directly invoke the handler (short-circuit) instead of performing an HTTP fetch. The data loader passes the same routing context (`route_params`, `query_params`, `request_path`, `original_url`) to ensure consistent behavior. Use the HTTP path when you need cookie propagation to/from a backend API.

## Standalone API (APIServer)

The `APIServer` is a JSON API server with the same plugin surface. It’s intended for AJAX/fetch endpoints and can also host page data handlers for your page data endpoint if hosting the API endpoints as a standalone server.

### Basic usage

```typescript
import { serveAPI } from "unirend/server";

async function main() {
  const api = serveAPI({
    // Optional: page data handlers hosted on API server
    // pageDataHandlers: { endpoint: "page_data", versioned: true, defaultVersion: 1 },
    // Optional: plugins for custom routes, hooks, decorators
    // plugins: [myApiPlugin],
    // Optional: isDevelopment flag (affects error output/logging)
    // isDevelopment: true,
    // Optional: Fastify options (curated subset)
    // fastifyOptions: { logger: true },
    // Optional: error/notFound handlers (return envelope responses)
    // errorHandler: (request, error) => APIResponseHelpers.createAPIErrorResponse({ ... }),
    // notFoundHandler: (request) => APIResponseHelpers.createAPIErrorResponse({ statusCode: 404, ... }),
  });

  await api.listen(3001, "localhost");
}

main().catch(console.error);
```

### Options

- `plugins?: SSRPlugin[]`
- `pageDataHandlers?: PageDataHandlersConfig`
- `errorHandler?(request, error, isDevelopment, isPage?)`
  - Return a standardized API/Page envelope (JSON), not HTML
- `notFoundHandler?(request, isPage?)`
  - Return a standardized API/Page envelope (JSON) with 404, not HTML
- `isDevelopment?: boolean`
- `fastifyOptions?: { logger?; trustProxy?; bodyLimit?; keepAliveTimeout? }`

Note: Unlike SSR servers, the API server allows full wildcard routes (including root wildcards) in plugins.

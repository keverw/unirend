# Server-Side Rendering (SSR)

<!-- toc -->

- [Overview](#overview)
- [Server Classes](#server-classes)
  - [Plugins](#plugins)
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
  - [Reading server decorations](#reading-server-decorations)
  - [Environment flag in handlers](#environment-flag-in-handlers)
  - [Page Data Loader Handlers and Versioning](#page-data-loader-handlers-and-versioning)
  - [Short-Circuit Data Handlers](#short-circuit-data-handlers)
  - [Custom API Routes](#custom-api-routes)
    - [API route handler signature and parameters:](#api-route-handler-signature-and-parameters)
  - [Param Source Parity (Data Loader vs API Routes):](#param-source-parity-data-loader-vs-api-routes)
  - [Request Context Injection](#request-context-injection)
- [Standalone API (APIServer)](#standalone-api-apiserver)
  - [Basic usage](#basic-usage)
  - [Options](#options)
  - [Error Handling](#error-handling)
    - [JSON-Only (SSR Compatible)](#json-only-ssr-compatible)
    - [Split Handlers (Web Server Mode)](#split-handlers-web-server-mode)
- [WebSockets](#websockets)

<!-- tocstop -->

## Overview

**Server-Side Rendering (SSR)** renders your routes on each request and returns HTML with proper status codes and SEO metadata. Unirend provides dev and prod server helpers that return an `SSRServer` instance you can extend with plugins, page data loader handlers and API endpoints.

## Server Classes

Unirend provides two server classes with a shared plugin surface and common lifecycle methods:

- `SSRServer` (via `serveSSRDev`/`serveSSRProd`): Full SSR server that renders HTML responses for React Router routes. It can additionally be used to host your API endpoints, with the benefit of data loader handlers being short circuited.
- `APIServer` (via `serveAPI`): JSON API server for data loader endpoints and custom API routes (e.g., login, forms) that you wish to run as a separate standalone API server, separate from the server used for SSR rendering.

### Plugins

Both `SSRServer` (via `serveSSRDev`/`serveSSRProd`) and `APIServer` (via `serveAPI`) support plugin registration for extending functionality. Plugins can register middleware (including Fastify middleware), add custom hooks, and register raw API endpoints on top of Fastify that don't need to conform to the API envelope pattern like data loader handlers or Custom API Routes helpers do.

See the plugin docs: [server-plugins.md](./server-plugins.md) for an overview of the plugin system and how to create your own plugins, and [built-in-plugins.md](./built-in-plugins.md) for the catalog of ready‑to‑use plugins.

### Common Methods

Both server classes expose the same operational methods:

- `listen(port?: number, host?: string): Promise<void>` — Start the server
- `stop(): Promise<void>` — Stop the server
- `pageDataHandler.register(pageType, handler)` and `pageDataHandler.register(pageType, version, handler)` — Register backend page data loader handlers used by the frontend page data loaders
- `registerWebSocketHandler(config)` — Register a WebSocket handler (when `enableWebSockets` is true)
- `getWebSocketClients(): Set<unknown>` — Get the connected WebSocket clients (empty set when not supported/not started)
- `hasDecoration(property: string): boolean` — Check if a server-level decoration exists
- `getDecoration<T = unknown>(property: string): T | undefined` — Read a decoration value (undefined before listen)

## Create SSR Server

### Create Production SSR Server

Create a server file that uses the `serveSSRProd` function:

```typescript
import { serveSSRProd } from 'unirend/server';
import path from 'path';

async function main() {
  // Point to the build directory (contains both client/ and server/ subdirectories)
  const buildDir = path.resolve(__dirname, 'build');

  const server = serveSSRProd(buildDir, {
    // Optional: Custom server entry name (default: "entry-server")
    // serverEntry: "custom-entry",

    // Optional configuration object to be injected into the frontend app.
    // Serialized and injected as window.__FRONTEND_APP_CONFIG__ during SSR.
    // Available via useFrontendAppConfig() hook on both server and client.
    // Tip: Keep this minimal and non-sensitive; it will be passed to the client.
    frontendAppConfig: {
      apiUrl: process.env.API_URL || 'https://api.example.com',
      environment: 'production',
      // Optionally include selected build info for troubleshooting/version display.
      // See docs/build-info.md for generating/loading and safe exposure.
      // build: { version: "1.2.3" },
    },
    // Tip: See docs/build-info.md for adding a plugin that decorates request.buildInfo
  });

  const port = Number(process.env.PORT || 3000);
  await server.listen(port, 'localhost');
  console.log(`SSR server running on http://localhost:${port}`);
}

main().catch(console.error);
```

Notes:

- `frontendAppConfig` is passed to the Unirend context and available via the `useFrontendAppConfig()` hook on both server (during rendering) and client (after HTML injection).
- For accessing config in components vs non-component code (loaders), fallback patterns, and SPA-only dev mode considerations, see: [4. Frontend App Config Pattern](../README.md#4-frontend-app-config-pattern).

Host binding:

- For local development, `localhost` is fine. In containers or Kubernetes, bind to `0.0.0.0` (e.g., `await server.listen(port, "0.0.0.0")`) so the process is reachable from outside the container.

### Create Development SSR Server

Use `serveSSRDev(paths, options)` to run the SSR server in development with Vite middleware and HMR:

```typescript
import { serveSSRDev } from 'unirend/server';

async function main() {
  const server = serveSSRDev(
    {
      serverEntry: './src/entry-server.tsx',
      template: './index.html',
      viteConfig: './vite.config.ts',
    },
    {
      // Optional: same options surface as production where applicable
      // e.g., frontendAppConfig, apiEndpoints, APIHandling, containerID, plugins, fastifyOptions
      // frontendAppConfig: { apiUrl: "http://localhost:3001", environment: "development" },
      // apiEndpoints: { apiEndpointPrefix: "/api", versioned: true, pageDataEndpoint: "page_data" },
      // APIHandling: { errorHandler: ..., notFoundHandler: ... },
      // plugins: [myPlugin],
      // fastifyOptions: { logger: true },
    },
  );

  await server.listen(3000, 'localhost');
}

main().catch(console.error);
```

Notes:

- In dev, Vite serves client assets with middleware and `vite.ssrLoadModule` is used for the server entry.
- HMR is available. Stack traces are mapped for easier debugging.
- `frontendAppConfig` is injected in both development and production when using `serveSSRDev` or `serveSSRProd`.

### Organization Suggestion

Since your project will most likely use both `serveSSRDev` and `serveSSRProd`, consider these options:

- Single entry script that switches on an env/arg (dev vs prod) and calls `serveSSRDev` or `serveSSRProd`.
- Separate scripts (e.g., `serve-dev.ts` and `serve-prod.ts`).
- For production binaries, you can bundle your server script with a tool like Bun:
  - `bun build server.ts --outdir ./dist` and `bun run dist/server.js`
  - To run the Bun bundle under Node, add the target flag and start with Node:
    - `bun build server.ts --outdir ./dist --target node` then `node dist/server.js`

See a complete example with plugins and data handler registration in `demos/ssr/serve.ts`.

Recommendation: Use Bun for simplicity (dev runs TypeScript directly, prod bundles to JS that can run under Bun or Node). Pure Node alternatives (e.g., `tsc`, `esbuild`, `rollup`, `ts-node`) or vanilla JavaScript are possible but not covered in depth here to keep the setup simple and easy out of the box.

### SSRServer Class

The `SSRServer` class powers both dev and prod servers created via `serveSSRDev` (dev) or `serveSSRProd` (prod), which passes the proper configuration.

### Construction

- Dev: `serveSSRDev({ serverEntry, template, viteConfig }, options)`
  - Uses Vite middleware and `vite.ssrLoadModule` for HMR.
- Prod: `serveSSRProd(buildDir, options)`
  - Loads server entry from the Vite server manifest in `buildDir/<serverFolderName>`.

### Options (shared)

- `apiEndpoints?: APIEndpointConfig`
  - Shared versioned endpoint configuration used by page data and generic API routes.
  - `apiEndpointPrefix?: string | false` — API route prefix (default: `"/api"`). Set to `false` to disable API handling (SSR-only mode). Throws error on startup if routes are registered but API is disabled.
  - `versioned?: boolean` — Enable versioned endpoints like `/api/v1/...` (default: `true`)
  - `pageDataEndpoint?: string` — Endpoint name for page data loader handlers (default: `"page_data"`)
- `APIHandling?: { errorHandler?; notFoundHandler? }`
  - Custom error/not-found handlers for API requests (paths matching `apiEndpoints.apiEndpointPrefix`)
  - `errorHandler` and `notFoundHandler` return standardized API/Page error envelopes instead of HTML.
  - Both handlers receive an `isPageData` parameter to distinguish between different types of API requests:
    - **Page data requests** (`isPageData=true`): Requests to the page data endpoint (e.g., `/api/v1/page_data/home`) used by data loaders to fetch page data with metadata (title, description). These return Page Response Envelopes.
    - **Regular API requests** (`isPageData=false`): Standard API endpoints (e.g., `/api/v1/users`, `/api/v1/account/create`) for operations like creating accounts, updating data, etc. These return API Response Envelopes.
- `plugins?: ServerPlugin[]`
  - Register Fastify plugins via a controlled interface (see [plugins](./server-plugins.md)).
- `APIResponseHelpersClass?: typeof APIResponseHelpers`
  - Provide a custom helpers class for constructing API/Page envelopes. Useful to inject default metadata (e.g., account/site info) across responses.
  - If omitted, the built-in `APIResponseHelpers` is used.
  - Note: Validation helpers like `isValidEnvelope` use the base helpers and are not overridden by this option.
- `get500ErrorPage?: (request, error, isDevelopment) => string | Promise<string>`
  - Provide custom HTML for SSR 500 responses.
- `cookieForwarding?: { allowCookieNames?: string[]; blockCookieNames?: string[] | true }`
  - Controls which cookies are forwarded on SSR fetches and which `Set-Cookie` headers are returned to the browser.
- `frontendAppConfig?: Record<string, unknown>`
  - Optional configuration object available via the `useFrontendAppConfig()` hook on both server (during SSR/SSG rendering) and client (after HTML injection) in both dev and prod modes.
  - Use for runtime configuration (API URLs, feature flags, build info, etc.). See [4. Frontend App Config Pattern](../README.md#4-frontend-app-config-pattern) for usage in components vs loaders.
- `containerID?: string`
  - Client container element ID (default `"root"`).
- `clientFolderName?: string`, `serverFolderName?: string`
  - Names of subfolders inside the Vite build output (defaults: `client` and `server`).
- `fastifyOptions?: { logger?: boolean | FastifyLoggerOptions; trustProxy?; bodyLimit?; keepAliveTimeout? }`
  - Safe subset of Fastify server options.

### Options (prod-only)

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
  - `X-SSR-Original-IP`: The originating client IP
  - `X-SSR-Forwarded-User-Agent`: The client user agent
  - `X-Correlation-ID`: Unique request ID (useful for tracing)

  Notes:
  - Incoming spoofed values for these headers are removed, then trusted server values are set before making the request to the SSR API backend.
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

### Reading server decorations

Both SSR and API servers expose read-only helpers to access server-level decorations set by plugins:

```ts
// Example: read cookie plugin info if the cookies plugin is registered
const has = server.hasDecoration('cookiePluginInfo');
const info = server.getDecoration<{
  signingSecretProvided: boolean;
  algorithm: string;
}>('cookiePluginInfo');
```

### Environment flag in handlers

Within your request handlers (including page data loader handlers), you can check a boolean environment flag on the request to tailor behavior:

```ts
server.pageDataHandler.register('example', (request, params) => {
  const isDev = (request as FastifyRequest & { isDevelopment?: boolean })
    .isDevelopment;
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { environment: isDev ? 'development' : 'production' },
    pageMetadata: { title: 'Env', description: 'Env demo' },
  });
});
```

Notes:

- On the SSR server this reflects whether the server is running in development or production mode.
- On the API server this reflects `options.isDevelopment` (defaults to false).

### Page Data Loader Handlers and Versioning

The server can automatically expose versioned and non‑versioned page data endpoints based on your `apiEndpoints` configuration:

- Endpoint base: `apiEndpoints.pageDataEndpoint` (default: `"page_data"`)
- Versioning: when `apiEndpoints.versioned: true`, routes are exposed under `/v{n}/`
- Endpoint prefix: controlled by `apiEndpoints.apiEndpointPrefix` (default: `"/api"`)

Example paths (assuming `apiEndpointPrefix = "/api"`, `pageDataEndpoint = "page_data"`, and page type `home`):

- Versioned enabled (`versioned: true`):
  - Default version (e.g., 1): `POST /api/v1/page_data/home`
  - Explicit version 2: `POST /api/v2/page_data/home`
- Versioned disabled (`versioned: false`):
  - Single endpoint: `POST /api/page_data/home`

Handler signature and return type:

- `server.pageDataHandler.register(pageType, handler)` or `server.pageDataHandler.register(pageType, version, handler)`
- Handler signature: `(originalRequest, reply, params) => PageResponseEnvelope | APIResponseEnvelope`
- Handler parameters:
  - `originalRequest`: the Fastify request that initiated the render. Use only for transport/ambient data (cookies, headers, IP, auth tokens).
  - `reply`: controlled object scoped to this handler with:
    - `header(name, value)`
    - `getHeader(name)` / `getHeaders()` / `removeHeader(name)` / `hasHeader(name)` / `sent`
    - `setCookie(name, value, options?)` and `clearCookie(name, options?)` if `@fastify/cookie` is registered
  - `params`:
    - `pageType`: the page type string you registered
    - `version`: version number used for this invocation
    - `invocation_origin`: `"http" | "internal"`
    - `route_params`: dynamic route params
    - `query_params`: URL query params
    - `request_path`: resolved request path used by the loader
    - `original_url`: full original URL

Guidance:

- Treat `params` as the authoritative routing context produced by the page data loader
- Do not reconstruct routing info from `originalRequest`
- Use `originalRequest` only for transport/ambient data (cookies, headers, IP, auth tokens)
- Use `reply` to set additional headers and cookies when needed. HTTP status and JSON content-type are managed by the framework from the envelope
- During SSR, `originalRequest` is the same request that initiated the render. After hydration, client-side loader fetches include their own transport context

Recommendation:

- Prefer using `APIResponseHelpers` (see [API Envelope Structure](./api-envelope-structure.md)) to construct envelopes. These helpers also auto-populate `request_id` from `request.requestID` that your request registered middleware/plugins may populate.
- For custom meta defaults (account/workspace/locale/build), prefer extending `APIResponseHelpers` in a small subclass and reading decorated values from the request within that subclass. This applies to both page data loader/handlers and custom API route handlers. See: [Extending helpers and custom meta](./api-envelope-structure.md#extending-helpers-and-custom-meta).
  - Rationale: centralizes conventions and avoids repeating per-handler generics/typing. Just ensure your meta type extends `BaseMeta`.

Examples:

```ts
import { APIResponseHelpers } from 'unirend/api-envelope';

// Unversioned handler (defaults to version 1)
server.pageDataHandler.register('test', function (request, params) {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: 'version 1', version: params.version },
    pageMetadata: { title: 'Test', description: 'Version 1' },
  });
});

// Explicit versioned handlers
server.pageDataHandler.register('test', 2, function (request, params) {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: 'v2', version: params.version },
    pageMetadata: { title: 'Test v2', description: 'Version 2' },
  });
});

server.pageDataHandler.register('test', 3, function (request, params) {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: 'v3', version: params.version },
    pageMetadata: { title: 'Test v3', description: 'Version 3' },
  });
});
```

With defaults (`apiEndpoints.apiEndpointPrefix = "/api"`, `apiEndpoints.pageDataEndpoint = "page_data"`, `versioned = true`), the following endpoints are available after the registration above:

- `POST /api/v1/page_data/test` → invokes version 1 handler (from unversioned registration)
- `POST /api/v2/page_data/test` → invokes version 2 handler
- `POST /api/v3/page_data/test` → invokes version 3 handler

If you disable versioning (`apiEndpoints.versioned = false`), a single non‑versioned endpoint is exposed instead:

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

When page data loader handlers are registered on the same `SSRServer` instance instead of a standalone API server, SSR can directly invoke the handler (short-circuit) instead of performing an HTTP fetch. The data loader passes the same routing context (`route_params`, `query_params`, `request_path`, `original_url`) to ensure consistent behavior. Use the HTTP path when you need cookie propagation to/from a backend API.

### Custom API Routes

You can register versioned custom API routes using the server's `.api` shortcuts method surface (available on both `SSRServer` and `APIServer`, and inside plugins as `pluginHost.api`). These return standardized API envelopes and automatically set the HTTP response status to `status_code`.

```ts
import { APIResponseHelpers } from 'unirend/api-envelope';

// Register a simple GET endpoint at /api/v1/demo/echo/:id (with defaults)
server.api.get('demo/echo/:id', async (request) => {
  return APIResponseHelpers.createAPISuccessResponse({
    request,
    data: {
      message: 'Hello from API shortcuts',
      id: (request.params as Record<string, unknown>).id,
      query: request.query,
    },
    statusCode: 200,
  });
});

// Versioned registration example (explicit version 2)
server.api.post('demo/items', 2, async (request) => {
  const body = request.body as Record<string, unknown>;
  return APIResponseHelpers.createAPISuccessResponse({
    request,
    data: { created: true, version: 2, body },
    statusCode: 201,
  });
});
```

Notes:

- Endpoints are mounted under `apiEndpoints.apiEndpointPrefix` and optionally `/v{n}` when `versioned` is true.
- SSR servers disallow wildcard endpoints at root prefix. Use a non-root prefix like `/api` to allow wildcards.
- Handlers must return a valid API envelope. Status codes are taken from `status_code`.
- Available helpers: `.api.get`, `.api.post`, `.api.put`, `.api.delete`, `.api.patch`.

#### API route handler signature and parameters:

- Handler signature: `(request, reply, params) => APIResponseEnvelope`
- Handler parameters:
  - `request`: Fastify request
  - `reply`: controlled object with the same surface as data loader handlers:
    - `header(name, value)`
    - `getHeader(name)` / `getHeaders()` / `removeHeader(name)` / `hasHeader(name)` / `sent`
    - `setCookie(name, value, options?)` and `clearCookie(name, options?)` if `@fastify/cookie` is registered
  - `params`:
    - `method`: HTTP method
    - `endpoint`: endpoint segment (after version/prefix)
    - `version`: numeric version used
    - `fullPath`: full registered path
    - `route_params`: dynamic route params
    - `query_params`: URL query params
    - `request_path`: path without query
    - `original_url`: full original URL

### Param Source Parity (Data Loader vs API Routes):

- Both handlers receive a `params` object with a similar routing context, but the source differs:
  - Data loader handlers: `params` are produced by the frontend page data loader and sent in the POST body (SSR short-circuit passes the same shape internally for consistency). Treat this as the authoritative routing context for page data.
  - API route handlers: `params` are assembled on the server from Fastify’s request (route/query/path/URL). Use these directly for API endpoints.
- In both cases, the best practices is to use `originalRequest` (the Fastify request) only for transport/ambient data (cookies/headers/IP/auth), and use `reply` for headers/cookies you want on the HTTP response. This also makes it easy to port code between page data loader handlers and custom API handlers.

### Request Context Injection

SSR supports injecting per-request context data that will be available on the client.

**Request Context vs Frontend App Config:**

- **Request Context**: Per-page data that can vary between requests and be mutated on the client (e.g., page-specific state, user preferences, theme)
- **Frontend App Config**: Global, immutable configuration shared across all pages (e.g., API URLs, feature flags, build info)

**How It Works:**

The request context is shared across the entire request lifecycle and injected into the client HTML:

**Server Backend (Plugins/Middleware/Handlers):**

- Populate context by modifying `request.requestContext` in plugins, middleware, or route handlers
- Useful for injecting request-specific metadata (e.g., user session data, request timestamps, debug info, default theme)
- Example: In a plugin's `onRequest` or `preHandler` hook, set `request.requestContext.userID = "123"`

**React Components (Server & Client):**

- Components can read or update the context using Unirend Context hooks during server-side rendering and on the client
- The context acts as a key-value store initially populated by the server that components can take over on the frontend
- See [Unirend Context documentation](./unirend-context.md) for details on the available hooks and usage patterns

**Common Use Cases:**

For production-ready patterns including CSRF token management and hydration-safe theme consistency between server and client, see the [Advanced Patterns section](./unirend-context.md#advanced-patterns) in the Unirend Context documentation.

## Standalone API (APIServer)

The `APIServer` is a flexible server with a similar plugin surface to SSRServer, but without the React SSR machinery. Use it when you don't need server-side React rendering. Common use cases:

- **JSON API server**: AJAX/fetch endpoints with versioned routes and envelope responses, separately from your SSR server
- **Page data server**: Host page data loader handlers separately from your SSR server
- **Mixed API + web server**: Serve both JSON APIs and static HTML/assets without React (use split error handlers for HTML vs JSON responses)
- **Plain web server**: Set `apiEndpointPrefix: false` to disable API envelope handling entirely and serve only static content via plugins

### Basic usage

```typescript
import { serveAPI } from 'unirend/server';

async function main() {
  const api = serveAPI({
    // Optional: versioned endpoints configuration
    // apiEndpoints: { apiEndpointPrefix: "/api", versioned: true, pageDataEndpoint: "page_data" },
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

  await api.listen(3001, 'localhost');
}

main().catch(console.error);
```

### Options

- `plugins?: ServerPlugin[]`
- `apiEndpoints?: APIEndpointConfig`
  - `apiEndpointPrefix?: string | false` — API route prefix (default: `"/api"`). Set to `false` to disable API handling (server becomes a plain web server). Throws error on startup if routes are registered but API is disabled.
  - `versioned?: boolean` — Enable versioned endpoints like `/api/v1/...` (default: `true`)
  - `pageDataEndpoint?: string` — Endpoint name for page data loader handlers (default: `"page_data"`)
- `errorHandler?: Function | { api?, web? }`
  - Function form: Returns JSON envelope (see [JSON-Only](#json-only-ssr-compatible))
  - Object form: Split handlers for mixed API + web servers (see [Split Handlers](#split-handlers-web-server-mode)). Either handler can be omitted — missing handlers fall through to default behavior.
- `notFoundHandler?: Function | { api?, web? }`
  - Function form: Returns JSON envelope (see [JSON-Only](#json-only-ssr-compatible))
  - Object form: Split handlers for mixed API + web servers (see [Split Handlers](#split-handlers-web-server-mode)). Either handler can be omitted — missing handlers fall through to default behavior.
- `isDevelopment?: boolean`
- `fastifyOptions?: { logger?; trustProxy?; bodyLimit?; keepAliveTimeout? }`
- `APIResponseHelpersClass?: typeof APIResponseHelpers`
  - Provide a custom helpers class for constructing API/Page envelopes. Useful to inject default metadata (e.g., account/site info) across responses.
  - If omitted, the built-in `APIResponseHelpers` is used.
  - Note: Validation helpers like `isValidEnvelope` use the base helpers and are not overridden by this option.

Note: Unlike SSR servers, the API server allows full wildcard routes (including root wildcards) in plugins.

### Error Handling

Both `errorHandler` and `notFoundHandler` support two forms: a function (JSON-only) compatible with the SSR server config, or an object with split handlers (for mixed HTML/JSON servers).

#### JSON-Only (SSR Compatible)

The function form is compatible with the SSR server's `APIHandling.errorHandler` and `APIHandling.notFoundHandler`. Use this when your API server only returns JSON responses:

```typescript
import { serveAPI } from 'unirend/server';
import { APIResponseHelpers } from 'unirend/api-envelope';

const server = serveAPI({
  // Custom error handler - returns JSON envelope
  errorHandler: (request, error, isDevelopment, isPageData) => {
    // isPageData distinguishes page data requests from regular API requests
    return APIResponseHelpers.createAPIErrorResponse({
      request,
      statusCode: 500,
      errorCode: 'internal_error',
      errorMessage: isDevelopment ? error.message : 'Internal server error',
      errorDetails: isDevelopment ? { stack: error.stack } : undefined,
    });
  },

  // Custom 404 handler - returns JSON envelope
  notFoundHandler: (request, isPageData) => {
    return APIResponseHelpers.createAPIErrorResponse({
      request,
      statusCode: 404,
      errorCode: 'not_found',
      errorMessage: `Endpoint not found: ${request.url}`,
    });
  },
});
```

This is the same signature used by SSR server's `APIHandling` options (see [Options (shared)](#options-shared) above), making it easy to share handler logic between SSR and standalone API servers. The `isPageData` parameter distinguishes page data loader handler requests from regular API requests.

#### Split Handlers (Web Server Mode)

When using the API server as a **standalone API/web server** (serving both HTML pages and JSON APIs without the built-in React SSR), use the split form to return different response types.

Either `api` or `web` handler can be omitted — missing handlers fall through to the default JSON envelope behavior when not provided:

```typescript
import { serveAPI } from 'unirend/server';
import { staticContent } from 'unirend/plugins';
import { APIResponseHelpers } from 'unirend/api-envelope';

const server = serveAPI({
  apiEndpoints: { apiEndpointPrefix: '/api' },

  plugins: [
    // Serve static files (HTML, CSS, JS, images)
    staticContent({
      folderMap: { '/static': './public' },
    }),
  ],

  // Split form - different responses for API vs web
  notFoundHandler: {
    // API requests (paths starting with /api/) get JSON envelope
    api: (request, isPageData) =>
      APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 404,
        errorCode: 'not_found',
        errorMessage: `Endpoint not found: ${request.url}`,
      }),

    // Web requests (everything else) get HTML
    web: (request) => ({
      contentType: 'html',
      content: `<!DOCTYPE html>
        <html>
          <body>
            <h1>404 - Page Not Found</h1>
            <p>The page ${request.url} could not be found.</p>
            <a href="/">Go home</a>
          </body>
        </html>`,
      statusCode: 404,
    }),
  },

  // Same pattern works for errorHandler
  errorHandler: {
    api: (request, error, isDev, isPageData) =>
      APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 500,
        errorCode: 'internal_error',
        errorMessage: isDev ? error.message : 'Internal server error',
      }),

    web: (request, error, isDev) => ({
      contentType: 'html',
      content: `<!DOCTYPE html>
        <html>
          <body>
            <h1>500 - Server Error</h1>
            ${isDev ? `<pre>${error.stack}</pre>` : '<p>Something went wrong.</p>'}
          </body>
        </html>`,
      statusCode: 500,
    }),
  },
});
```

The `WebErrorResponse` type for web handlers:

```typescript
interface WebErrorResponse {
  contentType: 'html' | 'text' | 'json';
  content: string | object;
  statusCode?: number; // defaults to 500 for errors, 404 for not found
}
```

**API vs Web Detection:**

The server uses `apiEndpoints.apiEndpointPrefix` (default `/api`) to detect API requests. This includes versioned paths:

- `/api/health` → API (starts with `/api`)
- `/api/v1/page_data/home` → API (starts with `/api`)
- `/api/v2/users/123` → API (starts with `/api`)
- `/static/index.html` → Web (doesn't start with `/api`)
- `/about` → Web (doesn't start with `/api`)

This means all your API endpoints (including versioned ones under `/api/v1/`, `/api/v2/`, etc.) are detected as API requests, while everything else is treated as web requests.

## WebSockets

Both `SSRServer` and `APIServer` support WebSockets. Enable with `enableWebSockets: true` and register handlers via `server.registerWebSocketHandler({ path, preValidate?, handler })`.

See full guide and examples: [WebSockets](./websockets.md).

# Server-Side Rendering (SSR)

<!-- toc -->

- [Overview](#overview)
- [Server Classes](#server-classes)
  - [Plugins](#plugins)
  - [Common Methods](#common-methods)
  - [Shared Server Configuration](#shared-server-configuration)
    - [Logging](#logging)
- [HTTPS Configuration](#https-configuration)
- [Create SSR Server](#create-ssr-server)
  - [Create Production SSR Server](#create-production-ssr-server)
  - [Create Development SSR Server](#create-development-ssr-server)
  - [Organization Suggestion](#organization-suggestion)
  - [SSRServer Class](#ssrserver-class)
  - [Construction](#construction)
  - [SSR Options](#ssr-options)
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
- [Multi-App SSR Support](#multi-app-ssr-support)
  - [Usage Example](#usage-example)
    - [Production Mode](#production-mode)
    - [Development Mode](#development-mode)
  - [API Reference](#api-reference)
  - [Routing Strategies](#routing-strategies)
    - [1. Subdomain-Based Routing](#1-subdomain-based-routing)
    - [2. Path-Based Routing](#2-path-based-routing)
    - [3. Cookie-Based Routing](#3-cookie-based-routing)
  - [Important Notes](#important-notes)
    - [Mode Enforcement](#mode-enforcement)
    - [Shared Resources](#shared-resources)
    - [Per-App Resources](#per-app-resources)
    - [Resource Considerations](#resource-considerations)
    - [Validation](#validation)
- [Standalone API (APIServer)](#standalone-api-apiserver)
  - [Basic usage](#basic-usage)
  - [API-Specific Options](#api-specific-options)
  - [Error Handling](#error-handling)
    - [JSON-Only (SSR Compatible)](#json-only-ssr-compatible)
    - [Web-Only (Plain Web Server)](#web-only-plain-web-server)
    - [Split Handlers (Mixed API + Web Server)](#split-handlers-mixed-api--web-server)
- [Graceful Shutdown](#graceful-shutdown)
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

### Shared Server Configuration

The following options are accepted by both `SSRServer` and `APIServer`:

- `apiEndpoints?: APIEndpointConfig`
  - Shared versioned endpoint configuration used by page data and generic API routes.
  - `apiEndpointPrefix?: string | false` — API route prefix (default: `"/api"`). Set to `false` to disable API handling. Throws error on startup if routes are registered but API is disabled.
  - `versioned?: boolean` — Enable versioned endpoints like `/api/v1/...` (default: `true`). **Note**: This defaults to `true`, which means routes registered with `server.api.*` helpers will be under `/api/v{n}/...`. When using `processFileUpload()`, this also affects the paths you must specify in `fileUploads.allowedRoutes` on your SSR or standalone API server config.
  - `pageDataEndpoint?: string` — Endpoint name for page data loader handlers (default: `"page_data"`)
- `plugins?: ServerPlugin[]`
  - Register Fastify plugins via a controlled interface (see [plugins](./server-plugins.md)).
- `fileUploads?: { enabled: boolean; limits?: { fileSize?, files?, fields?, fieldSize? }; allowedRoutes?: string[]; preValidation?: Function }`
  - Enable built-in multipart file upload support.
  - Set global limits that can be overridden per-route using `processFileUpload()`.
  - Default limits: `fileSize: 10MB`, `files: 10`, `fields: 10`, `fieldSize: 1KB`
  - `allowedRoutes` (optional): List of routes/patterns that allow multipart uploads. Supports wildcards (e.g. `/api/workspace/*/upload`). When specified, automatically rejects multipart requests to other routes (prevents bandwidth waste and DoS attacks).
    - **Important**: When using `apiEndpoints.versioned: true` (the default), routes are exposed under `/api/v{n}/...`, so `allowedRoutes` must include the version prefix. Example: use `['/api/v1/upload/avatar']` instead of `['/api/upload/avatar']`. Only use unversioned paths if you explicitly set `versioned: false`.
  - `preValidation` (optional): Async function for header-based validation (auth, rate limiting, etc.) that runs after user plugin hooks but before multipart parsing. Return `true` to allow or error object to reject.
  - See [File Upload Helpers](./file-upload-helpers.md) for detailed usage and examples.
- `APIResponseHelpersClass?: typeof APIResponseHelpers`
  - Provide a custom helpers class for constructing API/Page envelopes. Useful to inject default metadata (e.g., account/site info) across responses.
  - If omitted, the built-in `APIResponseHelpers` is used.
  - Note: Validation helpers like `isValidEnvelope` use the base helpers and are not overridden by this option.
- `logging?: { logger; level? }`
  - Framework-level logger object adapted to Fastify under the hood.
  - Use this for a simpler, framework-consistent logger API (works for both SSR and standalone API server).
  - `logger` must provide all level methods (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).
  - `level` sets the adapter's minimum level (default: `"info"`).
  - If a logger write throws, Unirend tries `logger.error` and then falls back to `globalThis.reportError` (when available) and `console.error`.
  - **Important:** Exactly one logging source can be configured: `logging`, `fastifyOptions.logger`, or `fastifyOptions.loggerInstance`. Configuring multiple sources will cause an error on server startup.
- `logErrors?: boolean`
  - Whether to automatically log errors via the server logger (default: `true`).
  - When enabled, all request errors are logged before custom error handlers run with URL, method, and error details.
  - This is especially useful when using custom error pages that can't show dynamic stack traces.
  - Set to `false` to disable automatic error logging if you prefer to handle logging in custom error handlers.
  - **Note:** This applies to SSRServer, APIServer, StaticWebServer, and RedirectServer.
- `fastifyOptions?: { logger?: boolean | FastifyLoggerOptions; loggerInstance?: FastifyBaseLogger; disableRequestLogging?: boolean; trustProxy?; bodyLimit?; keepAliveTimeout? }`
  - Safe subset of Fastify server options.
  - `loggerInstance` must satisfy Fastify's base logger interface (`info`, `error`, `debug`, `fatal`, `warn`, `trace`, `silent`, `level`) and support `child(bindings, options)`.
  - `logger` is Fastify's built-in logger option (boolean or pino options), for example `true` or `{ level: "info" }`.
  - `loggerInstance` is for passing an existing pino (or pino-compatible) logger instance.
  - With logging enabled, Fastify logs request lifecycle events (access-style logs like incoming/completed requests) and your plugin/app logs from `fastify.log` / `request.log`.
  - `disableRequestLogging` defaults to `false`.
  - Set `disableRequestLogging: true` to keep logger usage enabled while disabling Fastify's default incoming/completed request logs. This applies the same way whether you use `logging`, `fastifyOptions.logger`, or `fastifyOptions.loggerInstance`.
  - No separate middleware is required for baseline access logs. For custom fields or custom start/completion messages, add `onRequest`/`onResponse` hooks in a plugin (see [Plugin Host Methods -> Hooks](./server-plugins.md#hooks) and [Access Logging Plugin](./server-plugins.md#access-logging-plugin)).

#### Logging

**Which logging approach should I use?**

- **`logging`** (Recommended): Simpler, framework-consistent API. Works identically for SSR and API servers. Best when you need custom logging (external services, structured logs, special handling).
- **`fastifyOptions.logger`**: Quick out-of-the-box console logger using pino. Best when you just want basic logs to console without external integrations.
- **`fastifyOptions.loggerInstance`**: Pass an existing pino-compatible logger instance. Use when sharing a logger across multiple services or more advanced logging requirements.

Logging behavior quick reference:

- `logger: true`
  - Enables Fastify logger at default level (`info`).
  - Emits default request lifecycle logs (`incoming request`, `request completed`).
- `disableRequestLogging: true`
  - Disables Fastify's automatic incoming/completed request logs regardless of logger level.
  - Your own `fastify.log.*`, `request.log.*`, and hook-based logs still work.
  - Works the same with `logging`, `fastifyOptions.logger`, or `fastifyOptions.loggerInstance`.
- `logger: { level: 'warn' }`
  - Enables logger but sets minimum level to `warn`.
  - Request lifecycle logs (`info` level) won't appear.
  - **Tip:** If you want to disable the built-in request logs and implement your own custom access logging (with additional fields like user ID, tenant, etc.), use `disableRequestLogging: true` and add your own logging via hooks in a plugin. See [Access Logging Plugin](./server-plugins.md#access-logging-plugin) for an example.
- `loggerInstance`
  - Uses your provided pino/pino-compatible logger object.

Built-in request log event shape:

- Request start:
  - message: `"incoming request"`
  - level: `info`
  - context typically includes: `reqId` (Fastify `request.id`) and `req`
- Request completion:
  - message: `"request completed"`
  - level: `info`
  - context typically includes: `reqId` (Fastify `request.id`), `res`, `responseTime`
- Unhandled route/handler error (`500` path):
  - an additional `error`-level event is emitted (message is usually the error message), then completion log still runs.

When using Unirend `logging`, these become `logger.info(message, context)` / `logger.error(message, context)` calls through the adapter.

**Note:** `reqId` in Fastify's logs is the Fastify request identifier (`request.id`), which is an incremental counter by default. This is separate from `request.requestID` used by Unirend envelope helpers and the clientInfo plugin, which is a globally unique identifier (ULID) that's better for distributed systems (e.g., multiple servers behind a load balancer) and correlating requests across services.

If you need a strict payload shape, prefer custom `onRequest`/`onResponse` hooks and build the exact context object you want to emit.

Example Unirend logger object (recommended path):

```typescript
import { serveSSRProd } from 'unirend/server';

const server = serveSSRProd('./build', {
  logging: {
    level: 'info',
    logger: {
      trace: (message, context) => console.trace(message, context),
      debug: (message, context) => console.debug(message, context),
      info: (message, context) => console.info(message, context),
      warn: (message, context) => console.warn(message, context),
      error: (message, context) => console.error(message, context),
      fatal: (message, context) => console.error(message, context),
    },
  },
  fastifyOptions: {
    disableRequestLogging: true,
  },
});
```

If you prefer Fastify/pino configuration directly, use `fastifyOptions.logger` or `fastifyOptions.loggerInstance`:

```typescript
import { serveSSRProd } from 'unirend/server';

const server = serveSSRProd('./build', {
  fastifyOptions: {
    logger: true,
    // or:
    // logger: { level: 'info' },
    // loggerInstance: existingPinoOrCompatibleLogger,
    // disableRequestLogging: true,
  },
});
```

For custom request-start/completion access logs, see [Access Logging Plugin](./server-plugins.md#access-logging-plugin).

## HTTPS Configuration

Both server classes support HTTPS with static certificates, SNI callbacks for multi-tenant dynamic certificate selection, and an HTTP→HTTPS redirect server.

See the full HTTPS Configuration guide: [https.md](./https.md)

## Create SSR Server

### Create Production SSR Server

Create a server file that uses the `serveSSRProd` function:

```typescript
import { serveSSRProd } from 'unirend/server';
import path from 'path';

async function main() {
  // Build directory (contains both client/ and server/ subdirectories)
  const buildDir = path.resolve(__dirname, 'build');

  const server = serveSSRProd(buildDir, {
    // Optional: Custom server entry name (default: "entry-server" - looks for entry-server.js in server manifest)
    // serverEntry: "custom-entry",

    // Optional: Custom HTML template path relative to buildDir (default: "client/index.html")
    // template: "dist/app.html",

    // Optional: CDN base URL for asset URL rewriting (rewrites <script src> and <link href> at runtime)
    // CDNBaseURL: process.env.CDN_BASE_URL,  // e.g., 'https://cdn.example.com'

    // Optional configuration object to be injected into the frontend app.
    // Serialized and injected as window.__FRONTEND_APP_CONFIG__ during SSR.
    // Available via useFrontendAppConfig() hook on both server and client.
    // Tip: Keep this minimal and non-sensitive, it will be passed to the client.
    frontendAppConfig: {
      apiUrl: process.env.API_URL || 'https://api.example.com',
      environment: 'production',
      // Optionally include selected build info for troubleshooting/version display.
      // See docs/build-info.md for generating/loading and safe exposure.
      // build: { version: "1.2.3" },
    },

    // Optional: API endpoint configuration (defaults shown)
    // apiEndpoints: { apiEndpointPrefix: "/api", versioned: true, pageDataEndpoint: "page_data" },

    // Optional: Custom error/not-found handlers for API requests
    // APIHandling: { errorHandler: (request, error, isDev, isPageData) => {...}, notFoundHandler: (request, isPageData) => {...} },

    // Optional: Custom container ID (default: "root")
    // containerID: "app",

    // Optional: SSR render timeout in milliseconds (default: 5000)
    // ssrRenderTimeout: 10000, // 10 seconds for pages with slow data loaders

    // Optional: Server plugins
    // plugins: [myPlugin],

    // Optional: Static content configuration
    // - Default (omit): Serves from buildDir/client/assets at /assets with immutable asset detection
    // - false: Disable static serving (e.g., when using a CDN)
    // - Custom config: Provide your own folderMap/singleAssetMap configuration
    // staticContentRouter: {
    //   folderMap: { '/custom': './build/client/custom' },
    // },

    // Optional: Custom 500 error page generator (for catastrophic SSR failures)
    // get500ErrorPage: async (request, error, isDevelopment) => {
    //   return `<html><body><h1>Server Error</h1></body></html>`;
    // },

    // Tip: See docs/build-info.md for adding a plugin that decorates request.buildInfo
  });

  const port = Number(process.env.PORT || 3000);
  await server.listen(port, 'localhost');
  console.log(`SSR server running on http://localhost:${port}`);
}

main().catch(console.error);
```

> **🐳 Container Deployment:** When deploying in containers, bind to `0.0.0.0` to make the server accessible from outside the container: `await server.listen(port, '0.0.0.0')`. For local development, the default binding is fine.

Notes:

- `frontendAppConfig` is passed to the Unirend context and available via the `useFrontendAppConfig()` hook on both server (during rendering) and client (after HTML injection).
- For accessing config in components vs non-component code (loaders), fallback patterns, and SPA-only dev mode considerations, see: [4. Frontend App Config Pattern](../README.md#4-frontend-app-config-pattern).

**Per-Request CDN Override Example:**

You can override the CDN URL per-request in middleware for region-specific CDNs:

```typescript
const server = serveSSRProd(buildDir, {
  // Default CDN URL
  CDNBaseURL: 'https://cdn.example.com',
});

// Override CDN URL based on user region
server.fastifyInstance.addHook('onRequest', async (request, reply) => {
  // Detect region (via IP geolocation, cookie, header, etc.)
  const region = detectRegion(request);

  if (region === 'EU') {
    (request as any).CDNBaseURL = 'https://eu-cdn.example.com';
  } else if (region === 'APAC') {
    (request as any).CDNBaseURL = 'https://apac-cdn.example.com';
  }
  // Falls back to default CDNBaseURL if not overridden
});
```

HTML Template:

- **Production mode**:
  - **Default**: Loads from `buildDir/client/index.html`
  - **Custom path**: Use `template` option to specify a different path relative to `buildDir` (e.g., `template: "dist/app.html"` loads from `buildDir/dist/app.html`)
  - **Custom folder**: Use `clientFolderName` to change the folder but keep `index.html` as filename (e.g., `clientFolderName: 'dist-client'` loads from `buildDir/dist-client/index.html`)
  - **Caching**: The template is loaded once at server startup and cached in memory for performance. Restart the server to pick up template changes.
  - The template file must exist in your build output (generated by your Vite build process)

### Create Development SSR Server

Use `serveSSRDev(paths, options)` to run the SSR server in development with Vite middleware and HMR:

```typescript
import { serveSSRDev } from 'unirend/server';

async function main() {
  const server = serveSSRDev(
    {
      // Required: paths for development mode (no defaults, must be specified)
      serverEntry: './src/entry-server.tsx', // Your server entry file
      template: './index.html', // HTML template file
      viteConfig: './vite.config.ts', // Vite config file
    },
    {
      // Optional configuration object to be injected into the frontend app.
      // Serialized and injected as window.__FRONTEND_APP_CONFIG__ during SSR.
      // Available via useFrontendAppConfig() hook on both server and client.
      // Tip: Keep this minimal and non-sensitive, it will be passed to the client.
      frontendAppConfig: {
        apiUrl: process.env.API_URL || 'http://localhost:3001',
        environment: 'development',
      },

      // Optional: API endpoint configuration (defaults shown)
      // apiEndpoints: { apiEndpointPrefix: "/api", versioned: true, pageDataEndpoint: "page_data" },

      // Optional: Custom error/not-found handlers for API requests
      // APIHandling: { errorHandler: (request, error, isDev, isPageData) => {...}, notFoundHandler: (request, isPageData) => {...} },

      // Optional: Custom container ID (default: "root")
      // containerID: "app",

      // Optional: SSR render timeout in milliseconds (default: 5000)
      // ssrRenderTimeout: 10000, // 10 seconds for pages with slow data loaders

      // Optional: Server plugins
      // plugins: [myPlugin],

      // Optional: Custom 500 error page generator (for catastrophic SSR failures)
      // get500ErrorPage: async (request, error, isDevelopment) => {
      //   return `<html><body><h1>Server Error</h1></body></html>`;
      // },
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
- **HTML Template**: The `template` path in development mode is fully customizable. Specify any HTML file path (e.g., `./index.html`, `./src/app.html`, etc.). The template is read fresh on each request and transformed by Vite for HMR support.

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

### SSR Options

In addition to the [shared server configuration](#shared-server-configuration), SSR servers (both dev and prod) accept:

- `APIHandling?: { errorHandler?; notFoundHandler? }`
  - Custom error/not-found handlers for API requests (paths matching `apiEndpoints.apiEndpointPrefix`)
  - `errorHandler` and `notFoundHandler` return standardized API/Page error envelopes instead of HTML.
  - Both handlers receive an `isPageData` parameter to distinguish between different types of API requests:
    - **Page data requests** (`isPageData=true`): Requests to the page data endpoint (e.g., `/api/v1/page_data/home`) used by data loaders to fetch page data with metadata (title, description). These return Page Response Envelopes.
    - **Regular API requests** (`isPageData=false`): Standard API endpoints (e.g., `/api/v1/users`, `/api/v1/account/create`) for operations like creating accounts, updating data, etc. These return API Response Envelopes.
- `frontendAppConfig?: Record<string, unknown>`
  - Optional configuration object available via the `useFrontendAppConfig()` hook on both server (during SSR/SSG rendering) and client (after HTML injection) in both dev and prod modes.
  - Use for runtime configuration (API URLs, feature flags, build info, etc.). See [4. Frontend App Config Pattern](../README.md#4-frontend-app-config-pattern) for usage in components vs loaders.
- `containerID?: string`
  - Client container element ID (default `"root"`).
- `ssrRenderTimeout?: number`
  - Timeout in milliseconds for the SSR render fetch request. If the render takes longer than this, the request is aborted and a 500 error page is returned.
  - Default: `5000` (5 seconds). Increase for pages with slow data loaders or complex rendering.
- `cookieForwarding?: { allowCookieNames?: string[]; blockCookieNames?: string[] | true }`
  - Controls which cookies are forwarded on SSR fetches and which `Set-Cookie` headers are returned to the browser.
- `get500ErrorPage?: (request, error, isDevelopment) => string | Promise<string>`
  - Provide custom HTML for SSR 500 responses.
  - **Security Note**: When including dynamic values (error messages, URLs, etc.) in your HTML, always escape them using `escapeHTML` from `unirend/utils` to prevent XSS attacks. React automatically escapes content, but raw HTML generation requires manual escaping.
- `clientFolderName?: string`, `serverFolderName?: string`
  - Names of subfolders inside the Vite build output (defaults: `client` and `server`).

### Options (prod-only)

- `serverEntry?: string`
  - Name of the server entry in manifest (default `"entry-server"`).
- `template?: string`
  - Custom HTML template path relative to `buildDir` (default: `"client/index.html"`).
  - Example: `template: "dist/app.html"` loads from `buildDir/dist/app.html`.
  - The template is loaded once at server startup and cached in memory. Restart the server to pick up template changes.
  - Alternatively, use `clientFolderName` to change the folder but keep `index.html` as filename.
- `CDNBaseURL?: string`
  - CDN base URL for runtime asset URL rewriting (e.g., `'https://cdn.example.com'`).
  - Rewrites `<script src>` and `<link href>` attributes in the HTML template to use the CDN instead of relative paths.
  - Only affects absolute paths starting with `/` (e.g., `/assets/main.js` becomes `https://cdn.example.com/assets/main.js`).
  - **Runtime flexibility**: During template processing, absolute URLs are converted to placeholders. The actual CDN URL is injected per-request, allowing:
    - **Per-request override**: Set `request.CDNBaseURL` in middleware to override the CDN URL for specific requests (e.g., region-specific CDNs)
    - **App-level default**: Falls back to the `CDNBaseURL` option configured in `serveSSRProd()` or `registerProdApp()`
    - **No CDN**: If neither is set, original `/assets/...` paths are preserved
  - Useful for serving assets from a CDN without build-time configuration changes.
  - Tip: Set via environment variable (e.g., `CDNBaseURL: process.env.CDN_BASE_URL`) in `serveSSRProd()` or `registerProdApp()` options for deployment flexibility, or override per-request in middleware for region-specific CDN selection.
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
  - See `src/lib/internal/ssr-server.ts` and `src/lib/router-utils/page-data-loader.ts` for where they are set and forwarded.

- Cookie forwarding policy (SSR):
  - Configure via `cookieForwarding` in the SSR options (dev and prod):

    ```ts
    // serveSSRDev(paths, options) or serveSSRProd(buildDir, options)
    {
      cookieForwarding: {
        // If both are empty/undefined: allow all cookies
        allowCookieNames: ["sid", "theme"],
        // Always takes precedence over allow list, can also be true to block ALL cookies
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
    - Name-based filtering only, attributes on `Set-Cookie` are preserved as-is

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

**Page Type Convention:** Page types should be specified as path segments WITHOUT leading slashes (e.g., `'home'` not `'/home'`). Leading slashes are allowed but will be stripped during normalization. This treats page types as segments appended to the API prefix, version, and page data endpoint, rather than as absolute paths.

**Multi-Project Pattern:** Page types can include slashes to group handlers by project namespace. This is useful when hosting multiple projects on the same API server (e.g., monorepos, such as separate marketing/app sites):

```typescript
// Group by project
server.pageDataHandler.register('marketing/home', handler);
server.pageDataHandler.register('marketing/about', handler);
server.pageDataHandler.register('accounts/dashboard', handler);
server.pageDataHandler.register('accounts/settings', handler);
```

Frontend loaders use the same grouped page types:

```typescript
// marketing/routes.tsx
export const homeLoader = createPageDataLoader(config, 'marketing/home');

// accounts/routes.tsx
export const dashboardLoader = createPageDataLoader(
  config,
  'accounts/dashboard',
);
```

This creates endpoints like:

- `POST /api/v1/page_data/marketing/home`
- `POST /api/v1/page_data/accounts/dashboard`

**Note:** Internal slashes are preserved - only leading/trailing slashes are stripped during normalization. Use this pattern to organize handlers when serving multiple projects from a single API server.

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
    - `invocationOrigin`: `"http" | "internal"`
    - `routeParams`: dynamic route params
    - `queryParams`: URL query params
    - `requestPath`: resolved request path used by the loader
    - `originalURL`: full original URL

Guidance:

- Treat `params` as the authoritative routing context produced by the page data loader
- Do not reconstruct routing info from `originalRequest`
- Use `originalRequest` only for transport/ambient data (cookies, headers, IP, auth tokens)
- Use `reply` to set additional headers and cookies when needed. HTTP status and JSON content-type are managed by the framework from the envelope
- During SSR, `originalRequest` is the same request that initiated the render. After hydration, client-side loader fetches include their own transport context

Recommendation:

- Prefer using `APIResponseHelpers` (see [API Envelope Structure](./api-envelope-structure.md)) to construct envelopes. These helpers also auto-populate `request_id` from `request.requestID` that your request registered middleware/plugins may populate.
- For custom meta defaults (account/workspace/locale/build), prefer extending `APIResponseHelpers` in a small subclass and reading decorated values from the request within that subclass. This applies to both page data loaders/handlers and custom API route handlers. See: [Extending helpers and custom meta](./api-envelope-structure.md#extending-helpers-and-custom-meta).
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

**Note on Short-Circuit Versioning:** When handlers are registered on the same `SSRServer` instance (enabling short-circuit optimization), SSR automatically selects the **highest version** registered during the initial server render. Client-side navigation after hydration uses HTTP requests and can target specific versions via the URL path. See [Short-Circuit Versioning Behavior](#short-circuit-data-handlers) for details on version consistency between SSR and client-side navigation.

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

**Handling Redirects:**

Page data loader handlers can return redirect responses using `APIResponseHelpers.createPageRedirectResponse()`. The page data loader automatically converts these to React Router redirects for proper client-side navigation:

```ts
// Example: Redirect after checking permissions
server.pageDataHandler.register('protected-page', async (request) => {
  const { isAuthorized } = await checkUserPermissions(request);

  if (!isAuthorized) {
    return APIResponseHelpers.createPageRedirectResponse({
      request,
      target: '/login',
      permanent: false,
      preserve_query: true, // Keeps ?returnTo=/protected-page
    });
  }

  // ... return page data
});
```

**Important:** HTTP-level redirects (301/302 status codes) are **blocked** by the page data loader using `redirect: 'manual'`. This prevents security issues from following untrusted redirects. Always use the envelope redirect format shown above. See [API Envelope Structure docs](./api-envelope-structure.md#redirects-in-api-responses) for details.

### Short-Circuit Data Handlers

When page data loader handlers are registered on the same `SSRServer` instance instead of a standalone API server, SSR **automatically** invokes the handler directly (short-circuit) instead of performing an HTTP fetch **during the initial server-side render**. The data loader passes the same routing context (converted from POST body `route_params`, `query_params`, `request_path`, `original_url` to handler params `routeParams`, `queryParams`, `requestPath`, `originalURL`) to ensure consistent behavior.

**When Short-Circuit Happens:**

- ✅ **Initial SSR page load**: When the server renders the page, short-circuit is used if a handler is registered on the SSR server
- ❌ **Client-side navigation**: After hydration, browser navigations always use HTTP fetch (even if handler is on SSR server)
- ❌ **No opt-out**: Short-circuit is automatic during SSR - you cannot force HTTP fetch if a handler is registered on the SSR server

**Short-Circuit Versioning Behavior:**

When using versioned page data handlers (see [Page Data Loader Handlers and Versioning](#page-data-loader-handlers-and-versioning)), short-circuit and HTTP requests behave differently:

- **Short-circuit (SSR initial load)**: Automatically selects the **highest version** registered for the page type. This ensures SSR always serves fresh HTML with the latest handler logic.
- **HTTP requests (client-side navigation)**: Explicitly target a specific version via the URL path (e.g., `/api/v1/page_data/home` vs `/api/v2/page_data/home`), determined by your frontend loader's `pageDataEndpoint` configuration.

**Version Consistency Considerations:**

- If you have multiple versions registered (v1, v2, v3), SSR short-circuit will always use v3 (the highest), while client-side HTTP requests can target specific versions via `pageDataEndpoint` configuration.
- **Same version everywhere**: Configure your frontend loader's `pageDataEndpoint` to match the highest version (e.g., `/api/v3/page_data`) for consistency between SSR and client-side navigation.
- **Mixed versions (gradual rollout)**: Older cached client bundles can target older versions via HTTP (e.g., `/api/v1/page_data`), while SSR and new bundles use the highest version. This supports gradual updates without breaking cached bundles.
- **Strict version isolation**: If you need different frontends using different versions without automatic highest-version selection, use separate API servers instead of short-circuit.

**Architecture Options:**

1. **Single Server (Short-circuit during SSR):**
   - Register handlers on your `SSRServer` using `server.pageDataHandler.register()`
   - **Initial page load (SSR)**: Framework automatically short-circuits (no HTTP fetch)
   - **Client-side navigation**: Browser makes HTTP POST to the same server
   - Handler receives the original Fastify request with full cookie access
   - Faster initial renders (no network overhead), simpler deployment (single process)
   - Use when you don't need architectural separation

2. **Separate API Server (Always HTTP fetch):**
   - Run a standalone `APIServer` on a different port/host
   - Register handlers on the API server using `apiServer.pageDataHandler.register()`
   - Configure your SSR page data loader config with `APIBaseURL` pointing to the API server
   - **Initial page load (SSR)**: SSR server makes HTTP POST to API server
   - **Client-side navigation**: Browser makes HTTP POST to API server
   - Cookies are automatically forwarded in both directions via HTTP headers
   - Use when you need to scale or deploy SSR and API separately

**Cookie Access:**

Both architectures have full cookie access - there's no capability difference:

- **Short-circuit (SSR initial load)**: Handler accesses `request.cookies` directly (same Fastify request from browser)
- **HTTP fetch (client navigation OR separate API server)**: Cookies automatically forwarded via `Cookie` header; responses forwarded back via `Set-Cookie`

To use cookies, register the `cookies` plugin (see [cookies plugin docs](./built-in-plugins/cookies.md)):

```typescript
import { cookies } from 'unirend/plugins';

const server = serveSSRDev(paths, {
  plugins: [cookies({ secret: process.env.COOKIE_SECRET })],
});

// In your handler (works identically for both architectures)
server.pageDataHandler.register('profile', (request, reply) => {
  // Read cookies
  const sessionId = (request as any).cookies?.sid;

  // Set cookies
  reply.setCookie?.('theme', 'dark', {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
  });

  return /* envelope */;
});
```

**Note:** The framework handles the architecture choice automatically - you don't need to change your handler code when switching between single-server and separate-server deployments.

### Custom API Routes

You can register versioned custom API routes using the server's `.api` shortcuts method surface (available on both `SSRServer` and `APIServer`, and inside plugins as `pluginHost.api`). These return standardized API envelopes and automatically set the HTTP response status to `status_code`.

**Endpoint Convention:** Endpoints should be specified as path segments WITHOUT leading slashes (e.g., `'demo/echo/:id'` not `'/demo/echo/:id'`). Leading slashes are allowed but will be stripped during normalization. This treats endpoints as segments appended to the API prefix and version, rather than as absolute paths.

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
    - `routeParams`: dynamic route params
    - `queryParams`: URL query params
    - `requestPath`: path without query
    - `originalURL`: full original URL

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

**Design Philosophy:**

Both `SSRServer` and `APIServer` automatically initialize `request.requestContext` as an empty object on every request. This ensures:

- Handlers never need to check if `requestContext` exists - it's always at least `{}`
- Code written for SSR can run on a standalone API server with consistent behavior
- Plugins and middleware can safely write to `requestContext` without initialization checks

**How It Works:**

The request context is shared across the entire request lifecycle and injected into the client HTML:

**Server Backend (Plugins/Middleware/Handlers):**

- Populate context by modifying `request.requestContext` in plugins, middleware, or route handlers
- Useful for injecting request-specific metadata (e.g., user session data, request timestamps, debug info, default theme)
- Example: In a plugin's `onRequest` or `preHandler` hook, set `request.requestContext.userID = "123"`

**React Components (Server & Client):**

- Components can read or update the context using Unirend Context hooks during server-side rendering and on the client
- The context acts as a key-value store initially sent by the server that components can take over on the frontend
- See [Unirend Context documentation](./unirend-context.md) for details on the available hooks and usage patterns

**Important - Client-Side Updates:**

Request context is only automatically sent to the client during SSR (initial page load). After client-side mutations like login/logout, the client context is **not** automatically updated from the server.

**Recommended approach:** Manually update the client context using `useRequestContext()` hook after mutations:

```tsx
const { setRequestContextValue } = useRequestContext();

async function handleLogin(credentials) {
  const response = await loginAPI(credentials);
  // Manually update client context after successful login
  setRequestContextValue('userID', response.data.userID);
  // Add other context values as needed (isAuthenticated, etc.)
}
```

**Alternative:** Trigger a full page reload (outside React Router) using `window.location.href = '/dashboard'` to get fresh SSR with updated context. This is simpler but slower and loses client-side state.

**Syncing Auth State from Page Data:**

When a session expires and the page data loader redirects to login (via 401 `authentication_required`), the client context still has stale auth state. To fix this, sync auth state from page data `meta` to context:

```tsx
// In your app layout component
import { useLoaderData } from 'react-router';
import { useRequestContext } from 'unirend/context';
import { useEffect } from 'react';

function AppLayout() {
  const data = useLoaderData();
  const { setRequestContextValue } = useRequestContext();

  // Sync auth state from page data meta to context on every navigation
  useEffect(() => {
    if (data?.meta?.account) {
      setRequestContextValue('userID', data.meta.account.userID ?? null);
      // Add other context values as needed (isAuthenticated, etc.)
    }
  }, [data?.meta?.account, setRequestContextValue]);

  // ... rest of layout
}
```

This ensures context stays in sync with server auth state, even after session expiry or logout from another tab.

**Separated SSR/API Architecture:**

When your SSR server and API server are separate instances, request context is automatically forwarded:

1. **SSR Server** populates `request.requestContext` in plugins/hooks
2. **Page Data Loader** sends `ssr_request_context` in POST body to external API server
3. **API Server** receives and populates `request.requestContext` from incoming `ssr_request_context`
4. **API Handler** can read/modify `request.requestContext` normally
5. **API Envelope Response Helpers** automatically include `request.requestContext` in the `ssr_request_context` field of page response envelopes
6. **Page Data Loader** merges `ssr_request_context` from response back into SSR request (API values overwrite SSR values for conflicting keys, if set by prior middleware)
7. **SSR Render** injects final merged context into HTML for client hydration

This forwarding is automatic and transparent - handlers work the same whether co-located or separated. The merge in step 6 uses `Object.assign()`, so if both SSR middleware and the API handler set the same key, the API handler's value wins since it runs later in the request flow.

**Security Note:** For separated architecture, the API server **must** use the `clientInfo` plugin to validate that `ssr_request_context` comes from a trusted SSR server (private IP by default). Without this plugin, `ssr_request_context` in the request body will be ignored to prevent spoofing from untrusted clients.

**Common Use Cases:**

For production-ready patterns including CSRF token management and hydration-safe theme consistency between server and client, see the [Advanced Patterns section](./unirend-context.md#advanced-patterns) in the Unirend Context documentation.

## Multi-App SSR Support

A single `SSRServer` instance can serve **multiple distinct React applications**, switchable via middleware based on request context (subdomain, path, headers, etc.). This is valuable for:

- **Monorepo deployments**: Serve marketing + app sites from one server
- **Subdomain routing**: `marketing.example.com` vs `app.example.com` with different builds
- **A/B testing**: Different frontend builds for experimentation
- **Resource efficiency**: Consolidate multiple frontend projects into one server process

**Key Features:**

- **Mode enforcement**: Dev server = dev apps only, prod server = prod apps only
- **Per-app configuration**: Each app gets its own `frontendAppConfig`, templates, static assets, and error pages
- **Shared resources**: API handlers, plugins, and cookie policies are shared across all apps

### Usage Example

#### Production Mode

```typescript
import { serveSSRProd } from 'unirend/server';

// Create server with default app
const server = serveSSRProd('./build-main', {
  frontendAppConfig: { apiUrl: 'https://api.example.com' },
});

// Register additional apps - each supports the same options as serveSSRProd()
server.registerProdApp('marketing', './build-marketing', {
  // App-specific frontend config (injected into client)
  frontendAppConfig: { apiUrl: 'https://marketing-api.example.com' },

  // Optional: Custom server entry (default: "entry-server")
  // serverEntry: 'custom-entry',

  // Optional: Custom HTML template (default: "client/index.html")
  // template: 'dist/marketing.html',

  // Optional: CDN base URL for asset URL rewriting
  // CDNBaseURL: process.env.CDN_BASE_URL,

  // Optional: Custom folder names (default: 'client' and 'server')
  // clientFolderName: 'dist-client',
  // serverFolderName: 'dist-server',

  // Optional: Custom container ID (default: 'root')
  // containerID: 'marketing-root',

  // Optional: Custom 500 error page
  // get500ErrorPage: async (request, error, isDevelopment) => {
  //   return `<html><body><h1>Marketing Error</h1></body></html>`;
  // },

  // Optional: Static content configuration
  // - Default (omit): Serves from buildDir/client/assets at /assets with immutable asset detection
  // - false: Disable static serving (e.g., when using a CDN)
  // - Custom config: Provide your own folderMap/singleAssetMap configuration
  // staticContentRouter: {
  //   folderMap: { '/assets': './build-marketing/client/assets' },
  // },
});

// Route requests to the correct app via middleware
server.fastifyInstance.addHook('onRequest', async (request, reply) => {
  const subdomain = request.hostname.split('.')[0];

  if (subdomain === 'marketing') {
    request.activeSSRApp = 'marketing';
  } else if (subdomain === 'admin') {
    request.activeSSRApp = 'admin';
  }
  // Falls back to '__default__' (main app) if not set
});

await server.listen(3000);
```

#### Development Mode

```typescript
import { serveSSRDev } from 'unirend/server';

const server = serveSSRDev(
  {
    serverEntry: './src/entry-server.tsx',
    template: './index.html',
    viteConfig: './vite.config.ts',
  },
  {
    frontendAppConfig: { apiUrl: 'http://localhost:3001' },
  },
);

// Register additional apps - each supports the same options as serveSSRDev()
server.registerDevApp(
  'marketing',
  {
    serverEntry: './src/marketing/entry-server.tsx',
    template: './src/marketing/index.html',
    viteConfig: './vite.marketing.config.ts',
  },
  {
    // App-specific frontend config (injected into client)
    frontendAppConfig: { apiUrl: 'http://localhost:3002' },

    // Optional: Custom folder names (default: 'client' and 'server')
    // clientFolderName: 'dist-client',
    // serverFolderName: 'dist-server',

    // Optional: Custom container ID (default: 'root')
    // containerID: 'marketing-root',

    // Optional: Custom 500 error page
    // get500ErrorPage: async (request, error, isDevelopment) => {
    //   return `<html><body><h1>Marketing Dev Error</h1></body></html>`;
    // },
  },
);

// Routing middleware (same as production)
server.fastifyInstance.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/marketing')) {
    request.activeSSRApp = 'marketing';
  }
});

await server.listen(3000);
```

### API Reference

**registerProdApp(appKey, buildDir, options?)**

Register an additional production-mode app. Must be called **before** `listen()`.

- `appKey`: Unique identifier (used in `request.activeSSRApp`). Cannot be `"__default__"` or contain path separators.
- `buildDir`: Path to the app's build directory
- `options`: Same options as `serveSSRProd()` (e.g., `frontendAppConfig`, `staticContentRouter`, etc.)

**registerDevApp(appKey, paths, options?)**

Register an additional development-mode app. Must be called **before** `listen()`.

- `appKey`: Unique identifier (used in `request.activeSSRApp`). Cannot be `"__default__"` or contain path separators.
- `paths`: Dev paths object (same as `serveSSRDev()`)
- `options`: Same options as `serveSSRDev()` (e.g., `frontendAppConfig`, etc.)

**Static Content Defaults (Production Only)**

Each production app (both main and registered) automatically serves static assets unless `staticContentRouter` is explicitly set:

- **Default behavior**: Serves files from `buildDir/<clientFolderName>/assets` at the `/assets` URL path
- **Immutable assets**: Fingerprinted files (e.g., `main-abc123.js`) get `Cache-Control: public, max-age=31536000, immutable`
- **Disable**: Set `staticContentRouter: false` to disable (useful when using a CDN)
- **Customize**: Provide your own `staticContentRouter` configuration to change paths or add additional folders

Each registered app gets its own independent static content configuration based on its `buildDir` and `clientFolderName`.

### Routing Strategies

#### 1. Subdomain-Based Routing

```typescript
server.fastifyInstance.addHook('onRequest', async (request, reply) => {
  const subdomain = request.hostname.split('.')[0];

  switch (subdomain) {
    case 'marketing':
      request.activeSSRApp = 'marketing';
      break;
    case 'app':
      request.activeSSRApp = 'app';
      break;
    // Falls back to '__default__' for main domain
  }
});
```

#### 2. Path-Based Routing

```typescript
server.fastifyInstance.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/marketing')) {
    request.activeSSRApp = 'marketing';
  } else if (request.url.startsWith('/admin')) {
    request.activeSSRApp = 'admin';
  }
});
```

**Important**: When using path-based routing, your React Router routes must match the path prefix to avoid hydration errors. For example, if routing to the `marketing` app on `/marketing/*`, define routes like `/marketing/home`, `/marketing/about`, etc.

#### 3. Cookie-Based Routing

```typescript
// Set A/B variant cookie
server.fastifyInstance.addHook('onRequest', async (request, reply) => {
  // Check for existing variant cookie
  let variant = request.cookies['ab-variant'];

  // Assign variant if not set (50/50 split)
  if (!variant) {
    variant = Math.random() < 0.5 ? 'a' : 'b';

    reply.setCookie('ab-variant', variant, {
      maxAge: 30 * 24 * 60 * 60, // 30 days
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto', // sets Secure when over HTTPS
    });
  }

  // Route based on variant
  if (variant === 'b') {
    request.activeSSRApp = 'variant-b';
  }
  // Falls back to '__default__' for variant A
});
```

**Note**: This approach uses cookies to maintain consistent variant assignment across requests. The cookie settings align with [recommended patterns](./built-in-plugins/cookies.md#recommended-patterns) for first-party session cookies.

### Important Notes

#### Mode Enforcement

- Production servers (via `serveSSRProd`) can only register production apps with `registerProdApp()`
- Development servers (via `serveSSRDev`) can only register development apps with `registerDevApp()`
- This prevents mode mixing and simplifies deployment

#### Shared Resources

These resources are shared across all apps:

- **API handlers**: All `pageDataHandler.register()` and custom API routes are shared across apps. To organize handlers for multiple apps, use the [Multi-Project Pattern](#page-data-loader-handlers-and-versioning) with namespaced page types (e.g., `marketing/home`, `app/dashboard`).
- **API error handling**: `APIHandling` (custom error/not-found handlers) is shared across all apps. These are server-level handlers, not per-app configuration.
- **Plugins**: Plugins registered via `plugins` option apply to all apps
- **Cookie policy**: Cookie forwarding rules (`cookieForwarding`) apply to all apps. **Important**: Apps should be on the same base domain (e.g., `example.com`, `www.example.com`, `app.example.com`, `marketing.example.com`) to share cookies safely. For cross-domain apps (e.g., `myapp.com` and `partner.com`), use separate server instances.
- **WebSockets**: WebSocket handlers are shared across apps

#### Per-App Resources

These resources are configured independently for each app:

- **Error pages**: `get500ErrorPage` is per-app. Each app uses its own custom error page if specified, otherwise falls back to the framework's built-in default error page
- **CDN configuration**: `CDNBaseURL` is per-app. Each app can use its own CDN base URL for asset delivery
- **Static content**: Each app serves its own static assets from its `buildDir` and `clientFolderName`, or provide a custom `staticContentRouter` configuration (production only)
- **HTML template**: Each app uses its own HTML template from its build directory
- **Frontend app config**: Each app can have its own `frontendAppConfig` injected as `window.__FRONTEND_APP_CONFIG__`

#### Resource Considerations

- Each Vite instance (dev mode) uses ~50-100MB of memory
- Each static content cache (prod mode) uses ~50MB of memory
- **HMR Ports (dev mode)**: Each app's Vite instance gets a unique HMR WebSocket port automatically assigned as `port + 1000 + index` (e.g., if server runs on port 3000, HMR ports are 4000, 4001, 4002, etc.). No manual configuration needed.
- **Recommendation**: Limit to 3-5 apps per server instance for optimal performance

#### Validation

- Apps must be registered **before** calling `listen()`
- Attempting to access a non-existent app key throws an error with available apps listed
- App keys cannot contain path separators (`/` or `\`)

## Standalone API (APIServer)

The `APIServer` is a flexible, general-purpose server with a similar plugin surface to SSRServer, but without the React SSR machinery. Think of it as an alternative to Fastify or Express, but designed to work seamlessly within the Unirend ecosystem with built-in support for plugins, page data loader endpoints (with versioning), and envelope responses.

Use it when you don't need server-side React rendering. Common use cases:

- **JSON API server**: AJAX/fetch endpoints with versioned routes and envelope responses, separately from your SSR server
- **Page data server**: Host page data loader handlers separately from your SSR server
- **Mixed API + web server**: Serve both JSON APIs and static HTML/assets without React (use split error handlers for HTML vs JSON responses)
- **Generic HTTP server**: Use as a general-purpose HTTP server (similar to Fastify/Express) with Unirend's plugin system. Set `apiEndpointPrefix: false` to disable API envelope handling and serve custom content via plugins

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
    // Optional: Unirend logging abstraction
    // logging: {
    //   logger: {
    //     trace: (message, context) => console.trace(message, context),
    //     debug: (message, context) => console.debug(message, context),
    //     info: (message, context) => console.info(message, context),
    //     warn: (message, context) => console.warn(message, context),
    //     error: (message, context) => console.error(message, context),
    //     fatal: (message, context) => console.error(message, context),
    //   },
    // },
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

> **🐳 Container Deployment:** For container deployments, see the [container binding note](#create-production-ssr-server) in the SSR section - the same advice applies to APIServer.

### API-Specific Options

In addition to the [shared server configuration](#shared-server-configuration), the API server accepts:

- `isDevelopment?: boolean`
  - Affects error output/logging behavior. Defaults to `false`.
- `errorHandler?: Function | { api?, web? }`
  - Function form: Returns JSON envelope (see [JSON-Only](#json-only-ssr-compatible))
  - Object form: Split handlers for mixed API + web servers (see [Split Handlers](#split-handlers-mixed-api--web-server)). Either handler can be omitted — missing handlers fall through to default behavior.
- `notFoundHandler?: Function | { api?, web? }`
  - Function form: Returns JSON envelope (see [JSON-Only](#json-only-ssr-compatible))
  - Object form: Split handlers for mixed API + web servers (see [Split Handlers](#split-handlers-mixed-api--web-server)). Either handler can be omitted — missing handlers fall through to default behavior.

Note: Unlike SSR servers, the API server allows full wildcard routes (including root wildcards) in plugins.

### Error Handling

Both `errorHandler` and `notFoundHandler` support two forms: a simple function or an object with split handlers. Choose based on your server type:

- **API-only server** (JSON responses): Use function form returning API envelopes
- **Web-only server** (`apiEndpointPrefix: false`): Use function form returning `WebErrorResponse` (HTML/text)
- **Mixed API + web server**: Use split form with separate `api` and `web` handlers

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

**Convention: stack traces in development** When writing custom JSON error handlers, include `errorDetails: isDevelopment ? { stack: error.stack } : undefined` so that stack traces appear in development error responses. This matches the convention used by the built-in page data loader and the default error handler. Components like `GenericError` in the SSR demo look for `error.details.stack` to display stack traces during development. See [Error Handling - Error Responses with Stack Trace](./error-handling.md#5-error-responses-with-stack-trace-development-only) for more details.

#### Web-Only (Plain Web Server)

When using APIServer as a plain web server (`apiEndpointPrefix: false`), use the function form returning `WebErrorResponse`:

```typescript
import { serveAPI } from 'unirend/server';
import { staticContent } from 'unirend/plugins';
import { escapeHTML } from 'unirend/utils';

const server = serveAPI({
  // Disable API handling - plain web server mode
  apiEndpoints: { apiEndpointPrefix: false },

  plugins: [
    // Serve static files (HTML, CSS, JS, images)
    staticContent({
      folderMap: { '/': './public' },
    }),
  ],

  // Simple function form - returns HTML/text
  notFoundHandler: (request) => ({
    contentType: 'html',
    content: `<!DOCTYPE html>
      <html>
        <body>
          <h1>404 - Page Not Found</h1>
          <p>The page ${escapeHTML(request.url)} could not be found.</p>
          <a href="/">Go home</a>
        </body>
      </html>`,
    statusCode: 404,
  }),

  errorHandler: (request, error, isDev) => ({
    contentType: 'html',
    content: `<!DOCTYPE html>
      <html>
        <body>
          <h1>500 - Server Error</h1>
          ${isDev ? `<pre>${escapeHTML(error.stack || '')}</pre>` : '<p>Something went wrong.</p>'}
        </body>
      </html>`,
    statusCode: 500,
  }),
});
```

**Note**: When `apiEndpointPrefix: false`, all requests are treated as web requests, so split handlers would only use the `web` path. The simple function form is clearer for this use case.

#### Split Handlers (Mixed API + Web Server)

When serving **both** JSON APIs and web content on the same server, use the split form to return different response types based on the request:

Both `api` and `web` handlers are optional. If a handler is omitted or throws an error, the error is logged to the Fastify logger and the server falls back to the default response for that request type (JSON envelope for API requests, default error page for web requests). Check your server logs to debug handler failures:

```typescript
import { serveAPI } from 'unirend/server';
import { staticContent } from 'unirend/plugins';
import { APIResponseHelpers } from 'unirend/api-envelope';
import { escapeHTML } from 'unirend/utils';

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
    // ⚠️ Security: Always escape dynamic values when returning HTML to prevent XSS
    web: (request) => ({
      contentType: 'html',
      content: `<!DOCTYPE html>
        <html>
          <body>
            <h1>404 - Page Not Found</h1>
            <p>The page ${escapeHTML(request.url)} could not be found.</p>
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
        errorDetails: isDev ? { stack: error.stack } : undefined,
      }),

    // ⚠️ Security: Always escape dynamic values when returning HTML to prevent XSS
    web: (request, error, isDev) => ({
      contentType: 'html',
      content: `<!DOCTYPE html>
        <html>
          <body>
            <h1>500 - Server Error</h1>
            ${isDev ? `<pre>${escapeHTML(error.stack || '')}</pre>` : '<p>Something went wrong.</p>'}
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

**Security Note**: When returning HTML with dynamic values (URLs, error messages, etc.), always escape them using `escapeHTML` from `unirend/utils` to prevent XSS attacks. React components automatically escape content, but raw HTML generation in error handlers requires manual escaping.

**API vs Web Detection:**

The server uses `apiEndpoints.apiEndpointPrefix` (default `/api`) to detect API requests. This includes versioned paths:

- `/api/health` → API (starts with `/api`)
- `/api/v1/page_data/home` → API (starts with `/api`)
- `/api/v2/users/123` → API (starts with `/api`)
- `/static/index.html` → Web (doesn't start with `/api`)
- `/about` → Web (doesn't start with `/api`)

This means all your API endpoints (including versioned ones under `/api/v1/`, `/api/v2/`, etc.) are detected as API requests, while everything else is treated as web requests.

## Graceful Shutdown

Both `SSRServer` and `APIServer` support graceful shutdown via the `stop()` method. In production, you should handle process signals to cleanly shut down the server:

```typescript
import { serveSSRProd } from 'unirend/server';
import type { SSRServer } from 'unirend/server';
let server: SSRServer | null = null;

async function main() {
  server = serveSSRProd('./build', {
    /* options */
  });

  await server.listen(3000, 'localhost');
  console.log('Server running on http://localhost:3000');
}

// Handle graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Shutting down...`);

  try {
    if (server && server.isListening()) {
      await server.stop();
      server = null; // Clear reference after successful shutdown
      console.log('Server stopped gracefully');
    }
  } catch (err) {
    console.error('Error during shutdown:', err);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch(console.error);
```

Notes:

- `SIGINT` is sent when you press Ctrl+C in the terminal
- `SIGTERM` is the standard signal sent by process managers and orchestrators for graceful termination
- The `stop()` method closes all active connections and stops accepting new requests
- Calling `stop()` multiple times is safe - it checks if the server is listening and returns early if already stopped
- In your process signal handlers, check `server && server.isListening()` before calling `stop()` to ensure the server exists and is running
- When WebSockets are enabled, the `preClose` hook is called before closing connections (see [WebSockets](./websockets.md))
- Set the server reference to `null` after shutdown to release resources and prevent accidental reuse
- Declare the server variable (`let server: SSRServer | null = null`) before defining the shutdown handler so it's in scope. Before creating a new server instance, check for an existing one, and handle it appropriately (eg. stop it first, and then create new one)
- If you dynamically create or reassign server instances, consider using a factory function that returns a fresh server, see [Lifecycle and Persistence](./server-plugins.md#lifecycle-and-persistence) for details on how routes and handlers persist across `stop()`/`listen()` cycles

## WebSockets

Both `SSRServer` and `APIServer` support WebSockets. Enable with `enableWebSockets: true` and register handlers via `server.registerWebSocketHandler({ path, preValidate?, handler })`.

See full guide and examples: [WebSockets](./websockets.md).

# Server-Side Rendering (SSR)

<!-- toc -->

- [Overview](#overview)
- [Server Classes](#server-classes)
  - [Plugins](#plugins)
  - [Common Methods](#common-methods)
  - [Shared Server Configuration](#shared-server-configuration)
    - [Logging](#logging)
    - [Access Logging](#access-logging)
      - [Events](#events)
      - [Template Variables](#template-variables)
      - [Additional Context in Log Output](#additional-context-in-log-output)
      - [IP Behind a Reverse Proxy](#ip-behind-a-reverse-proxy)
      - [Level Config](#level-config)
      - [Client Abort Handling](#client-abort-handling)
      - [Fire-and-Forget Work Inside Hooks](#fire-and-forget-work-inside-hooks)
      - [Runtime Config Updates](#runtime-config-updates)
      - [Pattern: DB Request Tracing](#pattern-db-request-tracing)
- [HTTPS Configuration](#https-configuration)
- [Create SSR Server](#create-ssr-server)
  - [Create Production SSR Server](#create-production-ssr-server)
  - [Create Development SSR Server](#create-development-ssr-server)
  - [Asset Serving vs Runtime Behavior](#asset-serving-vs-runtime-behavior)
  - [Organization Suggestion](#organization-suggestion)
  - [SSRServer Class](#ssrserver-class)
  - [Construction](#construction)
  - [SSR Options](#ssr-options)
  - [Options (Prod-Only)](#options-prod-only)
  - [Template Slots](#template-slots)
  - [Header and Cookies Forwarding](#header-and-cookies-forwarding)
  - [Reading Server Decorations](#reading-server-decorations)
  - [Environment Flag in Handlers](#environment-flag-in-handlers)
    - [isDevelopment](#isdevelopment)
    - [clientIP and serverLabel](#clientip-and-serverlabel)
    - [domainInfo](#domaininfo)
    - [isStaticAsset](#isstaticasset)
  - [Page Data Loader Handlers and Versioning](#page-data-loader-handlers-and-versioning)
  - [Short-Circuit Data Handlers](#short-circuit-data-handlers)
  - [Customizing Server-Side Page Data Requests](#customizing-server-side-page-data-requests)
    - [Callback Signature](#callback-signature)
    - [Example: URL Rewriting / Internal Load Balancing](#example-url-rewriting--internal-load-balancing)
    - [Example: TLS Over a Private Network (NodeAdapter)](#example-tls-over-a-private-network-nodeadapter)
  - [Custom API Routes](#custom-api-routes)
    - [API Route Handler Signature and Parameters:](#api-route-handler-signature-and-parameters)
  - [Param Source Parity (Data Loader vs API Routes):](#param-source-parity-data-loader-vs-api-routes)
  - [Request Context Injection](#request-context-injection)
- [Multi-App SSR Support](#multi-app-ssr-support)
  - [Monorepo Structure Tip](#monorepo-structure-tip)
  - [Usage Example](#usage-example)
    - [Production Mode](#production-mode)
    - [Development Mode](#development-mode)
  - [API Reference](#api-reference)
    - [CDN Deployments](#cdn-deployments)
  - [Routing Strategies](#routing-strategies)
    - [1. Subdomain-Based Routing](#1-subdomain-based-routing)
    - [2. Path-Based Routing](#2-path-based-routing)
    - [3. Cookie-Based Routing](#3-cookie-based-routing)
  - [Important Notes](#important-notes)
    - [Mode Enforcement](#mode-enforcement)
    - [Shared Resources](#shared-resources)
    - [Per-App Resources](#per-app-resources)
    - [Resource Considerations](#resource-considerations)
    - [Error Page Patterns](#error-page-patterns)
    - [Validation](#validation)
- [Standalone API (APIServer)](#standalone-api-apiserver)
  - [Basic Usage](#basic-usage)
  - [Unix Socket Listening](#unix-socket-listening)
  - [API-Specific Options](#api-specific-options)
  - [API Error Handlers](#api-error-handlers)
    - [JSON-Only (SSR Compatible)](#json-only-ssr-compatible)
    - [Web-Only (Plain Web Server)](#web-only-plain-web-server)
    - [Split Handlers (Mixed API + Web Server)](#split-handlers-mixed-api--web-server)
- [Graceful Shutdown](#graceful-shutdown)
  - [Force Shutdown](#force-shutdown)
- [WebSockets](#websockets)

<!-- tocstop -->

## Overview

**Server-Side Rendering (SSR)** renders your routes on each request and returns HTML with proper status codes and SEO metadata. Unirend provides dev and prod server helpers that return an `SSRServer` instance you can extend with plugins, page data loader handlers and API endpoints.

## Server Classes

Unirend provides two server classes with a shared plugin surface and common lifecycle methods:

- `SSRServer` (via `serveSSRWithHMR`/`serveSSRBuilt`): Full SSR server that renders HTML responses for React Router routes. It can additionally be used to host your API endpoints, with the benefit of data loader handlers being short circuited.
- `APIServer` (via `serveAPI`): JSON API server for data loader endpoints and custom API routes (e.g., login, forms) that you wish to run as a separate standalone API server, separate from the server used for SSR rendering.

### Plugins

Both `SSRServer` (via `serveSSRWithHMR`/`serveSSRBuilt`) and `APIServer` (via `serveAPI`) support plugin registration for extending functionality. Plugins can register middleware (including Fastify middleware), add custom hooks, and register raw API endpoints on top of Fastify that don't need to conform to the API envelope pattern like data loader handlers or Custom API Routes helpers do.

See the plugin docs: [server-plugins.md](./server-plugins.md) for an overview of the plugin system and how to create your own plugins, and [built-in-plugins.md](./built-in-plugins.md) for the catalog of ready‑to‑use plugins.

### Common Methods

Both server classes expose the same operational methods:

- `listen(port?: number, host?: string): Promise<void>` - Start the server
- `stop(): Promise<void>` - Gracefully stop the server (waits for in-flight requests, then closes)
- `closeAllConnections(): void` - Immediately terminate current HTTP/WebSocket/HMR connections without stopping the listening server by itself. Use as a low-level escalation helper during shutdown. Also available on `StaticWebServer` and `RedirectServer`.
- `pageDataHandler.register(pageType, handler)` and `pageDataHandler.register(pageType, version, handler)` - Register backend page data loader handlers used by the frontend page data loaders
- `registerWebSocketHandler(config)` - Register a WebSocket handler (when `enableWebSockets` is true)
- `getWebSocketClients(): Set<unknown>` - Get the connected WebSocket clients (empty set when not supported/not started)
- `hasDecoration(property: string): boolean` - Check if a server-level decoration exists
- `getDecoration<T = unknown>(property: string): T | undefined` - Read a decoration value (undefined before listen)
- `updateAccessLoggingConfig(partial: Partial<AccessLogConfig>): void` - Update access logging configuration at runtime (partial merge). Only provided keys are changed - omitted keys remain unchanged. Also available on `StaticWebServer` and `RedirectServer`.

### Shared Server Configuration

The following options are accepted by both `SSRServer` and `APIServer`:

- `apiEndpoints?: APIEndpointConfig`
  - Shared versioned endpoint configuration used by page data and generic API routes.
  - `apiEndpointPrefix?: string | false` - API route prefix (default: `"/api"`). Set to `"/"` for a full-root API server where all paths are treated as API paths. Set to `false` to disable API handling. Throws error on startup if routes are registered but API is disabled.
  - `versioned?: boolean` - Enable versioned endpoints like `/api/v1/...` (default: `true`). **Note**: This defaults to `true`, which means routes registered with `server.api.*` helpers will be under `/api/v{n}/...`. When using `processFileUpload()`, this also affects the paths you must specify in `fileUploads.allowedRoutes` on your SSR or standalone API server config.
  - `pageDataEndpoint?: string` - Endpoint name for page data loader handlers (default: `"page_data"`)
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
- `publicAppConfig?: Record<string, unknown>`
  - Safe-to-share application config cloned and frozen per request as `request.publicAppConfig`.
  - On SSR, the same request snapshot is available through `usePublicAppConfig()` and injected as `window.__PUBLIC_APP_CONFIG__`.
  - On API servers, it is request-local only. It is not injected into HTML and is not bridged or merged between SSR and API servers.
  - If your separated SSR and API servers both will need these values, pass the same source object or shared imported config to both servers. Mutating that source by reference between requests updates future request clones globally.
- `logging?: { logger; level? }`
  - Framework-level logger object adapted to Fastify under the hood.
  - Use this for a simpler, framework-consistent logger API (works for both SSR and standalone API server).
  - `logger` must provide all level methods (`trace`, `debug`, `info`, `warn`, `error`, `fatal`).
  - `level` sets the adapter's minimum level (default: `"info"`).
  - If a logger write throws, Unirend tries `logger.error` and then falls back to `globalThis.reportError` (when available) and `console.error`.
  - **Important:** Exactly one logging source can be configured: `logging`, `fastifyOptions.logger`, or `fastifyOptions.loggerInstance`. Configuring multiple sources will cause an error on server startup.
- `accessLog?: AccessLogConfig`
  - First-party access logging hooks are installed by default. Printed access log lines require a configured logger (`logging`, `fastifyOptions.logger`, or `fastifyOptions.loggerInstance`). Use `{ events: 'none' }` to disable template log output, or provide config to customize.
  - `events?: 'start' | 'finish' | 'both' | 'none'` - Which lifecycle events to print a log line for (default: `'finish'`).
  - `responseTemplate?: string` - Template for finish/response events. Default: `'[{{serverLabel}}] Request finished {{method}} {{url}} {{statusCode}} ({{responseTime}}ms)'`. Available variables: `logSource`, `method`, `url`, `statusCode`, `responseTime`, `finishType`, `reqID`, `requestID`, `ip`, `connectionIP`, `userAgent`, `serverLabel`, `isStaticAsset`.
  - `requestTemplate?: string` - Template for start/request events. Default: `'[{{serverLabel}}] Request started {{method}} {{url}}'`. Available variables: `logSource`, `method`, `url`, `reqID`, `requestID`, `ip`, `connectionIP`, `userAgent`, `serverLabel`, `isStaticAsset`.
  - `level?: UnirendLoggerLevel | { success?, clientError?, serverError? }` - Log level. Default: `info` for 2xx/3xx, `warn` for 4xx, `error` for 5xx.
  - `onRequest?: (context: AccessLogRequestContext) => void | Promise<void>` - Custom hook fired at request start when provided. It is awaited before request handling continues. If you intentionally start fire-and-forget work inside it, handle errors explicitly. Fires regardless of the `events` setting. Client identity is already resolved here, so `ctx.request.requestID` / `clientIP` / `connectionIP` / `userAgent` / `clientUserAgent` / `clientInfo` are all populated (resolution runs before access logging) and available in this start hook, not just `onResponse`. See [Client Identity](./client-identity.md).
  - `onResponse?: (context: AccessLogResponseContext) => void | Promise<void>` - Custom hook fired on response completion when provided (both normal and client-aborted). It is awaited after the response finishes or aborts. If you intentionally start fire-and-forget work inside it, handle errors explicitly. `context.finishType` is `'completed'` or `'aborted'`. Fires regardless of the `events` setting.
  - See [Access Logging](#access-logging) for template examples, level config, DB tracing patterns, and runtime updates.
- `getConnectionIP?: (request: FastifyRequest) => string | Promise<string>`
  - Custom resolver for the **connecting IP** (`request.connectionIP`) when behind a reverse proxy or external hosted proxy, for example to read `CF-Connecting-IP`.
  - Called once per request. The result is stored as `request.connectionIP` (and seeds `request.clientIP`). Available throughout the request lifecycle and as the access-log `{{connectionIP}}` variable.
  - When not set, `request.connectionIP` falls back to `request.ip` (which reflects Fastify proxy handling when `fastifyOptions.trustProxy` is configured).
  - If `getConnectionIP` throws, the error propagates as a 500 - there is no silent fallback to `request.ip`.
  - See [Access Logging](#access-logging) for proxy and external reverse proxy examples.
- `clientInfo?: ClientInfoConfig | false`
  - Client-identity resolution. **On by default.** Resolves the real end-user `request.clientIP` (the connecting IP, overridden by a trusted `X-SSR-Original-IP`), the resolved end-user `request.clientUserAgent` (the raw header, overridden by a trusted `X-SSR-Forwarded-User-Agent`), a frozen `request.clientInfo` (correlation ID, forwarded-source flags, resolved identity), and emits `X-Request-ID` / `X-Correlation-ID` response headers.
  - Runs before access logging, so `request.clientIP` / `request.clientUserAgent` / `request.clientInfo` are available in access-log templates (`{{ip}}`, `{{userAgent}}`) and both hooks, plus all handlers.
  - Config: `trustForwardedHeaders`, `forwardedRequestIDValidator`, `setResponseHeaders`, `logging`. Pass `false` to disable entirely (then `request.clientIP` equals `request.connectionIP`, `request.clientUserAgent` equals `request.userAgent`, and `request.clientInfo` is `undefined`).
  - See [Client Identity](./client-identity.md) for the full model and the `connectionIP` vs `clientIP` distinction.
- `getRequestID?: (request: FastifyRequest) => string | undefined | Promise<string | undefined>`
  - Custom generator for `request.requestID`, the value the API/Page envelope helpers use for `request_id`. Set once per request before access logging and plugins run, so it is available as the `{{requestID}}` access-log template variable, in access-log hooks (`ctx.request.requestID`), plugins, and all handlers.
  - When not set, the framework generates a ULID (globally unique, safe across instances/restarts). Use the override to adopt an upstream/proxy `X-Request-ID` from a trusted header.
  - Returning `undefined` or an empty string opts out: `request.requestID` is left unset and envelopes fall back to `request_id: "unknown"`. It does **not** auto-generate a ULID, so generate your own fallback if you want one.
  - Distinct from the access log `reqID` (Fastify's incremental `request.id`).
- `responseCompression?: boolean | ResponseCompressionOptions`
  - Enables built-in response compression for SSR HTML and API responses (default: `true`).
  - Negotiates `Accept-Encoding`, honors client `q` weights, uses `preferBrotli` to break ties when gzip and Brotli are equally preferred, and skips range responses and very small responses.
  - Use the object form to tune behavior:
    - `enabled?: boolean` - Enable/disable compression explicitly
    - `threshold?: number` - Minimum payload size in bytes before compression is attempted (default: `1024`)
    - `preferBrotli?: boolean` - Prefer Brotli over gzip when the client supports both equally (same `q` value) (default: `true`)
    - `brotliQuality?: number` - Brotli compression quality passed to Node.js zlib (default: `4`)
    - `gzipLevel?: number` - gzip compression level passed to Node.js zlib (default: `6`)
  - Static assets served by `staticContentRouter` inherit this setting by default and handle compression in the static file layer, caching compressed variants in memory for repeated requests, so `ETag`, `Vary`, and `Range` behavior stay correct.
- `responseTimeHeader?: boolean | ResponseTimeHeaderOptions`
  - Optional response-time header for completed responses (default: `false`).
  - For normal Fastify-managed replies, the header is measured in `onSend`.
  - Boolean form:
    - `true` enables the header with defaults
    - `false` or omitted disables it
  - Object form:
    - `enabled?: boolean` - Enable/disable explicitly (default: `true` when object form is used)
    - `headerName?: string` - Header name to emit (default: `'X-Response-Time'`). Must use only letters, numbers, and dashes.
    - `digits?: number` - Number of fractional digits in the emitted time (integer `0` through `6`, default: `2`)
  - If timing cannot be measured in an unusual edge case, the emitted/logged value falls back to `-1` as an explicit "unavailable" sentinel.
  - Works with normal Fastify-managed responses and hijacked/raw responses used by static/range serving. On hijacked/raw responses, the header is measured when `reply.hijack()` runs, while access logging measures when the response finishes.
  - Example:
    ```ts
    const server = serveAPI({
      responseTimeHeader: {
        headerName: 'X-Response-Time',
        digits: 2,
      },
    });
    ```
- `closingHandler?: Function | { api?, web? }`
  - Custom 503 response for requests that arrive while `stop()` is closing the server.
  - If omitted, Unirend returns a default API/Page envelope for API requests and a default HTML 503 page for web requests.
  - Function form returns `WebResponse` on SSR/Static/Redirect servers and an API/Page envelope on APIServer.
  - Split form (`{ api, web }`) customizes API and web handlers for mixed servers. Either handler can be omitted - omitted handlers use Unirend's default 503 response.
  - Fastify's built-in closing 503 JSON response is disabled internally so shutdown responses use Unirend's handler/defaults consistently.
- `serverLabel?: string`
  - Label for this server instance, used in error log messages and access log templates (default: `'SSR'` for SSRServer, `'API'` for APIServer, `'Static'` for StaticWebServer, `'Redirect'` for RedirectServer).
  - Useful for distinguishing log output when running multiple server instances (e.g. an SSR server and an API server in the same process, or two SSR servers serving different apps).
  - Appears in error log messages as `[SSR] Request error` (brackets are added automatically).
  - Also available as `{{serverLabel}}` in access log templates and as `request.serverLabel` in hooks and handlers. The raw label value is exposed (no brackets), so templates can use it as `[{{serverLabel}}]` if desired.
  - Each server type has a sensible default so you only need this option when the default isn't descriptive enough for your setup.
  - ```ts
    // Two SSR servers - tell their logs apart
    const mainServer = serveSSRBuilt('./build-main', {
      serverLabel: 'SSR:main',
    });

    const adminServer = serveSSRBuilt('./build-admin', {
      serverLabel: 'SSR:admin',
    });
    ```

- `fastifyOptions?: { logger?: boolean | FastifyLoggerOptions; loggerInstance?: FastifyBaseLogger; trustProxy?; bodyLimit?; keepAliveTimeout?; requestTimeout?; connectionTimeout? }`
  - Safe subset of Fastify server options.
  - `loggerInstance` must satisfy Fastify's base logger interface (`info`, `error`, `debug`, `fatal`, `warn`, `trace`, `silent`, `level`) and support `child(bindings, options)`.
  - `logger` is Fastify's built-in logger option (boolean or pino options), for example `true` or `{ level: "info" }`.
  - `loggerInstance` is for passing an existing pino (or pino-compatible) logger instance.
  - `trustProxy` is passed directly to Fastify. Common options are `true`, a trusted IP/CIDR string like `'127.0.0.1'` or `'127.0.0.1,192.168.1.1/24'`, a trusted IP/CIDR list like `['127.0.0.1', '10.0.0.0/8']`, or a custom trust function with signature `(address: string, hop: number) => boolean`. Fastify also supports numeric hop counts.
  - `bodyLimit` - maximum request body size in bytes for non-multipart requests (JSON, text, URL-encoded forms). Default: `1048576` (1 MB). Rejected with `413` when exceeded. Does **not** apply to multipart file uploads - those are handled by the multipart plugin and the required per-route `processFileUpload({ maxSizePerFile })` setting. `fileUploads.limits.fileSize` configures the server-level multipart parser default, which `maxSizePerFile` overrides for that upload handler.
    - **Request body parsing note:** JSON (`application/json`) and URL-encoded forms (`application/x-www-form-urlencoded`) are both parsed automatically - both result in `request.body` as a plain object. Use `request.headers['content-type']` to distinguish them if needed. Multipart file uploads are handled separately via `fileUploads`.
  - `keepAliveTimeout` - how long (in milliseconds) to keep an idle HTTP keep-alive connection open before closing it. Default: `72000` (72 seconds). Should be set higher than your upstream load balancer's idle timeout to avoid race-condition resets.
  - `requestTimeout` - idle timeout in milliseconds for an in-progress request. The timer resets on each data chunk received, so large file uploads are unaffected as long as data keeps flowing. A request that stalls (no new data) is closed with `408` once the timeout elapses. Default: `0` (disabled). Most reverse proxies (nginx, Cloudflare, AWS ALB) enforce their own request timeouts, so this mainly matters for servers exposed directly - `30000` (30 s) is a reasonable starting point in that case.
  - `connectionTimeout` - TCP connection timeout in milliseconds. Closes connections that open a socket but never send (or finish sending) an HTTP request. Default: `0` (disabled). Like `requestTimeout`, typically covered by a reverse proxy in production - `10000` (10 s) is a reasonable starting point for direct exposure. **WebSocket caveat:** this timeout applies to the underlying socket, so idle WebSocket connections (e.g. a notification channel waiting for an event) will be closed if no frames are exchanged within the window. Only set this when WebSockets are disabled, or ensure clients send regular ping/pong heartbeats.
  - With logging enabled, your plugin/app logs from `fastify.log` / `request.log` are emitted. Fastify's built-in request lifecycle logs (incoming/completed) are always suppressed - use `accessLog` for formatted access logging instead.

#### Logging

**Which logging approach should I use?**

- **`logging`** (Recommended): Simpler, framework-consistent API. Works identically for SSR and API servers. Best when you need custom logging (external services, structured logs, special handling). If your logger writes to an external store and you need resilience against write failures, see [Resilient Write Queue](./patterns.md#resilient-write-queue).
- **`fastifyOptions.logger`**: Quick out-of-the-box console logger using pino. Best when you just want basic logs to console without external integrations.
- **`fastifyOptions.loggerInstance`**: Pass an existing pino-compatible logger instance. Use when sharing a logger across multiple services or more advanced logging requirements.

Logging behavior quick reference:

- `logger: true`
  - Enables Fastify logger at default level (`info`).
  - Fastify's built-in request lifecycle logs are always suppressed - use `accessLog` for formatted access logging (see [Access Logging](#access-logging)).
- `logger: { level: 'warn' }`
  - Enables logger but sets minimum level to `warn`.
  - Suppresses `info`-level logs from your plugins/app code.
  - **Tip:** Use an environment variable to set the log level at startup - for example `SERVER_LOG_LEVEL`: `logger: { level: process.env.SERVER_LOG_LEVEL ?? 'info' }`. Log level is a startup option, not a runtime toggle.
- `loggerInstance`
  - Uses your provided pino/pino-compatible logger object.

**Note:** `reqID` in Fastify's framework logs is the Fastify request identifier (`request.id`), which is an incremental counter by default. This is separate from `request.requestID`, which the server generates (a ULID by default, customizable via `getRequestID`) and the Unirend envelope helpers use for `request_id`. The ULID is better for distributed systems (e.g., multiple servers behind a load balancer) than the incremental `reqID`.

The **correlation ID** is a separate value used to tie a single user action together across SSR → API hops. The SSR server automatically forwards `X-Correlation-ID` (set to the SSR request's `requestID`) on its page-data fetches. On the receiving server, the built-in `clientInfo` reads that forwarded value into `request.clientInfo.correlationID`, falling back to that request's own `requestID` when nothing was forwarded. So each hop keeps its own unique `requestID`, while the correlation ID stays constant across the chain. `clientInfo` only reads `request.requestID`. It does not generate it.

Example Unirend logger object (recommended path):

```typescript
import { serveSSRBuilt } from 'unirend/server';

const server = serveSSRBuilt('./build', {
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
});
```

If you already use **Lifecycleion** as your logger, see [Lifecycleion Logger Adaptor](./lifecycleion-logger-adaptor.md) for a drop-in adaptor that wraps a `Logger`, `LoggerService`, or entity logger as a `UnirendLoggerObject`, with support for template rendering and redaction.

If you prefer Fastify/pino configuration directly, use `fastifyOptions.logger` or `fastifyOptions.loggerInstance`:

```typescript
import { serveSSRBuilt } from 'unirend/server';

const server = serveSSRBuilt('./build', {
  fastifyOptions: {
    logger: true,
    // or:
    // logger: { level: 'info' },
    // loggerInstance: existingPinoOrCompatibleLogger,
  },
});
```

For formatted access logs and access log hook patterns, see [Access Logging](#access-logging).

#### Access Logging

Access logging hooks are **installed by default** on all server types (SSRServer, APIServer, StaticWebServer, RedirectServer). Finish events use the default template, but printed log lines require a configured logger (`logging`, `fastifyOptions.logger`, or `fastifyOptions.loggerInstance`) because output routes through `request.log`. Use `accessLog` to customize behavior, or `accessLog: { events: 'none' }` to disable template log output while still allowing custom hooks.

```typescript
const server = serveSSRBuilt('./build', {
  logging: { logger: myLogger },
  accessLog: {
    // Which lifecycle events print a log line: 'start' | 'finish' | 'both' | 'none'
    // events: 'finish',
    // Template for request-start log lines
    // requestTemplate: '[{{serverLabel}}] Request started {{method}} {{url}}',
    // Template for request-finish log lines
    // responseTemplate:
    //   '[{{serverLabel}}] Request finished {{method}} {{url}} {{statusCode}} ({{responseTime}}ms)',
    // Either one level for all access logs...
    // level: 'info',
    // ...or levels by status code range
    // level: { success: 'info', clientError: 'warn', serverError: 'error' },
    // Optional hooks for persistence, analytics, or custom side effects
    // onRequest: async (ctx) => {},
    // onResponse: async (ctx) => {},
  },
});
```

##### Events

- `'finish'` (default) - log when response is sent. Covers both normal completion and client aborts.
- `'start'` - log on request arrival only.
- `'both'` - log on both arrival and completion.
- `'none'` - suppress all template logging. Custom `onRequest`/`onResponse` hooks still fire.

##### Template Variables

- Response/finish events: `logSource`, `method`, `url`, `statusCode`, `responseTime`, `finishType`, `reqID`, `requestID`, `ip`, `connectionIP`, `userAgent`, `serverLabel`, `isStaticAsset`
  - Also supports dot notation for nested fields: `replyInfo.statusCode`, `replyInfo.headers['content-type']`
- Request/start events: `logSource`, `method`, `url`, `reqID`, `requestID`, `ip`, `connectionIP`, `userAgent`, `serverLabel`, `isStaticAsset`
- `isStaticAsset` is most useful in response/finish templates. Static serving marks it after the access-log start event, so request/start templates always see `false`.
- `serverLabel` exposes the raw label value (no brackets) - use `[{{serverLabel}}]` if you want brackets in your template output.
- Dot notation is supported for nested properties (e.g. `{{replyInfo.headers['x-request-id']}}`).
- Unknown variables are substituted as `???`.
- Avoid logging sensitive data (auth tokens, passwords, PII) in templates, as access logs are typically written to files or external services.

> **`ip` is the real end user, `connectionIP` is the connecting IP.** The access-log `ip` (`{{ip}}` / `ctx.ip`) is `request.clientIP`, the resolved real end user, which sees through CDNs / load balancers and the SSR → API hop (when `clientInfo` is enabled, the default). `request.connectionIP` (`{{connectionIP}}` / `ctx.connectionIP`) is the IP that actually connected to this server. Use it for debugging. For per-user rate limiting prefer `ip`/`clientIP`, because `connectionIP` can be a shared CDN/proxy address (or, on an SSR → API hop, the SSR server's IP), so it would lump users together. Both are available in templates and in both hooks (client identity is resolved before access logging). Like `ip`, `{{userAgent}}` / `ctx.userAgent` is `request.clientUserAgent`, the resolved end-user User-Agent (the forwarded UA on a trusted SSR hop, the request header otherwise, and `request.userAgent` when `clientInfo` is disabled). `ctx.request.clientInfo` also carries the correlation ID and forwarded-source flags. See [Client Identity](./client-identity.md).

##### Additional Context in Log Output

Beyond the template string, access logs include additional structured metadata in the log output. This is valuable because structured logging systems can store and index this metadata separately from the human-readable message, enabling powerful filtering, querying, and aggregation.

- **`logSource`**: Always `'unirend.accessLog'` for entries emitted by the access logging plugin. This gives structured logging pipelines a stable discriminator for filtering or routing access log entries.
- **`event`**: Either `'start'` (for request events) or `'finish'` (for response events). This helps distinguish log entries when using `events: 'both'`.
- **All template variables**: The same variables available in the template (`method`, `url`, `statusCode`, etc.) are also included as structured fields in the log metadata, making them available for log aggregation and filtering even if not included in the template string.

Example log output structure:

```typescript
// Request start event
request.log.info(
  {
    logSource: 'unirend.accessLog',
    method: 'GET',
    url: '/page',
    reqID: '123',
    ip: '127.0.0.1',
    userAgent: '...',
    serverLabel: 'SSR',
    isStaticAsset: false,
    event: 'start',
  },
  '[SSR] Request started GET /page',
);

// Response finish event (normal completion)
request.log.info(
  {
    logSource: 'unirend.accessLog',
    method: 'GET',
    url: '/page',
    statusCode: 200,
    responseTime: 45,
    finishType: 'completed',
    reqID: '123',
    ip: '127.0.0.1',
    userAgent: '...',
    serverLabel: 'SSR',
    isStaticAsset: false,
    event: 'finish',
  },
  '[SSR] Request finished GET /page 200 (45ms)',
);

// Response finish event (client aborted - disconnected before response finished)
request.log.info(
  {
    logSource: 'unirend.accessLog',
    method: 'GET',
    url: '/page',
    statusCode: 0,
    responseTime: 0,
    finishType: 'aborted',
    reqID: '123',
    ip: '127.0.0.1',
    userAgent: '...',
    serverLabel: 'SSR',
    isStaticAsset: false,
    event: 'finish',
  },
  '[SSR] Request finished GET /page 0 (0ms)',
);
```

When using structured logging (e.g., JSON format with pino or other logging adapters), this metadata is stored as separate fields alongside the message. This enables powerful capabilities for log aggregation systems, such as filtering by status code ranges, grouping by URL patterns, calculating response time percentiles, or tracking client abort rates. Since the metadata is separate from the template string, you can include detailed information in the structured fields that you might not want in plain text logs, and different logging sinks (console, database, external services) can selectively use the fields they need.

If you persist request history yourself, prefer the `accessLog.onRequest` and `accessLog.onResponse` hooks for DB writes. These hooks run regardless of the `events` setting, including `events: 'none'`, so you can disable template logging while still recording request starts/completions. If your central logger also writes to the same DB or external sink, filter out entries where `context.logSource === 'unirend.accessLog'` (or route them to a separate sink) to avoid double-writing the same access event.

##### IP Behind a Reverse Proxy

`ip` in access log templates and hook contexts comes from `request.clientIP` (the resolved real end user), which is resolved once at request start and is available everywhere - plugins, data loader handlers, API route handlers, and access log hooks. The raw connecting IP is `request.connectionIP` / `{{connectionIP}}`.

Two options for making the IP accurate behind a proxy:

- **Generic proxy / `X-Forwarded-For`**: set `fastifyOptions.trustProxy`. This can be `true`, but in stricter deployments you can pass a trusted IP/CIDR value or list instead. Fastify will parse the `X-Forwarded-For` header and `request.ip` / `request.clientIP` will reflect the first non-trusted IP in the chain. Works well for a single trusted proxy (e.g., nginx on the same host). Less reliable with multiple hops (LB + external reverse proxy) since the chain can be extended by each layer.

```typescript
// Trust all proxies
fastifyOptions: { trustProxy: true }

// Trust specific proxies or proxy ranges
fastifyOptions: { trustProxy: '127.0.0.1,10.0.0.0/8' }
fastifyOptions: { trustProxy: ['127.0.0.1', '10.0.0.0/8'] }

// Custom trust logic
fastifyOptions: {
  trustProxy: (address, hop) => address === '127.0.0.1' || hop === 1,
}
```

- **External reverse proxy with its own client-IP header**: use server-level `getConnectionIP` to read the right header. In a typical `browser → external reverse proxy → load balancer → your app` setup, `request.ip` is often the load balancer's private IP and `X-Forwarded-For` may contain the external proxy's edge IP rather than the real client IP. In those cases, read the provider's client-IP header only when the immediate request came from a trusted proxy or load balancer range you control:

```typescript
serveSSRBuilt('./build', {
  getConnectionIP: (req) => {
    // Pseudo-code: only trust the external reverse proxy header when the
    // request came from a proxy or load balancer range you control.
    const fromTrustedProxyRange = isTrustedProxyRange(req.ip);
    const cfIP = req.headers['cf-connecting-ip'];

    if (fromTrustedProxyRange && typeof cfIP === 'string' && cfIP) {
      return cfIP;
    }

    return req.ip;
  },
  accessLog: {
    responseTemplate: '{{ip}} {{method}} {{url}} {{statusCode}}',
  },
});
```

You can also use `trustProxy` and `getConnectionIP` together. For example, `trustProxy` can help you trust your load balancer and `getConnectionIP` can read the connecting IP from an external reverse proxy header such as `CF-Connecting-IP`.

`getConnectionIP` receives the raw `FastifyRequest` and may return either a string or a promise for a string. The result is awaited once at request start, then stored as `request.connectionIP` (and seeds `request.clientIP`) for the full request lifecycle - not just access logs. The real end user (after SSR forwarding) is `request.clientIP`. See [Client Identity](./client-identity.md).

##### Level Config

By default, access logs use `info` for `2xx`/`3xx`, `warn` for `4xx`, and `error` for `5xx`. You can override that with either a single level or per-status-range levels:

```typescript
// Flat level - same for all status codes
accessLog: { level: 'debug' }

// Per-status-range
accessLog: {
  level: { success: 'info', clientError: 'warn', serverError: 'error' }
}
```

##### Client Abort Handling

`onResponse` fires for both normal completion and client disconnects (when the client disconnects before the response finishes). Use `context.finishType` (`'completed'` | `'aborted'`) to distinguish. The `{{finishType}}` template variable is also available.

##### Fire-and-Forget Work Inside Hooks

`onRequest` and `onResponse` are both awaited by the framework. If you intentionally start background work inside either hook, handle errors explicitly so failures are not lost:

```typescript
accessLog: {
  onRequest: async (ctx) => {
    try {
      void writeRequestStart(ctx).catch((err) => {
        ctx.request.log.error(
          { err },
          'Failed to write request start log',
        );
      });
    } catch (err) {
      ctx.request.log.error(
        { err },
        'Failed to start request log write',
      );
    }
  },

  onResponse: async (ctx) => {
    try {
      void writeRequestCompletion(ctx).catch((err) => {
        ctx.request.log.error(
          { err },
          'Failed to write request completion log',
        );
      });
    } catch (err) {
      ctx.request.log.error(
        { err },
        'Failed to start request completion log write',
      );
    }
  },
}
```

##### Runtime Config Updates

`updateAccessLoggingConfig()` does a partial merge - only the provided keys are changed:

```typescript
server.updateAccessLoggingConfig({ events: 'none' }); // pause logging
server.updateAccessLoggingConfig({ events: 'finish' }); // resume for finish events only
server.updateAccessLoggingConfig({ level: 'debug' }); // change level only
```

##### Pattern: DB Request Tracing

Use the `onRequest` and `onResponse` hooks in `accessLog` for persistent request history (audit logs, analytics, debugging). Hooks fire independently of the `events` setting, so they run even when `events: 'none'`. Both hooks are awaited by the framework, so avoid blocking on slow work unless you want that behavior.

`request.requestID` (the server-generated ULID used for the envelope `request_id`) is available in **both** hooks. The framework sets it before access logging and plugins run, so you can write an in-flight "pending" row keyed by it in `onRequest` and update that same row in `onResponse`. Read it off `ctx.request.requestID` in hooks (or use `{{requestID}}` in templates), and note it is distinct from `ctx.reqID` (Fastify's incremental counter).

```typescript
const server = serveSSRBuilt('./build', {
  accessLog: {
    onRequest: async (ctx) => {
      // requestID (ULID) is already set by the server — globally unique, safe across instances/restarts.
      const requestID = (ctx.request as any).requestID;

      // Fire-and-forget - don't await so the request isn't held up by the DB write
      db.requestLog
        .insert({
          requestID,
          method: ctx.method,
          url: ctx.url,
          startedAt: new Date(),
          status: 'pending',
        })
        .catch((err) =>
          ctx.request.log.error({ err }, 'Failed to write request start log'),
        );
    },

    onResponse: async (ctx) => {
      const requestID = (ctx.request as any).requestID;

      db.requestLog
        .update(requestID, {
          statusCode: ctx.statusCode,
          responseTime: ctx.responseTime,
          completedAt: new Date(),
          // 'completed' for normal finish, 'aborted' if client disconnected early
          status: ctx.finishType,
        })
        .catch((err) =>
          ctx.request.log.error(
            { err },
            'Failed to write request completion log',
          ),
        );
    },
  },
});
```

Considerations:

- Use `requestID` (ULID via `ctx.request`) as the record key rather than `reqID` in the context (Fastify's incremental counter per process) - it's safe across multiple server instances and restarts.
- For the client IP / User-Agent columns, `ctx.ip` / `ctx.userAgent` are already the resolved real end user (`ctx.userAgent` maps to `request.clientUserAgent`, so it is the forwarded UA on a trusted SSR hop or `request.userAgent` otherwise). `ctx.request.clientInfo.correlationID` ties SSR → API hops together when the API trusts forwarded headers. Use `ctx.connectionIP` for the raw connecting IP. All are available in both hooks. See [Client Identity](./client-identity.md).
- The framework awaits these hooks. If you do not want DB writes to hold up request handling or post-response cleanup, fire-and-forget inside the hook and attach `.catch()` or similar error handling so failures are not lost. Prefer `ctx.request.log` over `console.*` so the messages go through the server's configured logger.
- `onResponse` covers both normal completion and client aborts via `ctx.finishType`.
- If you configure `getRequestID` to opt out (return `undefined`), `request.requestID` is unset in these hooks. Guard for it or key on something else.
- If writes to your primary store can fail, consider a local fallback queue with a background retry timer so data isn't silently lost. See [Resilient Write Queue](./patterns.md#resilient-write-queue) for the pattern.

For augmenting finish/response event templates with custom fields set by plugins (user ID, tenant, etc.), use dot notation to access nested context properties (e.g. `{{requestContext.userID}}`). Note that start/request event templates run before plugin hooks, so plugin-set fields are not yet available there.

## HTTPS Configuration

Both server classes support HTTPS with static certificates, SNI callbacks for multi-tenant dynamic certificate selection, and an HTTP→HTTPS redirect server.

See the full HTTPS Configuration guide: [https.md](./https.md)

## Create SSR Server

Vite config:

Use the Vite config setup shown in the main [README](../README.md#prepare-vite-config-and-entry-points), including `withUnirendViteConfig()`, which configures Vite to avoid externalizing `unirend` during SSR and dedupes `react`, `react-dom`, and `react-router` so SSR/SSG rendering uses the same React/React Router package instances. This prevents split React Router contexts. Without it, router hooks like `useLocation()` can fail because they read a different context than the provider created.

### Create Production SSR Server

Create a server file that uses the `serveSSRBuilt` function:

```typescript
import { serveSSRBuilt } from 'unirend/server';
import path from 'path';

async function main() {
  // Build directory (contains both client/ and server/ subdirectories)
  const buildDir = path.resolve(__dirname, 'build');

  const server = serveSSRBuilt(buildDir, {
    // Optional: Custom server entry name (default: "EntrySSR" - looks for EntrySSR.js in server manifest)
    // serverEntry: "custom-entry",

    // Optional: Custom HTML template path relative to buildDir (default: "client/index.html")
    // template: "custom/app.html",

    // Optional: CDN base URL for asset URL rewriting (rewrites <script src> and <link href> at runtime)
    // CDNBaseURL: process.env.CDN_BASE_URL,  // e.g., 'https://cdn.example.com'

    // Optional safe-to-share configuration object.
    // Serialized and injected as window.__PUBLIC_APP_CONFIG__ during SSR.
    // Available via usePublicAppConfig() hook on both server and client.
    // Tip: Keep this minimal and non-sensitive, it will be passed to the client.
    publicAppConfig: {
      api_endpoint: process.env.API_URL || 'https://api.example.com',
      environment: 'production',
      // Optionally include selected build info for troubleshooting/version display.
      // See docs/build-info.md for generating/loading and safe exposure.
      // build: { version: "1.2.3" },
    },

    // Optional: API endpoint configuration (defaults shown)
    // apiEndpoints: { apiEndpointPrefix: "/api", versioned: true, pageDataEndpoint: "page_data" },

    // Optional: Custom error/not-found handlers for API requests
    // APIHandling: { errorHandler: (request, error, isDev, isPageData, params) => {...}, notFoundHandler: (request, isPageData, params) => {...} },

    // Optional: Custom container ID (default: "root")
    // containerID: "app",

    // Optional: SSR render timeout in milliseconds (default: 5000)
    // ssrRenderTimeout: 10000, // 10 seconds for pages with slow data loaders

    // Optional: Server plugins
    // plugins: [myPlugin],

    // Optional: public/ files and subfolders to serve (favicon, robots.txt, etc.)
    // Files in Vite's public/ folder are served ONLY if declared here.
    // Verified to exist at startup, so a typo fails at boot instead of 404ing.
    // publicFiles: ['/favicon.svg', '/favicon.ico', '/robots.txt'],
    // publicFolders: ['/.well-known'],

    // Optional: Static content configuration
    // - Default (omit): Serves from buildDir/client/assets at /assets with immutable asset detection
    // - false: Disable static serving (e.g., when using a CDN)
    // - Custom config with singleAssetMap/folderMap entries: REPLACES the
    //   /assets default — mount /assets yourself (with detectImmutableAssets)
    //   or hashed bundles won't be served. publicFiles/publicFolders entries
    //   are still folded into the custom config.
    //   Note: /assets is rejected in publicFiles/publicFolders (those are for
    //   verbatim public/ content), but here in folderMap it's expected — this
    //   is the one place to (re)mount it.
    //   A folderMap prefix of '/' (or the client build root) is rejected — use
    //   publicFiles/publicFolders for public/ content.
    // - Custom config with no map entries: tuning-only (cache sizes, TTLs,
    //   headers, compression) — the /assets default still applies.
    // staticContentRouter: {
    //   folderMap: {
    //     '/assets': { path: './build/client/assets', detectImmutableAssets: true },
    //     '/custom': './build/client/custom',
    //   },
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

- `publicAppConfig` is passed to the Unirend context and available via the `usePublicAppConfig()` hook on both server (during rendering) and client (after HTML injection).
- For accessing config in components vs non-component code (loaders), fallback patterns, and SPA-only dev mode considerations, see: [Public App Config Pattern](../README.md#public-app-config-pattern).

**Per-Request CDN Override Example:**

You can override the CDN URL per-request in middleware for region-specific CDNs:

```typescript
const server = serveSSRBuilt(buildDir, {
  // Default CDN URL
  CDNBaseURL: 'https://cdn.example.com',
});

// Override CDN URL based on user region
server.fastifyInstance.addHook('onRequest', async (request, reply) => {
  // Detect region (via IP geolocation, cookie, header, etc.)
  const region = detectRegion(request);

  if (region === 'EU') {
    request.CDNBaseURL = 'https://eu-cdn.example.com';
  } else if (region === 'APAC') {
    request.CDNBaseURL = 'https://apac-cdn.example.com';
  }
  // Falls back to default CDNBaseURL if not overridden
});
```

The effective CDN URL for each SSR request is also available as `request.CDNBaseURL` after `onRequest` hooks have run. Use `useCDNBaseURL()` in components (works on both server and client, see [Unirend Context](../docs/unirend-context.md)), or `window.__CDN_BASE_URL__` in non-component code. Guard with `typeof window !== 'undefined'` since `window` is not available during SSR.

HTML Template:

- **Production mode**:
  - **Default**: Loads from `buildDir/client/index.html`
  - **Custom path**: Use `template` option to specify a different path relative to `buildDir` (e.g., `template: "custom/app.html"` loads from `buildDir/custom/app.html`)
  - **Custom folder**: Use `clientFolderName` to change the folder but keep `index.html` as filename (e.g., `clientFolderName: 'client-custom'` loads from `buildDir/client-custom/index.html`)
  - **Caching**: The template is loaded once at server startup and cached in memory for performance. Restart the server to pick up template changes.
  - The template file must exist in your build output (generated by your Vite build process)

### Create Development SSR Server

Use `serveSSRWithHMR(sourcePaths, options)` to run the SSR server for development with Vite middleware and HMR:

```typescript
import { serveSSRWithHMR } from 'unirend/server';

async function main() {
  const server = serveSSRWithHMR(
    {
      // Required: paths for development mode (no defaults, must be specified)
      serverEntry: './src/EntrySSR.tsx', // Your server entry file
      template: './index.html', // HTML template file
      viteConfig: './vite.config.ts', // Vite config file
    },
    {
      // Optional safe-to-share configuration object.
      // Serialized and injected as window.__PUBLIC_APP_CONFIG__ during SSR.
      // Available via usePublicAppConfig() hook on both server and client.
      // Tip: Keep this minimal and non-sensitive, it will be passed to the client.
      publicAppConfig: {
        api_endpoint: process.env.API_URL || 'http://localhost:3001',
        environment: 'development',
      },

      // Optional: API endpoint configuration (defaults shown)
      // apiEndpoints: { apiEndpointPrefix: "/api", versioned: true, pageDataEndpoint: "page_data" },

      // Optional: Custom error/not-found handlers for API requests
      // APIHandling: { errorHandler: (request, error, isDev, isPageData, params) => {...}, notFoundHandler: (request, isPageData, params) => {...} },

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
- `publicAppConfig` is injected in both development and production when using `serveSSRWithHMR` or `serveSSRBuilt`.
- All context globals (`window.__PUBLIC_APP_CONFIG__`, `window.__FRONTEND_REQUEST_CONTEXT__`, `window.__CDN_BASE_URL__`, `window.__DOMAIN_INFO__`) are injected into `<head>` before any of your app scripts, so they are available to inline `<head>` scripts, body scripts, and all module code that runs after page load.
- `window.__DOMAIN_INFO__` contains `{ hostname, rootDomain }` computed from the request hostname server-side. Access it in components via `useDomainInfo()` (see [Unirend Context](../docs/unirend-context.md)). Useful for setting cookies that span subdomains without hardcoding the domain.
- **HTML Template**: The `template` path in development mode is fully customizable. Specify any HTML file path (e.g., `./index.html`, `./src/app.html`, etc.). The template is read fresh on each request and transformed by Vite for HMR support.

### Asset Serving vs Runtime Behavior

`serveSSRWithHMR` and `serveSSRBuilt` control the **asset serving strategy**, which is how your code is loaded and served:

- **`serveSSRWithHMR`**: Uses Vite middleware with HMR. Source files are transformed on-the-fly, and changes are hot-reloaded in the browser. Server entry is loaded via `vite.ssrLoadModule`.
- **`serveSSRBuilt`**: Serves pre-built assets from disk. Server entry is loaded from the Vite server manifest. Fingerprinted assets (e.g. `main.CTpDmzGw.js`) get immutable cache headers, other static files do not.

This is separate from **runtime behavior** controlled by `initDevMode()` / `getDevMode()`:

- **Runtime behavior**: Whether detailed error messages (stack traces, error details) are shown to users, using debug logging, etc.

These two concepts are **orthogonal**. You _in theory_ could run `serveSSRBuilt` (serving built assets) while `initDevMode(true)` shows verbose errors, which is useful for staging environments. Or run `serveSSRWithHMR` (using Vite dev server) while treating errors as production-safe.

In practice, you'll usually pair them: dev asset serving with dev runtime, and prod asset serving with prod runtime. But the separation lets you mix and match when needed.

See [Dev Mode](./dev-mode.md) for full details on `initDevMode()` and `getDevMode()`.

### Organization Suggestion

Since your project will most likely use both `serveSSRWithHMR` and `serveSSRBuilt`, consider these options:

- Single entry script that switches on an env/arg (dev vs prod) and calls `serveSSRWithHMR` or `serveSSRBuilt`.
- Separate scripts (e.g., `serve-hmr.ts` and `serve-built.ts`).
- For production binaries, you can bundle your server script with a tool like Bun:
  - `bun build serve-built.ts --outdir build/serve --external vite` and `bun run build/serve/serve-built.js`
  - To run the Bun bundle under Node, add the target flag and start with Node:
    - `bun build serve-built.ts --outdir build/serve --target node --external vite` then `node build/serve/serve-built.js`

Always include `--external vite` when bundling your server entry with `bun build`. Vite lazily imports `esbuild` at runtime, which Bun's bundler cannot statically resolve. Keeping Vite external avoids a build error.

See a complete example with plugins and data handler registration in `demos/ssr/server/ssr-component.ts`. The demo uses thin entry files, `demos/ssr/serve-hmr.ts` for HMR mode and `demos/ssr/serve-built.ts` for built mode, which both call into `demos/ssr/server/start.ts`.

Recommendation: Use Bun for simplicity (dev runs TypeScript directly, prod bundles to JS that can run under Bun or Node). Pure Node alternatives (e.g., `tsc`, `esbuild`, `rollup`, `ts-node`) or vanilla JavaScript are possible but not covered in depth here to keep the setup simple and easy out of the box.

Note: Running SSR servers directly under Bun may stall graceful shutdown in some setups. Vite's HMR WebSocket server can fail to close cleanly under Bun, compared to Node (related: [oven-sh/bun#5951](https://github.com/oven-sh/bun/issues/5951)), and similar long-lived connection behavior can affect built servers too. The same style of issue is described in [websockets.md](./websockets.md). If you hit this, bundle the entry you use targeting Node and run it with Node:

```bash
# HMR SSR entry
# Note: --define 'IS_BUILT=false' (to mirror running from source) and --external with the
# absolute $(pwd) path are required because Bun parses and resolves dynamic imports at
# build-time even when pruned via IS_BUILT=false.
bun build serve-hmr.ts --outfile build/serve/serve-hmr.js --target=node --external vite --define 'IS_BUILT=false' --external "$(pwd)/current-build-info.ts"
SSR_SRC_DIR=$(pwd) node build/serve/serve-hmr.js dev

# Built SSR entry
bun build serve-built.ts --outfile build/serve/serve-built.js --target=node --external vite --define 'IS_BUILT=true'
node build/serve/serve-built.js prod
```

When bundling this way, `__dirname` resolves to the build output directory, not your source tree. Pass your source directory via an env var and read it in your serve script (`const SRC_DIR = process.env.SSR_SRC_DIR ?? path.resolve(__dirname, '..')`), then use `SRC_DIR` to resolve your `serverEntry`, `template`, and `viteConfig` paths. Vite handles HMR and source transforms as normal.

Similarly, for production bundles where the built assets directory is moved (e.g., during container builds), you can override the distribution path using an environment variable (e.g. `const DIST_DIR = process.env.SSR_DIST_DIR ?? path.resolve(__dirname, '../build')`).

### SSRServer Class

The `SSRServer` class powers both dev and prod servers created via `serveSSRWithHMR` (dev) or `serveSSRBuilt` (prod), which passes the proper configuration.

### Construction

- HMR Dev Server: `serveSSRWithHMR({ serverEntry, template, viteConfig }, options)`
  - Uses Vite middleware and `vite.ssrLoadModule` for HMR.
- Built Assets (intended for production deployment): `serveSSRBuilt(buildDir, options)`
  - Loads server entry from the Vite server manifest in `buildDir/<serverFolderName>`.

### SSR Options

In addition to the [shared server configuration](#shared-server-configuration), SSR servers (both dev and prod) accept:

- `APIHandling?: { errorHandler?; notFoundHandler? }`
  - Custom error/not-found handlers for API requests (paths matching `apiEndpoints.apiEndpointPrefix`)
  - `errorHandler` and `notFoundHandler` return standardized API/Page error envelopes instead of HTML.
  - Both handlers receive an `isPageData` parameter to distinguish between different types of API requests:
    - **Page data requests** (`isPageData=true`): Requests to the page data endpoint (e.g., `/api/v1/page_data/home`) used by data loaders to fetch page data with metadata (title, description). These return Page Response Envelopes.
    - **Regular API requests** (`isPageData=false`): Standard API endpoints (e.g., `/api/v1/users`, `/api/v1/account/create`) for operations like creating accounts, updating data, etc. These return API Response Envelopes.
- `publicAppConfig?: Record<string, unknown>`
  - Optional configuration object available via the `usePublicAppConfig()` hook on both server (during SSR/SSG rendering) and client (after HTML injection) in both dev and prod modes.
  - Use for runtime configuration (API URLs, feature flags, build info, etc.). See [Public App Config Pattern](../README.md#public-app-config-pattern) for usage in components vs loaders.
  - Within a request, read the config via `usePublicAppConfig()` in components (available on both server and client). Each request receives a deep-cloned, deep-frozen snapshot, so mutations inside a request are isolated and do not affect other requests. If you hold a reference to the object (or a sub-object within it) that you passed here, you can mutate it between requests and the next clone will pick up the change. Updates are global (all subsequent requests, not a specific user). Use `requestContext` for per-user or per-request values.
- `containerID?: string`
  - Client container element ID (default `"root"`).
- `templateSlots?: { headInlineScripts?: string | string[]; bodyPrepend?: string; bodyAppend?: string }`
  - Extra content spliced into this app's HTML template. See [Template Slots](#template-slots).
- `ssrRenderTimeout?: number`
  - Timeout in milliseconds for the SSR render fetch request. If the render takes longer than this, the request is aborted and a 500 error page is returned.
  - Default: `5000` (5 seconds). Increase for pages with slow data loaders or complex rendering.
- `cookieForwarding?: { allowCookieNames?: string[]; blockCookieNames?: string[] | true }`
  - Controls which cookies are forwarded on SSR fetches and which `Set-Cookie` headers are returned to the browser.
- `get500ErrorPage?: (request, error, isDevelopment) => string | Promise<string>`
  - Provide custom HTML for SSR 500 responses.
  - The `request` argument is the Fastify request and includes the current `request.requestContext`. Depending on where rendering failed, data loaders may not have run or may not have returned context yet, so values required by the custom 500 page should be seeded by SSR middleware. The returned HTML is sent directly outside the React hydration and context injection flow, so inject any context-derived values yourself if your custom 500 page needs them.
  - The error is always logged before this function is called.
  - **Security Note**: When including dynamic values (error messages, URLs, etc.) in your HTML, always escape them using `escapeHTML` from `unirend/utils` to prevent XSS attacks. React automatically escapes content, but raw HTML generation requires manual escaping.
- `clientFolderName?: string`, `serverFolderName?: string`
  - Names of subfolders inside the Vite build output (defaults: `client` and `server`).

### Options (Prod-Only)

- `serverEntry?: string`
  - Name of the server entry in manifest (default `"EntrySSR"`).
- `template?: string`
  - Custom HTML template path relative to `buildDir` (default: `"client/index.html"`).
  - Example: `template: "custom/app.html"` loads from `buildDir/custom/app.html`.
  - The template is loaded once at server startup and cached in memory. Restart the server to pick up template changes.
  - Alternatively, use `clientFolderName` to change the folder but keep `index.html` as filename.
- `CDNBaseURL?: string`
  - CDN base URL for runtime asset URL rewriting (e.g., `'https://cdn.example.com'`).
  - Rewrites `<script src>` and `<link href>` attributes in the HTML template to use the CDN instead of relative paths.
  - Only affects absolute paths starting with `/` (e.g., `/assets/main.js` becomes `https://cdn.example.com/assets/main.js`).
  - **Runtime flexibility**: During template processing, absolute URLs are converted to placeholders. The actual CDN URL is injected per-request, allowing:
    - **Per-request override**: Set `request.CDNBaseURL` in middleware to override the CDN URL for specific requests (e.g., region-specific CDNs)
    - **App-level default**: Falls back to the `CDNBaseURL` option configured in `serveSSRBuilt()` or `registerBuiltApp()`
    - **No CDN**: If neither is set, original `/assets/...` paths are preserved
  - The resolved value is available as `request.CDNBaseURL` before SSR `preHandler` hooks, route handlers, SSR render, and custom 500 pages run. API servers do not set this field.
  - The effective CDN URL is also available to frontend code:
    - **In components**: use `useCDNBaseURL()`, which works on both server and client. See [Unirend Context](../docs/unirend-context.md).
    - **In non-component code** (data loaders, utilities): use `window.__CDN_BASE_URL__` with a `typeof window !== 'undefined'` guard, since `window` is not available during SSR:
      ```typescript
      const cdnBase =
        typeof window !== 'undefined' ? window.__CDN_BASE_URL__ : undefined;
      ```
  - Useful for serving assets from a CDN without build-time configuration changes.
  - Tip: Set via environment variable (e.g., `CDNBaseURL: process.env.CDN_BASE_URL`) in `serveSSRBuilt()` or `registerBuiltApp()` options for deployment flexibility, or override per-request in middleware for region-specific CDN selection.
- `publicFiles?: string[]`
  - Declares root-level files from Vite's `public/` directory to serve in production, e.g. `['/favicon.svg', '/favicon.ico', '/robots.txt']`.
  - This is pure shorthand for `staticContentRouter.singleAssetMap` entries resolved against the client build root. There is one static router per app, and `publicFiles` just pre-populates its exact-match map, so combining it with a custom `staticContentRouter` is fine, the entries are folded into whichever config is in effect. An explicit `singleAssetMap` key for the same URL wins, and the server logs a boot-time warning listing shadowed entries, since the duplication is usually a mistake.
  - Entries are URL paths as the browser requests them. Vite copies `public/` verbatim into the client build root, so each entry doubles as the file's path relative to `buildDir/<clientFolderName>`. Nested paths like `/icons/logo.png` work too. To serve a whole subfolder, use `publicFolders` instead.
  - Assets you `import` from source are unaffected, since Vite fingerprints those into `/assets`, which is served by default. This option is for files referenced by literal URL (favicon files, `robots.txt`, web manifests, logos). They are served ONLY if declared here (or via `publicFolders` or `staticContentRouter.singleAssetMap`, the escape hatch for cases where the URL and the file path differ).
  - At startup, every declared file is verified to exist in the client build dir. Missing files fail loudly at boot with an error listing them, instead of silently returning 404s in production.
  - Entries containing `.` or `..` segments, null bytes, backslashes, trailing slashes, or characters browsers percent-encode in URLs (spaces, `%`, `#`, `?`, non-ASCII) are rejected at config time (browsers normalize `.` segments away and request `/og image.png` as `/og%20image.png`, so such declared entries could never match a real request). Directories cannot be declared here, only individual files. Repeated slashes are collapsed and reserved names compare case-insensitively, so variants like `/assets//x.js` or `/INDEX.HTML` cannot dodge the checks below.
  - `/index.html`, anything under `.vite/`, and anything under `/assets/` are also rejected. The template is served through SSR, not as a raw file, the `.vite` directory is build metadata, and `/assets` is Vite's generated output, already served by the default mount (a single-asset entry would shadow it and lose the immutable header). A nested `index.html` (e.g. `/docs/index.html`) is fine. If you truly need to expose these, `staticContentRouter.singleAssetMap` remains the deliberate escape hatch.
  - Cannot be combined with `staticContentRouter: false`. If a CDN serves these files, pass `undefined` here but keep the list declared in your app's consts so the drift check still runs. See [CDN Deployments](#cdn-deployments) for an env-gated setup.
- `publicFolders?: string[]`
  - Declares subfolders of `public/` to serve whole, e.g. `['/.well-known']`, so every file inside is served without listing each one in `publicFiles`.
  - Shorthand for `staticContentRouter.folderMap` mounts resolved against the client build root. An explicit `folderMap` prefix for the same path wins (with the same boot-time shadow warning, unless it points at the same directory, see the next bullet).
  - Unlike `publicFiles`, a folder mount resolves requests against the disk per request rather than from a fixed list. Prefer `publicFiles` for individual files and reserve this for folders with many or changing files.
  - Folder mounts never get immutable-asset detection, since `public/` content is copied verbatim, not fingerprinted. If a `public/` subfolder genuinely holds fingerprinted files, declare it here AND mount it via `staticContentRouter.folderMap` with `detectImmutableAssets: true` pointing at the same directory. The `folderMap` entry wins (adding the detection), the declaration keeps the templates' `check:public-assets` drift script covering the folder, and the shadow warning recognizes that exact combination as intentional and stays quiet. A duplicate that changes nothing (same directory without enabling detection) still warns.
  - At startup, every declared folder must exist as a directory in the client build dir, failing loudly at boot otherwise.
  - Bare `/` is rejected (mounting the client build root exposes `/index.html` and `.vite/`), as are `/assets` and anything under it (already the default mount, and a nested mount would win on longest-prefix and lose the immutable header), `.vite`, `.` and `..` segments, null bytes, backslashes, and characters browsers percent-encode in URLs. A trailing slash is tolerated and stripped, repeated slashes are collapsed before the checks (so `//` counts as the root and `/assets//` as `/assets`), and reserved names compare case-insensitively.
  - Cannot be combined with `staticContentRouter: false`. If a CDN serves these folders, pass `undefined` here but keep the list declared in your app's consts so the drift check still runs. See [CDN Deployments](#cdn-deployments) for an env-gated setup.
- `staticContentRouter?: StaticContentRouterOptions | false`
  - Serves static assets (images, CSS, JS) in production. Not related to React Router’s StaticRouter.
  - Set to `false` to disable built‑in static serving (e.g., when using a CDN).
  - A custom config that defines `singleAssetMap`/`folderMap` entries replaces the default `/assets` mount, so include `/assets` yourself (with `detectImmutableAssets: true`) or your hashed bundles will not be served. `publicFiles`/`publicFolders` entries are the exception: since they are explicitly declared, they are folded into the custom config, with your explicit keys winning on conflict.
  - A custom config with no map entries is tuning-only: cache sizes, TTLs, cache headers, and compression apply, while the `/assets` default and `publicFiles`/`publicFolders` behavior stay as if you had not customized anything.
  - A `folderMap` prefix of `/` (or a folder path that resolves to the client build root) is rejected at config time. Mounting the root would stat the disk on every page request and expose `/index.html` and `/.vite/manifest.json`, so declare root-level files with `publicFiles` (and subfolders with `publicFolders`) instead.
  - Options (StaticContentRouterOptions):
    - `singleAssetMap?: Record<string, string>`: Exact URL → absolute file path
    - `folderMap?: Record<string, string | FolderConfig>`: URL prefix → directory path (or folder config)
      - `FolderConfig`: `{ path: string; detectImmutableAssets?: boolean }`. Detection is a filename heuristic: a segment of 6 or more base64url characters before the extension that contains at least one digit or uppercase letter, so all-lowercase names like `some-multi-word.txt` or `apple-touch-icon.png` do not look hashed, but a verbatim name like `report-CHAPTER2.pdf` still can. Only enable it for folders that genuinely contain fingerprinted files.
    - `smallFileMaxSize?: number`: Inline/ETag cut‑off for small assets
    - `cacheEntries?: number`: Max entries in in‑memory caches
    - `contentCacheMaxSize?: number`: Max total bytes for content cache
    - `statCacheEntries?: number`: Max entries for fs stat cache
    - `negativeCacheTtl?: number`: TTL ms for negative stat cache entries
    - `positiveCacheTtl?: number`: TTL ms for positive stat cache entries
    - `cacheControl?: string`: Default Cache‑Control header
    - `immutableCacheControl?: string`: Cache‑Control for hashed/immutable assets
    - `compression?: boolean | ResponseCompressionOptions`: Compression settings for buffered static responses. When omitted, inherits the server-level `responseCompression` setting.
  - Path matching notes:
    - `singleAssetMap` keys are normalized to include a leading slash (you may provide with or without it).
    - `folderMap` prefixes are normalized to ensure both leading and trailing slash, so `/assets` and `assets/` are treated as `/assets/`.
    - The incoming request URL is normalized to ensure a leading slash before matching.
    - The relative path slice is guarded against accidental leading `/` to prevent absolute path resolution on POSIX.

### Template Slots

`templateSlots` lets an app add content to its HTML template from server config instead of from the template file.

The reason to reach for it is reuse. In a monorepo maintaining several apps or running multiple apps off one SSR server, the boilerplate that belongs at the edges of every page tends to be identical: a theme flash-prevention script, a no-JavaScript warning, an analytics snippet, a support chat widget. Slots let you export that boilerplate once and hand it to every app, or hand a variant to one app, without maintaining a near-duplicate `index.html` per app.

It is available on `serveSSRWithHMR()`, `serveSSRBuilt()`, `registerHMRApp()`, and `registerBuiltApp()`, so both single-app and [multi-app](#multi-app-ssr-support) servers can use it. Like every other per-app option, it does **not** inherit from the default app: each app that wants slots passes them.

| Slot | Lands | Typical use |
| --- | --- | --- |
| `headInlineScripts` | End of `<head>`, after unirend's context globals | Useful for theme flash prevention or feature flags |
| `bodyPrepend` | Start of `<body>`, before the container element | `<noscript>` warning |
| `bodyAppend` | End of `<body>`, after the container and the client entry script | Analytics, support chat widget |

```typescript
// shared/template-slots.ts
import type { TemplateSlots } from 'unirend/server';

export const sharedSlots: TemplateSlots = {
  headInlineScripts: [
    // Applies the theme class before first paint, so there's no flash of the wrong theme.
    `(function () {
      const pref = window.__FRONTEND_REQUEST_CONTEXT__?.themePreference || 'auto';
      const dark = pref === 'dark' || (pref === 'auto' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (dark) document.documentElement.classList.add('dark');
    })();`,
  ],
  bodyPrepend: `<noscript><p>This page needs JavaScript to run.</p></noscript>`,
  bodyAppend: `<script async src="https://analytics.example.com/script.js"></script>`,
};
```

```typescript
// Every app gets the shared boilerplate; the admin app opts out of analytics.
const server = serveSSRBuilt(BUILD_DIR_STOREFRONT, {
  templateSlots: sharedSlots,
});

server.registerBuiltApp('admin', BUILD_DIR_ADMIN, {
  templateSlots: { ...sharedSlots, bodyAppend: undefined },
});
```

**How the slots behave**

- `headInlineScripts` entries are **JavaScript source, not HTML**. Unirend wraps each one in a `<script>` tag, so they are inline-only by construction. Passing a `<script>` tag is rejected at startup. To load an external script, use `bodyAppend` (as above) or put a `<script src>` in the template itself.
- `headInlineScripts` takes a single script as a plain string, or several as an array. `headInlineScripts: theme` and `headInlineScripts: [theme]` produce identical output, so there is no need to wrap a lone script in an array.
- They run **after** unirend's context globals, in the same position as inline scripts written in the template's head. That means `window.__FRONTEND_REQUEST_CONTEXT__` and `window.__PUBLIC_APP_CONFIG__` are already readable, which is what makes a slotted theme script work.
- A `<script>` inside `bodyPrepend` or `bodyAppend` **stays where you put it**. Scripts written directly in the template's body are relocated to after the container element, but slot content is not, and its comments survive rather than being stripped the way the template's are.
- Slot HTML is re-indented to match the surrounding document, exactly as the template's own markup is. Whitespace-sensitive elements (`<pre>`, `<textarea>`) are exempt and kept byte-for-byte, so their content is never reformatted.
- Neither body slot may contain the container element's ID or an `<!--ss-head-->` / `<!--ss-outlet-->` marker. Both are rejected at startup rather than producing a broken page: a duplicate `ss-outlet` would receive a second copy of the rendered page, and a duplicate container ID would give the app two mount points.
- Blank `headInlineScripts` entries are skipped, so a shared slots object can use a conditional like `isProd ? analytics : ''` without leaving an empty `<script></script>` behind.

<!-- prettier-ignore -->
> [!NOTE]
> Slots are baked into the processed template, which is cached per app, so they cannot vary per request. Anything request-specific belongs in `requestContext` or `publicAppConfig`, which are injected per request as context globals your slotted scripts can read.

<!-- prettier-ignore -->
> [!IMPORTANT]
> Slots are an **SSR-only** option, applied by the SSR server as it processes the template. Two places they do not reach:
>
> - **SSG.** `generateSSG()` runs the same template processing but takes no `templateSlots`, so a static build ignores them. Hard-code the content in `index.html` for SSG apps.
> - **Vite serving `index.html` directly**, as the `<project>:spa-dev` script the starter generates does. It runs bare `vite`, so unirend is not in the request path at all: no template processing runs, no context globals are injected, and the `ss-` markers stay put as inert comments. This is not specific to slots, but it is easy to hit, because a slotted theme script is exactly the thing you would go looking for in a dev server, and it reads `window.__FRONTEND_REQUEST_CONTEXT__`, which `spa-dev` never defines either. Use `<project>:serve:dev` for normal development, which is where slots apply. `spa-dev` is best treated as an escape hatch: when something is behaving strangely, it answers the question "does this still work in plain Vite, with unirend out of the picture?" That makes it useful for isolating a problem to the server side, but it is not a workflow to build in, and anything the server injects will be missing while you are there.

Nothing here is required. Slots only add to a template, never rewrite what it already contains, so hard-coding this content in `index.html` instead stays just as valid. An app that sets no slots is served exactly the HTML its template describes, with no leftover placeholder or blank line.

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
    // serveSSRWithHMR(sourcePaths, options) or serveSSRBuilt(buildDir, options)
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

### Reading Server Decorations

Both SSR and API servers expose read-only helpers to access server-level decorations set by plugins:

```ts
// Example: read cookie plugin info if the cookies plugin is registered
const has = server.hasDecoration('cookiePluginInfo');
const info = server.getDecoration<{
  signingSecretProvided: boolean;
  algorithm: string;
}>('cookiePluginInfo');
```

### Environment Flag in Handlers

Both `SSRServer` and `APIServer` populate several per-request properties on the Fastify request object. These are available in any handler, hook, or plugin.

#### isDevelopment

A boolean flag you can check to tailor behavior between dev and prod:

```ts
server.pageDataHandler.register('example', (request, reply, params) => {
  const isDev = (request as FastifyRequest & { isDevelopment?: boolean })
    .isDevelopment;

  return params.APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { environment: isDev ? 'development' : 'production' },
    pageMetadata: { title: 'Env', description: 'Env demo' },
  });
});
```

Reflects the current value of `getDevMode()` from `lifecycleion/dev-mode`, set per-request. Call `initDevMode()` at startup to control this value.

#### clientIP and serverLabel

The resolved real end-user IP and a label identifying which server handled the request (the raw connecting IP is `request.connectionIP`):

```ts
server.pageDataHandler.register('example', (request, reply, params) => {
  const ip = (request as FastifyRequest & { clientIP?: string }).clientIP;
  // Resolved once per request — real end user (connectionIP + SSR forwarding)

  const label = (request as FastifyRequest & { serverLabel?: string })
    .serverLabel;
  // e.g. 'SSR', 'API', or a custom value set via serverLabel option
});
```

#### domainInfo

Computed once per request from `request.hostname` using the public suffix list. Exposes `hostname` (port-stripped, IPv6-safe) and `rootDomain` (the apex domain without a leading dot, e.g. `'example.com'`, with an empty string for localhost and raw IPs).

`request.domainInfo` is always a `DomainInfo` object on the server, never `null`. (The `null` case only exists in the React `useDomainInfo()` hook, which returns `null` during SSG without a configured hostname or in a pure SPA where there is no server request.) `rootDomain` may still be an empty string for localhost and raw IPs, so always guard against that when building the `domain` attribute.

When setting a cookie in a plugin or hook, use `rootDomain` for the `domain` attribute. Pass `undefined` when `rootDomain` is empty. Fastify omits the attribute entirely, giving you a host-only cookie (the correct behavior for localhost and raw IPs, since `domain=.localhost` is invalid):

```ts
reply.setCookie('session', token, {
  path: '/',
  maxAge: 86400,
  domain: request.domainInfo?.rootDomain
    ? `.${request.domainInfo.rootDomain}`
    : undefined,
});
```

See the [themePlugin example in unirend-context.md](./unirend-context.md#server-plugin) for a real-world usage of both the server-side `reply.setCookie()` pattern and the client-side `document.cookie` equivalent.

#### isStaticAsset

Set to `true` before any response is sent for a static file. Defaults to `false` for all other requests. This applies to both the SSR server's built-in `staticContentRouter` (the `/assets` serving) and the `staticContent` plugin. They share the same internal serving path, so the marker, `onSend` bypass behavior, and hook ordering all work identically regardless of which one is active.

`isStaticAsset` is also available as an access-log field. Use `{{isStaticAsset}}` in finish/response templates, or read `ctx.isStaticAsset` in `accessLog.onResponse`. Request/start access logs run before static content has marked the request, so they always see `false`.

See [Hook Ordering and Cookie Renewal](./built-in-plugins/staticContent.md#hook-ordering-and-cookie-renewal) in the `staticContent` plugin docs for full details on `onSend` vs `onResponse` patterns and the `isStaticAsset` guard.

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

Frontend data loaders use the same grouped page types:

```typescript
// marketing/Routes.tsx
export const homeLoader = createPageDataLoader(config, 'marketing/home');

// accounts/Routes.tsx
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
    - `queryParams`: URL query params (`Record<string, unknown>`, parsed with qs and supports nested objects and arrays)
    - `requestPath`: resolved request path used by the loader
    - `originalURL`: full original URL

Guidance:

- Treat `params` as the authoritative routing context produced by the page data loader
- Do not reconstruct routing info from `originalRequest`
- Use `originalRequest` only for transport/ambient data (cookies, headers, IP, auth tokens)
- Use `reply` to set additional headers and cookies when needed. HTTP status and JSON content-type are managed by the framework from the envelope
- During SSR, `originalRequest` is the same request that initiated the render. After hydration, client-side loader fetches include their own transport context

Recommendation:

- Use `params.APIResponseHelpers` inside handlers (page data loader handlers and API route handlers) to construct envelopes. This is always the class configured on the server, with no separate import needed. If you've provided a custom subclass via `APIResponseHelpersClass`, handlers automatically use it without any extra wiring.

These helpers also auto-populate `request_id` from `request.requestID` that your request registered middleware/plugins may populate. See: [API Envelope Structure](./api-envelope-structure.md).

- For custom meta defaults (account/workspace/locale/build), prefer extending `APIResponseHelpers` in a small subclass and passing it as `APIResponseHelpersClass` in your server options. Handlers then receive your subclass automatically via `params.APIResponseHelpers`. See: [Extending helpers and custom meta](./api-envelope-structure.md#extending-helpers-and-custom-meta).
  - Rationale: centralizes conventions and avoids repeating per-handler generics/typing. Just ensure your meta type extends `BaseMeta`.

Examples:

```ts
// Unversioned handler (defaults to version 1)
server.pageDataHandler.register('test', function (request, reply, params) {
  return params.APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: 'version 1', version: params.version },
    pageMetadata: { title: 'Test', description: 'Version 1' },
  });
});

// Explicit versioned handlers
server.pageDataHandler.register('test', 2, function (request, reply, params) {
  return params.APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: 'v2', version: params.version },
    pageMetadata: { title: 'Test v2', description: 'Version 2' },
  });
});

server.pageDataHandler.register('test', 3, function (request, reply, params) {
  return params.APIResponseHelpers.createPageSuccessResponse({
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
  "route_params": {/* dynamic segments */},
  "query_params": {/* URL query params */},
  "request_path": "/some/path",
  "original_url": "https://example.com/some/path?x=1"
}
```

Return a standardized Page Response Envelope. Status codes in the envelope are preserved and used for SSR HTTP status.

**Handling Redirects:**

Page data loader handlers can return redirect responses using `APIResponseHelpers.createPageRedirectResponse()`. The page data loader automatically converts these to React Router redirects for proper client-side navigation:

```ts
// Example: Redirect after checking permissions
server.pageDataHandler.register(
  'protected-page',
  async (request, reply, params) => {
    const { isAuthorized } = await checkUserPermissions(request);

    if (!isAuthorized) {
      return params.APIResponseHelpers.createPageRedirectResponse({
        request,
        target: '/login',
        permanent: false,
        preserve_query: true, // Keeps ?returnTo=/protected-page
      });
    }

    // ... return page data
  },
);
```

**Important:** HTTP-level redirects (301/302 status codes) are **blocked** by the page data loader using `redirect: 'manual'`. This prevents security issues from following untrusted redirects. Always use the envelope redirect format shown above. See [API Envelope Structure docs](./api-envelope-structure.md#redirects-in-apipage-responses) for details.

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
- **HTTP fetch (client navigation OR separate API server)**: Cookies automatically forwarded via `Cookie` header, with responses forwarded back via `Set-Cookie`
- **Middleware placement**: For cookie-backed request context, see [Request Context Injection](#request-context-injection) for the SSR/API timing and failure-path guidance.

To use cookies, register the `cookies` plugin (see [cookies plugin docs](./built-in-plugins/cookies.md)):

```typescript
import { cookies } from 'unirend/plugins';

const server = serveSSRWithHMR(sourcePaths, {
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

  return; /* envelope */
});
```

**Note:** The framework handles the architecture choice automatically - you don't need to change your handler code when switching between single-server and separate-server deployments.

### Customizing Server-Side Page Data Requests

For separate-server deployments, where SSR and API run in different processes, you can customize the outgoing page-data request using the `resolvePageDataRequestOptions` option on the SSR server. This is a sync or async callback that runs **server-side only** and lets you:

- Rewrite the target URL (e.g., for internal load balancing or per-request host selection)
- Supply a `NodeAdapter` from `lifecycleion/http-client-node` for TLS over a private network (custom CA, mTLS, SNI override)
- Inject or override request headers (e.g., set `Host` when dialing by IP so services that validate the host header see the right value)

> **Note:** `resolvePageDataRequestOptions` is only relevant when SSR and API are on separate servers. When page data handlers live on this same SSR server, they run in-process. No HTTP request is made and this callback is never invoked.

#### Callback Signature

```ts
type ResolvePageDataRequestOptions = (context: {
  pageType: string; // e.g. 'home', 'about', 'not-found'
  baseURL: string; // the API base URL derived from INTERNAL_API_ENDPOINT or config
  fastifyRequest: FastifyRequest; // the live Fastify request for per-request decisions
}) => PageDataRequestOptions | Promise<PageDataRequestOptions>;

interface PageDataRequestOptions {
  baseURL?: string; // override the base URL for this request
  adapter?: NodeAdapter; // from lifecycleion/http-client-node
  headers?: Record<string, string>; // headers merged in after standard forwarded headers
}
```

Return an empty object (`{}`) to leave the defaults unchanged. If the callback throws or returns a rejected promise, the loader returns a 500 envelope immediately. No request is attempted. In development mode the error's `name`, `message`, and `stack` are included in `error.details` for debugging.

#### Example: URL Rewriting / Internal Load Balancing

```ts
const apiServers = [
  'http://api-1.internal:3001',
  'http://api-2.internal:3001',
  'http://api-3.internal:3001',
];

serveSSRBuilt({
  // ...
  resolvePageDataRequestOptions() {
    // Pick a random server on each request for simple load balancing
    const baseURL = apiServers[Math.floor(Math.random() * apiServers.length)];
    return { baseURL };
  },
});
```

#### Example: TLS Over a Private Network (NodeAdapter)

```ts
import { NodeAdapter } from 'lifecycleion/http-client-node';
import { readFileSync } from 'node:fs';

const internalAdapter = new NodeAdapter({
  ca: readFileSync('/etc/ssl/internal-ca.pem'),
  // When baseURL targets an IP address, set servername to the cert's SAN so
  // TLS hostname verification passes — it can't be inferred from a raw IP.
  servername: 'api.internal',
  // mtls: { cert, key } for mutual TLS if required
});

serveSSRBuilt({
  // ...
  resolvePageDataRequestOptions() {
    return {
      baseURL: 'https://10.0.1.5:8443', // where to connect (IP skips DNS)
      adapter: internalAdapter, // handles TLS — servername for cert verification
      headers: { Host: 'api.internal' }, // what the backend sees for virtual-host routing
    };
  },
});
```

### Custom API Routes

You can register versioned custom API routes using the server's `.api` shortcuts method surface (available on both `SSRServer` and `APIServer`, and inside plugins as `pluginHost.api`). These return standardized API envelopes and automatically set the HTTP response status to `status_code`.

**Endpoint Convention:** Endpoints should be specified as path segments WITHOUT leading slashes (e.g., `'demo/echo/:id'` not `'/demo/echo/:id'`). Leading slashes are allowed but will be stripped during normalization. This treats endpoints as segments appended to the API prefix and version, rather than as absolute paths.

```ts
// Register a simple GET endpoint at /api/v1/demo/echo/:id (with defaults)
server.api.get('demo/echo/:id', async (request, reply, params) => {
  return params.APIResponseHelpers.createAPISuccessResponse({
    request,
    data: {
      message: 'Hello from API shortcuts',
      id: params.routeParams.id,
      query: request.query,
    },
    statusCode: 200,
  });
});

// Versioned registration example (explicit version 2)
server.api.post('demo/items', 2, async (request, reply, params) => {
  const body = request.body as Record<string, unknown>;
  return params.APIResponseHelpers.createAPISuccessResponse({
    request,
    data: { created: true, version: 2, body },
    statusCode: 201,
  });
});
```

Notes:

- Endpoints are mounted under `apiEndpoints.apiEndpointPrefix` and optionally `/v{n}` when `versioned` is true.
- `apiEndpoints.apiEndpointPrefix: "/"` mounts API routes at the site root and makes every path an API path for error/not-found classification.
- SSR servers disallow wildcard endpoints at root prefix. Use a non-root prefix like `/api` to allow wildcards.
- Handlers must return a valid API envelope. Status codes are taken from `status_code`.
- Available helpers: `.api.get`, `.api.post`, `.api.put`, `.api.delete`, `.api.patch`.

#### API Route Handler Signature and Parameters:

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
    - `queryParams`: URL query params (`Record<string, unknown>`, parsed with qs and supports nested objects and arrays)
    - `requestPath`: path without query
    - `originalURL`: full original URL
    - `APIResponseHelpers`: the helpers class configured on this server. Use this instead of importing directly, so custom subclasses are respected

### Param Source Parity (Data Loader vs API Routes):

- Both handlers receive a `params` object with a similar routing context, but the source differs:
  - Data loader handlers: `params` are produced by the frontend page data loader and sent in the POST body (SSR short-circuit passes the same shape internally for consistency). Treat this as the authoritative routing context for page data.
  - API route handlers: `params` are assembled on the server from Fastify’s request (route/query/path/URL). Use these directly for API endpoints.
- In both cases, the best practice is to use `originalRequest` (the Fastify request) only for transport/ambient data (cookies/headers/IP/auth), and use `reply` for headers/cookies you want on the HTTP response. This also makes it easy to port code between page data loader handlers and custom API handlers.
- Use `request.clientIP` (not `request.ip`) to read the resolved real end-user IP. The framework sets `request.connectionIP` once per request using `getConnectionIP` (if configured) or falling back to `request.ip` (which reflects Fastify proxy handling when `fastifyOptions.trustProxy` is configured), and `request.clientIP` starts from it and is overridden with the forwarded original IP across an SSR → API hop (when `clientInfo` resolution is enabled). Both are the same in plugins, hooks, page data loader handlers, and API route handlers - so you never need to re-implement proxy header logic per handler. Use `request.connectionIP` for connection-level decisions and debugging. For per-user rate limiting prefer `request.clientIP` (the real user), because `connectionIP` can be a shared CDN/proxy address.

### Request Context Injection

SSR supports injecting per-request context data that will be available on the client.

**Request Context vs Public App Config:**

- **Request Context**: Per-page data that can vary between requests and be mutated on the client (e.g., page-specific state, user preferences, theme)
- **Public App Config**: Safe-to-share configuration shared across all pages (e.g., API URLs, feature flags, build info). Read within a request via `request.publicAppConfig` on SSR/API servers and `usePublicAppConfig()` in components. Each request gets a deep-frozen clone that is immutable within the request. You can mutate the source between requests to update values globally (e.g., rotating an API endpoint, updating a year), but those changes apply to all subsequent requests, not a specific user. Unlike `request.requestContext`, public app config is not forwarded, merged back, or injected by an API server.

**Design Philosophy:**

Both `SSRServer` and `APIServer` automatically initialize `request.requestContext` as an empty object on every request. This ensures:

- Handlers never need to check if `requestContext` exists - it's always at least `{}`
- Code written for SSR can run on a standalone API server with consistent behavior
- Plugins and middleware can safely write to `requestContext` without initialization checks

The important boundary is that each server owns its own HTTP request lifecycle, while SSR data loaders can bridge context between them. `APIServer` has `request.requestContext` so API-side plugins and handlers can use the same convention as SSR. Values that must affect the initial HTML should be seeded on the SSR server first. API-side values can flow back into SSR only through the data loader bridge described in [Separated SSR/API Architecture](#separated-ssrapi-architecture).

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
import { useRequestContext } from 'unirend/client';
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

When your SSR server and API server are separate instances, request context is automatically forwarded during SSR data loader requests:

1. **SSR server receives the browser request** and runs registered middleware/plugin hooks, which can populate `request.requestContext`
2. **SSR render starts** and React Router runs the page data loader
3. **Page data loader** sends `ssr_request_context` in the POST body to the external API server
4. **API server** receives and populates its own `request.requestContext` from incoming `ssr_request_context`
5. **API page data loader** can read/modify `request.requestContext` normally
6. **API envelope response helpers** automatically include `request.requestContext` in the `ssr_request_context` field of page response envelopes
7. **SSR page data loader** merges `ssr_request_context` from the response back into the SSR request
8. **SSR render finishes** and injects final merged context into HTML for client hydration

This forwarding and merge-back are automatic for SSR data loader requests when the API server accepts the forwarded context and the page response includes `ssr_request_context`. Handlers work the same whether co-located or separated. The merge in step 7 uses `Object.assign()`, so if both SSR middleware and the API page data handler set the same key, the API handler's value wins since it runs later in the request flow.

Use this boundary to decide where cookie-backed values should be read. In separated deployments, data/session checks usually belong in API page data loaders because both SSR data-loader requests and post-hydration browser requests go through the API server. Also seed values in SSR middleware when they must affect the initial HTML or a custom SSR 500 page without relying on `request.requestContext` merged back from an API data loader. Theme is a common example of something you may read in both places.

For example, session information can live primarily in API page data loaders even when the initial HTML is rendered by a separate SSR server. The SSR server receives those values through the data loader bridge when the API responds normally. If the API server is unavailable, the request times out, or the API data loader returns a 500 because it cannot check the session (for example, the database is down), the SSR loader receives a standardized 500 Page envelope instead. During SSR, a 500 data loader envelope triggers the SSR server's 500 handling the same way it would if the data loader were hosted locally, including `get500ErrorPage` when configured. Seed only the values that your SSR shell or custom 500 page must know without a successful API response on the SSR server itself.

**Security Note:** For separated architecture, the API server only accepts `ssr_request_context` when built-in `clientInfo` resolution marks the request as a trusted SSR server call. Forwarded SSR headers are denied by default, so opt in on the API server with `clientInfo: { trustForwardedHeaders: 'local' }`, `true`, or a custom trust function that matches your deployment. If you leave the default deny behavior in place, or disable resolution with `clientInfo: false`, `ssr_request_context` in the request body will be ignored to prevent spoofing from untrusted clients.

**Regular `server.api.*` Routes:** The bridge above is meant for page data loaders. Manual/raw API requests to routes registered with `server.api.get()`, `server.api.post()`, etc. are treated as normal API requests. They still receive `request.requestContext` for consistency with plugins and page data handlers, but they do not participate in the SSR data loader bridge.

**Public App Config:** `publicAppConfig` is not part of this bridge. SSR and API servers each clone their own configured source onto `request.publicAppConfig`. Use the same shared source object when both servers should expose the same public config.

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
- **Per-app configuration**: Each app gets its own `publicAppConfig`, templates, static assets, and error pages
- **Shared resources**: API handlers, plugins, and cookie policies are shared across all apps

### Monorepo Structure Tip

We recommend moving the default app's source into its own subfolder so it stays separate from the shared server code (plugins, start script, etc.) that lives at the root. Build output follows the same convention as the rest of the templates. Everything goes under `build/<app-name>/` at the repo root (already gitignored), with per-app subfolders inside it. A clean layout looks like this:

```
src/apps/my-app/
  app-a/               ← default app source (EntrySSR, EntryClient, Routes, components, vite.config.ts)
  app-b/               ← second app source
  server/              ← shared server code (plugins, ssr-component.ts, start.ts)
  serve-built.ts
  serve-hmr.ts

build/my-app/          ← gitignored at repo root (same convention as SSG/SSR templates)
  serve/               ← compiled serve-built.js
  app-a/client/
  app-a/server/
  app-b/client/
  app-b/server/
```

Build scripts chain each app's client and server builds back to back. The serve entry at the root registers additional apps via `registerBuiltApp()` / `registerHMRApp()`, pointing each app at its own build folder under the shared `build/` directory:

```json
{
  "my-app:build:app-a:client": "cd src/apps/my-app/app-a && vite build --outDir ../../../../build/my-app/app-a/client --base=/ --ssrManifest",
  "my-app:build:app-a:server": "cd src/apps/my-app/app-a && vite build --outDir ../../../../build/my-app/app-a/server --ssr EntrySSR.tsx",
  "my-app:build:app-b:client": "cd src/apps/my-app/app-b && vite build --outDir ../../../../build/my-app/app-b/client --base=/ --ssrManifest",
  "my-app:build:app-b:server": "cd src/apps/my-app/app-b && vite build --outDir ../../../../build/my-app/app-b/server --ssr EntrySSR.tsx",
  "my-app:build:serve": "cd src/apps/my-app && bun build serve-built.ts --outdir ../../../build/my-app/serve --target=node --external vite --define 'IS_BUILT=true'",
  "my-app:build": "bun run my-app:build:app-a:client && bun run my-app:build:app-a:server && bun run my-app:build:app-b:client && bun run my-app:build:app-b:server && bun run my-app:build:serve",
  "my-app:serve:built:dev": "node build/my-app/serve/serve-built.js dev",
  "my-app:serve:built:prod": "node build/my-app/serve/serve-built.js prod"
}
```

Keep the SSR starter template's serve build and run scripts in place alongside the per-app bundle scripts.

If you started from the SSR starter template (which puts source at the folder root), moving the default app into a subfolder is a manual step. Update the Vite config paths and serve entry accordingly. The framework has no opinion on folder layout.

**If you use the build info option:** add an entry to `build-info.config.json` for each new app's `current-build-info.ts` output path, and add those paths to `.gitignore` and `.prettierignore` so the generated files are excluded.

### Usage Example

#### Production Mode

```typescript
import { serveSSRBuilt } from 'unirend/server';

// Create server with default app
const server = serveSSRBuilt('./build-main', {
  publicAppConfig: { api_endpoint: 'https://api.example.com' },
});

// Register additional apps - each supports app-specific options (excluding server-wide settings like port/host)
server.registerBuiltApp('marketing', './build-marketing', {
  // App-specific frontend config (injected into client)
  publicAppConfig: { api_endpoint: 'https://marketing-api.example.com' },

  // Optional: Custom server entry (default: "EntrySSR")
  // serverEntry: 'custom-entry',

  // Optional: Custom HTML template (default: "client/index.html")
  // template: 'custom/marketing.html',

  // Optional: CDN base URL for asset URL rewriting
  // CDNBaseURL: process.env.CDN_BASE_URL,

  // Optional: Custom folder names (default: 'client' and 'server')
  // clientFolderName: 'client-custom',
  // serverFolderName: 'server-custom',

  // Optional: Custom container ID (default: 'root')
  // containerID: 'marketing-root',

  // Optional: Custom 500 error page
  // get500ErrorPage: async (request, error, isDevelopment) => {
  //   return `<html><body><h1>Marketing Error</h1></body></html>`;
  // },

  // Optional: public/ files and subfolders for this app (favicon, robots.txt, etc.)
  // publicFiles: ['/favicon.svg', '/robots.txt'],
  // publicFolders: ['/.well-known'],

  // Optional: Static content configuration
  // - Default (omit): Serves from buildDir/client/assets at /assets with immutable asset detection
  // - false: Disable static serving (e.g., when using a CDN)
  // - Custom config with singleAssetMap/folderMap entries: REPLACES the
  //   /assets default — mount /assets yourself (with detectImmutableAssets)
  //   or hashed bundles won't be served. publicFiles/publicFolders entries
  //   are still folded into the custom config. (/assets is rejected in those
  //   options, but here in folderMap it's expected — this is the one place
  //   to (re)mount it.)
  // - Custom config with no map entries: tuning-only (cache sizes, TTLs,
  //   headers, compression) — the /assets default still applies.
  // staticContentRouter: {
  //   folderMap: {
  //     '/assets': { path: './build-marketing/client/assets', detectImmutableAssets: true },
  //     '/downloads': './build-marketing/client/downloads',
  //   },
  // },
});

// Route requests to the correct app via middleware
server.fastifyInstance.addHook('onRequest', async (request, reply) => {
  const subdomain = request.hostname.split('.')[0];

  if (subdomain === 'marketing') {
    request.setActiveSSRApp('marketing');
  } else if (subdomain === 'admin') {
    request.setActiveSSRApp('admin');
  }
  // Falls back to '__default__' (main app) if not set
});

await server.listen(3000);
```

#### Development Mode

```typescript
import { serveSSRWithHMR } from 'unirend/server';

const server = serveSSRWithHMR(
  {
    serverEntry: './src/EntrySSR.tsx',
    template: './index.html',
    viteConfig: './vite.config.ts',
  },
  {
    publicAppConfig: { api_endpoint: 'http://localhost:3001' },
  },
);

// Register additional apps - each supports app-specific options (excluding server-wide settings like port/host)
server.registerHMRApp(
  'marketing',
  {
    serverEntry: './src/marketing/EntrySSR.tsx',
    template: './src/marketing/index.html',
    viteConfig: './vite.marketing.config.ts',
  },
  {
    // App-specific frontend config (injected into client)
    publicAppConfig: { api_endpoint: 'http://localhost:3002' },

    // Optional: Custom folder names (default: 'client' and 'server')
    // clientFolderName: 'client-custom',
    // serverFolderName: 'server-custom',

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
    request.setActiveSSRApp('marketing');
  }
});

await server.listen(3000);
```

### API Reference

**registerBuiltApp(appKey, buildDir, options?)**

Register an additional production-mode app. Must be called **before** `listen()`.

- `appKey`: Unique identifier selected per request with `request.setActiveSSRApp(appKey)` and readable from `request.activeSSRApp`. Cannot be `"__default__"` or contain path separators.
- `buildDir`: Path to the app's build directory
- `options`: App-specific built options (subset of `serveSSRBuilt()` options, excluding server-wide settings like `port`, `host`, `logging`, etc.)

**registerHMRApp(appKey, sourcePaths, options?)**

Register an additional development-mode app. Must be called **before** `listen()`.

- `appKey`: Unique identifier selected per request with `request.setActiveSSRApp(appKey)` and readable from `request.activeSSRApp`. Cannot be `"__default__"` or contain path separators.
- `sourcePaths`: Dev source paths object (same as `serveSSRWithHMR()`)
- `options`: App-specific HMR options (subset of `serveSSRWithHMR()` options, excluding server-wide settings like `port`, `host`, `logging`, etc.)

**Static Content Defaults (Production Only)**

Each production app (both main and registered) automatically serves static assets unless `staticContentRouter` is set to `false`:

- **Default behavior**: Serves files from `buildDir/<clientFolderName>/assets` at the `/assets` URL path
- **Immutable assets**: Fingerprinted files (e.g., `main-abc123.js`) get `Cache-Control: public, max-age=31536000, immutable`
- **Disable**: Set `staticContentRouter: false` to disable (useful when using a CDN)
- **Customize**: Provide your own `staticContentRouter` configuration. If it defines `singleAssetMap`/`folderMap` entries, it replaces the `/assets` default, so mount `/assets` yourself (with `detectImmutableAssets: true`) if you still want the built bundles served locally. `publicFiles`/`publicFolders` entries are still folded into the custom config. A config with no map entries just tunes the cache (sizes, TTLs, headers, compression), and the `/assets` default is still mounted as if you had not customized anything.

Each registered app gets its own independent static content configuration based on its `buildDir` and `clientFolderName`.

**The `public/` Rule**

Files in a Vite app's `public/` folder (favicon files, `robots.txt`, web manifests, logos) are copied verbatim to the client build root and referenced by literal URL. In dev/HMR mode Vite's middleware serves them implicitly, but the production static router is driven by a declared list and only touches disk for known files. Anything in `public/` must therefore be declared, individual files with `publicFiles` and whole subfolders with `publicFolders` (or it 404s in production):

```typescript
serveSSRBuilt('./build', {
  publicFiles: ['/favicon.svg', '/favicon.ico', '/robots.txt'],
  publicFolders: ['/.well-known'],
});
```

Two guardrails keep this from failing silently:

- **Startup existence check**: In built mode, every declared file and folder is verified to exist in the client build dir at boot. A typo or a bad build throws a clear error listing the missing paths instead of 404ing in production.
- **Root-mount guard**: A `staticContentRouter` `folderMap` prefix of `/` (or a folder resolving to the client build root) is rejected at config time, as is a bare `/` in `publicFolders`. It would stat the disk on every page request and expose `/index.html` and `/.vite/manifest.json`, so it is an error rather than a pattern.

Projects generated from the starter templates declare these lists as `PUBLIC_FILES` and `PUBLIC_FOLDERS` in each app's `consts.ts`, and the repo-level `bun run check:public-assets` script (part of `bun run check`) fails CI when the lists drift from the actual `public/` folder in either direction (files under a declared folder are covered automatically). See [Starter Templates](./starter-templates.md).

#### CDN Deployments

Setting `staticContentRouter: false` hands all static serving to a CDN, and `publicFiles`/`publicFolders` cannot be combined with it. That does not mean deleting the lists. Keep them declared in `consts.ts` so the drift check still guards `public/`, and gate what you pass to the server on an environment variable. The same code then supports both deployments, a plain production build serves everything itself (handy for testing the built server locally), and a CDN build skips the local mounts:

```typescript
import { PUBLIC_FILES, PUBLIC_FOLDERS } from './consts';

const useCDN = process.env.ASSETS_FROM_CDN === 'true';

serveSSRBuilt('./build', {
  staticContentRouter: useCDN ? false : undefined,
  publicFiles: useCDN ? undefined : PUBLIC_FILES,
  publicFolders: useCDN ? undefined : PUBLIC_FOLDERS,
});
```

Pair this with `CDNBaseURL` so the rendered HTML points asset URLs at the CDN, and make sure the CDN actually has the `public/` files (most pull-through CDNs fetch from your origin, which would 404 without the mounts, so this pattern fits push-style CDNs or object storage where the build output is uploaded).

Beyond offloading traffic, this setup also fixes a correctness problem with rolling deploys. If multiple instances self-serve their assets behind a load balancer with no session affinity, a page rendered by a new-build instance references the new build's hashed bundles (e.g. `/assets/index-BGz3GlRg.js`), and the browser's follow-up asset request can land on an instance still running the old build, which 404s on a hash it has never seen (the reverse skew hits users who loaded a page just before the rollout). Self-serving assets is fine for a single instance or an atomic blue/green switch, but for rolling deploys across instances, uploading each build's output to a CDN or object store before the rollout means every instance's HTML points at storage that has all versions.

### Routing Strategies

Use `request.setActiveSSRApp(appKey)` in early SSR middleware to select a registered app for the current request. The method validates that the app exists, refreshes app-derived request values like `request.publicAppConfig`, and updates the app-level CDN default unless middleware already overrode `request.CDNBaseURL`. `request.activeSSRApp` is read-only.

#### 1. Subdomain-Based Routing

```typescript
server.fastifyInstance.addHook('onRequest', async (request, reply) => {
  const subdomain = request.hostname.split('.')[0];

  switch (subdomain) {
    case 'marketing':
      request.setActiveSSRApp('marketing');
      break;
    case 'app':
      request.setActiveSSRApp('app');
      break;
    // Falls back to '__default__' for main domain
  }
});
```

#### 2. Path-Based Routing

```typescript
server.fastifyInstance.addHook('onRequest', async (request, reply) => {
  if (request.url.startsWith('/marketing')) {
    request.setActiveSSRApp('marketing');
  } else if (request.url.startsWith('/admin')) {
    request.setActiveSSRApp('admin');
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
    request.setActiveSSRApp('variant-b');
  }
  // Falls back to '__default__' for variant A
});
```

**Note**: This approach uses cookies to maintain consistent variant assignment across requests. The cookie settings align with [recommended patterns](./built-in-plugins/cookies.md#recommended-patterns) for first-party session cookies.

### Important Notes

#### Mode Enforcement

- Production servers (via `serveSSRBuilt`) can only register production apps with `registerBuiltApp()`
- Development servers (via `serveSSRWithHMR`) can only register development apps with `registerHMRApp()`
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
- **Public app config**: Each app can have its own `publicAppConfig` injected as `window.__PUBLIC_APP_CONFIG__`

#### Resource Considerations

- Each Vite instance (dev mode) uses ~50-100MB of memory
- Each static content cache (prod mode) uses ~50MB of memory
- **HMR transport (dev mode)**: Each app's Vite instance shares the main HTTP server for its HMR WebSocket rather than opening a separate port. Apps are disambiguated by a unique path (`/__hmr/<appKey>`), and the browser connects back to the page's own port automatically. No separate HMR ports are allocated, so there is nothing to configure. When `enableWebSockets` is on, Vite HMR and your WebSocket handlers coexist on the same port: HMR upgrades (subprotocol `vite-hmr`/`vite-ping`) go to Vite, all other upgrades go to your handlers.
- **Recommendation**: Limit to 3-5 apps per server instance for optimal performance

#### Error Page Patterns

The starter template ships an app-agnostic `get500ErrorPage` that reads the theme preference from the request and stays neutral, so it works as-is for any app. When you run multiple apps, two patterns are worth knowing.

**Detecting the active app inside the handler.** The handler receives the Fastify request, and the request is fully decorated by the time an error is handled. You can read `request.activeSSRApp` to find out which app is being served and branch on it, without needing any extra wiring:

```typescript
function get500ErrorPage(request, error, isDevelopment) {
  const appKey = request.activeSSRApp; // e.g. "admin", "marketing", or "__default__"
  // Adjust branding, title, or "Go Home" link based on appKey
}
```

Keep in mind that `activeSSRApp` reflects wherever the request was when it failed. If something crashed before your middleware called `request.setActiveSSRApp(appKey)`, the request is still on `__default__`, so treat that as the "unknown app" case rather than assuming your app was selected.

**Reusing one `get500ErrorPage` function across apps with an override argument.** If you'd rather pass the app identity in explicitly instead of reading it off the request, give your shared function an optional argument and pass a different label wherever each app is set up. This keeps a single source of truth for the markup while letting each app brand its own page, and the label removes the need to branch on `request.activeSSRApp` inside the handler. It does not change which handler runs, though: the error handler still selects the app from `request.activeSSRApp`, so a failure before your middleware calls `setActiveSSRApp` invokes the base config's handler, not your app's wrapper. Keep the base config's page neutral for exactly that case.

The base app takes the option through its serve function (`serveSSRBuilt` or `serveSSRWithHMR`), and each additional app takes it through the matching register call (`registerBuiltApp` or `registerHMRApp`):

```typescript
// Shared function with an optional label override
function get500ErrorPage(request, error, isDevelopment, appLabel?: string) {
  const label = appLabel ?? request.activeSSRApp;
  // ...brand the page with `label`
}

// Base app: pass the label through the serve function's options
const server = serveSSRBuilt('./build', {
  get500ErrorPage: (req, err, dev) => get500ErrorPage(req, err, dev, 'Main'),
});

// Additional app: pass its own label through the register call
server.registerBuiltApp('admin', './build-admin', {
  get500ErrorPage: (req, err, dev) => get500ErrorPage(req, err, dev, 'Admin'),
});
```

**The default app as a catch-all.** Both single-app and multi-app servers always have a `__default__` app built from the base config you pass to `serveSSRWithHMR` or the production serve function. That makes the base config's `get500ErrorPage` a natural place for a neutral fallback page that covers early failures and any request that never selected an app. Register branded handlers on the individual apps, and let `__default__` stay generic.

**Previewing per-app error pages while testing.** With more than one app it's awkward to trigger each app's branded 500 through normal routing. A simple approach is to have your `setActiveSSRApp` middleware honor an override query in development, for example `?__app=admin`, so you can force the active app for a request and see its error page. Gate this behind the same development-only flag as the demo error routes (the starter template exposes those through `ENABLE_TEST_ROUTES` in `consts.ts`) so it never affects production traffic.

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

### Basic Usage

```typescript
import { serveAPI } from 'unirend/server';

async function main() {
  const api = serveAPI({
    // Optional: versioned endpoints configuration
    // apiEndpoints: { apiEndpointPrefix: "/api", versioned: true, pageDataEndpoint: "page_data" },
    // Optional: plugins for custom routes, hooks, decorators
    // plugins: [myApiPlugin],
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
    // errorHandler: (request, error, isDev, isPageData, params) => params.APIResponseHelpers.createAPIErrorResponse({ ... }),
    // notFoundHandler: (request, isPageData, params) => params.APIResponseHelpers.createAPIErrorResponse({ statusCode: 404, ... }),
  });

  await api.listen(3001, 'localhost');
}

main().catch(console.error);
```

> **🐳 Container Deployment:** For container deployments, see the [container binding note](#create-production-ssr-server) in the SSR section - the same advice applies to APIServer.

### Unix Socket Listening

`APIServer` and `servePlain()` can listen on a Unix domain socket instead of a TCP port:

```typescript
import { serveAPI } from 'unirend/server';

const api = serveAPI();

await api.listen({ path: '/tmp/my-api.sock' });
```

This is intended for same-host sidecar/internal service patterns where another server-side process talks to the API without exposing a TCP port. Browser fetch cannot connect directly to a Unix socket. Use this for server-to-server traffic through a Node/Bun HTTP client or an adapter that supports socket paths located on the same server host or container.

Generated API starter apps also support this mode with the `<APP_NAME>_SOCKET_PATH` environment variable, for example `API_SOCKET_PATH` for an app named `api`. When that variable is set, the generated component listens on the socket path instead of `<APP_NAME>_PORT`.

### API-Specific Options

In addition to the [shared server configuration](#shared-server-configuration), the API server accepts:

- `publicAppConfig?: Record<string, unknown>`
  - Safe-to-share config cloned and frozen on each API request as `request.publicAppConfig`.
  - API servers do not inject this into HTML. Include selected values in your own envelope `meta`, payload, or custom response handlers when a client should receive them.
  - `CDNBaseURL` is an SSR/SSG HTML rewriting and injection feature. API servers do not populate `request.CDNBaseURL`, even when used as a plain web/static server. Use `publicAppConfig` or your own plugin decoration if API-side handlers need a public CDN URL.
  - Like SSRServer, APIServer sets `request.domainInfo` on every request (see [Environment flag in handlers](#environment-flag-in-handlers)).
- `errorHandler?: Function | { api?, web? }`
  - Function form: Returns JSON envelope for API servers (see [JSON-Only](#json-only-ssr-compatible)), or `WebResponse` when `apiEndpoints.apiEndpointPrefix: false` (see [Web-Only](#web-only-plain-web-server)).
  - Object form: Split handlers for mixed API + web servers (see [Split Handlers](#split-handlers-mixed-api--web-server)). Either handler can be omitted - missing handlers fall through to default behavior.
- `notFoundHandler?: Function | { api?, web? }`
  - Function form: Returns JSON envelope for API servers (see [JSON-Only](#json-only-ssr-compatible)), or `WebResponse` when `apiEndpoints.apiEndpointPrefix: false` (see [Web-Only](#web-only-plain-web-server)).
  - Object form: Split handlers for mixed API + web servers (see [Split Handlers](#split-handlers-mixed-api--web-server)). Either handler can be omitted - missing handlers fall through to default behavior.
- `closingHandler?: Function | { api?, web? }`
  - Custom 503 response for requests received while `stop()` is closing the server.
  - Function form: Returns JSON envelope for API requests.
  - Object form: Split handlers for mixed API + web servers (see [Split Handlers](#split-handlers-mixed-api--web-server)). Either handler can be omitted - omitted handlers use Unirend's default 503 response.

Note: Unlike SSR servers, the API server allows full wildcard routes (including root wildcards) in plugins.

### API Error Handlers

Both `errorHandler` and `notFoundHandler` support two forms: a simple function or an object with split handlers. Choose based on your server type:

- **API-only server** (JSON responses): Use function form returning API envelopes
- **Web-only server** (`apiEndpointPrefix: false`): Use function form returning `WebResponse` (HTML/text/json)
- **Mixed API + web server**: Use split form with separate `api` and `web` handlers

#### JSON-Only (SSR Compatible)

The function form is compatible with the SSR server's `APIHandling.errorHandler` and `APIHandling.notFoundHandler`. Use this when your API server only returns JSON responses:

API/page error, not-found, and closing handlers receive a narrow `params` object with `params.APIResponseHelpers`, the same configured helper class route handlers receive. Use it instead of importing `APIResponseHelpers` directly so custom `APIResponseHelpersClass` metadata/defaults are respected. Split-form `web` handlers do not receive this params object because they return `WebResponse`, not API/Page envelopes. If a custom error/not-found handler throws, Unirend logs that failure and falls back to the built-in handler.

```typescript
import { serveAPI } from 'unirend/server';
import { AppResponseHelpers } from './AppResponseHelpers';

const server = serveAPI({
  APIResponseHelpersClass: AppResponseHelpers,
  // Custom error handler - returns JSON envelope
  errorHandler: (request, error, isDevelopment, isPageData, params) => {
    // isPageData distinguishes page data requests from regular API requests
    if (isPageData) {
      return params.APIResponseHelpers.createPageErrorResponse({
        request,
        statusCode: 500,
        errorCode: 'internal_server_error',
        errorMessage: isDevelopment ? error.message : 'Internal server error',
        pageMetadata: {
          title: 'Server Error',
          description: 'An internal server error occurred',
        },
        errorDetails: isDevelopment ? { stack: error.stack } : undefined,
      });
    }

    return params.APIResponseHelpers.createAPIErrorResponse({
      request,
      statusCode: 500,
      errorCode: 'internal_server_error',
      errorMessage: isDevelopment ? error.message : 'Internal server error',
      errorDetails: isDevelopment ? { stack: error.stack } : undefined,
    });
  },

  // Custom 404 handler - returns JSON envelope
  notFoundHandler: (request, isPageData, params) => {
    if (isPageData) {
      return params.APIResponseHelpers.createPageErrorResponse({
        request,
        statusCode: 404,
        errorCode: 'not_found',
        errorMessage: `Page data endpoint not found: ${request.url}`,
        pageMetadata: {
          title: 'Not Found',
          description: 'The requested page data could not be found',
        },
      });
    }

    return params.APIResponseHelpers.createAPIErrorResponse({
      request,
      statusCode: 404,
      errorCode: 'not_found',
      errorMessage: `Endpoint not found: ${request.url}`,
    });
  },
});
```

This is the same signature used by SSR server's `APIHandling` options (see [Options (shared)](#options-shared) above), making it easy to share handler logic between SSR and standalone API servers. The `isPageData` parameter distinguishes page data loader requests from regular API requests. By checking `isPageData`, you can return a page error response (via `params.APIResponseHelpers.createPageErrorResponse` with metadata like page title/description) or a standard API error response (via `params.APIResponseHelpers.createAPIErrorResponse`).

**Convention: stack traces in development** When writing custom JSON error handlers, include `errorDetails: isDevelopment ? { stack: error.stack } : undefined` so that stack traces appear in development error responses. This matches the convention used by the built-in page data loader and the default error handler. Components like `GenericError` in the SSR demo look for `error.details.stack` to display stack traces during development. See [Error Handling - Error Responses with Stack Trace](./error-handling.md#5-error-responses-with-stack-trace-development-only) for more details.

#### Web-Only (Plain Web Server)

Use `servePlain()` when you want APIServer's server lifecycle, plugins, logging, client identity, shutdown handling, compression, and server utilities without API/page-data route helpers. It wraps APIServer with `apiEndpointPrefix: false`, so use plugins/static/raw routes for content and use simple function-form `WebResponse` handlers for errors, not-found responses, and shutdown responses.

The `server.api.*`, `pluginHost.api.*`, and `server.pageDataHandler.*` helpers are disabled in this mode. Registering those handlers and then starting the server throws, because they are envelope-first helpers.

```typescript
import { servePlain } from 'unirend/server';
import { staticContent } from 'unirend/plugins';
import { escapeHTML } from 'unirend/utils';

const server = servePlain({
  plugins: [
    // Serve static files (HTML, CSS, JS, images)
    staticContent({
      folderMap: { '/': './public' },
    }),

    // Register plain/raw routes through plugins. These return normal Fastify
    // payloads and are not converted to Unirend API envelopes.
    (pluginHost) => {
      pluginHost.get('/health', async () => ({
        ok: true,
      }));

      pluginHost.get('/maintenance', async (_request, reply) => {
        reply.code(503).header('Retry-After', '60');

        return {
          ok: false,
          message: 'Maintenance window active',
        };
      });

      pluginHost.get('/hello', async () => '<h1>Hello</h1>');
    },
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

  closingHandler: () => ({
    contentType: 'html',
    content: `<!DOCTYPE html>
      <html>
        <body>
          <h1>503 - Server Shutting Down</h1>
          <p>Please retry shortly.</p>
        </body>
      </html>`,
    statusCode: 503,
  }),
});
```

**Note**: `servePlain()` always disables API handling, so all requests are treated as web requests. Function-form `errorHandler`, `notFoundHandler`, and `closingHandler` return `WebResponse`, and Unirend's default 404/500/503 fallbacks are web HTML responses. The returned `PlainServer` type does not expose `server.api.*` or `server.pageDataHandler.*`. If you want envelope responses from those helpers, use `serveAPI()` with an API prefix such as `/api` or `/`.

If you want one server to serve regular HTML/raw Fastify routes and also expose Unirend API envelopes, use `serveAPI()` instead of `servePlain()`: keep an API prefix such as `/api`, register HTML routes through plugins with `pluginHost.get/post/...`, register API routes with `server.api.*` or `pluginHost.api.*`, and use split `errorHandler` / `notFoundHandler` / `closingHandler` forms so API paths return envelopes while web paths return `WebResponse`.

#### Split Handlers (Mixed API + Web Server)

When serving **both** JSON APIs and web content on the same server, use the split form to return different response types based on the request:

Both `api` and `web` handlers are optional. If a handler is omitted or throws an error, the error is logged to the Fastify logger and the server falls back to the default response for that request type (JSON envelope for API requests, default error page for web requests). Check your server logs to debug handler failures:

```typescript
import { serveAPI } from 'unirend/server';
import { staticContent } from 'unirend/plugins';
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
    api: (request, isPageData, params) =>
      params.APIResponseHelpers.createAPIErrorResponse({
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
    api: (request, error, isDev, isPageData, params) =>
      params.APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 500,
        errorCode: 'internal_server_error',
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

The `WebResponse` type for web handlers:

```typescript
interface WebResponse {
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

When `apiEndpointPrefix: "/"`, every path is treated as API for request classification. API routes mount at the root, page data mounts at `/page_data/...` (or `/v{n}/page_data/...` when versioned), and default not-found/error responses are envelopes. Use `apiEndpointPrefix: false` only when you want plain web behavior instead of API envelopes.

This means all your API endpoints (including versioned ones under `/api/v1/`, `/api/v2/`, etc.) are detected as API requests, while everything else is treated as web requests.

## Graceful Shutdown

Both `SSRServer` and `APIServer` support graceful shutdown via the `stop()` method. In production, you should handle process signals to cleanly shut down the server:

```typescript
import { serveSSRBuilt } from 'unirend/server';
import type { SSRServer } from 'unirend/server';
let server: SSRServer | null = null;

async function main() {
  server = serveSSRBuilt('./build', {/* options */});

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
- The `stop()` method gracefully stops the server, waits for in-flight requests to complete, then closes the server
- Requests that arrive during shutdown receive a Unirend-managed `503 Service Unavailable` response. API/page-data requests get a JSON envelope by default, and web requests get a small HTML page by default. Use `closingHandler` to customize either handler.
- Calling `stop()` multiple times is safe - it checks if the server is listening and returns early if already stopped
- In your process signal handlers, check `server && server.isListening()` before calling `stop()` to ensure the server exists and is running
- When WebSockets are enabled, the `preClose` hook is called before closing connections (see [WebSockets](./websockets.md))
- Set the server reference to `null` after shutdown to release resources and prevent accidental reuse
- Declare the server variable (`let server: SSRServer | null = null`) before defining the shutdown handler so it's in scope. Before creating a new server instance, check for an existing one, and handle it appropriately (eg. stop it first, and then create new one)
- If you dynamically create or reassign server instances, consider using a factory function that returns a fresh server, see [Lifecycle and Persistence](./server-plugins.md#lifecycle-and-persistence) for details on how routes and handlers persist across `stop()`/`listen()` cycles

### Force Shutdown

All server types (`SSRServer`, `APIServer`, `StaticWebServer`, `RedirectServer`) expose a `closeAllConnections()` method that immediately terminates the current HTTP connections, tracked Fastify WebSocket clients, and Vite HMR client connections in SSR development mode. Unlike `stop()`, it does not wait for in-flight requests to finish, preserve graceful shutdown responses, stop the listening server, or complete shutdown cleanup.

Use it as an escalation helper only after `stop()` has started or right before a forced process exit:

```typescript
const shutdown = async (signal: string) => {
  try {
    if (server && server.isListening()) {
      await server.stop();
    }
  } catch (err) {
    console.error('Graceful shutdown failed:', err);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => {
  setTimeout(() => server?.closeAllConnections(), 5000);
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  setTimeout(() => server?.closeAllConnections(), 5000);
  void shutdown('SIGTERM');
});
```

`closeAllConnections()` is a no-op if the server is not started.

## WebSockets

Both `SSRServer` and `APIServer` support WebSockets. Enable with `enableWebSockets: true` and register handlers via `server.registerWebSocketHandler({ path, preValidate?, handler })`.

WebSocket registration is a server-level API, not a plugin-host method. It remains available when APIServer is used in plain web mode (`apiEndpoints.apiEndpointPrefix: false`). If a WebSocket `preValidate` handler rejects an upgrade, the rejection response is still an API envelope. Plain web mode only disables API/page-data route helpers such as `server.api.*`, `pluginHost.api.*`, and `pageDataHandler.*`. If you want a root-mounted API server with envelopes everywhere, use `apiEndpointPrefix: "/"` instead of plain mode.

Because Vite HMR shares the main HTTP server in development (see [HMR transport](#resource-considerations)), Vite HMR and your own WebSocket handlers coexist on one port. The `demos/ssr-ws-chat` demo is a single-page SSR app with an echo chat over a WebSocket: run `bun run ssr-ws-chat:serve:dev`, open http://localhost:3005, then edit `components/EditMeBanner.tsx` to watch HMR update the page while the chat (owned by a separate module) stays connected on the same port.

See full guide and examples: [WebSockets](./websockets.md).

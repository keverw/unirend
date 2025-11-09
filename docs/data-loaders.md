# Data Loaders

Unirend centralizes route data fetching through a single loader system. Define loaders per route using helpers, and return standardized envelopes. See `docs/api-envelope-structure.md` for the canonical envelope specs.

- Create config: `createDefaultPageLoaderConfig(apiBaseUrl)` or provide a custom config
- Define loaders: `createPageLoader(config, pageType)` or `createPageLoader(localConfig, localHandler)`
- Errors/redirects: handled uniformly via envelopes. Integrate with `RouteErrorBoundary` and `useDataloaderEnvelopeError`

<!-- toc -->

- [Quick Start](#quick-start)
- [Which loader should I use](#which-loader-should-i-use)
- [Page Type Handler (Fetch/Short-Circuit) Data Loader](#page-type-handler-fetchshort-circuit-data-loader)
- [Local Data Loader](#local-data-loader)
- [Using Loaders in React Router (Applies to Both Types)](#using-loaders-in-react-router-applies-to-both-types)
- [Data Loader Error Transformation and Additional Config](#data-loader-error-transformation-and-additional-config)
  - [`errorDefaults` presets](#errordefaults-presets)
  - [`connectionErrorMessages`](#connectionerrormessages)
  - [`transformErrorMeta(params)`](#transformerrormetaparams)
  - [`statusCodeHandlers`](#statuscodehandlers)
  - [Additional configuration options](#additional-configuration-options)

<!-- tocstop -->

## Quick Start

HTTP‑based Loader

```ts
import {
  createPageLoader,
  createDefaultPageLoaderConfig,
} from 'unirend/router-utils';

const config = createDefaultPageLoaderConfig('http://localhost:3001');
export const homeLoader = createPageLoader(config, 'home');
```

On the server, register a page data handler for the same `pageType`. See: [SSR — Page Data Handlers and Versioning](./ssr.md#page-data-handlers-and-versioning)

```ts
// On your SSR server instance
import { APIResponseHelpers } from 'unirend/api-envelope';

server.registerDataLoaderHandler('home', (request, params) => {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: 'Hello from server', route: params.route_params },
    pageMetadata: { title: 'Home', description: 'Home page' },
  });
});
```

Local Loader

```ts
import { createPageLoader } from 'unirend/router-utils';

export const localInfoLoader = createPageLoader(
  { timeoutMs: 8000 },
  ({ route_params, query_params }) => ({
    status: 'success',
    status_code: 200,
    request_id: `local_${Date.now()}`,
    type: 'page',
    data: { route_params, query_params },
    meta: { page: { title: 'Local', description: 'Local loader' } },
    error: null,
  }),
);
```

## Which loader should I use

- HTTP‑based loader: you need cookies or request information forwarded, you have a separate API server, or you handle auth flows
- Local loader: SSG or simple data needs, and you do not need cookie propagation

## Page Type Handler (Fetch/Short-Circuit) Data Loader

Uses HTTP to call your API server page data handlers when they are not co‑located on the same SSR server, and short‑circuits to an internal call on SSR when the handler is registered on the same `SSRServer` instance.

```ts
import {
  createPageLoader,
  createDefaultPageLoaderConfig,
} from 'unirend/router-utils';

const config = createDefaultPageLoaderConfig('http://localhost:3001');

// Per-route loader (pageType mapped to handlers on the server)
export const homeLoader = createPageLoader(config, 'home');
```

Notes:

- Short-circuiting only happens on SSR when handlers are registered on the same `SSRServer`

- HTTP‑based loader can forward selected request information from SSR to your API — cookies, user agent, client IP, request ID, and correlation ID. SSR removes untrusted headers and sets trusted ones before forwarding. See: [SSR header and cookies forwarding](./ssr.md#header-and-cookies-forwarding)
  - Cookie forwarding is controlled by `cookieForwarding` on the SSR server
    - If both `allowCookieNames` and `blockCookieNames` are unset or empty, all cookies are forwarded
    - `allowCookieNames` forwards only the listed cookie names
    - `blockCookieNames` blocks the listed names, or set to `true` to block all cookies
    - The block list takes precedence over the allow list
    - The policy applies to cookies forwarded on SSR fetches and `Set-Cookie` headers returned to the browser
  - Request and correlation IDs and client details are handled by the built‑in `clientInfo` plugin. It reads trusted `X‑SSR-*` headers when allowed and otherwise uses the real request IP and user agent. Works for both short‑circuit handlers and HTTP‑forwarded API requests — whether hosted on the same server or a separate API server. For cookies — including reading and setting — see the dedicated cookies plugin doc. Cookie handling works the same for both loader types. See: [clientInfo](./built-in-plugins/clientInfo.md) and [cookies](./built-in-plugins/cookies.md)

- Prefer `APIResponseHelpers` on the server to build envelopes and auto-populate `request_id` from the request object when set
- The `pageType` you pass here must match what you register on the server via `registerDataLoaderHandler(pageType, ...)`. See `docs/ssr.md` “Page Data Handlers and Versioning”.

Tip:

- If your API base URL differs between server and client (e.g., internal vs public URLs), configure `apiBaseUrl` dynamically. Since data loaders run outside the React component tree and don't have access to hooks, access `window.__FRONTEND_APP_CONFIG__` directly at module level on the client, with a server-side fallback (e.g., environment variable) for SSR. See the [Frontend App Config Pattern](../README.md#4-frontend-app-config-pattern) for the complete pattern with examples.

Configuration (HTTP‑based Loader):

- `apiBaseUrl` (required)
- `pageDataEndpoint` (default: `/api/v1/page_data`)
- `timeoutMs` (default: 10000)
- `errorDefaults`, `connectionErrorMessages`, `loginUrl`, `returnToParam`
- `allowedRedirectOrigins`, `transformErrorMeta`, `statusCodeHandlers`

## Local Data Loader

Runs a page data handler locally without framework dataLoader HTTP request. Primarily intended for SSG, but can be used in SSR if you don't need cookie propagation.

```ts
import { createPageLoader } from 'unirend/router-utils';

// Local handler receives routing context; no Fastify request object
export const localInfoLoader = createPageLoader(
  { timeoutMs: 8000 },
  function ({ route_params, query_params }) {
    return {
      status: 'success',
      status_code: 200,
      request_id: `local_${Date.now()}`,
      type: 'page',
      data: { route_params, query_params },
      meta: { page: { title: 'Local', description: 'Local loader' } },
      error: null,
    };
  },
);
```

Important:

- Error handling setup required: When using local data loaders (especially in SSG), set up `useDataloaderEnvelopeError` in your app layout to handle envelope errors (including 404s and other error responses). This is the same pattern used in SSR. See: [Error Handling (README)](../README.md#error-handling) and the dedicated doc: [docs/error-handling.md](./error-handling.md).
- SSR preserves `status_code` from local loaders for the HTTP response
- SSR-only cookies are not available in the local path, use the Page Type Handler (HTTP/Short-Circuit) based one instead if you need cookie propagation
- `timeoutMs` is respected; on timeout a 500 Page envelope is returned with the server connection error message

Configuration (Local Loader):

- Subset of HTTP‑based loader config used by the local loader: `errorDefaults`, `isDevelopment`, `connectionErrorMessages`, `timeoutMs`, `generateFallbackRequestID`, `allowedRedirectOrigins`, `transformErrorMeta`

## Using Loaders in React Router (Applies to Both Types)

```ts
import type { RouteObject } from "react-router";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import { createPageLoader, createDefaultPageLoaderConfig } from "unirend/router-utils";

const config = createDefaultPageLoaderConfig("http://localhost:3001");

export const routes: RouteObject[] = [
  { path: "/", loader: createPageLoader(config, "home"), element: <Home /> },
  { path: "/dashboard", loader: createPageLoader(config, "dashboard"), element: <Dashboard /> },
];
```

## Data Loader Error Transformation and Additional Config

When API responses don’t follow the Page Envelope, the loader converts them using your configured strings and rules.

### `errorDefaults` presets

- Titles/descriptions/messages/codes used when building Page error envelopes
  - `notFound`
    - title: "Page Not Found"
    - description: "The page you are looking for could not be found."
    - code: "not_found"
    - message: "The requested resource was not found."
  - `internalError`
    - title: "Server Error"
    - description: "An internal server error occurred."
    - code: "internal_server_error"
    - message: "An internal server error occurred."
  - `authRequired`
    - title: "Authentication Required"
    - description: "You must be logged in to access this page."
  - `accessDenied`
    - title: "Access Denied"
    - description: "You do not have permission to access this page."
    - code: "access_denied"
    - message: "You do not have permission to access this resource."
  - `genericError`
    - title: "Error"
    - description: "An unexpected error occurred."
    - code: "unknown_error"
    - message: "An unexpected error occurred."
  - `invalidResponse`
    - title: "Invalid Response"
    - description: "The server returned an unexpected response format."
    - code: "invalid_response"
    - message: "The server returned an unexpected response format."
  - `invalidRedirect`
    - title: "Invalid Redirect"
    - description: "The server attempted an invalid redirect."
    - code: "invalid_redirect"
    - message: "Redirect target not specified in response"
  - `redirectNotFollowed`
    - title: "Redirect Not Followed"
    - description: "HTTP redirects from the API are not supported."
    - code: "api_redirect_not_followed"
    - message: "The API attempted to redirect the request, which is not supported."
  - `unsafeRedirect`
    - title: "Unsafe Redirect Blocked"
    - description: "The redirect target is not allowed for security reasons."
    - code: "unsafe_redirect"
    - message: "Unsafe redirect blocked"

### `connectionErrorMessages`

- Friendly texts for network failures/timeouts
  - `server`: "Internal server error: Unable to connect to the API service."
  - `client`: "Unable to connect to the API server. Please check your network connection and try again."

### `transformErrorMeta(params)`

- Preserve/extend metadata when converting API errors to Page errors

### `statusCodeHandlers`

- Customize handling per HTTP status
  - Match order: exact code (number or string) first — if none matches, wildcard "`*`" applies
  - Return a PageResponseEnvelope to override. Return null/undefined to fall back to defaults
  - For redirects, return a Page envelope with `status: "redirect"` and `status_code: 200`. In server/API handlers, prefer using `APIResponseHelpers.createPageRedirectResponse`.
  - The loader automatically decorates Page envelopes with SSR-only data (e.g., cookies) where applicable
- HTTP redirects from API endpoints are not followed — they become redirectNotFollowed errors with original status/location preserved
- Fallback request_id: if missing, a generated ID is used via generateFallbackRequestID (or a default generator)
  - contexts: "error" or "redirect"
  - default format: `${context}_${Date.now()}` (e.g., `error_1712868472000`)

### Additional configuration options

- `allowedRedirectOrigins`: redirect safety validation
  - undefined: validation disabled (any redirect target allowed)
  - []: only relative paths allowed; all external URLs blocked
  - ["https://myapp.com", "https://auth.myapp.com"]: allow relative paths plus listed origins
- `loginUrl` and `returnToParam`
  - `loginUrl`: default "/login"
  - `returnToParam`: default "return_to"
  - On 401 with `error.code === "authentication_required"`, redirects to login and includes the return URL when provided

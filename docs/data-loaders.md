# Data Loaders

Unirend centralizes route data fetching through a single loader system. Define loaders per route using helpers, and return standardized envelopes. See `docs/api-envelope-structure.md` for the canonical envelope specs.

<!-- toc -->

- [Quick Start](#quick-start)
  - [HTTP‑Based Loader](#httpbased-loader)
  - [Local Loader](#local-loader)
- [Which Loader Should I Use](#which-loader-should-i-use)
- [Page Type Handler (Fetch/Short-Circuit) Data Loader](#page-type-handler-fetchshort-circuit-data-loader)
- [Local Data Loader](#local-data-loader)
- [Using Loaders in React Router (Applies to Both Types)](#using-loaders-in-react-router-applies-to-both-types)
  - [Reading Loader Data](#reading-loader-data)
  - [Loading Indicators](#loading-indicators)
- [Query Parameters](#query-parameters)
- [Data Loader Error Transformation and Additional Config](#data-loader-error-transformation-and-additional-config)
  - [`errorDefaults` Presets](#errordefaults-presets)
  - [`connectionErrorMessages`](#connectionerrormessages)
  - [`transformErrorMeta(params)`](#transformerrormetaparams)
  - [`statusCodeHandlers`](#statuscodehandlers)
  - [Additional Configuration Options](#additional-configuration-options)

<!-- tocstop -->

## Quick Start

To access loader data in a component, see [Using Loaders in React Router](#using-loaders-in-react-router-applies-to-both-types).

- Create config: use `createDefaultPageDataLoaderConfig(APIBaseURL, overrides?)` for HTTP-backed loaders or `createDefaultLocalPageDataLoaderConfig(overrides?)` for local loaders, or manually provide a config object that matches the expected loader config shape
- Define loaders: `createPageDataLoader(config, pageType)` or `createPageDataLoader(localConfig, localHandler)`
- Errors/redirects: handled uniformly via envelopes, but in practice they usually surface in three ways.
  - Router error path: set React Router's `errorElement` to Unirend's `RouteErrorBoundary` helper component for router-level 404s and thrown route or loader errors.
  - Rendered page error envelope path: use `useDataLoaderEnvelopeError` in your app layout when a loader returns a page error envelope directly, or when the framework converts a loader failure into one.
  - Environment-specific final behavior: the same loader concepts can surface a little differently in SSR, SSG, and hydrated client navigation. See: [Error Handling (README)](../README.md#error-handling), [docs/error-handling.md](./error-handling.md), and [docs/ssg.md](./ssg.md#5xx-error-handling).

### HTTP‑Based Loader

```ts
import {
  createPageDataLoader,
  createDefaultPageDataLoaderConfig,
} from 'unirend/router-utils';

const config = createDefaultPageDataLoaderConfig('http://localhost:3001');
export const homeLoader = createPageDataLoader(config, 'home');
```

On the server, register a backend page data loader handler for the same `pageType`. See: [Page Data Loader Handlers and Versioning](./ssr.md#page-data-loader-handlers-and-versioning)

**Convention:** Page types should be specified WITHOUT leading slashes (e.g., `'home'` not `'/home'`). Leading slashes are allowed but will be stripped during normalization.

```ts
// On your SSR server instance
server.pageDataHandler.register('home', (request, reply, params) => {
  return params.APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: 'Hello from server', route: params.routeParams },
    pageMetadata: { title: 'Home', description: 'Home page' },
  });
});
```

### Local Loader

```ts
import {
  createDefaultLocalPageDataLoaderConfig,
  createPageDataLoader,
} from 'unirend/router-utils';

export const localInfoLoader = createPageDataLoader(
  createDefaultLocalPageDataLoaderConfig({ timeoutMS: 8000 }),
  ({ routeParams, queryParams }) => ({
    status: 'success',
    status_code: 200,
    request_id: `local_${Date.now()}`,
    type: 'page',
    data: { routeParams, queryParams },
    meta: { page: { title: 'Local', description: 'Local loader' } },
    error: null,
  }),
);
```

## Which Loader Should I Use

- HTTP‑based loader: you need cookies or request information forwarded, you have a separate API server, or you handle auth flows
- Local loader: SSG or simple data needs, and you do not need cookie propagation

## Page Type Handler (Fetch/Short-Circuit) Data Loader

Uses HTTP to call your API server page data loader handlers when they are not co‑located on the same SSR server, and short‑circuits to an internal call on SSR when the handler is registered on the same `SSRServer` instance.

```ts
import {
  createPageDataLoader,
  createDefaultPageDataLoaderConfig,
} from 'unirend/router-utils';

const config = createDefaultPageDataLoaderConfig('http://localhost:3001');

// Per-route loader (pageType mapped to handlers on the server)
export const homeLoader = createPageDataLoader(config, 'home');
```

Notes:

- Short-circuiting only happens on SSR when handlers are registered on the same `SSRServer`
  - If a handler is registered on the SSR server with the same `pageType` name as one on an external API server, the SSR server will short-circuit to its own handler and never make an HTTP request to the external API, even if `APIBaseURL` points elsewhere
  - In a multi-process or clustered deployment, each instance only short-circuits to its own registered handlers. Handlers on other instances are not visible and will fall back to HTTP
  - When using versioned handlers, short-circuit automatically selects the highest version registered. See: [Short-Circuit Versioning Behavior](./ssr.md#short-circuit-data-handlers) for details on version consistency between SSR and client-side navigation.

- HTTP‑based data loaders can forward selected request information from SSR to your API, including cookies, user agent, client IP, correlation ID, and non-empty `request.requestContext`. SSR removes untrusted headers and sets trusted ones before forwarding. See: [SSR header and cookies forwarding](./ssr.md#header-and-cookies-forwarding) and [Request Context Injection](./ssr.md#request-context-injection)
  - Cookie forwarding is controlled by `cookieForwarding` on the SSR server
    - If both `allowCookieNames` and `blockCookieNames` are unset or empty, all cookies are forwarded
    - `allowCookieNames` forwards only the listed cookie names
    - `blockCookieNames` blocks the listed names, or set to `true` to block all cookies
    - The block list takes precedence over the allow list
    - The policy applies to cookies forwarded on SSR fetches and `Set-Cookie` headers returned to the browser
  - Request tracing is handled by the built-in `clientInfo` (on by default). Forwarded SSR loader requests share a correlation ID across the SSR and API hops, while each server request keeps its own request ID. It also reads trusted forwarded client details when allowed and otherwise uses the real request IP and user agent. Works for both short‑circuit handlers and HTTP‑forwarded API requests, whether hosted on the same server or a separate API server. For cookies, including reading and setting, see the dedicated cookies plugin doc. Cookie handling works the same for both loader types. See: [Client Identity](./client-identity.md) and [cookies](./built-in-plugins/cookies.md)
  - If both SSR middleware and the API page data handler set the same `request.requestContext` key during SSR, the API value wins because it is merged back later in the request flow

- Use `params.APIResponseHelpers` in handlers to build envelopes. It auto-populates `request_id` from the request object and is always the class configured on the server, so any custom subclass set via `APIResponseHelpersClass` is automatically used. See [Helper utilities](./api-envelope-structure.md#helper-utilities)
- The `pageType` you pass here must match what you register on the server via `server.pageDataHandler.register(pageType, ...)`. See `docs/ssr.md` "Page Data Loader Handlers and Versioning".

Tip:

- If your API base URL differs between server and client (e.g., internal vs public URLs), configure `APIBaseURL` dynamically. Since data loaders run outside the React component tree and don't have access to hooks, access `window.__PUBLIC_APP_CONFIG__` directly at module level on the client, with a server-side fallback (e.g., environment variable) for SSR. See the [Public App Config Pattern](../README.md#public-app-config-pattern) for the complete pattern with examples.

Configuration (HTTP‑based Loader):

- `APIBaseURL` (required)
- `pageDataEndpoint` (default: `/api/v1/page_data`)
- `timeoutMS` (default: 10000)
- `errorDefaults`, `connectionErrorMessages`, `loginURL`, `returnToParam`
- `allowedRedirectOrigins`, `transformErrorMeta`, `statusCodeHandlers`

## Local Data Loader

Runs a page data loader locally without framework data loader handler HTTP request. Primarily intended for SSG, but can be used in SSR if you don't need cookie propagation.

```ts
import {
  createDefaultLocalPageDataLoaderConfig,
  createPageDataLoader,
} from 'unirend/router-utils';

// Local handler receives routing context, no Fastify request object
export const localInfoLoader = createPageDataLoader(
  createDefaultLocalPageDataLoaderConfig({ timeoutMS: 8000 }),
  function ({ routeParams, queryParams }) {
    return {
      status: 'success',
      status_code: 200,
      request_id: `local_${Date.now()}`,
      type: 'page',
      data: { routeParams, queryParams },
      meta: { page: { title: 'Local', description: 'Local loader' } },
      error: null,
    };
  },
);
```

Local loader notes:

- SSR preserves `status_code` from local loaders for the HTTP response
- SSR-only cookies are not available in the local path, use the Page Type Handler (HTTP/Short-Circuit) based one instead if you need cookie propagation
- `timeoutMS` is respected. On timeout, a 500 Page envelope is returned using the `connectionErrorMessages.server` message for parity with other timeout/connection-style failures
- Local loaders do not use `APIBaseURL`, but they can still return auth/redirect-style page envelopes or redirects, which is why shared settings such as `loginURL` and `returnToParam` still apply
- `createDefaultLocalPageDataLoaderConfig(overrides?)` exports the shared defaults used by both local and HTTP-backed loaders, including auth redirect settings such as `loginURL` and `returnToParam`
- `createDefaultPageDataLoaderConfig(APIBaseURL, overrides?)` extends those same defaults with the HTTP-only fields (`APIBaseURL`, `pageDataEndpoint`, `statusCodeHandlers`)
- Helper overrides are applied shallowly. If you override nested objects such as `errorDefaults` or `connectionErrorMessages`, provide the full nested object shape you want to use

Configuration (Local Loader):

- Shared config used by the local loader: `errorDefaults`, `connectionErrorMessages`, `loginURL`, `returnToParam`, `timeoutMS`, `allowedRedirectOrigins`, `transformErrorMeta`
- `generateFallbackRequestID?: (context: 'error' | 'redirect') => string`: override the default fallback `request_id` generator used when a response is missing one. Defaults to `${context}_${Date.now()}`.

## Using Loaders in React Router (Applies to Both Types)

Both loader types integrate with React Router components the same way: register the loader on a route, read the envelope in the component, and optionally show a loading indicator during client-side navigation.

### Reading Loader Data

Register the loader on the route, then read the envelope in the component with `useLoaderData()`:

```ts
// Routes.tsx
import type { RouteObject } from "react-router";
import { createPageDataLoader, createDefaultPageDataLoaderConfig } from "unirend/router-utils";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";

const config = createDefaultPageDataLoaderConfig("http://localhost:3001");

export const routes: RouteObject[] = [
  { path: "/", loader: createPageDataLoader(config, "home"), element: <Home /> },
  { path: "/dashboard", loader: createPageDataLoader(config, "dashboard"), element: <Dashboard /> },
];
```

```ts
// pages/Home.tsx
import { useLoaderData } from 'react-router';

interface HomeLoaderEnvelope {
  data: { message: string; route: unknown };
  meta: { page: { title: string; description: string } };
}

function Home() {
  const { data, meta } = useLoaderData<HomeLoaderEnvelope>();
  // data.message ✓  meta.page.title ✓
}
```

Pass the envelope interface as a type parameter to `useLoaderData<T>()`. Declare only the fields you need. The full envelope also includes `status`, `status_code`, `request_id`, `type`, and `error`.

Note: type `T` for the success shape. Error envelopes may still appear in route data (especially rendered page error envelopes), so handle them with `RouteErrorBoundary` and `useDataLoaderEnvelopeError` before assuming the success shape. See [Error Handling (README)](../README.md#error-handling).

`meta.page` comes from the `pageMetadata` returned by your handler or local loader. Pass it to `UnirendHead` for dynamic page titles. See [UnirendHead - Hardcoded vs loader-driven titles](./unirendhead.md#hardcoded-vs-loader-driven-titles).

### Loading Indicators

To show a loading indicator while a loader is fetching during client-side navigation, use React Router's `useNavigation()` hook. `navigation.state` becomes `"loading"` while any active loader is running:

```tsx
import { Outlet, useNavigation } from 'react-router';

function Layout() {
  const navigation = useNavigation();
  return (
    <>
      {navigation.state === 'loading' && <div className="loading-bar" />}
      <Outlet />
    </>
  );
}
```

This hook is client-side only and does not apply during SSR.

## Query Parameters

Query parameters are parsed with [qs](https://github.com/ljharb/qs), so nested objects and arrays work out of the box. `params.queryParams` is typed as `Record<string, unknown>`.

```
?filters[status]=active&filters[tags][]=sale&filters[tags][]=new
→ { filters: { status: 'active', tags: ['sale', 'new'] } }
```

**In a handler:**

```ts
server.pageDataHandler.register('products', (request, reply, params) => {
  const { filters } = params.queryParams as {
    filters?: { status?: string; tags?: string[] };
  };
  // params.APIResponseHelpers is available here too
});
```

Server page data loader handlers narrow with `as` because `params.queryParams` is typed as `Record<string, unknown>`. Client components use the `<T>` generic instead.

**In a component** use `useQueryParams()` for the same parsed structure:

```ts
import { useQueryParams } from 'unirend/client';

interface ProductsQueryParams {
  filters?: { status?: string; tags?: string[] };
}

function ProductsPage() {
  const { filters } = useQueryParams<ProductsQueryParams>();
}
```

**Building a query string** use `stringifyQueryParams()`:

```ts
import { stringifyQueryParams } from 'unirend/client';
import { useNavigate } from 'react-router';

function Filters() {
  const navigate = useNavigate();

  function apply() {
    navigate(
      `?${stringifyQueryParams({ filters: { status: 'active', tags: ['sale', 'new'] } })}`,
    );
  }
}
```

## Data Loader Error Transformation and Additional Config

When API responses don’t follow the Page Envelope, the loader converts them using your configured strings and rules.

### `errorDefaults` Presets

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
  - `httpError`
    - Used for a non-envelope JSON response whose HTTP status is not 404 or 500 (the status is preserved on the resulting Page error).
    - title: "Error"
    - description: "An unexpected error occurred."
    - code: "http_error"
    - message: "HTTP Error" (used as a prefix, the loader appends the status code, so the default renders as "HTTP Error: 418")

### `connectionErrorMessages`

- Friendly texts for network failures/timeouts
  - `server`: "Internal server error: Unable to connect to the API service."
  - `client`: "Unable to connect to the API server. Please check your network connection and try again."

### `transformErrorMeta(params)`

Called when the loader converts an API error into a Page error envelope. Use it to preserve or extend the `meta` object with app-specific fields.

Signature:

```ts
transformErrorMeta?: (params: {
  baseMeta: { page: { title: string; description: string } };
  statusCode: number;
  errorCode: string;
  originalMetadata?: { title?: string; description?: string; [key: string]: unknown };
}) => Record<string, unknown>
```

Example:

```ts
transformErrorMeta: ({ baseMeta, statusCode, errorCode, originalMetadata }) => ({
  ...baseMeta,
  site_info: originalMetadata?.site_info,
  analytics: { errorCode, statusCode },
}),
```

### `statusCodeHandlers`

- Customize handling per HTTP status
  - Match order: exact code (number or string) first. If none matches, wildcard `'*'` applies
  - Return a `PageResponseEnvelope` to override. Return `null`/`undefined` to fall back to defaults
  - For redirects, return a Page envelope with `status: "redirect"` and `status_code: 200`. In server/API handlers, prefer using `APIResponseHelpers.createPageRedirectResponse`.
  - The loader automatically decorates Page envelopes with SSR-only data (e.g., cookies) where applicable
- HTTP redirects from API endpoints are not followed. They become `redirectNotFollowed` errors with original status/location preserved
- If the envelope returned by a handler is missing `request_id`, the loader fills it in automatically. Override the generator with `generateFallbackRequestID: (context: 'error' | 'redirect') => string` in config. Built-in default: `${context}_${Date.now()}` (e.g., `error_1712868472000`)

```ts
statusCodeHandlers: {
  403: (statusCode, responseData, config, isDevelopment) => ({ /* return PageResponseEnvelope */ }),
  '*': (statusCode, responseData, config, isDevelopment) => null, // fall back to defaults
}
```

### Additional Configuration Options

- `allowedRedirectOrigins`: redirect safety validation
  - undefined: validation disabled (any redirect target allowed)
  - []: only relative paths allowed, all external URLs blocked
  - ["https://myapp.com", "https://auth.myapp.com"]: allow relative paths plus listed exact origins
  - Supports the same origin patterns as `lifecycleion/domain-utils`, including wildcard entries such as `"https://*.example.com"` when you need subdomain-based SaaS redirects
  - Applies to both page redirect envelope targets and for `loginURL` in authentication-required redirects
- `loginURL` and `returnToParam`
  - `loginURL`: default "/login"
  - `returnToParam`: default "return_to"
  - On 401 with `error.code === "authentication_required"`, redirects to `loginURL` and includes the return URL when provided
  - `loginURL` is framework configuration and is validated using the same redirect safety rules as other redirect targets
  - `error.details.return_to` is forwarded as application data and is not validated by Unirend, your login or auth callback handler must validate it before using it for a post-login redirect
  - This allows patterns such as SaaS apps that send users to a central login domain and then back to an app subdomain after authentication

# Unirend v0.0.1

**Unirend** is a lightweight toolkit for working with both **SSG (Static Site Generation)** and **SSR (Server-Side Rendering)** in your **Vite + React projects**. The name is a blend of “unified” and “render,” reflecting its goal to unify your build-time and runtime rendering workflows in a single, clean API.

> ⚠️ **Note:** This package is currently in active development and **not yet ready for production use.**

<!-- toc -->

- [Common Setup for SSG (Static Site Generation) or SSR (Server-Side Rendering)](#common-setup-for-ssg-static-site-generation-or-ssr-server-side-rendering)
  - [Prepare Client Frontend](#prepare-client-frontend)
  - [Prepare Vite Config and Entry Points](#prepare-vite-config-and-entry-points)
  - [Choose Your Rendering Strategy](#choose-your-rendering-strategy)
    - [1. Create Server Entry Point](#1-create-server-entry-point)
    - [2. Build Commands](#2-build-commands)
    - [3. Package.json Scripts](#3-packagejson-scripts)
    - [4. Frontend App Config Pattern](#4-frontend-app-config-pattern)
- [SSG (Static Site Generation)](#ssg-static-site-generation)
- [SSR (Server-Side Rendering)](#ssr-server-side-rendering)
- [Data Loaders](#data-loaders)
  - [Page Type Handler (Fetch/Short-Circuit) Data Loader](#page-type-handler-fetchshort-circuit-data-loader)
  - [Local Data Loader](#local-data-loader)
  - [Using Loaders in React Router (Applies to Both Types):](#using-loaders-in-react-router-applies-to-both-types)
  - [Data Loader Error Transformation and Additional Config](#data-loader-error-transformation-and-additional-config)
- [API Envelope Structure](#api-envelope-structure)
  - [Helpers and Integration](#helpers-and-integration)
- [Error Handling](#error-handling)
  - [Error Handling Strategy](#error-handling-strategy)
  - [Error Utilities and Recommended Setup](#error-utilities-and-recommended-setup)
  - [Custom Meta with PageDataHandler (Typing with Generics)](#custom-meta-with-pagedatahandler-typing-with-generics)
  - [Other Suggestions](#other-suggestions)
- [Development](#development)

<!-- tocstop -->

## Common Setup for SSG (Static Site Generation) or SSR (Server-Side Rendering)

Between both SSG (Static Site Generation) and SSR (Server-Side Rendering), there is some overlap setup.

### Prepare Client Frontend

1. Create a vite + React project, like normal. Define your routes using React Router's `RouteObject[]` format.
2. Rename your module in the `index.html` file to something like `entry-client` and update the reference.
3. In your client entry point, use `mountApp` instead of `createRoot`, passing your routes directly:

```typescript
// entry-client.tsx
import { mountApp } from "unirend/client";
import { routes } from "./routes";

// Pass routes directly - mountApp handles creating the router
mountApp("root", routes, {
  strictMode: true,
  // Optional: Add custom wrappers for additional providers (pure providers only — no HTML elements, to avoid hydration mismatches)
  // wrapProviders: ({ children }) => <ThemeProvider>{children}</ThemeProvider>
});
```

4. **Important:** Add SSR/SSG comment markers to your `index.html` template:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Your App</title>
    <!--ss-head-->
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="root"><!--ss-outlet--></div>
    <script type="module" src="/src/entry-client.tsx"></script>
  </body>
</html>
```

- `<!--ss-head-->`: Marks where server/SSG-rendered head content will be injected
- `<!--ss-outlet-->`: Marks where server/SSG-rendered body content will be injected
- These comments are preserved during processing and are required for SSR/SSG to work properly

For more details on mounting, options, and best practices (including why providers should not render HTML), see [docs/mount-app-helper.md](docs/mount-app-helper.md).

### Prepare Vite Config and Entry Points

**Vite Configuration:** Make sure your `vite.config.ts` includes `manifest: true` to ensure both builds generate manifests:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    manifest: true, // Required for unirend to locate built files
  },
});
```

**Build Structure:** Both SSG and SSR require building client and server separately:

- **Client build**: Contains static assets, client-side code, regular manifest, and SSR manifest (intended for pre-loading)
- **Server build**: Contains the server-side rendering entry point and server manifest

Note: Use different output directories for client and server (e.g., `build/client` and `build/server`). Reusing the same output directory for both can cause files to overwrite each other.

SSG note: Static Site Generation invokes your server entry at build time to render HTML files, but the generated output is served by a static file server or CDN at runtime. The build-time server is not your production runtime server.

### Choose Your Rendering Strategy

#### 1. Create Server Entry Point

Create a server entry file that exports a render function:

- **For SSG**: Create `entry-ssg.tsx`
- **For SSR**: Create `entry-server.tsx`

```typescript
import { unirendBaseRender, type IRenderRequest } from "unirend/server";
import { routes } from "./routes";

export async function render(renderRequest: IRenderRequest) {
  // Pass routes directly - unirendBaseRender handles the rest
  return await unirendBaseRender(renderRequest, routes, {
    strictMode: true,
    // Optional: Add custom wrappers for additional providers
    // wrapProviders: ({ children }) => <StateProvider>{children}</StateProvider>
  });
}
```

For more details on the base render helper and options, see [docs/base-render.md](docs/base-render.md).

#### 2. Build Commands

```bash
# Build client (contains static assets, regular manifest, and SSR manifest)
vite build --outDir build/client --base=/ --ssrManifest

# Build server entry (contains the rendering code)
# For SSG:
vite build --outDir build/server --ssr src/entry-ssg.tsx
# For SSR:
vite build --outDir build/server --ssr src/entry-server.tsx
```

#### 3. Package.json Scripts

Add these scripts to your `package.json` for both SSG and SSR workflows:

```json
{
  "scripts": {
    "dev": "vite", // Can demo in SSR mode
    "build:client": "vite build --outDir build/client --base=/ --ssrManifest",

    // For SSG:
    "build:server:ssg": "vite build --outDir build/server --ssr src/entry-ssg.tsx",
    "build:ssg": "bun run build:client && bun run build:server:ssg",
    "generate": "bun run generate.ts",
    "build-and-generate": "bun run build:ssg && bun run generate",

    // For SSR:
    "build:server:ssr": "vite build --outDir build/server --ssr src/entry-server.tsx",
    "build:ssr": "bun run build:client && bun run build:server:ssr",
    "build:prod": "bun build server.ts --outdir ./dist",
    "start": "bun run dist/server.js"
  }
}
```

#### 4. Frontend App Config Pattern

For production builds (both SSG and SSR), you can inject configuration into your frontend app via the `frontendAppConfig` option. This pattern works for any production build, but not during development with Vite dev server (`serveSSRDev`). In development, prefer `import.meta.env` (or a dev-only config shim) on the client.

In your React components, handle the dev/prod config difference:

```typescript
// In your React components
const getConfig = () => {
  // Production: Use injected config
  if (typeof window !== "undefined" && window.__APP_CONFIG__) {
    return window.__APP_CONFIG__;
  }

  // Development: Use environment variables
  return {
    apiUrl: import.meta.env.VITE_API_URL || "http://localhost:3001",
    environment: "development",
  };
};

const config = getConfig();
```

## SSG (Static Site Generation)

After completing the Common Setup, see the dedicated guide for Static Site Generation:

- [docs/ssg.md](docs/ssg.md)

## SSR (Server-Side Rendering)

After completing the Common Setup, see the dedicated guide for Server-Side Rendering:

- [docs/ssr.md](docs/ssr.md)

## Data Loaders

Unirend centralizes route data fetching through a single loader system. Define loaders per route using helpers, and return standardized envelopes. See `docs/api-envelope-structure.md`.

- Create config: `createDefaultPageLoaderConfig(apiBaseUrl)` or provide a custom config
- Define loaders: `createPageLoader(config, pageType)` or `createPageLoader(localConfig, localHandler)`
- Errors/redirects: handled uniformly via envelopes; integrate with `RouteErrorBoundary` and `useDataloaderEnvelopeError`

### Page Type Handler (Fetch/Short-Circuit) Data Loader

Uses HTTP to your API server page data handlers, and short-circuits when the handlers are registered on the same `SSRServer` instance.

```ts
import {
  createPageLoader,
  createDefaultPageLoaderConfig,
} from "unirend/router-utils";

const config = createDefaultPageLoaderConfig("http://localhost:3001");

// Per-route loader (pageType mapped to handlers on the server)
export const homeLoader = createPageLoader(config, "home");
```

Notes:

- Short-circuiting only happens on SSR when handlers are registered on the same `SSRServer`
- HTTP path supports cookie forwarding per SSR policy, use it when you need cookies to/from backend
- Prefer `APIResponseHelpers` on the server to build envelopes and auto-populate `request_id` from the request object when set
- The `pageType` you pass here must match what you register on the server via `registerDataLoaderHandler(pageType, ...)`. See `docs/ssr.md` “Page Data Handlers and Versioning”.

Tip:

- If your API base URL differs between server and client, set `apiBaseUrl` from environment/server context on SSR and from injected client config on the browser. See “4. Frontend App Config Pattern” for using `window.__APP_CONFIG__` in components, or derive it once and pass the resulting config into `createDefaultPageLoaderConfig`.

Config options (HTTP path):

- `apiBaseUrl` (required)
- `pageDataEndpoint` (default: `/api/v1/page_data`)
- `timeoutMs` (default: 10000)
- `errorDefaults`, `connectionErrorMessages`, `loginUrl`, `returnToParam`
- `allowedRedirectOrigins`, `transformErrorMeta`, `statusCodeHandlers`

### Local Data Loader

Runs a page data handler locally without framework HTTP. Primarily intended for SSG, but can be used in SSR if you don’t need cookie propagation.

```ts
import { createPageLoader } from "unirend/router-utils";

// Local handler receives routing context; no Fastify request object
export const localInfoLoader = createPageLoader(
  { timeoutMs: 8000 },
  function ({ route_params, query_params }) {
    return {
      status: "success",
      status_code: 200,
      request_id: `local_${Date.now()}`,
      type: "page",
      data: { route_params, query_params },
      meta: { page: { title: "Local", description: "Local loader" } },
      error: null,
    };
  },
);
```

Important:

- SSR preserves `status_code` from local loaders for the HTTP response
- SSR-only cookies are not available in the local path, use the Page Type Handler (HTTP/Short-Circuit) based one instead if you need cookie propagation
- `timeoutMs` is respected; on timeout a 500 Page envelope is returned with the server connection error message

Config options (local path):

- Subset of HTTP config used by the local path: `errorDefaults`, `isDevelopment`, `connectionErrorMessages`, `timeoutMs`, `generateFallbackRequestID`, `allowedRedirectOrigins`, `transformErrorMeta`

### Using Loaders in React Router (Applies to Both Types):

```ts
import { createBrowserRouter } from "react-router-dom";
import { homeLoader } from "./loaders"; // from createPageLoader(config, "home")
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import { createPageLoader, createDefaultPageLoaderConfig } from "unirend/router-utils";

const config = createDefaultPageLoaderConfig("http://localhost:3001");
const dashboardLoader = createPageLoader(config, "dashboard");

export const router = createBrowserRouter([
  { path: "/", loader: homeLoader, element: <Home /> },
  { path: "/dashboard", loader: dashboardLoader, element: <Dashboard /> },
]);
```

### Data Loader Error Transformation and Additional Config

When API responses don’t follow the Page Envelope, the loader converts them using your configured strings and rules.

- errorDefaults: titles/descriptions/messages/codes used when building Page error envelopes
  - notFound
    - title: "Page Not Found"
    - description: "The page you are looking for could not be found."
    - code: "not_found"
    - message: "The requested resource was not found."
  - internalError
    - title: "Server Error"
    - description: "An internal server error occurred."
    - code: "internal_server_error"
    - message: "An internal server error occurred."
  - authRequired
    - title: "Authentication Required"
    - description: "You must be logged in to access this page."
  - accessDenied
    - title: "Access Denied"
    - description: "You do not have permission to access this page."
    - code: "access_denied"
    - message: "You do not have permission to access this resource."
  - genericError
    - title: "Error"
    - description: "An unexpected error occurred."
    - code: "unknown_error"
    - message: "An unexpected error occurred."
  - invalidResponse
    - title: "Invalid Response"
    - description: "The server returned an unexpected response format."
    - code: "invalid_response"
    - message: "The server returned an unexpected response format."
  - invalidRedirect
    - title: "Invalid Redirect"
    - description: "The server attempted an invalid redirect."
    - code: "invalid_redirect"
    - message: "Redirect target not specified in response"
  - redirectNotFollowed
    - title: "Redirect Not Followed"
    - description: "HTTP redirects from the API are not supported."
    - code: "api_redirect_not_followed"
    - message: "The API attempted to redirect the request, which is not supported."
  - unsafeRedirect
    - title: "Unsafe Redirect Blocked"
    - description: "The redirect target is not allowed for security reasons."
    - code: "unsafe_redirect"
    - message: "Unsafe redirect blocked"

- connectionErrorMessages: friendly texts for network failures/timeouts
  - server: "Internal server error: Unable to connect to the API service."
  - client: "Unable to connect to the API server. Please check your network connection and try again."

- transformErrorMeta(params): preserve/extend metadata when converting API errors to Page errors
- statusCodeHandlers: customize handling per HTTP status
  - Match order: exact code (number or string) first; if none matches, wildcard "\*" applies
  - Return a PageResponseEnvelope to override; return null/undefined to fall back to defaults
  - For redirects, return a Page envelope with `status: "redirect"` and `status_code: 200`. In server/API handlers, prefer using `APIResponseHelpers.createPageRedirectResponse`.
  - The loader automatically decorates Page envelopes with SSR-only data (e.g., cookies) where applicable
- HTTP redirects from API endpoints are not followed; they become redirectNotFollowed errors with original status/location preserved
- Fallback request_id: if missing, a generated ID is used via generateFallbackRequestID (or a default generator)
  - contexts: "error" or "redirect"
  - default format: `${context}_${Date.now()}` (e.g., `error_1712868472000`)

Additional configuration

- allowedRedirectOrigins: redirect safety validation
  - undefined: validation disabled (any redirect target allowed)
  - []: only relative paths allowed; all external URLs blocked
  - ["https://myapp.com", "https://auth.myapp.com"]: allow relative paths plus listed origins
- loginUrl and returnToParam
  - loginUrl: default "/login"
  - returnToParam: default "return_to"
  - On 401 with error.code === "authentication_required", redirects to login; includes return URL when provided

## API Envelope Structure

See the canonical spec in [docs/api-envelope-structure.md](docs/api-envelope-structure.md) for the standardized response envelopes Unirend uses.

- **Page data loaders**: Expect and return the documented Page Response Envelope. When a backend returns an API envelope, the loader should transform it to a page envelope as needed (preserving metadata and handling redirects/authentication per the spec).
- **AJAX/fetch and form posts**: Use the API Response Envelope. This is the recommended standard across your application so client code can handle success and error states consistently.

#### Helpers and Integration

- **Server middleware/plugins**: The `SSRServer` and `serveAPI` plugin systems are designed to work with these envelopes (including default error/not-found handling). Use the middleware/plugin APIs exposed by `unirend/server` to register your routes.
- **Helper utilities**: Import helpers to construct envelopes and validate requests at your API handlers:
  - Import path: `import { APIResponseHelpers } from 'unirend/api-envelope'`
  - Key helpers: `createAPISuccessResponse`, `createAPIErrorResponse`, `createPageSuccessResponse`, `createPageErrorResponse`, `createPageRedirectResponse`, `ensureJsonBody`, and type guards like `isSuccessResponse`, `isErrorResponse`, `isRedirectResponse`, `isPageResponse`, `isValidEnvelope`.

## Error Handling

### Error Handling Strategy

See the detailed guidance in [docs/error-handling.md](docs/error-handling.md) for SSR vs client error handling using Unirend’s envelope pattern.

### Error Utilities and Recommended Setup

- **Error Boundary (thrown errors)**: In your `routes.tsx`, set `RouteErrorBoundary` as the root route’s `errorElement` to catch thrown errors during navigation and SSR.
  - Import: `import { RouteErrorBoundary } from 'unirend/router-utils'`
  - Pass your custom components: `NotFoundComponent` (404s) and `ApplicationErrorComponent` (thrown errors).
  - The `ApplicationErrorComponent` should be a standalone page (no app layout). The `NotFoundComponent` can be standalone or use your layout; either is fine.
  - For SSR parity, your server’s `get500ErrorPage` should visually match your `ApplicationErrorComponent`.
- **Inline envelope errors in layout**: In your `AppLayout`, use `useDataloaderEnvelopeError` to render inline errors (including 404s) returned by data loaders.
  - Import: `import { useDataloaderEnvelopeError } from 'unirend/router-utils'`
  - Typical mapping: render a `NotFound` component for 404s and a generic error component for other cases. See the SSR demo’s `demos/ssr/src/routes.tsx` layout pattern.
  - A dedicated not-found page loader is recommended, but inline handling in your layout works too.

### Custom Meta with PageDataHandler (Typing with Generics)

`PageDataHandler` is generic. Type your handler with your own data and meta interfaces and pass it to `registerDataLoaderHandler()`.

```ts
import type {
  PageDataHandler,
  PageDataHandlerParams,
} from "unirend/router-utils";
import type { FastifyRequest } from "fastify";
import type { BaseMeta } from "unirend/api-envelope";

interface MyMeta extends BaseMeta {
  cache: { maxAge: number };
}

interface MyData {
  title: string;
  userId?: string;
  filter?: string;
}

const homeHandler: PageDataHandler<MyData, MyMeta> = async (
  request: FastifyRequest,
  params: PageDataHandlerParams,
) => ({
  status: "success",
  status_code: 200,
  type: "page",
  data: {
    title: "Home",
    userId: params.route_params.id,
    filter: params.query_params.filter,
  },
  meta: {
    page: { title: "Home" },
    cache: { maxAge: 60 },
  },
  error: null,
});

server.registerDataLoaderHandler("home", homeHandler);

// Inline variant with explicit generics via cast
server.registerDataLoaderHandler("about", ((
  request: FastifyRequest,
  params: PageDataHandlerParams,
) => ({
  status: "success" as const,
  status_code: 200,
  type: "page" as const,
  data: { title: "About", path: params.request_path },
  meta: { page: { title: "About" } },
  error: null,
})) as PageDataHandler<MyData, MyMeta>);
```

You can also extend the response helper class to centralize custom meta defaults (e.g., from your session session like account/workspace info, etc) pulled from the request. See the helpers section: [Extending helpers and custom meta](docs/api-envelope-structure.md#extending-helpers-and-custom-meta).

### Other Suggestions

- Scroll to top on navigation
  - Add a lightweight scroll-to-top effect in a common component like your header or app layout.
  - Example: see `demos/ssg/src/components/Header.tsx`.

  ```ts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [location.pathname]);
  ```

- Scroll to top for standalone application error pages
  - When rendering a top-level application error (caught by the error boundary), include a scroll-to-top on mount so it doesn’t depend on your normal layout, as recommend.
  - Example: see `demos/ssr/src/components/CustomApplicationError.tsx`.

## Development

Unirend is built with TypeScript and uses modern JavaScript features.

```bash
# Install dependencies
bun install

# Build the project
bun run build

# Run tests
bun test
```

When preparing a new release:

1. Update the version in `package.json`
2. Run the build command, which will automatically update docs (TOCs and README version)

```bash
# Build the project (includes docs/TOC updates and README version sync)
bun run build
```

The build process uses the `update-docs` script defined in `package.json`. It updates TOCs (README, CHANGELOG, and API envelope doc) and runs `scripts/update-readme-version.ts` to synchronize the version number in the README with the one in `package.json`. Afterwards, you can publish the package to npm:

```bash
# Publish to npm
bun publish
```

Make sure to commit the new version back to GIT

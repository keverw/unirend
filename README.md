# Unirend v0.0.1

**Unirend** is a lightweight toolkit for working with both **SSG (Static Site Generation)** and **SSR (Server-Side Rendering)** in your **Vite + React projects**. The name is a blend of “unified” and “render,” reflecting its goal to unify your build-time and runtime rendering workflows in a single, clean API.

Unirend helps you ship SEO-friendly pages and accurate social sharing previews by rendering content at build-time or server-time where needed. You can take a standard Vite + React project and, by changing a few files, convert over to an SSG or SSR project with minimal configuration. The focus is on small, focused building blocks rather than a heavyweight, all-in-one framework.

> ⚠️ **Note:** This package is currently in active development and **not yet ready for production use.**

## Installation

```bash
npm install unirend
# or
bun add unirend
# or
yarn add unirend
```

**Peer Dependencies:** You'll also need to install these in your project:

```bash
npm install react react-dom react-helmet-async react-router vite
```

Unirend includes Fastify as a regular dependency for server side rendering and API server, so you don't need to install it separately.

### Runtime requirements

- Node >= 18.17.0 (uses Web Fetch APIs, `structuredClone`, and `AbortSignal.timeout`)
- Or Bun with equivalent APIs

Recommendation: We recommend Bun as the default toolchain. Bun can run TypeScript directly in development and can bundle your server to a single JavaScript file that runs under Bun or Node for production. Pure Node setups (e.g., `ts-node`, `tsc`, `esbuild`, `rollup`) or vanilla JavaScript are possible, but not the focus of this guide.

CLI note: The Unirend project generator (CLI) requires Bun for a simple, out‑of‑the‑box experience. Generated projects can still run under Node when bundled (e.g., `bun build --target node`), while using Bun only for the development and build tooling. As Node tooling continues to improve, we may add first-class Node CLI support in the future.

Repo auto‑init: The CLI sets up a repository structure that supports multiple projects in one workspace. You can initialize it explicitly with `init-repo`, but if it’s missing when you run `create`, Unirend will set it up automatically with a sensible default.

<!-- toc -->

- [Installation](#installation)
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
- [Demos](#demos)
  - [SSG demo: Build and Serve](#ssg-demo-build-and-serve)
  - [SSR demo: Dev and Prod](#ssr-demo-dev-and-prod)
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
  - [Other Suggestions](#other-suggestions)
- [Development](#development)
- [Build Info Utilities](#build-info-utilities)

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

Note on React Router Import:

- React Router is a peer dependency and required.
- Unirend targets React Router v7+ where browser APIs are provided by `react-router`. Use `react-router` consistently for imports (e.g., `Link`, `NavLink`, `useLocation`). Do not mix with `react-router-dom` in the same codebase.
- If your scaffold or AI template used `react-router-dom`, search/replace those imports to `react-router` as part of preparation.
- Do not create your own browser router in the client. Export `routes: RouteObject[]` and let `mountApp` handle `createBrowserRouter(routes)` and hydration.

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

Add these scripts to your `package.json` for both SSG and SSR workflows. We recommend Bun for simplicity, you can also run the Bun‑built bundle with Node (example shown below).

```json
{
  "scripts": {
    "dev": "vite", // SPA-only dev mode (no SSR)
    "build:client": "vite build --outDir build/client --base=/ --ssrManifest",

    // For SSG:
    "build:server:ssg": "vite build --outDir build/server --ssr src/entry-ssg.tsx",
    "build:ssg": "bun run build:client && bun run build:server:ssg",
    "generate": "bun run generate.ts",
    "build-and-generate": "bun run build:ssg && bun run generate",

    // For SSR:
    "build:server:ssr": "vite build --outDir build/server --ssr src/entry-server.tsx",
    "build:ssr": "bun run build:client && bun run build:server:ssr",
    "serve-dev": "bun run serve.ts dev", // SSR dev mode with HMR
    "serve-prod": "bun run serve.ts prod", // SSR prod mode (requires build:ssr first)
    "build-and-serve-prod": "bun run build:ssr && bun run serve-prod",

    // For SSR Production Build (Bun):
    "build:prod": "bun build serve.ts --outdir ./dist",
    "start": "bun dist/serve.js prod"

    // Optional: Run SSR Production Build under Node runtime using a Bun-built bundle (use if dealing with Bun compatibility issues):
    // "build:prod": "bun build serve.ts --outdir ./dist --target=node",
    // "start": "node dist/serve.js prod"
  }
}
```

Tip: When you plan to run the Bun-built bundle under Node, include the `--target node` flag in `bun build` so the output targets Node’s runtime.

Note: If you prefer a pure-Node toolchain without Bun, explore compiling or bundling your server with tools like `tsc`, `esbuild`, `rollup`, or `tsup`, then run with `node`. These alternatives are not covered in depth here to keep the setup simple and easy out of the box.

#### 4. Frontend App Config Pattern

You can inject configuration into your frontend app via the `frontendAppConfig` option. This works in both SSG and SSR modes (both dev and prod) when using `generateSSG`, `serveSSRDev`, or `serveSSRProd`.

**In React Components** - use the `useFrontendAppConfig()` hook:

```typescript
import { useFrontendAppConfig } from 'unirend/client';

function MyComponent() {
  const config = useFrontendAppConfig();

  // Access config values with fallbacks
  const apiUrl = (config?.apiUrl as string) || "http://localhost:3001";
  const environment = (config?.environment as string) || "development";

  return <div>API: {apiUrl}</div>;
}
```

**In Non-Component Code** (loaders, utilities, module-level) - access `window.__FRONTEND_APP_CONFIG__` directly:

```typescript
// Non-component code runs outside React component tree, so use direct window access. For example in a data loader.
// On client: Use public API URL from injected config
// On server (SSR): Use internal endpoints (same network/datacenter) when not using the Fetch/Short-Circuit functionality
const apiBaseUrl =
  typeof window !== "undefined"
    ? (window.__FRONTEND_APP_CONFIG__?.apiUrl as string) ||
      "http://localhost:3001"
    : process.env.INTERNAL_API_URL || "http://api-internal:3001"; // Internal endpoint or service URL

const config = createDefaultPageLoaderConfig(apiBaseUrl);
export const homeLoader = createPageLoader(config, "home");
```

**Note:** If you run Vite in SPA-only dev mode directly (not through the SSR dev/prod servers), the injection won't happen. Both the hook and `window.__FRONTEND_APP_CONFIG__` will be `undefined`, so use fallback values as shown above.

For more details on the Unirend Context system, see [docs/unirend-context.md](docs/unirend-context.md).

## SSG (Static Site Generation)

After completing the Common Setup, see the dedicated guide for Static Site Generation:

- [docs/ssg.md](docs/ssg.md)

## SSR (Server-Side Rendering)

After completing the Common Setup, see the dedicated guide for Server-Side Rendering:

- [docs/ssr.md](docs/ssr.md)

SSR servers support a plugin system for extending functionality, data loader endpoints for page data handling, and can host your API endpoints for actions outside of SSR dataloader handlers. You can create a standalone API server (useful when you want to separate API hosting from SSR rendering while sharing the same plugin and handler code conventions as if you were hosting within the same SSR server).

## Demos

Runable, self-contained examples live under `demos/` and are wired to root-level scripts (no need to cd):

- `demos/ssg` — SSG example (build, generate, serve)
- `demos/ssr` — SSR example (dev and production)

Runtime note: Demo scripts use Bun to run TypeScript directly (e.g., `bun run ...`). You can use Node-based alternatives as well (e.g., transpile with `tsc`, use `ts-node`, or write equivalent vanilla JavaScript). Unirend’s SSG and server (SSR/API) APIs run on Node and Bun. Vite provides HMR in development and bundles the React application frontend for production.

### SSG demo: Build and Serve

Files live in `demos/ssg`.

From the repo root (using package scripts):

```bash
# Build client and server for SSG
bun run ssg-build

# Generate static HTML files using the built server entry
bun run ssg-generate

# Or do both in one step
bun run ssg-build-and-generate

# Serve the generated site (simple static file server)
bun run ssg-serve
```

Notes:

- `generate.ts` calls `generateSSG` with a mix of SSG and SPA pages and can inject `frontendAppConfig`.
- `serve.ts` serves the contents of `build/client` with basic caching and a 404 page.
- See [docs/ssg.md](docs/ssg.md) for concepts behind the workflow.

### SSR demo: Dev and Prod

Files live in `demos/ssr`.

From the repo root (using package scripts):

```bash
# Development (Vite HMR + source entry)
bun run ssr-serve-dev

# Production: build client and server, then run prod server
bun run ssr-build
bun run ssr-serve-prod
```

What this shows:

- Registering SSR plugins (routes, hooks, decorators).
- API/SSR coexistence: API routes under `/api/*` are handled first. Unmatched ones return JSON envelopes. Other GETs fall through to SSR.
- Optional custom 500 page example (commented in `demos/ssr/serve.ts`).

## Data Loaders

Unirend centralizes route data fetching through a single loader system. Define loaders per route using helpers, and return standardized envelopes. See `docs/api-envelope-structure.md`.

- Create config: `createDefaultPageLoaderConfig(apiBaseUrl)` or provide a custom config
- Define loaders: `createPageLoader(config, pageType)` or `createPageLoader(localConfig, localHandler)`
- Errors/redirects: handled uniformly via envelopes. Integrate with `RouteErrorBoundary` and `useDataloaderEnvelopeError`

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

- If your API base URL differs between server and client (e.g., internal vs public URLs), you'll need to configure `apiBaseUrl` dynamically. Since data loaders run outside the React component tree and don't have access to hooks, you'll need to access `window.__FRONTEND_APP_CONFIG__` directly at module level on the client, with a server-side fallback (e.g., environment variable) for SSR. See "4. Frontend App Config Pattern" for the complete pattern with examples.

Config options (HTTP path):

- `apiBaseUrl` (required)
- `pageDataEndpoint` (default: `/api/v1/page_data`)
- `timeoutMs` (default: 10000)
- `errorDefaults`, `connectionErrorMessages`, `loginUrl`, `returnToParam`
- `allowedRedirectOrigins`, `transformErrorMeta`, `statusCodeHandlers`

### Local Data Loader

Runs a page data handler locally without framework dataLoader HTTP request. Primarily intended for SSG, but can be used in SSR if you don't need cookie propagation.

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

- **Error handling setup required**: When using local data loaders (especially in SSG), you must set up `useDataloaderEnvelopeError` in your app layout to handle envelope errors (including 404s and other error responses). This is the same pattern used in SSR. See the "Error Utilities and Recommended Setup" section below.
- SSR preserves `status_code` from local loaders for the HTTP response
- SSR-only cookies are not available in the local path, use the Page Type Handler (HTTP/Short-Circuit) based one instead if you need cookie propagation
- `timeoutMs` is respected; on timeout a 500 Page envelope is returned with the server connection error message

Config options (local path):

- Subset of HTTP config used by the local path: `errorDefaults`, `isDevelopment`, `connectionErrorMessages`, `timeoutMs`, `generateFallbackRequestID`, `allowedRedirectOrigins`, `transformErrorMeta`

### Using Loaders in React Router (Applies to Both Types):

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

## Build Info Utilities

See [docs/build-info.md](docs/build-info.md) for generating and loading build metadata (version, git hash/branch, timestamp).

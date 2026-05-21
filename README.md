# Unirend v0.0.23

[![npm version](https://badge.fury.io/js/unirend.svg)](https://badge.fury.io/js/unirend)

**Unirend** is a lightweight **SSR (Server-Side Rendering)**, **SSG (Static Site Generation)**, and server toolkit for **Vite + React Router projects**. The name is a blend of “unified” and “render,” reflecting its goal to unify your build-time and runtime rendering workflows in a single, clean API.

Unirend helps you ship SEO-friendly pages and accurate social sharing previews by rendering content at build-time or server-time where needed. You can take a standard Vite + React Router project and, by changing a few files, convert it into an SSG or SSR project with minimal configuration.

The focus is on small, focused building blocks rather than a heavyweight, all-in-one framework. Unirend keeps routing in React Router, builds on Vite, and gives you explicit server utilities for API routes, page data loaders, plugins, uploads, redirects, static serving, and production runtime behavior when your app needs them.

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

`lifecycleion` is a utility library providing lifecycle management, structured logging, retry logic, and other foundational utilities. It is used internally by Unirend, in generated project templates, and is useful in your own server and application code as well.

```bash
npm install lifecycleion react react-dom react-router
npm install --save-dev vite
# or
bun add lifecycleion react react-dom react-router
bun add -d vite
# or
yarn add lifecycleion react react-dom react-router
yarn add --dev vite
```

You'll also need `@vitejs/plugin-react` as a dev dependency for your Vite config. Unirend does not depend on it directly, but every project needs it to configure React support in Vite:

```bash
npm install --save-dev @vitejs/plugin-react
# or
bun add -d @vitejs/plugin-react
# or
yarn add --dev @vitejs/plugin-react
```

Unirend includes Fastify as a regular dependency powering its built-in servers (SSR, API, redirect, and static file serving), so you don't need to install it separately.

### Runtime requirements

- Node >= 25 (uses newer web APIs such as `fetch`, `structuredClone`, and `AbortSignal.timeout`, covers the Node 20.19.0 minimum required by Vite 8 for `require(esm)` support without a flag, and also meets the Node 25 requirement of the `lifecycleion` peer dependency, which relies on browser-style global error event APIs such as `ErrorEvent` and `reportError`)
- Or Bun with equivalent APIs

Recommendation: We recommend Bun as the default toolchain, specifically for its bundler, running helper scripts during development, and as a unit test runner. For production runtime stability, we recommend running the bundle under Node. Pass `--target node` when building with Bun (see the optional scripts in the SSR section below). Pure Node tooling setups (e.g., `ts-node`, `tsc`, `esbuild`, `rollup`) or vanilla JavaScript are possible, but not the focus of this guide, the CLI, or the starter template utility functions. This split is a pattern others have landed on as well. The Cloudflare Wrangler team, for example, [recommends](https://github.com/cloudflare/workers-sdk/pull/11172#issuecomment-3517504973) using Bun as the package manager but running under Node.

Note: Always include `--external vite` when bundling your server entry with `bun build`. Vite lazily imports `esbuild` at runtime, which Bun's bundler cannot statically resolve. Keeping Vite external avoids a build error.

Note: Running the SSR dev server under Bun may stall graceful shutdown. The Vite HMR WebSocket server can fail to close cleanly under Bun, compared to Node. The same style of issue is described in [docs/websockets.md](docs/websockets.md), along with the Node-based workaround covered in [docs/ssr.md](docs/ssr.md).

CLI note: The Unirend project generator (CLI) requires Bun for a simple, out‑of‑the‑box experience. Generated projects use Bun for development and build tooling, and target Node by default at bundle time (`bun build --target node --external vite`). As Node tooling continues to improve, we may add first-class Node CLI support in the future.

Repo auto‑init: The CLI sets up a repository structure that supports multiple projects in one workspace. You can initialize it explicitly with `init-repo`, but if it’s missing when you run `create`, Unirend will set it up automatically with a sensible default.

<!-- toc -->

- [Installation](#installation)
  - [Runtime requirements](#runtime-requirements)
- [Common Setup for SSG (Static Site Generation) or SSR (Server-Side Rendering)](#common-setup-for-ssg-static-site-generation-or-ssr-server-side-rendering)
  - [Prepare Client Frontend](#prepare-client-frontend)
  - [Prepare Vite Config and Entry Points](#prepare-vite-config-and-entry-points)
  - [Choose Your Rendering Strategy](#choose-your-rendering-strategy)
    - [1. Create Server Entry Point](#1-create-server-entry-point)
    - [2. Build Commands](#2-build-commands)
    - [3. Package.json Scripts](#3-packagejson-scripts)
- [Public App Config Pattern](#public-app-config-pattern)
- [SSG (Static Site Generation)](#ssg-static-site-generation)
- [SSR (Server-Side Rendering)](#ssr-server-side-rendering)
- [Demos](#demos)
  - [SSG demo: Build and Serve](#ssg-demo-build-and-serve)
  - [SSR demo: Dev and Prod](#ssr-demo-dev-and-prod)
  - [API server demo](#api-server-demo)
  - [Static content demo](#static-content-demo)
  - [WebSocket demo](#websocket-demo)
- [Data Loaders](#data-loaders)
- [API Envelope Structure](#api-envelope-structure)
  - [Helpers and Integration](#helpers-and-integration)
- [Error Handling](#error-handling)
- [File Upload Helpers](#file-upload-helpers)
- [UX Suggestions](#ux-suggestions)
- [Development](#development)
  - [Parking Lot](#parking-lot)
- [Build Info Utilities](#build-info-utilities)
- [Utilities](#utilities)

<!-- tocstop -->

## Common Setup for SSG (Static Site Generation) or SSR (Server-Side Rendering)

Between both SSG (Static Site Generation) and SSR (Server-Side Rendering), there is some overlapping setup.

### Prepare Client Frontend

1. Create a Vite + React project, like normal. Define your routes using React Router's `RouteObject[]` format.
2. Rename your module in the `index.html` file to something like `EntryClient` and update the reference.
3. In your client entry point, use `mountApp` instead of `createRoot`, passing your routes directly:

```typescript
// EntryClient.tsx
import { mountApp } from 'unirend/client';
import { routes } from './Routes';

// Pass routes directly - mountApp handles creating the router
mountApp('root', routes, {
  strictMode: true,
  // Optional: wrap the entire app above the router with root-level providers
  // rootProviders: ({ children }) => <ThemeProvider>{children}</ThemeProvider>
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
    <script type="module" src="/src/EntryClient.tsx"></script>
  </body>
</html>
```

- `<!--ss-head-->`: Marks where server/SSG-rendered head content will be injected
- `<!--ss-outlet-->`: Marks where server/SSG-rendered body content will be injected
- These comments are preserved during processing and are required for SSR/SSG to work properly

**Managing `<title>`, `<meta>`, and `<link>` tags:** Use `UnirendHead` from `unirend/client`, Unirend's built-in document head manager. It works identically in SSR, SSG, and SPA mode and injects into the `<!--ss-head-->` slot on the server.

```tsx
import { UnirendHead } from 'unirend/client';

function HomePage() {
  return (
    <>
      <UnirendHead>
        <title>Home - My App</title>
        <meta name="description" content="Welcome to my app" />
        <meta property="og:title" content="Home - My App" />
        <link rel="canonical" href="https://example.com/" />
      </UnirendHead>
      <main>...</main>
    </>
  );
}
```

See [docs/unirendhead.md](docs/unirendhead.md) for full API details.

For more details on mounting, options, and the `rootProviders` option, see [docs/mount-app-helper.md](docs/mount-app-helper.md).

Note on React Router Import:

- React Router is a peer dependency and required.
- Unirend targets React Router v7+ where browser APIs are provided by `react-router`. Use `react-router` consistently for imports (e.g., `Link`, `NavLink`, `useLocation`). Do not mix with `react-router-dom` in the same codebase.
- If your scaffold or AI template used `react-router-dom`, search/replace those imports to `react-router` as part of preparation.
- Do not create your own browser router in the client. Export `routes: RouteObject[]` and let `mountApp` handle `createBrowserRouter(routes)` and hydration.

### Prepare Vite Config and Entry Points

**Vite Configuration:** In your `vite.config.ts`, wrap your Vite config with `withUnirendViteConfig()` so dev/build flows use one React/React Router instance:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { withUnirendViteConfig } from 'unirend/config-vite';

export default defineConfig(
  withUnirendViteConfig({
    plugins: [react()],
    build: {
      manifest: true, // Required for unirend to locate built files
    },
  }),
);
```

`withUnirendViteConfig()` merges with your existing Vite config, so settings like `resolve.alias` and `ssr.noExternal` are preserved. It configures Vite to avoid externalizing `unirend` during SSR and dedupes `react`, `react-dom`, and `react-router` so SSR/SSG rendering uses the same React/React Router package instances. This prevents split React Router contexts. Without it, router hooks like `useLocation()` can fail because they read a different context than the provider created.

**Build Structure:** Both SSG and SSR require building client and server separately:

- **Client build**: Contains static assets, client-side code, regular manifest, and SSR manifest (intended for pre-loading)
- **Server build**: Contains the server-side rendering entry point and server manifest

Note: Use different output directories for client and server (e.g., `build/client` and `build/server`). Reusing the same output directory for both can cause files to overwrite each other.

SSG note: Static Site Generation invokes your server entry at build time to render HTML files, but the generated output is served by a static file server or CDN at runtime. The build-time server is not your production runtime server.

### Choose Your Rendering Strategy

#### 1. Create Server Entry Point

Create a server entry file that exports a render function:

- **For SSG**: Create `EntrySSG.tsx`
- **For SSR**: Create `EntrySSR.tsx`

```typescript
import { unirendBaseRender } from 'unirend/server';
import type { RenderRequest } from 'unirend/server';
import { routes } from './Routes';

export async function render(renderRequest: RenderRequest) {
  // Pass routes directly - unirendBaseRender handles the rest
  return await unirendBaseRender(renderRequest, routes, {
    strictMode: true,
    // Optional: Add custom wrappers for additional providers
    // rootProviders: ({ children }) => <StateProvider>{children}</StateProvider>
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
vite build --outDir build/server --ssr src/EntrySSG.tsx
# For SSR:
vite build --outDir build/server --ssr src/EntrySSR.tsx
```

#### 3. Package.json Scripts

Add these scripts to your `package.json` for both SSG and SSR workflows. The examples below are illustrative and your actual scripts may vary. If you use the CLI to generate your project, the scripts are wired up automatically.

```json
{
  "scripts": {
    "spa-dev": "vite", // SPA-only dev mode: no SSR server, frontend calls to server-registered page data/API handlers will 404 because they do not exist on Vite's HMR dev server
    "build:client": "vite build --outDir build/client --base=/ --ssrManifest",

    // For SSG:
    "ssg:build:server": "vite build --outDir build/server --ssr src/EntrySSG.tsx",
    "ssg:build": "bun run build:client && bun run ssg:build:server",
    "generate:dev": "bun run generate.ts dev", // Generate with dev mode enabled
    "generate:prod": "bun run generate.ts prod", // Generate for production
    "ssg:build-and-generate:prod": "bun run ssg:build && bun run generate:prod",
    "serve:dev": "bun run serve.ts dev", // Static server with dev runtime (verbose errors)
    "serve:prod": "bun run serve.ts prod", // Static server with prod runtime
    "ssg:build-generate-serve:prod": "bun run ssg:build-and-generate:prod && bun run serve:prod",

    // For SSR:
    "ssr:build:server": "vite build --outDir build/server --ssr src/EntrySSR.tsx",
    "ssr:build": "bun run build:client && bun run ssr:build:server",
    "ssr:serve:hmr": "bun run serve-dev.ts dev", // SSR HMR mode, serving source through Vite
    "ssr:serve:prod": "bun run serve-built.ts prod", // SSR prod mode with built assets (requires ssr:build first)
    "ssr:build-and-serve:prod": "bun run ssr:build && bun run ssr:serve:prod",

    // For SSR Production Build (Node runtime — recommended):
    "build:prod": "bun build serve-built.ts --outdir build/serve --target=node --external vite",
    "start": "node build/serve/serve-built.js prod"

    // Alternative: Run directly under Bun runtime:
    // "build:prod": "bun build serve-built.ts --outdir build/serve --external vite",
    // "start": "bun build/serve/serve-built.js prod"
  }
}
```

Tip: Always include `--target node` and `--external vite` when building for the Node runtime. To run under Bun instead, omit `--target node` and replace `node` with `bun` in the start script.

Note: If you prefer a pure-Node toolchain without Bun, explore compiling or bundling your server with tools like `tsc`, `esbuild`, `rollup`, or `tsup`, or use vanilla JavaScript, then run with `node`. These alternatives are not covered in depth here to keep the setup simple and easy out of the box.

## Public App Config Pattern

You can provide safe-to-share app configuration via the `publicAppConfig` option. In SSR and SSG, Unirend injects this config into the frontend so components can read it with `usePublicAppConfig()`. This works in both SSG and SSR modes (both dev and prod) when using `generateSSG`, `serveSSRDev`, or `serveSSRProd`.

**In React Components** - use the `usePublicAppConfig()` hook:

```typescript
import { usePublicAppConfig } from 'unirend/client';

function MyComponent() {
  const config = usePublicAppConfig();

  // Access config values with fallbacks
  const api_endpoint = (config?.api_endpoint as string) || "http://localhost:3001";
  const environment = (config?.environment as string) || "development";

  return <div>API: {api_endpoint}</div>;
}
```

All four context hooks, `usePublicAppConfig()`, `useRequestContext()`, `useCDNBaseURL()`, and `useDomainInfo()`, work on both server and client. See [Unirend Context](docs/unirend-context.md) for full hook documentation.

**In Non-Component Code** (loaders, utilities, module-level) - access `window.__PUBLIC_APP_CONFIG__`, `window.__FRONTEND_REQUEST_CONTEXT__`, `window.__CDN_BASE_URL__`, and `window.__DOMAIN_INFO__` directly:

```typescript
// Non-component code runs outside React component tree, so use direct window access. For example in a data loader.
// Note: these globals only exist in the browser — `window` is not available during SSR, so always
// guard with `typeof window !== 'undefined'` and provide a server-side fallback.

// Client: reads api_endpoint from publicAppConfig when set (e.g. when the API runs on
// a separate server). Falls back to window.location.origin for same-server setups —
// no config needed. Set api_endpoint in publicAppConfig to override.
//
// Server: uses INTERNAL_API_ENDPOINT when set — useful when running SSR and API in
// separate server pools where the internal hostname differs from the public URL.
// Falls back to a localhost URL as a best-effort default for the co-located case.
// In co-located setups the handler short-circuits on the same instance anyway, so
// the exact fallback URL rarely matters. Update the port to match your API server,
// or set INTERNAL_API_ENDPOINT to an explicit URL for separate-server deployments.
const APIBaseURL =
  typeof window !== 'undefined'
    ? (window.__PUBLIC_APP_CONFIG__?.api_endpoint as string) ||
      window.location.origin
    : (process.env.INTERNAL_API_ENDPOINT ?? 'http://localhost:3000');

const config = createDefaultPageDataLoaderConfig(APIBaseURL);
export const homeLoader = createPageDataLoader(config, 'home');

// Similarly, request context values (e.g. set by SSR middleware or SSG page definitions)
// are available on the client via window.__FRONTEND_REQUEST_CONTEXT__ after hydration:
const theme =
  typeof window !== 'undefined'
    ? (window.__FRONTEND_REQUEST_CONTEXT__?.theme as string | undefined)
    : undefined;

// The CDN base URL is always injected by the framework (empty string when not configured):
const cdnBase = typeof window !== 'undefined' ? window.__CDN_BASE_URL__ : '';

// Domain info (hostname + rootDomain, useful for subdomain-spanning cookies) — SSR/SSG with hostname configured:
const domainInfo =
  typeof window !== 'undefined' ? window.__DOMAIN_INFO__ : null;
```

**Note:** If you run Vite in SPA-only dev mode directly (not through the SSR dev/prod servers), the injection won't happen. All four globals will be `undefined`, so use fallback values as shown above.

**Note on timing:** All four globals are injected into `<head>` by the server, before any of your app scripts (whether in `<head>` or `<body>`), so they are available everywhere, including inline `<head>` scripts, body scripts, and all module code that runs after page load.

For more details on the Unirend Context system, see [docs/unirend-context.md](docs/unirend-context.md).

## SSG (Static Site Generation)

After completing the Common Setup, see the dedicated guide for Static Site Generation:

- [docs/ssg.md](docs/ssg.md)

## SSR (Server-Side Rendering)

After completing the Common Setup, see the dedicated guide for Server-Side Rendering:

- [docs/ssr.md](docs/ssr.md)

SSR servers support a [plugin system](docs/server-plugins.md) for extending functionality, data loader endpoints for page data handling, and can host your API endpoints for actions outside of SSR data loader handlers. You can also create a standalone API server covered in [docs/ssr.md](docs/ssr.md), which is useful when you want to separate API hosting from SSR rendering while sharing the same plugin and handler code conventions, such as API endpoints and data loaders.

## Demos

Runnable, self-contained examples live under `demos/` and are wired to root-level scripts (no need to cd):

- `demos/ssg`: SSG example (build, generate, serve)
- `demos/ssr`: SSR example (dev and production)
- `demos/api-server-demo.ts`: API-only server example
- `demos/api-static-content-demo.ts`: API server with static file serving and split HTML/JSON handlers
- `demos/ws-server-demo.ts`: WebSocket server example (SSR + API servers)

Runtime note: Demo scripts use Bun to run TypeScript directly (e.g., `bun run ...`). You can use Node-based alternatives as well (e.g., transpile with `tsc`, use `ts-node`, or write equivalent vanilla JavaScript). Unirend’s SSG and server (SSR/API) APIs run on Node and Bun. Vite provides HMR in development and bundles the React application frontend for production.

### SSG demo: Build and Serve

Files live in `demos/ssg`.

From the repo root (using package scripts):

```bash
# Build client and server for SSG.
bun run ssg:build

# Generate static HTML files using the built server entry.
bun run ssg:generate:prod

# Or do both in one step.
bun run ssg:build-and-generate:prod

# Serve the generated site with production runtime behavior.
bun run ssg:serve:prod
```

Notes:

- `generate.ts` calls `generateSSG` with a mix of SSG and SPA pages, injects `publicAppConfig`, and passes `requestContext` (used by the ThemeProvider) per page.
- `src/components/AppLayout.tsx` owns the shared route chrome and route-change scroll-to-top behavior. Individual pages keep only their own page content and metadata.
- `demos/ssg/serve.ts` serves the contents of `build/client` using `StaticWebServer` wrapped in a `LifecycleManager` + `BaseComponent` for graceful shutdown and signal handling.
- See [docs/ssg.md](docs/ssg.md) for concepts behind the workflow.

### SSR demo: Dev and Prod

Files live in `demos/ssr`.

From the repo root (using package scripts):

```bash
# Development SSR with Vite HMR + source entry.
bun run ssr:serve:hmr

# Production: build client and server, then run the built server.
bun run ssr:build
bun run ssr:serve:prod

# Or do both in one step.
bun run ssr:build-and-serve:prod
```

What this shows:

- Registering SSR plugins (cookies, theme, API routes, hooks).
- Server theme plugin seeding `requestContext.themePreference` from a cookie for flash-free dark/light mode.
- API/SSR coexistence: API routes under `/api/*` are handled first. Unmatched ones return JSON envelopes. Other GETs fall through to SSR.
- Custom standalone 500 page handling via `get500ErrorPage` in `server/ssr-component.ts`.
- `LifecycleManager` + `BaseComponent` for graceful shutdown with configurable timeouts (`serve-dev.ts` / `serve-built.ts` → `server/start.ts` → `server/ssr-component.ts`).
- `src/components/AppLayout.tsx` owns the shared route chrome and route-change scroll-to-top behavior.

### API server demo

From the repo root:

```bash
bun run api-demo
```

### Static content demo

From the repo root:

```bash
bun run api-static-demo
```

### WebSocket demo

From the repo root:

```bash
bun run ws-demo
```

## Data Loaders

Unirend centralizes route data fetching through a single loader system. See the dedicated [Data Loaders guide](docs/data-loaders.md).

What it covers:

- Page type handler (HTTP/short‑circuit) loader
- Local data loader (SSG‑friendly)
- Using loaders in React Router
- Error transformation/config, redirects, and auth handling
- Configuration (timeouts, connection messages, status mapping, allowed redirect origins, login handling)

## API Envelope Structure

See the canonical spec in [docs/api-envelope-structure.md](docs/api-envelope-structure.md) for the standardized response envelopes Unirend uses.

- **Page data loaders**: Expect and return the documented Page Response Envelope. When a backend returns an API envelope, the loader should transform it to a page envelope as needed (preserving metadata and handling redirects/authentication per the spec).
- **AJAX/fetch and form posts**: Use the API Response Envelope. This is the recommended standard across your application so client code can handle success and error states consistently.

### Helpers and Integration

The following helpers and integrations make it easy to work with these envelopes throughout your application.

- **Server middleware/plugins**: The `SSRServer` and `serveAPI` plugin systems are designed to work with these envelopes (including default error/not-found handling). Use the middleware/plugin APIs exposed by `unirend/server` to register your routes.
- **Helper utilities**: Import helpers to construct envelopes and validate requests at your API handlers:
  - Import path: `import { APIResponseHelpers } from 'unirend/api-envelope'`
  - Key helpers: `createAPISuccessResponse`, `createAPIErrorResponse`, `createPageSuccessResponse`, `createPageErrorResponse`, `createPageRedirectResponse`, `ensureJSONBody`, `ensureURLEncodedBody`, `ensureMultipartBody`, and type guards like `isSuccessResponse`, `isErrorResponse`, `isRedirectResponse`, `isPageResponse`, `isValidEnvelope`.

## Error Handling

See setup recommendations and how the framework handles SSR vs client errors in the dedicated guide: [docs/error-handling.md](docs/error-handling.md).

## File Upload Helpers

Unirend provides first-class support for file uploads with streaming validation, cleanup handlers, and proper error responses.

**Key features:**

- Streaming validation with mid-stream abort if limits exceeded
- Automatic cleanup handlers for partial uploads
- Fail-fast behavior for batch uploads
- Works seamlessly with the envelope pattern

**Quick Start:**

```typescript
import { serveSSRDev, processFileUpload } from 'unirend/server';
import { APIResponseHelpers } from 'unirend/api-envelope';

const server = serveSSRDev(paths, {
  fileUploads: { enabled: true },
});

server.api.post('upload/avatar', async (request, reply, params) => {
  const result = await processFileUpload({
    request,
    reply,
    maxSizePerFile: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png'],
    processor: async (fileStream, metadata, context) => {
      // Stream to storage and return metadata
      const url = await saveToStorage(fileStream);
      return { url, filename: metadata.filename };
    },
  });

  if (!result.success) {
    return result.errorEnvelope;
  }

  return APIResponseHelpers.createAPISuccessResponse({
    request,
    data: { file: result.files[0].data },
    statusCode: 200,
  });
});
```

**Full Documentation:** [docs/file-upload-helpers.md](docs/file-upload-helpers.md)

Includes comprehensive examples for S3 uploads, security best practices, temporary upload folders, auth integration, and more.

## UX Suggestions

- Scroll to top on navigation
  - Add a lightweight scroll-to-top effect in a common component like your header or app layout.
  - Example: see `demos/ssg/components/Header.tsx`.

  ```ts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.pathname]);
  ```

- Scroll to top for standalone application error pages
  - When rendering a top-level application error (caught by the error boundary), include a scroll-to-top on mount so it doesn’t depend on your normal layout, as recommended.
  - Example: see `demos/ssr/components/error-pages/ApplicationError.tsx`.

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

After publishing, commit the generated file changes back to Git. The build updates `src/version.ts`, the README title, and the TOCs.

### Parking Lot

- Possible future PWA helpers: installability, service worker registration, app shell/static asset caching, optional offline page data handlers, and standard offline page envelopes. Notes are collected in [docs/pwa.md](docs/pwa.md).

## Build Info Utilities

See [docs/build-info.md](docs/build-info.md) for generating and loading build metadata (version, Git hash/branch, timestamp).

## Utilities

Unirend exposes public utilities for static file caching, HTML escaping, and runtime requirement checks. Some are used internally by unirend, while others are intended for use in your own server or build scripts:

- **StaticContentCache**: A caching layer for static file serving with ETag support and LRU caching
- **escapeHTML / escapeHTMLAttr**: Safe HTML escaping for server-side HTML generation (e.g. custom error pages, `dangerouslySetInnerHTML`)
- **getRuntimeSupportInfo / isSupportedRuntime / assertSupportedRuntime**: Check for `Node >= 25` unless the current runtime is Bun

```typescript
import {
  StaticContentCache,
  escapeHTML,
  escapeHTMLAttr,
  getRuntimeSupportInfo,
} from 'unirend/utils';
```

See [docs/utilities.md](docs/utilities.md) for full API documentation.

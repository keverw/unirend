# Unirend v0.0.4

[![npm version](https://badge.fury.io/js/unirend.svg)](https://badge.fury.io/js/unirend)

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

Recommendation: We recommend Bun as the default toolchain. Bun can run TypeScript directly in development and can bundle your server to a single JavaScript file for production. The unirend library itself avoids Bun-specific APIs, so your bundled server can run under either Bun or Node. Pure Node tooling setups (e.g., `ts-node`, `tsc`, `esbuild`, `rollup`) or vanilla JavaScript are possible, but not the focus of this guide, the CLI, or the starter template utility functions.

CLI note: The Unirend project generator (CLI) requires Bun for a simple, out‑of‑the‑box experience. Generated projects can still run under Node when bundled (e.g., `bun build --target node`), while using Bun only for the development and build tooling. As Node tooling continues to improve, we may add first-class Node CLI support in the future.

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
    - [4. Frontend App Config Pattern](#4-frontend-app-config-pattern)
- [SSG (Static Site Generation)](#ssg-static-site-generation)
- [SSR (Server-Side Rendering)](#ssr-server-side-rendering)
- [Demos](#demos)
  - [SSG demo: Build and Serve](#ssg-demo-build-and-serve)
  - [SSR demo: Dev and Prod](#ssr-demo-dev-and-prod)
- [Data Loaders](#data-loaders)
- [API Envelope Structure](#api-envelope-structure)
  - [Helpers and Integration](#helpers-and-integration)
- [Error Handling](#error-handling)
- [File Upload Helpers](#file-upload-helpers)
- [UX Suggestions](#ux-suggestions)
- [Development](#development)
- [Build Info Utilities](#build-info-utilities)
- [Utilities](#utilities)

<!-- tocstop -->

## Common Setup for SSG (Static Site Generation) or SSR (Server-Side Rendering)

Between both SSG (Static Site Generation) and SSR (Server-Side Rendering), there is some overlap setup.

### Prepare Client Frontend

1. Create a vite + React project, like normal. Define your routes using React Router's `RouteObject[]` format.
2. Rename your module in the `index.html` file to something like `entry-client` and update the reference.
3. In your client entry point, use `mountApp` instead of `createRoot`, passing your routes directly:

```typescript
// entry-client.tsx
import { mountApp } from 'unirend/client';
import { routes } from './routes';

// Pass routes directly - mountApp handles creating the router
mountApp('root', routes, {
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
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
import { unirendBaseRender } from 'unirend/server';
import type { RenderRequest } from 'unirend/server';
import { routes } from './routes';

export async function render(renderRequest: RenderRequest) {
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

    // Optional: Run SSR Production Build under Node runtime using a Bun-built bundle:
    // (use if dealing with Bun compatibility issues)
    // "build:prod": "bun build serve.ts --outdir ./dist --target=node",
    // "start": "node dist/serve.js prod"
  }
}
```

Tip: When you plan to run the Bun-built bundle under Node, include the `--target node` flag in `bun build` so the output targets Node’s runtime.

Note: If you prefer a pure-Node toolchain without Bun, explore compiling or bundling your server with tools like `tsc`, `esbuild`, `rollup`, or `tsup`, or use vanilla JavaScript, then run with `node`. These alternatives are not covered in depth here to keep the setup simple and easy out of the box.

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
const APIBaseURL =
  typeof window !== 'undefined'
    ? (window.__FRONTEND_APP_CONFIG__?.apiUrl as string) ||
      'http://localhost:3001'
    : process.env.INTERNAL_API_URL || 'http://api-internal:3001'; // Internal endpoint or service URL

const config = createDefaultPageDataLoaderConfig(APIBaseURL);
export const homeLoader = createPageDataLoader(config, 'home');
```

**Note:** If you run Vite in SPA-only dev mode directly (not through the SSR dev/prod servers), the injection won't happen. Both the hook and `window.__FRONTEND_APP_CONFIG__` will be `undefined`, so use fallback values as shown above.

For more details on the Unirend Context system, see [docs/unirend-context.md](docs/unirend-context.md).

## SSG (Static Site Generation)

After completing the Common Setup, see the dedicated guide for Static Site Generation:

- [docs/ssg.md](docs/ssg.md)

## SSR (Server-Side Rendering)

After completing the Common Setup, see the dedicated guide for Server-Side Rendering:

- [docs/ssr.md](docs/ssr.md)

SSR servers support a plugin system for extending functionality, data loader endpoints for page data handling, and can host your API endpoints for actions outside of SSR data loader handlers. You can create a standalone API server (useful when you want to separate API hosting from SSR rendering while sharing the same plugin and handler code conventions as if you were hosting within the same SSR server).

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

#### Helpers and Integration

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
  - Example: see `demos/ssg/src/components/Header.tsx`.

  ```ts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
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

## Utilities

Unirend exposes utilities for domain/origin validation, static file caching, and related functionality. While used internally by unirend, they can also be used standalone in any project:

- **Domain utilities**: Functions for domain/origin validation, normalization, and wildcard matching (useful for CORS, security checks, URL handling)
- **LRUCache**: A TTL-aware LRU cache with configurable size limits and automatic expiration
- **StaticContentCache**: A caching layer for static file serving with ETag support and LRU caching

```typescript
import {
  normalizeOrigin,
  matchesWildcardDomain,
  StaticContentCache,
} from 'unirend/utils';
```

See [docs/utilities.md](docs/utilities.md) for full API documentation.

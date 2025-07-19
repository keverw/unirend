# Unirend v0.0.1

**Unirend** is a lightweight toolkit for working with both **SSG (Static Site Generation)** and **SSR (Server-Side Rendering)** in your **Vite + React projects**. The name is a blend of “unified” and “render,” reflecting its goal to unify your build-time and runtime rendering workflows in a single, clean API.

> ⚠️ **Note:** This package is currently in active development and **not yet ready for production use.**

<!-- toc -->

- [Mount App](#mount-app)
- [Development](#development)

<!-- tocstop -->

## Todo

Plan to add the following functions:

- [ ] renderSSRDev - plan is to work with Vite's HMR for development
- [ ] renderSSRProd - serve up a production build
- [ ] renderSSGPages - For SSG, loops over predefined pages and writes them out:

## Mount App

The `mountApp` function is the primary, opinionated way to mount React Router-based client applications in unirend. It intelligently detects whether to hydrate pre-rendered content or render fresh, and automatically applies all necessary wrappers.

**How it works:** If the container has existing child elements (SSR/SSG content), it hydrates. If empty (SPA/development), it renders fresh.

**Opinionated & Type-Safe:** Pass your routes directly - unirend handles creating the router, RouterProvider, HelmetProvider, StrictMode, and any custom providers you need.

```typescript
import { mountApp } from 'unirend';
import { type RouteObject } from 'react-router';
import { routes } from './routes';

// Pass your routes directly - mountApp creates the router internally
const result = mountApp('root', routes);

if (result === 'hydrated') {
  console.log('✅ Hydrated SSR/SSG content');
} else if (result === 'rendered') {
  console.log('✅ Rendered as SPA');
} else {
  console.error('❌ Container not found');
}

// With custom providers
const customProviders = ({ children }) => (
  <MyThemeProvider>
    <MyStateProvider>
      {children}
    </MyStateProvider>
  </MyThemeProvider>
);

const result = mountApp('root', routes, { wrapProviders: customProviders });

// Disable StrictMode if needed
const result = mountApp('root', routes, { strictMode: false });
```

**API:**

- `mountApp(containerID: string, routes: RouteObject[], options?: MountAppOptions): MountAppResult`
- Returns: `"hydrated"` | `"rendered"` | `"not_found"`

**Options:**

- `strictMode?: boolean` - Whether to wrap with React.StrictMode (default: `true`)

- `wrapProviders?: React.ComponentType<{ children: React.ReactNode }>` - Custom wrapper component for additional providers (should be pure context providers only - no HTML rendering to avoid hydration issues)

**Benefits:** Opinionated simplicity, type-safe routes, automatic router creation, automatic provider management, seamless SSR/SSG/SPA support.

**Important:** Keep `wrapProviders` components pure (context providers only). Avoid rendering HTML elements like `<div>` or applying styles directly in these providers, as this can cause hydration mismatches between server and client. Instead, use route layouts or separate components for HTML structure and styling.

## Base Render

The `unirendBaseRender` function is a helper function that handles React Router/Data Loaders, Helmet, renderToString, error parsing.

When setting up your `entry-ssg.tsx` or `entry-server.tsx`, your use `unirendBaseRender` to handle the rendering of your app. This will return back structured data that will be used to generate the HTML for your page, or serve up as the response for SSR.

This supports React Router Data Loaders, including some special properties used to help with SSR that follows a specific envelope pattern.
## Guide

### Prepare Client Frontend

1. Create a vite + React project, like normal. Make sure you are using the static router feature for React router.
2. Then rename your module in the `index.html` file to something like "entry-client" and update the reference. This is also where you'd want to switch the `createRoot` to use `mountApp` instead, where you pass in the router instance created by `createBrowserRouter`.

### Prepare for SSG

**Static Site Generation (SSG)** allows you to pre-render your React pages at build time, creating static HTML files that can be served by any web server.

#### 1. Build with SSR Manifest

**Important:** You must build your project with the `--ssrManifest` flag to generate the manifest file that unirend uses to locate your server entry:

## Guide

### Prepare Client Frontend

1. Create a vite + React project, like normal. Define your routes using React Router's `RouteObject[]` format.
2. Rename your module in the `index.html` file to something like `entry-client` and update the reference.
3. In your client entry point, use `mountApp` instead of `createRoot`, passing your routes directly:

```typescript
// entry-client.tsx
import { mountApp } from "unirend";
import { routes } from "./routes";

// Pass routes directly - mountApp handles creating the router
mountApp('root', routes, {
  strictMode: true,
  // Optional: Add custom wrappers for additional providers
  // wrapApp: (node) => <ThemeProvider>{node}</ThemeProvider>
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

## Choose Your Rendering Strategy

### 1. Create Server Entry Point

Create a server entry file that exports a render function:

- **For SSG**: Create `entry-ssg.tsx`
- **For SSR**: Create `entry-server.tsx`

```typescript
import { unirendBaseRender, type IRenderRequest } from "unirend";
import { routes } from "./routes";

export async function render(renderRequest: IRenderRequest) {
  // Pass routes directly - unirendBaseRender handles the rest
  return await unirendBaseRender(renderRequest, routes, {
    strictMode: true,
    // Optional: Add custom wrappers for additional providers
    // wrapApp: (node) => <StateProvider>{node}</StateProvider>
  });
}
```

### 2. Build Commands

```bash
# Build client (contains static assets, regular manifest, and SSR manifest)
vite build --outDir build/client --base=/ --ssrManifest

# Build server entry (contains the rendering code)
# For SSG:
vite build --outDir build/server --ssr src/entry-ssg.tsx
# For SSR:
vite build --outDir build/server --ssr src/entry-server.tsx
```

## Implementation

### For SSG (Static Site Generation)

**Static Site Generation (SSG)** allows you to pre-render your React pages at build time, creating static HTML files that can be served by any web server.

#### Create Generation Script

Create a script to generate your static pages using the `generateSSG` function:

> 💡 **Tip:** For a more comprehensive example with detailed error handling and reporting, see [`demos/ssg/generate.ts`](./demos/ssg/generate.ts) in this repository.

```typescript
import { generateSSG } from "unirend";
import path from "path";

async function main() {
  const buildDir = path.resolve(__dirname, "dist");

  const pages = [
    { path: "/", filename: "index.html" },
    { path: "/about", filename: "about.html" },
    { path: "/contact", filename: "contact.html" },
  ];

  const options = {
    serverEntry: "entry-server", // Default, customize if needed
    frontendAppConfig: {
      apiUrl: "https://api.example.com",
    },
  };

  const result = await generateSSG(buildDir, pages, options);

  if (result.fatalError) {
    console.error("SSG generation failed:", result.fatalError.message);
    process.exit(1);
  }

  console.log(
    `Generated ${result.pagesReport.successCount} pages successfully!`,
  );
}

main().catch(console.error);
```

#### Template Caching

Unirend automatically caches the processed HTML template in `.unirend-ssg.json` within your client build directory. This serves two important purposes:

1. **Performance**: Avoids re-processing the template on subsequent generation runs
2. **Template preservation**: Keeps a copy of the original `index.html` in case you overwrite it with generated pages

- **First run**: Processes the HTML template (formatting and preparation) and creates the cache file
- **Subsequent runs**: Uses the cached processed template, preserving your source `index.html`

**Important:** Vite's default behavior is to clean the output directory on each build (`build.emptyOutDir: true`). This means:

- The cache file is cleared on each `vite build` command
- Template processing happens fresh after each build
- This ensures the cache stays in sync with your latest build

If you've disabled `emptyOutDir` in your Vite config, the cache will persist between builds. While this improves performance, make sure to rebuild when you change your HTML template or app configuration.


Add the generation script to your package.json:

```json
{
  "scripts": {
    "build": "vite build --ssrManifest",
    "generate": "bun run generate.ts",
    "build-and-generate": "npm run build && npm run generate"
  }
}
```

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
2. Run the build command, which will automatically update the README version

```bash
# Build the project (includes README version update)
bun run build
```

The build process uses the `update-readme` script defined in package.json, which runs `scripts/update-readme-version.ts`. This script synchronizes the version number in the README with the one in package.json. Afterwards, you can publish the package to npm:

```bash
# Publish to npm
bun publish
```

Make sure to commit the new version back to GIT

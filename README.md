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

**Opinionated & Router-First:** Pass your router directly - unirend handles RouterProvider, HelmetProvider, StrictMode, and any custom providers you need.

```typescript
import { mountApp } from 'unirend';
import { createBrowserRouter } from 'react-router';
import { routes } from './routes';

// Create your router
const router = createBrowserRouter(routes);

// Mount the app - automatically wraps with RouterProvider, HelmetProvider, and StrictMode
const result = mountApp('root', router);

if (result === 'hydrated') {
  console.log('✅ Hydrated SSR/SSG content');
} else if (result === 'rendered') {
  console.log('✅ Rendered as SPA');
} else {
  console.error('❌ Container not found');
}

// With custom providers
const customWrapper = (node) => (
  <MyThemeProvider>
    <MyStateProvider>
      {node}
    </MyStateProvider>
  </MyThemeProvider>
);

const result = mountApp('root', router, { wrapApp: customWrapper });

// Disable StrictMode if needed
const result = mountApp('root', router, { strictMode: false });
```

**API:**

- `mountApp(containerID: string, router: Router, options?: MountAppOptions): MountAppResult`
- Returns: `"hydrated"` | `"rendered"` | `"not_found"`

**Options:**

- `strictMode?: boolean` - Whether to wrap with React.StrictMode (default: `true`)

- `wrapApp?: (node: React.ReactNode) => React.ReactElement` - Custom wrapper function for additional providers

**Benefits:** Opinionated simplicity, router-first design, automatic provider management, seamless SSR/SSG/SPA support.

## Base Render

The `unirendBaseRender` function is a helper function that handles React Router/Data Loaders, Helmet, renderToString, error parsing.

When setting up your `entry-ssg.tsx` or `entry-server.tsx`, your use `unirendBaseRender` to handle the rendering of your app. This will return back structured data that will be used to generate the HTML for your page, or serve up as the response for SSR.

This supports React Router Data Loaders, including some special properties used to help with SSR that follows a specific envelope pattern.
## Guide

### Prepare Client Frontend

1. Create a vite + React project, like normal. Make sure you are using the static router feature for React router.
2. Then rename your module in the `index.html` file to something like "entry-client" and update the reference. This is also where you'd want to switch the `createRoot` to use `mountApp` instead, where you pass in the router instance created by `createBrowserRouter`.

### Prepare for SSG

1. Create a entry-ssg.tsx file in the src directory.
2. Create a render function that is exported from entry-ssg.tsx.

### Prepare for SSR

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

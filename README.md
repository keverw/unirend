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

The `mountApp` function intelligently mounts your React app by automatically detecting whether to hydrate pre-rendered content or render fresh. It works seamlessly across SSR, SSG, and SPA contexts.

**How it works:** If the container has existing child elements (SSR/SSG content), it hydrates. If empty (SPA/development), it renders fresh.

```typescript
import { mountApp } from 'unirend';
import App from './App';

// Basic usage - works for both SSR and SPA
const result = mountApp('root', <App />);

// Handle the result
if (result === 'hydrated') {
  console.log('✅ Hydrated SSR/SSG content');
} else if (result === 'rendered') {
  console.log('✅ Rendered as SPA');
} else {
  console.error('❌ Container not found');
}

// With providers
import { BrowserRouter } from 'react-router-dom';

const AppWithRouter = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

mountApp('root', AppWithRouter);
```

**API:**

- `mountApp(containerId: string, appElement: React.ReactElement): MountAppResult`
- Returns: `"hydrated"` | `"rendered"` | `"not_found"`

**Use cases:** Development with Vite, production SPA builds, SSR/SSG hydration, or hybrid apps.

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

# Mount App

<!-- toc -->

- [Overview](#overview)
- [How it works](#how-it-works)
- [Usage](#usage)
- [API](#api)
- [Options](#options)
- [Benefits](#benefits)
- [Important guidelines](#important-guidelines)

<!-- tocstop -->

### Overview

The `mountApp` function is the primary, opinionated way to mount React Router-based client applications in unirend. It intelligently detects whether to hydrate pre-rendered content or render fresh, and automatically applies all necessary wrappers.

### How it works

If the container has existing child elements (SSR/SSG content), it hydrates. If empty (SPA/development), it renders fresh.

### Usage

Opinionated & type-safe: pass your routes directly — unirend handles creating the router, RouterProvider, HelmetProvider, StrictMode, and any custom providers you need.

```typescript
import { mountApp } from 'unirend/client';
import type { RouteObject } from 'react-router';
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

### API

- `mountApp(containerID: string, routes: RouteObject[], options?: MountAppOptions): MountAppResult`
- Returns: `"hydrated"` | `"rendered"` | `"not_found"`

### Options

- `strictMode?: boolean` - Whether to wrap with React.StrictMode (default: `true`)

- `wrapProviders?: React.ComponentType<{ children: React.ReactNode }>` - Custom wrapper component for additional providers (should be pure context providers only - no HTML rendering to avoid hydration issues)

### Benefits

Opinionated simplicity, type-safe routes, automatic router creation, automatic provider management, seamless SSR/SSG/SPA support.

### Important guidelines

Keep `wrapProviders` components pure (context providers only). Avoid rendering HTML elements like `<div>` or applying styles directly in these providers, as this can cause hydration mismatches between server and client. Instead, use route layouts or separate components for HTML structure and styling.

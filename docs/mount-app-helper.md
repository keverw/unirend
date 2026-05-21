# Mount App

<!-- toc -->

- [Overview](#overview)
- [How it works](#how-it-works)
- [Usage](#usage)
- [API](#api)
- [Options](#options)
- [rootProviders behavior](#rootproviders-behavior)

<!-- tocstop -->

### Overview

The `mountApp` function is the primary, opinionated way to mount React Router-based client applications in unirend. It intelligently detects whether to hydrate pre-rendered content or render fresh, and automatically applies all necessary wrappers.

### How it works

If the container has existing child elements (SSR/SSG content), it hydrates. If empty (SPA/development), it renders fresh.

### Usage

Opinionated & type-safe: pass your routes directly, unirend handles creating the router, RouterProvider, UnirendProvider, UnirendHeadProvider, StrictMode, and any custom providers you need.

```typescript
import { mountApp } from 'unirend/client';
import type { RouteObject } from 'react-router';
import { routes } from './Routes';

// Pass your routes directly - mountApp creates the router internally
const result = mountApp('root', routes);

if (result === 'hydrated') {
  console.log('✅ Hydrated SSR/SSG content');
} else if (result === 'rendered') {
  console.log('✅ Rendered as SPA');
} else {
  console.error('❌ Container not found');
}

// With custom root providers
const result = mountApp('root', routes, {
  rootProviders: ({ children }) => (
    <ThemeProvider>
      <MyStateProvider>
        {children}
      </MyStateProvider>
    </ThemeProvider>
  ),
});

// Disable StrictMode if needed
const result = mountApp('root', routes, { strictMode: false });
```

### API

- `mountApp(containerID: string, routes: RouteObject[], options?: MountAppOptions): MountAppResult`
- Returns: `"hydrated"` | `"rendered"` | `"not_found"`

### Options

- `strictMode?: boolean` - Whether to wrap with React.StrictMode (default: `true`)

- `rootProviders?: React.ComponentType<{ children: React.ReactNode }>` - Optional wrapper component that sits above the router. Useful for providing global context (themes, state stores, etc.) that should be available across both normal routes and the router's `errorElement`. It can render HTML too. A theme wrapper, a global modal/dialog portal, or a toast notification container are all reasonable uses. Because it sits outside the router, errors thrown inside it bypass React Router's `errorElement` and fall through to React's own error handling, so keep `rootProviders` stable and unlikely to throw. You can wrap with your own React error boundary if needed.

### rootProviders behavior

`rootProviders` wraps the entire router, so its context and any rendered output is available inside both your normal route tree and React Router's `errorElement`. This is useful for things like a theme that error pages also need.

For primary page layout and structure, a route layout component (like `AppLayout`) is usually the better fit.

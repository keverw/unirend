# Unirend Context

The Unirend Context system provides React hooks to access render mode, development status, and server request information throughout your application.

<!-- toc -->

- [Overview](#overview)
- [Available Hooks](#available-hooks)
  - [`useUnirendContext()`](#useunirendcontext)
  - [`useIsSSR()`](#useisssr)
  - [`useIsSSG()`](#useisssg)
  - [`useIsClient()`](#useisclient)
  - [`useRenderMode()`](#userendermode)
  - [`useIsDevelopment()`](#useisdevelopment)
  - [`useIsServer()`](#useisserver)
  - [`useFetchRequest()`](#usefetchrequest)
- [How It Works](#how-it-works)
  - [Server-Side (SSR)](#server-side-ssr)
  - [Build-Time (SSG)](#build-time-ssg)
  - [Client-Side](#client-side)
- [Use Cases](#use-cases)
  - [1. Render Mode-Specific Behavior](#1-render-mode-specific-behavior)
  - [2. Server-Side Request Information](#2-server-side-request-information)
  - [3. Environment-Specific Features](#3-environment-specific-features)
- [TypeScript Types](#typescript-types)
- [Best Practices](#best-practices)
- [Related Documentation](#related-documentation)

<!-- tocstop -->

## Overview

The context is automatically provided by Unirend during server-side rendering, static generation, and client-side rendering, giving your components access to:

- **Render Mode**: Whether the app is SSR (Server-Side Rendering), SSG (Static Site Generation), or Client (SPA or after hydration)
- **Development Status**: Whether running in development or production mode
- **Fetch Request**: Access to the Fetch API Request object (available during SSR and SSG)

## Available Hooks

All hooks are exported from `unirend/client`:

```typescript
import {
  useUnirendContext,
  useIsSSR,
  useIsSSG,
  useIsClient,
  useRenderMode,
  useIsDevelopment,
  useIsServer,
  useFetchRequest,
} from "unirend/client";
```

### `useUnirendContext()`

Returns the complete Unirend context object.

```tsx
function MyComponent() {
  const { renderMode, isDevelopment, fetchRequest } = useUnirendContext();

  return (
    <div>
      <p>Render Mode: {renderMode}</p>
      <p>Development: {isDevelopment ? "Yes" : "No"}</p>
      {fetchRequest && <p>Request URL: {fetchRequest.url}</p>}
    </div>
  );
}
```

**Returns:**

```typescript
{
  renderMode: "ssr" | "ssg" | "client";
  isDevelopment: boolean;
  fetchRequest?: Request;
}
```

### `useIsSSR()`

Returns `true` if rendering mode is SSR, `false` otherwise.

```tsx
function MyComponent() {
  const isSSR = useIsSSR();

  return <div>{isSSR ? "Server-Side Rendered" : "Not SSR"}</div>;
}
```

### `useIsSSG()`

Returns `true` if rendering mode is SSG, `false` otherwise.

```tsx
function MyComponent() {
  const isSSG = useIsSSG();

  return <div>{isSSG ? "Static Generated" : "Not SSG"}</div>;
}
```

### `useIsClient()`

Returns `true` if rendering mode is client (SPA or after SSG build/SSR page hydration occurs), `false` otherwise.

```tsx
function MyComponent() {
  const isClient = useIsClient();

  return <div>{isClient ? "Client Mode" : "Server Context Available"}</div>;
}
```

### `useRenderMode()`

Returns the current render mode as a string.

```tsx
function MyComponent() {
  const renderMode = useRenderMode();

  return <div>Render Mode: {renderMode}</div>;
}
```

**Returns:** `"ssr" | "ssg" | "client"`

### `useIsDevelopment()`

Returns `true` if in development mode, `false` if in production.

```tsx
function MyComponent() {
  const isDev = useIsDevelopment();

  return (
    <div>
      {isDev && <div className="debug-info">Development Mode - Debug Info</div>}
    </div>
  );
}
```

### `useIsServer()`

Returns `true` if code is running on the SSR server (has `SSRHelper` attached to `fetchRequest`), `false` if on client or during SSG.

```tsx
function MyComponent() {
  const isServer = useIsServer();

  return (
    <div>{isServer ? "Running on SSR server" : "Running on client or SSG"}</div>
  );
}
```

### `useFetchRequest()`

Returns the Fetch API Request object during SSR and SSG generation, `undefined` on client after hydration.

```tsx
function MyComponent() {
  const request = useFetchRequest();

  if (!request) {
    return <div>Client-side rendering</div>;
  }

  return (
    <div>
      <p>Request URL: {request.url}</p>
      <p>Request Method: {request.method}</p>
      <p>User Agent: {request.headers.get("user-agent")}</p>
    </div>
  );
}
```

**Returns:** `Request | undefined`

## How It Works

### Server-Side (SSR)

The SSRServer automatically populates the context when rendering:

```typescript
{
  renderMode: "ssr",
  isDevelopment: true, // or false based on server mode
  fetchRequest: request, // Fetch API Request object with SSRHelper attached
}
```

### Build-Time (SSG)

The SSG generator populates the context during build:

```typescript
{
  renderMode: "ssg",
  isDevelopment: false, // SSG is always production
  fetchRequest: request, // Fetch API Request object (no SSRHelper)
}
```

### Client-Side

When mounting on the client with `mountApp()`, defaults are provided:

```typescript
{
  renderMode: "client", // Default for pure SPA (SSR/SSG override this during hydration)
  isDevelopment: Boolean(import.meta.env.DEV), // Vite sets this: true in dev, false in production build
  fetchRequest: undefined, // No server request on client
}
```

## Use Cases

### 1. Analytics and Logging

```tsx
// Your analytics client instance
const analytics = {
  track: (event: string, data: Record<string, unknown>) => {
    // Send to your analytics service
    console.log("Analytics:", event, data);
  },
};

function trackPageView(path: string, renderMode: string) {
  // Send analytics with render mode context
  analytics.track("page_view", {
    path,
    renderMode, // "ssr", "ssg", or "client"
    timestamp: Date.now(),
  });
}

function MyPage() {
  const renderMode = useRenderMode();
  const request = useFetchRequest();

  useEffect(() => {
    // Track client-side navigation
    trackPageView(window.location.pathname, renderMode);
  }, [renderMode]);

  // Log server-side renders
  if (request) {
    const url = new URL(request.url);
    console.log(`[${renderMode.toUpperCase()}] Rendering: ${url.pathname}`);
  }

  return <div>My Page</div>;
}
```

### 2. Environment-Specific Features

```tsx
function AnalyticsScript() {
  const isDev = useIsDevelopment();

  // Don't load analytics in development
  if (isDev) return null;

  return <script src="https://analytics.example.com/script.js" />;
}

function DebugPanel() {
  const isDev = useIsDevelopment();
  const { renderMode, fetchRequest } = useUnirendContext();

  if (!isDev) return null;

  return (
    <div className="debug-panel">
      <h3>Debug Info</h3>
      <p>Render Mode: {renderMode}</p>
      <p>Has Request: {fetchRequest ? "Yes" : "No"}</p>
    </div>
  );
}
```

## TypeScript Types

All types are exported from `unirend/client`:

```typescript
import type { UnirendContextValue, UnirendRenderMode } from "unirend/client";

// UnirendRenderMode = "ssr" | "ssg" | "client"

// UnirendContextValue = {
//   renderMode: UnirendRenderMode;
//   isDevelopment: boolean;
//   fetchRequest?: Request;
// }
```

## Best Practices

1. **Use specific hooks when possible**: Prefer `useIsSSR()` over `useRenderMode()` when you only need a boolean check
2. **Check for server context**: Always check if `fetchRequest` exists before using it
3. **Avoid overusing**: Don't check render mode for every component - only when behavior needs to differ
4. **Type safety**: TypeScript will help you use the Request object correctly
5. **SSR vs SSG**: Use `useIsServer()` to detect true SSR (with SSRHelper) vs SSG build-time rendering
6. **Avoid hydration mismatches**: Don't directly render context values that differ between server and client (like `renderMode`, `fetchRequest`, `isDevelopment`) - use them for logic/behavior control, not for displayed content
7. **Debugging only**: Context values are primarily useful for debugging and controlling behavior - avoid displaying them directly in your UI

## Related Documentation

- [Mount App Helper](./mount-app-helper.md) - Client-side mounting
- [SSR Documentation](./ssr.md) - Server-side rendering setup
- [SSG Documentation](./ssg.md) - Static site generation

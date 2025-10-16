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
  - [`useFrontendAppConfig()`](#usefrontendappconfig)
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
- **Frontend App Config**: Immutable configuration object passed from the server (available on both server and client)

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
  useFrontendAppConfig,
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
  frontendAppConfig?: Record<string, unknown>;
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

### `useFrontendAppConfig()`

Returns the frontend application configuration object. This is a frozen (immutable) copy of the config passed to the server, available on both server and client.

```tsx
function MyComponent() {
  const config = useFrontendAppConfig();

  if (!config) {
    return <div>No config available</div>;
  }

  return (
    <div>
      <p>API URL: {config.apiUrl as string}</p>
      <p>App Name: {config.appName as string}</p>
      <p>Feature Flags: {JSON.stringify(config.features)}</p>
    </div>
  );
}
```

**Returns:** `Record<string, unknown> | undefined`

**Note:** The config is cloned and frozen on each request to ensure immutability. Unlike other context values like `renderMode` or `fetchRequest`, the `frontendAppConfig` is **safe to display directly in your UI** because it remains identical between server rendering and client hydration. The server injects it into the HTML, and the client reads it back from the same source, preventing hydration mismatches.

**Dynamic Updates:** Since the config is cloned on each request, you can store the config object in a variable, pass it to `frontendAppConfig`, and update it dynamically between requests. For example, you could update a `year` field used to display the current year in the footer, and the changes will only apply to subsequent requests while keeping each request's config isolated and immutable.

## How It Works

### Server-Side (SSR)

The SSRServer automatically populates the context when rendering:

```typescript
{
  renderMode: "ssr",
  isDevelopment: true, // or false based on server mode
  fetchRequest: request, // Fetch API Request object with SSRHelper attached
  frontendAppConfig: Object.freeze(structuredClone(config)), // Cloned and frozen config
}
```

### Build-Time (SSG)

The SSG generator populates the context during build:

```typescript
{
  renderMode: "ssg",
  isDevelopment: false, // SSG is always production
  fetchRequest: request, // Fetch API Request object (no SSRHelper)
  frontendAppConfig: Object.freeze(structuredClone(config)), // Cloned and frozen config
}
```

### Client-Side

When mounting on the client with `mountApp()`, the context is populated from injected globals:

```typescript
{
  renderMode: "client", // Default for pure SPA (SSR/SSG override this during hydration)
  isDevelopment: Boolean(import.meta.env.DEV), // Vite sets this: true in dev, false in production build
  fetchRequest: undefined, // No server request on client
  frontendAppConfig: window.__FRONTEND_APP_CONFIG__, // Read from injected global (SSR/SSG) or undefined (pure SPA)
}
```

**Note:** The `frontendAppConfig` is automatically read from `window.__FRONTEND_APP_CONFIG__` which is injected into the HTML by the server during SSR/SSG. In pure SPA mode (no server rendering), this will be `undefined`.

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

### 2. Accessing Frontend Configuration

```tsx
function APIClient() {
  const config = useFrontendAppConfig();

  // Access public API configuration
  const apiUrl = (config?.apiUrl as string) || "http://localhost:3000";
  const cdnUrl = config?.cdnUrl as string;
  const appVersion = config?.version as string;

  return (
    <div>
      <p>API Endpoint: {apiUrl}</p>
      <p>CDN: {cdnUrl || "Not configured"}</p>
      <p>Version: {appVersion}</p>
    </div>
  );
}

function FeatureFlags() {
  const config = useFrontendAppConfig();
  const features = (config?.features as Record<string, boolean>) || {};

  return (
    <div>
      {features.newUI && <NewUIComponent />}
      {features.betaFeatures && <BetaFeaturesPanel />}
    </div>
  );
}
```

### 3. Environment-Specific Features

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
//   frontendAppConfig?: Record<string, unknown>;
// }
```

## Best Practices

1. **Use specific hooks when possible**: Prefer `useIsSSR()` over `useRenderMode()` when you only need a boolean check
2. **Check for server context**: Always check if `fetchRequest` exists before using it
3. **Avoid overusing**: Don't check render mode for every component - only when behavior needs to differ
4. **Type safety**: TypeScript will help you use the Request object correctly
5. **SSR vs SSG**: Use `useIsServer()` to detect true SSR (with SSRHelper) vs SSG build-time rendering
6. **Avoid hydration mismatches**: Don't directly render context values that differ between server and client (like `renderMode`, `fetchRequest`, `isDevelopment`) - use them for logic/behavior control, not for displayed content
7. **Debugging values only**: Most context values are primarily useful for debugging and controlling behavior - avoid displaying them directly in your UI
8. **Frontend app config best practices**:
   - **Safe to display**: Unlike other context values, `frontendAppConfig` is **safe to render directly** because it's identical on server and client (injected into HTML and read back)
   - **Immutable**: The config is frozen and cannot be modified, ensuring consistent behavior throughout the request lifecycle
   - **Type assertions**: Use type assertions for better TypeScript support (e.g., `config?.apiUrl as string`)

## Related Documentation

- [Mount App Helper](./mount-app-helper.md) - Client-side mounting
- [SSR Documentation](./ssr.md) - Server-side rendering setup
- [SSG Documentation](./ssg.md) - Static site generation

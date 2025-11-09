# Unirend Context

The Unirend Context system provides React hooks to access render mode, development status, and server request information throughout your application.

<!-- toc -->

- [Overview](#overview)
- [Available Hooks](#available-hooks)
  - [`useIsSSR()`](#useisssr)
  - [`useIsSSG()`](#useisssg)
  - [`useIsClient()`](#useisclient)
  - [`useRenderMode()`](#userendermode)
  - [`useIsDevelopment()`](#useisdevelopment)
  - [`useIsServer()`](#useisserver)
  - [`useFrontendAppConfig()`](#usefrontendappconfig)
- [Request Context Management](#request-context-management)
  - [`useRequestContext()`](#userequestcontext)
  - [`useRequestContextValue<T>(key)`](#userequestcontextvaluetkey)
  - [`useRequestContextObjectRaw()`](#userequestcontextobjectraw)
  - [How Request Context Works](#how-request-context-works)
  - [Advanced Patterns](#advanced-patterns)
    - [Theme Management (Hydration-Safe)](#theme-management-hydration-safe)
    - [CSRF Token Management](#csrf-token-management)
- [How It Works](#how-it-works)
  - [Server-Side (SSR)](#server-side-ssr)
  - [Build-Time (SSG)](#build-time-ssg)
  - [Client-Side](#client-side)
- [Use Cases](#use-cases)
  - [1. Analytics and Logging](#1-analytics-and-logging)
  - [2. Accessing Frontend Configuration](#2-accessing-frontend-configuration)
  - [3. Environment-Specific Features](#3-environment-specific-features)
- [TypeScript Types](#typescript-types)
- [Best Practices](#best-practices)
- [Related Documentation](#related-documentation)

<!-- tocstop -->

## Overview

The context is automatically provided by Unirend during server-side rendering, static generation, and client-side rendering, giving your components access to:

- **Render Mode**: Whether the app is SSR (Server-Side Rendering), SSG (Static Site Generation), or Client (SPA or after hydration)
- **Development Status**: Whether running in development or production mode
- **Frontend App Config**: Immutable configuration object passed from the server (available on both server and client)
- **Request Context**: Per-request key-value store for managing mutable state across the request lifecycle

## Available Hooks

All hooks are exported from `unirend/client`:

```typescript
import {
  useIsSSR,
  useIsSSG,
  useIsClient,
  useRenderMode,
  useIsDevelopment,
  useIsServer,
  useFrontendAppConfig,
  useRequestContext,
  useRequestContextValue,
  useRequestContextObjectRaw,
} from 'unirend/client';
```

### `useIsSSR()`

Returns `true` if rendering mode is SSR, `false` otherwise.

```tsx
function MyComponent() {
  const isSSR = useIsSSR();

  return <div>{isSSR ? 'Server-Side Rendered' : 'Not SSR'}</div>;
}
```

### `useIsSSG()`

Returns `true` if rendering mode is SSG, `false` otherwise.

```tsx
function MyComponent() {
  const isSSG = useIsSSG();

  return <div>{isSSG ? 'Static Generated' : 'Not SSG'}</div>;
}
```

### `useIsClient()`

Returns `true` if rendering mode is client (SPA or after SSG build/SSR page hydration occurs), `false` otherwise.

```tsx
function MyComponent() {
  const isClient = useIsClient();

  return <div>{isClient ? 'Client Mode' : 'Server Context Available'}</div>;
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
    <div>{isServer ? 'Running on SSR server' : 'Running on client or SSG'}</div>
  );
}
```

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

## Request Context Management

Unirend provides a key-value store for managing per-request context data that can be populated on the server and mutated on the client. This is separate from `frontendAppConfig` which is immutable.

**Request Context vs Frontend App Config:**

- **Request Context**: Per-page/per-request mutable key-value store (e.g., user session data, theme preferences, page-specific state)
- **Frontend App Config**: Global, immutable configuration shared across all pages (e.g., API URLs, feature flags, build info)

### `useRequestContext()`

Hook that returns a `RequestContextManager` object with methods to manage the request context. The hook must be called at the component top level, but the returned methods can be called anywhere (callbacks, effects, event handlers).

```typescript
import { useRequestContext } from 'unirend/client';
import type { RequestContextManager } from 'unirend/client';
```

**Complete Example:**

```tsx
function MyComponent() {
  const requestContext = useRequestContext();

  const handleThemeChange = (theme: string) => {
    requestContext.set('theme', theme);
  };

  const handleClearUser = () => {
    const wasDeleted = requestContext.delete('userID');
    console.log(wasDeleted ? 'Deleted' : 'Key did not exist');
  };

  // ⚠️ Note: These values are NOT reactive - component won't re-render if they change
  const userID = requestContext.get('userID');
  const hasTheme = requestContext.has('theme');
  const allKeys = requestContext.keys();
  const totalEntries = requestContext.size();

  return (
    <div>
      <p>User ID: {userID}</p>
      <p>Has theme: {hasTheme ? 'Yes' : 'No'}</p>
      <p>Total entries: {totalEntries}</p>

      <h3>All Keys:</h3>
      <ul>
        {allKeys.map((key) => (
          <li key={key}>{key}</li>
        ))}
      </ul>

      <button onClick={() => handleThemeChange('dark')}>Dark Theme</button>
      <button onClick={() => handleThemeChange('light')}>Light Theme</button>
      <button onClick={handleClearUser}>Clear User ID</button>
      <button
        onClick={() => {
          const count = requestContext.clear();
          console.log(`Cleared ${count} keys`);
        }}
      >
        Clear All
      </button>
    </div>
  );
}
```

**⚠️ Important:** Values read with `requestContext.get()`, `has()`, `keys()`, or `size()` are **not reactive**. The component will not re-render if these values change. Use `useRequestContextValue()` (see below) if you need reactivity.

**API Methods:**

- **`get(key: string): unknown`** - Get a value (returns `undefined` if not found)
- **`set(key: string, value: unknown): void`** - Set a value
- **`has(key: string): boolean`** - Check if a key exists
- **`delete(key: string): boolean`** - Delete a key (returns `true` if it existed)
- **`clear(): number`** - Clear all keys (returns count of cleared keys)
- **`keys(): string[]`** - Get all keys
- **`size(): number`** - Get number of entries

### `useRequestContextValue<T>(key)`

Hook to access and reactively update a single request context value. Similar to `useState`, this returns a tuple of `[value, setValue]` and will cause the component to re-render when the value changes.

**Works on both server and client** - you can use this during SSR/SSG rendering and on the client after hydration.

```typescript
import { useRequestContextValue } from 'unirend/client';
```

**Example:**

```tsx
function ThemeToggle() {
  const [theme, setTheme] = useRequestContextValue<string>('theme');

  return (
    <div>
      <p>Current theme: {theme || 'default'}</p>
      <button onClick={() => setTheme('dark')}>Dark</button>
      <button onClick={() => setTheme('light')}>Light</button>
    </div>
  );
}

function UserProfile() {
  const [userID, setUserID] = useRequestContextValue<string>('userID');
  const [preferences, setPreferences] =
    useRequestContextValue<Record<string, unknown>>('preferences');

  return (
    <div>
      <p>User: {userID}</p>
      <button onClick={() => setUserID('user-123')}>Set User</button>
      <button
        onClick={() => setPreferences({ theme: 'dark', notifications: true })}
      >
        Update Preferences
      </button>
    </div>
  );
}
```

**Returns:** `[T | undefined, (value: T) => void]` - A tuple similar to `useState`

**When to use:**

- Use `useRequestContextValue` when you need reactivity (component re-renders on value change)
- Use `useRequestContext()` methods when you don't need reactivity (e.g., reading once, updating in callbacks)

### `useRequestContextObjectRaw()`

Hook to get the entire request context object for debugging purposes. Returns a cloned, immutable copy of the complete request context.

**⚠️ Important:** This is primarily for debugging. Use `useRequestContextValue()` or `useRequestContext()` for production code.

```typescript
import { useRequestContextObjectRaw } from 'unirend/client';
```

**Example:**

```tsx
function DebugPanel() {
  const rawContext = useRequestContextObjectRaw();

  if (!rawContext) {
    return <div>Request context not populated</div>;
  }

  return (
    <details>
      <summary>Debug: Request Context</summary>
      <pre>{JSON.stringify(rawContext, null, 2)}</pre>
    </details>
  );
}
```

**Returns:** `Record<string, unknown> | undefined` - A cloned, frozen copy of the request context object

**Key Features:**

- **Cloned & Immutable**: Uses `structuredClone()` and `Object.freeze()` to prevent accidental mutations
- **Reactive**: Updates when the request context changes
- **Hydration Safe**: Only populates after client-side hydration to avoid SSR/client mismatches
- **Cross-Environment**: Works in SSR, SSG, and client environments

**When to use:**

- **Debugging**: Inspect the entire context state during development
- **Dev Tools**: Build debugging interfaces or development panels
- **Testing**: Verify context state in tests
- **Not for Production**: Use `useRequestContextValue()` or `useRequestContext()` for production features

### How Request Context Works

**Server-Side (SSR):**

- Plugins/middleware/handlers can populate context by modifying `request.requestContext`
- Components can read or update the context during server-side rendering
- The context is shared across the entire request lifecycle and injected into the client HTML

**Build-Time (SSG):**

- SSG pages: Components can populate context during the generation process
- SPA pages: Context can be manually provided in the page definition via the `requestContext` property
- The context acts as a key-value store initially populated during page generation

**Client-Side:**

- Components can read or update the context using the functions above
- Changes persist in memory for the current page session

For more details on populating request context on the server, see:

- [SSR Documentation - Request Context Injection](./ssr.md#request-context-injection)
- [SSG Documentation - Request Context Injection](./ssg.md#request-context-injection)

### Advanced Patterns

#### Theme Management (Hydration-Safe)

Handle automatic theme detection while avoiding hydration mismatches:

```tsx
import { useRequestContext, useRequestContextValue } from 'unirend/client';
import type { ServerPlugin } from 'unirend/server';

// Server-side: Set theme from cookie in a plugin
function themePlugin(): ServerPlugin {
  return async (pluginHost) => {
    pluginHost.addHook('onRequest', async (request, reply) => {
      // Read theme preference from cookie, default to 'light'
      const themePreference = request.cookies.themePreference || 'light';
      const currentTheme = request.cookies.currentTheme || themePreference;

      // For 'auto' preference, detect from User-Agent or default to light for SSR
      const resolvedTheme = themePreference === 'auto' ? 'light' : currentTheme;

      // Store in request context for components to use
      request.requestContext.theme = resolvedTheme;
      request.requestContext.themePreference = themePreference; // Original preference
    });

    return {
      name: 'theme',
      dependsOn: ['cookies'], // Ensure cookies plugin is loaded first
    };
  };
}

// Register the plugin in your server setup
const server = serveSSRProd({
  // ... other options
  plugins: [cookies(), themePlugin()],
});

// Optional: Add to your index.html template head to prevent theme flash
// (like in demos/ssg/index.html - Unirend's processTemplate will preserve this script
// and inject it before context scripts and your original scripts built by vite)
// <script>
//   (function() {
//     const themePreference = document.cookie.match(/themePreference=([^;]+)/)?.[1] || 'light';
//     const currentTheme = document.cookie.match(/currentTheme=([^;]+)/)?.[1] || themePreference;
//     const theme = themePreference === 'auto' ? 'light' : currentTheme;
//     document.documentElement.className = `theme-${theme}`;
//   })();
// </script>

// Usage in your app layout component
function AppLayout({ children }) {
  // Theme preference can be updated from other components (e.g., toggle in header, settings page)
  // using: const [themePreference, setThemePreference] = useRequestContextValue<string>('themePreference');
  // Remember to also update the cookie: document.cookie = `themePreference=${newValue}; path=/; max-age=${60 * 60 * 24 * 365}`;
  const [themePreference] = useRequestContextValue<string>('themePreference'); // 'light', 'dark', or 'auto'

  // Current theme comes directly from context (set by server plugin initially)
  // This also allows components to conditionally render based on theme without relying on CSS classes
  const [currentTheme, setCurrentTheme] =
    useRequestContextValue<string>('theme'); // useState-like API

  const resolvedTheme = currentTheme || 'light';

  useEffect(() => {
    // Always update HTML element for Tailwind or CSS library dark mode and extra safety
    document.documentElement.className = `theme-${resolvedTheme}`;

    // Update cookie so theme persists on future visits
    document.cookie = `currentTheme=${resolvedTheme}; path=/; max-age=${60 * 60 * 24 * 365}`; // 1 year
  }, [resolvedTheme]);

  useEffect(() => {
    // Only run on client after hydration
    if (themePreference === 'auto') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

      const updateTheme = () => {
        const detectedTheme = mediaQuery.matches ? 'dark' : 'light';

        // Update context if theme changed (using setState-like API)
        if (detectedTheme !== resolvedTheme) {
          setCurrentTheme(detectedTheme);
        }
      };

      // Initial detection
      updateTheme();

      // Listen for changes
      mediaQuery.addEventListener('change', updateTheme);

      // Cleanup listener
      return () => {
        mediaQuery.removeEventListener('change', updateTheme);
      };
    }
  }, [themePreference, resolvedTheme, setCurrentTheme]);

  return (
    <div>
      <header>...</header>
      <main>{children}</main>
      <footer>...</footer>
    </div>
  );
}
```

#### CSRF Token Management

Pass security tokens from server to client safely:

```tsx
// Server-side: Generate and inject CSRF token in a plugin
// Ideally used with a session plugin for secure session management
function csrfPlugin(): ServerPlugin {
  return async (pluginHost) => {
    pluginHost.addHook('onRequest', async (request, reply) => {
      // Generate CSRF token for this request (requires session)
      // Example: const csrfToken = crypto.randomBytes(32).toString('hex');
      const csrfToken = generateCSRFToken(request.session);

      // Store in request context
      request.requestContext.csrfToken = csrfToken;

      // Also set in response header for API calls
      reply.header('X-CSRF-Token', csrfToken);
    });

    return {
      name: 'csrf',
      dependsOn: ['session'], // Ensure session plugin is loaded first
    };
  };
}

// Register the plugin in your server setup
const server = serveSSRProd({
  // ... other options
  plugins: [session(), csrfPlugin()],
});

// Component usage
// For login/logout without full page reload, you can update the token using the setter:
// const [csrfToken, setCsrfToken] = useRequestContextValue<string>('csrfToken');
function APIForm() {
  const [csrfToken] = useRequestContextValue<string>('csrfToken'); // useState-like API

  const handleSubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);

    try {
      const response = await fetch('/api/submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken, // Include token in request
        },
        body: JSON.stringify(Object.fromEntries(formData)),
      });

      // Handle API response
      if (response.ok) {
        const data = await response.json();
        // Handle success
      } else {
        // Handle API errors (4xx, 5xx)
        console.error('API error:', response.status);
      }
    } catch (error) {
      // Handle network errors
      console.error('Network error:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Hidden input as backup */}
      <input type="hidden" name="csrf_token" value={csrfToken} />
      {/* Rest of form */}
    </form>
  );
}

// Custom hook for API calls with CSRF
function useSecureAPI() {
  const [csrfToken] = useRequestContextValue<string>('csrfToken'); // useState-like API

  const securePost = useCallback(
    async (url, data) => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify(data),
        });

        // Return response - caller should handle success/error checking
        return response;
      } catch (error) {
        // Network errors are re-thrown - caller should handle with try/catch
        throw error;
      }
    },
    [csrfToken],
  );

  return { securePost };
}
```

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
import { useLocation } from 'react-router';

// Your analytics client instance
const analytics = {
  track: (event: string, data: Record<string, unknown>) => {
    // Send to your analytics service
    console.log('Analytics:', event, data);
  },
};

function trackPageView(path: string, renderMode: string) {
  // Send analytics with render mode context
  analytics.track('page_view', {
    path,
    renderMode, // "ssr", "ssg", or "client"
    timestamp: Date.now(),
  });
}

function MyPage() {
  const location = useLocation();
  const renderMode = useRenderMode();
  const isServer = useIsServer();

  useEffect(() => {
    // Track client-side navigation
    trackPageView(location.pathname, renderMode);
  }, [location.pathname, renderMode]);

  // Log server-side renders (doesn't affect UI)
  if (isServer) {
    console.log(
      `[${renderMode.toUpperCase()}] Rendering: ${location.pathname}`,
    );
  }

  return <div>My Page</div>;
}
```

### 2. Accessing Frontend Configuration

```tsx
function APIClient() {
  const config = useFrontendAppConfig();

  // Access public API configuration
  const apiUrl = (config?.apiUrl as string) || 'http://localhost:3000';
  const cdnUrl = config?.cdnUrl as string;
  const appVersion = config?.version as string;

  return (
    <div>
      <p>API Endpoint: {apiUrl}</p>
      <p>CDN: {cdnUrl || 'Not configured'}</p>
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
  const renderMode = useRenderMode();
  const isServer = useIsServer();

  if (!isDev) return null;

  return (
    <div className="debug-panel">
      <h3>Debug Info</h3>
      <p>Render Mode: {renderMode}</p>
      <p>Is Server: {isServer ? 'Yes' : 'No'}</p>
    </div>
  );
}
```

## TypeScript Types

All types are exported from `unirend/client`:

```typescript
import type { UnirendRenderMode, RequestContextManager } from 'unirend/client';

// UnirendRenderMode = "ssr" | "ssg" | "client"

// RequestContextManager = {
//   get(key: string): unknown;
//   set(key: string, value: unknown): void;
//   has(key: string): boolean;
//   delete(key: string): boolean;
//   clear(): number;
//   keys(): string[];
//   size(): number;
// }
```

## Best Practices

1. **Use specific hooks when possible**: Prefer `useIsSSR()` over `useRenderMode()` when you only need a boolean check
2. **Use request context for state**: Use `useRequestContext()` and `useRequestContextValue()` for per-request state management
3. **Avoid overusing**: Don't check render mode for every component - only when behavior needs to differ
4. **Type safety**: TypeScript will help you use the Request object correctly
5. **SSR vs SSG**: Use `useIsServer()` to detect true SSR server vs SSG build-time rendering
6. **Avoid hydration mismatches**: Don't directly render context values that differ between server and client (like `renderMode`, `isDevelopment`) - use them for logic/behavior control, not for displayed content
7. **Debugging values only**: Most context values are primarily useful for debugging and controlling behavior - avoid displaying them directly in your UI
8. **Frontend app config best practices**:
   - **Safe to display**: Unlike other context values, `frontendAppConfig` is **safe to render directly** because it's identical on server and client (injected into HTML and read back)
   - **Immutable**: The config is frozen and cannot be modified, ensuring consistent behavior throughout the request lifecycle
   - **Type assertions**: Use type assertions for better TypeScript support (e.g., `config?.apiUrl as string`)

## Related Documentation

- [Mount App Helper](./mount-app-helper.md) - Client-side mounting
- [SSR Documentation](./ssr.md) - Server-side rendering setup
- [SSG Documentation](./ssg.md) - Static site generation

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
  - [`useCDNBaseURL()`](#usecdnbaseurl)
  - [`useDomainInfo()`](#usedomaininfo)
- [Request Context Management](#request-context-management)
  - [`useRequestContext()`](#userequestcontext)
  - [`useRequestContextValue<T>(key)`](#userequestcontextvaluetkey)
  - [`useRequestContextObjectRaw()`](#userequestcontextobjectraw)
  - [How Request Context Works](#how-request-context-works)
  - [Advanced Patterns](#advanced-patterns)
    - [Theme Management (Hydration-Safe)](#theme-management-hydration-safe)
      - [Server Plugin](#server-plugin)
      - [Server Setup](#server-setup)
      - [Flash Prevention (`index.html`)](#flash-prevention-indexhtml)
      - [React Context & Hook](#react-context--hook)
      - [Usage](#usage)
      - [Theme-Aware Images](#theme-aware-images)
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
- **Frontend App Config**: Read-only configuration object passed from the server (frozen during server rendering, available as a plain clone on the client)
- **CDN Base URL**: The effective CDN URL for asset serving (available on both server and client via `useCDNBaseURL()`)
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
  useCDNBaseURL,
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

Returns the frontend application configuration object. During server rendering (SSR/SSG) this is a deep-frozen clone, mutations are blocked for the duration of the render. On the client it is a plain clone of the injected config, isolated to the current page session but not frozen.

```tsx
function MyComponent() {
  const config = useFrontendAppConfig();

  if (!config) {
    return <div>No config available</div>;
  }

  return (
    <div>
      <p>API URL: {config.api_endpoint as string}</p>
      <p>App Name: {config.appName as string}</p>
      <p>Feature Flags: {JSON.stringify(config.features)}</p>
    </div>
  );
}
```

**Returns:** `Record<string, unknown> | undefined`

**Note:** The config is deep-cloned and deep-frozen on each request, all nested objects are immutable for the duration of the request. Unlike other context values like `renderMode` or `fetchRequest`, the `frontendAppConfig` is **safe to display directly in your UI** because it remains identical between server rendering and client hydration. The server injects it into the HTML, and the client reads it back from the same source, preventing hydration mismatches.

### `useCDNBaseURL()`

Returns the effective CDN base URL for the current request. Available on both server (SSR resolves the per-request or app-level CDN URL before rendering) and client (reads from `window.__CDN_BASE_URL__` injected by the server). Always returns a `string`, empty string when no CDN is configured.

```tsx
function AssetImage({ path }: { path: string }) {
  const cdnBase = useCDNBaseURL();

  return <img src={`${cdnBase}${path}`} />;
}
```

**Returns:** `string`, empty string when no CDN is configured (including when running Vite directly without the unirend server)

### `useDomainInfo()`

Returns domain information computed server-side from the request hostname. Available during SSR (always) and SSG (when a `hostname` option is provided at build time). Returns `null` when the hostname is not known, SSG without hostname configured, or pure SPA.

```tsx
import { useDomainInfo } from 'unirend/client';

function setCookie(name: string, value: string, rootDomain?: string) {
  document.cookie = [
    `${name}=${value}`,
    'path=/',
    'max-age=31536000',
    rootDomain ? `domain=.${rootDomain}` : null,
  ]
    .filter(Boolean)
    .join('; ');
}

function ThemeToggle() {
  const domainInfo = useDomainInfo();
  // domainInfo?.hostname  → 'app.example.com'
  // domainInfo?.rootDomain → 'example.com' (no leading dot — prepend '.' for cookie domain attribute)

  return (
    <button onClick={() => setCookie('theme', 'dark', domainInfo?.rootDomain)}>
      Switch to dark
    </button>
  );
}
```

**Returns:** `DomainInfo | null`

- `hostname`, the bare requested hostname with port stripped (e.g. `'app.example.com'`)
- `rootDomain`, the apex domain without a leading dot (e.g. `'example.com'`), or empty string for localhost / IP addresses. Prepend `.` when using as a cookie `domain` attribute to span subdomains (e.g. `domain=.example.com`).

**Dynamic Updates:** Since the config is cloned from the source at request time, you can update values between requests by holding a reference to the object (or a sub-object within it) that you passed in. For example, you could keep a `const timeConfig = { year: 2025 }` sub-object, pass it inside your config, and update `timeConfig.year` at midnight, all requests after that point will pick up the new value. Updates are global (all subsequent requests, not a specific user), and in-flight requests are unaffected since their clone is already isolated. Use `requestContext` instead if you need per-request or per-user values.

## Request Context Management

Unirend provides a key-value store for managing per-request context data that can be populated on the server and mutated on the client. This is separate from `frontendAppConfig`, which is intended to be read-only.

**Request Context vs Frontend App Config:**

- **Request Context**: Per-page/per-request mutable key-value store (e.g., user session data, theme preferences, page-specific state)
- **Frontend App Config**: Global, read-only configuration shared across all pages (e.g., API URLs, feature flags, build info)

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

- **Cloned & Immutable**: Uses `structuredClone()` and deep freeze to prevent accidental mutations (all nested objects are frozen)
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

- SSG pages: Context can be seeded before rendering via the `requestContext` property on the page definition, and components can also populate or override values during the generation process
- SPA pages: Context can be manually provided in the page definition via the `requestContext` property
- The context acts as a key-value store initially populated during page generation

**Client-Side:**

- Components can read or update the context using the functions above
- Changes persist in memory for the current page session
- For non-component code (data loaders, utilities, module-level functions), all three framework globals are available directly on the client. These only exist in the browser, guard with `typeof window !== 'undefined'` and provide a server-side fallback:

```typescript
// window globals for use outside of React components (e.g. data loaders)
// In components, use the hooks instead: useRequestContext(), useFrontendAppConfig(), useCDNBaseURL()

// Per-request context (set by SSR middleware or SSG page definitions)
const requestCtx =
  typeof window !== 'undefined'
    ? window.__FRONTEND_REQUEST_CONTEXT__
    : undefined; // server fallback: not available outside of components on the server

// App-wide config (set via frontendAppConfig option in serveSSRProd/serveSSGProd)
const appConfig =
  typeof window !== 'undefined' ? window.__FRONTEND_APP_CONFIG__ : undefined; // server fallback: use process.env or your config source directly

// CDN base URL (set via CDNBaseURL option or per-request middleware override)
const cdnBase =
  typeof window !== 'undefined' ? window.__CDN_BASE_URL__ : undefined; // server fallback: use process.env.CDN_BASE_URL or ''
```

For more details on populating request context on the server, see:

- [SSR Documentation - Request Context Injection](./ssr.md#request-context-injection)
- [SSG Documentation - Request Context Injection](./ssg.md#request-context-injection)

### Advanced Patterns

#### Theme Management (Hydration-Safe)

Handle theme preferences ('light', 'dark', 'auto') without hydration mismatches or flash.

Drive all theming via the `dark` class on `<html>`, use Tailwind `dark:` classes or CSS selectors rather than conditional JSX based on theme. Conditional rendering based on theme can cause hydration errors since the server and client may resolve `auto` differently.

Two separate concerns:

- **`themePreference`**, what the user chose ('light'/'dark'/'auto'), stored in request context and persisted to a cookie
- **`resolvedTheme`**, the actual 'light' or 'dark' applied to `<html>`, derived from preference + system `matchMedia`

##### Server Plugin

Seeds `themePreference` into request context from the cookie on each request (`theme-plugin.ts`):

```typescript
import type { ServerPlugin } from 'unirend/server';

// Seed theme preference from cookie. Store the raw preference — the server never
// resolves 'auto' since OS preference isn't available server-side.
export function themePlugin(): ServerPlugin {
  return async (pluginHost) => {
    pluginHost.addHook('onRequest', async (request, reply) => {
      const cookie = request.cookies.themePreference;
      const validPreferences = ['light', 'dark', 'auto'] as const;

      request.requestContext.themePreference = validPreferences.includes(
        cookie as (typeof validPreferences)[number],
      )
        ? cookie
        : 'auto'; // fallback to OS preference if missing or tampered
    });

    return {
      name: 'theme',
      dependsOn: ['cookies'], // Ensure cookies plugin is loaded first
    };
  };
}
```

##### Server Setup

```typescript
import { serveSSRProd } from 'unirend/server';
import { cookies } from '@fastify/cookie';
import { themePlugin } from './theme-plugin';

const server = serveSSRProd({
  // ... other options
  plugins: [cookies(), themePlugin()],
});
```

##### Flash Prevention (`index.html`)

Add to `<head>` to apply the correct class before JS loads. The cookie is preferred over `__FRONTEND_REQUEST_CONTEXT__`, it reflects the user's last explicit choice and is always current. The context value is baked at build time for SSG, or read at request time for SSR (a change in another tab mid-request would still leave them out of sync). Falls back to the OS preference via `matchMedia` when neither is set.

> **Place this script after all `<meta>` tags** Some scrapers and link-preview services stop parsing at the first `<script>` tag regardless of its length, so any meta tags after it won't appear in social previews.

```html
<script>
  (function () {
    const valid = ['light', 'dark', 'auto'];
    const cookieMatch = document.cookie.match(
      /(?:^|;\s*)themePreference=([^;]+)/,
    );

    const cookiePref = valid.includes(cookieMatch?.[1]) ? cookieMatch[1] : null;

    const pref =
      cookiePref ||
      window.__FRONTEND_REQUEST_CONTEXT__?.themePreference ||
      'auto';

    const systemPrefersDark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;

    const theme =
      pref === 'auto' ? (systemPrefersDark ? 'dark' : 'light') : pref;

    if (theme === 'dark') document.documentElement.classList.add('dark');
  })();
</script>
```

##### React Context & Hook

**`theme/context.ts`**, types and context object:

```typescript
import { createContext, useContext } from 'react';

export type ThemePreference = 'auto' | 'dark' | 'light';
export type ResolvedTheme = 'dark' | 'light';

export interface ThemeContextValue {
  preference: ThemePreference;
  systemTheme: ResolvedTheme;
  resolvedTheme: ResolvedTheme;
  cycleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme() {
  const ctx = useContext(ThemeContext);

  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
```

**`theme/ThemeProvider.tsx`**, single instance owns resolution, system tracking, and `<html>` class:

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRequestContextValue, useDomainInfo } from 'unirend/client';
import {
  ThemeContext,
  type ThemePreference,
  type ResolvedTheme,
} from './context';

const CYCLE: ThemePreference[] = ['auto', 'dark', 'light'];

// Evaluated once when the module loads on the client; null on the server (no window)
const darkMQ =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function ThemeProvider({ children }: { children: ReactNode }) {
  // preference is seeded from requestContext (SSG build-time or SSR middleware)
  const [preference, setContextPref] =
    useRequestContextValue<ThemePreference>('themePreference');
  // ref is shared between cycleTheme (sender) and the BroadcastChannel effect (receiver)
  const channelRef = useRef<BroadcastChannel | null>(null);

  // useDomainInfo() gives us the root domain for subdomain-spanning cookies.
  // Available in SSR (always) and SSG (when hostname is configured at build time).
  // Returns null otherwise — cookie is then scoped to the current host, which is fine.
  const domainInfo = useDomainInfo();

  // systemTheme always defaults to 'light' on the server (window.matchMedia isn't available
  // during SSR/SSG). The client reads matchMedia immediately via the lazy initializer.
  // We don't render conditional JSX based on resolvedTheme, so the server/client
  // difference doesn't cause a hydration mismatch — the effect only toggles a class.
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    darkMQ?.matches ? 'dark' : 'light',
  );

  // On mount, reconcile cookie with the server-seeded context value. The cookie is always
  // the most up-to-date source — SSG bakes the context at build time, and even SSR reads
  // it at request time so a change in another tab mid-request can leave them out of sync.
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)themePreference=([^;]+)/);
    const val = match?.[1] as ThemePreference | undefined;
    const valid: ThemePreference[] = ['light', 'dark', 'auto'];

    if (val && valid.includes(val) && val !== preference) {
      setContextPref(val);
    }
  }, [preference, setContextPref]);

  // Subscribe to OS-level dark/light preference changes (e.g. user switches system theme)
  useEffect(() => {
    if (!darkMQ) {
      return;
    }

    function handler(e: MediaQueryListEvent) {
      setSystemTheme(e.matches ? 'dark' : 'light');
    }

    darkMQ.addEventListener('change', handler);
    return () => darkMQ.removeEventListener('change', handler);
  }, []);

  // Missing or 'auto' preferences follow the OS theme.
  const resolvedTheme: ResolvedTheme =
    preference && preference !== 'auto' ? preference : systemTheme;

  // Single place that updates <html> — CSS dark: selectors key off this class
  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
  }, [resolvedTheme]);

  const cycleTheme = () => {
    const next =
      CYCLE[(CYCLE.indexOf(preference ?? 'auto') + 1) % CYCLE.length];

    document.cookie = [
      `themePreference=${next}`,
      'path=/',
      `max-age=${60 * 60 * 24 * 365}`,
      domainInfo?.rootDomain ? `domain=.${domainInfo.rootDomain}` : null,
    ]
      .filter(Boolean)
      .join('; ');

    // Notify other same-origin tabs
    channelRef.current?.postMessage({ themePreference: next });
    setContextPref(next);
  };

  // Single BroadcastChannel instance for cross-tab sync
  useEffect(() => {
    if (typeof BroadcastChannel !== 'function') {
      return;
    }

    const channel = new BroadcastChannel('theme');
    channelRef.current = channel;

    channel.onmessage = (
      e: MessageEvent<{ themePreference?: ThemePreference }>,
    ) => {
      if (e.data?.themePreference) {
        setContextPref(e.data.themePreference);
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [setContextPref]);

  // Re-read cookie when tab becomes visible — catches changes made in other tabs or
  // subdomains while this tab was in the background. Intentionally does NOT broadcast
  // so we don't loop back to tabs that already made the change.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      const match = document.cookie.match(/(?:^|;\s*)themePreference=([^;]+)/);
      const val = match?.[1] as ThemePreference | undefined;
      const valid: ThemePreference[] = ['light', 'dark', 'auto'];

      if (val && valid.includes(val)) {
        setContextPref(val);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, [setContextPref]);

  return (
    <ThemeContext.Provider
      value={{
        preference: preference ?? 'auto',
        systemTheme,
        resolvedTheme,
        cycleTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
```

##### Usage

**`AppLayout.tsx`**, wrap your app with `ThemeProvider`:

```tsx
import { ThemeProvider } from './theme/ThemeProvider';

export function AppLayout({ children }) {
  return (
    <ThemeProvider>
      <div>
        <header>...</header>
        <main>{children}</main>
        <footer>...</footer>
      </div>
    </ThemeProvider>
  );
}
```

**`ThemeToggle.tsx`**, can live anywhere inside `ThemeProvider`:

```tsx
import { useTheme } from './context';

const labels: Record<string, string> = {
  auto: 'Auto',
  dark: 'Dark',
  light: 'Light',
};

export function ThemeToggle() {
  const { preference, cycleTheme } = useTheme();

  return <button onClick={cycleTheme}>Theme: {labels[preference]}</button>;
}
```

##### Theme-Aware Images

When you need different images per theme, avoid two `<img>` tags with CSS `display: none`, browsers load both regardless. Instead, use `background-image` via CSS (only the matching rule's image loads) combined with `role="img"` and `aria-label` to restore accessibility:

```css
/* Only the active theme's image is requested by the browser */
.dark .theme-illustration {
  background-image: url('/illustration-dark.png');
}

html:not(.dark) .theme-illustration {
  background-image: url('/illustration-light.png');
}

/* Size the element to match your image */
.theme-illustration {
  width: 400px;
  height: 300px;
  background-size: contain;
  background-repeat: no-repeat;
  background-position: center;
}
```

```html
<div
  class="theme-illustration"
  role="img"
  aria-label="A description of the illustration"
/>
```

`role="img"` + `aria-label` gives screen readers the same information a real `<img alt="...">` would. This works automatically with the `dark` class toggle on `<html>`, no JavaScript needed.

**Vite asset handling:** Use relative paths in your CSS file so Vite fingerprints the images for long-term caching. Absolute `/` paths work too but won't be hashed:

```css
.dark .theme-illustration {
  background-image: url('./assets/illustration-dark.png'); /* Vite hashes this */
}
html:not(.dark) .theme-illustration {
  background-image: url('./assets/illustration-light.png');
}
```

**Co-locating styles in a component:** For self-contained components, you can inline the `<style>` directly in JSX. Vite does **not** process `url()` references inside JSX style strings, so import the images to get Vite's asset hashing:

```tsx
import darkImg from './assets/illustration-dark.png';
import lightImg from './assets/illustration-light.png';

export function ErrorIllustration() {
  return (
    <>
      <style>{`
        .error-illustration { background-image: url('${lightImg}'); }
        .dark .error-illustration { background-image: url('${darkImg}'); }
      `}</style>
      <div
        className="error-illustration w-[400px] h-[300px] bg-contain bg-no-repeat bg-center"
        role="img"
        aria-label="Lost in the dark"
      />
    </>
  );
}
```

For images in the `public/` folder (stable URLs, no hashing needed), you can use `/` paths directly in the style string without importing.

#### CSRF Token Management

Pass security tokens from server to client safely:

```tsx
// Server-side: Generate and inject CSRF token in a plugin
// Ideally used with a session plugin for secure session management
function csrfPlugin(): ServerPlugin {
  return async (pluginHost) => {
    pluginHost.addHook('onRequest', async (request, reply) => {
      // Generate or retrieve CSRF token from session
      // The token is stored usually stored in the request.session on the server and must be validated
      // against the session when processing form submissions/mutations
      // Example: if (!request.session.csrfToken) { request.session.csrfToken = crypto.randomBytes(32).toString('hex'); }
      const csrfToken = generateCSRFToken(request.session); // Returns existing or generates new token

      // Store in request context to pass to frontend (read-only transport)
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

// Server-side: Validate CSRF token when processing form submissions/mutations
// In your API route handlers, validate the submitted token against request.session.csrfToken
// Example using envelope structure:
// const submittedToken = request.headers['x-csrf-token'] || request.body?.csrf_token;

// if (!submittedToken || submittedToken !== request.session.csrfToken) {
//   return APIResponseHelpers.createAPIErrorResponse({
//     request,
//     statusCode: 403,
//     errorCode: 'invalid_csrf_token',
//     errorMessage: 'Invalid or missing CSRF token',
//   });
// }

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
  isDevelopment: getDevMode(), // Reads from globalThis.__lifecycleion_is_dev__ (injected by server, see docs/dev-mode.md)
  fetchRequest: undefined, // No server request on client
  frontendAppConfig: window.__FRONTEND_APP_CONFIG__, // Read from injected global (SSR/SSG) or undefined (pure SPA)
}
```

**Note:** The `frontendAppConfig` is automatically read from `window.__FRONTEND_APP_CONFIG__` which is injected into the HTML by the server during SSR/SSG. In pure SPA mode (no server rendering), this will be `undefined`. `window.__CDN_BASE_URL__` is also injected by the server, as an empty string when no CDN URL is configured, or `undefined` if running Vite directly without the unirend server.

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
  const api_endpoint =
    (config?.api_endpoint as string) || 'http://localhost:3000';
  const cdnUrl = config?.cdnUrl as string;
  const appVersion = config?.version as string;

  return (
    <div>
      <p>API Endpoint: {api_endpoint}</p>
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
   - **Read-only by convention**: The config is deep-frozen during server rendering (SSR/SSG) to prevent accidental mutations mid-render. On the client it is a plain clone, technically mutable, but treat it as read-only since it represents static configuration
   - **Type assertions**: Use type assertions for better TypeScript support (e.g., `config?.api_endpoint as string`)

## Related Documentation

- [Mount App Helper](./mount-app-helper.md) - Client-side mounting
- [SSR Documentation](./ssr.md) - Server-side rendering setup
- [SSG Documentation](./ssg.md) - Static site generation

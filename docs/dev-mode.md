# Dev Mode

Unirend integrates with the **Lifecycleion dev mode convention** via the [`lifecycleion`](https://github.com/keverw/lifecycleion/blob/master/docs/dev-mode.md) package, a single runtime global (`globalThis.__lifecycleion_is_dev__`) set once at startup and injected into every rendered HTML page so client and server always agree. Import `initDevMode()`, `getDevMode()`, and `overrideDevMode()` from `lifecycleion/dev-mode` directly in your server files or app code.

<!-- toc -->

- [Dev mode vs `serveSSRDev` / `serveSSRProd`](#dev-mode-vs-servessrdev--servessrprod)
- [API](#api)
  - [`initDevMode(arg?)`](#initdevmodearg)
  - [`getDevMode(): boolean`](#getdevmode-boolean)
  - [`overrideDevMode(value: boolean | 'redetect')`](#overridedevmodevalue-boolean--redetect)
- [Where dev mode is read](#where-dev-mode-is-read)
- [How it works](#how-it-works)
  - [Server side](#server-side)
  - [HTML injection](#html-injection)
  - [Client side](#client-side)
- [Why not `import.meta.env.DEV`?](#why-not-importmetaenvdev)

<!-- tocstop -->

## Dev mode vs `serveSSRDev` / `serveSSRProd`

These are **separate concepts**:

- **`serveSSRDev` / `serveSSRProd`** control the **asset serving strategy**, whether Vite runs a live HMR dev server or serves pre-built static assets. This is about how code is loaded, not how errors are displayed.
- **`initDevMode()`** controls **runtime behavior**, whether error details, stack traces, and debugging related output are shown to users.

They are orthogonal. You could run `serveSSRDev` (live reload via Vite) with `initDevMode(false)` (production-style error handling) if you wanted to test how errors appear to end users while still getting HMR. Or run `serveSSRProd` with `initDevMode(true)` to debug a production build locally with full error details.

## API

### `initDevMode(arg?)`

Sets the global **once** (first-wins). If already set, subsequent calls are no-ops.

```typescript
import { initDevMode } from 'lifecycleion/dev-mode';

// Explicit
initDevMode(true);
initDevMode(false);

// Auto-detect from CLI args ("dev" or "prod" in process.argv)
initDevMode({ detect: 'cmd' });

// Strict: throws if neither "dev" nor "prod" is in argv
initDevMode({ detect: 'cmd', strict: true });

// Auto-detect from NODE_ENV
initDevMode({ detect: 'node_env' });

// Both (default when called with no args): cmd takes precedence when explicit
initDevMode();
initDevMode({ detect: 'both' });
```

**Detection hierarchy** (no-arg / `'both'`):

1. If `process.argv` contains `'dev'` → `true`, if `'prod'` → `false`
2. Otherwise fall back to `process.env.NODE_ENV === 'development'`

### `getDevMode(): boolean`

Reads the global. Returns `false` if not yet initialized, never throws. Safe to call anywhere (server or client).

```typescript
import { getDevMode } from 'lifecycleion/dev-mode';

if (getDevMode()) {
  console.log('Running in development mode');
}
```

### `overrideDevMode(value: boolean | 'redetect')`

Bypasses first-wins, always overwrites the global.

```typescript
import { overrideDevMode } from 'lifecycleion/dev-mode';

overrideDevMode(true); // force dev
overrideDevMode(false); // force prod
overrideDevMode('redetect'); // clear and re-run auto-detection
```

Useful for tests, SPA debugging, or tools that need to override what HTML injection set.

## Where dev mode is read

Internally, dev mode flows through several layers:

- **`request.isDevelopment`**, set per-request via an `onRequest` hook. Plugins and route handlers read this for per-request branching.
- **`unirendContext.isDevelopment`**, set from `request.isDevelopment` when the render context is created, so the React tree always sees the same value as the server for that request.
- **`pluginOptions.isDevelopment`**, set once at plugin registration time. Appropriate for registration-time decisions (what routes/hooks to register), not for per-request branching.
- **Error components** (`DefaultApplicationError`, custom [`get500ErrorPage`](ssr.md#error-handling)), call `getDevMode()` directly because they render outside the `UnirendProvider` (intentionally standalone to avoid infinite error loops).
  - **SSR**: The server catches 500 errors and renders them through Fastify's error handling pipeline, the `get500ErrorPage(request, error, isDevelopment)` callback receives `isDevelopment` from `request.isDevelopment`, so the per-request value drives the decision. The direct `getDevMode()` call is a fallback for client-side error boundaries.
  - **SSG**: There is no server request during static generation, so if a page render throws, `DefaultApplicationError` reads `getDevMode()` directly. Since SSG is a batch process (not a long-running server), the global usually should never be changed mid-build, so this is safe in practice.

Since `overrideDevMode()` is primarily a testing/debugging tool and not something toggled mid-flight in production, the per-request snapshot and the direct global read will always agree in practice.

## How it works

### Server side

Call `initDevMode()` **before** starting your server or running SSG:

```typescript
import { initDevMode } from 'lifecycleion/dev-mode';

initDevMode({ detect: 'cmd' });

// Then start your server...
```

### HTML injection

`injectContent()` automatically adds a synchronous inline script to every rendered page:

```html
<script>
  globalThis.__lifecycleion_is_dev__ = false;
</script>
```

This runs before any `<script type="module">` (Vite bundles), so the global is always set before `mount-app.ts` executes.

### Client side

`mountApp()` reads `getDevMode()` for the `isDevelopment` context value:

- **SSR/SSG pages**: the server-injected inline script runs first (before any module code), so the global is already set by the time `mountApp()` executes. Nothing extra needed client-side.
- **Pure SPA** (no server rendering): nothing injects the global, so `getDevMode()` returns `false` (safe production default).

If you need dev mode in a pure SPA, call `initDevMode()` in your entry file before `mountApp()`:

```typescript
import { initDevMode } from 'lifecycleion/dev-mode';
import { mountApp } from 'unirend';
import { routes } from './routes';

// For pure SPA: set explicitly, or use Vite's build-time constant
initDevMode(true); // or: initDevMode(import.meta.env.DEV)

mountApp('root', routes);
```

This is a no-op on SSR/SSG pages (the server-injected value wins via first-wins).

## Why not `import.meta.env.DEV`?

`import.meta.env.DEV` is **statically replaced at build/transform time** by Vite's plugin system. It is not a runtime global, you cannot override it in user code before the module runs.

More importantly, it is `true` during Vite's SSR dev server (code is not built) but `false` after a production build. This means the same code produces different values depending on whether it's running in dev-server mode or from a built artifact, causing inconsistency.

`globalThis.__lifecycleion_is_dev__` is runtime-settable and works with any bundler or runtime.

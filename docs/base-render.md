# Base Render

<!-- toc -->

- [Overview](#overview)
- [API](#api)
- [Options](#options)
- [Benefits](#benefits)
- [Loader Data Envelope Format](#loader-data-envelope-format)
  - [Server-Side-Only Data (Internal)](#server-side-only-data-internal)
  - [Envelope Properties](#envelope-properties)
  - [How It Works](#how-it-works)

<!-- tocstop -->

### Overview

The `unirendBaseRender` function is a helper function that handles React Router/Data Loaders, UnirendProvider, UnirendHeadProvider, renderToString, and error parsing for both SSR and SSG scenarios.

When setting up your `EntrySSG.tsx` or `EntrySSR.tsx`, you export a `render` function that accepts an `RenderRequest` and uses `unirendBaseRender` to handle the rendering of your app. This will return structured data that will be used to generate the HTML for your page or serve as the response for SSR.

```typescript
import { unirendBaseRender } from 'unirend/server';
import type { RenderRequest } from 'unirend/server';
import type { RouteObject } from 'react-router';
import { routes } from './Routes';

export async function render(renderRequest: RenderRequest) {
  // Pass your routes directly - unirendBaseRender creates the static handler and router internally
  return await unirendBaseRender(renderRequest, routes, {
    strictMode: true,
    // Optional: wrap the entire app above the router with root-level providers
    // rootProviders: ({ children }) => <ThemeProvider>{children}</ThemeProvider>
  });
}
```

This supports React Router Data Loaders following the standardized envelope pattern. The function works identically for both SSR and SSG, providing a unified server rendering approach.

### API

- `unirendBaseRender(renderRequest: RenderRequest, routes: RouteObject[], options?: BaseRenderOptions): Promise<RenderResult>`

### Options

- `strictMode?: boolean`, Wrap with React.StrictMode (default: `true`)
- `rootProviders?: React.ComponentType<{ children: React.ReactNode }>`, Optional wrapper component that sits above the router, providing global context (themes, state stores, etc.) available across both normal routes and the router's `errorElement`. Common uses: theme providers, global modal containers, toast notification containers. Because it sits outside the router, errors thrown inside it bypass React Router's `errorElement`. On SSR they surface as server-level failures handled by `get500ErrorPage`, and on SSG they fail the page render entirely. React error boundaries only work on the client, so keep `rootProviders` stable and unlikely to throw.

### Benefits

- Type-safe routes with `RouteObject[]`
- Automatic static handler and router creation
- Unified API for both SSR and SSG
- Async support for React Router data loading

### Loader Data Envelope Format

Unirend uses the standardized API/Page response envelope described in [docs/api-envelope-structure.md](./api-envelope-structure.md) within React Router loaders to handle status codes and errors. This keeps API and page responses consistent across SSR and SSG. The `__ssOnly` field noted below is an internal server-only extension used by the framework.

For end‑to‑end loader examples (server‑driven and local) and how envelopes control status codes and error propagation, see: [docs/data-loaders.md](./data-loaders.md).

#### Server-Side-Only Data (Internal)

The `__ssOnly` field is reserved for Unirend internals. It is set and consumed by the framework (page data loader and base renderer) to keep certain values on the server only. It is stripped before client hydration. App loaders generally should not set `__ssOnly` directly.

#### Envelope Properties

- `status_code?: number` - HTTP status code (defaults to 200)
- `error?: { message?: string, details?: { stack?: string } }` - Error information
- `__ssOnly?: Record<string, unknown>` - Server-side-only data (internal, reserved, set by framework helpers and stripped before client hydration)
- `...otherData` - Regular data that will be available on both server and client

#### How It Works

1. **Status Codes**: Unirend checks for `status_code` in loader data and uses it for the HTTP response
2. **Error Handling**: The `error.message` and `error.details.stack` are extracted for error reporting
3. **Server-Only Data**: `__ssOnly` data is available during rendering but removed before client hydration
4. **Priority**: React Router errors take precedence over envelope errors

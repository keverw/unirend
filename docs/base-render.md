# Base Render

<!-- toc -->

- [Overview](#overview)
- [API](#api)
- [Options](#options)
- [Benefits](#benefits)
- [Important guidelines](#important-guidelines)
- [Loader Data Envelope Format](#loader-data-envelope-format)
  - [Status Codes and Errors](#status-codes-and-errors)
  - [Server-Side-Only Data (internal)](#server-side-only-data-internal)
  - [Envelope Properties](#envelope-properties)
  - [How it works](#how-it-works)

<!-- tocstop -->

### Overview

The `unirendBaseRender` function is a helper function that handles React Router/Data Loaders, Helmet, renderToString, and error parsing for both SSR and SSG scenarios.

When setting up your `entry-ssg.tsx` or `entry-server.tsx`, you export a `render` function that accepts an `IRenderRequest` and uses `unirendBaseRender` to handle the rendering of your app. This will return structured data that will be used to generate the HTML for your page or serve as the response for SSR.

```typescript
import { unirendBaseRender, type IRenderRequest } from "unirend/server";
import { type RouteObject } from "react-router";
import { routes } from "./routes";

export async function render(renderRequest: IRenderRequest) {
  // Pass your routes directly - unirendBaseRender creates the static handler and router internally
  return await unirendBaseRender(renderRequest, routes, {
    strictMode: true, // Optional: configure StrictMode
    // wrapProviders: ({ children }) => <CustomProvider>{children}</CustomProvider> // Optional: custom wrapper for additional providers
  });
}
```

This supports React Router Data Loaders following the standardized envelope pattern. The function works identically for both SSR and SSG, providing a unified server rendering approach.

### API

- `unirendBaseRender(renderRequest: IRenderRequest, routes: RouteObject[], options?: BaseRenderOptions): Promise<RenderResult>`

### Options

- `strictMode?: boolean` — Wrap with React.StrictMode (default: `true`)
- `wrapProviders?: React.ComponentType<{ children: React.ReactNode }>` — Custom wrapper for additional providers (pure context providers only — no HTML rendering to avoid hydration issues)
- `helmetContext?: HelmetServerState` — Optional custom Helmet context

### Benefits

- Type-safe routes with `RouteObject[]`
- Automatic static handler and router creation
- Unified API for both SSR and SSG
- Async support for React Router data loading

### Important guidelines

Keep `wrapProviders` components pure (context providers only). Avoid rendering HTML elements or applying styles directly in these providers to prevent hydration mismatches. Use route layouts for HTML structure and styling instead.

### Loader Data Envelope Format

Unirend uses the standardized API/Page response envelope described in [docs/api-envelope-structure.md](./api-envelope-structure.md) within React Router loaders to handle status codes and errors. This keeps API and page responses consistent across SSR and SSG. The `__ssOnly` field noted below is an internal server-only extension used by the framework.

#### Status Codes and Errors

Your loaders can return data in this envelope format to control HTTP status codes and error handling:

```typescript
// In your React Router loader
export async function loader({ params }) {
  try {
    const data = await fetchUserData(params.id);

    // Success response
    return {
      user: data,
      status_code: 200, // Optional: defaults to 200
    };
  } catch (error) {
    // Error response with custom status code
    return {
      status_code: 404,
      error: {
        message: "User not found",
        details: {
          stacktrace: error.stack, // Optional: for debugging
        },
      },
    };
  }
}
```

#### Server-Side-Only Data (internal)

The `__ssOnly` field is reserved for Unirend internals. It is set and consumed by the framework (page data loader and base renderer) to keep certain values on the server only. It is stripped before client hydration. App loaders generally should not set `__ssOnly` directly.

#### Envelope Properties

- `status_code?: number` - HTTP status code (defaults to 200)
- `error?: { message?: string, details?: { stacktrace?: string } }` - Error information
- `__ssOnly?: Record<string, unknown>` - Server-side-only data (internal, reserved; set by framework helpers and stripped before client hydration)
- `...otherData` - Regular data that will be available on both server and client

#### How it works

1. **Status Codes**: Unirend checks for `status_code` in loader data and uses it for the HTTP response
2. **Error Handling**: The `error.message` and `error.details.stacktrace` are extracted for error reporting
3. **Server-Only Data**: `__ssOnly` data is available during rendering but removed before client hydration
4. **Priority**: React Router errors take precedence over envelope errors

# Error Handling Strategy

<!-- toc -->

- [Overview](#overview)
- [Recommended Setup](#recommended-setup)
  - [Error Utilities and Recommended Setup](#error-utilities-and-recommended-setup)
- [Error Types](#error-types)
  - [Thrown Errors](#thrown-errors)
  - [Envelope Response Errors](#envelope-response-errors)
- [Error Handling Flow](#error-handling-flow)
  - [Server-Side Rendering (SSR) Errors](#server-side-rendering-ssr-errors)
    - [1) Thrown Errors During SSR](#1-thrown-errors-during-ssr)
    - [2) Loader Response Errors During SSR](#2-loader-response-errors-during-ssr)
  - [Client-Side (After Hydration) Errors](#client-side-after-hydration-errors)
    - [3) Thrown Errors After Hydration](#3-thrown-errors-after-hydration)
    - [4) Loader Response Errors After Hydration](#4-loader-response-errors-after-hydration)
  - [Static Site Generation (SSG) Notes](#static-site-generation-ssg-notes)
    - [5) Error Responses with Stack Trace (Development Only)](#5-error-responses-with-stack-trace-development-only)
- [Integration with API Envelope Structure](#integration-with-api-envelope-structure)
- [Reference Implementation](#reference-implementation)
- [Extending the Strategy](#extending-the-strategy)

<!-- tocstop -->

This document describes how Unirend handles and recommends handling errors across SSR and client, using the standardized API/Page response envelopes.

## Overview

Unirend distinguishes between:

- **Thrown errors**: Uncaught exceptions (`throw new Error(...)`).
- **Envelope response errors**: Structured error responses returned by data loaders or API handlers (per the API Envelope spec).

Behavior also depends on both the error path and when it occurs:

1. Thrown route, loader, or render errors
2. Returned or framework-converted page error envelopes
3. The final environment where the error is surfaced, such as SSR, SSG, or after hydration on the client

## Recommended Setup

### Error Utilities and Recommended Setup

- **Error Boundary (thrown errors)**: In your `routes.tsx`, set `RouteErrorBoundary` as the root route's `errorElement` to catch thrown errors during navigation and SSR.
  - Import: `import { RouteErrorBoundary } from 'unirend/router-utils'`
  - Pass your custom components: `NotFoundComponent` (404s) and `ApplicationErrorComponent` (thrown errors).
  - The `ApplicationErrorComponent` should be a standalone page (no app layout). While the `NotFoundComponent` can be standalone or use your layout, either is fine.
  - For SSR parity, your server's `get500ErrorPage` should visually match your `ApplicationErrorComponent`.

  ```ts
  // routes.tsx
  import type { RouteObject } from 'react-router'
  import { RouteErrorBoundary } from 'unirend/router-utils'
  import AppLayout from './AppLayout'
  import NotFound from './pages/NotFound'
  import ApplicationError from './pages/ApplicationError'

  export const routes: RouteObject[] = [
    {
      path: '/',
      element: <AppLayout />,
      errorElement: (
        <RouteErrorBoundary
          NotFoundComponent={NotFound}
          ApplicationErrorComponent={ApplicationError}
        />
      ),
      children: [
        // your routes...
        // Example:
        // {
        //   index: true,
        //   element: <Home />,
        // },
        // Example loader route
        // {
        //   path: 'profile',
        //   element: <Profile />,
        //   loader: createPageDataLoader(pageDataLoaderConfig, 'profile'),
        // },
        // Catch‑all 404 route at the end
        // Useful when you want a data loader to produce a 404 page envelope
        // so you can still return consistent metadata or app context on not found
        // You could also log 404s here to a backend, to consider adding redirects or for SEO analysis
        // {
        //   path: '*',
        //   element: null,
        //   loader: createPageDataLoader(pageDataLoaderConfig, 'not-found'),
        // },
      ],
    },
  ]
  ```

- **Inline envelope errors in layout**: In your `AppLayout`, use `useDataLoaderEnvelopeError` to render inline errors when a loader returns a page error envelope directly, or when the framework converts a loader failure into one.
  - Import: `import { useDataLoaderEnvelopeError } from 'unirend/router-utils'`
  - Typical mapping: render a `NotFound` component for 404s and a generic error component for other cases. See the SSR demo's `demos/ssr/src/routes.tsx` layout pattern.
  - A dedicated not-found page data loader is recommended, but inline handling in your layout works too.

## Error Types

### Thrown Errors

Unhandled exceptions from loaders/components during SSR or client navigation.

### Envelope Response Errors

Errors returned as envelopes with `status: "error"` from page data loaders/handlers or API endpoints.

## Error Handling Flow

### Server-Side Rendering (SSR) Errors

#### 1) Thrown Errors During SSR

When an unhandled error occurs during SSR:

- The server error handler in `SSRServer` catches it.
- In development, Vite fixes stack traces for clarity.
- A full page 500 error is returned via your configured `get500ErrorPage()`.
- Your route-level `ApplicationErrorComponent` should generally stay standalone to avoid cascading layout failures.
- For a consistent branded experience, your server `get500ErrorPage()` and your standalone `ApplicationErrorComponent` should usually look and feel similar, even though one is server-generated HTML and the other is a React component.
- In development, details may be shown, in production, show a generic message.

#### 2) Loader Response Errors During SSR

When a loader returns a page error envelope directly, or when the framework converts a loader failure into one first:

- A rendered page with `statusCode === 500` is detected by `SSRServer`, which then sends the server 500 page via `get500ErrorPage()`.
- A rendered 4xx page envelope can still be handled in your normal app-shell pattern.
- This means loader failures or returned 500 page envelopes may first render through the page-envelope path, and SSR may then replace the final rendered 500 page with the server 500 page flow.

### Client-Side (After Hydration) Errors

#### 3) Thrown Errors After Hydration

- `RouteErrorBoundary` catches thrown errors from routes/elements.
- Render a standalone application error page component for thrown errors to avoid cascading layout failures. If you provide a custom one, it should generally stay standalone, without shared headers, footers, or other layout wrappers.

#### 4) Loader Response Errors After Hydration

- For envelope-based errors (e.g., rendered 4xx/5xx page envelopes), use the helper hook `useDataLoaderEnvelopeError` inside your app layout to detect and render inline error UIs while keeping header/footer.
- **SSG with Local Data Loaders**: This same pattern applies to SSG when using local data loaders. Set up `useDataLoaderEnvelopeError` in your app layout to handle envelope errors returned by local handlers.
- Common pattern: render `CustomNotFound` for 404s, and `GenericError` for other errors. See the SSR demo's `routes.tsx` for an example layout pattern.

### Static Site Generation (SSG) Notes

- A rendered 4xx/5xx page envelope can still be written to disk.
- A local loader throw may first be normalized into a 500 page error envelope and then rendered through the normal page-envelope path.
- A raw component render throw is different. That becomes a render error instead of a rendered page envelope.
- See [docs/ssg.md](./ssg.md#5xx-error-handling) for the SSG-specific write and `failOn5xx` behavior.

#### 5) Error Responses with Stack Trace (Development Only)

- In dev, you may include a `stack` field in the envelope's `error.details` for debugging.
- Show stack traces only in development, never in production.

## Integration with API Envelope Structure

- Use the standardized envelopes for both page data loaders/handlers and API endpoints.
- Construct envelopes via helpers: `APIResponseHelpers.createPageErrorResponse` / `createAPIErrorResponse`, etc.
- The SSR server also emits standardized JSON envelopes for API 404 and errors when API handling is enabled.

## Reference Implementation

- See the SSR demo `routes.tsx` for a layout that:
  - Uses `RouteErrorBoundary` for thrown errors
  - Wraps outlet content with an App layout
  - Detects envelope errors via `useDataLoaderEnvelopeError` and renders inline errors

## Extending the Strategy

When adding new error cases:

1. Return properly structured envelopes from loaders/APIs.
2. Update the app layout error mapping (e.g., special components for specific error codes).
3. Keep SSR 500 error page and client inline error UIs visually consistent.
4. In development, optionally include a `stack` field in `error.details` to aid debugging.

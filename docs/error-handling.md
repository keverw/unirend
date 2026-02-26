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

Behavior also depends on when the error occurs:

1. During initial server-side rendering (SSR)
2. After hydration on the client

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

- **Inline envelope errors in layout**: In your `AppLayout`, use `useDataLoaderEnvelopeError` to render inline errors (including 404s) returned by data loaders.
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
- A full page 500 error is returned via your configured `get500ErrorPage()` which SHOULD NOT use your main app layout, and be a separate standalone error page to cascading layout failures.
- In development, details may be shown, in production, show a generic message.

#### 2) Loader Response Errors During SSR

When a loader produces a page render with `statusCode === 500`:

- `SSRServer` detects the 500 code in the render result and sends the server 500 page via `get500ErrorPage()`.
- This ensures a clean, consistent 500 page for initial SSR.

### Client-Side (After Hydration) Errors

#### 3) Thrown Errors After Hydration

- `RouteErrorBoundary` catches thrown errors from routes/elements.
- Render a standalone application error page component for thrown errors to avoid cascading layout failures.

#### 4) Loader Response Errors After Hydration

- For envelope-based errors (e.g., 4xx/5xx), use the helper hook `useDataLoaderEnvelopeError` inside your app layout to detect and render inline error UIs while keeping header/footer.
- **SSG with Local Data Loaders**: This same pattern applies to SSG when using local data loaders. Set up `useDataLoaderEnvelopeError` in your app layout to handle envelope errors returned by local handlers.
- Common pattern: render `CustomNotFound` for 404s, and `GenericError` for other errors. See the SSR demo's `routes.tsx` for an example layout pattern.

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

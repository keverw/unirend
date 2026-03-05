# UnirendHead

<!-- toc -->

- [Overview](#overview)
- [Usage](#usage)
- [Hardcoded vs loader-driven titles](#hardcoded-vs-loader-driven-titles)
- [API](#api)
  - [`<UnirendHead>`](#unirendhead)
  - [Supported tags](#supported-tags)
  - [Last-write-wins for title](#last-write-wins-for-title)
- [How it works](#how-it-works)
  - [Server-side (SSR / SSG)](#server-side-ssr--ssg)
  - [Client-side](#client-side)

<!-- tocstop -->

## Overview

`UnirendHead` is Unirend's built-in, framework-native document head manager. It handles `<title>`, `<meta>`, and `<link>` tags from inside React components with no extra dependencies.

It is exported from `unirend/client` and works identically in SSR, SSG, and client (SPA) modes.

## Usage

```tsx
import { UnirendHead } from 'unirend/client';

function HomePage() {
  return (
    <>
      <UnirendHead>
        <title>Home - My App</title>
        <meta name="description" content="Welcome to my app" />
        <meta property="og:title" content="Home - My App" />
        <link rel="canonical" href="https://example.com/" />
      </UnirendHead>
      <main>...</main>
    </>
  );
}
```

You can use `UnirendHead` in any component — layouts, pages, error boundaries. Child component tags take precedence over parent ones (see [Last-write-wins for title](#last-write-wins-for-title)).

## Hardcoded vs loader-driven titles

There are two common patterns for setting head tags:

**1. Hardcoded** — works for SSG or any page with a fixed title:

```tsx
<UnirendHead>
  <title>About - My App</title>
  <meta name="description" content="Learn about us" />
</UnirendHead>
```

**2. Dynamic from loader data** — for SSR pages where the server provides the title per-request:

`meta.page` is always present on page-type success envelopes (enforced by the response helpers and `isValidEnvelope`), and a page component only renders when its loader succeeds — so direct destructuring is safe. Note: not-found and error page components / error boundaries (custom 404, generic error, application error) receive `data?: PageErrorResponse | null` as props rather than from `useLoaderData()` — use optional chaining there (`data?.meta?.page?.title`) with a hardcoded fallback, since `data` can be `null` when React Router itself throws the error before any loader runs.

```tsx
import { UnirendHead } from 'unirend/client';
import { useLoaderData } from 'react-router';

function HomePage() {
  const loaderData = useLoaderData();
  const { title, description } = loaderData.meta.page;

  return (
    <>
      <UnirendHead>
        <title>{title}</title>
        <meta name="description" content={description} />
      </UnirendHead>
      <main>...</main>
    </>
  );
}
```

The `meta.page` fields come from the `pageMetadata` you return in your backend handler or local loader:

```ts
// Backend handler
APIResponseHelpers.createPageSuccessResponse({
  request,
  data: { ... },
  pageMetadata: { title: 'Home - My App', description: 'Welcome' },
});

// Local loader (e.g. SSG)
{ meta: { page: { title: 'Home - My App', description: 'Welcome' } }, ... }
```

Both patterns work in SSR, SSG, and SPA mode. See [docs/api-envelope-structure.md](./api-envelope-structure.md) for the full envelope spec and [docs/data-loaders.md](./data-loaders.md) for loader setup.

## API

### `<UnirendHead>`

Accepts `<title>`, `<meta>`, and `<link>` elements as direct children.

```tsx
import { UnirendHead } from 'unirend/client';

<UnirendHead>
  <title>Page Title</title>
  <meta name="description" content="..." />
  <meta property="og:image" content="https://example.com/og.png" />
  <link rel="canonical" href="https://example.com/page" />
</UnirendHead>;
```

**Props on child elements** map directly to HTML attributes — pass any valid attribute you would use on the native HTML tag.

### Supported tags

| Tag       | Notes                                                           |
| --------- | --------------------------------------------------------------- |
| `<title>` | Sets the page title. Text content is HTML-escaped.              |
| `<meta>`  | Any attributes (`name`, `content`, `property`, `charset`, etc.) |
| `<link>`  | Any attributes (`rel`, `href`, `type`, `sizes`, etc.)           |

Other child elements are silently ignored on the server (not collected). On the client they render as-is.

### Last-write-wins for title

If multiple `<UnirendHead>` components in the same render tree each set a `<title>`, the last one encountered during rendering wins. Since React renders parent components before children, a child page component's title always overrides a layout component's title — the expected behavior. (Using more than one `<UnirendHead>` in the same single page or error page component is valid but an anti-pattern — prefer one per component.)

`<meta>` and `<link>` entries **accumulate** — all entries from all `<UnirendHead>` instances in the tree are collected and injected. For example, a layout can add a `<link rel="canonical">` while a page component adds its own `<meta name="description">`.

## How it works

### Server-side (SSR / SSG)

During `renderToString`, `UnirendHead` reads a collector object from React context (provided by `UnirendHeadProvider`, which Unirend wraps your app with automatically). Each `<UnirendHead>` instance pushes its tags into the collector synchronously. After rendering, the collected data is serialized to HTML strings and injected into the `<!--ss-head-->` slot in the HTML template.

`UnirendHead` renders `null` on the server — the tags never appear in the rendered body HTML, only in `<head>` via the injection.

### Client-side

On the client the context collector is `null`, so `UnirendHead` renders its children as real DOM elements. React 19 automatically hoists `<title>`, `<meta>`, and `<link>` tags to `<head>` when rendered inside components — no portal or effect needed.

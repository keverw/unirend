# UnirendHead

<!-- toc -->

- [Overview](#overview)
- [Usage](#usage)
- [Hardcoded vs Loader-Driven Titles](#hardcoded-vs-loader-driven-titles)
- [API](#api)
  - [`<UnirendHead>`](#unirendhead)
  - [Supported Tags](#supported-tags)
    - [Preloading Images](#preloading-images)
  - [Tag Merging and Overrides](#tag-merging-and-overrides)
  - [Shared Layout & Error Component Pattern](#shared-layout--error-component-pattern)
  - [Global Provider Pattern (Theme, Language, Etc.)](#global-provider-pattern-theme-language-etc)
- [How It Works](#how-it-works)
  - [Server-Side (SSR / SSG)](#server-side-ssr--ssg)
  - [Client-Side](#client-side)
  - [Anti-Flicker & Attribute Hydration](#anti-flicker--attribute-hydration)

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

You can use `UnirendHead` in any component, layouts, pages, error boundaries. Later tags in the rendered document order take precedence for last-write-wins attributes (see [Tag Merging and Overrides](#tag-merging-and-overrides)).

## Hardcoded vs Loader-Driven Titles

There are two common patterns for setting head tags:

**1. Hardcoded**, works for SSG or any page with a fixed title:

```tsx
<UnirendHead>
  <title>About - My App</title>
  <meta name="description" content="Learn about us" />
</UnirendHead>
```

**2. Dynamic from loader data**, for SSR pages where the server provides the title per-request:

`meta.page` is always present on page-type success envelopes (enforced by the response helpers and `isValidEnvelope`), and a page component only renders when its loader succeeds, so direct destructuring is safe. Note: not-found and error page components / error boundaries (custom 404, generic error, application error) receive `data?: PageErrorResponse | null` as props rather than from `useLoaderData()`, use optional chaining there (`data?.meta?.page?.title`) with a hardcoded fallback, since `data` can be `null` when React Router itself throws the error before any loader runs.

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

Accepts `<title>`, `<meta>`, `<link>`, `<html>`, and `<body>` elements as direct children.

```tsx
import { UnirendHead } from 'unirend/client';

<UnirendHead>
  <title>Page Title</title>
  <meta name="description" content="..." />
  <meta property="og:image" content="https://example.com/og.png" />
  <link rel="canonical" href="https://example.com/page" />
  <html lang="en" className="dark" />
  <body className="bg-slate-900" />
</UnirendHead>;
```

**Props on child elements** map directly to HTML attributes, pass any valid attribute you would use on the native HTML tag.

### Supported Tags

| Tag       | Notes                                                           |
| --------- | --------------------------------------------------------------- |
| `<title>` | Sets the page title. Text content is HTML-escaped.              |
| `<meta>`  | Any attributes (`name`, `content`, `property`, `charset`, etc.) |
| `<link>`  | Any attributes (`rel`, `href`, `type`, `sizes`, etc.)           |
| `<html>`  | Sets attributes on the document `<html>` element.               |
| `<body>`  | Sets attributes on the document `<body>` element.               |

Other child elements are silently ignored on the server (not collected). On the client, `<title>`, `<meta>`, and `<link>` are natively hoisted by React 19, whereas `<html>` and `<body>` are filtered out from rendering inside the root element and instead applied to the DOM root elements using a client-side stack manager.

#### Preloading Images

`<link rel="preload">` works and is useful for hinting the browser to fetch a hero or above-the-fold image before it is discovered in the page body:

```tsx
import { UnirendHead } from 'unirend/client';
import { useCDNBaseURL } from 'unirend/client';

function HeroPage() {
  const cdn = useCDNBaseURL();

  return (
    <>
      <UnirendHead>
        <link rel="preload" as="image" href={`${cdn}/assets/hero.jpg`} />
      </UnirendHead>
      <img src={`${cdn}/assets/hero.jpg`} alt="Hero" />
    </>
  );
}
```

Unlike `<script>` and `<link>` tags already in your `index.html`, the head content injected by `UnirendHead` is not CDN-rewritten automatically. Prefix asset paths with `useCDNBaseURL()` so the preload hint and the actual image request go to the same origin.

### Tag Merging and Overrides

If multiple `<UnirendHead>` components are rendered in the same tree (e.g. in layouts, pages, or nested elements):

- **`<title>`**: **Last-write-wins**. A child component's title overrides a parent component's title.
- **`<html>` and `<body>` non-class attributes (like `lang`)**: **Last-write-wins**. A child component's attribute overrides a parent's attribute.
- **`<meta>` and `<link>`**: **Accumulate**. All tags from all `<UnirendHead>` instances are collected and rendered.
- **`<html>` and `<body>` class names (`class` or `className`)**: **Merge (accumulate)**. If the layout sets `<html className="font-sans" />` and the page sets `<html className="dark" />`, the result is `<html class="font-sans dark">`.
- **`<html>` and `<body>` styles (`style`)**: **Merge (concatenate)**. If both specify styles, they are concatenated together (separated by a semicolon). Because CSS inline rules evaluate in the order they are defined ("last declaration wins"), this allows nested pages/components to safely override specific inline properties from parent templates or layouts. To prevent clobbering external style mutations on the client (such as modal scroll locks), the client parses and reconciles calculated style properties key-by-key, using a lightweight, quote-aware semicolon-splitting parser that safely supports complex style values (like data URLs, calc values, or inline SVGs) without introducing a heavy CSS parser library dependency.

### Shared Layout & Error Component Pattern

Since standalone error pages (like `ApplicationError`) do not wrap in the normal `AppLayout` to prevent cascading render failures, they might need the same head attributes (like theme classes or language).

You can create a shared component that renders `<UnirendHead>` and import/render it in both places:

```tsx
// components/DocHead.tsx
import { UnirendHead } from 'unirend/client';

export function DocHead() {
  return (
    <UnirendHead>
      <html lang="en" className="font-sans theme-light" />
      <body className="bg-white dark:bg-gray-900" />
    </UnirendHead>
  );
}
```

And render `<DocHead />` inside both your `AppLayout.tsx` and your `ApplicationError.tsx`.

### Global Provider Pattern (Theme, Language, Etc.)

Alternatively to the `DocHead` component, if you pass global context providers (like a `ThemeProvider` or `LanguageProvider`) to the `rootProviders` option of the client-side `mountApp` and server-side render functions (e.g., `basePageRender`), you can render `<UnirendHead>` directly inside those providers to manage document attributes (like class names or document locale) dynamically:

```tsx
// components/theme/ThemeProvider.tsx
import { UnirendHead } from 'unirend/client';

export function ThemeProvider({ children }) {
  const [theme] = useState('dark');

  return (
    <ThemeContext.Provider value={theme}>
      <UnirendHead>
        <html className={theme} />
        {/* You can also specify language or other root attributes here */}
      </UnirendHead>
      {children}
    </ThemeContext.Provider>
  );
}
```

Since the `rootProviders` wrapper component sits above the entire app tree (including both layouts and standalone error boundary pages), the document attributes are automatically managed globally without requiring any manual imports in your layout or error boundary files.

## How It Works

### Server-Side (SSR / SSG)

During `renderToString`, `UnirendHead` reads a collector object from React context (provided by `UnirendHeadProvider`, which Unirend wraps your app with automatically). Each `<UnirendHead>` instance pushes its tags into the collector synchronously. After rendering, the collected data is serialized to HTML strings, and `<html>` / `<body>` attributes are merged into the template tags, while `<title>`/`<meta>`/`<link>` are injected into the `<!--ss-head-->` slot.

`UnirendHead` renders `null` on the server, the tags never appear in the rendered body HTML, only in `<head>` via the injection.

### Client-Side

On the client the context collector is `null`, so `UnirendHead` renders its children as real DOM elements. React 19 automatically hoists `<title>`, `<meta>`, and `<link>` tags to `<head>` when rendered inside components, no portal or effect needed. `<html>` and `<body>` attributes are managed by a client-side stack registry that applies them to the DOM on mount/update and restores the original template attributes on unmount.

### Anti-Flicker & Attribute Hydration

To prevent visual flickering (e.g. flashing white before a dark theme loads), an inline anti-flicker script in your `index.html` or a server-side handler may dynamically add attributes (like theme classes) to `<html>` or `<body>` before React loads and hydrates.

On first mount, `UnirendHead` captures the **static baseline template state** (the initial, clean attributes declared in your static `index.html` file). This baseline acts as the fallback default when all `<UnirendHead>` components are unmounted or when a specific attribute is no longer customized.

If dynamic boot-time attributes (like a `dark` theme class) were captured in this baseline, they would cause issues:

- **For classes/styles**: Since component classes are merged via a union, a captured boot-time class like `dark` would remain permanently active on the page (e.g. rendering `<html class="dark light">` when a component sets `light`).
- **For other attributes (like `lang` or custom data-attrs)**: Although they are overwritten when customized (last-write-wins), they would still revert to the captured boot-time value rather than the clean template default when no component customizes them.

To keep the baseline clean and static, Unirend uses two reconciliation strategies:

1. **SSR / SSG / SPA Mode (via Unirend Generator)**: The framework automatically parses the raw, unmodified `index.html` template's static attributes and serializes them into `window.__UNIREND_TEMPLATE_ATTRS__`. The client-side `<UnirendHead>` reads this variable to establish its clean baseline state.
2. **Vite Local Dev Server / Standard SPA Builds**: If the client mounts without a server-injected `window.__UNIREND_TEMPLATE_ATTRS__` (e.g. during local development on Vite's dev server, or in standard client-only SPA builds built and deployed directly without using Unirend's SSG `spa` generator type), it falls back to reading the live DOM attributes. If you use an inline script to toggle theme classes before hydration in these environments, you can register those classes in the `window.__UNIREND_IGNORED_CLASSES__` Set. This tells `UnirendHead` to filter them out of the baseline template attributes (on both `<html>` and `<body>`) captured on mount:

   ```html
   <script>
     // Determine theme preference...
     const theme = 'dark'; // e.g. from cookie or media query

     if (theme === 'dark') {
       document.documentElement.classList.add('dark');
       // Let UnirendHead know this class is dynamic so it isn't captured in the template baseline attributes.
       window.__UNIREND_IGNORED_CLASSES__ =
         window.__UNIREND_IGNORED_CLASSES__ || new Set();
       window.__UNIREND_IGNORED_CLASSES__.add('dark');
     }
   </script>
   ```

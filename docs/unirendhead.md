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
  - [Template Tags vs Page Tags](#template-tags-vs-page-tags)
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

**Props on child elements** map directly to HTML attributes, pass any valid attribute you would use on the native HTML tag. The two React prop spellings that are not simply the attribute name are translated for you: `className` becomes `class`, and `httpEquiv` becomes `http-equiv`. Spellings that differ only by case, like `charSet` or `crossOrigin`, need no translation, since HTML matches attribute names case-insensitively.

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

### Template Tags vs Page Tags

Your `index.html` can carry head tags of its own. The split is by ownership: tags that describe **the page** belong to `UnirendHead`, and tags that describe **the document or the site** belong to the template.

**Owned by `UnirendHead`, and always stripped from the template:**

| Tag                         | Notes                                   |
| --------------------------- | --------------------------------------- |
| `<title>`                   | Set it per page.                        |
| `<meta name="description">` | Set it per page.                        |
| `<meta property="og:*">`    | OpenGraph, except `og:site_name` below. |
| `<meta name="twitter:*">`   | Twitter cards.                          |

These are removed from the served page whether or not the page declares its own, so a page that sets none is served without them. Set them in the page itself, and in your error components too, since a standalone error page renders outside the normal layout.

Be careful about trying to supply these from a layout as a "default" a page then overrides. `<meta>` tags **accumulate** across `<UnirendHead>` instances rather than overriding by name (see [Tag Merging and Overrides](#tag-merging-and-overrides)), so a layout that sets `description` and a page that also sets it produce two `description` metas, not one. A layout is the right place for a meta only when every page under it should carry that exact tag and none of them redeclares it. `<title>` is the exception: it is last-write-wins, so a layout title genuinely does act as a default that a page's own title replaces.

**Owned by the template, and served as-is:** everything else. `<meta name="viewport">`, `<meta charset>`, `<meta name="theme-color">`, `<meta name="robots">`, `<meta property="og:site_name">`, `<link rel="icon">`, and anything custom you add all pass through untouched, and you do not redeclare them per page.

A page can still override a template-owned tag by declaring a `<meta>` with the same `name`, `property`, or `http-equiv` through `UnirendHead`. The page's version wins and the template's copy is dropped, so the served head never carries both, and navigating to a page that doesn't override it brings the template's version back. This mirrors how `<html>` and `<body>` attributes already work: the template's `<html lang="en">` is a baseline, and a page rendering `<html lang="fr" />` overrides it for as long as it is mounted.

The override holds in SSR, SSG, and across client-side navigation alike. On the server the template's copy is removed from the rendered head. On the client, `UnirendHead` reconciles the template's metas as pages mount and unmount, taking one out of the head while a page overrides it and putting it back when nothing does, so an override can't strand the baseline or end up sitting next to it. The template's meta baseline is carried to the client for this in `window.__UNIREND_TEMPLATE_METAS__`, alongside the `window.__UNIREND_TEMPLATE_ATTRS__` baseline described in [Anti-Flicker & Attribute Hydration](#anti-flicker--attribute-hydration), and the template's metas in the served head are tagged with a `data-unirend-template-meta` attribute so the client can tell them apart from the ones React hoists.

Overriding works on the identity, not on individual tags, so a page that overrides a `name` replaces every template meta carrying it. That matters for the light/dark `theme-color` pattern, where one identity covers two tags:

```html
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fff" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000" />
```

A page declaring `<meta name="theme-color" content="#page" />` replaces both, and both come back when it navigates away. If you want to override only one variant, you are really replacing the pair, so declare both variants on the page.

The page-owned tags are stripped unconditionally rather than kept as a baseline. For the metas among them (`description`, `og:*`, `twitter:*`) that is a decision about ownership, not a limitation: the reconciliation described above could hold a template default for them just as it does for `viewport`. They are excluded because they describe the individual page, so a template-supplied default would put a generic, stale description or `og:title` on every page that forgot to set its own, which is worse for a crawler than serving none at all.

`<title>` is stripped for a second, mechanical reason: unlike metas it is not part of the reconciled template baseline, so nothing on the client manages it. React only owns the tags it renders and will not remove a `<title>` that was already sitting in the head, so keeping the template's would leave the document with two of them once a page renders its own. A document takes its title from the first `<title>` in tree order, so the stale template one would win.

`og:site_name` is exempt from the `og:` rule because it names the site, not the page, so no page is expected to redeclare it.

<!-- prettier-ignore -->
> [!IMPORTANT]
> Keep `<meta name="viewport">` in your `index.html`. It is template-owned, and without it mobile browsers render the page at desktop width and scale it down, so responsive CSS never takes effect regardless of your media queries.

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

The template's own head tags are merged against the page's at the same time, following the ownership rules in [Template Tags vs Page Tags](#template-tags-vs-page-tags). The tags `UnirendHead` manages for every page are dropped from the template when it is first loaded, and the template's remaining metas are matched against the page's by identity, with a page's version replacing the template's so the served head never carries both.

`UnirendHead` renders `null` on the server, the tags never appear in the rendered body HTML, only in `<head>` via the injection.

### Client-Side

On the client the context collector is `null`, so `UnirendHead` renders its children as real DOM elements. React 19 automatically hoists `<title>`, `<meta>`, and `<link>` tags to `<head>` when rendered inside components, no portal or effect needed. `<html>` and `<body>` attributes are managed by a client-side stack registry that applies them to the DOM on mount/update and restores the original template attributes on unmount.

The template's own metas are reconciled by that same registry, because React only manages the tags it hoists and will not touch a node it did not create. A template meta is taken out of the head while a mounted page overrides its identity, and put back once none does, so an override survives a client-side navigation in both directions rather than only holding on the server-rendered page. The template's metas in the served head carry a `data-unirend-template-meta` attribute so the client can tell them apart from the ones React hoists.

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

The template's `<meta>` baseline is captured the same two ways, and is what the client restores when a page stops overriding a template meta. With a server-injected page it comes from `window.__UNIREND_TEMPLATE_METAS__`, which describes `index.html` as you authored it, including the metas the server left out of this page's head because the page overrides them. Without one (Vite's dev server, or a client-only SPA build) it is read from the live DOM before React hoists anything, where `index.html`'s metas are still the only ones present.

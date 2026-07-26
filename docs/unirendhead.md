# UnirendHead

<!-- toc -->

- [Overview](#overview)
- [Usage](#usage)
- [Hardcoded vs Loader-Driven Titles](#hardcoded-vs-loader-driven-titles)
- [API](#api)
  - [`<UnirendHead>`](#unirendhead)
  - [The `envelope` Prop](#the-envelope-prop)
    - [Only `meta.page` Is Read](#only-metapage-is-read)
    - [Malformed Envelopes](#malformed-envelopes)
    - [Overriding a Single Envelope Field](#overriding-a-single-envelope-field)
  - [Supported Tags](#supported-tags)
    - [Preloading Images](#preloading-images)
  - [Tag Merging and Overrides](#tag-merging-and-overrides)
  - [Development-Only Duplicate Warning](#development-only-duplicate-warning)
  - [Template Tags vs Page Tags](#template-tags-vs-page-tags)
    - [Overriding a Template Meta](#overriding-a-template-meta)
  - [Shared Layout & Error Component Pattern](#shared-layout--error-component-pattern)
  - [Global Provider Pattern (Theme, Language, Etc.)](#global-provider-pattern-theme-language-etc)
- [How It Works](#how-it-works)
  - [The Envelope Prepass](#the-envelope-prepass)
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

**2. Dynamic from loader data**, for SSR pages where the server provides the metadata per-request. Pass the loader envelope straight to `UnirendHead` and it renders a tag for every populated `meta.page` field:

```tsx
import { UnirendHead } from 'unirend/client';
import { useLoaderData } from 'react-router';

function HomePage() {
  const envelope = useLoaderData<HomeLoaderEnvelope>();

  return (
    <>
      <UnirendHead envelope={envelope} />
      <main>...</main>
    </>
  );
}
```

That covers `canonical`, `keywords`, and `og:*` as well as the title and description, so nothing is lost to the mechanical copying that stops at the two obvious fields. See [The `envelope` Prop](#the-envelope-prop) for the field mapping and how a locally declared tag overrides one field.

You can still write the tags out by hand if you want to, which is what every call site did before the `envelope` prop existed:

```tsx
function HomePage() {
  const { title, description } = useLoaderData().meta.page;

  return (
    <UnirendHead>
      <title>{title}</title>
      <meta name="description" content={description} />
    </UnirendHead>
  );
}
```

`meta.page` is always present on page-type success envelopes (enforced by the response helpers and `isValidEnvelope`), and a page component only renders when its loader succeeds, so direct destructuring is safe. Note: not-found and error page components / error boundaries (custom 404, generic error, application error) receive `data?: PageErrorResponse | null` as props rather than from `useLoaderData()`. Reading fields by hand there needs optional chaining (`data?.meta?.page?.title`) with a hardcoded fallback, since `data` can be `null` when React Router itself throws the error before any loader runs. The `envelope` prop accepts `null` directly, so `<UnirendHead envelope={data} />` works there without the guard.

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

**Component props:**

| Prop | Type | Notes |
| --- | --- | --- |
| `children` | `ReactNode` | The head elements above. A child always beats the `envelope` field with the same key. |
| `envelope` | `PageResponseEnvelope \| null` | A page data loader envelope. Every populated `meta.page` field becomes a tag. See [The `envelope` Prop](#the-envelope-prop). |
| `allowDuplicate` | `boolean \| string[]` | Opts this instance out of the [development-only duplicate warning](#development-only-duplicate-warning). |

All three are optional, so `<UnirendHead>` with children alone is unchanged.

### The `envelope` Prop

Pass the envelope your page data loader already returned and `UnirendHead` renders a tag for every populated `meta.page` field:

```tsx
const envelope = useLoaderData<HomeLoaderEnvelope>();

<UnirendHead envelope={envelope} />;
```

Unirend owns the `PageMetadata` shape, so it owns the projection to tags. The mapping:

| `meta.page` field | Tag rendered                                   |
| ----------------- | ---------------------------------------------- |
| `title`           | `<title>…</title>`                             |
| `description`     | `<meta name="description" content="…">`        |
| `keywords`        | `<meta name="keywords" content="…">`           |
| `canonical`       | `<link rel="canonical" href="…">`              |
| `og.title`        | `<meta property="og:title" content="…">`       |
| `og.description`  | `<meta property="og:description" content="…">` |
| `og.image`        | `<meta property="og:image" content="…">`       |

An absent field renders nothing. Unirend never substitutes placeholder text, so there is no `content="Error loading description"` waiting to ship to production, and a missing `title` renders no title at all rather than an invented fallback. A handler that returned success without `pageMetadata` is a bug, and a visibly empty title is the clearer signal.

#### Only `meta.page` Is Read

Nothing else under `meta` is looked at. `M extends BaseMeta` lets your app put whatever it likes there, and a projection that walked all of `meta` would publish it into the page head where crawlers and view-source pick it up. So given a meta like this:

```ts
interface AppMeta extends BaseMeta {
  page?: PageMetadata;
  app: { version: string; environment: string };
  account?: { isAuthenticated: boolean; userID?: string };
}
```

only `page` reaches the head. `app` and `account` are ignored entirely, by name and by value. The seven fields in the table above are the whole surface, so adding a key to your own meta type can never change the head output.

For your own fields, declare the tag as a child. It composes normally, additive alongside the generated ones:

```tsx
<UnirendHead envelope={envelope}>
  <meta name="app-version" content={envelope.meta.app.version} />
</UnirendHead>
```

#### Malformed Envelopes

The envelope came off the wire or out of a hand-written local loader, so it is read defensively rather than trusted to match its type. A missing `meta`, a missing `meta.page`, an `envelope` that is not an object at all, a `meta.page` that is a string or an array, or an individual field holding a number, `null`, or a nested object: each renders no tag for what it cannot use, keeps the fields it can, and never throws. A page that renders without a title beats a page that does not render.

Field values must be non-empty strings to be emitted. A numeric `title` does not become `String(123)`, and an object `canonical` does not become `[object Object]`.

`envelope` accepts error and redirect envelopes too, since `PageResponseEnvelope` covers all three. That is what makes the same call work in a 404 or error component, which receives the envelope as a `data` prop, and `null` is accepted for the case where React Router threw before any loader ran:

```tsx
export function NotFound({ data }: { data?: PageErrorResponse | null }) {
  return (
    <>
      <UnirendHead envelope={data}>
        <title>{data?.meta?.page?.title || '404 - Page Not Found'}</title>
      </UnirendHead>
      ...
    </>
  );
}
```

#### Overriding a Single Envelope Field

Declare the tag as a child and it wins, for that key only. Everything else still comes from the envelope:

```tsx
// title, keywords, canonical, and og:* still come from the envelope.
// Only description is replaced, and only one description tag is emitted.
<UnirendHead envelope={envelope}>
  <meta name="description" content="Something more specific" />
</UnirendHead>
```

Children can also add tags the envelope knows nothing about, which are emitted alongside the generated ones:

```tsx
<UnirendHead envelope={envelope}>
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">{JSON.stringify(schema)}</script>
</UnirendHead>
```

Keys are matched the same way the rest of `UnirendHead` matches them: metas on `name`, `property`, or `http-equiv` (so `og:*` works), links on `rel`, and a `<title>` child claims the title.

<!-- prettier-ignore -->
> [!IMPORTANT]
> This precedence is **local to a single `<UnirendHead>`**, between its own children and the envelope fields it would emit. It does not reach across the tree and does not change how separate instances relate to each other, which keeps following the rules in [Tag Merging and Overrides](#tag-merging-and-overrides). The merge resolves before anything is collected, so the server and the client both receive the same already-merged child list.

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

Note the two scopes at work. The table above is about **separate `<UnirendHead>` instances** in the same tree. Within **one** instance, a child beats the `envelope` field with the same key instead of accumulating alongside it, see [Overriding a Single Envelope Field](#overriding-a-single-envelope-field).

### Development-Only Duplicate Warning

Metas and links accumulating across instances is intentional, but a second `description` or `canonical` is almost always a slip rather than an intent. In development, `UnirendHead` prints one console warning when two separate instances emit the same key, naming the key and both values:

```text
[unirend] UnirendHead: two separate instances declare name=description, so both tags are emitted.
  first:  "Layout description"
  second: "Page description"
  Metas and links accumulate across UnirendHead instances (only <title> is last-write-wins).
  Declare it in one place, or pass allowDuplicate to the instance that means it.
  This warning only runs in development.
```

It is gated on Unirend's dev-mode signal, so a production build short-circuits before any scanning happens and never prints. It fires on the server during an SSR or SSG dev render, and in the browser console in SPA mode and after a client-side navigation.

What it deliberately stays quiet about:

- **A child overriding an `envelope` field.** That is the documented feature, and it never produces two tags anyway.
- **A duplicate `<title>`.** Last-write-wins is the designed pattern, a layout sets a default and a page overrides it.
- **The same key repeated inside one instance.** Only collisions between separate instances are reported.
- **Keys that legitimately repeat.** `og:image`, `og:video`, `og:audio` (with their `og:image:*` style sub-properties), `og:locale:alternate`, `og:see_also`, `article:tag`, `article:author`, `book:author`, `book:tag`, and `theme-color` (for the light and dark pair). Links are handled the other way round, since most relations repeat by nature: only `canonical`, `manifest`, and `amphtml` are treated as single-value, everything else (`preload`, `icon`, `alternate`, and so on) never warns.

For the intentional cases the list cannot know about, `allowDuplicate` opts an instance out:

```tsx
// Every key this instance emits is exempt
<UnirendHead allowDuplicate>...</UnirendHead>

// Only the named keys are exempt, anything else still warns
<UnirendHead allowDuplicate={['description']}>...</UnirendHead>
```

Either side of a collision can carry it, so state the intent once wherever it reads best rather than on every participating instance.

### Template Tags vs Page Tags

Use `UnirendHead` for tags that describe the current page. Keep tags that describe the document or site in `index.html`.

| Put in `UnirendHead`        | Keep in `index.html`                |
| --------------------------- | ----------------------------------- |
| `<title>`                   | `<meta charset>`                    |
| `<meta name="description">` | `<meta name="viewport">`            |
| `<meta property="og:*">`    | `<meta name="theme-color">`         |
| `<meta name="twitter:*">`   | `<meta name="robots">`              |
|                             | `<meta property="og:site_name">`    |
|                             | Icons, links, and other custom tags |

Unirend strips page-owned tags from the template, even when the current page does not declare replacements. This prevents a generic description or social preview from becoming stale page metadata. The exception is `og:site_name`, which describes the site and remains part of the template.

Set page-owned tags on every page that needs them, including standalone error components that render outside the normal layout.

Layouts can set metadata shared by all their pages, but a nested page should not declare another meta with the same identity. `<meta>` tags accumulate across `UnirendHead` instances, so setting `description` in both a layout and a page produces two description tags rather than replacing the layout value. Put a meta in a layout only when its nested pages will use that exact value without redeclaring it. Titles are different because the last title wins, so a layout title can act as a default, but a layout description meta cannot act as a default that pages replace. The [development-only duplicate warning](#development-only-duplicate-warning) points this out when it happens.

#### Overriding a Template Meta

A page can override a template meta by declaring the same `name`, `property`, or `http-equiv` in `UnirendHead`. The page's version replaces the template version in SSR, SSG, and client-side navigation. The template version returns when no mounted page overrides it.

An override replaces every template meta with that identity. For example, consider a light and dark `theme-color` pair:

```html
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#fff" />
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#000" />
```

A page that declares `theme-color` replaces both template tags. To retain separate light and dark variants, declare both on the page. Both template tags return when the override unmounts.

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

### The Envelope Prepass

When an `envelope` is passed, the merge resolves in front of everything else, before any collection happens:

1. Walk `children` and record the keys they claim. Metas key on `name`, `property`, or `http-equiv`, links on `rel`, and a `<title>` child claims the title.
2. Build a tag for each populated `meta.page` field whose key is not already claimed.
3. Hand `[...generatedTags, ...children]` to the code path below, unchanged from there on.

So this is a prepass in front of what `UnirendHead` already did. Nothing about the server collection, the serialization, the template merge, or the client reconciliation changes, and there is no separate marker protocol. Both the server and the client receive the same already-merged child list, so SSR and the hydrated DOM cannot drift apart.

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

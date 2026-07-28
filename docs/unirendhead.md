# UnirendHead

<!-- toc -->

- [Overview](#overview)
- [Usage](#usage)
- [Hardcoded vs Loader-Driven Titles](#hardcoded-vs-loader-driven-titles)
- [API](#api)
  - [`<UnirendHead>`](#unirendhead)
  - [The `envelope` Prop](#the-envelope-prop)
    - [Only `meta.page` Is Read](#only-metapage-is-read)
    - [The `og` Object](#the-og-object)
    - [Custom Tags](#custom-tags)
    - [Malformed Envelopes](#malformed-envelopes)
    - [Overriding a Single Envelope Field](#overriding-a-single-envelope-field)
  - [A Tag Is Not in the Head](#a-tag-is-not-in-the-head)
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
import type { PageSuccessResponse } from 'unirend/api-envelope';

type HomeLoaderEnvelope = PageSuccessResponse<{ message: string }>;

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

Use the real envelope type rather than a partial interface when passing loader data to `UnirendHead`. A page component renders after a successful loader, so `PageSuccessResponse<T>` is the appropriate type. Error components can pass their `PageErrorResponse | null` value directly.

The envelope form includes `canonical`, `keywords`, and `og:*` metadata without copying each field into JSX. You can still declare tags as children when the page owns them locally. See [The `envelope` Prop](#the-envelope-prop) for the field mapping and override rules.

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

Both are optional, so `<UnirendHead>` with children alone is unchanged.

### The `envelope` Prop

Pass the full envelope returned by your page data loader:

```tsx
const envelope = useLoaderData<HomeLoaderEnvelope>();

<UnirendHead envelope={envelope} />;
```

`UnirendHead` reads `meta.page` and renders these tags:

| `meta.page` field | Tag rendered |
| --- | --- |
| `title` | `<title>…</title>` |
| `description` | `<meta name="description" content="…">` |
| `keywords` | `<meta name="keywords" content="…">` |
| `canonical` | `<link rel="canonical" href="…">` |
| `og.title` | `<meta property="og:title" content="…">` |
| `og.description` | `<meta property="og:description" content="…">` |
| `og.image` | `<meta property="og:image" content="…">` |
| `og.<anything>` | `<meta property="og:<anything>" content="…">`, see [The `og` Object](#the-og-object) |
| `tags` | One `<meta>` or `<link>` per entry, see [Custom Tags](#custom-tags) |

Only populated strings render. Missing, empty, or malformed fields are skipped without placeholder values. The prop also accepts error and redirect envelopes and `null`, so the same form works in error components.

#### Only `meta.page` Is Read

Other application metadata is ignored. Custom fields under `meta`, such as account or build information, are never copied into the document head. Add a tag in the page component as a child, or use `meta.page.tags` when the handler needs to provide it.

#### The `og` Object

Every populated `og` member becomes an `og:` property. `title`, `description`, and `image` are named on the type, while the rest of the OpenGraph vocabulary passes through:

```ts
pageMetadata: {
  title: 'A Post - My App',
  description: 'A post',
  og: {
    title: 'A Post',
    image: 'https://example.com/post.png',
    type: 'article',
    url: 'https://example.com/posts/1',
    locale: 'en_US',
    'image:width': '1200',
  },
}
```

Keys that already start with `og:` are not prefixed again, so `type` and `og:type` both describe the same `og:type` tag. If both spellings are present, the first one processed wins. The named `title`, `description`, and `image` members are always processed first, so `title` wins over an `og:title` alias. Other properties follow their order in the object. Prefer one spelling per property rather than relying on that precedence.

For repeatable properties such as multiple images, keep the first value in `og` and add the others through `tags`:

```ts
og: { image: 'https://example.com/first.png' },
tags: [
  { meta: { property: 'og:image', content: 'https://example.com/second.png' } },
  { meta: { property: 'og:image:width', content: '1200' } },
],
```

#### Custom Tags

Use `tags` for metadata and links that the named fields do not cover. Each entry names exactly one of `meta` or `link`:

```ts
pageMetadata: {
  title: 'Home - My App',
  description: 'Welcome',
  tags: [
    { meta: { name: 'app-version', content: '1.2.3' } },
    { meta: { name: 'twitter:card', content: 'summary_large_image' } },
    { link: { rel: 'alternate', href: '/feed.xml', type: 'application/rss+xml' } },
  ],
}
```

The exported `PageMetadataTag`, `PageMetadataMetaTag`, and `PageMetadataLinkTag` types enforce the required shape:

- A meta needs `content` and either `name` or `property`.
- A link needs `rel` and `href`.
- Omit the unused `meta` or `link` member. An entry naming both describes no single tag, so it renders neither and warns.
- Additional attributes such as `media`, `hreflang`, `type`, and `sizes` must be strings.

Envelope links accept any `rel`, matching what a `UnirendHead` child may declare. A handler can ship a `stylesheet`, a `preload`, or anything else a page could write in TSX.

Two limits remain, and neither is about which tag you want:

- **`http-equiv` is refused on a meta.** It instructs the browser rather than describing the page, and `http-equiv="refresh"` navigates it. An envelope already has [redirect responses](./api-envelope-structure.md) of its own, so a `refresh` meta from a loader is a sign something went wrong rather than a way to express intent. Declare it as a child if you need it.
- **Values must be plain strings, and a few attribute names are refused.** `style` (React reads it as an object, so the string form throws, and a head tag is not rendered anyway), React's own props (`children`, `dangerouslySetInnerHTML`, `key`, `ref`), and `on*` handlers. These are about not crashing the page rather than about policy: the attribute is dropped and the tag renders without it, in every build. Development additionally warns and names what was dropped, so the tag never silently loses something you meant to keep.

Named fields win over custom entries with the same non-repeatable key. Repeatable tags such as multiple `og:image` values and alternate links are kept. Invalid or dropped custom entries produce a development warning.

#### Malformed Envelopes

The envelope is read defensively. A missing or unusable `meta.page` produces no generated tags, and an invalid field or custom entry is skipped without affecting valid metadata beside it. Values are not coerced.

Error components can pass their envelope or `null` directly:

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

Declare a child tag to override that key while keeping the rest of the envelope metadata:

```tsx
<UnirendHead envelope={envelope}>
  <meta name="description" content="Something more specific" />
</UnirendHead>
```

Metas match by `name`, `property`, or `http-equiv`, links match by `rel`, and a child `<title>` replaces the generated title.

A child replaces everything the envelope contributed for that key, however many tags that was. Declaring `og:image` as a child drops the `og.image` field, every `og:image` entry in `tags`, and the sub-properties describing them, such as `og:image:width`. The same grouping applies to `og:video`, `og:audio`, `twitter:image`, and `twitter:player`. Write the child with the attribute the envelope used, which for an `og` member is always `property`, since `name="og:image"` and `property="og:image"` are separate identities and a child on one does not claim the other.

This override applies only within one `UnirendHead`. Tags from separate instances still follow [Tag Merging and Overrides](#tag-merging-and-overrides).

### A Tag Is Not in the Head

In development, invalid or dropped `meta.page.tags` entries warn in the server terminal during SSR or SSG and in the browser console on the client. Named fields that are absent, empty, or malformed are skipped silently because they represent missing metadata.

A child `UnirendHead` does not manage warns on its own and is dropped from both the server and the client, so the warning names the element to look for. `UnirendHead` manages only `<title>`, `<meta>`, `<link>`, `<html>`, and `<body>`, whether written directly or inside a fragment. In particular, do not put a `<script>` inside it. Render JSON-LD as a normal `<script type="application/ld+json">` in the component tree instead.

If there is no warning at all, check that the tag is really a child of a `UnirendHead`. A component placed inside one is not walked into, since its tags do not exist until React renders it, so `<SharedMetas />` warns rather than contributing. See [Supported Tags](#supported-tags) for the pattern that does work.

If a loader supplies the JSON-LD, return the structured object in the envelope's `data` rather than `meta.page.tags`. The page can pass the same envelope to `UnirendHead` for metadata and render the script separately:

```tsx
import { useLoaderData } from 'react-router';
import { UnirendHead } from 'unirend/client';
import type { PageSuccessResponse } from 'unirend/api-envelope';

type ProductEnvelope = PageSuccessResponse<{
  structuredData: Record<string, unknown>;
}>;

function ProductPage() {
  const envelope = useLoaderData<ProductEnvelope>();
  const jsonLD = JSON.stringify(envelope.data.structuredData).replace(
    /</g,
    '\\u003c',
  );

  return (
    <>
      <UnirendHead envelope={envelope} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLD }}
      />
      <main>...</main>
    </>
  );
}
```

Replacing `<` prevents a value containing `</script>` from ending the script element early. Because the script sits in the normal component tree, React includes it in the server-rendered page without involving the head collector.

Also check whether an `index.html` meta was replaced by a page tag with the same identity. That is the expected template override behavior, and the template tag returns when no mounted page overrides it. Production builds do not print troubleshooting warnings.

### Supported Tags

| Tag       | Notes                                                           |
| --------- | --------------------------------------------------------------- |
| `<title>` | Sets the page title. Text content is HTML-escaped.              |
| `<meta>`  | Any attributes (`name`, `content`, `property`, `charset`, etc.) |
| `<link>`  | Any attributes (`rel`, `href`, `type`, `sizes`, etc.)           |
| `<html>`  | Sets attributes on the document `<html>` element.               |
| `<body>`  | Sets attributes on the document `<body>` element.               |

On the client, `<title>`, `<meta>`, and `<link>` are natively hoisted by React 19, whereas `<html>` and `<body>` are filtered out from rendering inside the root element and instead applied to the DOM root elements using a client-side stack manager.

Any other child is dropped, on both the server and the client, and produces a development warning naming it. That includes `<script>` and `<style>`: `UnirendHead` does not manage them, and rendering them on the client while the server collected nothing would mean a tag that is absent from the SSR HTML and appears after hydration. Load scripts and stylesheets through your build or `index.html`, or, for third-party tags like analytics and support chat widgets, through the `templateSlots` option documented in [docs/ssr.md](./ssr.md#template-slots).

**Fragments are transparent.** A fragment is not a level of nesting, so the tags inside one are collected as though written in its place, at any depth:

```tsx
<UnirendHead>
  <>
    <title>Home - My App</title>
    <meta name="description" content="Welcome" />
  </>
</UnirendHead>
```

**Components are not walked into.** `<SharedMetas />` has not rendered when the server collects, so there are no tags to read yet. Share tags by giving the component its own `UnirendHead`, which works on both sides, since multiple instances are the normal way to compose:

```tsx
function SharedMetas() {
  return (
    <UnirendHead>
      <meta name="description" content="Welcome" />
    </UnirendHead>
  );
}
```

#### Preloading Images

`<link rel="preload">` is useful for hinting the browser to fetch a hero or above-the-fold image before it is discovered in the page body. It works as a child, and as a `tags` entry when the loader is what knows the URL:

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

When the loader is what knows the URL, the same hint can come from the envelope instead, and the page needs no `UnirendHead` child for it at all:

```ts
pageMetadata: {
  title: 'Hero - My App',
  description: 'Welcome',
  tags: [{ link: { rel: 'preload', as: 'image', href: heroURL } }],
}
```

Unlike `<script>` and `<link>` tags already in your `index.html`, the head content injected by `UnirendHead` is not CDN-rewritten automatically. Prefix asset paths with `useCDNBaseURL()` so the preload hint and the actual image request go to the same origin. A handler building the URL for a `tags` entry has to include the CDN base itself, since it runs on the server where that hook is not available.

### Tag Merging and Overrides

If multiple `<UnirendHead>` components are rendered in the same tree (e.g. in layouts, pages, or nested elements):

- **`<title>`**: **Last-write-wins**. A child component's title overrides a parent component's title.
- **`<html>` and `<body>` non-class attributes (like `lang`)**: **Last-write-wins**. A child component's attribute overrides a parent's attribute.
- **`<meta>` and `<link>`**: **Accumulate**. All tags from all `<UnirendHead>` instances are collected and rendered.
- **`<html>` and `<body>` class names (`class` or `className`)**: **Merge (accumulate)**. If the layout sets `<html className="font-sans" />` and the page sets `<html className="dark" />`, the result is `<html class="font-sans dark">`.
- **`<html>` and `<body>` styles (`style`)**: **Merge (concatenate)**. If both specify styles, they are concatenated together (separated by a semicolon). Because CSS inline rules evaluate in the order they are defined ("last declaration wins"), this allows nested pages/components to safely override specific inline properties from parent templates or layouts. To prevent clobbering external style mutations on the client (such as modal scroll locks), the client parses and reconciles calculated style properties key-by-key, using a lightweight, quote-aware semicolon-splitting parser that safely supports complex style values (like data URLs, calc values, or inline SVGs) without introducing a heavy CSS parser library dependency.

Note the two scopes at work. The table above is about **separate `<UnirendHead>` instances** in the same tree. Within **one** instance, a child beats the `envelope` field with the same key instead of accumulating alongside it, see [Overriding a Single Envelope Field](#overriding-a-single-envelope-field).

### Development-Only Duplicate Warning

Metas and links accumulate across separate `UnirendHead` instances. In development, Unirend warns when two instances emit the same non-repeatable key, such as `description` or `canonical`:

```text
[unirend] UnirendHead: two separate instances declare name=description, so both tags are emitted.
  first:  "Layout description"
  second: "Page description"
  Metas and links accumulate across UnirendHead instances (only <title> is last-write-wins).
  Declare it in one place, or call setRepeatableHeadKeys if this key is meant to repeat.
  This warning only runs in development.
```

The warning ignores titles, repeats within one instance, child overrides, and keys that normally repeat, including `og:image`, `theme-color`, and most link relations. For an application-specific repeatable key, configure it once in code shared by the server and client:

```ts
import { setRepeatableHeadKeys } from 'unirend/client';

setRepeatableHeadKeys(['description', 'og:title']);
```

<!-- prettier-ignore -->
> [!IMPORTANT]
> Call `setRepeatableHeadKeys` from a module imported by both server and client entries. The setting also controls whether a custom `meta.page.tags` entry can render beside a named field with the same key, so it can affect production output.

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

A child tag declared locally overrides the matching tag from the envelope. All other envelope metadata still renders.

`UnirendHead` resolves that merge before collecting or rendering any head tags:

1. It records the keys declared by the component's children. Metas are identified by `name`, `property`, or `http-equiv`, links by `rel`, and `<title>` has its own key.
2. It generates tags for populated `meta.page` fields whose keys are not already claimed. This is why a child overrides the matching envelope field without affecting the rest.
3. It places the generated tags before the children and passes the combined list through the normal `UnirendHead` behavior.

The merge happens the same way during server rendering and in the browser. Both paths therefore collect or render the same tags, with no separate client-side interpretation of the envelope.

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

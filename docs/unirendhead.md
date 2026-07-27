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

Name the envelope type rather than declaring a partial shape of your own, since a partial is not assignable to `PageResponseEnvelope` and so cannot be passed here. The success member is the accurate one, because a page component only renders when its loader succeeded. See [Data Loaders](./data-loaders.md) for the rest of the envelope.

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

Both are optional, so `<UnirendHead>` with children alone is unchanged.

### The `envelope` Prop

Pass the envelope your page data loader already returned and `UnirendHead` renders a tag for every populated `meta.page` field:

```tsx
const envelope = useLoaderData<HomeLoaderEnvelope>();

<UnirendHead envelope={envelope} />;
```

Unirend owns the `PageMetadata` shape, so it also supports the projection to tags. The mapping:

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

Only `page` reaches the head. `app` and `account` are yours to use in application code and are ignored entirely, by name and by value. `page` is read by name too, and the names are `title`, `description`, `keywords`, `canonical`, `og`, and `tags`. `PageMetadata` has no index signature, so an invented key at that level is a type error, and one forced past the type checker still renders nothing because no code looks for it. That is deliberate rather than a limitation: an index signature here would make a mistyped `title` key type-check and ship a meta named after the typo instead of failing the build.

Inside those fields it opens back up, in the two places where a key you choose has a defined meaning. A member of [`og`](#the-og-object) renders as its own `og:`-prefixed property, and an entry in [`tags`](#custom-tags) renders as the tag it spells out.

There are two ways to add a tag of your own. From the page component, declare it as a child. It composes normally, additive alongside the generated ones:

```tsx
<UnirendHead envelope={envelope}>
  <meta name="app-version" content={envelope.meta.app.version} />
</UnirendHead>
```

From the handler, where the page component does not know what the tag will be, use `page.tags`.

#### The `og` Object

`og` is the one place a key you invent does render, because every key under it renders the same way: as its own `og:`-prefixed property. `title`, `description`, and `image` are named on the type so they autocomplete and are checked, and the rest of the OpenGraph vocabulary passes through without Unirend enumerating a spec it does not own:

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

```html
<meta property="og:title" content="A Post" />
<meta property="og:image" content="https://example.com/post.png" />
<meta property="og:type" content="article" />
<meta property="og:url" content="https://example.com/posts/1" />
<meta property="og:locale" content="en_US" />
<meta property="og:image:width" content="1200" />
```

An index signature is safe here in a way it is not at the top level. Under `og` there is one rendering, so an unrecognized key still has a defined meaning. At the top level the fields render differently from each other, `title` as an element and `canonical` as a link, so an unrecognized key there would have no meaning to give it.

The details:

- **`title`, `description`, and `image` render first**, in that order, then the rest in the order the handler wrote them.
- **A key already carrying the prefix is not prefixed twice.** `{ 'og:type': 'article' }` and `{ type: 'article' }` both produce `og:type`, so the two spellings are the same property rather than two different ones. Write whichever reads better, and if you somehow write both, the first one rendered wins and one meta is emitted, not two. Casing does not create a second property either.
- **Members are matched by a child the same way**, so `<meta property="og:type" content="website" />` overrides an `og.type` from the envelope. A child claiming a structured parent takes the members beneath it too: an `og:image` child replaces `og.image` and the `og['image:width']` written next to it, rather than leaving the width measuring the child's picture.
- **The same value rules apply.** A member that is not a populated string renders nothing, and a key that is not a usable property name is skipped.

A property that legitimately repeats, such as a second `og:image` with its own `og:image:width`, cannot be expressed by an object with unique keys. Use [`tags`](#custom-tags) for those, which is a list precisely so repeats are possible. Those entries render alongside the `og` object rather than colliding with it, so the first image can stay in `og.image` where it reads naturally:

```ts
og: { image: 'https://example.com/first.png' },
tags: [
  { meta: { property: 'og:image', content: 'https://example.com/second.png' } },
  { meta: { property: 'og:image:width', content: '1200' } },
],
```

#### Custom Tags

`tags` is the deliberate way in for tags Unirend has no opinion about, so the named fields can stay closed and typo-checked. It is a list of entries, each naming exactly one of `meta` or `link`:

```ts
APIResponseHelpers.createPageSuccessResponse({
  request,
  data,
  pageMetadata: {
    title: 'Home - My App',
    description: 'Welcome',
    tags: [
      { meta: { name: 'app-version', content: '1.2.3' } },
      { meta: { property: 'twitter:card', content: 'summary_large_image' } },
      { link: { rel: 'alternate', href: 'https://example.com/feed.xml' } },
    ],
  },
});
```

```html
<meta name="app-version" content="1.2.3" />
<meta property="twitter:card" content="summary_large_image" />
<link rel="alternate" href="https://example.com/feed.xml" />
```

Naming `meta` or `link` is what tells Unirend which element to render, rather than guessing it from the attributes. The types are exported from `unirend/api-envelope` as `PageMetadataTag`, `PageMetadataMetaTag`, and `PageMetadataLinkTag`, alongside `PageMetadata` and `PageMetadataOpenGraph`, so a handler can build a list separately from the envelope it goes into.

The rules:

- **A `meta` needs `content`, plus `name` or `property`.** A meta with neither identifying attribute could not be overridden by a child or seen by the duplicate warning, so it is skipped. `PageMetadataMetaTag` is a union that requires one of the two, so writing that meta is a build error rather than a tag that quietly never appears.
- **A `link` needs `rel` and `href`.**
- **One entry is one tag.** An entry carrying both a `meta` and a `link` renders neither, because there is no reading of it that recovers which was meant, and picking one would drop the other in silence. `PageMetadataTag` writes the unused kind as `never`, so this too is a build error for a handler using the types. Leaving the other kind out, or setting it to `undefined` or `null`, is the ordinary case and not this one.
- **Any other attribute passes through as written.** `media` on a `theme-color`, `hreflang` on an alternate, `type` and `sizes` on an icon. Casing is kept, since React's own spellings (`crossOrigin`, `referrerPolicy`) warn when lowercased. The exceptions are `name`, `property`, `rel`, `href`, and `content`, which are lowercased so the tag keys the same way however they were written, and two spellings of one attribute collapse to the first, which is the one a browser would keep.
- **A child replaces everything the envelope contributed for its key.** Declare `og:image` as a child and the `og.image` field and every `og:image` entry step aside, however many there were, because a page saying which image it has is an override at any count. Repeatability does not enter into it, and neither does how many tags you declare: the key is either claimed or it is not, so one child `og:image` and five say the same thing. In development the replaced entries warn, counted and named, since a list the handler wrote that is not in the head otherwise reads as a handler bug rather than as your own child doing its job. Replacing a named field alone stays silent, because that is the ordinary way to use the prop.
- **The sub-properties of a structured object go with it.** Matching is by exact key, with one exception: `og:image:width` is its own key, so on exact matching alone it would outlive the `og:image` it belongs to and end up stating the width of the child's picture instead of the one the handler measured. A wrong claim is worse than a missing one, so a child replacing `og:image`, `og:video`, `og:audio`, `twitter:image`, or `twitter:player` takes the `:`-suffixed tags describing it along. Either attribute counts for all five, since OpenGraph documents `property` and Twitter documents `name` but each parser takes the other, and real pages write it both ways. That holds however they were written, as `og` members (`og: { image, 'image:width' }`) or as `tags` entries, since those are two spellings that merge into one set of tags and cannot answer to different rules.
- **Nothing else nests, even when it looks like it.** Those five are written out rather than read off the colon, because the colon does not reliably mean "describes the thing to its left". `og:locale:alternate` is spelled exactly like a sub-property and is not one, it lists the other locales the page exists in, so a child declaring `og:locale` leaves it alone. Same for anything of your own: an `app:config` child has no claim on an `app:config:version` entry. And a sweep only ever runs under the parent a child actually declared, so an `og:video` child never touches the handler's `og:image`.
- **A named field wins over an entry, for single-value keys.** A `{ link: { rel: 'canonical' } }` entry is skipped when the `canonical` field is populated, so the two cannot ship as a pair of canonicals. In development the dropped entry warns, naming the field and both values, since both sides came from the same handler and neither can be read as the intended one.
- **Keys that repeat by nature are exempt from that last one.** An `og:image` entry renders alongside the `og.image` field rather than losing to it, which is what makes a page with several images expressible. Both sides came from the same handler there, so there is no override to read into it, unlike a child. The list is the same one the [duplicate warning](#development-only-duplicate-warning) uses: the repeatable `og:*` properties, `article:*`, `book:*`, `theme-color`, and every link relation except `canonical`, `manifest`, and `amphtml`.
- **Entries do not deduplicate against each other.** Two `rel="alternate"` links, or a light and dark `theme-color` pair, are correct output rather than a duplicate to collapse, which is why `tags` is a list and not a map.
- **Entries render after the named fields**, and children after both.

Two things are dropped rather than rendered, both matched against the lowercased attribute name, because that is how a browser matches them. `HTTP-EQUIV` is an `http-equiv` once the HTML is parsed, so a case-sensitive check would be one the wire opts out of by changing case. `http-equiv` is the first of the two, because it instructs the browser rather than describing the page, and this value arrives over the wire. Left honored, a compromised or buggy handler could return `{ 'http-equiv': 'refresh', content: '0;url=…' }` and navigate the page somewhere else. The attribute is stripped, which leaves a meta carrying only `http-equiv` with no identity, so it drops out entirely. Declare `http-equiv` metas as a `UnirendHead` child, in your own code, where it is not wire-controlled. The others are React's own props (`children`, `dangerouslySetInnerHTML`, `key`, `ref`), `style`, and anything starting with `on`, none of which describe a tag. Two of those would take the page down rather than cost a tag: `children` makes React throw on a void element, and `style` throws because React expects a style object, so the only spelling a handler could send over the wire is the one that fails.

A handler using the types never gets that far. All of those names are typed `never` on `PageMetadataMetaTag` and `PageMetadataLinkTag`, so asking for one is a build error rather than a tag that ships without it, the same way a meta with neither `name` nor `property` is. The stripping above is what happens to a payload that did not go through the types at all, which is every payload, since an envelope arriving over the wire is a promise about its shape rather than a guarantee. That is also why the type lists the readable spellings while the sanitizer matches lowercased: the type is for the handler writing the entry, and the sanitizer is for the wire.

One relation is refused on the same grounds. A `link` whose `rel` names `stylesheet` is skipped whole, because a stylesheet is the one relation the browser fetches and then applies to the document, which is enough to cover the page with something of its own or to read it back out through attribute selectors, and this URL arrives over the wire. Every other relation either describes the page (`canonical`, `alternate`, `icon`) or only warms the cache (`preload`, `modulepreload`, `dns-prefetch`), so those pass through. `rel` is read as the space-separated token list HTML defines it to be and matched lowercased, so `rel="alternate STYLESHEET"` is refused too. Declare a stylesheet as a `UnirendHead` child, or in `index.html`, where the URL is yours.

Everything else follows [Malformed Envelopes](#malformed-envelopes): non-string values are dropped rather than coerced, and an unusable entry costs only itself.

None of that is silent in development. An entry that renders nothing, an attribute stripped from one that otherwise rendered, an entry dropped for colliding with a named field, and the entries a child's key replaced each print one console warning. The first three name the entry's index and what happened, and the last is counted by key, so several entries losing to one child read as one thing to look at:

```text
[unirend] UnirendHead: meta.page.tags[0] (app-version) rendered without its http-equiv and onLoad.
  Envelope tags may not carry http-equiv (it instructs the browser rather than describing the page),
  style (React reads it as an object, so the string form throws),
  React's own props (children, dangerouslySetInnerHTML, key, ref), or on* handlers, and every value must be a string.
  Declare those as a UnirendHead child instead, where they are not wire-controlled.
  This warning only runs in development.
```

The child one reads by key and count instead, since that is the question it answers, and the sub-properties that left with their parent are in the same tally:

```text
[unirend] UnirendHead: 2 meta.page.tags entries for property=og:image were dropped, because a child declares that key.
  dropped: "https://example.com/second.png", "1200"
  A child replaces everything the envelope contributed for its key, and where that key names a
  structured object (og:image, og:video, og:audio, twitter:image, twitter:player), the sub-properties describing it.
  Declare the extra tags as children too, or drop the child, if you meant to keep them.
  This warning only runs in development.
```

The alternative is a tag that is simply not in the head, which is a hard thing to work backwards from when the envelope plainly asked for it. A production build short-circuits before building any of them.

These follow the same lifecycle a [duplicate warning](#development-only-duplicate-warning) does, and for the same reason: both are read off the currently mounted `UnirendHead` instances rather than accumulated as things happen. So a message stays quiet while the same problem is still there, whatever re-renders in between, and it is forgotten along with the page that produced it, so navigating back to that page says so again rather than leaving you with a warning you may have scrolled past. The message names the tag rather than only its index, since `tags[0]` is a different tag on every page and two bad ones at that index are two things to fix.

On the server it is simpler, because a render there is one-shot per request and there is no mounted set to read: the record is scoped to the request instead. Two instances hitting the same mistake, or a subtree React replays for one request, say it once. The next request says it again, which is the same lifecycle the browser has and the reason nothing accumulates: a message names the values involved, and a handler building a `canonical` out of the request path writes a different one every time, so a record kept for the process would print on every request anyway and grow an entry per URL for as long as the server ran.

#### Malformed Envelopes

The envelope came off the wire or out of a hand-written local loader, so it is read defensively rather than trusted to match its type. Every check below is about a **value**, never about which keys are present at the top level. Those keys are fixed, so a `meta.page.foo` is looked for by nothing and becomes nothing. The keys you choose live one level down, in [`og`](#the-og-object) and [`tags`](#custom-tags), and are read exactly as defensively as everything else here. Three checks happen in order, and none of them ever throws:

1. **Is the envelope usable?** An `envelope` that is not an object, or one with no `meta`, no `meta.page`, or a `meta.page` that is a string or an array, produces no tags at all. One level down, an `og` that is not an object and a `tags` that is not an array each contribute nothing without touching the rest of the fields.
2. **Is the value a non-empty string?** Each named field in the table above is checked on its own, and so is each `og` member. A `title` of `123`, `null`, or `{ text: 'Home' }` is skipped, and the empty string counts as absent too. There is no coercion, so a numeric `title` never becomes `"123"` and an object `canonical` never becomes `"[object Object]"`. Inside `tags`, an entry that is not an object, one naming neither `meta` nor `link` or both of them, or one missing a required attribute is skipped on its own.
3. **What is left is rendered.** A bad value only costs you that one tag. If `title` is a number and `description` is a normal string, the description tag is still emitted, and one unusable `og` member or `tags` entry does not take the usable ones with it.

A page that renders without a title beats a page that does not render.

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
  <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
</UnirendHead>
```

Children follow [Supported Tags](#supported-tags), so this is `<title>`, `<meta>`, `<link>`, `<html>`, and `<body>`. A `<script>` is not one of them: the server would not collect it and the client would render it inside the React root, which is a hydration mismatch rather than a tag in the head. JSON-LD does not need to be in the head at all, so render it as an ordinary element in your component tree, where SSR emits it like any other markup.

Keys are matched the same way the rest of `UnirendHead` matches them: metas on `name`, `property`, or `http-equiv` (so `og:*` works), links on `rel`, and a `<title>` child claims the title.

A link's `rel` is the token set HTML defines it to be, so `rel="alternate canonical"` overrides the `canonical` field and collides with another instance's canonical, as a plain `rel="canonical"` would. Only the single-value relations (`canonical`, `manifest`, `amphtml`) are read token by token. A relation that repeats by nature is matched on the whole `rel` as written, so a `rel="alternate icon"` favicon does not go claiming a `rel="alternate"` feed link that has nothing to do with it.

<!-- prettier-ignore -->
> [!IMPORTANT]
> This precedence is **local to a single `<UnirendHead>`**, between its own children and the envelope fields it would emit. It does not reach across the tree and does not change how separate instances relate to each other, which keeps following the rules in [Tag Merging and Overrides](#tag-merging-and-overrides). The merge resolves before anything is collected, so the server and the client both receive the same already-merged child list.

### A Tag Is Not in the Head

`UnirendHead` drops a tag rather than rendering something wrong, and everything it drops it says so about in development. So the first question is not "is this a bug", it is "where is the warning".

**It prints in two places, for two different reasons.** During an SSR or SSG dev render it goes to the server's terminal, once per request that hits it. In the browser it goes to the console, once per `UnirendHead` instance that has the problem, and again if you navigate away and come back. So the same bad envelope usually says so twice, in two windows. If you saw neither, check that you are actually in development: the whole thing short-circuits in a production build and prints nothing at all, by design.

If you are looking at a tag that is not there and no warning was printed, it is one of the deliberate silences below rather than a failure to report:

| Not in the head | Why | Warns |
| --- | --- | --- |
| A named field (`title`, `description`, `canonical`, an `og` member) | Absent, an empty string, or not a string. Unirend never substitutes placeholder text, see [Malformed Envelopes](#malformed-envelopes) | No, this is the normal way to say "no tag" |
| A `tags` entry | Unusable: not an object, naming neither `meta` nor `link` or both of them, a meta with no `content` or no `name`/`property`, a link missing `rel` or `href` | Yes |
| A `tags` entry's `rel="stylesheet"` | Refused, see [Custom Tags](#custom-tags) | Yes |
| One attribute of a tag that otherwise rendered | `http-equiv`, `style`, `on*`, React's own props, a non-string value, or a name HTML would not accept | Yes |
| A `tags` entry whose key a named field already produced | The field wins for single-value keys | Yes |
| A field whose key a child claims, or an `og` member beneath a structured key a child claims | The documented child override, and the intended outcome | No |
| A `tags` entry whose key a child claims, or a sub-property of that key | Same override, but a list the handler wrote is worth accounting for, see [Custom Tags](#custom-tags) | Yes |
| A `<script>`, or any child that is not `<title>`, `<meta>`, `<link>`, `<html>`, or `<body>` | Not collected, see [Supported Tags](#supported-tags) | No |
| A meta from `index.html` | A page declares one of the same identities, so the template's steps aside, see [Overriding a Template Meta](#overriding-a-template-meta) | No, this is the merge working |

The two rows that most often read as a bug are the last two. A `<script type="application/ld+json">` child is ignored on the server, so render JSON-LD as an ordinary element in your tree instead. And a template meta vanishing is the override contract, not a loss: it comes back the moment no page declares it.

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
  Declare it in one place, or call setRepeatableHeadKeys if this key is meant to repeat.
  This warning only runs in development.
```

It is gated on Unirend's dev-mode signal, so a production build short-circuits before any scanning happens and never prints. It fires on the server during an SSR or SSG dev render, and in the browser console in SPA mode and after a client-side navigation.

It is reported per instance. Two pages that each duplicate a layout's `description` are two bugs in two files, so replacing one page with the other says it again rather than treating the second as already covered. The flip side matters just as much: a mistake made entirely by a persistent layout is one mistake however many pages come and go underneath it, so navigating does not repeat it. Both fall out of scoping by the instances involved rather than by the URL, since React keeps a layout's instance across a navigation and gives an unmounted page's replacement a new one. Changing the value a page collides with, from component state say, is still the same instance and the same mistake, and stays quiet. On the server none of this is needed: the record lives on the request, and a request is one route.

What it deliberately stays quiet about:

- **A child overriding an `envelope` field.** That is the documented feature, and it never produces two tags anyway.
- **A duplicate `<title>`.** Last-write-wins is the designed pattern, a layout sets a default and a page overrides it.
- **The same key repeated inside one instance.** Only collisions between separate instances are reported.
- **Keys that legitimately repeat.** `og:image`, `og:video`, `og:audio` (with their `og:image:*` style sub-properties), `og:locale:alternate`, `og:see_also`, `article:tag`, `article:author`, `book:author`, `book:tag`, and `theme-color` (for the light and dark pair). Links are handled the other way round, since most relations repeat by nature: only `canonical`, `manifest`, and `amphtml` are treated as single-value, everything else (`preload`, `icon`, `alternate`, and so on) never warns. Those three are matched as `rel` tokens, so naming one alongside others does not get past the check.

That last list is Unirend's, and it covers the keys that repeat for everyone. For a key that repeats in **your** app, name it once at startup:

```ts
import { setRepeatableHeadKeys } from 'unirend/client';

setRepeatableHeadKeys(['description', 'og:title']);
```

Those keys are then treated exactly as `og:image` is, however many instances declare them. Write the name the way you think of it (`description`, `og:image`, `canonical`); the internal `name=description` form is accepted too. Calling it again replaces the list rather than adding to it, so there is no way to end up with an exemption you cannot find.

<!-- prettier-ignore -->
> [!IMPORTANT]
> Call it from code both entries run, such as your routes module or anything both of them import, and not from the browser entry alone. Despite the `unirend/client` import path, this is not a browser-only setting: it writes module state, so it takes effect only where it is actually called, and the `meta.page.tags` rule below runs during the SSR render too. Named in `entry-client` alone, the server drops a `tags` entry that the browser then keeps, and the HTML a crawler reads is missing a tag the hydrated page has.

This is deliberately app-level rather than a prop on the instances that repeat a key. Which key repeats is a fact about the key, not about a component, and an opt-out attached to a component has to answer "which instance carries it". Past two instances there is no answer that reads well: it would have to go on all but one of them, or one instance would be silencing a collision between two others it has nothing to do with. Naming the key once has neither problem, and it says the thing you actually mean.

The list is read on each check rather than captured when an instance registers, so changing it takes effect on the next render or DOM sync without the instances having to re-render. It also feeds the `meta.page.tags` rule: a key you declare repeatable can appear in `tags` alongside the named field that already produced it, the same way `og:image` can. It has no bearing on a child, which replaces its key whatever the key is.

<!-- prettier-ignore -->
> [!NOTE]
> If a key repeats for everyone rather than only for you, it belongs in Unirend's built-in list instead, so every app gets it. That is a better bug report than a line in your startup file.

The warning itself only runs in development, but that last paragraph is why this is not a development-only call. The `meta.page.tags` rule runs in every build, so a key you name here can change which tags a production page emits. Name a key because it really does repeat, not to quiet something you have not looked at yet.

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

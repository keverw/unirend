# Asset Request Paths

**Status: Proposed advanced SSR feature.** This is reference documentation and an implementation plan, not starter-template guidance. The intended implementation should ship with its own focused demo and tests. It should not alter existing applications unless they explicitly opt in.

## Why This Exists

Some requests are known to be infrastructure requests before the server tries to serve them. A browser asking for `/favicon.ico`, `/robots.txt`, or a built bundle under `/assets/` does not need an individual user's session, permissions, or database-backed profile. Conversely, a missing JavaScript bundle should not incur a complete React server render merely to return an application-branded page that its caller cannot use.

The two capabilities below address those cases without conflating them:

| Capability | Decision it supports | When it is known | What Unirend does automatically |
| --- | --- | --- | --- |
| Static request paths | Whether an individual plugin may skip its own expensive work | At the start of every request | Marks `request.isStaticRequest`; it never skips plugins |
| Static asset 404 page | Whether a failed static-content lookup should avoid React SSR | After a configured static mapping matched but its target was missing | Returns a standalone 404 page only when the per-app handler is configured |

Both are opt-in. With neither option configured, every plugin still runs on every request and a missing static file still falls through to the normal SSR and React 404 behavior.

## Static Request Paths

`staticRequestPaths` is a server-level list of URL patterns that classify requests which are normally safe to handle without person-specific work. Its conceptual API is:

```ts
serveSSRBuilt('./build', {
  staticRequestPaths: ['/favicon.ico', '/robots.txt', '/assets/**'],
  // ...
});

server.fastifyInstance.addHook('onRequest', async (request) => {
  if (request.isStaticRequest) {
    return;
  }

  await loadCurrentUser(request);
});
```

The server decorates every request with `isStaticRequest`, defaulting to `false`, before user plugins run. It evaluates the URL pathname only, never the query string. The patterns should use the repository's existing `picomatch` support so public asset validation and request classification share one familiar glob dialect. Exact paths and glob patterns are both allowed. A pattern must be an absolute URL path, must not contain a query or fragment, and should be validated at startup so a typo cannot silently weaken a plugin's behavior.

`isStaticRequest` is intentionally distinct from the existing `isStaticAsset` decoration:

- `isStaticRequest` is an early declaration. It can be true even if no file exists, static serving is disabled, or another handler answers the request.
- `isStaticAsset` describes an actual static response. It becomes true only when static content is about to be served.

The first property is useful to plugins. The second remains useful to response hooks that need to recognize a static response.

### Plugins Choose Their Own Skip

Matching a static request path must never mean "skip all plugins." Unirend cannot know which plugin is safe to bypass. The framework only exposes the classification; each plugin decides whether to return early.

This distinction is particularly important for multi-tenant SaaS applications:

- Tenant or app selection must still run. A plugin that calls `request.setActiveSSRApp()` identifies which application's assets should be served. Skipping it can select the wrong static cache or leave the intended app unselected.
- Domain validation and other security gates must still run. They are security controls, not user personalization, and are normally cheap.
- Individual-user resolution may skip. Session lookup, permission expansion, profile loading, and database-backed feature flags are usually unnecessary for a favicon or immutable client bundle.

For example, a host-routing plugin should always select the tenant first. A later user-session plugin can then check `request.isStaticRequest` before opening a session. The ordering is part of the application contract and the demo should show it explicitly.

```ts
const selectTenant: ServerPlugin<'ssr'> = (host) => {
  host.addHook('onRequest', async (request) => {
    request.setActiveSSRApp(appForHost(request.hostname));
  });
};

const resolveUser: ServerPlugin<'ssr'> = (host) => {
  host.addHook('onRequest', async (request) => {
    if (request.isStaticRequest) return;
    request.requestContext.user = await findUserFromSession(request);
  });
};
```

Do not use this option for a path whose handler depends on the skipped state. A URL matching `/assets/**` that is actually a tenant-specific authorization check is not a static request merely because it has an asset-like name.

### Intended Scope

Classification belongs in the common server options, so SSR, API, plain-web, and static-web server plugins receive the same request decoration. It is independent of static-content mappings, file existence, the active SSR app, and the current build. This avoids both disk I/O at the start of a request and the unsafe inference that caused the earlier static-content matching design to be rejected.

The implementation should add focused tests for exact paths, glob paths, query strings, default `false`, invalid patterns, user-plugin ordering, and multi-app tenant selection. It must verify that setting this option alone never changes which response is served.

## Static Asset 404 Pages

In production SSR, a configured static-content mapping can match a URL while the mapped file is absent. Today that request falls through to the catch-all SSR route and renders the application's normal React 404 page. That is appropriate for an ordinary unknown route, but it is the wrong response path for a missing script, stylesheet, or image:

- It spends a full SSR render on an infrastructure failure.
- A script or image caller receives HTML that it cannot consume.
- The normal application 404 may open layout dependencies, session work, and branded UI that are irrelevant to an asset fetch.

The proposed per-built-app option is `getStaticNotFoundPage`:

```ts
serveSSRBuilt('./build', {
  getStaticNotFoundPage: async (request, isDevelopment) => {
    return `<!doctype html>
<html lang="en">
  <head><title>404 - Asset Not Found</title></head>
  <body><h1>404 - Asset Not Found</h1></body>
</html>`;
  },
});
```

The handler returns an HTML string, like `get500ErrorPage`, and receives the Fastify request plus the development flag. It returns a `404` response with `Content-Type: text/html; charset=utf-8` and `Cache-Control: no-store`. It is standalone server HTML, not a React render and not hydrated. If the handler throws, Unirend logs the failure and uses its small built-in static 404 page.

The option is available on `serveSSRBuilt()` and `registerBuiltApp()` only. Vite owns static asset serving in HMR mode, so a development SSR server cannot reliably intercept Vite's missing asset response without changing Vite's behavior. The handler still receives `isDevelopment` for consistency and for production servers run with development mode enabled.

### Exact Boundary

This handler runs only when all of the following are true:

1. The request is `GET` or `HEAD`.
2. The selected production SSR app has a static-content cache.
3. That cache's `singleAssetMap` or `folderMap` matched the request pathname.
4. The mapping's target is missing or no longer a regular file.
5. The app configured `getStaticNotFoundPage`.

An ordinary unknown URL, an API miss, a non-GET request, a malformed URL, and a path rejected for traversal or OS-junk protection are not static asset misses. They retain their existing handling. The static cache needs a distinct matched-but-missing result so an unmapped route cannot accidentally take this branch.

This boundary also explains the client-side behavior. A direct browser request for a missing deployed asset gets the standalone server 404. Once the application is loaded and hydrated, React Router continues to own navigation among application routes. A normal application navigation does not normally target an asset directory, and it continues to use the application's usual 404 handling.

### Multi-App Behavior

`getStaticNotFoundPage` follows `get500ErrorPage` and is selected from `request.activeSSRApp`. A host or tenant selection plugin must therefore run before static content handling. The default app supplies the neutral fallback for requests that fail before a tenant is selected. Each registered app can provide its own branded static 404 page.

The handler should not reveal filesystem paths, asset names that are not already in the request URL, tenant existence, or error details. It should use the same CSP-safe standalone-page discipline as `get500ErrorPage`.

## Demo and Documentation Plan

Create one advanced demo, for example `demos/asset-request-paths-demo.ts`, rather than adding this configuration to generated starters. It should use a built SSR fixture with these observable requests:

- An app-selection plugin that always runs and chooses one of two apps.
- A session plugin that records work and skips only when `isStaticRequest` is true.
- A present `/assets/**` file that proves static serving still sees the selected app.
- A mapped-but-missing asset that returns the custom static 404 without calling the React renderer.
- An unknown application route that still renders the normal React 404.
- An API miss that still returns its normal envelope.

The published SSR documentation should gain an "Advanced Asset Request Paths" section that links to this demo and covers the SaaS ordering rule, pattern semantics, the static-404 boundary, and the HMR limitation. `docs/error-handling.md` should add a short distinction between the normal application 404 and this pre-render static asset 404. The README can link to the SSR section, but it should not turn the feature into starter-template configuration.

## Implementation Checklist

- [ ] Add and validate common `staticRequestPaths` options, including request decoration and type augmentation.
- [ ] Reuse the existing glob matcher for pathname-only matching, with unit and type tests.
- [ ] Add the production-only per-app `getStaticNotFoundPage` option and a CSP-safe built-in fallback.
- [ ] Extend the static cache/hook result so SSR can distinguish unmatched paths from matched-but-missing files without extra filesystem work.
- [ ] Add SSR tests for selection, status, headers, handler fallback, ordinary routes, API paths, `HEAD`, static-router disablement, and multi-app selection.
- [ ] Add the focused advanced demo and its runnable package script.
- [ ] Add the SSR and error-handling reference documentation, then a concise `Unreleased` changelog entry when the API ships.

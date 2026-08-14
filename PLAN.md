# `request.trigger404()` — abandon a request into the not-found path

## Context

A single `SSRServer` can host several app bundles (`registerHMRApp` / `registerBuiltApp`, selected per request with `request.setActiveSSRApp`). API handlers and page-data handlers, however, are registered once on the **server** and shared across every bundle, the same way plugins and middleware already are. A handler that belongs to only one bundle is currently reachable from all of them, and anything it answers on the wrong bundle — including a hand-built 404 — is a fact about the deployment that a caller can probe for.

This adds a way for a handler to abandon its request so the server answers **exactly as if no handler had ever been registered** for that route. The property being protected is: within one app bundle, registered and unregistered must be indistinguishable in the response.

Two things make that harder than returning a 404 envelope:

1. An app with a custom `notFoundHandler` must get **its** 404 here too, otherwise the feature becomes distinguishable for precisely the apps that customized it. So the response must route through the existing not-found path, not be rebuilt at the call site.
2. **`SSRServer` never registers a `setNotFoundHandler`** — it only registers `GET '*'` ([ssr-server.ts:1409](src/lib/internal/ssr-server.ts:1409)). Page-data routes are POST, so today an _unregistered_ page type on an SSR server falls through to Fastify's stock `{"message":"Route POST:… not found",…}`, not the envelope from `handleAPINotFound`. Byte-equality is unreachable on the exact path this feature targets until that is fixed.

## Design decisions

- **Return a sentinel, never throw.** `return request.trigger404()` — the `return` carries the control flow, nothing lands in the 500 path or gets logged as an error, and the handler visibly stops.
- **Byte-equality by construction.** One resolver function, called by the framework's not-found handlers _and_ by `trigger404()`. Tests then guard against drift rather than being the only thing holding the two together.
- **Identical on `APIServer` and `SSRServer`.** Both host the same two registries, and an SSR app is routinely pointed at a standalone `APIServer`. Every piece below is installed on both; the only difference is that `request.activeSSRApp` exists only on SSR, so an API server gates on host/header instead.
- **Forgotten `return` fails closed.** If `trigger404()` was called but the handler returned an ordinary value, the 404 wins in both development and production, so the data the handler meant to withhold never ships. Dev and prod responses stay identical, which matters for a feature whose whole point is being indistinguishable.
- **No `console.warn`.** Loudness goes through `request.log`, which every server already has wired to the configured logger. `console.*` is reserved for the client-side code that has no request logger.
- **No registration-time `when` predicate.** Dropped per the user: the request object is already handed to every handler, so the trigger method is enough.
- **Terminology:** docs move to "app bundle" language and an `app-bundles/` layout. No API names change.

---

## 1. Shared not-found resolver — `src/lib/internal/server-utils.ts`

New exported function, modeled on the existing `resolveClosingResponse` ([server-utils.ts:~400](src/lib/internal/server-utils.ts:400)), which already has this exact shape (config + `{request, reply}`, classify, try the handler forms, log and fall through to a default, set `code` + `Cache-Control: no-store`, return the body):

```ts
export interface APINotFoundResolutionConfig {
  handler?: APINotFoundHandlerFn | SplitNotFoundHandler;
  serverLabel: string;
  HelpersClass: APIResponseHelpersClass;
  apiPrefix: string | false;
  pageDataEndpoint: string;
}

export async function resolveAPINotFoundResponse(
  ctx: APINotFoundResolutionConfig & {
    request: FastifyRequest;
    /** Omitted on the SSR internal short-circuit path, which has no HTTP response of its own */
    reply?: FastifyReply;
  },
): Promise<unknown>;
```

Body is the API branch lifted verbatim out of `APIServer.setupNotFoundHandler` ([api-server.ts:802](src/lib/internal/api-server.ts:802)): `classifyRequest` → custom handler (function form, or `split.api` via the existing `isSplitHandler`) called as `(request, isPageData, { APIResponseHelpers })` → `try/catch` logging `Custom not-found handler failed` and falling through → `createDefaultAPINotFoundResponse` → `const statusCode = response.status_code || 404` → when a `reply` was passed, `reply.code(statusCode).header('Cache-Control', 'no-store')` → return the envelope (never `reply.send()`, so `wrapThenable` still sends exactly once).

**Deliberate scope boundary, worth a comment on the type since it is where the two files could drift:** the resolver is API/page-data only and every caller enters it under `isAPI`. Because `classifyRequest` returns `isAPI: false` whenever `apiPrefix === false`, APIServer's plain-web branches (`split.web`, `WebNotFoundHandlerFn`, `generateDefault404NotFoundPage`) are unreachable from here and stay in `api-server.ts`. That precondition is also why no `functionHandlerType` discriminator is needed (unlike `resolveClosingResponse`): inside the resolver a bare function is always an `APINotFoundHandlerFn`.

Rewire the two existing consumers:

- `APIServer.setupNotFoundHandler` — becomes `if (isAPI && this.normalizedAPIPrefix !== false) return resolveAPINotFoundResponse({...})`, with the web branches following verbatim. Case-by-case equivalence holds, including `isAPI && split` carrying only `.web`, which falls through to the default envelope today and still does.
- `SSRServer.handleAPINotFound` ([ssr-server.ts:2609](src/lib/internal/ssr-server.ts:2609)) — a thin wrapper. Its log string changes from `Custom API not-found handler failed` to `Custom not-found handler failed`; nothing asserts it.

Add a small private `notFoundResolutionConfig(): APINotFoundResolutionConfig` to each server so the config is assembled in one place (`options.notFoundHandler` on APIServer, `sharedOptions.APIHandling?.notFoundHandler` on SSRServer).

## 2. Close the SSR not-found gap — `src/lib/internal/ssr-server.ts`

SSR has no not-found handler at all today; the `GET '*'` catch-all does double duty, classifying and then either returning the JSON envelope or rendering React. Phase 2 makes that same split reachable for everything the catch-all does not claim, by **extracting the catch-all's non-API body into a private `handleSSRRequest(request, reply)`** and calling it from both places:

```ts
// setupNotFoundHandler(), registered right after setErrorHandler (ssr-server.ts:976)
const { isAPI } = classifyRequest(
  request.url,
  this.normalizedAPIPrefix,
  this.normalizedPageDataEndpoint,
);

return isAPI && this.normalizedAPIPrefix
  ? this.handleAPINotFound(request, reply) // our 404 config → JSON envelope
  : this.handleSSRRequest(request, reply); // same React render a GET would get
```

One implementation behind both entry points, so the classified path can never drift from the catch-all.

Only requests the catch-all does not match reach it — every non-GET, plus any plugin-route miss. Both currently fall to Fastify's stock `{"message":"Route POST:… not found",…}`. After this:

- `POST /api/v1/page_data/nope` and other non-GET API misses get the envelope — the fix this feature needs.
- `POST /some-page` renders the app's own 404 page, identical to `GET /some-page`. Deliberate behavior change for the changelog.
- Plugin-route misses get classified the same way. Plugins are handed a controlled wrapper over the **root** instance ([ssr-server.ts:2228](src/lib/internal/ssr-server.ts:2228)) rather than being `register`ed into an encapsulated scope, and that wrapper exposes no `setNotFoundHandler`, so every plugin miss lands here and no plugin can shadow it.

**This also fixes a bug that ships today, independent of `trigger404()`.** `reply.callNotFound()` is already first-class inside plugin route handlers: `guardRouteHandler` ([server-utils.ts:572](src/lib/internal/server-utils.ts:572)) gives it a dedicated deferred-action path alongside `reply.redirect()`, and its docblock blesses `return reply.callNotFound(); // ✓`. But on an SSR server there is no not-found handler, so that documented call lands in Fastify's stock JSON 404 — on a server whose entire premise is that 404s render React. A plugin author following the docs gets the wrong response shape today, and the only reason it is rarely noticed is that the `GET '*'` catch-all makes ordinary GET misses unreachable, leaving `callNotFound()` and non-GET as the only ways in.

After this phase it classifies like everything else: an API path gets the envelope, a web path renders the app's 404. Treat it as a fix bullet in the changelog, not just a behavior change.

## 3. The sentinel — new `src/lib/internal/trigger-404.ts`

```ts
export const TRIGGER_404_BRAND: unique symbol =
  Symbol.for('unirend.trigger404');

/** Opaque value returned by `request.trigger404()`. Never construct one yourself. */
export interface Trigger404Signal {
  readonly [TRIGGER_404_BRAND]: true;
}

export const TRIGGER_404_SIGNAL: Trigger404Signal = Object.freeze({
  [TRIGGER_404_BRAND]: true,
});

export function isTrigger404Signal(value: unknown): value is Trigger404Signal;
```

`isTrigger404Signal` must test the **brand property**, not object identity. Combined with `Symbol.for`, that survives the dual ESM/CJS bundles tsup emits and a duplicated `unirend` in a consumer's tree, where `Symbol()` plus `===` would silently stop matching.

Per-request state in the same module, so the flag and the sentinel stay together:

```ts
interface Trigger404InternalState {
  /** True only while a registry wrapper is invoking a handler */
  active: boolean;
  requested: boolean;
}
export function markTrigger404Requested(request): Trigger404Signal; // throws when !active
export function setTrigger404Active(request, active: boolean): void;
export function consumeTrigger404(request): boolean; // reads and clears
```

Both the flag and the sentinel exist on purpose: the sentinel is the typed return value, the flag is the evidence that lets us fail closed on a forgotten `return`.

## 4. Request decoration — both servers

Following the `activeSSRAppInternal` precedent ([ssr-server.ts:783-800](src/lib/internal/ssr-server.ts:783)), in `api-server.ts` near `:298` and `ssr-server.ts` near `:775`:

```ts
this.fastifyInstance.decorateRequest('trigger404Internal', undefined);
this.fastifyInstance.decorateRequest(
  'trigger404',
  function (this: FastifyRequest) {
    return markTrigger404Requested(this);
  },
);
```

A `function`, not an arrow — Fastify puts function decorators on the Request prototype and `this` is the request. No `onRequest` work: state is assigned lazily via `request.setDecorator(...)`, legal because the name was declared with an `undefined` default (Fastify 5 rejects object defaults, which is why the codebase already uses this two-step pattern). Cost is exactly zero for requests that never call it.

**Where it works, and where it doesn't.** The sentinel only means something if a unirend wrapper observes the return value, so `trigger404()` is valid inside API route handlers and page-data handlers on both server types — nowhere else. Called from a plugin hook or a raw plugin route it throws immediately rather than being silently ignored, which is the failure mode worth engineering against:

> `request.trigger404() is only available inside an API route handler or a page data handler. In a plugin route, call reply.callNotFound() instead.`

`StaticWebServer` and `RedirectServer` run no envelope handlers and get no decoration — the same asymmetry `setActiveSSRApp` already has; note it in the JSDoc.

Types in [types.ts](src/lib/types.ts): declare `trigger404: () => Trigger404Signal` in the `declare module 'fastify'` block (`:2761`), with the usage example and the "call it before setting headers or cookies" note. Do **not** declare `trigger404Internal` publicly (`activeSSRAppInternal` isn't either). Widen the two handler return unions additively — `APIRouteHandler` ([api-routes-server-helpers.ts:58](src/lib/internal/api-routes-server-helpers.ts:58)) and `PageDataHandler` ([data-loader-server-handler-helpers.ts:73](src/lib/internal/data-loader-server-handler-helpers.ts:73)) each gain `Trigger404Signal` in both the sync and `Promise` arms — and export `Trigger404Signal` from `src/server.ts`. Existing handlers are unaffected; the one real type-level break is code that _consumes_ a handler return type (`ReturnType<APIRouteHandler>`, a wrapper doing `if (r === false) … else r.status_code`), which now sees an extra union member. Changelog it.

## 5. The three wrapper sites

Each registry gets `setNotFoundResolution(config: APINotFoundResolutionConfig)`, called by both servers just before `registerRoutes` ([api-server.ts:440](src/lib/internal/api-server.ts:440)/`:449`, [ssr-server.ts:1088](src/lib/internal/ssr-server.ts:1088)/`:1098`). That symmetry between the two registries is what keeps them from drifting. A trigger firing while unset throws with `errorCode: 'trigger_404_unconfigured'` — a framework-invariant violation, not a user path.

All three sites wrap the handler call in `setTrigger404Active(request, true/false)` and then run **one shared helper** placed immediately after `await handler(...)` and **before** the `=== false` and `isValidEnvelope` checks — the sentinel is not a valid envelope, so checking later would throw `invalid_handler_response`:

| Result | Behavior |
| --- | --- |
| sentinel, or flag set | Resolve the 404 (below). |
| `false` (already sent) | Existing check unchanged; if the flag was also set, log `trigger_404_after_response_sent`. |
| ordinary value | Existing `isValidEnvelope` path, unchanged. |

Resolving: if `reply.sent || reply.raw.headersSent`, the response is already out — `request.log.error` with `trigger_404_after_response_sent` and return without sending. Otherwise, when the flag was set but the sentinel was **not** returned, log the forgotten-`return` bug (below) and continue anyway — fail closed. Then `return resolveAPINotFoundResponse({ ...this.notFoundResolution, HelpersClass: getAPIResponseHelpersClass(request), request, reply })`, so `wrapThenable` performs the single send exactly like every other branch. `consumeTrigger404` clears the flag so a framework re-entry cannot double-fire.

Sites: [api-routes-server-helpers.ts:295](src/lib/internal/api-routes-server-helpers.ts:295) `wrappedHandler`; [data-loader-server-handler-helpers.ts:207](src/lib/internal/data-loader-server-handler-helpers.ts:207) HTTP `wrappedHandler` (inside the existing `try` — fine, the resolver has its own `try/catch`); and [data-loader-server-handler-helpers.ts:407](src/lib/internal/data-loader-server-handler-helpers.ts:407) `callHandler`, which has no reply, so it calls the resolver without one and returns `{ exists: true, version, result: envelope }`. `ControlledReply` exposes `sent` ([server-utils.ts:903](src/lib/internal/server-utils.ts:903)), so the already-sent guard works there too.

**Forgotten-`return` logging.** No `console.warn`. A single `request.log.error({ errorCode: 'trigger_404_missing_return', route, pageType?, version? }, msg)` in every mode, with a message that names the route, says the handler returned a value instead of returning the signal, says the 404 was served anyway, and shows `return request.trigger404();`. Development additionally gets the offending return value in the log payload; production does not, matching how the codebase already gates error detail on `getDevMode()`.

**Why not `reply.callNotFound()` in the wrappers.** It needs a real `FastifyReply` (handlers only get `ControlledReply`), it does not exist at all on the internal short-circuit path, and it fights the async-return/`wrapThenable` contract `guardRouteHandler` guards ([server-utils.ts:593](src/lib/internal/server-utils.ts:593)). It remains the right answer for raw plugin routes (§2).

## 6. Settled questions

- **Reply already sent / streaming begun.** Cannot be undone. Logged as a handler bug; the response stands.
- **API handlers vs page-data loaders, and `APIServer` vs `SSRServer`.** Identical, because all three sites call the same helper and the same per-registry config, installed the same way on both servers.
- **SSG.** Out of scope, as expected — `localPageDataLoader` handlers never receive a `FastifyRequest`, so `trigger404` does not exist there. Docs say so and point at `createPageErrorResponse` for a local 404.
- **Observability.** Status, body, and headers are identical by construction. Response _timing_ is not: a triggered 404 ran handler code first — document "call it before any expensive work". `request.routeOptions.url` is also set on the trigger path, so an access-log template or `onSend` hook keyed on the route sees the route where a true miss would not; that is server-side only, not visible to the caller.
- **Handler leftovers survive the 404.** Headers and especially cookies set via `reply.setCookie` before `trigger404()` stay on the response, which is a genuine leak against the "never reachable" story. Document "call it first, before setting anything"; a future option could snapshot and restore reply state.
- **SSR internal short-circuit — the honest guarantee.** For an unregistered page type the loader skips `callHandler` and performs a real HTTP fetch, producing a _second_ Fastify request with its own `requestID`/`receivedAt`. So the internal path's guarantee is "the same envelope this server's not-found resolution produces for _this_ request": identical `status`, `status_code`, `type`, `error.code`, `error.message`, page metadata, and any custom-handler or custom-helpers output, differing only in `request_id` and `request_timestamp`. Returning `{ exists: false }` to force the real HTTP fallback was rejected — it re-enters the same route and would invoke the user's handler a second time, side effects included.

## 7. Docs

Terminology pass first: the Multi-App section of [docs/ssr.md:1705](docs/ssr.md:1705) adopts **"app bundle"**, and the Monorepo Structure Tip's layout becomes an `app-bundles/` folder alongside `server/`, matching the real-world structure:

```
src/apps/web-app/
  app-bundles/
    app-a/
    app-b/
  server/
  serve-built.ts
  serve-hmr.ts
```

Build-script and `public-assets.config.json` snippets in that section get the same path shift. `registerHMRApp` / `registerBuiltApp` / `setActiveSSRApp` / `activeSSRApp` are unchanged.

Both examples below rest on the same fact, which the docs should state up front rather than leave implied: **handlers, plugins, and the `APIResponseHelpers` class are server-wide, not per bundle** — the same way middleware already is. That is expected and stays that way; the supported way to tailor per bundle is to branch on `request.activeSSRApp` inside them, which is exactly what these two show.

**1. Gating a handler on the active app bundle**

```ts
server.pageDataHandler.register('dashboard', async (request, reply, params) => {
  if (request.activeSSRApp !== 'app-shell') {
    return request.trigger404();
  }
  // …
});
```

**2. Per-bundle response helpers.** Because the not-found path runs through the configured `APIResponseHelpers` class and that class receives the `request`, a subclass can branch on `request.activeSSRApp` to give each bundle its own titles and error copy — and because `trigger404()` reuses that path, a triggered 404 picks it up with no hook of its own. There is one helpers class per server and no way to register a different one per bundle; branching inside it is the supported path, and now a first-class one. State the boundary explicitly:

> Differing **by app bundle** is fine — the active bundle is already determined by the host the caller chose. What must never differ is **registered vs unregistered within one bundle**, which is the property `trigger404()` exists to protect.

Also: a `trigger404()` reference under the page-data-handler and API-route-handler sections of `docs/ssr.md` (return the sentinel, call it first, forgotten-`return` behavior, already-sent bug, `reply.callNotFound()` for raw plugin routes, not available in SSG); the same for the standalone `APIServer` section, gating on host/header since `activeSSRApp` is SSR-only; the internal short-circuit caveat in [docs/data-loaders.md](docs/data-loaders.md); and the new SSR non-GET 404 behavior in [docs/error-handling.md](docs/error-handling.md). TOCs are regenerated by `bun run update-docs` — do not hand-edit them.

`changelog.md` has no `## Unreleased`; create one at the bottom below `## 0.4.1`. Roughly three bullets: `request.trigger404()`; SSR now answers unmatched non-GET requests through its own not-found path (flag the `POST /web-route` change); the additive widening of the handler return unions.

## 8. Tests

New `src/lib/internal/trigger-404.test.ts` (APIServer, the `serveAPI` + `listen` + `fastifyInstance.inject` pattern from [api-server-methods.test.ts:320](src/lib/internal/api-server-methods.test.ts:320)) and `src/lib/internal/trigger-404-ssr.test.ts` (SSRServer, the real-temp-build fixture from [ssr-server-static-not-found.test.ts:24](src/lib/internal/ssr-server-static-not-found.test.ts:24)).

**Equality harness.** Envelopes carry `request_id` and `request_timestamp`, so pin the first with `getRequestID: () => 'fixed-request-id'` on both servers and normalize the timestamp with a regex on the **raw body string**. Then assert equality of the normalized raw strings — not parsed objects, so key order counts — plus `statusCode`, `content-type`, and `cache-control`. Never assert merely on `404`.

For each cell: server A with the route registered to a handler whose entire body is `return request.trigger404()`, server B identical but the route never registered; inject the same request into both.

| server | shape | config |
| --- | --- | --- |
| APIServer | `GET /api/v1/thing` | default / function-form `notFoundHandler` / split `{ api }` / a handler that throws (fallback path) / custom `APIResponseHelpersClass` |
| APIServer | `POST /api/v1/page_data/thing` | default / custom handler / custom helpers class |
| SSRServer | `GET /api/v1/thing` | default / `APIHandling.notFoundHandler` / custom helpers class |
| SSRServer | `POST /api/v1/page_data/thing` | default / `APIHandling.notFoundHandler` / custom helpers class |

The custom helpers subclass overrides **both** `createAPIErrorResponse` and `createPageErrorResponse` with a marker field, so the page-data rows prove the `isPageData` branch is reached through the shared path. In the custom-handler cells also assert the handler spy was called once with `(request, isPageData, { APIResponseHelpers: CustomClass })` — proving the path really goes through the user's handler rather than reproducing its output.

Behavioral:

- Forgotten `return`: handler triggers then returns a success envelope → body byte-equal to the unregistered baseline, handler data absent, `request.log.error` carries `trigger_404_missing_return`.
- Already sent: handler sends via a validation helper, then triggers and returns `false` → sent response stands, `trigger_404_after_response_sent` logged, no double send.
- Misuse: `trigger404()` from a plugin `onRequest` hook throws the documented message.
- Sentinel: frozen, stable, and `isTrigger404Signal` accepts a structurally-branded clone (the dual-bundle guard).
- **Per-request isolation:** two concurrent injects against a handler that `await`s a deferred before deciding, one triggering and one not — only the triggering request 404s. The regression test for request-scoped state.
- SSR internal short-circuit: a registered page type that triggers during render produces the same 404 envelope, field-by-field excluding `request_id`/`request_timestamp`, as the unregistered page type that falls back to HTTP; assert the rendered HTML reflects the 404 state.
- §2 regressions: `POST /api/v1/page_data/nope` and `DELETE /api/v1/nope` on SSR return the envelope 404, and `POST /some-page` returns the HTML 404 page.
- Drift guard: a `notFoundHandler` returning a distinctive envelope, asserted to appear on the triggered response — plus a comment above `resolveAPINotFoundResponse` pointing at this describe block.
- Unit, in `server-utils.test.ts`: resolver with no `reply` returns the envelope and touches nothing; throwing custom handler logs and falls back; `isAPI` with a split carrying only `.web` yields the default envelope; a custom `status_code` is honored on the reply.
- Type-level `@ts-expect-error` / `satisfies` checks in the style already at the top of `api-server-methods.test.ts`: the sentinel is assignable to both handler return types, and a bare discarded `request.trigger404()` is flagged.
- Update `src/package-exports.test.ts` for the new `Trigger404Signal` export.

## 9. Checked app bundle keys

`request.activeSSRApp` is `string` ([types.ts:2770](src/lib/types.ts:2770)), so the gating pattern this feature exists for — `if (request.activeSSRApp !== 'app-shell')` — silently accepts a typo and fails open, quietly serving the handler to every bundle. Closing that needs the comparison to be checked.

**Why a helper value and not a type declaration.** Typing `activeSSRApp` itself means augmenting Fastify's `FastifyRequest`, which is the only way Fastify types a decorator. That augmentation is global: one bundle list per TypeScript program, shared by every app compiled together. A generic on `SSRServer` does not rescue it either, since middleware and raw plugin routes are handed Fastify's own request type, and that is exactly where bundle selection happens. An exported const has none of that problem — it is scoped like any other module export, so two apps in one repo keep their own lists.

```ts
// apps/marketing/bundles.ts
export const bundles = defineAppBundles('marketing', 'app-shell');

// anywhere in that app
if (!bundles.is(request, 'app-shell')) {
  return request.trigger404();
}

// and at registration, which otherwise takes an unchecked string
server.registerBuiltApp(bundles.key('marketing'), './build-marketing');
```

`is()` takes one key or an array, so a handler shared by several bundles reads like one gated to a single bundle. `'__default__'` is accepted there — the app the server was created with is selectable — and rejected by `key()`, matching `validateAppKey` ([ssr-server.ts:1748](src/lib/internal/ssr-server.ts:1748)), which throws on it at registration.

Nothing about `SSRServer` changes: no threading, no generics, no augmentation, and `activeSSRApp` stays `string`. The helper is additive, so a project that ignores it is unaffected.

This is independently shippable. If the PR gets heavy, it can drop to its own branch without disturbing Phases 1–4.

## Working Agreement

- Branch: `feat/trigger-404`, cut from `main`.
- This plan is copied to `PLAN.md` at the repo root and lives on the branch as the working checklist. Tick boxes as they land, keep notes inline.
- `PLAN.md` is deleted in the final commit, once everything here is implemented and the durable parts have moved into `docs/` and `changelog.md`. It must not survive the merge.

## Phase Checklist

### Phase 0 — Setup ✅

- [x] Cut `feat/trigger-404` from `main`
- [x] Copy this plan to `PLAN.md` at the repo root
- [x] Baseline green: `bun test && bun run type-check && bun run lint` — 3043 pass / 0 fail across 107 files, `tsc --noEmit` and `eslint .` both clean (Aug 13, 2026)

### Phase 1 — Extract the shared resolver (§1) ✅

- [x] Add `APINotFoundResolutionConfig` + `resolveAPINotFoundResponse` to `server-utils.ts`, with the `isAPI`-only precondition comment
- [x] Add `notFoundResolutionConfig()` to `APIServer` and `SSRServer`
- [x] Rewrite `APIServer.setupNotFoundHandler` API branch onto the resolver; leave the web branches verbatim
- [x] Rewrite `SSRServer.handleAPINotFound` as a thin wrapper
- [x] Unit tests in `server-utils.test.ts` (no-reply, throwing handler, split-with-only-`.web`, custom `status_code`, function-form args, custom status code)
- [x] Existing 404 tests still pass unchanged — no behavior change in this phase — 3049 pass / 0 fail (3043 before, +6 new), `type-check` and `lint` clean (Aug 13, 2026)

Notes:

- The `APINotFoundHandlerOption` base (non-generic) alias mirrors `ClosingHandlerOption`, so both servers widen their generic-over-helpers option the same way.
- One subtlety worth remembering for later phases: on an APIServer with API handling **enabled**, a **non-API** miss with the function-form handler still goes through the API envelope branch. That branch is unreachable from the resolver (it only ever runs under `isAPI`), so it stayed in `api-server.ts` verbatim rather than moving.

### Phase 2 — Close the SSR not-found gap (§2) ✅

- [x] Extract the `GET '*'` catch-all's non-API body into a private `handleSSRRequest(request, reply)`; catch-all calls it
- [x] Add `SSRServer.setupNotFoundHandler()`, called right after `setErrorHandler`, classifying to `handleAPINotFound` or `handleSSRRequest`
- [x] Tests: `POST /api/v1/page_data/nope` and `DELETE /api/v1/nope` return the envelope; `POST /some-page` renders the same 404 page as `GET /some-page`
- [x] Test: a plugin-route miss is classified the same way (it reaches the root not-found handler, since plugins get a controlled root wrapper with no `setNotFoundHandler`)
- [x] Test `return reply.callNotFound()` from a plugin route on SSR, both classifications — the bug fix above. Pin today's broken behavior in the test first so the fix is visible in the diff
- [x] Check `APIServer` for the same gap (it has a not-found handler, so `callNotFound()` should already be correct there — confirm, don't assume)
- [x] `## Unreleased` created in `changelog.md` with the not-found fix bullet — 3057 pass / 0 fail (3049 before, +8 new), `type-check` and `lint` clean (Aug 13, 2026)

Notes:

- The classification landed in a third private method, `handleUnmatchedRequest`, called by both the catch-all and the not-found handler. §2 sketched the classification inline in `setupNotFoundHandler`, which would have duplicated it against the catch-all's own copy — the point of the phase is one implementation, so it moved up one level.
- Pinning run before the fix: 6 of the 8 new tests failed, one per case in §2. The two that passed were the APIServer row, confirming it never had the gap, and the matched-route control.
- The catch-all's `// Continue with SSR handling for non-API requests` comment was dropped rather than carried into `handleSSRRequest`, since it described control flow that no longer sits there. Everything else moved verbatim.

### Phase 3 — Sentinel, decoration, wrappers (§3–§5) ✅

- [x] New `src/lib/internal/trigger-404.ts`: `Symbol.for` brand, frozen signal, brand-property `isTrigger404Signal`, per-invocation scope helpers (`active`/`requested` became per-invocation, not per-request — see the note below)
- [x] Decorate `trigger404` on `APIServer` and `SSRServer` (`trigger404Internal` dropped — see the note below)
- [x] `trigger404()` throws outside a handler, with the `reply.callNotFound()` pointer in the message
- [x] `setNotFoundResolution()` on both registries, called by both servers before `registerRoutes`
- [x] Shared post-handler check helper (sentinel / flag / already-sent / forgotten-`return`), used by all three sites
- [x] Hook up `api-routes-server-helpers.ts` `wrappedHandler`
- [x] Hook up `data-loader-server-handler-helpers.ts` HTTP `wrappedHandler`
- [x] Hook up `data-loader-server-handler-helpers.ts` `callHandler` (no reply)
- [x] Forgotten-`return` logging via `request.log.error`, dev-only payload detail, no `console.*`
- [x] Types: `trigger404` in the Fastify augmentation, widen `APIRouteHandler` and `PageDataHandler`, export `Trigger404Signal` from `src/server.ts`, update `package-exports.test.ts`
- [x] `## Unreleased` gains the `trigger404()` bullet and the return-union type break — 3077 pass / 0 fail (3057 before, +20 new), `type-check`, `lint`, and `format:check` clean (Aug 13, 2026)

Notes:

- The resolver needed one addition beyond §1 to serve the internal short-circuit: an optional `classification` override on `resolveAPINotFoundResponse` (and a matching `isPageDataOverride` on `createDefaultAPINotFoundResponse`). That path runs on the SSR page request, whose URL is the web route, so deriving the classification from `request.url` would have produced an API envelope where the HTTP fallback for the same page type produces a page one. Only `callHandler` passes it.
- The two registry unit-test suites build plain-object requests, which have no Fastify `setDecorator`. Rather than making the shipped helper defensive, both mock factories gained a `setDecorator` stand-in.
- On the already-sent path the wrappers return without sending, which skips the existing `=== false` check entirely. That check only exists to catch a handler returning `false` without sending, and here the response demonstrably went out.
- §4's claim that `StaticWebServer` and `RedirectServer` get no decoration is wrong: both are `APIServer` in plain web mode, and the decoration is unconditional, so `request.trigger404` exists on their requests too. It always throws there, which is the right outcome — a plugin on a static server gets the documented error rather than a `TypeError` on a missing property. Pinned by tests, and the JSDoc in `types.ts` states it.
- §3's per-request `active`/`requested` flags could not survive an SSR render. React Router runs its page data loaders in parallel, so several `callHandler()` invocations share one `FastifyRequest` and interleave: the first to finish closed the window on one still awaiting, and a `requested` flag set by one handler could be consumed by another. The state moved to a per-invocation scope carried in `AsyncLocalStorage`, which is the only thing that knows which invocation a `trigger404()` call came from. A stack on the request does not work, since "most recently started" is not "the caller". That also made the `trigger404Internal` decorator unnecessary, so it is gone from both servers and `markTrigger404Requested()` takes no argument. The `trigger404` decoration itself is unchanged in behavior.
- `APIRouteHandler` had to move its async arm from one `Promise` per union member to a single `Promise` over the whole union. A branching async handler infers `Promise<Envelope | Trigger404Signal>`, which no per-member arm accepts, so the feature's primary use case would not have compiled. `PageDataHandler` was already written that way. The old shape also rejected an async handler that returned an envelope on one branch and `false` on another, so this fixes a latent problem too. Sync and async `satisfies` checks for both handler types guard it.

### Phase 4 — Tests (§8) ✅

- [x] Equality harness (`getRequestID` pinned, timestamp normalized, raw-string comparison + status + headers)
- [x] Full matrix: `APIServer` × {API route, page-data} × {default, function-form, split `{api}`, throwing handler, custom helpers class}
- [x] Full matrix: `SSRServer` × {API route, page-data} × {default, `APIHandling.notFoundHandler`, custom helpers class}
- [x] Custom-handler cells assert the spy args `(request, isPageData, { APIResponseHelpers })`
- [x] Forgotten `return`, already-sent, plugin-hook misuse
- [x] Sentinel: frozen, stable, structurally-branded clone accepted
- [x] Per-request isolation under concurrency
- [x] SSR internal short-circuit vs the HTTP fallback, field-by-field
- [x] Drift guard + comment above `resolveAPINotFoundResponse` pointing at it
- [x] Type-level `@ts-expect-error` / `satisfies` checks — 3108 pass / 0 fail (3077 before, +31 new), `type-check`, `lint`, and `format:check` clean (Aug 13, 2026)

Notes:

- The harness lives in a third file, `trigger-404-equality-harness.ts`, because both suites compare responses the same way and a second copy of the comparison is the drift the feature exists to prevent. It is test-only, imports nothing from `bun:test` (the caller passes `expect` in), and is not an entry point in `tsup.config.ts`, so it never reaches `dist/`.
- The `APIServer` matrix runs the full cross rather than §8's table, which gave page-data only three configs. Split and throwing-handler cells cost nothing extra on that shape and the page-data row is where the `isPageData` branch actually matters.
- Coverage over the files this branch touches: `trigger-404.ts` 100% functions / 100% lines, `server-utils.ts` 100% / 99.4%, both registry helpers 100% lines. The last uncovered branch in `trigger-404.ts` was the `trigger_404_unconfigured` throw, now reached directly through `checkTrigger404` since no user path gets to it. The two remaining `server-utils.ts` line gaps (572, 948-949) are in `resolveClosingResponse` and the controlled-reply send guard, both pre-existing and unrelated.
- Unit tests for the resolver: Phase 1 already covered no-reply, function-form args, custom `status_code`, split `.api`, split with only `.web`, and the throwing handler. Phase 4 added only what was missing — the `classification` override, in three cells (default envelope, custom handler, and the same URL without the override to show what it is correcting).
- Two precedence cells beyond §8, both for a trigger that was called but never returned. A handler that returns nothing at all still gets the 404 rather than an empty body — TypeScript rejects that shape, but a JavaScript consumer can write it. And when the handler also returns `false` without having sent anything, two handler-bug detectors overlap: the trigger check runs first, so the request fails closed into the 404 instead of erroring into the `returned false but did not send a response` 500. That ordering is deliberate — the withheld data is what matters, and a 500 would be distinguishable from a genuine miss anyway.
- Three cells beyond §8, covering what the sentinel is _not_. Recognition is on the brand and nothing else, so: a handler returning the signal without ever calling `trigger404()` gets its 404 with no log (the dual-bundle case `isTrigger404Signal` is written for, pinned so it cannot regress into a "missing return" false positive); an unbranded 404-shaped return is not a trigger and fails as `invalid_handler_response`; and a hand-built 404 envelope ships as written, distinguishable from a genuine miss, which is the gap `trigger404()` exists to close. The type-level negatives match: a hand-rolled 404 object, an arbitrary object, and the bare brand symbol are all rejected, so the widening admits exactly one new value.
- **§5's dev-mode gate on the `trigger_404_missing_return` payload survived, and grew to cover four pre-existing sites.** The gate was briefly removed on the reasoning that `invalid_handler_response` already logs the raw return value with no dev gate, so gating only the trigger record would make it the odd one out. A review pass flagged the unguarded payload as a production leak, and a probe settled it: a handler returning `{apiKey, password}` puts both, verbatim, into the configured logger's `err` context in production today, because these errors are serialized wholesale. So the right fix was the opposite of "match the neighbors" — the neighbors were wrong too, and nothing pinned their behavior. New `attachHandlerResponseToError` in `server-utils.ts` is now the single site for this: `handlerResponseType` always, the value only under `getDevMode()`. Wired into `api-routes-server-helpers.ts`, both `data-loader-server-handler-helpers.ts` paths, `web-socket-server-helpers.ts`, and the trigger record. `describeHandlerResult` replaces the old inline `typeof result === 'object' ? 'invalid_object' : typeof result`, so `null` and arrays are now named rather than collapsed. Changelog'd, since it changes what shipped servers log.

### Phase 5 — Checked app bundle keys (§9) ✅

- [x] Add `defineAppBundles()` and the `AppBundles<TKey>` type, exported from `unirend/server`
- [x] `is()` accepts one key or an array, and is a type predicate so a passing check narrows `request.activeSSRApp` to what was checked for; `'__default__'` is comparable but not declarable, matching what `validateAppKey` already does
- [x] `key()` for the registration call, so a typo there is a compile error rather than a runtime throw — and a runtime check too, since `defineAppBundles(...names)` from a `string[]` widens `TKey` to `string` and every literal then type-checks. The reserved key is refused by a conditional type rather than by membership in `TKey`, which is what survives that widening (`Exclude<string, '__default__'>` is still `string`)
- [x] Reject at declaration everything the server would refuse or rewrite at registration — surrounding whitespace, path separators, the reserved key, and duplicates — so a declared list is always registerable, and no declaration can produce a gate that type-checks but can never match
- [x] `## Unreleased` gains the `defineAppBundles()` bullet
- [x] Type tests for the negatives: an undeclared key, an undeclared key inside an array, `'__default__'` at registration, and one app's list not reaching another's
- [x] Runtime tests for what the types cannot catch: empty/reserved/blank declarations, exact comparison, and a request with no active bundle
- [x] `activeSSRApp` stays `string` — nothing in `SSRServer` or `types.ts` changed, and no existing test moved — 3130 pass / 0 fail (3115 before, +15 new), `type-check`, `lint`, `format:check`, `spellcheck`, and `check:null-bytes` clean (Aug 14, 2026)

Notes:

- **This phase was built twice.** The first version followed §9 as originally written: a `UnirendRegister` interface augmented through `declare module 'unirend/server'`. It worked, and it was thrown away, because the augmentation is global in a way that cannot be scoped down — one bundle list per TypeScript program. What settled it was building a two-app scaffold and looking: with `skipLibCheck: true`, which the scaffold sets and which suppresses conflicts reported inside declaration files, two apps declaring their own bundles produced **no error at all**. The declarations merged, one silently won, and which one won depended on the program doing the checking — the root type-check said app A's list while app B's own tsconfig said app B's, giving opposite verdicts on the same line. An editor and a CLI disagreeing about a security gate is worse than either answer being wrong.
- Everything that version needed is gone with it: the `unirend/app-bundles` export subpath and its tsup entry, the `tsconfig` path, the `UnirendRegister` retyping in `types.ts` and `ssr-server.ts`, both type fixtures, the `check:types:bundles` script, and the scaffolded `unirend-env.d.ts`. The helper needs none of it, and `activeSSRApp` is back to `string`, so the diff against `main` for this phase is one new file plus its export.
- The augmentation route also turned up a `TS2717` hazard that outlived it, since the Fastify augmentation is copied into four published declaration files and TypeScript requires every declaration of a property to agree. That is no longer our problem for `activeSSRApp`, but it is still live for `trigger404` — see the finding below.
- `is()` throws rather than returning `false` when the request has no active bundle, which is what an `APIServer` request looks like. Fail-closed is right for a forgotten `return` in a working setup; this is a wiring mistake, and a silent `false` would 404 every gated route with nothing to explain it.

**Fixed here, though it belongs to Phase 3.** `Trigger404Signal` branded with `TRIGGER_404_BRAND: unique symbol`, which is nominal, and each published entry carried its own copy. `skipLibCheck` did not help: it only silences diagnostics inside declaration files, while the nominal split leaks into the consumer's own source, which is always checked. Against a real build, the documented pattern did not compile for a consumer:

```
error TS2322: Type 'Trigger404Signal' is not assignable to type
  'false | Trigger404Signal | PageResponseEnvelope<…> | APIResponseEnvelope<…>'.
```

No plugin import, no augmentation, default settings. `unirend/server` pulls in `unirend/api-envelope`, which carried its own copy of the brand and its own `declare module 'fastify'`, so the merged `trigger404` returned api-envelope's `Trigger404Signal` while `PageDataHandler` expected the server entry's. Nothing in the repo caught it, because every test type-checks against source, where one copy exists.

The brand is now split in two, which is the part worth remembering:

```ts
// Type-level: structural, so every bundle's copy of the interface is one type.
export const TRIGGER_404_BRAND = 'unirend.trigger404' as const;

// Runtime: unexported, so the nominal `unique symbol` never reaches a .d.ts.
const TRIGGER_404_RUNTIME_BRAND: unique symbol =
  Symbol.for('unirend.trigger404');
```

The first version used the string for both, and a review caught what that costs: a string key is representable in JSON, so a handler returning upstream data carrying `"unirend.trigger404": true` was read as the sentinel and sent down the not-found path. Reproduced with a literal `JSON.parse` before fixing. Data choosing the server's control flow is a worse bug than the one being fixed, so the sentinel now carries both brands and `isTrigger404Signal` tests only the symbol, which cannot survive `JSON.parse`. The symbol keeps what `Symbol.for` was chosen for originally — one brand across a duplicated install and across a bundler's separate module instances — and stays out of the published types because nothing exported references it. A hand-built object matching the public interface now fails as an invalid handler response rather than quietly serving a 404, which is the right direction to fail.

The two halves also cover each other's blind spot in the logs. A symbol key does not survive `JSON.stringify`, so a symbol-only sentinel reaching a log sink would be recorded as `{}`; with the string brand it records as `{"unirend.trigger404":true}` and names itself. Hard to reach in practice — the sentinel is not publicly exported, `trigger404()` throws outside a handler scope, and every wrapped site consumes it before anything logs — but `attachHandlerResponseToError` does record handler return values in development, so the legible form is the one worth having there.

The alternative, considered and not taken: give the trigger-404 module its own externalized entry, the way `unirend/context` and `unirend/api-envelope` already work. One declaration across all bundles means a single `unique symbol` can serve both roles, since there is nothing left to be nominal _against_ — one brand that neither JSON nor a hand-built object can fake, with no split to explain. It was rejected for the same reason `unirend/app-bundles` was: a public subpath that exists for a reason no reader of the `exports` map will guess. The dual brand's only real cost is that the published type is satisfiable by an object the runtime rejects, which fails loudly as `invalid_handler_response` and is pinned by a test. Revisit if `Trigger404Signal` ever becomes something users construct or match on, where "the type is satisfiable but the value is not" would stop being a footnote.

Verified after each change by rebuilding `dist/` and type-checking a consumer file that uses `defineAppBundles` and returns `request.trigger404()` from both a `PageDataHandler` and an `APIRouteHandler`, while also importing `unirend/plugins` — clean under `skipLibCheck` both true and false. The same file failed both ways before.

### Phase 6 — Docs and changelog (§7)

- [ ] "App bundle" terminology pass over the Multi-App section of `docs/ssr.md`, including the `app-bundles/` layout, build scripts, and `public-assets.config.json` snippets
- [ ] State up front that handlers, plugins, and `APIResponseHelpers` are server-wide, not per bundle
- [ ] Document `defineAppBundles()` in the Multi-App section, and use the checked form in every example below
- [ ] Document the no-import alternative alongside it: a local `type Bundle = …` union compared with `satisfies`, which catches the same typo with nothing imported and nothing declared globally — `request.activeSSRApp !== ('app-shell' satisfies Bundle)`. Verified to work with `activeSSRApp` as plain `string`. Worth showing because it costs nothing and stays inside one file; the trade is writing `satisfies` at each comparison, no array form, and no check at `registerBuiltApp()`. Say plainly that the helper is the same idea with those three gaps filled, so a reader can pick rather than guess
- [ ] Example 1: gating a handler on the active app bundle
- [ ] Example 2: per-bundle response helpers, with the registered-vs-unregistered boundary stated
- [ ] `trigger404()` reference under the page-data and API-route handler sections, plus the standalone `APIServer` section (gating on host/header)
- [ ] Internal short-circuit caveat in `docs/data-loaders.md`; SSR non-GET 404 change in `docs/error-handling.md`
- [ ] `bun run update-docs` to regenerate TOCs
- [ ] `## Unreleased` in `changelog.md` is written as each phase lands — the SSR not-found fix, `trigger404()`, the production logging change, the return-union break, and `defineAppBundles()`. Before merge, reread the five as one release delta rather than five commits, and consolidate anything that reads as branch history. Nothing is owed for the `Trigger404Signal` brand change: it repaired an API that has never shipped, within the same unreleased cycle, so it is not part of the delta a reader sees

### Phase 7 — Close out

- [ ] `bun test && bun run type-check && bun run lint` green
- [ ] Manual multi-bundle `curl -i` check (below)
- [ ] Delete `PLAN.md`
- [ ] Open the PR as a draft (`gh pr create --draft`)

## Verification

```bash
bun test && bun run type-check && bun run lint
```

Then a manual multi-bundle check: start an SSR demo, register a second bundle, register a handler gated on `request.activeSSRApp`, and confirm with `curl -i` that the gated page-data POST and an unregistered page-data POST return identical bytes (modulo request id and timestamp), both with a default and with a custom `notFoundHandler`.

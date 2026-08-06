# Security headers + CSP plan

Working notes for the `feat/security-headers-csp` branch, committed so the reasoning behind each step is reviewable alongside the code. This file is branch-scoped: fold anything worth keeping into `docs/` and delete it before merging.

## What is left (one item)

Steps 1 through 8 are done, and four of the five follow-ups below have since landed: CSP presets, the inline-attribute warning, `strict-dynamic` documentation, and `ownDomains` for the resolver's HSTS fallback.

One remains, and it is external: reporting the `light-my-request` / Bun `inject()` short-circuit bug upstream. Nothing in this branch depends on it.

Two decisions worth carrying forward from that work:

- **No `strictDynamic: true` convenience.** It is one entry in an array the caller is already writing, and a flag would hide which directive it lands in, which is the thing they need to see. Documented thoroughly instead, including that `'strict-dynamic'` makes supporting browsers ignore host sources in that directive, so the common `["'self'", "'strict-dynamic'", 'https://cdn...']` spelling means different things in old and new browsers.
- **The inline-attribute warning had to span two layers.** Detection belongs in the template pipeline, which cannot see the CSP config; the decision about whether it matters belongs in the plugin, which cannot see the template. Reporting from one and deciding in the other is what makes the warning accurate rather than noise, which was the objection that prompted it.

## Original list, kept for the reasoning

Steps 1 through 8 are done. An audit of every unchecked box found that most were finished and simply never checked off, which is its own lesson about checklists edited in place. Five remain, and none of them block the branch:

- **`strictDynamic` convenience, and slot-injected third-party scripts** (line ~537). The one genuine gap in the CSP feature. An analytics or chat snippet that injects another script at runtime needs `'strict-dynamic'` or every third-party origin listed by hand, and today the docs say neither. Most likely to bite a real user, so it belongs near the top of the slots documentation rather than in a footnote.
- **Warn when slot HTML carries `onclick=` or `style=""`** (line ~531). No hash can cover an attribute, so those silently stop working under a strict policy. Detectable at validation time, where every other slot footgun is already caught.
- **CSP presets** (line ~507). A sane default plus per-directive override, instead of writing every directive out. Convenience only; the config works without it.
- **Refine the resolver's HSTS fallback** (line ~94). Currently sends nothing when a resolver fails, which is never wrong. "Send the baseline only when the host matches a statically configured domain" would be more precise, but needs a notion of which hosts are statically ours that does not exist yet. Revisit if logs show resolvers failing often on first-party hosts.
- **Report the `light-my-request` / Bun `inject()` bug upstream** (line ~140). External, and unrelated to shipping this.

Everything else below is finished. The unchecked items further down are the five listed above.

## Commit 1: rename (done)

`99f700b` — pure rename, no behavior change.

- [x] `cors()` → `securityHeaders()`, `CORSConfig` → `SecurityHeadersConfig`
- [x] `request.applyCORSHeaders()` → `request.applySecurityHeaders()`
- [x] `applyCORSSecurityHeaders()` → `applyUnconditionalSecurityHeaders()`
- [x] Files: `built-in-plugins/security-headers.{ts,test.ts}`, `docs/built-in-plugins/security-headers.md`
- [x] HSTS config errors say "Invalid securityHeaders config" (CORS messages untouched)
- [x] changelog Breaking note, type-check, lint, format, spellcheck, 159 plugin tests pass

Note: `bun test` shows 3 `EADDRINUSE` failures in `router-utils/page-data-loader.test.ts`. Pre-existing port-conflict flake between parallel files, passes in isolation. Not ours, but worth fixing separately.

## Decided: nest CORS under `cors: {}`

Settled by the per-tenant resolver below. A resolver returning a partial override needs blocks to override, so "just the `csp` block" is meaningful where merging twenty flat sibling keys is not.

Do it in the **same** unreleased breaking change as the rename, so users migrate once instead of twice. Deferring it costs a second break for no gain, and this is pre-release.

- [x] `cors: { origin, credentials, methods, allowedHeaders, exposedHeaders, maxAge, preflightContinue, optionsSuccessStatus, allowPrivateNetwork, credentialsAllowWildcardSubdomains, allowCredentialsWithProtocolWildcard }`
- [x] `csp: {}`, `hsts: {}`, `frameOptions` stay top level as siblings of `cors`
- [x] `xFrameOptions` → `frameOptions`, since the `x` prefix only made sense when it sat among CORS keys
- [x] Fold into the single Unreleased breaking bullet, do not add a second one
- [x] `corsOriginAllowed` request property keeps its name. Fine while it is CORS-specific.

## Per-request / per-tenant resolution

Motivating case: a SaaS where customers map their own domain, or get a tenant subdomain.

Current state is asymmetric. `cors.origin` and `cors.credentials` already accept `(origin, request) => boolean | Promise<boolean>`, so CORS is fully per-request today. `hsts` and `xFrameOptions` are static literals with no function form.

That asymmetry is a safety problem, not just an inconsistency. Sending `includeSubDomains` on a customer-owned domain forces HTTPS across every other subdomain they own, including things unrelated to the SaaS, and browsers honor it for the full `max-age` so a later fix cannot revoke it. A domain you do not control needs a shorter `max-age` and no `includeSubDomains` or `preload`. Same reasoning for `frame-ancestors` when a tenant embeds the app, and for CSP when a tenant has their own asset CDN.

Shape: static defaults plus an optional resolver returning a partial override.

```ts
securityHeaders({
  cors: { origin: [...], credentials: [...] },
  csp: { defaultSrc: ["'self'"] },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameOptions: 'DENY',

  resolve: (request) => {
    const tenant = lookupTenant(request.domainInfo.hostname);
    if (!tenant?.isCustomDomain) return null; // null = use defaults unchanged
    return {
      hsts: { maxAge: 86400 },   // domain we do not own
      csp: { imgSrc: [tenant.assetDomain] },
      frameOptions: false,
    };
  },
})
```

No cache key. An earlier draft had a `resolveCacheKey` so header strings could be serialized once per tenant. Dropped deliberately: it makes the caller declare everything the policy depends on, and a resolver that reads something outside the key serves one tenant's policy to another. That is a cross-tenant security bug bought with a performance knob, and what it saves is string concatenation. The expensive part is the caller's own tenant lookup, which they can memoize in their resolver where invalidation is knowable. Revisit only if profiling demands it, and design it properly then.

- [x] `request.domainInfo` (`types.ts:2858`, `hostname` + `rootDomain`) is what a resolver keys off, and it is already populated
- [x] Static defaults keep every existing config-time guard. Do not weaken them by making everything dynamic.
- [x] Validate the resolver's returned policy per request. Correctness first, measure before optimizing.

### Decided: a throwing resolver propagates, like any other hook

Earlier drafts had this failing back to the static defaults, and then had an option to choose between that and throwing. Both are wrong, and the reason is consistency: **a resolver that throws should behave exactly like any other piece of middleware that throws.** It propagates and Fastify turns it into a 500. That is what every user plugin, hook, and route handler in the framework already does, and inventing a special rule for this one callback makes the framework harder to predict for no gain.

It also removes the need for the option entirely. Anyone who would rather degrade than fail can do it in their own resolver, in one line, where they can tell a genuine "no override needed" from "the store is down":

```ts
resolve: (request) => {
  try {
    return lookupTenantPolicy(request.domainInfo.hostname);
  } catch (error) {
    log.error(error);
    return null; // null = use the validated defaults
  }
};
```

That is strictly better than a framework option, because the caller is the only one who can make that judgment, and `null` already means "use the defaults" for the ordinary case.

Note this is **not** inconsistent with the fail-closed callbacks in commit 4. Those decide allow or deny, so "could not decide" has an obviously correct answer and returning it is better than a 500. `resolve` decides nothing about the request; it tailors headers for a request that is otherwise fine. There is no correct answer to substitute, so there is nothing to substitute.

- [x] Let the throw propagate. Log it on the way past, since a stack trace pointing into user code is more useful than a bare 500.

- [x] **The 500 still needs headers, and that is where the care goes.** The error path calls `applySecurityHeaders`, which would invoke `resolve` a second time and throw again inside the handler dealing with the first throw. This is exactly the double fault fixed for the CORS callbacks in commit 4, so it gets the same treatment: mark the request as resolve-failed, and have every later reader use the baseline rather than calling again.

- [x] **The error response sends no HSTS.** Not a preference. The baseline is whatever suits the domains the operator owns, typically a long `max-age` with `includeSubDomains`, and the whole reason a resolver exists is to send something narrower on a domain the operator does not own. Falling back to the baseline on a customer domain would bind it for a year with no way to revoke, which is worse than the 500 that prompted it. `cors`, `csp` and `frameOptions` are safe to fall back on: too strict at worst, and the effect ends with the response.

- [x] Same handling when a resolver returns something that fails validation, which is a bug in the same place with the same consequences.

- [x] Decide whether "send nothing" should instead be "send the baseline only when the request's host matches a statically configured domain". More precise, since a resolver throwing on the operator's own domain then keeps working normally, but it needs a notion of which hosts are statically ours that does not exist yet. Start with send-nothing, which is never wrong, and revisit if the logs say resolvers throw often enough on first-party hosts to matter.
- [x] Decide whether `resolve` can be async. Tenant lookups usually hit a store, so probably yes, which means it must be awaited before headers are applied in `onRequest`.
- [x] Document that `cors.origin` as a function and `resolve` overlap. Prefer `resolve` for per-tenant policy, keep the callbacks for pure origin decisions.

### Late-bound resolver (pattern to support and document)

A resolver that needs a database cannot run at config time, but the plugin must be registered early so its `onRequest` beats everything that might short-circuit. Those two pull in opposite directions.

Resolution: keep them separate. Register the plugin early with a validated static baseline that does no I/O, and let a later-initialized dependency install the real resolver afterward. Until it is installed, the baseline applies. Requests served during startup get the safe defaults rather than nothing.

This is the same fallback the throw and invalid-result cases already need, so it is one mechanism rather than a special case: whenever there is no usable resolver result, the baseline stands.

- [x] Provide a way to install the resolver after registration (setter on the plugin's returned handle, or a mutable ref the caller closes over)
- [x] Document the pattern, since "register early, resolve late" is not obvious and the naive fix is to move the plugin later in the array, which reintroduces the ordering bug this branch exists to fix

## Commit order

Planning is complete. Everything below is specified well enough to implement without further design decisions.

1. **Done** — `99f700b` rename, `afa338b` config nesting
2. **Done** — proxy trust and HSTS transport. `getHost()` / `getProtocol()` and `trustProxyHeaders` deleted, both plugins read Fastify's resolved `request.host` / `request.protocol`, HSTS gated on secure transport. See the notes below for what turned up while doing it.
3. **Done** — static content bypass. `StaticWebServer` registers static serving after user plugins rather than before, matching the SSR server. No new API. A richer detect/serve split was built and rejected; two follow-up branches came out of that. See below.
4. **Done** — order-independent application. `onSend` backstop in the plugin, fill-if-absent, plus HSTS suppressed on a host `domainValidation` disclaimed. The server does not own the policy after all, see below for why.
5. **Done** — throwing callbacks. Fail closed rather than 500, decisions cached so the error path does not re-invoke. Two more callbacks than the list started with, see below.
6. **Done** — error pages under CSP. Anchor instead of inline `onclick`, inline styles hashed, `hashInlineContentForCSP` exported, template updated, changelog tells scaffolded repos to update their own copy.
7. **Done** — CSP. Directive config, `reportOnly`, automatic hashes for unirend's own content and for the app's template and slots, `frameAncestors`/`frameOptions` reconciliation. The JSON data-block behavior is verified in a real browser with a control, not assumed. `strict-dynamic` for third-party widgets is still open, see below.
8. **Per-tenant `resolve`.** Baseline config plus a callback that can rewrite it per request, with the failure handling below. Stays on this branch rather than moving to its own: it is the case that motivated the work, and the nesting in step 1 exists to serve it. Comes after CSP because a resolver returning a `csp` block needs `csp` to exist.

The order below is by dependency, not by size. Step 7 is larger than steps 2 through 6 put together, and splitting it at "emit a validated header" / "hash the app's own content" is reasonable if it wants to land in two pieces.

Steps 3 onward are independent of what has landed so far.

### Notes from implementing step 2

**Fastify rewrites nothing.** Verified by running it: with `trustProxy` on and `x-forwarded-host: evil.com, real.example.com:8443`, `request.headers.host` still holds the raw upstream Host and `request.headers['x-forwarded-host']` still holds the full list, while `request.host`, `request.hostname`, `request.port`, and `request.protocol` are getters returning the resolved values. Both the claim and the verdict stay available, which is what an access log or an audit trail would want. `request.ips` gives the full IP chain; there is no equivalent accessor for hosts, so a caller wanting the chain splits the raw header itself.

Confirms the earlier note that `request.hostname` and `request.port` replace the `parseHostHeader()` split. The plugin still calls `parseHostHeader(request.host)` rather than reading the two separately, because that function also rejects a malformed host, which is what drives the existing 400 path.

**Async hook short-circuit breaks under `inject()` on Bun, and only there.** Corrects an earlier reading of this that blamed Bun as a runtime.

Fastify decides whether a hook ended the request by reading `reply.sent`, which is defined as `this[kReplyHijacked] || this.raw.writableEnded` (`fastify/lib/reply.js:101-107`). Under `app.inject()` on Bun, `writableEnded` is still `false` immediately after `reply.send()` returns, so the chain continues into the route handler and the second send throws `ERR_HTTP_HEADERS_SENT`. On Node it is `true` and the chain stops.

`inject()` uses `light-my-request`, whose `Response` subclasses `http.ServerResponse`, so the gap is in that interaction rather than in Bun's HTTP server. **Against a real listening server, Bun behaves correctly**: `writableEnded` is `true`, the route handler does not run, and the 403 is served. Verified with the same script four ways (Node and Bun, `inject()` and a real socket).

So Bun is fine to run on, and the constraint is narrow: **do not use `app.inject()` to test a short-circuiting hook.** Bind a port and make a real request instead, which is what `static-web-server.test.ts` already does and why its 403 assertions pass under `bun test`. The proxy-trust tests in `domain-validation.test.ts` avoid short-circuiting altogether by allowing every domain and recording what the plugin was handed, which is the right shape for those regardless.

- [ ] Worth reporting upstream to `light-my-request` or Bun. Minimal repro: an `async` `onRequest` hook that calls `reply.send()`, driven by `app.inject()`, with `reply.sent` logged right after.

### Rejected: a detect/serve split with a `request.staticContentMatched` flag

Worth recording, because it was built twice and thrown away twice, and the reasoning is not obvious from the code that survived.

The idea was to split static handling into a match phase before user plugins and a serve phase after them. Matching would set `request.staticContentMatched`, so a gating plugin could reject early **and** an expensive plugin could bail out on assets. Two problems with one change.

It was dropped for three reasons that compound.

**The flag is what the split was for.** Serving after user plugins is what fixes the gating bug, on its own. Take the flag away and the match phase does nothing at all. So the split is not "the fix plus a bonus", it is the fix plus a feature that costs a public request property.

**It could not be uniform.** On SSR the cache that serves is chosen by `request.activeSSRApp`, which a user plugin sets. A unanimity rule ("mark it only when every app's mappings resolve the URL") makes that safe and does work, but the value is thin: assets sit behind a CDN in any real deployment, so what is left is a favicon. A request property that exists on one server type and not another is a smell that outlives whatever it bought.

**Matching is mappings, not existence.** Deliberately, since checking existence is the I/O the early phase exists to avoid. So a mapped-but-missing file is marked and then not served: deleted between deploys, never built, or `updateConfig()` changing mappings between phases. On `StaticWebServer` the fall-through is a static 404 and costs nothing. On SSR it renders a page, without whatever the plugin skipped, and a 404 page can legitimately carry user-specific chrome.

What shipped instead is the one-line version: `StaticWebServer` registers static serving after `options.plugins` rather than before. Same order the SSR server has always used, no new API, no server-specific behavior.

- [x] Both servers now behave identically: user plugins, then static serving
- [x] `staticContent()` plugin untouched, `StaticContentCache` gains no new public method
- [x] Accepted cost: a static asset request runs the app's plugin chain. Uniform across server types, and addressed properly by the skip-list below rather than by inference.

### Follow-up work, moved out of this file

Two related pieces came out of the rejected split, and both belong on their own branch together: URL patterns that plugins may skip, and a dedicated static asset 404. They are planned out in [asset-request-paths-plan.md](asset-request-paths-plan.md), which is deliberately a separate file so it survives this one being deleted at merge.

`RedirectServer` was checked and needs nothing. Its options carry no `plugins` array at all, so its redirect hook is the only plugin and there is no user hook to bypass.

## Commit 3: order-independent application

The bug: headers are only set in the plugin's `onRequest` hook, so anything that short-circuits earlier escapes them entirely. `domainValidation` sends its 403 (`domain-validation.ts:334`), its 400 for a bad Host, and its redirects (`domain-validation.ts:428`) from its own `onRequest`. Listed before `securityHeaders` in the plugins array, none of those responses get any security headers, and today that depends silently on array order.

Correction to an earlier draft of this plan, which used the HTTP→HTTPS redirect as the motivating example. That example was wrong. RFC 6797 §7.2 says a host MUST NOT send HSTS over non-secure transport, and user agents MUST ignore it when received over HTTP, so the HTTP redirect response cannot carry a useful HSTS header at all. The header has to arrive on the HTTPS response after the redirect.

The responses that genuinely lose headers to this bug are the ones already served over HTTPS:

- the 403 for an unauthorized domain, which gets no CORS, no `frameOptions`, and no CSP
- canonical-domain and www redirects that are already HTTPS, which do need HSTS and do not get it
- the 400 for a missing or unparseable Host header

Fix: apply at three points.

- [x] `onRequest` (early) — unchanged, so normal responses and short-circuits after it are covered
- [x] `onSend` (backstop) — fill-if-absent for any security header not already set
- [x] `request.applySecurityHeaders()` — for raw/hijacked paths, which bypass `onSend`. Kept, and it now honors the HSTS suppression below along with everything else, since it shares the same two apply functions.
- [x] Test: `domainValidation` before `securityHeaders` in the array still yields the full header set on the 403
- [x] Test: the reverse order strips HSTS that the early hook had already set
- [x] Test: fill-if-absent leaves a header the short-circuiting responder set itself
- [x] Test: hijacked static file response carries CSP, not just CORS. Moved to commit 7, since there is no CSP to assert on yet.

Fill-if-absent, not overwrite, so a handler that deliberately set its own CSP on one route wins.

### Correction: the plugin owns the backstop, not the server

This plan said the server should own the resolved policy and register the backstop, so it would not depend on user plugin order. The premise was wrong, and checking it is what settled the design.

Hook registration happens once at boot, not per request, and `onSend` runs for every reply Fastify sends regardless of which hook sent it. So an `onSend` hook is already order-independent as long as it is registered on the same instance the responses are served from, and it is: `createControlledInstance` (`server-utils.ts:827`) delegates `addHook` straight to the root Fastify instance rather than going through `register()`, so user plugins are not encapsulated. A plugin listed last registers a hook that covers a response sent by a plugin listed first.

Moving ownership to the server would therefore buy nothing and cost a lot. The server would need its own copy of the `securityHeaders` config surface to have a policy to resolve, which is a second place to configure the same thing, and it would apply headers on servers where the user never asked for the plugin at all.

`RedirectServer` was the one case that looked like it needed a server-owned backstop, and it does not. It accepts no `plugins` option and has no header configuration, so there is no policy to apply and nothing for a backstop to serve. Its redirect stays as it is.

That leaves the shared-helper pattern (`registerClosingResponseHook` and friends) unused here, which is the right outcome rather than a gap: those helpers exist because each server has to install the hook itself, and this one does not.

### Verifying the tests are load-bearing

Ran the new block with the `onSend` registration disabled: 5 failures, all of them in that block, none anywhere else. So each new test fails for the reason it claims to. Worth doing for a fix like this, where a test can pass because the bug is not reachable in the harness rather than because the fix works, which is exactly what the mock-based tests in this file would have done.

### Bug: StaticWebServer serves files before user plugins run

Found while checking how `domainValidation` and the built-in static server interact. This one is an access-control bypass, not a missing header.

`staticContent` registers an `onRequest` hook (`static-content.ts:183`) that hijacks and writes a matched file directly. `StaticWebServer` built its plugin array as `[staticContent(...), ...options.plugins]` (`static-web-server.ts:398`), so the static hook was registered first and ran first.

Consequence: a `domainValidation` passed via `options.plugins` never ran for any request that matched a file, which on a static server is nearly all real traffic. Domain validation, canonical redirects, and HTTPS enforcement were all bypassed for the content itself. Only non-matching paths fell through. The same applied to any user auth or gating plugin.

The `onSend` backstop does not help here. The file is still served to an unauthorized host, just with correct headers on it.

The codebase already knew this pattern mattered: `ssr-server.ts:1020` registers file-upload hooks _after_ user plugins, commented "This ensures user plugin hooks (auth, etc.) run before upload validation." `StaticWebServer` did the opposite.

**Confirmed by reproduction**, not just by reading the code. A `StaticWebServer` with `domainValidation({ validProductionDomains: ['allowed.example.com'] })`, requested with `Host: evil.example.com`:

| Request                              | Result                       |
| ------------------------------------ | ---------------------------- |
| `/` (matches a file in the page map) | **200, file content served** |
| `/no-such-page` (no matching file)   | 403 rejected                 |

So the plugin gated only what the static server did not handle. That reproduction now lives in `static-web-server.test.ts`.

**Fix: register static serving after `options.plugins` instead of before.** Hooks run in registration order, so that is the whole change. It is also the order `SSRServer` has always used (`ssr-server.ts:1147` states the intent explicitly), so this brings the one deviating server in line rather than inventing a convention.

- [x] `StaticWebServer` plugin array becomes `[...options.plugins, staticContent(cache)]`
- [x] `staticContent()` plugin unchanged. Where it sits is already the caller's choice.
- [x] Test: `StaticWebServer` with `domainValidation` rejects a bad host on a request that matches a real file, not only on a 404
- [x] Test: an allowed host still gets the file
- [x] Test: a blocked request is not logged as a served static asset
- [x] `RedirectServer` checked, no user plugins to bypass
- [x] Audited every other built-in registration ahead of user plugins, no second offender (see below)
- [x] Changelog: an access-control bypass, so its own entry rather than folding into the headers work

Accepted cost, stated in the changelog: a static asset request now runs the app's plugin chain. That is what SSR has always done, so both servers behave the same, and the skip-list follow-up below addresses it for every server type at once rather than only for this one.

#### Audit: is anything else registered ahead of user plugins?

Checked all four servers. `StaticWebServer` was the only offender.

Everything `APIServer` installs before `registerPlugins()` (`api-server.ts:389`) either parses a body, decorates the request, or logs: `formbody`, the context-init `onRequest` hook, `registerRequestIDDecoration`, `registerConnectionIPDecoration`, `registerClientInfoResolution`, the access log, and the `reply.hijack()` patch. None of them can end a request. `SSRServer` has the same set at `ssr-server.ts:885-929` and nothing else before `registerPlugins()` at 1017.

Exactly one pre-plugin hook does short-circuit: `registerClosingResponseHook` (`server-utils.ts:513`), which answers 503 while the server is shutting down. That is correct where it is. It serves no content, and gating a shutdown response behind an app plugin would only give a stopping server more work to do.

Routes were checked too, since a Fastify hook only applies to routes registered after it. Every built-in route comes after user plugins: page-data and API routes at `api-server.ts:422` and `431`, WebSocket routes at `443` and `ssr-server.ts:1072`, the SSR catch-all at `ssr-server.ts:1329`. File-upload hooks are explicitly registered after user plugins with a comment saying why. So a user plugin's `onRequest` hook reaches all of them, WebSocket upgrades included.

`RedirectServer` accepts no `plugins` option at all, so its redirect hook is the only one and there is nothing to bypass.

Scope note: this is a different bug from the header work and arguably belongs on its own branch. It is small and closely related, so folding it in is defensible, but it is its own commit and its own changelog entry either way.

### Do not send HSTS on a rejected domain

Raised as "if we reject a domain, why care": mostly right, and it inverts what the backstop should do.

HSTS is the header that seems most important here and is actually **wrong**. `domainValidation` returns 403 precisely because the domain is not one this server claims. Sending `Strict-Transport-Security` on that response sets an HTTPS policy for a domain the operator has just disclaimed, and the browser honors it for the full `maxAge`. Same footgun class as `includeSubDomains` on a customer domain, but worse, because here we have explicitly said the domain is not ours.

**Key the skip on the rejection, not on the status code.** A 403 from the application's own authorization logic, on a domain the server does claim, should get HSTS like any other response. The host is ours, the user simply is not allowed in. Suppressing HSTS on every 403 would strip it from a large share of perfectly normal traffic.

The discriminator is not the status, it is that `domainValidation` determined the host is unclaimed. Only that plugin knows it, so it publishes the fact on the request and the backstop reads it:

- [x] `domainValidation` sets `request.domainValidationRejected` when it rejects a host, and also on the 400 for a missing or unparseable `Host` header, since in that case the host is unknown rather than merely wrong
- [x] Backstop skips HSTS when that marker is present, and applies it normally otherwise
- [x] When `domainValidation` is not registered there is no marker and behavior is unchanged, which matches today
- [x] Declared on `FastifyRequest` in `types.ts` rather than cast inline, since it is a fact worth reading from a user's own hooks for the same reason we read it

**One ordering hazard after all, and skipping is not enough to handle it.** The marker is set before the rejection response is sent and the backstop runs on `onSend`, so the backstop always sees it. But `securityHeaders` may be listed _first_, in which case its `onRequest` already put HSTS on the reply before `domainValidation` had an opinion. Declining to add a header does nothing about a header that is already there.

- [x] So the backstop calls `removeHeader('Strict-Transport-Security')` whenever the marker is set, before the fill-if-absent pass, and that runs whether or not the early hook did. Covered by the reverse-order test.

This is a request decoration publishing a fact, not plugin-to-plugin deferral of the kind rejected for protocol resolution above. The difference is real: protocol is a value both plugins derive from the same input, so the server should compute it once. Whether a host was rejected is knowable only inside `domainValidation`, so publishing it is the only option. Same shape as the existing `corsOriginAllowed` decoration.

- [x] More generally, HSTS should only be sent for a host the server actually serves, which is a stronger condition than "the transport was secure"

What is still worth applying to a 403, in descending order of actual value:

- **CSP**, as defense in depth. The default response is `text/plain` and safe, but `invalidDomainHandler` may return `contentType: 'html'`, and the attacker-controlled `originalDomain` is exactly the kind of value a custom handler would interpolate into it.
- **CORS**, not for security but so a cross-origin caller sees the real 403 instead of an opaque network error. A debuggability win.
- **frameOptions**, marginal on a plain-text 403.

- [x] Document that `invalidDomainHandler` receives an attacker-controlled `domain` string and must escape it when returning `contentType: 'html'`. Unirend sends that content verbatim. Not a bug, but an unmarked sharp edge.

### Bug found while checking the above: HSTS is sent over plain HTTP

`applyUnconditionalSecurityHeaders()` emits `Strict-Transport-Security` whenever `hsts` is configured, without looking at whether the connection is secure. The current docs acknowledge this ("this plugin does not inspect the connection security, enable with care") and push the problem to the user, but RFC 6797 §7.2 is a MUST NOT, so this is a spec violation rather than a configuration preference. It fires on any HTTP request to a deployment with `hsts` set, including a plain-HTTP local run and any setup where the app speaks HTTP behind a TLS-terminating proxy.

Harmless in the sense that browsers ignore it, but it is wrong, it shows up in security scans, and it is trivially avoidable.

- [x] Only emit HSTS when the request arrived over a secure transport

**Do not extract a shared `getProtocol()` helper.** An earlier draft of this plan said to. The better answer is that the decision is already made once, by Fastify, and both plugins should just read it.

The server already forwards `fastifyOptions.trustProxy` to Fastify (`api-server.ts:237`, `ssr-server.ts:681`). With it set, Fastify resolves `request.protocol` and `request.hostname` from the forwarded headers itself, which is exactly what `domainValidation.getProtocol()` reimplements. Its own comment at `domain-validation.ts:174` concedes the point.

The two are not equivalent, and the plugin-level one is weaker:

- `fastifyOptions.trustProxy` accepts `boolean | string | string[] | number | function` (`types.ts:749`), so it can trust specific IPs, subnets, or a hop count, and validates the peer before believing a forwarded header.
- `domainValidation.trustProxyHeaders` is a bare boolean that reads `x-forwarded-proto` and `x-forwarded-host` with no peer validation at all.

That gap is exploitable when the app is reachable directly rather than only through the proxy. Any client can then send `x-forwarded-host` and `x-forwarded-proto` and walk straight past domain validation, since `getHost()` prefers the forwarded value. The blunt boolean is doing real work here and it is the wrong tool.

- [x] `securityHeaders` reads `request.protocol` and needs no proxy option of its own
- [x] Remove `domainValidation.trustProxyHeaders` in favor of `fastifyOptions.trustProxy`, so proxy trust is configured once, in one place, with peer validation. Pre-release, so removal beats deprecation.

  **Why the plugin has its own in the first place:** the history records no rationale, so this is reconstruction. The likely goal was for the plugin to work standalone without requiring server-level config, which is what the fallback comment at `domain-validation.ts:174` reads like: prefer `request.protocol`, which is correct when Fastify is configured, and otherwise read the headers directly. A legitimate goal. The cost is a convenience path that skips peer validation.

  Note that the boolean offers no customization. `getProtocol()` is internal and unexported, and `trustProxyHeaders` is a bare on/off. Fastify's `trustProxy` is the one that takes a predicate function, so moving to it gains flexibility rather than losing it.

  **Preferred resolution: the server resolves it once, before user plugins, and decorates the request.** Both plugins read `request.resolvedProtocol` / `request.resolvedHost`. One config (`fastifyOptions.trustProxy`), one resolution point, no ordering sensitivity, and neither plugin needs a proxy option of its own.

  This is the same architectural move as the ordering fix (the server owns what plugins currently each compute), so it is one idea rather than two. It also preserves the standalone-friendliness that probably motivated `trustProxyHeaders`, because resolution now happens whether or not either plugin is registered.

  Rejected alternatives:
  - **Share `getProtocol()` between the plugins.** Fixes duplication, which is not the problem. It hands the weaker trust model to a second plugin and still leaves two settings that can disagree.
  - **Have `securityHeaders` detect `domainValidation` and defer to it.** Plugin-to-plugin coupling reintroduces the ordering dependency this branch exists to remove.
  - **Defer-and-warn.** Keep the boolean, ignore it when `fastifyOptions.trustProxy` is set, warn at startup otherwise. Non-breaking, but more code and the footgun survives. Fallback only if the break is unwanted.

- [x] Verified: `request.host` keeps the port, `request.hostname` strips it and is IPv6-aware (brackets handled), and `request.port` exists separately. Together they replace the `parseHostHeader()` split, so the earlier port concern is resolved. `request.host` also falls back to HTTP/2 `:authority`, which the hand-rolled version does not.

### Second bug, worse than the first: first-vs-last forwarded entry

Fastify reads the **last** comma-separated entry of `x-forwarded-host` and `x-forwarded-proto` (`getLastEntryInMultiHeaderValue`, `fastify/lib/request.js:96-100`, commented "we use the last one if the header is set more than once"). `domainValidation` reads the **first**, via `.split(',')[0]`, in both `getHost()` (line 195) and `getProtocol()` (line 168).

The ordering is the security property, and first is the wrong end. A client sends `X-Forwarded-Host: evil.com`. A proxy that appends rather than replaces yields `evil.com, real.example.com`. The last entry is what the trusted proxy wrote; the first is attacker-supplied. Reading the first means the bypass works **even behind a correctly configured proxy**, which is a materially larger exposure than the directly-reachable case noted above.

Same shape for the protocol: client sends `X-Forwarded-Proto: https`, proxy appends the real `http`, first-entry logic reads `https`. Result is HSTS emitted over plain HTTP and HTTPS enforcement skipped.

Precondition is a proxy that appends or adds a second header rather than overwriting. Many overwrite (nginx `proxy_set_header` does), so this is not live in every deployment, but it is exactly the case the trust setting exists to handle.

- [x] Migrating to `request.host` / `request.protocol` fixes this for free, since Fastify already reads the correct end. Another reason to delete the hand-rolled pair rather than share it.
- [x] Test: `x-forwarded-host: evil.com, real.example.com` behind a trusted proxy resolves to `real.example.com`
- [x] Test: `x-forwarded-proto: https, http` behind a trusted proxy resolves to `http`, so no HSTS and HTTPS enforcement still fires
- [x] Changelog: this is the security fix that justifies the break on its own. Note that a deployment behind an appending proxy was affected regardless of how carefully it was configured.

### Migration hazard: this can take a proxied site down

Today someone behind nginx, OpenResty, or a CDN can get correct behavior from `trustProxyHeaders: true` alone, having never touched `fastifyOptions`. Remove the boolean and Fastify ignores forwarded headers entirely, falling back to the socket and the `Host` header.

The failure is not subtle. Where the proxy terminates TLS and forwards plain HTTP, Fastify reports `protocol: 'http'`, so `enforceHTTPS` redirects to HTTPS, the proxy forwards HTTP again, and the result is an **infinite redirect loop**. The site is down and the cause is not obvious from the symptom.

`canonicalDomain` has the same shape of failure: without a trusted `x-forwarded-host`, the plugin compares against the internal upstream host rather than the public one, so it redirects to the canonical domain on every request.

This cannot ship as "delete it and mention it in the changelog."

- [x] **No runtime guard.** An earlier draft proposed warning when `enforceHTTPS` was active, `trustProxy` unset, and a request arrived carrying `x-forwarded-proto`. That is unworkable, and the reason is the point of the whole change: with `trustProxy` unset, the header is untrusted input. Any client can send it, so a healthy non-proxied deployment would warn about a misconfiguration that does not exist, and the warning becomes something an outsider can trigger. A false positive under attacker control is worse than no warning.

  The only version surviving that objection is config-only at startup (`enforceHTTPS` on, `trustProxy` unset, no request data), which is deterministic and cannot be triggered externally. Rejected anyway: it misfires for anyone terminating TLS at the app itself, which is legitimate, and a warning people learn to ignore is worse than none.

  Document the failure mode instead, where someone hits it.

- [x] Do **not** suppress the HTTPS redirect either. Deciding to skip it would depend on the same untrusted header.
- [x] ~~Startup warning when a removed `trustProxyHeaders` key is still present~~. Dropped. That is migration scaffolding with a one-release lifespan, and the changelog carries it. Keep the removal clean.

  Worth keeping the two warnings separate when deciding. The deprecation notice is temporary and exists only to bridge this release. The misconfiguration guard above is permanent: `enforceHTTPS` on, `trustProxy` unset, and `x-forwarded-proto` present is a broken deployment whenever it occurs, including for someone who first puts unirend behind a proxy long after this change ships. Following the framework's standard behavior is what makes that failure reachable, since Fastify correctly declines to trust headers nobody vouched for.

### Survey: is anything else doing this?

Checked, and `domainValidation` is the only offender. The one other raw header read in a plugin is `access-control-request-private-network` in `security-headers.ts:912`, a real CORS request header with no Fastify equivalent. `client-info-resolution.ts` and `redirect-server.ts` already defer to Fastify and reference `fastifyOptions.trustProxy` rather than parsing forwarded headers themselves.

So this is bringing one straggler in line with what the rest of the codebase already does, not an architectural change. Nothing else needs the same treatment.

- [x] Changelog needs a migration snippet, not a sentence. Show the before and after side by side.

### Guidance for what to set `trustProxy` to

- Origin reachable only from the proxy (loopback bind, private network, container network): `trustProxy: true` is fine, since no untrusted peer can connect.
- Origin reachable from elsewhere: name the proxy. `trustProxy: '10.0.0.0/8'` or the specific address. A bare `true` here is what lets any client forge forwarded headers.
- CDN in front of the proxy (Cloudflare → OpenResty → app) is more than one hop, so a hop count or the full trusted set is needed. This is also the setup where the first-vs-last bug above is most likely to be live, since more hops means more chance of an appended header.
- nginx and OpenResty with `proxy_set_header X-Forwarded-Proto $scheme` **overwrite** rather than append, so single-hop setups avoid the first-vs-last issue. Worth saying so in the docs, since it tells a reader whether they were exposed.

- [x] Document the above in `docs/built-in-plugins/domainValidation.md`, replacing the current Proxy Support section, which describes the `trustProxyHeaders` behavior being removed
- [x] `docs/https.md` should point at `fastifyOptions.trustProxy` too, since TLS termination is exactly where readers arrive at this problem

Since there is no warning, the docs carry the whole burden. Name the symptom, not just the setting, so someone already looking at a broken deploy can search for it:

- [x] State plainly that `enforceHTTPS` behind a TLS-terminating proxy **requires** `fastifyOptions.trustProxy`, and that without it the result is a redirect loop rather than a subtle misbehavior
- [x] Say the same for `canonicalDomain`, which without a trusted `x-forwarded-host` compares against the internal upstream host and redirects on every request
- [x] Use the words a person would actually search: "redirect loop", "ERR_TOO_MANY_REDIRECTS", "infinite redirect"
- [x] Put it in a GitHub alert block rather than a paragraph, so it survives skim-reading
- [x] Changelog: this is a second breaking change and a security fix. Say plainly that a repo setting `trustProxyHeaders: true` must move to `fastifyOptions.trustProxy`, and that the new setting should name the proxy rather than being a bare `true` wherever the origin is directly reachable.
- [x] Test: `hsts` configured, request over HTTP, header absent
- [x] Test: `hsts` configured, HTTP request behind a trusted proxy sending `x-forwarded-proto: https`, header present
- [x] Test: same forwarded header with no `trustProxy` configured, header absent, since an untrusted header must not be able to turn HSTS on
- [x] Test: the same untrusted-header case against `domainValidation`, confirming a forged `x-forwarded-host` no longer passes domain validation

## Commit 4: throwing callbacks (done)

Config-time validation is well covered. Request-time throws were not covered at all.

- [x] `isOriginAllowed` awaited the user function with no try/catch. Now behind `resolveOriginAllowed`, which denies and logs.
- [x] `areCredentialsAllowed` had the same gap. Now behind `resolveCredentialsAllowed`, which withholds the grant and logs. Not in the original list, found while wrapping the origin one, and the stakes are higher since that header is what lets a cross-origin caller read a response made with the user's cookies.
- [x] `validProductionDomains` same. Rejects with the ordinary 403 and logs.
- [x] Double-fault path closed: both decisions are cached on the request, including the thrown case, so the error path reuses the denial rather than re-invoking the callback that caused it.
- [x] Fail-closed semantics decided as specified: deny, withhold, 403. Never 500.
- [x] Log the callback error once, at the point it is caught. Both plugins read `request.log` defensively, since a failure to log must not become the thing that breaks the response being rescued.

Two things turned up while doing it.

**`invalidDomainHandler` is the fourth callback and was missed by the original list.** It runs on the rejection path, so a throw there 500s a request that had already been correctly refused. It now falls back to the default rejection response. Different fail-closed shape from the others deliberately: the rejection itself is not in question, the handler was only asked to phrase it, so a throw costs the custom wording and nothing else.

**The same handler could hang the request outright.** The send is an `if / else if / else if` over `contentType` with no final `else`, so a handler returning anything outside the three known values matched no branch, sent nothing, and left the client waiting for a response that was never coming. TypeScript rules that out for a typed caller, which is exactly why it needed a runtime arm: the handlers that reach it untyped are the ones that get it wrong. Now falls back to the default response and logs.

**One existing test asserted the old behavior** (`should propagate function-based validation errors`) and was rewritten rather than deleted, since the behavior it covers still matters, just with the opposite verdict.

Not carried over from the original list: nothing. The `resolve` resolver's own fail-closed path is still outstanding, but it belongs with the feature that introduces it rather than here, and it is already written down under the per-tenant section above.

## Commit 5: error pages under CSP (done)

`error-page-utils.ts` used an inline `<style>` block and an inline `onclick="window.location.reload()"`. Any CSP without `unsafe-inline` rendered the 500 page unstyled with a dead button.

- [x] Replace the button with `<a class="ep-btn" href="{escaped request.url}">Refresh Page</a>`. No inline JS at all. Also avoids re-POSTing on a failed POST. Uses `escapeHTMLAttr` rather than `escapeHTML`, since the value lands in a quoted attribute; `request.url` is attacker-controlled.
- [x] SHA-256 the generated style text at module load via `node:crypto` (Node API, not `Bun.*`, per AGENTS.md Runtime Target) and export the hashes as `UNIREND_ERROR_PAGE_STYLE_HASHES`
- [x] Auto-include those hashes in `style-src` when unirend emits its own CSP. Deferred to commit 6, where there is a CSP to put them in.
- [x] Same treatment for the 404 and 503 pages
- [x] The SSR starter template's 500 page (`ssr-get-500-error-page.ts`) has an inline `<style>` block but **no** inline `onclick`, it already uses an `<a>`. So it needed the style handled, not the button.

### Readable output and a matching hash are not a trade-off

Worth writing down, because the first cut got it backwards. Pulling the style text into a constant and emitting `<style>${CONSTANT}</style>` made the hash correct but flattened the rendered page, since the newline and closing indent that used to sit in the markup were gone.

The fix is to keep that whitespace, just move it inside the constant. A digest covers the element's text content byte for byte either way, so the real choice is not between a readable page and a hashable one. It is between hashing what the page actually contains and hashing something adjacent to it. Formatting that lives in the value is covered; formatting that lives in the markup around the interpolation is what silently breaks the match.

So the rule for every one of these, package and template alike: **the constant is the element's text content, verbatim, pretty-printing included, and the markup writes `<style>${CONSTANT}</style>` with nothing in between.**

- [x] Verified end to end for the template by generating the file, importing it, rendering the page, and comparing the exported hash against one recomputed from the delivered `<style>` content. Also confirmed the rendered markup is unchanged: `<style>` on its own line, CSS indented, `</style>` back at four spaces.
- [x] Regression test in `error-page-utils.test.ts` does the same for all four package pages, extracting the delivered content and rehashing it. That is the test that catches a future formatting change breaking CSP silently.

**The scaffolded copy is the harder half.** That file is generated into the user's repo and never overwritten, so an existing scaffolded repo keeps its own copy and unirend cannot fix it from the package. Under a strict `style-src` their 500 page renders unstyled, and it is their file to hash.

- [x] Update the template so new scaffolds are CSP-clean out of the box. It imports the helper rather than embedding a literal hash, deliberately: the file exists to be edited, and a pasted-in hash goes stale the moment someone changes a color.
- [x] Export a small helper so a user can hash their own inline block without hand-rolling `node:crypto` and base64. Without it, "add your own hash" is a paper cut on every scaffolded repo.

  **The helper is exact for this case, precisely because the error page bypasses the format pipeline.** The "hash after serialization" rule exists because cheerio re-serializes template slots and can shift bytes. A custom error page is a raw template string returned straight to the transport, never parsed, so what the function returns is byte-for-byte what the browser receives. Hashing the string directly is correct here, with no pipeline caveat.

  That makes the boundary worth stating plainly in the docs, since it is the difference between a helper that always works and one that silently produces wrong hashes:
  - Raw strings sent directly (error pages) → hash the string, exact
  - Content passing through cheerio (template slots) → hash after serialization, which unirend does internally so users never touch it

- [x] **Changelog must tell scaffolded-repo users to update their own copy**, since re-running `unirend create` will not replace it. Name the file explicitly. This is the kind of thing that is invisible until someone turns CSP on months later and cannot work out why only the error page looks broken.

### Left for commit 6: the template's two script blocks

The plan said the template needed the style handled and not the button, which was right as far as it went and missed that the emitted page also carries two inline `<script>` elements.

- The theme bootstrap script is static, so it hashes exactly like the style block does.
- The one above it assigns `window.__FRONTEND_REQUEST_CONTEXT__` from `JSON.stringify(preference)`, so it **varies per request** and cannot be hashed at all. This is case 3 from the CSP section below, and the JSON data-block technique is the answer.

Both are deliberately left to commit 6 rather than done here. The data block is a convention the framework has to establish in `inject.ts` first; demonstrating it in a generated template beforehand would mean inventing it twice and then reconciling the two. The generator's doc comment says so, so nobody reads the emitted file as already CSP-clean.

Only one of the two reload buttons is actually a problem. `error-page-utils.ts:177` is a raw HTML `onclick="..."` attribute in a server-generated string, which CSP blocks. `starter-templates/templates-shared/react-components/application-error.ts:82` is a JSX `onClick={() => window.location.reload()}`, which React attaches as a JS listener rather than emitting an HTML attribute, so CSP never sees it and it keeps working. Leave the React one alone.

Hashes, not nonces: the style text is deterministic, so it is computed once at module load with no per-request state and no plumbing through render paths.

## Commit 6: CSP itself

### Part one: config, validation, emission (done)

`csp: {}` on `securityHeaders`, validated once at config time and serialized once, since nothing in it varies per request. Landed as its own commit; automatic hashing of the app's own inline content is part two.

- [x] Directive config object, flat keys as the plan's example showed, camelCase mapping to the kebab-case directive names
- [x] Fixed serialization order rather than object-key order, so the same config always produces byte-identical output. Keeps the header stable for caches and lets a test assert the whole string.
- [x] Keyword sources validated against the real list and required to carry their quotes. An unquoted `self` is a valid host name, so it has to be an error rather than a guess.
- [x] Host sources go through `validateConfigEntry` from `lifecycleion/domain-utils`, the same one CORS origins use, after stripping a path it does not understand. Schemes (`data:`, `https:`) and `*` are handled separately, since that validator rejects both.
- [x] `reportOnly`, which is only a change of header name
- [x] Config-time rejection of the footgun set: `'unsafe-inline'` in a script directive without `allowUnsafeInlineScript`, `'unsafe-eval'` without `allowUnsafeEval`, `'none'` combined with other sources, `javascript:` and the other scripting-scheme sources, quoted near-miss keywords, and any source carrying whitespace or `;`/`,` that could rewrite the rest of the policy
- [x] Emitted from `applyUnconditionalSecurityHeaders`, so it inherits the `onSend` backstop and `applySecurityHeaders()` for free. Verified against a real server: a `domainValidation` 403 carries the policy without either plugin knowing CSP exists.
- [x] Unirend contributes `UNIREND_BOOTSTRAP_SCRIPT_HASH` and `UNIREND_ERROR_PAGE_STYLE_HASHES` automatically, **only to directives the caller set**. Adding a hash to an unset `script-src` would create one, which then overrides `default-src` and blocks whatever the caller expected `default-src` to cover.
- [x] `frame-ancestors` overlaps `frameOptions`, now reconciled. See below.

### Part two: hashing the app's own inline content (done)

`processTemplate` returns hashes for the template's inline scripts and styles, slots included, and the SSR renderer contributes them per request through `request.addCSPSources()`. Per app rather than per config, so unlike the rest of the policy they cannot be baked in at startup.

- [x] Hash after serialization, from the final output. Test asserts a hash of the input differs from a hash of the delivered bytes, which is the whole reason this cannot live in the caller's config.
- [x] `addCSPSources` decorated only when a policy is configured. Its absence tells the renderer not to hash at all, so servers not using CSP pay nothing.
- [x] Production hashes once at startup alongside the cached template; development recomputes after Vite's `transformIndexHtml`, which runs after `processTemplate` and adds inline content of its own.
- [x] Rebuilt policies memoized in the shared `LRUCache`, keyed on the sources. One entry per app in production. An LRU rather than a hard cap because the entries worth keeping are the ones that repeat, and a cap would strand them behind whatever churned in first.
- [x] Verified against a real server by parsing both the response body and the response header: every executable inline block in the delivered page is allowed by a hash in the delivered policy.

**A `<style>` inside `<noscript>` was missed at first.** Cheerio parses with scripting enabled, so noscript contents are raw text and the selectors saw nothing in there. A browser with JavaScript disabled parses them as markup, so the style goes live and a strict `style-src` blocks it. The starter template and both demos have one, and the failure is invisible to anyone testing with JavaScript on.

**A slot reusing the data block's ID is now rejected**, the same guard and the same reasoning as the existing container-ID check: the bootstrap finds the block with `getElementById`, so an earlier element with that ID would be read instead and every injected global would be wrong. Other `application/json` blocks are fine, JSON-LD included, since the lookup is by ID rather than by type.

### `frame-ancestors` vs `frameOptions`

`frame-ancestors` supersedes `X-Frame-Options` wherever CSP is supported, so `frameOptions` is a fallback for browsers that would otherwise get no framing policy at all. Setting both is reasonable and common.

The asymmetry is what matters, and a blanket "these disagree" check would have been wrong. A fallback **stricter** than the policy it backs up is fine: `DENY` alongside `frame-ancestors 'self'` means an old browser refuses framing a new one permits, which is the safe direction. A fallback **looser** is not: `SAMEORIGIN` alongside `frame-ancestors 'none'` lets a browser without CSP support allow same-origin framing the policy exists to forbid, and the author has every reason to believe otherwise.

- [x] Reject exactly that one combination at config time. Everything else is left alone, including the deliberate `SAMEORIGIN` plus a partner origin pairing, which is a real pattern and not this code's business to second-guess.

**Two bugs caught by running it rather than reading it**, both of which type-check and both of which fail silently in a browser:

- The `'unsafe-inline'` guard compared the display label (`csp.scriptSrc`) against the directive key (`scriptSrc`), so it matched nothing and the one setting the guard exists for walked straight through. Fixed by keeping the label and the key as separate values.
- Hashes were emitted **unquoted**. `hashInlineContentForCSP` returns the bare expression by design, since a source list has unquoted members too, and the assembler is supposed to add the quotes. Unquoted, `sha256-...` is read as a host name, matches nothing, and the inline content it was meant to allow is blocked with no clue why. There is now a test asserting the quotes are there and that no bare `sha256-` appears.

Both are the same shape: a mistake that produces a well-formed header which quietly does the wrong thing. That is the failure mode this whole feature has to be tested against, so prefer assertions on real response headers over assertions on config objects.

Rich JSON policy rather than a hand-written string. Reuse `validateConfigEntry` / `matchesOriginList` from `lifecycleion/domain-utils` for source lists, so `*.cdn.example.com` and `https://*` parse and get rejected at config time with a real message, matching how CORS origins already behave.

- [x] Directive config object (`defaultSrc`, `scriptSrc`, `styleSrc`, `imgSrc`, `connectSrc`, `frameAncestors`, `reportUri`, …)
- [x] Keyword sources (`'self'`, `'none'`, `'strict-dynamic'`, `'unsafe-inline'`) validated distinctly from host sources
- [x] Presets, so a sane default plus per-directive override beats writing the string by hand
- [x] `reportOnly` mode (`Content-Security-Policy-Report-Only`), essential for rolling this out on a live site
- [x] Config-time rejection of the obvious footgun cases, in the spirit of the existing CORS guards: `'unsafe-inline'` in `script-src` without an explicit opt-in flag
- [x] `frame-ancestors` overlaps `frameOptions`. Warn or reconcile when both are set.

### How hashing actually behaves (researched, not assumed)

- The hash covers the element's text content **exactly as delivered to the client**, byte for byte. No trimming, no normalization. Leading and trailing whitespace, indentation, newlines, and capitalization all change the hash. The `<script>` / `<style>` tags themselves are not included.
- `style-src` supports hashes for inline `<style>` **elements**. Neither `script-src` nor `style-src` hashes cover `onclick=` handlers or `style=""` attributes, which need `'unsafe-hashes'`. That confirms the plan for `bodyPrepend`: warn rather than try to support them.

**Design consequence, and it is not a small one.** The hash must be computed from the final serialized output, never from the input source. `html-utils/format.ts` and `inject.ts` both run content through cheerio, which re-serializes and can alter whitespace. Hashing a user's `headInlineScripts` string as supplied, then letting cheerio reformat it on the way out, produces a hash that does not match what the browser receives and silently blocks the script.

- [x] Compute every hash at the **end** of template processing, reading back the serialized text of each `<script>` / `<style>` node, rather than hashing the input
- [x] Same for error pages: hash the exact substring the generator emits between the tags, including its leading newline and indentation
- [x] Add a test that asserts the emitted hash matches a hash recomputed from the final rendered HTML. This is the regression that catches a future formatting change silently breaking CSP.

### The hash story, and where it runs out

Three sources of inline content, and they do not behave the same way.

1. **Error pages** — static. Hash at module load. Solved in commit 5.
2. **Template slots** — `headInlineScripts` (`types.ts:956`), `bodyPrepend` (`types.ts:965`), and `bodyAppend` (`types.ts:976`). Baked into the processed template and cached per app, with per-request data arriving as globals instead of varying the slot content (`types.ts:937`). So they are static per app and hashable. `html-utils/format.ts` already parses them with cheerio in `validateTemplateSlots()`, so the hashing hooks into a pass that exists.
   - [x] Hash each `headInlineScripts` entry, from the **serialized** output, and add to `script-src`
   - [x] Extract and hash `<script>` / `<style>` elements inside `bodyPrepend` and `bodyAppend` (do not forget `bodyAppend`, which is where analytics snippets most often go)
   - [x] Inline event handler attributes (`onclick=`) and `style=""` attributes in slot HTML cannot be hashed usefully. `unsafe-hashes` is messy and poorly supported. Warn at validation time when CSP is enabled.

   **The slot use case is third-party widgets** (chat, analytics), and those come in three shapes that CSP treats differently:
   - **External only** (`<script src="https://widget.example.com/x.js">`): hashes are irrelevant. This needs a **host source** in `script-src`. Unirend can collect the origin of every external script it finds in a slot and add it automatically, which is a nicer default than making the user restate it.
   - **Inline only**: hash it, per above.
   - **Inline snippet that injects an external script** — the common analytics/chat pattern (Google Analytics, Intercom, and friends). Hashing the snippet is not enough, because the script it injects at runtime is _also_ subject to `script-src`. This is the case `'strict-dynamic'` exists for: a script trusted by hash or by nonce is then trusted to load further scripts. Alternative is listing every third-party origin by hand.
   - [x] Decide whether unirend offers a `strictDynamic: true` convenience, and document plainly that slot-injected third-party scripts need either that or explicit host sources. This is the thing most likely to bite a user, so it belongs near the top of the slots documentation, not in a footnote.

3. **Per-request injected globals** — `inject.ts` used to emit seven inline scripts whose content varied per request (`__lifecycleion_is_dev__`, `__FRONTEND_REQUEST_CONTEXT__`, `__PUBLIC_APP_CONFIG__`, `__CDN_BASE_URL__`, `__DOMAIN_INFO__`, `__UNIREND_TEMPLATE_ATTRS__`, template metas), plus React Router's hydration script. Hashes could not work on any of them, and this looked like the one genuine nonce case. **Solved, not by nonces:** all of it moved into the JSON data block, and the only executable script left is the fixed bootstrap, whose hash is `UNIREND_BOOTSTRAP_SCRIPT_HASH`. See below.

### Avoiding nonces for case 3 (done)

Consolidate the seven into one `<script type="application/json">` data block plus one _static_ bootstrap script that reads it and assigns the globals. A non-executable script type is a CSP data block and is not governed by `script-src`, and the bootstrap script is fixed text so it hashes like everything else. Result: the whole SSR pipeline works under a strict CSP with no nonces anywhere.

Done ahead of the CSP config itself, since the config needs this to exist before it has a `script-src` worth writing.

- [x] **Verified in a real browser, not just from the spec.** A page built by the real pipeline and served with the real plugin under a deliberately strict policy (`script-src 'self'` plus hashes, no `'unsafe-inline'`, no nonce) produced **zero** CSP violations, and every injected global arrived intact: `__PUBLIC_APP_CONFIG__`, `__FRONTEND_REQUEST_CONTEXT__`, `__DOMAIN_INFO__`, the template attrs and metas. The template's own theme script ran (the `dark` class was applied) and a slotted script successfully read `__PUBLIC_APP_CONFIG__`, so the ordering guarantee holds in a browser and not only in a string-index comparison.

  **With a control, because "nothing was blocked" is worthless if the policy was not being enforced.** The same page plus one inline script whose hash was deliberately withheld was blocked, with the browser naming the directive and printing the hash it would have needed:

  ```
  Executing inline script violates the following Content Security Policy directive
  'script-src 'self' 'sha256-oVgG...' 'sha256-lShY...' 'sha256-AEm6...''.
  ```

  Same page, same data block, and the data block was **not** among what it complained about. That is the claim, demonstrated rather than assumed.

- [x] One requirement that comes with it: any `</script` inside the JSON must be escaped, or the element closes early.
- [x] The existing escaping already covered it. Every one of the seven scripts ran `.replace(/</g, '\\u003c')`, so no `<` reaches the output at all, and JSON decodes the escape back on the client. Kept as-is in `serializeContextData`, with a test proving a payload containing `</script><script>alert(1)</script>` cannot break out.
- [x] Consolidating seven script tags into two is a small perf win regardless
- [x] Ordering checked, and the answer is that nothing had to change. `processTemplate` deliberately relocates every head script, the template's own and the slotted ones, to _after_ the context-scripts placeholder (`format.ts:612`), so anything reading a global already ran after the assignments. The data block and bootstrap take exactly the placeholder's position, so the guarantee is preserved rather than re-established.

  Worth recording how nearly this went wrong: the first measurement said the template's theme flash-prevention script ran _before_ the globals were assigned, which would have been a real regression. It was measuring `demos/ssr/index.html` straight from disk, which has no placeholder marker, so `injectContent` took its before-`</head>` fallback. `processTemplate` inserts the marker, and the real pipeline always runs it first. Measuring the wrong half of a two-stage pipeline produces a confident, entirely wrong answer.

- [x] Bootstrap survives a missing or malformed data block rather than throwing. It runs while the head is still parsing, so a throw takes out every later script and turns a data problem into a blank page.
- [x] `UNIREND_BOOTSTRAP_SCRIPT_HASH` exported for the CSP config to feed into `script-src`, computed from the same constant the markup interpolates
- [x] ~~Fallback if the claim does not hold: opt-in nonce mode~~. Not needed, the claim holds.

### Still executable: React Router's hydration script

`inject.ts` relocates `window.__staticRouterHydrationData = JSON.parse("...")` verbatim from the body to the head. That relocation is a **hydration** fix, not a CSP one: React reconciles what it finds inside the container, so a stray script there mismatches. Being outside the root does nothing for `script-src`, which governs every inline script that executes regardless of where it sits in the document.

The two rendering modes are not in the same position, and an earlier note here flattened them into "cannot be hashed", which is only half right:

- **SSG** — the payload is serialized at build time and then never changes, so each prerendered page's script is fixed text. It **can** be hashed, at build time, per page. Verified against `demos/ssg/build/client`: 7 prerendered pages, and each one's script is stable output rather than something regenerated per request.
- **SSR** — `loaderData` carries per-request values, so the script text differs on every response. No hash can cover it, by construction.

This is exactly the split SvelteKit landed on (hashes for prerendered, nonces for dynamic), which is worth knowing before reinventing it.

### Resolved: the payload rides in the same data block (done)

The hydration payload now travels as `routerHydration` in the existing JSON block, and the existing bootstrap assigns `window.__staticRouterHydrationData` from it. No second block, no second script, still one hash for the whole pipeline.

**What made it legal.** The `Do not use $body.html(el)` comment is about cheerio rewriting the bytes, not about where the element sits, and being outside the root is what already makes relocation hydration-safe. Carrying the string verbatim is not re-serializing it. Confirmed against real output: the argument is a JSON string token, so `JSON.stringify(JSON.parse(literal)) === literal` holds exactly, and the characters React Router encoded are the characters the client parses.

**Rejected: hash it per request and put the hash in the header.** It does work for SSR, and a per-response hash is as sound as a nonce. It breaks on the other half. SSG pages are served as hijacked static files that bypass `onSend`, so every prerendered page would need its hash precomputed at build and stored in per-file metadata that does not exist. Two mechanisms instead of one, and a CSP header that can never be set uniformly upstream. Not worth it when the payload can simply stop being executable.

- [x] Extraction refuses anything it does not recognize and emits the script verbatim instead. React Router owns that output and may change it: declining costs only the hash, guessing wrong breaks hydration.
- [x] Bootstrap wraps the parse so a malformed payload cannot take down the assignments that already happened above it.
- [x] Verified on a real SSR page that the only executable inline scripts left are the bootstrap and the app template's own theme script. The latter is static per app and is the template-slot hashing case below.

Do not ship a CSP that quietly needs `'unsafe-inline'` in `script-src` to make the framework's own markup work. That is the SvelteKit trap recorded under prior art, and it makes the feature worse than not having it, since it looks like protection and is not.

## Docs

- [x] Rewrite `docs/built-in-plugins/security-headers.md` around the two jobs (CORS negotiation, non-negotiated headers) instead of CORS with security headers as a footnote
- [x] New CSP section with the hash story and what unirend contributes automatically
- [x] Explain _why_ a `<script type="application/json">` (or `application/ld+json`) data block is not subject to `script-src`: the browser does not execute an unknown script type, so there is nothing for CSP to govern. Worth spelling out rather than presenting as a trick, since a reader who does not know the reason will not trust it, and it is the mechanism the whole no-nonce approach rests on. Mention `application/ld+json` explicitly, since structured data is the case people hit first.
- [x] `docs/https.md` — HSTS guidance belongs next to the TLS setup, not only in the plugin page
- [x] Note the ordering fix in `docs/server-plugins.md`, since the old advice implicitly depended on array order
- [x] Fold the commit-1 changelog Breaking note into one entry describing the final release delta, per AGENTS.md. Do not append a bullet per commit.

## Prior art

Checked what other frameworks ship, to avoid reinventing and to find where the real gap is.

**SvelteKit** is the closest precedent and is ahead of the rest. `svelte.config.js` takes a `csp` block with `mode: 'hash' | 'nonce' | 'auto'` (hashes for prerendered pages, nonces for dynamic ones, nonces on prerendered pages forbidden as insecure) and it generates hashes for its own inline scripts and styles. It also exposes a `%sveltekit.nonce%` placeholder for hand-written tags in `app.html`. So the "framework knows its own inline content" idea is proven rather than speculative.

It doubles as a warning. SvelteKit has open issues where its own framework-generated inline styles cannot be covered ([kit#11747](https://github.com/sveltejs/kit/issues/11747), [kit#9368](https://github.com/sveltejs/kit/issues/9368)), and the docs concede that Svelte transitions emit inline `<style>`, so `style-src` must be left unset or allow `unsafe-inline`. That is exactly the error-page trap identified above: shipping CSP support while the framework's own markup punches a hole through it. Worth catching before shipping rather than after.

**Next.js** has no zero-config story. It is middleware plus a hand-rolled nonce, and the docs state plainly that static pages cannot carry a nonce, since there is no request at build time. That limitation is what the JSON data-block approach sidesteps, because a hash works on static output where a nonce cannot exist.

Not found in any of them:

- CORS, CSP, HSTS, and frame options as one validated configuration. SvelteKit covers CSP only, CORS is left to the user.
- Config-time rejection of unsafe combinations, which the existing CORS guards here already do well
- Per-tenant policy resolution for custom domains
- Coverage of error pages and hijacked responses, which is the part most likely to be missed because it is invisible until it bites

Positioning, honestly: not first to first-class CSP, but first to treat the whole header surface as one thing and to get it right on the paths everyone else forgets.

## Out of scope for this branch

- `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and friends. Easy to add once the application path is order-independent, but they are additive and should not hold up CSP.
- Nonce support for a user's own SSR React output. Opt-in later, not required to ship.

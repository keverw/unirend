# Security headers + CSP plan

Working notes for the `feat/security-headers-csp` branch, committed so the reasoning behind each step is reviewable alongside the code. This file is branch-scoped: fold anything worth keeping into `docs/` and delete it before merging.

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

- [ ] `cors: { origin, credentials, methods, allowedHeaders, exposedHeaders, maxAge, preflightContinue, optionsSuccessStatus, allowPrivateNetwork, credentialsAllowWildcardSubdomains, allowCredentialsWithProtocolWildcard }`
- [ ] `csp: {}`, `hsts: {}`, `frameOptions` stay top level as siblings of `cors`
- [ ] `xFrameOptions` → `frameOptions`, since the `x` prefix only made sense when it sat among CORS keys
- [ ] Fold into the single Unreleased breaking bullet, do not add a second one
- [ ] `corsOriginAllowed` request property keeps its name. Fine while it is CORS-specific.

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

- [ ] `request.domainInfo` (`types.ts:2858`, `hostname` + `rootDomain`) is what a resolver keys off, and it is already populated
- [ ] Static defaults keep every existing config-time guard. Do not weaken them by making everything dynamic.
- [ ] Validate the resolver's returned policy per request. Correctness first, measure before optimizing.
- [ ] **Fail closed to the static defaults and log** when a resolver throws or returns an invalid policy. One broken tenant record degrades that tenant, it does not 500 them. Shares the decision cache with the throwing-callback work below.
- [ ] Decide whether `resolve` can be async. Tenant lookups usually hit a store, so probably yes, which means it must be awaited before headers are applied in `onRequest`.
- [ ] Document that `cors.origin` as a function and `resolve` overlap. Prefer `resolve` for per-tenant policy, keep the callbacks for pure origin decisions.

### Late-bound resolver (pattern to support and document)

A resolver that needs a database cannot run at config time, but the plugin must be registered early so its `onRequest` beats everything that might short-circuit. Those two pull in opposite directions.

Resolution: keep them separate. Register the plugin early with a validated static baseline that does no I/O, and let a later-initialized dependency install the real resolver afterward. Until it is installed, the baseline applies. Requests served during startup get the safe defaults rather than nothing.

This is the same fallback the throw and invalid-result cases already need, so it is one mechanism rather than a special case: whenever there is no usable resolver result, the baseline stands.

- [ ] Provide a way to install the resolver after registration (setter on the plugin's returned handle, or a mutable ref the caller closes over)
- [ ] Document the pattern, since "register early, resolve late" is not obvious and the naive fix is to move the plugin later in the array, which reintroduces the ordering bug this branch exists to fix

## Commit order

Nesting lands next, before the ordering fix, since the ordering work rewrites the same application path and should only be written once against the final config shape. Then: ordering → throwing callbacks → error pages → CSP. Correctness before surface area.

## Commit 3: order-independent application

The bug: headers are only set in the plugin's `onRequest` hook, so anything that short-circuits earlier escapes them entirely. `domainValidation` sends its 403 (`domain-validation.ts:334`), its 400 for a bad Host, and its redirects (`domain-validation.ts:428`) from its own `onRequest`. Listed before `securityHeaders` in the plugins array, none of those responses get any security headers, and today that depends silently on array order.

Correction to an earlier draft of this plan, which used the HTTP→HTTPS redirect as the motivating example. That example was wrong. RFC 6797 §7.2 says a host MUST NOT send HSTS over non-secure transport, and user agents MUST ignore it when received over HTTP, so the HTTP redirect response cannot carry a useful HSTS header at all. The header has to arrive on the HTTPS response after the redirect.

The responses that genuinely lose headers to this bug are the ones already served over HTTPS:

- the 403 for an unauthorized domain, which gets no CORS, no `frameOptions`, and no CSP
- canonical-domain and www redirects that are already HTTPS, which do need HSTS and do not get it
- the 400 for a missing or unparseable Host header

Fix: the server owns the resolved policy, not the plugin. Apply at three points.

- [ ] `onRequest` (early) — unchanged, so normal responses and short-circuits after it are covered
- [ ] `onSend` (backstop) — fill-if-absent for any security header not already set, registered by the server rather than by user plugin order
- [ ] `request.applySecurityHeaders()` — for raw/hijacked paths, which bypass `onSend`. Keep and expand, per the 7 existing call sites in `error-envelope-send.ts` and `static-content-cache.ts`
- [ ] Test: `domainValidation` before `securityHeaders` in the array still yields HSTS on the redirect
- [ ] Test: 500 error page carries the full header set
- [ ] Test: hijacked static file response carries CSP, not just CORS

Fill-if-absent, not overwrite, so a handler that deliberately set its own CSP on one route wins.

### Coverage across server types

`APIServer` (API mode and plain web mode) and `SSRServer` both extend `BaseServer` and have their own `registerPlugins()`. `StaticWebServer` and `RedirectServer` do not extend it, but both construct an `APIServer` internally and pass plugins through (`static-web-server.ts:404`, `redirect-server.ts:261`). So covering the two real servers covers all four surfaces.

- [ ] Follow the existing shared-helper pattern (`registerClosingResponseHook`, `registerClientInfoResolution`, `registerResponseTimeHijackPatch`) rather than duplicating the hook in each server
- [ ] `RedirectServer` is the sharpest case: it registers its redirect as an `onRequest` hook inside the first plugin, so it short-circuits before anything a user registers. The backstop is the only mechanism that reaches it.

### Do not send HSTS on a rejected domain

Raised as "if we reject a domain, why care": mostly right, and it inverts what the backstop should do.

HSTS is the header that seems most important here and is actually **wrong**. `domainValidation` returns 403 precisely because the domain is not one this server claims. Sending `Strict-Transport-Security` on that response sets an HTTPS policy for a domain the operator has just disclaimed, and the browser honors it for the full `maxAge`. Same footgun class as `includeSubDomains` on a customer domain, but worse, because here we have explicitly said the domain is not ours.

**Key the skip on the rejection, not on the status code.** A 403 from the application's own authorization logic, on a domain the server does claim, should get HSTS like any other response. The host is ours, the user simply is not allowed in. Suppressing HSTS on every 403 would strip it from a large share of perfectly normal traffic.

The discriminator is not the status, it is that `domainValidation` determined the host is unclaimed. Only that plugin knows it, so it publishes the fact on the request and the backstop reads it:

- [ ] `domainValidation` decorates the request when it rejects a host, and also on the 400 for a missing or unparseable `Host` header, since in that case the host is unknown rather than merely wrong
- [ ] Backstop skips HSTS when that marker is present, and applies it normally otherwise
- [ ] No ordering hazard: the marker is set in `onRequest` before the response is sent, and the backstop runs on `onSend`, always after
- [ ] When `domainValidation` is not registered there is no marker and behavior is unchanged, which matches today

This is a request decoration publishing a fact, not plugin-to-plugin deferral of the kind rejected for protocol resolution above. The difference is real: protocol is a value both plugins derive from the same input, so the server should compute it once. Whether a host was rejected is knowable only inside `domainValidation`, so publishing it is the only option. Same shape as the existing `corsOriginAllowed` decoration.

- [ ] More generally, HSTS should only be sent for a host the server actually serves, which is a stronger condition than "the transport was secure"

What is still worth applying to a 403, in descending order of actual value:

- **CSP**, as defense in depth. The default response is `text/plain` and safe, but `invalidDomainHandler` may return `contentType: 'html'`, and the attacker-controlled `originalDomain` is exactly the kind of value a custom handler would interpolate into it.
- **CORS**, not for security but so a cross-origin caller sees the real 403 instead of an opaque network error. A debuggability win.
- **frameOptions**, marginal on a plain-text 403.

- [ ] Document that `invalidDomainHandler` receives an attacker-controlled `domain` string and must escape it when returning `contentType: 'html'`. Unirend sends that content verbatim. Not a bug, but an unmarked sharp edge.

### Bug found while checking the above: HSTS is sent over plain HTTP

`applyUnconditionalSecurityHeaders()` emits `Strict-Transport-Security` whenever `hsts` is configured, without looking at whether the connection is secure. The current docs acknowledge this ("this plugin does not inspect the connection security, enable with care") and push the problem to the user, but RFC 6797 §7.2 is a MUST NOT, so this is a spec violation rather than a configuration preference. It fires on any HTTP request to a deployment with `hsts` set, including a plain-HTTP local run and any setup where the app speaks HTTP behind a TLS-terminating proxy.

Harmless in the sense that browsers ignore it, but it is wrong, it shows up in security scans, and it is trivially avoidable.

- [ ] Only emit HSTS when the request arrived over a secure transport

**Do not extract a shared `getProtocol()` helper.** An earlier draft of this plan said to. The better answer is that the decision is already made once, by Fastify, and both plugins should just read it.

The server already forwards `fastifyOptions.trustProxy` to Fastify (`api-server.ts:237`, `ssr-server.ts:681`). With it set, Fastify resolves `request.protocol` and `request.hostname` from the forwarded headers itself, which is exactly what `domainValidation.getProtocol()` reimplements. Its own comment at `domain-validation.ts:174` concedes the point.

The two are not equivalent, and the plugin-level one is weaker:

- `fastifyOptions.trustProxy` accepts `boolean | string | string[] | number | function` (`types.ts:749`), so it can trust specific IPs, subnets, or a hop count, and validates the peer before believing a forwarded header.
- `domainValidation.trustProxyHeaders` is a bare boolean that reads `x-forwarded-proto` and `x-forwarded-host` with no peer validation at all.

That gap is exploitable when the app is reachable directly rather than only through the proxy. Any client can then send `x-forwarded-host` and `x-forwarded-proto` and walk straight past domain validation, since `getHost()` prefers the forwarded value. The blunt boolean is doing real work here and it is the wrong tool.

- [ ] `securityHeaders` reads `request.protocol` and needs no proxy option of its own
- [ ] Remove `domainValidation.trustProxyHeaders` in favor of `fastifyOptions.trustProxy`, so proxy trust is configured once, in one place, with peer validation. Pre-release, so removal beats deprecation.

  **Why the plugin has its own in the first place:** the history records no rationale, so this is reconstruction. The likely goal was for the plugin to work standalone without requiring server-level config, which is what the fallback comment at `domain-validation.ts:174` reads like: prefer `request.protocol`, which is correct when Fastify is configured, and otherwise read the headers directly. A legitimate goal. The cost is a convenience path that skips peer validation.

  Note that the boolean offers no customization. `getProtocol()` is internal and unexported, and `trustProxyHeaders` is a bare on/off. Fastify's `trustProxy` is the one that takes a predicate function, so moving to it gains flexibility rather than losing it.

  **Preferred resolution: the server resolves it once, before user plugins, and decorates the request.** Both plugins read `request.resolvedProtocol` / `request.resolvedHost`. One config (`fastifyOptions.trustProxy`), one resolution point, no ordering sensitivity, and neither plugin needs a proxy option of its own.

  This is the same architectural move as the ordering fix (the server owns what plugins currently each compute), so it is one idea rather than two. It also preserves the standalone-friendliness that probably motivated `trustProxyHeaders`, because resolution now happens whether or not either plugin is registered.

  Rejected alternatives:
  - **Share `getProtocol()` between the plugins.** Fixes duplication, which is not the problem. It hands the weaker trust model to a second plugin and still leaves two settings that can disagree.
  - **Have `securityHeaders` detect `domainValidation` and defer to it.** Plugin-to-plugin coupling reintroduces the ordering dependency this branch exists to remove.
  - **Defer-and-warn.** Keep the boolean, ignore it when `fastifyOptions.trustProxy` is set, warn at startup otherwise. Non-breaking, but more code and the footgun survives. Fallback only if the break is unwanted.

- [ ] Verified: `request.host` keeps the port, `request.hostname` strips it and is IPv6-aware (brackets handled), and `request.port` exists separately. Together they replace the `parseHostHeader()` split, so the earlier port concern is resolved. `request.host` also falls back to HTTP/2 `:authority`, which the hand-rolled version does not.

### Second bug, worse than the first: first-vs-last forwarded entry

Fastify reads the **last** comma-separated entry of `x-forwarded-host` and `x-forwarded-proto` (`getLastEntryInMultiHeaderValue`, `fastify/lib/request.js:96-100`, commented "we use the last one if the header is set more than once"). `domainValidation` reads the **first**, via `.split(',')[0]`, in both `getHost()` (line 195) and `getProtocol()` (line 168).

The ordering is the security property, and first is the wrong end. A client sends `X-Forwarded-Host: evil.com`. A proxy that appends rather than replaces yields `evil.com, real.example.com`. The last entry is what the trusted proxy wrote; the first is attacker-supplied. Reading the first means the bypass works **even behind a correctly configured proxy**, which is a materially larger exposure than the directly-reachable case noted above.

Same shape for the protocol: client sends `X-Forwarded-Proto: https`, proxy appends the real `http`, first-entry logic reads `https`. Result is HSTS emitted over plain HTTP and HTTPS enforcement skipped.

Precondition is a proxy that appends or adds a second header rather than overwriting. Many overwrite (nginx `proxy_set_header` does), so this is not live in every deployment, but it is exactly the case the trust setting exists to handle.

- [ ] Migrating to `request.host` / `request.protocol` fixes this for free, since Fastify already reads the correct end. Another reason to delete the hand-rolled pair rather than share it.
- [ ] Test: `x-forwarded-host: evil.com, real.example.com` behind a trusted proxy resolves to `real.example.com`
- [ ] Test: `x-forwarded-proto: https, http` behind a trusted proxy resolves to `http`, so no HSTS and HTTPS enforcement still fires
- [ ] Changelog: this is the security fix that justifies the break on its own. Note that a deployment behind an appending proxy was affected regardless of how carefully it was configured.

### Migration hazard: this can take a proxied site down

Today someone behind nginx, OpenResty, or a CDN can get correct behavior from `trustProxyHeaders: true` alone, having never touched `fastifyOptions`. Remove the boolean and Fastify ignores forwarded headers entirely, falling back to the socket and the `Host` header.

The failure is not subtle. Where the proxy terminates TLS and forwards plain HTTP, Fastify reports `protocol: 'http'`, so `enforceHTTPS` redirects to HTTPS, the proxy forwards HTTP again, and the result is an **infinite redirect loop**. The site is down and the cause is not obvious from the symptom.

`canonicalDomain` has the same shape of failure: without a trusted `x-forwarded-host`, the plugin compares against the internal upstream host rather than the public one, so it redirects to the canonical domain on every request.

This cannot ship as "delete it and mention it in the changelog."

- [x] **No runtime guard.** An earlier draft proposed warning when `enforceHTTPS` was active, `trustProxy` unset, and a request arrived carrying `x-forwarded-proto`. That is unworkable, and the reason is the point of the whole change: with `trustProxy` unset, the header is untrusted input. Any client can send it, so a healthy non-proxied deployment would warn about a misconfiguration that does not exist, and the warning becomes something an outsider can trigger. A false positive under attacker control is worse than no warning.

  The only version surviving that objection is config-only at startup (`enforceHTTPS` on, `trustProxy` unset, no request data), which is deterministic and cannot be triggered externally. Rejected anyway: it misfires for anyone terminating TLS at the app itself, which is legitimate, and a warning people learn to ignore is worse than none.

  Document the failure mode instead, where someone hits it.

- [ ] Do **not** suppress the HTTPS redirect either. Deciding to skip it would depend on the same untrusted header.
- [ ] ~~Startup warning when a removed `trustProxyHeaders` key is still present~~. Dropped. That is migration scaffolding with a one-release lifespan, and the changelog carries it. Keep the removal clean.

  Worth keeping the two warnings separate when deciding. The deprecation notice is temporary and exists only to bridge this release. The misconfiguration guard above is permanent: `enforceHTTPS` on, `trustProxy` unset, and `x-forwarded-proto` present is a broken deployment whenever it occurs, including for someone who first puts unirend behind a proxy long after this change ships. Following the framework's standard behavior is what makes that failure reachable, since Fastify correctly declines to trust headers nobody vouched for.

### Survey: is anything else doing this?

Checked, and `domainValidation` is the only offender. The one other raw header read in a plugin is `access-control-request-private-network` in `security-headers.ts:912`, a real CORS request header with no Fastify equivalent. `client-info-resolution.ts` and `redirect-server.ts` already defer to Fastify and reference `fastifyOptions.trustProxy` rather than parsing forwarded headers themselves.

So this is bringing one straggler in line with what the rest of the codebase already does, not an architectural change. Nothing else needs the same treatment.

- [ ] Changelog needs a migration snippet, not a sentence. Show the before and after side by side.

### Guidance for what to set `trustProxy` to

- Origin reachable only from the proxy (loopback bind, private network, container network): `trustProxy: true` is fine, since no untrusted peer can connect.
- Origin reachable from elsewhere: name the proxy. `trustProxy: '10.0.0.0/8'` or the specific address. A bare `true` here is what lets any client forge forwarded headers.
- CDN in front of the proxy (Cloudflare → OpenResty → app) is more than one hop, so a hop count or the full trusted set is needed. This is also the setup where the first-vs-last bug above is most likely to be live, since more hops means more chance of an appended header.
- nginx and OpenResty with `proxy_set_header X-Forwarded-Proto $scheme` **overwrite** rather than append, so single-hop setups avoid the first-vs-last issue. Worth saying so in the docs, since it tells a reader whether they were exposed.

- [ ] Document the above in `docs/built-in-plugins/domainValidation.md`, replacing the current Proxy Support section, which describes the `trustProxyHeaders` behavior being removed
- [ ] `docs/https.md` should point at `fastifyOptions.trustProxy` too, since TLS termination is exactly where readers arrive at this problem

Since there is no warning, the docs carry the whole burden. Name the symptom, not just the setting, so someone already looking at a broken deploy can search for it:

- [ ] State plainly that `enforceHTTPS` behind a TLS-terminating proxy **requires** `fastifyOptions.trustProxy`, and that without it the result is a redirect loop rather than a subtle misbehavior
- [ ] Say the same for `canonicalDomain`, which without a trusted `x-forwarded-host` compares against the internal upstream host and redirects on every request
- [ ] Use the words a person would actually search: "redirect loop", "ERR_TOO_MANY_REDIRECTS", "infinite redirect"
- [ ] Put it in a GitHub alert block rather than a paragraph, so it survives skim-reading
- [ ] Changelog: this is a second breaking change and a security fix. Say plainly that a repo setting `trustProxyHeaders: true` must move to `fastifyOptions.trustProxy`, and that the new setting should name the proxy rather than being a bare `true` wherever the origin is directly reachable.
- [ ] Test: `hsts` configured, request over HTTP, header absent
- [ ] Test: `hsts` configured, HTTP request behind a trusted proxy sending `x-forwarded-proto: https`, header present
- [ ] Test: same forwarded header with no `trustProxy` configured, header absent, since an untrusted header must not be able to turn HSTS on
- [ ] Test: the same untrusted-header case against `domainValidation`, confirming a forged `x-forwarded-host` no longer passes domain validation

## Commit 4: throwing callbacks

Config-time validation is well covered. Request-time throws are not covered at all.

- [ ] `isOriginAllowed` awaits the user function with no try/catch (`security-headers.ts`, `originConfig(origin, request)`)
- [ ] `validProductionDomains` same (`domain-validation.ts:297`)
- [ ] Double-fault path: origin callback throws → 500 → error path calls `applySecurityHeaders` → calls the callback again → throws again inside the error handler
- [ ] Decide fail-closed semantics: a throwing origin callback should deny (no ACAO header), not 500. A throwing `validProductionDomains` should 403, not 500.
- [ ] Cache the decision on the request so the error path reuses it instead of re-invoking (the `corsOriginAllowed` cache already exists, extend it to cover the thrown case)
- [ ] Log the callback error once, at the point it throws

## Commit 5: error pages under CSP

`error-page-utils.ts` uses an inline `<style>` block and an inline `onclick="window.location.reload()"` (line 177). Any CSP without `unsafe-inline` renders the 500 page unstyled with a dead button.

- [ ] Replace the button with `<a class="ep-btn" href="{escaped request.url}">Refresh Page</a>`. No inline JS at all. Also avoids re-POSTing on a failed POST. Use the existing `escapeHTML`, `request.url` is attacker-controlled.
- [ ] SHA-256 the generated style text at module load via `node:crypto` (Node API, not `Bun.*`, per AGENTS.md Runtime Target) and export the hashes
- [ ] Auto-include those hashes in `style-src` when unirend emits its own CSP
- [ ] Same treatment for the 404 and 503 pages
- [ ] The SSR starter template's 500 page (`ssr-get-500-error-page.ts`) has an inline `<style>` block but **no** inline `onclick`, it already uses an `<a>`. So it needs the style handled, not the button.

**The scaffolded copy is the harder half.** That file is generated into the user's repo and never overwritten, so an existing scaffolded repo keeps its own copy and unirend cannot fix it from the package. Under a strict `style-src` their 500 page renders unstyled, and it is their file to hash.

- [ ] Update the template so new scaffolds are CSP-clean out of the box
- [ ] Export a small helper so a user can hash their own inline block without hand-rolling `node:crypto` and base64. Without it, "add your own hash" is a paper cut on every scaffolded repo.

  **The helper is exact for this case, precisely because the error page bypasses the format pipeline.** The "hash after serialization" rule exists because cheerio re-serializes template slots and can shift bytes. A custom error page is a raw template string returned straight to the transport, never parsed, so what the function returns is byte-for-byte what the browser receives. Hashing the string directly is correct here, with no pipeline caveat.

  That makes the boundary worth stating plainly in the docs, since it is the difference between a helper that always works and one that silently produces wrong hashes:
  - Raw strings sent directly (error pages) → hash the string, exact
  - Content passing through cheerio (template slots) → hash after serialization, which unirend does internally so users never touch it

- [ ] **Changelog must tell scaffolded-repo users to update their own copy**, since re-running `unirend create` will not replace it. Name the file explicitly. This is the kind of thing that is invisible until someone turns CSP on months later and cannot work out why only the error page looks broken.

Only one of the two reload buttons is actually a problem. `error-page-utils.ts:177` is a raw HTML `onclick="..."` attribute in a server-generated string, which CSP blocks. `starter-templates/templates-shared/react-components/application-error.ts:82` is a JSX `onClick={() => window.location.reload()}`, which React attaches as a JS listener rather than emitting an HTML attribute, so CSP never sees it and it keeps working. Leave the React one alone.

Hashes, not nonces: the style text is deterministic, so it is computed once at module load with no per-request state and no plumbing through render paths.

## Commit 6: CSP itself

Rich JSON policy rather than a hand-written string. Reuse `validateConfigEntry` / `matchesOriginList` from `lifecycleion/domain-utils` for source lists, so `*.cdn.example.com` and `https://*` parse and get rejected at config time with a real message, matching how CORS origins already behave.

- [ ] Directive config object (`defaultSrc`, `scriptSrc`, `styleSrc`, `imgSrc`, `connectSrc`, `frameAncestors`, `reportUri`, …)
- [ ] Keyword sources (`'self'`, `'none'`, `'strict-dynamic'`, `'unsafe-inline'`) validated distinctly from host sources
- [ ] Presets, so a sane default plus per-directive override beats writing the string by hand
- [ ] `reportOnly` mode (`Content-Security-Policy-Report-Only`), essential for rolling this out on a live site
- [ ] Config-time rejection of the obvious footgun cases, in the spirit of the existing CORS guards: `'unsafe-inline'` in `script-src` without an explicit opt-in flag
- [ ] `frame-ancestors` overlaps `frameOptions`. Warn or reconcile when both are set.

### How hashing actually behaves (researched, not assumed)

- The hash covers the element's text content **exactly as delivered to the client**, byte for byte. No trimming, no normalization. Leading and trailing whitespace, indentation, newlines, and capitalization all change the hash. The `<script>` / `<style>` tags themselves are not included.
- `style-src` supports hashes for inline `<style>` **elements**. Neither `script-src` nor `style-src` hashes cover `onclick=` handlers or `style=""` attributes, which need `'unsafe-hashes'`. That confirms the plan for `bodyPrepend`: warn rather than try to support them.

**Design consequence, and it is not a small one.** The hash must be computed from the final serialized output, never from the input source. `html-utils/format.ts` and `inject.ts` both run content through cheerio, which re-serializes and can alter whitespace. Hashing a user's `headInlineScripts` string as supplied, then letting cheerio reformat it on the way out, produces a hash that does not match what the browser receives and silently blocks the script.

- [ ] Compute every hash at the **end** of template processing, reading back the serialized text of each `<script>` / `<style>` node, rather than hashing the input
- [ ] Same for error pages: hash the exact substring the generator emits between the tags, including its leading newline and indentation
- [ ] Add a test that asserts the emitted hash matches a hash recomputed from the final rendered HTML. This is the regression that catches a future formatting change silently breaking CSP.

### The hash story, and where it runs out

Three sources of inline content, and they do not behave the same way.

1. **Error pages** — static. Hash at module load. Solved in commit 5.
2. **Template slots** — `headInlineScripts` (`types.ts:956`), `bodyPrepend` (`types.ts:965`), and `bodyAppend` (`types.ts:976`). Baked into the processed template and cached per app, with per-request data arriving as globals instead of varying the slot content (`types.ts:937`). So they are static per app and hashable. `html-utils/format.ts` already parses them with cheerio in `validateTemplateSlots()`, so the hashing hooks into a pass that exists.
   - [ ] Hash each `headInlineScripts` entry, from the **serialized** output, and add to `script-src`
   - [ ] Extract and hash `<script>` / `<style>` elements inside `bodyPrepend` and `bodyAppend` (do not forget `bodyAppend`, which is where analytics snippets most often go)
   - [ ] Inline event handler attributes (`onclick=`) and `style=""` attributes in slot HTML cannot be hashed usefully. `unsafe-hashes` is messy and poorly supported. Warn at validation time when CSP is enabled.

   **The slot use case is third-party widgets** (chat, analytics), and those come in three shapes that CSP treats differently:
   - **External only** (`<script src="https://widget.example.com/x.js">`): hashes are irrelevant. This needs a **host source** in `script-src`. Unirend can collect the origin of every external script it finds in a slot and add it automatically, which is a nicer default than making the user restate it.
   - **Inline only**: hash it, per above.
   - **Inline snippet that injects an external script** — the common analytics/chat pattern (Google Analytics, Intercom, and friends). Hashing the snippet is not enough, because the script it injects at runtime is _also_ subject to `script-src`. This is the case `'strict-dynamic'` exists for: a script trusted by hash or by nonce is then trusted to load further scripts. Alternative is listing every third-party origin by hand.
   - [ ] Decide whether unirend offers a `strictDynamic: true` convenience, and document plainly that slot-injected third-party scripts need either that or explicit host sources. This is the thing most likely to bite a user, so it belongs near the top of the slots documentation, not in a footnote.

3. **Per-request injected globals** — `inject.ts:428-516` emits seven inline scripts whose content varies per request: `__lifecycleion_is_dev__`, `__FRONTEND_REQUEST_CONTEXT__`, `__PUBLIC_APP_CONFIG__`, `__CDN_BASE_URL__`, `__DOMAIN_INFO__`, `__UNIREND_TEMPLATE_ATTRS__`, template metas. **Hashes do not work here.** This is the one genuine nonce case.

### Avoiding nonces for case 3

Preferred: consolidate the seven into one `<script type="application/json">` data block plus one _static_ bootstrap script that reads it and assigns the globals. A non-executable script type is a CSP data block and is not governed by `script-src`, and the bootstrap script is fixed text so it hashes like everything else. Result: the whole SSR pipeline works under a strict CSP with no nonces anywhere.

- [x] **Verified.** A `<script>` with a non-JavaScript `type` is never executed by any browser, so CSP does not treat it as executable and `script-src` does not apply. This is an established technique, not a loophole. One requirement that comes with it: any `</script` inside the JSON must be escaped as `<\/script`, or the element closes early. Check whether `inject.ts`'s existing `safeContextJSON` / `safeConfigJSON` helpers already do this, since the naming suggests they might.
- [ ] Consolidating seven script tags into one is a small perf win regardless
- [ ] Changes the shape of what a slotted script can read at startup — check ordering, the bootstrap must run before any slot script that reads a global
- [ ] Fallback if the claim does not hold: support an opt-in nonce mode for these injected scripts only, still not required for the default path

## Docs

- [ ] Rewrite `docs/built-in-plugins/security-headers.md` around the two jobs (CORS negotiation, non-negotiated headers) instead of CORS with security headers as a footnote
- [ ] New CSP section with the hash story and what unirend contributes automatically
- [ ] Explain _why_ a `<script type="application/json">` (or `application/ld+json`) data block is not subject to `script-src`: the browser does not execute an unknown script type, so there is nothing for CSP to govern. Worth spelling out rather than presenting as a trick, since a reader who does not know the reason will not trust it, and it is the mechanism the whole no-nonce approach rests on. Mention `application/ld+json` explicitly, since structured data is the case people hit first.
- [ ] `docs/https.md` — HSTS guidance belongs next to the TLS setup, not only in the plugin page
- [ ] Note the ordering fix in `docs/server-plugins.md`, since the old advice implicitly depended on array order
- [ ] Fold the commit-1 changelog Breaking note into one entry describing the final release delta, per AGENTS.md. Do not append a bullet per commit.

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

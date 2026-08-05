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

### Bug found while checking the above: HSTS is sent over plain HTTP

`applyUnconditionalSecurityHeaders()` emits `Strict-Transport-Security` whenever `hsts` is configured, without looking at whether the connection is secure. The current docs acknowledge this ("this plugin does not inspect the connection security, enable with care") and push the problem to the user, but RFC 6797 §7.2 is a MUST NOT, so this is a spec violation rather than a configuration preference. It fires on any HTTP request to a deployment with `hsts` set, including a plain-HTTP local run and any setup where the app speaks HTTP behind a TLS-terminating proxy.

Harmless in the sense that browsers ignore it, but it is wrong, it shows up in security scans, and it is trivially avoidable.

- [ ] Only emit HSTS when the request arrived over a secure transport
- [ ] `domainValidation` already solves the proxy-aware half of this in `getProtocol()` (`domain-validation.ts:157`), honoring `x-forwarded-proto` only when `trustProxyHeaders` is set. Extract that into a shared internal helper rather than writing a second copy that can drift from the first.
- [ ] `securityHeaders` needs its own `trustProxyHeaders` option to use it, since the two plugins are configured independently
- [ ] Test: `hsts` configured, request over HTTP, header absent
- [ ] Test: `hsts` configured, HTTP request with `x-forwarded-proto: https` and `trustProxyHeaders: true`, header present
- [ ] Test: same but with `trustProxyHeaders` unset, header absent, since an untrusted header must not be able to turn HSTS on

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

## Out of scope for this branch

- `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` and friends. Easy to add once the application path is order-independent, but they are additive and should not hold up CSP.
- Nonce support for a user's own SSR React output. Opt-in later, not required to ship.

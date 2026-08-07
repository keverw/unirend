# securityHeaders

<!-- toc -->

- [About](#about)
- [Key Features](#key-features)
- [Usage](#usage)
- [Configuration](#configuration)
  - [`cors`](#cors)
  - [Non-Negotiated Headers](#non-negotiated-headers)
  - [Everything Is Opt-In, Including the Obvious Ones](#everything-is-opt-in-including-the-obvious-ones)
  - [Rehearsing COOP and COEP](#rehearsing-coop-and-coep)
- [Advanced Features](#advanced-features)
- [Security Notes](#security-notes)
  - [Security Model (at a Glance)](#security-model-at-a-glance)
- [Content-Security-Policy](#content-security-policy)
  - [Violation Reporting Needs Both Halves](#violation-reporting-needs-both-halves)
  - [Roll It Out With `reportOnly`](#roll-it-out-with-reportonly)
  - [What Unirend Contributes Automatically](#what-unirend-contributes-automatically)
  - [Your Own Inline Content Is Hashed Too](#your-own-inline-content-is-hashed-too)
  - [Prerendered Sites (SSG)](#prerendered-sites-ssg)
  - [Trusted Types](#trusted-types)
  - [`data:` in a Script Directive Is Refused](#data-in-a-script-directive-is-refused)
  - [Third-Party Widgets and `'strict-dynamic'`](#third-party-widgets-and-strict-dynamic)
  - [`frameAncestors` and `frameOptions` Together](#frameancestors-and-frameoptions-together)
  - [Inline Attributes Take More Than a Hash](#inline-attributes-take-more-than-a-hash)
  - [`'unsafe-inline'` and Automatic Hashes](#unsafe-inline-and-automatic-hashes)
  - [Presets](#presets)
  - [Config-Time Validation](#config-time-validation)
- [Per-Request Policy With `resolve`](#per-request-policy-with-resolve)
  - [Building an Override From the Baseline](#building-an-override-from-the-baseline)
  - [When `resolve` Throws](#when-resolve-throws)
  - [Throwing on Purpose](#throwing-on-purpose)
  - [Keeping HSTS for Hosts You Own](#keeping-hsts-for-hosts-you-own)
  - [Where to Put the Plugin, and When `resolve` Runs](#where-to-put-the-plugin-and-when-resolve-runs)
  - [Installing a Resolver Later](#installing-a-resolver-later)
  - [Validating a Policy Before You Store It](#validating-a-policy-before-you-store-it)
  - [Validating a CORS Block](#validating-a-cors-block)
- [When a Callback Throws](#when-a-callback-throws)
- [Plugin Order and Short-Circuited Responses](#plugin-order-and-short-circuited-responses)
  - [HSTS on a Host the Server Has Not Claimed](#hsts-on-a-host-the-server-has-not-claimed)
- [Hijacked Responses](#hijacked-responses)
- [Advanced Configuration](#advanced-configuration)
- [Advanced Use Cases](#advanced-use-cases)
- [Security Benefits](#security-benefits)

<!-- tocstop -->

## About

The `securityHeaders` plugin provides dynamic CORS (Cross-Origin Resource Sharing) handling with advanced features not available in standard CORS libraries. Unlike `@fastify/cors`, this plugin supports dynamic credentials based on origin, allowing you to create public APIs while restricting credential access to trusted domains.

## Key Features

- **Dynamic credentials**: Allow credentials only for specific origins while optionally accepting requests from any origin
- **Function-based validation**: Use custom logic to determine allowed origins and credential permissions
- **Separate policies**: Different rules for origin validation vs credential permissions
- **Request-aware decisions**: `origin` and `credentials` can be functions that receive the full Fastify request, so you can base decisions on path, headers, method, cookies, etc.
- **Request-level caching**: Origin validation is computed once per request and reused within that request lifecycle (e.g., across hooks)

## Usage

```typescript
import { securityHeaders } from 'unirend/plugins';

const server = serveSSRBuilt(buildDir, {
  plugins: [
    securityHeaders({
      cors: {
        origin: '*', // Allow any origin for public API access
        credentials: ['https://myapp.com', 'https://admin.myapp.com'], // Only these can send cookies
        methods: ['GET', 'POST', 'PUT', 'DELETE'],
        allowedHeaders: ['Content-Type', 'Authorization'],
      },
      hsts: { maxAge: 31536000, includeSubDomains: true },
      frameOptions: 'DENY',
    }),
  ],
});
```

## Configuration

Options are grouped by the header family they control. CORS is negotiated per-origin and lives under `cors`. The remaining headers apply to every response regardless of origin and sit alongside it at the top level.

```typescript
securityHeaders({
  cors: {/* origin, credentials, methods, ... */},
  frameOptions: 'DENY',
  hsts: { maxAge: 31536000, includeSubDomains: true },
});
```

### `cors`

- `origin` (default: `"*"`): Allowed origins for CORS requests
  - `string`: Single origin (e.g., `"https://example.com"`)
  - `string[]`: Multiple origins with wildcard support
  - `function`: Dynamic origin validation `(origin, request) => boolean | Promise<boolean)`
  - `"*"`: Allow all origins (not recommended with credentials)
  - Wildcard patterns:
    - `"*.example.com"`: Direct subdomains only (api.example.com ✅, app.api.example.com ❌)
    - `"**.example.com"`: All subdomains including nested (staging.api.example.com ✅, app.api.example.com ✅)
      - Note: `**` requires something before the remainder, so `**.example.com` does NOT match `example.com`
    - `"https://*"`: Any domain with HTTPS protocol
    - `"http://*"`: Any domain with HTTP protocol
    - `"https://*.example.com"`: HTTPS subdomains only
    - `"http://**.example.com"`: HTTP subdomains including nested
  - Origin array policy:
    - Allow at most one wildcard token overall (`"*"`, `"https://*"`, or `"http://*"`)
    - If a wildcard token is present, the only other allowed entry in the array is the string literal `"null"`
      - Allowed: `["*", "null"]`, `["https://*", "null"]`, `["http://*", "null"]`
      - Disallowed: `["*", "apple.com"]`, `["https://*", "*.example.com"]`, or multiple wildcard tokens
    - The string literal `"null"` does not match wildcards, include it explicitly if you wish to allow sandboxed/file contexts

- `credentials` (default: `false`): Which origins may send credentials (cookies, auth headers)
  - `boolean`:
    - `true`: allow credentials for the same origins that pass the `origin` policy.
      - Safeguards: `origin: "*"` is rejected with `credentials: true`, protocol wildcards (e.g., `"https://*"`) require `allowCredentialsWithProtocolWildcard: true`.
    - `false`: never allow credentials.
  - `string[]`: explicit allowlist (exact origins only by default). Subdomain wildcards (e.g., `"*.example.com"`) are permitted only when `credentialsAllowWildcardSubdomains: true`. Use a separate credentials list when your API should be broadly accessible (e.g., third‑party apps using bearer tokens) but only your first‑party apps (your domains) should receive cookies/auth headers.
  - `function`: per-request decision `(origin, request) => boolean | Promise<boolean)`
    - Not allowed with `origin: "*"`: combining a global origin wildcard with a dynamic credentials function is rejected for safety.
  - Auto-merge behavior: When `credentials` is an array, its origins are automatically merged into `origin` (even if `origin` is a single string) so credentialed origins are always allowed for CORS.

- `methods` (default: `["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"]`): Allowed HTTP methods
  - Preflight handling: On OPTIONS requests, the plugin responds with `Access-Control-Allow-Methods` built from the configured methods (normalized, deduped).
- `allowedHeaders` (default: `["Content-Type", "Authorization", "X-Requested-With"]`): Allowed request headers
- `exposedHeaders` (default: `[]`): Headers exposed to the client
- `maxAge` (default: `86400` - 24 hours): Max age for preflight cache (in seconds)
- `preflightContinue` (default: `false`): Controls whether the plugin short-circuits preflight OPTIONS requests. When `false` (default), the plugin fully handles the preflight and responds with `optionsSuccessStatus`. When `true`, CORS headers are still set but control passes to the next handler instead of ending the request.
- `optionsSuccessStatus` (default: `204`): Status code for successful preflight responses
- `allowPrivateNetwork` (default: `false`): Whether to allow private network requests (Chrome feature)
- `credentialsAllowWildcardSubdomains` (default: `false`): Allow wildcard subdomain patterns (e.g., `"*.example.com"`, `"**.example.com"`) in `credentials` arrays. Apex domains never match wildcards, include the apex explicitly (e.g., `"https://example.com"`).
- `allowCredentialsWithProtocolWildcard` (default: `false`): Opt-in to allow `credentials: true` when `origin` includes a protocol wildcard (e.g., `"https://*"`, `"http://*"`). Disabled by default for safety.

### Non-Negotiated Headers

These are sent on every response, whether or not the request carries an `Origin`.

- `frameOptions` (default: `false`): Controls the `X-Frame-Options` header
  - `false`: do not send the header
  - `"DENY" | "SAMEORIGIN"`: header value to send

- `csp` (default: `false`): Controls the `Content-Security-Policy` header. See [Content-Security-Policy](#content-security-policy) below.

- `hsts` (default: `false`): Controls the `Strict-Transport-Security` (HSTS) header
  - `false`: do not send the header
  - `{ maxAge: number; includeSubDomains?: boolean; preload?: boolean }`
    - `maxAge` is in seconds
    - The header is sent only on requests that arrived over a secure transport, which RFC 6797 section 7.2 requires. Behind a proxy that terminates TLS, set [`fastifyOptions.trustProxy`](../https.md#behind-a-tls-terminating-proxy) so Fastify resolves the request as HTTPS, otherwise no HSTS header is sent.
    - It is also skipped when [`domainValidation`](domainValidation.md) rejected the request's host. See [Plugin Order and Short-Circuited Responses](#plugin-order-and-short-circuited-responses).
    - If `preload: true`, then `maxAge` must be at least `31536000` (1 year) and `includeSubDomains` must be `true` (Chrome preload list requirement)

<!-- prettier-ignore -->
> [!IMPORTANT]
> Be careful with `includeSubDomains` on a domain you do not control, such as a customer's custom domain in a multi-tenant deployment. It forces HTTPS on every other subdomain of that domain, including services unrelated to your app, and browsers honor it for the full `maxAge`, so deploying a fix later does not revoke it. Send a shorter `maxAge` without `includeSubDomains` for domains you do not own.

- `contentTypeOptions` (default: `false`): sends `X-Content-Type-Options: nosniff` when `true`. Stops a browser second-guessing your `Content-Type`, which is what turns a file served as `text/plain` into executable HTML.

- `referrerPolicy` (default: `false`): sets `Referrer-Policy`. Takes one token or a list, since the header does: a browser uses the last token it understands, which is how a newer policy ships with an older one behind it. Valid tokens are `no-referrer`, `no-referrer-when-downgrade`, `origin`, `origin-when-cross-origin`, `same-origin`, `strict-origin`, `strict-origin-when-cross-origin`, `unsafe-url`.

- `permissionsPolicy` (default: `false`): sets `Permissions-Policy`, written as a feature to its allowlist. An empty array disables the feature outright, `['self']` allows it same-origin, `['*']` allows it everywhere, and an origin is written in full.

- `crossOriginOpenerPolicy` (default: `false`): sets `Cross-Origin-Opener-Policy`. One of `unsafe-none`, `same-origin`, `same-origin-allow-popups`, `noopener-allow-popups`. Takes `{ policy, reportTo }` when you want violations reported.

- `crossOriginOpenerPolicyReportOnly` (default: `false`): the same, as `Cross-Origin-Opener-Policy-Report-Only`. See [Rehearsing COOP and COEP](#rehearsing-coop-and-coep).

- `crossOriginResourcePolicy` (default: `false`): sets `Cross-Origin-Resource-Policy`. One of `same-site`, `same-origin`, `cross-origin`.

- `crossOriginEmbedderPolicy` (default: `false`): sets `Cross-Origin-Embedder-Policy`. One of `unsafe-none`, `require-corp`, `credentialless`. Takes `{ policy, reportTo }` when you want violations reported.

- `crossOriginEmbedderPolicyReportOnly` (default: `false`): the same, as `Cross-Origin-Embedder-Policy-Report-Only`.

- `reportingEndpoints` (default: `false`): sets `Reporting-Endpoints`, which is the other half of [`csp.reportTo`](#violation-reporting-needs-both-halves).

Every value is checked against the set a browser actually accepts, because all of these fail the same quiet way: an unrecognized value means the header is dropped and the browser default applies, so the config reads as though the protection is on and it is not.

### Everything Is Opt-In, Including the Obvious Ones

`contentTypeOptions` is off by default even though there is no real reason not to set it. That is a house rule rather than an assessment of the risk: this plugin does not turn protections on behind your back, for the same reason it never invents a CSP directive you did not write. A header that appears without anyone asking is a header nobody knows to look at when something breaks two releases later.

A reasonable starting block for most apps, which is what you would get if these were defaulted:

```typescript
securityHeaders({
  contentTypeOptions: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  frameOptions: 'DENY',
});
```

The three below it need a decision rather than a default, and each has a specific way of breaking a working app:

- `crossOriginOpenerPolicy: 'same-origin'` severs `window.opener`. Check your OAuth and payment popups first, and reach for `'same-origin-allow-popups'` if they talk back to the opener.
- `crossOriginResourcePolicy: 'same-origin'` goes on every response, so a site serving its own images or fonts to another origin or through a CDN needs `'cross-origin'` for those.
- `crossOriginEmbedderPolicy: 'require-corp'` demands that every cross-origin subresource opt in. Only worth it if you need `crossOriginIsolated` for `SharedArrayBuffer` or high-resolution timers.

All of them can be varied per request with [`resolve`](#per-request-policy-with-resolve), one field at a time, so a resolver that sets only `referrerPolicy` keeps the baseline's `contentTypeOptions`.

### Rehearsing COOP and COEP

The two headers most likely to break a working app are also the two whose breakage happens in code you do not own: an OAuth popup that talks back through `window.opener`, a third-party font that never opted in to being embedded. Both have report-only variants for exactly that, and they work like `csp.reportOnly` does: nothing is applied, and you find out what would have been.

```typescript
securityHeaders({
  reportingEndpoints: { coop: 'https://reports.example.com/coop' },

  // What you enforce today.
  crossOriginOpenerPolicy: 'same-origin-allow-popups',

  // What you want, being measured against real traffic.
  crossOriginOpenerPolicyReportOnly: {
    policy: 'same-origin',
    reportTo: 'coop',
  },
});
```

Sending both at once is the normal shape mid-migration, not a conflict.

`reportTo` is optional and worth setting. Without it the violations only reach DevTools, which is fine while you are sitting in front of the browser and useless for the failures that matter, since those happen on someone else's machine during a checkout. The group has to be defined in `reportingEndpoints` or startup fails, the same rule `csp.reportTo` gets and for the same reason.

The enforcing headers take `{ policy, reportTo }` too, so you can keep collecting reports after you commit.

## Advanced Features

- **Advanced Wildcard Support**:
  - `*.example.com` matches direct subdomains only (`api.example.com` ✅, `app.api.example.com` ❌)
  - `**.example.com` matches all subdomains including nested (`staging.api.example.com` ✅, `app.api.example.com` ✅)
  - `**` patterns require something before the remainder (e.g., `**.example.com` does NOT match `example.com`)
  - Protocol-specific wildcards: `https://*`, `http://*`, `https://*.example.com`
  - Apex domains do not match wildcard patterns, include the apex explicitly alongside subdomain patterns.
- **Punycode Normalization**: Handles international domains (IDN) safely with punycode conversion
- **Origin Normalization**: Case-robust matching, scheme and port are considered for origin comparisons (`https://app.com/` vs `https://app.com`)
- **Secure Credentials**: Raw wildcard tokens (`*`, `https://*`, `http://*`) are NOT allowed in credentials arrays. Subdomain wildcards (like `*.example.com`) are supported only when `credentialsAllowWildcardSubdomains: true`
  - The string literal `"null"` origin is never allowed in `credentials` arrays and will be rejected.
  - Even when using a credentials function, the literal `"null"` origin will never receive `Access-Control-Allow-Credentials: true`.
- **Header Preservation**: Maintains configured header casing (e.g., "Content-Type")
- **Private Network Support**: Configurable Chrome private network access feature
- **Declarative Methods**: Only returns methods that are actually configured
- **Raw response compatibility**: This is mostly an internal/advanced concern. When this plugin is registered, it decorates the request with an internal `request.applySecurityHeaders(reply)` helper. Unirend's own hijacked/raw response paths can feature-detect that helper and call it before `writeHead(...)` snapshots `reply.getHeaders()`, so those responses still receive the same CORS/security headers even though they bypass Fastify's normal send pipeline.

**Examples:**

```typescript
// Wildcard origins with explicit credentials (recommended)
securityHeaders({
  cors: {
    origin: ['**.myapp.com', 'https://myapp.com'], // All subdomains + explicit apex
    credentials: ['https://app.myapp.com', 'https://admin.myapp.com'], // Explicit only
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  },
});

// Protocol-specific wildcards
securityHeaders({
  cors: {
    origin: ['https://*.myapp.com'], // HTTPS subdomains
    credentials: ['https://app.myapp.com'],
    // To allow wildcard credentials for subdomains, enable the flag and list patterns explicitly
    // credentials: ["*.myapp.com"],
    // credentialsAllowWildcardSubdomains: true,
  },
});

// Protocol wildcard + credentials (explicit opt-in)
securityHeaders({
  cors: {
    origin: ['https://*'],
    credentials: true,
    allowCredentialsWithProtocolWildcard: true,
  },
});

// Global wildcard with explicit null (sandboxed/file contexts)
securityHeaders({
  cors: {
    origin: ['*', 'null'],
    credentials: false,
  },
});

// Mixed wildcard patterns (with explicit null)
securityHeaders({
  cors: {
    origin: ['https://*', 'null'], // Any HTTPS + sandboxed/file contexts
    credentials: false, // No credentials for broad access
  },
});

// Dynamic validation based on request path
securityHeaders({
  cors: {
    origin: (origin, request) => {
      // Allow any origin for public endpoints
      if (request.url?.startsWith('/api/public/')) return true;
      // Restrict private endpoints to trusted domains
      return origin === 'https://myapp.com';
    },
    credentials: (origin, request) => {
      // Only allow credentials for auth endpoints from trusted origins
      return (
        request.url?.startsWith('/api/auth/') && origin === 'https://myapp.com'
      );
    },
  },
});

// Traditional CORS (like @fastify/cors)
securityHeaders({
  cors: {
    origin: ['https://myapp.com', 'https://www.myapp.com'],
    credentials: true, // Allow credentials for all allowed origins
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Total-Count'],
  },
});

// Development setup with flexible origins
securityHeaders({
  cors: {
    origin: (origin, request) => {
      // Allow localhost and development domains
      if (!origin) return true; // Mobile apps, curl, etc.
      return (
        origin.includes('localhost') ||
        origin.includes('127.0.0.1') ||
        origin === 'https://dev.myapp.com'
      );
    },
    credentials: true,
  },
});
```

## Security Notes

- **Credentials Security**: Raw wildcard patterns (`*`, `https://*`, `http://*`) are NOT allowed in `credentials` arrays and will throw an error. Only subdomain patterns like `*.example.com` are permitted when `credentialsAllowWildcardSubdomains: true`
- **Wildcard Patterns**:
  - `*.example.com` matches direct subdomains only (`api.example.com` ✅, `app.api.example.com` ❌)
  - `**.example.com` matches all subdomains including nested (`api.example.com` ✅, `app.api.example.com` ✅)
  - Protocol-specific: `https://*`, `https://*.example.com` for protocol-aware matching
- **International Domains**: All domains normalized with punycode for safe Unicode/IDN handling
- **Auto-Merging**: Credentials origins are automatically merged into the origin list to prevent configuration mistakes
- **Credentials Behavior**: The `credentials` option controls the `Access-Control-Allow-Credentials` header, which tells browsers whether to include cookies/auth headers in requests. When credentials are enabled, the browser automatically handles the `Cookie` header - you don't need to add "Cookie" to `allowedHeaders`. The client must still opt-in with `credentials: 'include'` in their fetch request.
- **Response Headers**: CORS-safelisted response headers (`Cache-Control`, `Content-Language`, `Content-Length`, `Content-Type`, `Expires`, `Last-Modified`, `Pragma`) are always accessible to clients. Use `exposedHeaders` to expose additional response headers like `X-Total-Count` or `Authorization`.
- **Protocol Wildcards + Credentials**: Using `credentials: true` with protocol wildcard origins (e.g., `"https://*"`) is blocked by default, set `allowCredentialsWithProtocolWildcard: true` to opt-in deliberately.
- Partial-label wildcards are invalid: Patterns like `"*foo.com"`, `"ex*.example.com"`, or `"foo*bar.com"` are rejected. Use full-label wildcards only: `"*.example.com"` (direct subdomains) or `"**.example.com"` (any depth).
- Origin array wildcard policy: In `origin: string[]`, allow at most one wildcard token overall (`"*"`, `"https://*"`, or `"http://*"`). If present, the only other allowed entry is the literal `"null"`.
- Credentials arrays restrictions: Raw wildcard tokens (`"*"`, `"https://*"`, `"http://*"`) are not allowed in `credentials` arrays and will throw. Use exact origins, or enable `credentialsAllowWildcardSubdomains: true` for domain wildcards like `"*.example.com"`.
- Header reflection hardening: When `allowedHeaders: ["*"]`, only syntactically valid HTTP header names (RFC 7230 token) are reflected from `Access-Control-Request-Headers`, and reflection is capped by count (100) and token length (256 chars).

### Security Model (at a Glance)

- We only echo the `Access-Control-Allow-Origin` header with the request's Origin after it passes policy (list/wildcard/function). Otherwise we omit the `Access-Control-Allow-Origin` header.
- We never combine `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`. Configurations that attempt this are rejected.
- If you configure `origin: "*"` and also provide a `credentials` allowlist (array), we automatically upgrade the configuration so that responses echo the specific allowed origin (not `*`) and can include `Access-Control-Allow-Credentials: true` for those origins. Wildcard `*` is never sent together with credentials.
- We set `Vary: Origin` on CORS responses.
- The literal `"null"` origin can be allowed for non-credential requests (if included explicitly) but never receives credentials, even when using a credentials function.
- All origin/pattern entries are validated up-front (rejects PSL/IP tails, partial-label wildcards, URL-ish characters, and protocol/global wildcards where disallowed).
- Protocol wildcards (`https://*`, `http://*`) are permitted only in origin lists, not in credentials.
- Header reflection (`allowedHeaders: ["*"]`) reflects only what the browser requested, with caps: at most 100 header names, names longer than 256 characters are ignored.

## Content-Security-Policy

Every source-list directive takes an array of source expressions, written exactly as they appear in the header: keywords carry their quotes, hosts do not.

```typescript
securityHeaders({
  csp: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https://cdn.example.com'],
    connectSrc: ["'self'", 'https://api.example.com'],
    frameAncestors: ["'none'"],
    baseURI: ["'self'"],
    upgradeInsecureRequests: true,
    reportURI: '/csp-report',
  },
});
```

Available source-list directives: `defaultSrc`, `scriptSrc`, `scriptSrcElem`, `scriptSrcAttr`, `styleSrc`, `styleSrcElem`, `styleSrcAttr`, `imgSrc`, `fontSrc`, `connectSrc`, `mediaSrc`, `objectSrc`, `childSrc`, `frameSrc`, `workerSrc`, `manifestSrc`, `formAction`, `frameAncestors`, `baseURI`. Alongside them: `sandbox` (an array of tokens, or an empty array for the bare directive), `upgradeInsecureRequests`, `requireTrustedTypesFor`, `trustedTypes`, `reportURI`, and `reportTo`.

Directives that were removed from CSP are rejected by name rather than as typos, since the two are different mistakes: `prefetchSrc`, `pluginTypes`, `navigateTo`, `blockAllMixedContent`, and the CSP `referrer` directive each produce a message saying what replaced them. `prefetchSrc` is the one you may have been using, and it was dropped because no browser shipped it un-flagged while Chrome logs an "Unrecognized Content-Security-Policy directive" warning for it on every page load.

Nonces are rejected. A nonce has to be unpredictable and different on every response to mean anything, so one written in config is the same value forever and authorizes an injected script as readily as your own. Unirend generates none, and hashes cover the same ground for content it can see.

Every source expression is checked. Keywords have to be spelled and quoted the way a browser reads them, hashes and nonces have to be well formed, and the host part goes through the same validator a CORS origin does, so `*.cdn.example.com` and a public-suffix wildcard behave identically in both places. A `javascript:` or `vbscript:` scheme is refused outright.

The port and path are checked separately, because CSP's host grammar is wider than an origin's in two ways that matter. The scheme is optional, so `localhost:3000` is a host and a port rather than something malformed, and the port may be a wildcard, so `https://cdn.example.com:*` and `ws://localhost:*` are valid. That last one is how a dev server's HMR socket gets allowed. A numeric port still has to be one, so `:0` and `:99999` are refused.

`sandbox` tokens are checked against the real token set rather than an `allow-*` shape, since a browser silently ignores a token it does not recognize: `allow-form` for `allow-forms` would leave forms disabled with nothing anywhere saying why.

`reportURI` is held to a different standard, because it is a URI reference rather than a host pattern and no wildcard belongs in one. Every form the CSP grammar allows is accepted, relative ones included, since a relative reference is resolved against the page the policy protected. What is rejected is a value that names no endpoint at all, such as `//` or `https://`, and a scheme a browser will not post violation reports over. Both look the same from the outside: a policy that appears to report and does not.

### Violation Reporting Needs Both Halves

`reportTo` names a reporting group. A group means nothing until a response defines it, and that definition lives in a separate header:

```typescript
securityHeaders({
  reportingEndpoints: { csp: 'https://reports.example.com/csp' },
  csp: { defaultSrc: ["'self'"], reportTo: 'csp', reportOnly: true },
});
```

Without `reportingEndpoints`, a policy carrying `report-to csp` reports to nowhere. That is the worst way for reporting to be off, because the only symptom is an absence: violations happen, nothing arrives, and the quiet is indistinguishable from having no violations. It is especially bad here, since `reportOnly` is the documented way to roll a policy out and the reports are the entire point of that mode.

So the pair is checked. A `csp.reportTo` naming a group `reportingEndpoints` does not define fails at startup. Naming a group the CSP never uses is fine, since the header is shared with the other reporting APIs.

When `reportingEndpoints` is absent entirely you get a startup warning rather than a failure, because that case is genuinely unknowable from here: the header may be coming from your reverse proxy or a hook of your own, and refusing to start would break a working deployment over a file this plugin cannot see.

Group names are lowercase. `Reporting-Endpoints` is a structured-headers dictionary, and RFC 8941 limits a member key to a leading lowercase letter or `*` followed by lowercase letters, digits, `_`, `-`, `.` and `*`, so `csp` and `network-errors` are fine and `CSP` is not. Both halves are held to that rule, `csp.reportTo` and a cross-origin policy's `reportTo` included, because a name outside it could never be defined. It is checked rather than left to the browser because of how it fails: an invalid key is not an entry a browser skips, it is a dictionary a browser cannot parse, so it drops the header whole and every group defined in it stops existing along with the bad one.

Endpoints must be absolute and `https`, or on localhost, which is a potentially trustworthy origin so a local collector works in development. A browser does not deliver reports over an insecure transport, and a relative URL has no base to resolve against by the time a report is queued. Both would otherwise produce a header that looks correct and delivers nothing.

`reportURI` is the older mechanism and needs none of this: it carries the URL directly. Several browsers still only implement that one, so sending both is reasonable.

### Roll It Out With `reportOnly`

```typescript
csp: { defaultSrc: ["'self'"], reportOnly: true }
```

Sends `Content-Security-Policy-Report-Only` instead. Violations are reported and nothing is blocked, so you find what a policy would break without breaking it. Worth staying here until the reports go quiet, especially on a site that is already serving traffic.

<!-- prettier-ignore -->
> [!IMPORTANT]
> `sandbox` is the one directive this cannot rehearse. A browser ignores it entirely in a report-only policy rather than reporting what it would have done, so it produces silence whether or not it would have broken the page. Unirend warns at startup when you set both. Verified: under an enforcing `sandbox allow-scripts` the document's `window.origin` is `"null"`, an opaque origin, and under the identical report-only policy it is the real origin.

`upgradeInsecureRequests` is a milder version of the same thing: in report-only it reports what it would have upgraded rather than upgrading, which is useful but is not a rehearsal of the upgrade itself.

### What Unirend Contributes Automatically

Unirend emits inline content of its own: the bootstrap script that assigns the injected SSR globals, and the styles on its built-in error pages. It knows what it emitted, so it adds the matching hashes to whichever directive a browser will actually consult for that content. Without that, a strict policy would block the framework's own bootstrap and render its error pages unstyled, which is exactly the trap that makes CSP support look present without being useful.

Two things worth knowing about how that works:

- It adds to the directive that **governs** the content, not to every directive it could. CSP fallback stops at the first directive you set rather than combining the chain, so the hashes follow it: `scriptSrcElem` and `scriptSrc` when you set them, and `defaultSrc` when you set neither, since that is what the browser reads instead. A policy of just `csp: { defaultSrc: ["'self'"] }` works, and the hashes land in `default-src`. One wrinkle, in your favor: setting only `scriptSrcElem` or `styleSrcElem` keeps `defaultSrc` covered as well, because the `-elem` directives shipped in Firefox 124 and a browser without them reads past to `defaultSrc`.
- It never creates a directive you did not write. If you configure `defaultSrc` alone, no `scriptSrc` appears in the output. Creating one would override `defaultSrc` for scripts and block whatever you expected `defaultSrc` to cover. An empty array counts as not written, because it serializes to nothing and the browser falls through it.
- Your own inline content is still yours to cover. Use [`hashInlineContentForCSP`](../utilities.md#content-security-policy-utilities), which is the same helper unirend uses.

### Your Own Inline Content Is Hashed Too

On SSR, unirend hashes the inline `<script>` and `<style>` blocks your template ships with, including anything the `headInlineScripts`, `bodyPrepend`, and `bodyAppend` slots contribute, and adds them to whichever directive governs that content for that app's responses. A theme flash-prevention script in `index.html` keeps working under a strict policy with nothing to configure.

The page your components render is covered too, and that half is hashed per request because it has to be. React 19 renders a hoistable `<style>` or `<script>` inline in the SSR stream, `dangerouslySetInnerHTML` can put one anywhere, and a component is free to render either directly, so those bytes are decided by the render rather than by the template. The scan runs on markup unirend has already parsed, and only when a policy is in force, so a server without a CSP pays nothing for it.

One thing it deliberately does not do on rendered markup is report inline attributes. React renders a `style` prop as a `style=""` attribute, so an ordinary styled component would trip the [inline-attribute warning](#inline-attributes-take-more-than-a-hash) on every request. That report is for your template, which is authored by hand and fixed for the life of the process. The attributes are still blocked either way, and the fix is the same one: move them out of the markup.

SSG works differently, because it has to. See [Prerendered Sites](#prerendered-sites-ssg) below.

Hashes are taken from the **final serialized output**, not from the values you passed in. That distinction is the whole reason this happens in the framework rather than in your config: the template pipeline parses and rewrites what it touches, so a hash computed from your input can differ from a hash of what actually ships, and CSP would then block the very script the hash was meant to allow, with no error anywhere.

Styles inside a `<noscript>` are covered as well. They only become live for visitors with JavaScript disabled, which is exactly when nobody is watching, so leaving them out would break the fallback for the people it exists for.

`<script type="importmap">` and `<script type="speculationrules">` are covered too, which is less obvious than it sounds. Neither is JavaScript and neither is ever executed, but `script-src` governs both, so a strict policy blocks them without a hash. The failure modes are opposite and both bad: a blocked import map takes every bare module specifier on the page down with it, and the errors read like a bundler fault rather than a CSP one, while a blocked speculation rules block breaks nothing at all and just quietly stops your site pre-rendering pages. A data block such as `application/json` or `application/ld+json` is genuinely outside `script-src` and correctly gets no hash, which is what lets unirend carry its own server context in one.

Costs are where you would want them. Production hashes once per app at startup. Development recomputes per request, because the template is re-read and Vite adds inline content of its own after unirend is done with it, and hashes taken earlier would miss exactly the scripts that only exist in development.

None of this happens unless a `csp` policy is configured.

### Prerendered Sites (SSG)

A prerendered site cannot work the way SSR does, and the reason is worth stating plainly: once `generateSSG` finishes, the site is a directory of files. There is no template left to hash and no render to hook into, and whatever serves those files afterwards may not be unirend at all. Nginx, Apache, a PHP host, or an object store are all perfectly ordinary ways to serve it.

So the hashes are produced at generation time, when the bytes are in hand, and handed back as data:

```typescript
const report = await generateSSG(buildDir, pages);

console.log(report.cspHashes.scriptSrc); // ["'sha256-…'", …]
console.log(report.cspHashes.styleSrc); // ["'sha256-…'", …]
```

They are taken from the bytes actually written and deduplicated across the whole site, so they cover your template's inline blocks and unirend's own bootstrap script together, and a two-hundred-page site normally yields a handful of entries rather than hundreds.

What you do with them depends on who serves the site. Serving it with unirend means feeding them into the policy:

```typescript
securityHeaders({
  csp: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", ...report.cspHashes.scriptSrc],
    styleSrc: ["'self'", ...report.cspHashes.styleSrc],
  },
});
```

Serving it with something else means writing them into that server's configuration. Either way the build step is the same, which is the point of returning them rather than wiring them into one particular way of serving files.

<!-- prettier-ignore -->
> [!IMPORTANT]
> Regenerate the policy whenever you regenerate the site. An inline block that changed by one character has a different hash, and the stale one fails closed: the script is blocked, the page still renders, and nothing says why.

`report.cspHashes.inlineAttributes` lists any `on*=` handlers and `style=""` attributes found, with the hash each would need. A plain hash source never matches an attribute, so these need `'unsafe-hashes'` alongside the hash, or the better fix of not writing them inline. See [Inline Attributes Take More Than a Hash](#inline-attributes-take-more-than-a-hash).

### Trusted Types

A source list governs which scripts a page may load. It says nothing about what those scripts then do, and `element.innerHTML = userInput` is the same DOM XSS whether the script that ran it was hashed or not. Trusted Types closes that half:

```typescript
csp: {
  defaultSrc: ["'self'"],
  requireTrustedTypesFor: ["'script'"],
  trustedTypes: ['default', 'dompurify', "'allow-duplicates'"],
}
```

With `requireTrustedTypesFor` set, assigning a plain string to `innerHTML`, `eval`, and the rest of the DOM's injection sinks throws unless the value came from a Trusted Types policy. That turns DOM XSS from something you audit for into something the browser refuses.

`trustedTypes` is the allowlist of policy names `trustedTypes.createPolicy` may create. `'allow-duplicates'` is worth knowing about: several bundlers and libraries create a policy of the same name more than once, and without it the second call throws.

`requireTrustedTypesFor: ["'script'"]` is the entire vocabulary today, and it is quoted, since it is a keyword. `["script"]` unquoted is refused rather than passed through, because a browser drops a sink group it does not recognize and leaves the sinks unguarded under a policy that reads as though it guards them.

Roll this one out with `reportOnly` too. It is the directive most likely to surface work in an existing codebase.

### `data:` in a Script Directive Is Refused

`script-src data:` is `'unsafe-inline'` under another name: it makes `<script src="data:text/javascript,...">` load, so an injected tag carries its own payload and needs no hash and no nonce. It is refused wherever it would govern script, `defaultSrc` included, and left alone everywhere it is ordinary and useful, such as `imgSrc` and `fontSrc`.

`*` in a script directive is _not_ refused, which looks inconsistent and is not. `*` does not match `data:`, `blob:`, or `filesystem:` and does not permit inline, so `script-src *` is a coarse policy rather than a bypass: it allows any host to serve your scripts, which is bad, and visible in the config you wrote. `data:` is a bypass, which is neither.

### Third-Party Widgets and `'strict-dynamic'`

This is the part most likely to bite you, so it is here rather than in a footnote.

Analytics, chat, and support widgets come in three shapes, and CSP treats them very differently.

**An external script.** `<script src="https://widget.example.com/x.js">` in a slot needs a **host source**, not a hash:

```typescript
csp: {
  scriptSrc: ["'self'", 'https://widget.example.com'];
}
```

**A purely inline snippet.** Already handled. Unirend hashes your slot content, so it works with nothing extra.

**An inline snippet that injects another script.** This is what Google Analytics, Intercom, and most of their peers actually ship, and it is where a policy that looked finished falls over. Hashing the snippet is not enough: the script _it_ creates at runtime is subject to `script-src` too, and it is not in your policy.

Two ways out.

List every origin the snippet reaches by hand, including the ones it loads transitively, which you will discover from violation reports and will have to revisit whenever the vendor changes anything:

```typescript
csp: {
  scriptSrc: ["'self'", 'https://widget.example.com', 'https://cdn.widget.example.com'],
}
```

Or use `'strict-dynamic'`, which says: a script already trusted by hash or nonce may load further scripts.

```typescript
csp: {
  scriptSrc: ["'self'", "'strict-dynamic'"],
}
```

There is no `strictDynamic: true` convenience option, deliberately. It is one entry in an array you are already writing, and a dedicated flag would hide which directive it lands in, which is exactly what you need to see.

<!-- prettier-ignore -->
> [!IMPORTANT]
> `'strict-dynamic'` makes browsers that support it **ignore host sources in that directive**. Writing `scriptSrc: ["'self'", "'strict-dynamic'", 'https://cdn.example.com']` does not mean "both": modern browsers drop `'self'` and the CDN host and trust only what a script trusted by hash or nonce loads. Older browsers do the opposite and ignore `'strict-dynamic'`. That combination is a deliberate, documented fallback pattern, not a mistake, but you should know which half of it each browser is reading.

The practical consequence: with `'strict-dynamic'`, a plain `<script src>` in your template stops being covered by a host source and needs to be loaded by a trusted script instead. Unirend does not rewrite your template to do that. Test with `reportOnly: true` first.

### `frameAncestors` and `frameOptions` Together

`frame-ancestors` supersedes `X-Frame-Options` wherever CSP is supported, which is everywhere that matters. So `frameOptions` is a fallback for browsers that would otherwise get no framing policy at all, and setting both is a reasonable thing to do.

A fallback may be **stricter** than the policy it backs up. `frameOptions: 'DENY'` alongside `frameAncestors: ["'self'"]` means an old browser refuses framing that a modern one permits, which is the safe direction to be wrong in.

It must not be **looser**. `frameOptions: 'SAMEORIGIN'` alongside an enforcing `frameAncestors: ["'none'"]` is rejected: a browser without CSP support would still allow same-origin framing that the policy exists to forbid, and you would have every reason to believe you had forbidden it everywhere.

`reportOnly: true` is exempt, because "supersedes" is doing real work in that first sentence. A report-only policy blocks nothing and displaces nothing, so `X-Frame-Options` stays in force for every browser alike and there is no weaker fallback to warn about. That keeps the rollout on offer: run `frameAncestors` in report-only against your live traffic, keep the header you already send, and the pair is only checked once you switch to enforcing.

The check runs at startup on the static config, and again on the effective policy whenever [`resolve`](#per-request-policy-with-resolve) produces one. Each block replaces rather than merges, so a resolver that overrides the CSP while inheriting `frameOptions`, or the reverse, assembles that pair out of two halves that are each fine on their own. It fails the same way there as it would at startup, rather than serving the tenant a combination the static config refuses.

Nothing else is rejected. A deliberate pairing such as `frameOptions: 'SAMEORIGIN'` with `frameAncestors: ["'self'", 'https://partner.example.com']` is a real pattern (modern browsers get the nuance, old ones get the blunt fallback) and is left alone.

### Inline Attributes Take More Than a Hash

A hash source on its own covers a `<script>` or `<style>` **element** and never an attribute, so `onclick="…"` and `style="…"` in your template stop working under a strict policy, with no error on the server and nothing in the page to say why.

Covering one takes `'unsafe-hashes'` in the governing directive **and** a hash of that attribute's exact value. The keyword alone permits nothing: all it does is make hash sources eligible to match attributes, so a directive carrying it still blocks every attribute whose value is not also listed.

```
script-src-attr 'unsafe-hashes'                    → onclick blocked
script-src-attr 'unsafe-hashes' 'sha256-<value>'   → onclick runs
```

Unirend detects these attributes and warns once per distinct finding, with the hash that would cover each one:

```
[securityHeaders] Template content carries inline attributes that this policy
blocks. A hash source alone never matches an attribute: it takes
'unsafe-hashes' plus the hash of that attribute's exact value, listed above.
  attribute: "<button> has onclick="
  directive: "script-src-attr"
  hash:      "'sha256-4RcNn9ptE…='"
```

The hash is reported because it is the one part you cannot work out later by hand: it covers the attribute value exactly as the browser parses it, entity references already decoded, and that value is only in hand while the template is being scanned.

The warning is skipped when the policy in force for the request already permits that attribute, so a decision you made deliberately is not repeated back to you on every startup.

"That attribute" is meant precisely. An `onclick=` and a `style=` are governed by different directives and a policy often permits one and blocks the other, so each finding is judged against the chain a browser would actually consult for it: `script-src-attr`, then `script-src`, then `default-src` for an event handler, and the `style-src` equivalents for a `style=`. Fallback stops at the first directive that is set rather than combining them, so `scriptSrcAttr: ["'none'"]` blocks handlers no matter how permissive `scriptSrc` is. An `'unsafe-inline'` in some other directive is not permission and silences nothing, and neither is one a browser is ignoring because a hash or nonce sits beside it (or, in a script directive only, `'strict-dynamic'`).

The fixes, best first: move an `on*` handler into an `addEventListener` inside a script unirend already hashes, and a `style=""` attribute into a `<style>` block or a class. The `'unsafe-hashes'` route works and is meaningfully worse, since a hash listed there matches that value on **any** element in the page rather than the one you meant.

### `'unsafe-inline'` and Automatic Hashes

If you set `'unsafe-inline'` in a directive **and it is actually in effect**, unirend contributes no hashes to it.

That is not a preference, it is the only way to keep your opt-in working. A browser ignores `'unsafe-inline'` as soon as a hash or nonce appears in the same source list, so adding hashes to a directive relying on it would revoke the permission you just granted and block every inline script or style on the page, under a header that still reads as though it allows them. Skipping costs nothing, because `'unsafe-inline'` already covers the content those hashes were for.

The "in effect" part matters as much as the keyword. Writing `'unsafe-inline'` is not the same as having it do anything:

| Source list | `'unsafe-inline'` | Unirend's hashes |
| --- | --- | --- |
| `["'unsafe-inline'"]` | In effect | Withheld, to preserve it |
| `["'unsafe-inline'", "'sha256-yours'"]` | Ignored by the browser | Added |
| `["'unsafe-inline'", "'nonce-…'"]` | Ignored by the browser | Added |
| `["'unsafe-inline'", "'strict-dynamic'"]` in a **script** directive | Ignored by the browser | Added |
| `["'unsafe-inline'", "'strict-dynamic'"]` in a **style** directive | In effect | Withheld, to preserve it |

Where the keyword is already ignored, the directive is matching on hashes and nonces alone, so withholding would preserve nothing and would leave unirend's own bootstrap script blocked unless your hash happened to be identical to it.

The last row is the one that surprises people. `'strict-dynamic'` is read only for scripts and script attributes, so in `style-src` it does nothing at all and your `'unsafe-inline'` keeps working. Treating it as script-like there would be worse than imprecise: unirend would contribute hashes to a policy that was working, and those hashes really do disable `'unsafe-inline'` for styles, so every inline style on the page would stop applying. A hash or nonce, by contrast, disables the keyword for both scripts and styles.

The decision is per directive. `scriptSrc: ["'unsafe-inline'"]` alongside a strict `scriptSrcElem` leaves the element directive getting its hashes as usual, which is right: when both are set, `script-src-elem` is the one a browser consults for an inline `<script>`.

Sources you wrote in the directive yourself are always kept. Only unirend's automatic additions are ever withheld.

The same "in effect" rule decides the [inline attribute warning](#inline-attributes-take-more-than-a-hash) above, so a policy pairing `'unsafe-inline'` with a hash still warns about an `onclick=` that the browser will block.

### Presets

`preset` gives a policy a sane starting point instead of twenty lines of directives:

```typescript
csp: {
  preset: 'strict',
  imgSrc: ["'self'", 'https://cdn.example.com'], // your own directives win
}
```

- **`strict`** — everything same-origin, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`. The one to start from, with `reportOnly: true` on, widening only where the reports say you must.
- **`strict-with-cdn`** — the same, plus `data:`/`blob:` images, `data:` fonts, and `blob:` workers, which is where a `strict` policy usually first meets reality. It still names no third-party host: add your CDN yourself, so it appears in your config rather than hiding inside a preset.

Directives you set **replace** the preset's for that directive rather than adding to it. Writing `imgSrc` means your `imgSrc`, not the preset's plus yours, so a preset can never quietly widen something you narrowed.

A directive you set to `undefined` counts as one you did not set, so it inherits the preset's. That matters when a policy is assembled from optional values, which is the normal shape once a CDN host or a feature flag is involved:

```typescript
csp: {
  preset: 'strict',
  imgSrc: cdnHost ? ["'self'", cdnHost] : undefined, // no CDN: keep the preset's
}
```

To drop a preset's directive on purpose, write an empty array. `frameAncestors: []` emits no `frame-ancestors` at all, and the browser falls through to whatever backs it up.

Two directives in these presets are worth knowing about because their value is not obvious. `object-src 'none'` shuts off `<object>` and `<embed>`, a legacy plugin surface with no modern use. `base-uri 'self'` stops an injected `<base href>` from redirecting every relative URL on the page, which is a quiet way around an otherwise tight `script-src`.

### Config-Time Validation

The policy is checked once at startup and the process fails to start on anything a browser would silently ignore, which is the failure mode CSP is worst at surfacing:

| Rejected | Why |
| --- | --- |
| `'self'` written unquoted as `self` | A browser reads it as a host name, matches nothing, and the policy is quietly stricter |
| `'unsafe-inline-scripts'` and other near-miss keywords | Ignored by the browser, so the directive is not what it looks like |
| `'none'` alongside other sources | `'none'` means "allow nothing", so combining it cannot be what was meant |
| A `javascript:` or scripting-scheme source | Reintroduces exactly the injection a policy exists to stop |
| A source containing whitespace, `;` or `,` | Would split into two entries or end the directive, letting a value rewrite the policy |
| A host the CORS origin validator rejects | Same validator, so `*.co.uk` fails identically in both places |
| An empty `reportTo` group name | Serializes to a bare `report-to` with no group, which a browser drops, silently turning reporting off |
| A `reportTo` group name outside the dictionary key charset | No `Reporting-Endpoints` key could define it, and a key like `CSP` makes that whole header unparsable, so every group in it stops existing |

Two require an explicit opt-in rather than being refused outright:

- `'unsafe-inline'` in a script directive needs `allowUnsafeInlineScript: true`. It is the one setting that stops a policy defending against the attack it exists for, and it is usually reached for to fix a single inline script. Unirend hashes its own inline content, so the common reasons to need it do not apply. It is **not** gated in `styleSrc`, which is a real but far narrower risk.
- `'unsafe-eval'` needs `allowUnsafeEval: true`. Some older bundlers and template engines still require it.

## Per-Request Policy With `resolve`

The case this exists for is customers mapping their own domains. A single static `hsts` applies to all of them, and `includeSubDomains` on a domain you do not own forces HTTPS across every other subdomain that customer has, honored for the full `maxAge` with no way to revoke it. A domain you do not control needs a shorter `maxAge` and no `includeSubDomains` or `preload`.

```typescript
securityHeaders({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameOptions: 'DENY',
  csp: { defaultSrc: ["'self'"] },

  resolve: async (request) => {
    const tenant = await lookupTenant(request.domainInfo.hostname);

    if (!tenant?.isCustomDomain) {
      return null; // defaults unchanged
    }

    return {
      hsts: { maxAge: 86400 }, // a domain we do not own
      csp: { defaultSrc: ["'self'", tenant.assetDomain] },
      frameOptions: false,
    };
  },
});
```

`resolve` may be async, and is called at most once per request. It can override every policy field: `csp`, `hsts`, `frameOptions`, `contentTypeOptions`, `referrerPolicy`, `permissionsPolicy`, the four cross-origin policies, and `reportingEndpoints`. CORS is deliberately not overridable here: `cors.origin` and `cors.credentials` already take request-aware functions, and a second mechanism would mean two places to look when an origin decision surprises you.

**Each block replaces the default outright rather than merging into it.** `hsts: { maxAge: 86400 }` sends exactly that, with no inherited `includeSubDomains`. A partial merge would quietly keep the baseline's flags, which is the exact combination an override is written to avoid.

The returned policy is validated with the same rules as the defaults, so a resolver cannot produce something the config would have rejected.

### Building an Override From the Baseline

Replacement is the right default, and it makes "the baseline with one field changed" tedious to write. The second argument is the configured policy, so you can spread what you want to keep:

```typescript
securityHeaders({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },

  resolve: async (request, baseline) => {
    const tenant = await lookupTenant(request.domainInfo.hostname);

    if (!tenant?.isCustomDomain) {
      return null;
    }

    // Keep includeSubDomains, shorten the max-age, drop preload.
    return { hsts: { ...baseline.hsts, maxAge: 86400, preload: false } };
  },
});
```

The merge stays yours to write, which is the point. What you kept is visible where you wrote it instead of being inferred from what you left out, so the automatic-merge failure mode never comes back: nothing is inherited into a block unless you put it there.

`baseline` is the same shape a resolver returns, so a helper that takes one and produces the other needs no separate type. It is also what an omitted block inherits, which makes it the honest answer to "what am I overriding".

**It is the policy as configured, not as expanded.** A `csp.preset` is still a `preset` here rather than the directives it stands for, which is what lets this work:

```typescript
resolve: async (request, baseline) => {
  const tenant = await lookupTenant(request.domainInfo.hostname);

  return { csp: { ...baseline.csp, scriptSrc: ["'self'", tenant.cdn] } };
},
```

The preset rides along and is expanded again on the way back, with your `scriptSrc` winning and the rest of the preset intact. If the baseline arrived pre-expanded, a resolver that stores what it built would bake a snapshot of the preset's directives into a tenant's saved policy, where they would quietly stop tracking the preset they came from.

**It is deeply frozen.** Editing it in place throws rather than leaking into every later request, since it is one object shared by all of them. Build a new object and return that. The freeze is on a copy, so your own config object stays writable.

It is called at most once per request, and not at all when [`domainValidation`](domainValidation.md) has refused the host. There is nothing to decide there: `resolve` picks a policy for a tenant, a refused host has none, and the 403 is unirend's own response rather than tenant content, so the configured defaults dress it. That also stops a `Host` header naming a domain that does not exist from costing you a store lookup per request, on requests refused before any of your own rate limiting saw them.

**Return `null` for "no override", and `null` specifically.** Anything else that is not a policy object is treated as a resolver that failed to answer, and fails the request the same way a throw does. That matters because the defaults include the baseline HSTS, which is written for domains you own: a store miss handing back `undefined` or `''` has not established that this request's domain is one to bind for a year, so it is not read as consent to the baseline.

**A key that is not a policy field fails the request too.** TypeScript rules that out for a typed resolver, which is exactly why there is a runtime check: the resolvers that need it are the ones reading a policy out of a JSON column or an admin form. A misspelling is the one mistake that would otherwise produce a perfectly valid policy, because the unknown key is dropped, which leaves the block absent, and an absent block inherits the baseline, which is what a correct resolver does. So `frameOption: false` would silently send the baseline's framing policy, and `hst: { maxAge: 86400 }` would silently send the baseline's year-long HSTS on a customer's domain, which is the single outcome `resolve` exists to prevent. Check a stored policy with [`validateSecurityHeadersPolicy`](#validating-a-policy-before-you-store-it) when you save it, so this surfaces in the form rather than on the tenant's next request.

### When `resolve` Throws

It propagates, and Fastify turns it into a 500, exactly like any other middleware that throws. There is no bespoke fallback, because unlike an allow-or-deny callback there is no obviously correct answer to substitute: the request is fine, it is the policy that could not be computed.

The error response still carries the defaults, but **no HSTS**. That is not a preference: the baseline is written for domains you own, and a domain whose policy could not be resolved may well not be one of them. Binding it for a year on the strength of a failed lookup is worse than the 500 that prompted it. The resolver is not called a second time while handling its own failure, so a throw throws once.

### Throwing on Purpose

Refusing to answer is a supported design choice, not only something that happens to you when a query fails. If the data a policy depends on is missing, throwing is often the right call:

```typescript
resolve: async (request) => {
  if (!db.isConnected) {
    throw new Error('Tenant store unavailable, refusing to guess a policy');
  }

  return lookupTenantPolicy(request.domainInfo.hostname);
};
```

The plugin cannot make this decision for you, because it cannot tell a genuine "no override needed" from "the lookup failed". Both arrive as a resolver that produced no override. Only you know which one it was:

| You want | Write | Result |
| --- | --- | --- |
| Fail loud | `throw` | 500, defaults applied, no HSTS unless [`ownDomains`](#keeping-hsts-for-hosts-you-own) matches |
| Serve anyway, on the safe baseline | `catch`, then `return null` | 200, defaults applied, HSTS included |
| Serve anyway, on something narrower | `catch`, then return a reduced policy | 200, your fallback policy |

Fail loud when the wrong policy is worse than no page. That is the usual case for custom domains, where falling back to a first-party baseline can bind a domain you do not own. Degrade when the resolver only ever tightens the baseline and the baseline is already correct for everyone:

```typescript
resolve: async (request) => {
  try {
    return await lookupTenantPolicy(request.domainInfo.hostname);
  } catch (error) {
    log.error(error);
    return null; // fall back to the validated defaults
  }
};
```

**This is also an alternative to [`setResolver`](#installing-a-resolver-later) for the startup window.** `setResolver` leaves requests arriving before the resolver is installed on the defaults, quietly. Registering the resolver at boot and having it throw while its dependency is missing makes that same window visible instead, at the cost of serving errors during it. Pick the quiet one when the defaults are a fine answer for early traffic, and the loud one when serving the baseline to a custom domain is the thing you are trying to prevent.

### Keeping HSTS for Hosts You Own

By default a failed `resolve` costs the response its HSTS, whatever the host. That is never wrong, but it is blunt: a store outage then drops HSTS for first-party traffic too, on domains you plainly own and had every intention of binding.

`ownDomains` makes the distinction explicit:

```typescript
securityHeaders({
  hsts: { maxAge: 31536000, includeSubDomains: true },
  ownDomains: ['example.com', '**.example.com'],
  resolve: async (request) => lookupTenantPolicy(request),
});
```

Now a failed resolve keeps the baseline HSTS when the request's host matches, and still sends nothing when it does not. Accepts the same patterns as `domainValidation.validProductionDomains`: an exact host, `*.example.com` for one level of subdomain, or `**.example.com` for any depth. An apex never matches a wildcard, so list it alongside as above. Entries are validated at startup, so one that could never match is a config-time error rather than a header quietly going missing during an outage.

List only what you genuinely control. A customer's mapped domain does not belong here even though you serve it, because that is exactly the domain this protection exists for: binding it for a year on the strength of a failed lookup is not yours to do.

### Where to Put the Plugin, and When `resolve` Runs

Three different questions get called "ordering", and they have different answers:

| Question | Answer |
| --- | --- |
| Where in `plugins` must `securityHeaders` go? | Anywhere. Position does not affect which responses get headers. |
| My resolver needs a database that is not connected at boot. | Register with a static baseline, then [`setResolver`](#installing-a-resolver-later). |
| My resolver reads something **another plugin** puts on the request. | Register `securityHeaders` **after** that plugin. |

**Position does not affect coverage.** The `onSend` backstop catches responses that ended before this plugin's `onRequest` ran, so a 403 from a gate listed earlier still carries the full header set. See [Plugin Order and Short-Circuited Responses](#plugin-order-and-short-circuited-responses).

That is what makes the third row safe: because position no longer decides coverage, you are free to place the plugin wherever your resolver's data needs it.

**A database lookup inside `resolve` is fine and expected.** `resolve` may be async and is awaited before any header is written. That is the ordinary case, not a special one:

```typescript
resolve: async (request) => {
  const tenant = await db.tenants.findByHost(request.domainInfo.hostname);
  return tenant?.isCustomDomain ? { hsts: { maxAge: 86400 } } : null;
};
```

The startup case is different, and is the one `setResolver` exists for: the resolver itself cannot be _constructed_ until a connection exists.

**What `resolve` can rely on.** It runs in this plugin's `onRequest`, so it sees whatever exists at that point. These are set by the server before any plugin runs, so they are available no matter where you put it:

- `request.domainInfo` — `{ hostname, rootDomain }`, which is what the examples key on
- `request.requestContext` — present but empty unless an earlier plugin filled it
- `request.requestID`, `request.clientIP`, `request.connectionIP`, `request.serverLabel`
- Everything on the raw request: `request.headers`, `request.url`, `request.method`, `request.hostname`, `request.protocol`, `request.cookies` if the cookies plugin is registered earlier

Anything a plugin sets is only there if that plugin ran first.

**Every callback receives the request**, not just `resolve`: `cors.origin(origin, request)`, `cors.credentials(origin, request)`, and on [`domainValidation`](domainValidation.md), `validProductionDomains(domain, request)` and `invalidDomainHandler(request, domain, isDevelopment, isAPIEndpoint)`. So per-request logic does not have to go through `resolve`, and for a pure origin decision it should not.

### Installing a Resolver Later

A resolver that needs a database cannot run at config time, but the plugin has to register early so its `onRequest` beats anything that might short-circuit. Keep the two separate:

```typescript
const headers = securityHeaders({ hsts: { maxAge: 31536000 } });
const server = serveSSRBuilt(buildDir, { plugins: [headers] });

await db.connect();
headers.setResolver(async (request) => lookupTenantPolicy(request));
```

Requests served before the resolver is installed get the validated defaults rather than an error. The handle is the plugin value itself, which you already hold from passing it to `plugins`.

If you would rather that window fail than serve the defaults, register the resolver at boot and have it [throw while its dependency is missing](#throwing-on-purpose) instead of using `setResolver` at all.

<!-- prettier-ignore -->
> [!WARNING]
> Do not move the plugin later in the `plugins` array to solve this. That reintroduces the ordering problem described below, where responses ending before the plugin runs go out with no security headers at all.

### Validating a Policy Before You Store It

A policy your own code wrote is checked at startup, and a mistake there is a deployment bug that should stop the boot. A policy a **customer** edited is a different problem: it lives in a database, and the same mistake is somebody mistyping a directive.

Left to the request path, that mistake surfaces as a 500 on the next request from the tenant it belongs to. The latest possible moment, in front of the wrong audience, and reported as a server error rather than as the form-validation failure it is.

`validateSecurityHeadersPolicy` applies exactly the rules the plugin applies and returns them as data:

```typescript
import { validateSecurityHeadersPolicy } from 'unirend/server';

app.put('/api/tenants/:id/security-policy', async (request, reply) => {
  const result = validateSecurityHeadersPolicy(request.body, {
    baseline: { frameOptions: 'DENY', csp: DEFAULT_POLICY },
  });

  if (!result.valid) {
    return reply.status(422).send({ errors: result.issues });
  }

  await saveTenantPolicy(request.params.id, result.policy);

  return { ok: true };
});
```

Each issue carries a `path` such as `csp.scriptSrc` or `hsts.maxAge`, so it can be attached to the field that caused it, and a `message` identical to what the plugin would have thrown. Every problem is reported, not just the first, because a form that reveals one error per submit makes the person fixing it play twenty questions.

It takes `unknown` on purpose, so a request body goes straight in with no cast. Nothing is assumed about the shape: a string, an array, a misspelled `frameOption`, `{ csp: null }`, or a `maxAge` that arrived as text all come back as issues rather than as a thrown `TypeError`. A validator that throws on malformed input would have failed at the one job it exists for, since the caller's alternative was already a `try`/`catch`.

Once it passes, `result.policy` is that same object with a type on it. Store that rather than the raw body, and the cast that would otherwise assert the very thing you came here to ask never has to be written.

<!-- prettier-ignore -->
> [!NOTE]
> `null` is reported rather than read as "not set", which matters if a JSON column or a form serializer produces it for an empty field. The two readings are opposite answers: inherit the baseline, or send no header at all. Write `false` for the second and omit the key for the first.

Pass `baseline` whenever the policy is an override rather than a complete config. Blocks replace rather than merge, so an override that sets only `csp` inherits `frameOptions` from the baseline, and the two can conflict even when each is fine on its own. Without the baseline that combination validates cleanly here and is then rejected at request time, which defeats the point of checking early.

The baseline is the same shape as the policy itself, and the same one [`resolve`](#building-an-override-from-the-baseline) receives, so the value a resolver was handed can be passed straight here. One notion of "the policy this layers over", wherever it is needed.

Give it every field the cross-checks read, not just the two in the example above. There are two pairs, and each can be assembled from one half of the override and one half of the baseline:

- **Framing:** `frameOptions` against `csp.frameAncestors`.
- **Reporting:** `reportingEndpoints` against `csp.reportTo` and against the `reportTo` on `crossOriginOpenerPolicy`, `crossOriginOpenerPolicyReportOnly`, `crossOriginEmbedderPolicy`, and `crossOriginEmbedderPolicyReportOnly`.

```typescript
const result = validateSecurityHeadersPolicy(request.body, {
  baseline: {
    frameOptions: 'DENY',
    csp: DEFAULT_POLICY,
    reportingEndpoints: { csp: 'https://reports.example.com/csp' },
    crossOriginOpenerPolicyReportOnly: {
      policy: 'same-origin',
      reportTo: 'coop',
    },
  },
});
```

Leave one out and the check it feeds simply does not run, which is the shape of the problem this is meant to catch rather than a smaller version of it: the group a tenant's `reportTo` names looks undefined, or looks defined, depending on a field the validator was never shown, and the request path then reaches the opposite verdict.

Two things it does not do:

- **It does not expand `csp.preset`.** Pass the policy as the author wrote it, so preset directives are not reported back as their mistakes.
- **It does not judge whether a policy is a good one.** A tenant can save `defaultSrc: ['*']` and this will accept it. It answers "will this work", not "is this wise".

The same function is worth calling in a migration or a nightly job over stored policies. Rules tighten between versions, and a policy that was valid when it was saved is not automatically valid now.

### Validating a CORS Block

`validateSecurityHeadersPolicy` covers what a `resolve` callback can return, which is everything except CORS. `validateCORSPolicy` covers the rest, applying the same rules `securityHeaders` applies to its `cors` option at startup:

```typescript
import { validateCORSPolicy } from 'unirend/server';

const result = validateCORSPolicy(loadCORSFromEnvironment());

if (!result.valid) {
  for (const issue of result.issues) {
    console.error(`cors.${issue.path}: ${issue.message}`);
  }

  process.exit(1);
}
```

Issues carry a `path` relative to the block itself, such as `origin` or `credentials`, and the same `message` the plugin would have thrown. Everything the plugin checks is checked here: the wildcard rules for `origin`, the stricter ones for a `credentials` allowlist, the combinations that would reflect arbitrary origins with credentials, and the field types, so a `maxAge` that arrived from JSON as `"600"` is an issue rather than a header value.

Where this is useful is anywhere a CORS block is assembled rather than written: a config file, an environment variable holding a comma-separated origin list, an admin screen. The alternative is a `try`/`catch` around server startup and one error per restart.

CORS is not a per-tenant policy, which is the one way it differs from the above. `securityHeaders` takes a single `cors` block at startup, and `origin` and `credentials` already accept request-aware functions, which is how CORS varies per request. So a block validated here is one to feed into `securityHeaders({ cors })`, not one to store per tenant.

<!-- prettier-ignore -->
> [!NOTE]
> `result.policy` is the block as written, not the normalized form. Registration fills in defaults and folds a `credentials` allowlist into the `origin` list, and neither belongs in a saved configuration.

## When a Callback Throws

`origin` and `credentials` accept functions, and a function that reaches a database, a cache, or a tenant lookup can fail. When one throws, the plugin fails closed rather than letting the error escape:

| Callback | On throw |
| --- | --- |
| `origin` | The origin is denied. No `Access-Control-Allow-Origin` header is sent. |
| `credentials` | Credentials are withheld. The origin decision stands, so CORS still applies. |

The error is logged once, through the request logger, at the point it is caught.

Denying rather than propagating is the important part. Propagating turns a policy that could not be evaluated into a 500, and a 500 is served to everyone, including the same-origin and non-browser traffic the callback was never consulted about. A denial costs one cross-origin caller its response and leaves the rest of the site working.

Each decision is computed at most once per request and reused for the rest of the lifecycle, including the error path and any hijacked response. So a callback that throws throws once. Before, the 500 it caused ran the error path, the error path applied security headers, and the callback was invoked a second time from inside the handler dealing with the first failure.

<!-- prettier-ignore -->
> [!NOTE]
> Fail-closed is a backstop, not a strategy. A callback that reaches a store should handle its own failures, since only you can tell a genuine "not allowed" from "the store is down" and decide whether a cached answer or a stricter default is better for your deployment.

These two fail closed while [`resolve`](#when-resolve-throws) propagates, because denying one origin has a safe meaning and substituting a whole policy does not. If one store backs several callbacks, a single outage can produce a denial from one and a 500 from another on the same request. [When a Callback Fails](../built-in-plugins.md#when-a-callback-fails) lists them side by side.

## Plugin Order and Short-Circuited Responses

Where you put `securityHeaders` in the `plugins` array does not change which responses get its headers.

That is worth stating because it is not what a hook alone would give you. The plugin does its work in an `onRequest` hook, and an `onRequest` hook only covers what runs after it, so a plugin listed earlier that ends the request never reaches it. `domainValidation` does exactly that for a 403 on an unauthorized host, a 400 on an unparseable `Host` header, and its canonical-domain, www, and HTTPS redirects, and any auth or gating plugin of your own does the same. Those responses used to go out with no CORS headers, no `X-Frame-Options`, and no HSTS.

The plugin also registers an `onSend` hook, which Fastify runs for every reply it sends no matter who sent it or when the hook was registered. Anything the `onRequest` pass missed is filled in there.

**This is not an error-page feature, and there is no status code or content type it checks for.** Headers go on as the response leaves, so every one of these carries the full set:

| Response | Covered |
| --- | --- |
| A handler that threw, rendered as a JSON 500 | Yes |
| An HTML error page | Yes |
| `reply.code(402).send({ error })`, or any early return | Yes |
| Fastify's built-in 404 for an unregistered route | Yes |
| A 403 or redirect from a gate registered above this plugin | Yes |
| A response sent after `reply.hijack()` | No, see [Hijacked Responses](#hijacked-responses) |

Two consequences to know about:

- Headers are filled in only where they are absent. A route or a gate that deliberately set its own value keeps it, so this backstop never overwrites a decision you made on purpose.
- Hijacked responses bypass `onSend` entirely and are covered separately. See [Hijacked Responses](#hijacked-responses).

**This does not generalize to gating plugins, including `domainValidation`.** Adding a header to a response is something `onSend` can still do on the way out. Blocking a request is not, because by then the response is already written. A gate only covers what was registered after it, so [`domainValidation` belongs first](domainValidation.md#plugin-order) while this plugin can go anywhere.

### HSTS on a Host the Server Has Not Claimed

One header is deliberately not filled in. When nothing has established that this server serves the request's host, `Strict-Transport-Security` is left off, and taken back off if an earlier pass already set it.

Two situations count, and the second is the quieter one.

**The host was checked and refused.** `domainValidation` returns 403 precisely because the domain is not one this server claims. Sending HSTS on that response would set an HTTPS policy for a domain the operator has just disclaimed, and the browser honors it for the full `maxAge` with no way to revoke it. The same applies to the 400 for a missing or unparseable `Host` header, where the host is not merely wrong but unknown.

**The host was never checked at all.** `domainValidation` is registered but never got to run, because a plugin above it ended the request first, which includes a hook that threw. The response is then an error page served to a host nothing has vouched for. Keying only on the rejection missed this: the verdict is unset, which reads the same as "the host passed", and the header went out binding whatever the client asked for.

<!-- prettier-ignore -->
> [!IMPORTANT]
> That second case is only covered when `domainValidation` is registered **before** `securityHeaders`. It is the one protection here that depends on plugin order, and it is a concrete reason for the [ordering guidance](domainValidation.md#plugin-order) beyond tidiness.

The reason is that "a response is being sent" is not the same as "every `onRequest` hook has run". This plugin answers a CORS preflight from inside its own `onRequest`, and `staticContent` serves a file from inside one too, so a `domainValidation` registered below either of them legitimately never runs on those requests. With the gate above, an unset verdict means the request died before it. With the gate below, an unset verdict is ambiguous, so only an explicit rejection counts and an unchecked host can still receive HSTS.

An explicit rejection is unambiguous either way and always drops the header.

Ordering is also still the real fix rather than a mitigation, and [`domainValidation` belongs first](domainValidation.md#plugin-order). The request still fails; this only keeps the failure from leaving a year-long promise behind.

Neither of these is keyed on the status code. A 403 from your own authorization logic, on a domain the server does serve, gets HSTS like any other response. The host is yours, the user simply is not allowed in. And a server with no `domainValidation` registered is unaffected by all of it: an unset verdict there means the question is not being asked, not that it was asked and went unanswered.

`domainValidation` publishes both facts, so your own hooks can read them wherever the same reasoning applies:

```ts
import { isHostUnverified } from 'unirend/server';

if (request.domainValidationRejected) {
  // Checked, and refused. Not a host this server claims.
}

if (isHostUnverified(request)) {
  // The above, plus "the gate never ran". Do not set policy headers that bind
  // this host, and think twice about what you show on the page.
}
```

`request.domainValidationRejected` is unset when `domainValidation` is not registered, or when it did not reject. See [Telling an Unchecked Host From a Rejected One](domainValidation.md#telling-an-unchecked-host-from-a-rejected-one) for the three states `isHostUnverified` distinguishes.

<!-- prettier-ignore -->
> [!NOTE]
> A rejected host still gets the rest of the header set. `X-Frame-Options` and CORS headers are cheap defense in depth, and the CORS headers in particular mean a cross-origin caller sees the real 403 instead of an opaque network error.

## Hijacked Responses

Most plugin authors do not need to think about this section. It matters when an internal feature or advanced plugin uses `reply.hijack()` / `reply.raw.writeHead(...)` and therefore bypasses Fastify's normal send path.

In those cases, Fastify's normal `onSend` pipeline will not run for that response.

When the `securityHeaders` plugin is registered, it decorates the request with an internal `request.applySecurityHeaders(reply)` helper. Hijacked/raw paths that need CORS headers should feature-detect that helper and call it before `writeHead(...)`:

```ts
await request.applySecurityHeaders?.(reply);
reply.hijack();
reply.raw.writeHead(statusCode, reply.getHeaders());
```

Apply the helper before `reply.hijack()`, not after. If CORS/header logic throws while Fastify still owns the reply, the normal error path can still run.

If the `securityHeaders` plugin is not registered, that helper will be absent and nothing extra needs to happen. Likewise, if your code stays on Fastify's normal managed response path and does not switch to `reply.hijack()` / raw `writeHead(...)`, the plugin's ordinary hook flow is enough.

Fastify `reply.hijack()` bypasses the normal `onSend` pipeline. For ordinary CORS-managed responses that is fine, because the plugin applies actual-response headers during `onRequest`. But a raw/hijacked path that ends the response with `reply.raw.writeHead(...)` must make sure those headers are on the reply before it snapshots `reply.getHeaders()`.

Unirend's built-in static content cache does this by calling the plugin's shared header helper before each raw `writeHead(...)`. If you build your own internal hijacked response path, follow the same pattern instead of assuming the CORS plugin's normal hook flow will run after hijack.

## Advanced Configuration

```typescript
// Comprehensive production setup
securityHeaders({
  cors: {
    origin: ['**.myapp.com', 'https://myapp.com'], // All subdomains + explicit apex
    credentials: [
      'https://app.myapp.com',
      'https://admin.myapp.com',
      'https://myapp.com',
    ], // Explicit credentials only - cookies sent automatically by browser
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'], // No need for "Cookie" header
    exposedHeaders: ['X-Total-Count', 'X-Rate-Limit'], // Non-safelisted headers need explicit exposure
    maxAge: 86400, // 24 hours preflight cache
    preflightContinue: false, // Handle OPTIONS completely
  },
});

// Client-side usage (cookies included automatically when credentials allowed)
fetch('https://api.myapp.com/data', {
  credentials: 'include', // Required to send cookies
  headers: {
    'Content-Type': 'application/json',
    Authorization: 'Bearer token123', // Custom auth headers need to be in allowedHeaders
  },
});

// Header reflection with fallback
securityHeaders({
  cors: {
    origin: '*',
    allowedHeaders: ['*'], // Reflects Access-Control-Request-Headers
    // If no headers requested, falls back to configured list (minus '*')
    // Reflection caps: at most 100 header names are reflected; names longer than 256 chars are ignored
  },
});

// Local development with private network access
securityHeaders({
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    allowPrivateNetwork: true, // Enable Chrome private network requests
  },
});

// Non-CORS security headers (off by default)
securityHeaders({
  cors: { origin: ['**.myapp.com', 'https://myapp.com'] },
  frameOptions: 'SAMEORIGIN', // or "DENY"
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  // HSTS is sent only on requests that arrived over HTTPS. Behind a
  // TLS-terminating proxy, set fastifyOptions.trustProxy so Fastify can tell.
});
```

## Advanced Use Cases

The dynamic nature of this plugin's CORS handling makes it perfect for:

- **Public APIs**: Accept requests from any origin while restricting credentials
- **Dynamic credentials**: Control cookie/auth header access per origin and request
- **Request-aware validation**: Different CORS rules based on URL path or headers
- **Granular control**: Mix wildcard origins with specific credential origins
- **Wildcard domains**: `*.example.com` supports subdomains with proper security
- **Performance optimization**: Built-in caching avoids redundant origin validation within a request lifecycle
- **Header aesthetics**: Preserves configured header casing in responses
- **Environment detection**: Different CORS rules based on environment detection
- **API versioning**: Different CORS rules for different API versions
- **Authentication flows**: Allow credentials only for authentication endpoints

## Security Benefits

Unlike traditional CORS libraries that apply the same credential policy to all allowed origins, this plugin lets you:

- Allow public API access without exposing user cookies to third parties
- Implement fine-grained security policies based on request context
- Prevent credential leakage while maintaining API accessibility
- Support complex authentication flows with multiple trusted domains

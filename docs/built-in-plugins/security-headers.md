# securityHeaders

<!-- toc -->

- [About](#about)
- [Key Features](#key-features)
- [Usage](#usage)
- [Configuration](#configuration)
  - [`cors`](#cors)
  - [Non-Negotiated Headers](#non-negotiated-headers)
- [Advanced Features](#advanced-features)
- [Security Notes](#security-notes)
  - [Security Model (at a Glance)](#security-model-at-a-glance)
- [Content-Security-Policy](#content-security-policy)
  - [Roll It Out With `reportOnly`](#roll-it-out-with-reportonly)
  - [What Unirend Contributes Automatically](#what-unirend-contributes-automatically)
  - [Your Own Inline Content Is Hashed Too](#your-own-inline-content-is-hashed-too)
  - [Third-Party Widgets and `'strict-dynamic'`](#third-party-widgets-and-strict-dynamic)
  - [`frameAncestors` and `frameOptions` Together](#frameancestors-and-frameoptions-together)
  - [Inline Attributes Cannot Be Hashed](#inline-attributes-cannot-be-hashed)
  - [Presets](#presets)
  - [Config-Time Validation](#config-time-validation)
- [Per-Request Policy With `resolve`](#per-request-policy-with-resolve)
  - [When `resolve` Throws](#when-resolve-throws)
  - [Throwing on Purpose](#throwing-on-purpose)
  - [Keeping HSTS for Hosts You Own](#keeping-hsts-for-hosts-you-own)
  - [Where to Put the Plugin, and When `resolve` Runs](#where-to-put-the-plugin-and-when-resolve-runs)
  - [Installing a Resolver Later](#installing-a-resolver-later)
- [When a Callback Throws](#when-a-callback-throws)
- [Plugin Order and Short-Circuited Responses](#plugin-order-and-short-circuited-responses)
  - [HSTS on a Rejected Host](#hsts-on-a-rejected-host)
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

Available source-list directives: `defaultSrc`, `scriptSrc`, `scriptSrcElem`, `scriptSrcAttr`, `styleSrc`, `styleSrcElem`, `styleSrcAttr`, `imgSrc`, `fontSrc`, `connectSrc`, `mediaSrc`, `objectSrc`, `childSrc`, `frameSrc`, `workerSrc`, `manifestSrc`, `prefetchSrc`, `formAction`, `frameAncestors`, `baseURI`. Alongside them: `sandbox` (an array of tokens, or an empty array for the bare directive), `upgradeInsecureRequests`, `reportURI`, and `reportTo`.

### Roll It Out With `reportOnly`

```typescript
csp: { defaultSrc: ["'self'"], reportOnly: true }
```

Sends `Content-Security-Policy-Report-Only` instead. Violations are reported and nothing is blocked, so you find what a policy would break without breaking it. Worth staying here until the reports go quiet, especially on a site that is already serving traffic.

### What Unirend Contributes Automatically

Unirend emits inline content of its own: the bootstrap script that assigns the injected SSR globals, and the styles on its built-in error pages. It knows what it emitted, so it adds the matching hashes to `scriptSrc` and `styleSrc` for you. Without that, a strict policy would render the framework's own error page unstyled, which is exactly the trap that makes CSP support look present without being useful.

Two things worth knowing about how that works:

- It only adds to a directive **you have set**. If you configure `defaultSrc` but not `scriptSrc`, no `scriptSrc` appears. Creating one would silently override `defaultSrc` for scripts and block whatever you expected `defaultSrc` to cover.
- Your own inline content is still yours to cover. Use [`hashInlineContentForCSP`](../utilities.md#content-security-policy-utilities), which is the same helper unirend uses.

### Your Own Inline Content Is Hashed Too

On SSR and SSG, unirend hashes the inline `<script>` and `<style>` blocks your template ships with, including anything the `headInlineScripts`, `bodyPrepend`, and `bodyAppend` slots contribute, and adds them to `scriptSrc` and `styleSrc` for that app's responses. A theme flash-prevention script in `index.html` keeps working under a strict policy with nothing to configure.

Hashes are taken from the **final serialized output**, not from the values you passed in. That distinction is the whole reason this happens in the framework rather than in your config: the template pipeline parses and rewrites what it touches, so a hash computed from your input can differ from a hash of what actually ships, and CSP would then block the very script the hash was meant to allow, with no error anywhere.

Styles inside a `<noscript>` are covered as well. They only become live for visitors with JavaScript disabled, which is exactly when nobody is watching, so leaving them out would break the fallback for the people it exists for.

Costs are where you would want them. Production hashes once per app at startup. Development recomputes per request, because the template is re-read and Vite adds inline content of its own after unirend is done with it, and hashes taken earlier would miss exactly the scripts that only exist in development.

None of this happens unless a `csp` policy is configured.

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

It must not be **looser**. `frameOptions: 'SAMEORIGIN'` alongside `frameAncestors: ["'none'"]` is rejected at startup: a browser without CSP support would still allow same-origin framing that the policy exists to forbid, and you would have every reason to believe you had forbidden it everywhere.

Nothing else is rejected. A deliberate pairing such as `frameOptions: 'SAMEORIGIN'` with `frameAncestors: ["'self'", 'https://partner.example.com']` is a real pattern (modern browsers get the nuance, old ones get the blunt fallback) and is left alone.

### Inline Attributes Cannot Be Hashed

A hash covers a `<script>` or `<style>` **element**. It never covers an attribute, so `onclick="…"` and `style="…"` in your template stop working under a strict policy, with no error on the server and nothing in the page to say why.

Unirend detects them and warns once per distinct finding:

```
[securityHeaders] Template content carries inline attributes that no CSP hash
can cover, so they will not run under this policy. <button> has onclick=
```

The warning is skipped entirely when your policy already sets `'unsafe-hashes'` or `'unsafe-inline'` in the relevant directive. If you have made that call deliberately, being told about it on every startup is how a warning gets tuned out.

The fixes, best first: move an `on*` handler into an `addEventListener` inside a script unirend already hashes, and a `style=""` attribute into a `<style>` block or a class. `'unsafe-hashes'` also works and is meaningfully worse, since it applies to every inline attribute on the page rather than the one you meant.

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

`resolve` may be async, and is called at most once per request. It can override `csp`, `hsts`, and `frameOptions`. CORS is deliberately not overridable here: `cors.origin` and `cors.credentials` already take request-aware functions, and a second mechanism would mean two places to look when an origin decision surprises you.

**Each block replaces the default outright rather than merging into it.** `hsts: { maxAge: 86400 }` sends exactly that, with no inherited `includeSubDomains`. A partial merge would quietly keep the baseline's flags, which is the exact combination an override is written to avoid.

The returned policy is validated with the same rules as the defaults, so a resolver cannot produce something the config would have rejected.

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

Now a failed resolve keeps the baseline HSTS when the request's host matches, and still sends nothing when it does not. Accepts the same patterns as `domainValidation.validProductionDomains`.

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

## Plugin Order and Short-Circuited Responses

Where you put `securityHeaders` in the `plugins` array does not change which responses get its headers.

That is worth stating because it is not what a hook alone would give you. The plugin does its work in an `onRequest` hook, and an `onRequest` hook only covers what runs after it, so a plugin listed earlier that ends the request never reaches it. `domainValidation` does exactly that for a 403 on an unauthorized host, a 400 on an unparseable `Host` header, and its canonical-domain, www, and HTTPS redirects, and any auth or gating plugin of your own does the same. Those responses used to go out with no CORS headers, no `X-Frame-Options`, and no HSTS.

The plugin also registers an `onSend` hook, which Fastify runs for every reply it sends no matter who sent it or when the hook was registered. Anything the `onRequest` pass missed is filled in there. Two consequences to know about:

- Headers are filled in only where they are absent. A route or a gate that deliberately set its own value keeps it, so this backstop never overwrites a decision you made on purpose.
- Hijacked responses bypass `onSend` entirely and are covered separately. See [Hijacked Responses](#hijacked-responses).

**This does not generalize to gating plugins, including `domainValidation`.** Adding a header to a response is something `onSend` can still do on the way out. Blocking a request is not, because by then the response is already written. A gate only covers what was registered after it, so [`domainValidation` belongs first](domainValidation.md#plugin-order) while this plugin can go anywhere.

### HSTS on a Rejected Host

One header is deliberately not filled in. When `domainValidation` rejects the request's host, `Strict-Transport-Security` is left off, and taken back off if it was already set.

`domainValidation` returns 403 precisely because the domain is not one this server claims. Sending HSTS on that response would set an HTTPS policy for a domain the operator has just disclaimed, and the browser honors it for the full `maxAge` with no way to revoke it. The same applies to the 400 for a missing or unparseable `Host` header, where the host is not merely wrong but unknown.

This is keyed on the rejection, not on the status code. A 403 from your own authorization logic, on a domain the server does serve, gets HSTS like any other response. The host is yours, the user simply is not allowed in.

`domainValidation` publishes the fact as `request.domainValidationRejected`, so your own hooks can read it wherever the same reasoning applies:

```ts
if (request.domainValidationRejected) {
  // Not a host this server claims. Do not set policy headers that bind it.
}
```

The property is unset when `domainValidation` is not registered, or when it did not reject.

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

# cors

<!-- toc -->

- [About](#about)
- [Key features](#key-features)
- [Usage](#usage)
- [Configuration](#configuration)
- [Advanced features](#advanced-features)
- [Security notes](#security-notes)
  - [Security model (at a glance)](#security-model-at-a-glance)
- [Advanced configuration](#advanced-configuration)
- [Advanced use cases](#advanced-use-cases)
- [Security benefits](#security-benefits)

<!-- tocstop -->

## About

The `cors` plugin provides dynamic CORS (Cross-Origin Resource Sharing) handling with advanced features not available in standard CORS libraries. Unlike `@fastify/cors`, this plugin supports dynamic credentials based on origin, allowing you to create public APIs while restricting credential access to trusted domains.

## Key features

- **Dynamic credentials**: Allow credentials only for specific origins while optionally accepting requests from any origin
- **Function-based validation**: Use custom logic to determine allowed origins and credential permissions
- **Separate policies**: Different rules for origin validation vs credential permissions
- **Request-aware decisions**: `origin` and `credentials` can be functions that receive the full Fastify request, so you can base decisions on path, headers, method, cookies, etc.
- **Request-level caching**: Origin validation is computed once per request and reused within that request lifecycle (e.g., across hooks)

## Usage

```typescript
import { cors } from "unirend/plugins";

const server = await serveSSRProd(buildDir, {
  plugins: [
    cors({
      origin: "*", // Allow any origin for public API access
      credentials: ["https://myapp.com", "https://admin.myapp.com"], // Only these can send cookies
      methods: ["GET", "POST", "PUT", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization"],
    }),
  ],
});
```

## Configuration

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
    - The string literal `"null"` does not match wildcards; include it explicitly if you wish to allow sandboxed/file contexts

- `credentials` (default: `false`): Which origins may send credentials (cookies, auth headers)
  - `boolean`:
    - `true`: allow credentials for the same origins that pass the `origin` policy.
      - Safeguards: `origin: "*"` is rejected with `credentials: true`; protocol wildcards (e.g., `"https://*"`) require `allowCredentialsWithProtocolWildcard: true`.
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
- `preflightContinue` (default: `false`): Whether to handle preflight OPTIONS requests automatically
- `optionsSuccessStatus` (default: `204`): Status code for successful preflight responses
- `allowPrivateNetwork` (default: `false`): Whether to allow private network requests (Chrome feature)
- `credentialsAllowWildcardSubdomains` (default: `false`): Allow wildcard subdomain patterns (e.g., `"*.example.com"`, `"**.example.com"`) in `credentials` arrays. Apex domains never match wildcards; include the apex explicitly (e.g., `"https://example.com"`).
- `allowCredentialsWithProtocolWildcard` (default: `false`): Opt-in to allow `credentials: true` when `origin` includes a protocol wildcard (e.g., `"https://*"`, `"http://*"`). Disabled by default for safety.

## Advanced features

- **Advanced Wildcard Support**:
  - `*.example.com` matches direct subdomains only (`api.example.com` ✅, `app.api.example.com` ❌)
  - `**.example.com` matches all subdomains including nested (`staging.api.example.com` ✅, `app.api.example.com` ✅)
  - `**` patterns require something before the remainder (e.g., `**.example.com` does NOT match `example.com`)
  - Protocol-specific wildcards: `https://*`, `http://*`, `https://*.example.com`
  - Apex domains do not match wildcard patterns; include the apex explicitly alongside subdomain patterns.
- **Punycode Normalization**: Handles international domains (IDN) safely with punycode conversion
- **Origin Normalization**: Case-robust matching; scheme and port are considered for origin comparisons (`https://app.com/` vs `https://app.com`)
- **Secure Credentials**: Raw wildcard tokens (`*`, `https://*`, `http://*`) are NOT allowed in credentials arrays. Subdomain wildcards (like `*.example.com`) are supported only when `credentialsAllowWildcardSubdomains: true`
  - The string literal `"null"` origin is never allowed in `credentials` arrays and will be rejected.
  - Even when using a credentials function, the literal `"null"` origin will never receive `Access-Control-Allow-Credentials: true`.
- **Header Preservation**: Maintains configured header casing (e.g., "Content-Type")
- **Private Network Support**: Configurable Chrome private network access feature
- **Declarative Methods**: Only returns methods that are actually configured

**Examples:**

```typescript
// Wildcard origins with explicit credentials (recommended)
cors({
  origin: ["**.myapp.com", "https://myapp.com"], // All subdomains + explicit apex
  credentials: ["https://app.myapp.com", "https://admin.myapp.com"], // Explicit only
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

// Protocol-specific wildcards
cors({
  origin: ["https://*.myapp.com"], // HTTPS subdomains
  credentials: ["https://app.myapp.com"],
  // To allow wildcard credentials for subdomains, enable the flag and list patterns explicitly
  // credentials: ["*.myapp.com"],
  // credentialsAllowWildcardSubdomains: true,
});

// Protocol wildcard + credentials (explicit opt-in)
cors({
  origin: ["https://*"],
  credentials: true,
  allowCredentialsWithProtocolWildcard: true,
});

// Global wildcard with explicit null (sandboxed/file contexts)
cors({
  origin: ["*", "null"],
  credentials: false,
});

// Mixed wildcard patterns (with explicit null)
cors({
  origin: ["https://*", "null"], // Any HTTPS + sandboxed/file contexts
  credentials: false, // No credentials for broad access
});

// Dynamic validation based on request path
cors({
  origin: (origin, request) => {
    // Allow any origin for public endpoints
    if (request.url?.startsWith("/api/public/")) return true;
    // Restrict private endpoints to trusted domains
    return origin === "https://myapp.com";
  },
  credentials: (origin, request) => {
    // Only allow credentials for auth endpoints from trusted origins
    return (
      request.url?.startsWith("/api/auth/") && origin === "https://myapp.com"
    );
  },
});

// Traditional CORS (like @fastify/cors)
cors({
  origin: ["https://myapp.com", "https://www.myapp.com"],
  credentials: true, // Allow credentials for all allowed origins
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: ["X-Total-Count"],
});

// Development setup with flexible origins
cors({
  origin: (origin, request) => {
    // Allow localhost and development domains
    if (!origin) return true; // Mobile apps, curl, etc.
    return (
      origin.includes("localhost") ||
      origin.includes("127.0.0.1") ||
      origin === "https://dev.myapp.com"
    );
  },
  credentials: true,
});
```

## Security notes

- **Credentials Security**: Raw wildcard patterns (`*`, `https://*`, `http://*`) are NOT allowed in `credentials` arrays and will throw an error. Only subdomain patterns like `*.example.com` are permitted when `credentialsAllowWildcardSubdomains: true`
- **Wildcard Patterns**:
  - `*.example.com` matches direct subdomains only (`api.example.com` ✅, `app.api.example.com` ❌)
  - `**.example.com` matches all subdomains including nested (`api.example.com` ✅, `app.api.example.com` ✅)
  - Protocol-specific: `https://*`, `https://*.example.com` for protocol-aware matching
- **International Domains**: All domains normalized with punycode for safe Unicode/IDN handling
- **Auto-Merging**: Credentials origins are automatically merged into the origin list to prevent configuration mistakes
- **Credentials Behavior**: The `credentials` option controls the `Access-Control-Allow-Credentials` header, which tells browsers whether to include cookies/auth headers in requests. When credentials are enabled, the browser automatically handles the `Cookie` header - you don't need to add "Cookie" to `allowedHeaders`. The client must still opt-in with `credentials: 'include'` in their fetch request.
- **Response Headers**: CORS-safelisted response headers (`Cache-Control`, `Content-Language`, `Content-Length`, `Content-Type`, `Expires`, `Last-Modified`, `Pragma`) are always accessible to clients. Use `exposedHeaders` to expose additional response headers like `X-Total-Count` or `Authorization`.
- **Protocol Wildcards + Credentials**: Using `credentials: true` with protocol wildcard origins (e.g., `"https://*"`) is blocked by default; set `allowCredentialsWithProtocolWildcard: true` to opt-in deliberately.
- Partial-label wildcards are invalid: Patterns like `"*foo.com"`, `"ex*.example.com"`, or `"foo*bar.com"` are rejected. Use full-label wildcards only: `"*.example.com"` (direct subdomains) or `"**.example.com"` (any depth).
- Origin array wildcard policy: In `origin: string[]`, allow at most one wildcard token overall (`"*"`, `"https://*"`, or `"http://*"`). If present, the only other allowed entry is the literal `"null"`.
- Credentials arrays restrictions: Raw wildcard tokens (`"*"`, `"https://*"`, `"http://*"`) are not allowed in `credentials` arrays and will throw. Use exact origins, or enable `credentialsAllowWildcardSubdomains: true` for domain wildcards like `"*.example.com"`.
- Header reflection hardening: When `allowedHeaders: ["*"]`, only syntactically valid HTTP header names (RFC 7230 token) are reflected from `Access-Control-Request-Headers`, and reflection is capped by count (100) and token length (256 chars).

### Security model (at a glance)

- We only echo the `Access-Control-Allow-Origin` header with the request's Origin after it passes policy (list/wildcard/function). Otherwise we omit the `Access-Control-Allow-Origin` header.
- We never combine `Access-Control-Allow-Origin: *` with `Access-Control-Allow-Credentials: true`. Configurations that attempt this are rejected.
- If you configure `origin: "*"` and also provide a `credentials` allowlist (array), we automatically upgrade the configuration so that responses echo the specific allowed origin (not `*`) and can include `Access-Control-Allow-Credentials: true` for those origins. Wildcard `*` is never sent together with credentials.
- We set `Vary: Origin` on CORS responses.
- The literal `"null"` origin can be allowed for non-credential requests (if included explicitly) but never receives credentials, even when using a credentials function.
- All origin/pattern entries are validated up-front (rejects PSL/IP tails, partial-label wildcards, URL-ish characters, and protocol/global wildcards where disallowed).
- Protocol wildcards (`https://*`, `http://*`) are permitted only in origin lists, not in credentials.
- Header reflection (`allowedHeaders: ["*"]`) reflects only what the browser requested, with caps: at most 100 header names; names longer than 256 characters are ignored.

## Advanced configuration

```typescript
// Comprehensive production setup
cors({
  origin: ["**.myapp.com", "https://myapp.com"], // All subdomains + explicit apex
  credentials: [
    "https://app.myapp.com",
    "https://admin.myapp.com",
    "https://myapp.com",
  ], // Explicit credentials only - cookies sent automatically by browser
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"], // No need for "Cookie" header
  exposedHeaders: ["X-Total-Count", "X-Rate-Limit"], // Non-safelisted headers need explicit exposure
  maxAge: 86400, // 24 hours preflight cache
  preflightContinue: false, // Handle OPTIONS completely
});

// Client-side usage (cookies included automatically when credentials allowed)
fetch("https://api.myapp.com/data", {
  credentials: "include", // Required to send cookies
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer token123", // Custom auth headers need to be in allowedHeaders
  },
});

// Header reflection with fallback
cors({
  origin: "*",
  allowedHeaders: ["*"], // Reflects Access-Control-Request-Headers
  // If no headers requested, falls back to configured list (minus '*')
  // Reflection caps: at most 100 header names are reflected; names longer than 256 chars are ignored
});

// Local development with private network access
cors({
  origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
  credentials: true,
  allowPrivateNetwork: true, // Enable Chrome private network requests
});
```

## Advanced use cases

The dynamic nature of this CORS plugin makes it perfect for:

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

## Security benefits

Unlike traditional CORS libraries that apply the same credential policy to all allowed origins, this plugin lets you:

- Allow public API access without exposing user cookies to third parties
- Implement fine-grained security policies based on request context
- Prevent credential leakage while maintaining API accessibility
- Support complex authentication flows with multiple trusted domains

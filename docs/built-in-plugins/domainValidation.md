# domainValidation

<!-- toc -->

- [About](#about)
- [Features](#features)
- [Usage](#usage)
- [Plugin Order](#plugin-order)
- [Configuration](#configuration)
- [Examples](#examples)
- [Proxy Support](#proxy-support)
  - [What to Set `trustProxy` To](#what-to-set-trustproxy-to)
  - [On Multi-Value Forwarded Headers](#on-multi-value-forwarded-headers)
- [Error Responses](#error-responses)
  - [`request.domainValidationRejected`](#requestdomainvalidationrejected)
  - [Telling an Unchecked Host From a Rejected One](#telling-an-unchecked-host-from-a-rejected-one)
  - [When a Callback Throws](#when-a-callback-throws)

<!-- tocstop -->

## About

The `domainValidation` plugin provides comprehensive domain security and normalization for production deployments. It handles domain validation, canonical redirects, HTTPS enforcement, and WWW prefix management.

## Features

- **Domain validation**: Validates requests against allowed production domains with wildcard support or request-aware custom logic
- **Canonical domain redirects**: Redirects to the preferred domain when multiple domains are configured
- **HTTPS enforcement**: Automatically redirects HTTP requests to HTTPS
- **WWW prefix handling**: Add or remove WWW prefix with smart apex domain detection (no changes to subdomains)
- **Punycode normalization**: Handles international domains (IDN) safely with punycode conversion
- **Proxy-aware**: Uses the host and protocol Fastify resolves from `fastifyOptions.trustProxy`, so proxy trust is configured once for the whole server
- **API endpoint detection**: Different error handling for API vs web requests
- **Single redirect**: Combines multiple redirect conditions to avoid redirect chains
- **Port preservation**: Configurable port handling for development and custom setups
- **Development-friendly**: Automatically skips validation for localhost, 127.0.0.1, ::1, and development mode

## Usage

```typescript
import { domainValidation } from 'unirend/plugins';

const server = serveSSRBuilt(buildDir, {
  plugins: [
    domainValidation({
      validProductionDomains: ['example.com', '*.example.com'],
      canonicalDomain: 'example.com',
      enforceHTTPS: true,
      wwwHandling: 'remove',
      redirectStatusCode: 301,
      skipInDevelopment: true,
    }),
  ],
});
```

## Plugin Order

**Register this plugin above every plugin that adds a per-request hook.** It works in an `onRequest` hook, and an `onRequest` hook only covers what was registered after it. Anything above it that ends the request never reaches this one, so that response goes out without the host ever being checked.

"Ends the request" includes **a hook that throws**. It did not mean to answer, but the error handler answers for it, and the result is a rendered error page on a host this plugin had not examined yet. The page itself is a minor matter, and only to the extent you have customized it. If `securityHeaders` is above this plugin, the response can also carry HSTS because the domain verdict is unset rather than rejected. Registering `domainValidation` before `securityHeaders` lets the header plugin recognize that the request never reached the gate and withhold HSTS from the unchecked host. See [A Hook That Throws Above the Gate](../built-in-plugins.md#a-hook-that-throws-above-the-gate).

A plugin that does its work at registration time is still fine above this one, because it adds no hook that can run or fail ahead of it. A database connection that `validProductionDomains` then reads belongs exactly there:

```typescript
plugins: [
  databasePlugin, // connects and decorates at registration, adds no hook
  domainValidation({
    validProductionDomains: async (domain, request) =>
      request.server.db.tenants.existsForHost(domain),
  }),
  sessionPlugin, // preHandler that can throw, so it goes below the gate
];
```

This is the opposite of what [`securityHeaders`](security-headers.md#plugin-order-and-short-circuited-responses) needs, which is worth knowing because the two are usually registered together and the difference looks arbitrary until you see why:

|  | `domainValidation` | `securityHeaders` |
| --- | --- | --- |
| What it does | **Blocks** a request | **Adds** headers to a response |
| Hooks | `onRequest` | `onRequest` plus an `onSend` backstop |
| Order matters? | **Yes, above anything with hooks** | Only for the unchecked-host HSTS safeguard |

A header can be filled in on the way out, which is what the `onSend` backstop in `securityHeaders` does for responses that ended before it ran. A block cannot be applied that late, because by then the response has already been written. A gate has to run before the thing it is gating, and nothing can retrofit that afterward.

So the two are complementary rather than inconsistent: register `domainValidation` ahead of whatever answers requests, and put it before `securityHeaders` when using HSTS. The ordinary headers still reach the 403s and redirects this plugin sends either way. See [Ordering](../built-in-plugins.md#ordering) for the same rule stated once across all the built-in plugins.

## Configuration

- `validProductionDomains` (optional): String when a single domain, array of allowed domains with wildcard support, or function for request-aware domain validation:
  - `"example.com"`: Exact match only
  - `"*.example.com"`: Direct subdomains only (`api.example.com` ✅, `app.api.example.com` ❌)
  - `"**.example.com"`: All subdomains including nested (`api.example.com` ✅, `app.api.example.com` ✅)
  - `function`: Dynamic validation `(domain, request) => boolean | Promise<boolean>`, where `domain` is normalized and `request` is the Fastify request
  - Note: Domain validation is protocol-agnostic (ignores http/https)
  - Apex domains never match wildcard entries, include the apex explicitly alongside subdomain patterns.
  - If not provided, domain validation is skipped. Use this to protect against unexpected domains pointing at your server (e.g., DNS misconfiguration or hostile `Host` headers). Requests from non-allowed hosts are always blocked, `invalidDomainHandler` only customizes the error response.
- `canonicalDomain` (optional): Preferred domain/host to redirect to when multiple domains are allowed
  - Provide a hostname or IP (IPv4 or IPv6), with no protocol
  - Use `wwwHandling` to add/remove the `www` prefix for apex domains
  - IPv6 hosts are bracketed automatically in redirects (you can pass either `2001:db8::1` or `[2001:db8::1]`)
  - Validated at startup, and it has to be a concrete host: a URL such as `https://example.com` and a pattern such as `*.example.com` are both refused. A value that is not a bare host normalizes to nothing, and the redirect skips its whole branch when that happens, so an unchecked one did not send requests somewhere slightly wrong, it switched canonical redirects off entirely. Patterns belong in `validProductionDomains`, which decides which hosts are allowed; this decides which one they are sent to.
- `enforceHTTPS` (default: `true`): Whether to redirect HTTP requests to HTTPS
- `wwwHandling` (default: `"preserve"`): How to handle www prefix:
  - `"add"`: Add www prefix to apex domains
  - `"remove"`: Remove www prefix from apex domains
  - `"preserve"`: Keep www prefix as-is
  - Checked at startup, because a near miss is a no-op rather than an error: an unrecognized value is not `"preserve"`, so it clears the gate, and then matches neither the add nor the remove branch.
- `redirectStatusCode` (default: `301`): HTTP status code for redirects. Must be `301`, `302`, `307`, or `308`, checked at startup. The value is written straight onto the response, and Fastify's `redirect()` honors a status already set there, so anything outside the redirect range sends a `Location` header no browser follows and quietly cancels both the canonical redirect and HTTPS enforcement.
- `skipInDevelopment` (default: `true`): Skip validation in development mode
  - This, `enforceHTTPS`, and `preservePort` must be real booleans, checked at startup. Each is read as a condition, so the string `"false"` out of a JSON config would be treated as `true`, and for this option that means skipping host validation altogether.
- `preservePort` (default: `false`): Whether to keep the port number when building a redirect URL
  - The port comes from the same resolved host everything else uses, so behind a trusted proxy it is the public port the browser connected to, not the internal one the app is listening on. Without `fastifyOptions.trustProxy` it is whatever port reached the app.
  - The port is always dropped when the protocol changes, since an HTTP port is meaningless on the HTTPS URL being redirected to. `preservePort` only applies to redirects that stay on the same protocol, such as a canonical domain or www change.
  - Mostly useful for non-standard ports: a development host, or an internal deployment reached directly on a port rather than through a proxy on 443.
- `invalidDomainHandler` (optional): Custom function to format the error response for blocked requests (e.g., JSON/text/HTML). Does not bypass validation or allow the request to proceed.
  - **Security Note**: When returning HTML with dynamic values, always escape them using `escapeHTML` from `unirend/utils` to prevent XSS attacks.

## Examples

```typescript
// Basic setup - validate domain and enforce HTTPS
domainValidation({
  validProductionDomains: ['example.com'],
});

// Single string form also works
domainValidation({
  validProductionDomains: 'example.com',
});

// Multiple domains with canonical redirect
domainValidation({
  validProductionDomains: ['example.com', 'www.example.com', 'example.org'],
  canonicalDomain: 'example.com',
  wwwHandling: 'remove',
});

// Wildcard subdomains with explicit apex and WWW addition
domainValidation({
  validProductionDomains: ['example.com', '**.example.com'], // Explicit apex + all subdomains
  wwwHandling: 'add',
});

// Direct subdomains only (more restrictive)
domainValidation({
  validProductionDomains: ['example.com', '*.example.com'], // Explicit apex + direct subdomains only
  wwwHandling: 'remove',
});

// Dynamic domain validation based on request context
domainValidation({
  validProductionDomains: async (domain, request) => {
    // Read headers, cookies, or values attached by earlier hooks/middleware.
    if (domain.endsWith('.preview.example.com')) {
      return request.headers['x-preview-token'] === process.env.PREVIEW_TOKEN;
    }

    return domain === 'example.com';
  },
});

// Custom error handling
// ⚠️ Security: Always escape dynamic values when returning HTML to prevent XSS
import { escapeHTML } from 'unirend/utils';

domainValidation({
  validProductionDomains: ['example.com'],
  invalidDomainHandler: (request, domain, isDev, isAPI) => ({
    contentType: 'html',
    content: `<h1>Access denied for ${escapeHTML(domain)}</h1>`,
  }),
});

// Custom development setup with port preservation
domainValidation({
  validProductionDomains: ['dev.example.com'],
  preservePort: true,
  skipInDevelopment: false,
});
```

## Proxy Support

The plugin does not read `x-forwarded-host` or `x-forwarded-proto` itself. It reads the host and protocol Fastify has already resolved, and Fastify consults those headers only when `fastifyOptions.trustProxy` says the peer that sent them may be believed. Proxy trust is therefore configured once, on the server, and applies to every plugin at the same time.

```typescript
const server = serveSSRBuilt(buildDir, {
  fastifyOptions: {
    // Name the proxy whenever the origin is reachable from anywhere else.
    trustProxy: '10.0.0.0/8',
  },
  plugins: [
    domainValidation({
      validProductionDomains: ['example.com'],
      canonicalDomain: 'example.com',
    }),
  ],
});
```

<!-- prettier-ignore -->
> [!IMPORTANT]
> Behind a proxy that terminates TLS, `enforceHTTPS: true` **requires** `fastifyOptions.trustProxy`. Without it Fastify sees the plain HTTP hop from the proxy, the plugin redirects to HTTPS, the proxy forwards HTTP again, and the browser reports `ERR_TOO_MANY_REDIRECTS`. An infinite redirect loop is the symptom, and the site is down until `trustProxy` is set. `canonicalDomain` fails the same way for the same reason: without a trusted `x-forwarded-host` the plugin compares against the internal upstream host rather than the public one, so it redirects on every request.

### What to Set `trustProxy` To

`fastifyOptions.trustProxy` accepts a boolean, an address, a CIDR range, a list, a hop count, or a predicate function.

- **Origin reachable only from the proxy** (bound to loopback, a private network, or a container network): `trustProxy: true` is fine, because no untrusted peer can open a connection in the first place.
- **Origin reachable from anywhere else**: name the proxy, for example `trustProxy: '10.0.0.0/8'` or its specific address. A bare `true` here is what lets any client forge `x-forwarded-host` and walk straight past domain validation.
- **A CDN in front of a proxy** (Cloudflare to OpenResty to the app) is more than one hop, so you need a hop count or the full trusted set rather than a single address.

### On Multi-Value Forwarded Headers

Fastify reads the **last** comma-separated entry, which is the one the trusted proxy appended. Earlier entries can be anything a client sent. nginx and OpenResty configured with `proxy_set_header X-Forwarded-Proto $scheme` overwrite rather than append, so a single-hop setup usually carries one value regardless.

Nothing is rewritten in the process: `request.headers` still holds the raw values while `request.host` and `request.protocol` report the resolved ones, so you can log both. See [Reading the Original vs. the Resolved Value](../https.md#reading-the-original-vs-the-resolved-value) for the full set of accessors.

## Error Responses

- **API endpoints**: Returns JSON error responses
- **Web requests**: Returns plain text error by default (or HTML if your custom handler returns it)
- **Custom handler**: Use `invalidDomainHandler` for custom error handling (domain validation failures only)
- **Missing/invalid Host header**: Returns `400 Bad Request` before any redirect logic runs, JSON for API endpoints, plain text for web requests. Not customizable (protocol-level error, not business logic).

### `request.domainValidationRejected`

Both rejection paths above set `request.domainValidationRejected` to `true` before responding. It means this server does not claim the request's host, which is narrower than "the response was a 403", since an authorization failure from your own application, on a domain the server does serve, never sets it.

[`securityHeaders`](security-headers.md#hsts-on-a-host-the-server-has-not-claimed) reads it to suppress `Strict-Transport-Security`, and your own hooks can read it wherever the same reasoning applies. Any header that binds a domain in the browser for a long time should not be sent for a domain the server has just disclaimed.

The property is unset when the plugin is not registered, or when it did not reject.

### Telling an Unchecked Host From a Rejected One

`domainValidationRejected` answers what the check concluded. It cannot answer whether a check happened at all, and those come apart in one case: a plugin above this one ends the request by throwing, this plugin never runs, and the error page renders on a host nothing has vouched for. See [A Hook That Throws Above the Gate](../built-in-plugins.md#a-hook-that-throws-above-the-gate).

`isHostUnverified` from `unirend/server` answers the combined question:

```typescript
import { isHostUnverified } from 'unirend/server';

if (isHostUnverified(request)) {
  return plainErrorPage();
}
```

It reads three signals, none of which answers alone:

| Signal | Set | Means |
| --- | --- | --- |
| `server.domainValidationRegistered` | Once, at registration | This server validates hosts at all |
| `request.domainValidationChecked` | First thing the hook does | The host was examined. Stays true for a pass, a rejection, a redirect, and a validator that failed |
| `request.domainValidationRejected` | On any disclaim | The host was refused, or could not be confirmed |

Which gives three outcomes:

- **Unverified**: the gate never ran, or ran and could not confirm the host.
- **Checked and not rejected**: the host passed. Render normally.
- **Not registered**: this server does not validate hosts, so there is nothing to be unverified against and the helper returns `false`. That last part is why the registration flag exists. Without it, a server not using this plugin would read as permanently unverified.

<!-- prettier-ignore -->
> [!NOTE]
> This is a suggestion for when you customize an error page, not a warning about the default one. Unirend's built-in 500 is a generic shell with nothing about your application in it, and [error-handling.md](../error-handling.md) already advises keeping a custom one standalone rather than wrapping it in your usual layout, so an error page is a reduced surface to begin with. The question only becomes interesting to the extent you add your name, your logo, or details about your deployment back into it.

The SSR starter template's `get-500-error-page.ts` ships with this check and returns a plain page when it matches, since that file exists to be customized. The API template shows the same condition for withholding `errorDetails` and for labeling the error code.

### When a Callback Throws

Both `validProductionDomains` as a function and `invalidDomainHandler` can fail, and the two are handled differently on purpose. One of them stops the request as a server error and one of them is absorbed, because one has decided nothing and the other has already decided everything that matters.

- **`validProductionDomains` throws**: the error propagates and your error handler turns it into a `500`. Access fails closed, because a validator that could not answer has not said the domain is yours, and reading "the tenant lookup timed out" as "welcome in" is how a `Host` header attack gets through on a bad day for the database. But it fails as a server error rather than a `403`, because the two mean different things: a `403` says the caller was understood and refused, and a lookup that never completed established nothing about the caller at all. Sending one would file an outage in your logs as an authorization failure and send whoever reads it looking for bad credentials. `invalidDomainHandler` is not consulted, since it phrases "this domain is not authorized" and that is not what happened.

  It propagates rather than answering from inside the plugin so that a store outage behaves like every other server-side failure and reaches the error handling you already have. The original error is kept as `cause`. Before it propagates, the host is marked disclaimed, so the response gets no HSTS and [`isHostUnverified`](#telling-an-unchecked-host-from-a-rejected-one) can recognize it as a special kind of `500`.

- **`invalidDomainHandler` throws**: the default rejection response is sent instead, from inside the plugin, and the error is logged once through the request logger. The rejection itself already happened and is not in question, so a throw here costs the custom wording and nothing else. The same fallback covers a handler that returns an unrecognized `contentType`, which previously matched no branch and left the request hanging with nothing sent at all.

**Only the `invalidDomainHandler` failure stays inside the plugin.** A `validProductionDomains` failure is a genuine `500` and reaches your error handler, and therefore your error page, like any other server-side failure. Do not read that as the validator being bypassed: access has already failed closed, and routing the outage through your own error handling is the point, since that is where your reporting and logging already are.

What it does mean is that an error page can render on a host this server was never able to confirm. That is why the host is marked disclaimed before the error propagates: [`isHostUnverified`](#telling-an-unchecked-host-from-a-rejected-one) is how the page recognizes the situation and decides how much to show. The same helper covers [a hook that throws above this plugin](../built-in-plugins.md#a-hook-that-throws-above-the-gate), where the gate never ran at all.

Both also mark the host [disclaimed](#requestdomainvalidationrejected), which is what keeps HSTS off a domain this server could not confirm is its own.

<!-- prettier-ignore -->
> [!NOTE]
> Fail-closed is a backstop, not a strategy. A validator that reaches a store should handle its own failures, since only you can tell a genuine "not one of ours" from "the store is down" and decide what your deployment should do about it.

If the same store also backs a `securityHeaders` callback, the two behave identically rather than disagreeing about what an outage means: `validProductionDomains` and [`resolve`](security-headers.md#when-resolve-throws) both propagate, and your error handler renders the `500` either way. [When a Callback Fails](../built-in-plugins.md#when-a-callback-fails) lists every one of them together.

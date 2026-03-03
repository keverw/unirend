# clientInfo

<!-- toc -->

- [About](#about)
- [Features](#features)
- [Usage](#usage)
- [Configuration](#configuration)
- [Examples](#examples)
- [Forwarded headers (SSR)](#forwarded-headers-ssr)
  - [Deployment note](#deployment-note)
- [Response headers](#response-headers)

<!-- tocstop -->

## About

The `clientInfo` plugin generates a unique request ID, normalizes basic client information (IP address, user agent), and provides a correlation ID for tracing requests across services. It decorates Fastify's `request` with a stable `requestID` and a read‑only `clientInfo` object, and can trust client details forwarded from your SSR server to API endpoint (when not short-circuiting within the same server process).

Use it to:

- Attach a consistent request identifier to logs and responses
- Trace a user action across SSR → API hops using a correlation ID
- Normalize IP/User‑Agent, optionally honoring forwarded headers from trusted sources

## Features

- **Per‑request IDs**: ULID by default (custom generator supported)
- **Correlation ID**: Uses `X-Correlation-ID` when trusted/valid, falls back to the request ID
- **SSR‑aware**: Optionally trusts forwarded client details from private/allowed sources
- **Request decoration**: Adds `request.requestID` and a frozen `request.clientInfo`
- **Response headers**: Sends `X-Request-ID` and `X-Correlation-ID` by default
- **Configurable logging hooks**: Opt-in request and forwarding logs, or pass `logging: true` to enable all

## Usage

```typescript
import { clientInfo } from 'unirend/plugins';

const server = serveSSRProd(buildDir, {
  plugins: [clientInfo()],
});
```

Inside handlers/hooks you can access:

```ts
request.requestID; // string
request.clientInfo; // { requestID, correlationID, isFromSSRServerAPICall, IPAddress, userAgent, isIPFromHeader, isUserAgentFromHeader }
```

## Configuration

- `requestIDGenerator?: () => string` — Custom generator (default: ULID)
- `requestIDValidator?: (id: string) => boolean` — Validator for forwarded IDs (default: ULID validation)
- `setResponseHeaders?: boolean` — Send `X-Request-ID` and `X-Correlation-ID` (default: `true`)
- `trustForwardedHeaders?: (request: FastifyRequest) => boolean` — Callback that determines whether to accept forwarded client-info headers (default: returns `true` when `request.clientIP` is private. Otherwise forwarded headers are ignored and direct request values are used)
- `logging?: boolean | { requestReceived?: boolean; forwardedClientInfo?: boolean; rejectedForwardedHeaders?: boolean }` —
  - `true`: enable all logs (request received, forwarded client info, rejected forwarded headers)
  - `false` or `undefined`: disable all logs (default)

Client info shape set on `request.clientInfo`:

```ts
type ClientInfo = {
  requestID: string;
  correlationID: string | null;
  isFromSSRServerAPICall: boolean;
  IPAddress: string;
  userAgent: string;
  isIPFromHeader: boolean;
  isUserAgentFromHeader: boolean;
};
```

## Examples

```typescript
// Custom ID generator + enable request logging
clientInfo({
  requestIDGenerator: () => `req_${Date.now()}`,
  logging: { requestReceived: true },
});

// Only trust forwarded headers behind an allowlist/proxy check
clientInfo({
  trustForwardedHeaders: (request) =>
    request.clientIP?.startsWith('10.') === true,
});

// Disable response headers if you prefer not to expose IDs
clientInfo({ setResponseHeaders: false });

// Enable all logging with a single flag
clientInfo({ logging: true });

// Explicitly disable all logging
clientInfo({ logging: false });
```

## Forwarded headers (SSR)

When `trustForwardedHeaders` returns `true`, the plugin will honor these request headers if present:

- `X-SSR-Request: "true"` — Marks the request as originating from SSR (`isFromSSRServerAPICall: true`)
- `X-SSR-Original-IP: <client-ip>` — Source IP from the browser/client
- `X-SSR-Forwarded-User-Agent: <ua>` — Original client user agent
- `X-Correlation-ID: <id>` — Correlation ID for tracing (validated via `requestIDValidator`)

This lets your SSR server forward the user's client details to your API so both hops share the same correlation ID. See also: `docs/ssr.md`.

### Deployment note

In production behind reverse proxies or load balancers, configure Fastify's `trustProxy` or `getClientIP` so `request.clientIP` reflects the real client IP. Unless you provide a custom `trustForwardedHeaders`, the plugin only accepts forwarded client-info headers when `request.clientIP` is private. Without one of those in place, `request.clientIP` may not reflect your proxy chain correctly.

- On SSR and API servers, set `fastifyOptions.trustProxy` or `getClientIP` when appropriate. Common `trustProxy` options are `true`, a trusted IP/CIDR value like `'127.0.0.1'` or `'127.0.0.1,192.168.1.1/24'`, a trusted IP/CIDR list like `['127.0.0.1', '10.0.0.0/8']`, or a custom trust function with signature `(address: string, hop: number) => boolean`. Fastify also supports numeric hop counts.
- Example: `serveSSRProd(buildDir, { fastifyOptions: { trustProxy: true }, plugins: [clientInfo()] })`
- Example with `getClientIP`:

```ts
serveSSRProd(buildDir, {
  getClientIP: (req) => {
    // Pseudo-code: only trust the external reverse proxy header when the request came from
    // a proxy or load balancer range you control.
    const fromTrustedProxyRange = isTrustedProxyRange(req.ip);
    const cfIP = req.headers['cf-connecting-ip'];

    if (fromTrustedProxyRange && typeof cfIP === 'string' && cfIP) {
      return cfIP;
    }

    return req.ip;
  },
  plugins: [clientInfo()],
});
```

- You can also use `trustProxy` and `getClientIP` together. For example, `trustProxy` can help you trust your load balancer and `getClientIP` can read the original client IP from an external reverse proxy header such as `CF-Connecting-IP`.
- You can also provide `trustForwardedHeaders` to further restrict when clientInfo accepts `X-SSR-Request`, `X-SSR-Original-IP`, `X-SSR-Forwarded-User-Agent`, and `X-Correlation-ID`. This does not change `request.clientIP`. It only controls whether those forwarded headers are used.

```ts
clientInfo({
  // e.g., only accept forwarded details when calls originate from your SSR/LB network
  trustForwardedHeaders: (request) =>
    request.clientIP?.startsWith('10.') === true,
});
```

## Response headers

By default, the plugin adds these to every response (configurable via `setResponseHeaders`):

- `X-Request-ID` — Unique ID for this request
- `X-Correlation-ID` — Correlation ID for the overall action (defaults to the request ID if not provided/valid)

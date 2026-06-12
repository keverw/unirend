# Client Identity

<!-- toc -->

- [About](#about)
- [connectionIP vs clientIP](#connectionip-vs-clientip)
- [Configuration](#configuration)
- [request.clientInfo](#requestclientinfo)
- [Forwarded Headers (SSR)](#forwarded-headers-ssr)
  - [Deployment Note](#deployment-note)
- [Response Headers](#response-headers)
- [Disabling](#disabling)

<!-- tocstop -->

## About

Unirend resolves client identity on every server (SSR, API, Static, Redirect). It's built in, with no plugin to register. In an early step (before access logging and your plugins), the framework sets:

- `request.connectionIP`: the connecting IP
- `request.clientIP`: the resolved real end user
- `request.userAgent`: the immediate-hop User-Agent header
- `request.clientUserAgent`: the resolved real end-user User-Agent
- `request.requestID`: the request ID (see [API Envelope Structure](./api-envelope-structure.md#request-id-handling))
- `request.clientInfo`: a frozen object with the correlation ID, forwarded-source flags, and resolved User-Agent

It is built in and **on by default**, configured via the `clientInfo` server option (or disabled with `clientInfo: false`).

## connectionIP vs clientIP

These answer different questions and are both always present:

- **`request.connectionIP`**: the trusted transport/source IP, either `request.ip` (after Fastify `fastifyOptions.trustProxy`) or the `getConnectionIP` resolver (e.g. `CF-Connecting-IP`). It's the base value for `clientIP`. Use it for connection-level decisions and debugging. Note it isn't necessarily the literal socket peer (a proxy/CDN/`trustProxy` may have rewritten it), and behind a CDN/proxy it can be a shared address. That makes it a poor key for per-user rate limiting, so use `request.clientIP` for that.
- **`request.clientIP`**: the **real end user**. It starts as `connectionIP`, then is replaced with the original browser IP forwarded by an SSR server (`X-SSR-Original-IP`) when client-info resolution is enabled (the default) and the connection is trusted. Use it for end-user attribution and per-user logic like rate limiting. It sees through CDNs / load balancers and the SSR → API hop.

| Scenario                     | `connectionIP`  | `clientIP`            |
| ---------------------------- | --------------- | --------------------- |
| Direct browser → server      | user's IP       | same as connectionIP  |
| Browser → SSR → API (on API) | SSR server's IP | original browser IP   |
| `getConnectionIP` configured | resolver result | inherits connectionIP |
| `clientInfo: false`          | unchanged       | always connectionIP   |

`connectionIP` and `clientIP` diverge in two topologies. With a CDN/proxy in front, point `getConnectionIP` at its header (e.g. `CF-Connecting-IP`) and `connectionIP` becomes the real client. For **direct** API access, `clientIP` already equals `connectionIP` and you don't need the SSR forwarding. The **SSR → API hop** is the other case: when your SSR server proxies page-data to a separate API backend, the API's connection _is_ the SSR server, so the forwarded `X-SSR-Original-IP` is what recovers the original browser into `clientIP`. Both layers can apply, with `getConnectionIP` at the edge and SSR forwarding across the internal hop.

Both are available throughout the request lifecycle, including both access-log hooks (`onRequest` and `onResponse`, since resolution runs before access logging), and as access-log template variables: `{{ip}}` (= `clientIP`) and `{{connectionIP}}`. The `getConnectionIP` server option customizes `connectionIP` (e.g. read `CF-Connecting-IP`). See [ssr.md](./ssr.md#shared-server-configuration).

## Configuration

The `clientInfo` server option accepts `ClientInfoConfig | false`:

- `forwardedRequestIDValidator?: (id: string) => boolean`: validator for the forwarded `X-Correlation-ID` from trusted SSR requests. Values that fail validation are ignored and the request ID is used as the correlation ID instead. Default: ULID validation. (The request ID itself comes from the `getRequestID` server option, not here.)
- `setResponseHeaders?: boolean`: send `X-Request-ID` and `X-Correlation-ID` response headers. Default: `true`.
- `trustForwardedHeaders?: false | 'local' | true | ((request: FastifyRequest) => boolean)`: whether to accept forwarded SSR headers (`X-SSR-Original-IP`, `X-SSR-Forwarded-User-Agent`, `X-Correlation-ID`, `X-SSR-Request`). **Default `false` (deny)**. Secure by default: forwarded headers are ignored and the direct connection values are used, so a client can't spoof its IP/UA. Opt in for a separated SSR → API hop:
  - `'local'`: trust when `request.connectionIP` is private. Convenient, but a private-IP proxy that forwards client headers can spoof it, so only use it when the API is network-isolated to your SSR tier (or `fastifyOptions.trustProxy` is set so `connectionIP` is the real external client). See [Deployment Note](#deployment-note).
  - `true`: always trust (the API is reachable only by your SSR tier).
  - function: custom per-request decision.
- `logging?: boolean | { requestReceived?: boolean; forwardedClientInfo?: boolean; rejectedForwardedHeaders?: boolean }`: opt-in diagnostic logs (off by default). `true` enables all. These report what resolution decides (request received, trusted forwarded info, rejected/spoofed headers). For normal per-request logging use [`accessLog`](./ssr.md#access-logging).

```typescript
import { serveAPI } from 'unirend/server';

const server = serveAPI({
  clientInfo: {
    // Only accept forwarded SSR headers from your internal network.
    // (The 'local' shortcut trusts any private IP; this narrows it to 10.x.)
    trustForwardedHeaders: (request) =>
      request.connectionIP.startsWith('10.') === true,
  },
});
```

## request.clientInfo

```ts
type ClientInfo = {
  requestID: string; // mirrors request.requestID
  correlationID: string; // forwarded value, or the request ID
  isFromSSRServerAPICall: boolean;
  connectionIP: string; // mirrors request.connectionIP
  clientIP: string; // mirrors request.clientIP (the real end user)
  userAgent: string; // resolved end-user UA (mirrors request.clientUserAgent)
  isIPFromHeader: boolean; // true when clientIP came from X-SSR-Original-IP
  isUserAgentFromHeader: boolean; // true when userAgent came from X-SSR-Forwarded-User-Agent
};
```

`clientInfo` is a frozen per-request snapshot. The canonical request accessors are `request.clientIP` (real end user), `request.connectionIP` (the connecting IP), `request.userAgent` (the immediate-hop User-Agent), and `request.clientUserAgent` (the resolved real end-user User-Agent). `clientInfo` mirrors the resolved end-user values and adds correlation/forwarding metadata. `isIPFromHeader` tells you whether `clientIP` was recovered from a trusted forwarded header, and `isUserAgentFromHeader` does the same for `clientUserAgent`. When `clientInfo: false`, `request.clientInfo` is `undefined`. `correlationID` is the forwarded `X-Correlation-ID` (when trusted) or the request ID, never `null`. Edge case: if `getRequestID` opts out (so `request.requestID` is `undefined`), `clientInfo.requestID` and `clientInfo.correlationID` are both `''` here. They are empty strings, not `undefined`/`null`.

TypeScript models `request.clientInfo` as optional because `clientInfo: false` disables the snapshot. `request.clientIP`, `request.connectionIP`, `request.userAgent`, and `request.clientUserAgent` remain plain strings and are always available.

## Forwarded Headers (SSR)

When the connection is trusted (`trustForwardedHeaders`), the framework honors these request headers if present:

- `X-SSR-Request: "true"`: marks the request as an SSR-forwarded hop (`isFromSSRServerAPICall: true`). **Required** to honor the IP / User-Agent recovery below.
- `X-SSR-Original-IP: <client-ip>`: original browser IP → `request.clientIP` (only when `X-SSR-Request: true`)
- `X-SSR-Forwarded-User-Agent: <ua>`: original client User-Agent → `request.clientUserAgent` and `clientInfo.userAgent` (only when `X-SSR-Request: true`)
- `X-Correlation-ID: <id>`: correlation ID for tracing (validated via `forwardedRequestIDValidator`). Honored from any trusted source **independently of `X-SSR-Request`**, since it's a standard cross-service tracing header. An upstream that isn't your SSR server can still propagate a trace ID. (It can therefore set `correlationID` while `isFromSSRServerAPICall` stays `false`.)

The SSR server sets these automatically on its page-data fetches (forwarding `request.clientIP` and `request.requestID`). When the receiving API trusts them, both hops share the same correlation ID. `trustForwardedHeaders` is off by default. See [Deployment Note](#deployment-note) and [ssr.md](./ssr.md).

### Deployment Note

By default, forwarded SSR headers are **not** trusted (`trustForwardedHeaders: false`), so a public client cannot spoof its IP/User-Agent. For a separated SSR → API deployment where the SSR forwards client details, opt in. Set `trustForwardedHeaders: 'local'` when the API is reachable only from your private SSR network, or `true` when it is fully network-isolated.

Either way, configure `fastifyOptions.trustProxy` or `getConnectionIP` so `request.connectionIP` reflects the right connecting IP. This matters for `'local'`: with `trustProxy` set, `connectionIP` becomes the real external client, so `'local'` correctly **rejects** public clients even when they arrive through a private-IP proxy. Without it, `connectionIP` is the proxy's private address and `'local'` would trust whatever headers that proxy forwards.

```ts
serveAPI({
  getConnectionIP: (req) => {
    // Only trust the external proxy header from a range you control.
    const fromTrustedProxyRange = isTrustedProxyRange(req.ip);
    const cfIP = req.headers['cf-connecting-ip'];
    if (fromTrustedProxyRange && typeof cfIP === 'string' && cfIP) return cfIP;
    return req.ip;
  },
});
```

## Response Headers

By default the framework adds these to every response (configurable via `setResponseHeaders`):

- `X-Request-ID`: unique ID for this request
- `X-Correlation-ID`: correlation ID for the overall action (defaults to the request ID if none was forwarded/valid)

Empty headers are never emitted: if you opt out of request-ID generation via `getRequestID`, these headers are skipped.

## Disabling

Pass `clientInfo: false` to turn off resolution entirely. Then `request.clientIP` equals `request.connectionIP` (no SSR forwarding), `request.userAgent` stays the raw `User-Agent` header or `''` when absent, `request.clientUserAgent` equals `request.userAgent`, `request.clientInfo` is `undefined`, and no `X-Request-ID` / `X-Correlation-ID` headers are emitted. The envelope `request_id` still works (it comes from the server, not this resolution).

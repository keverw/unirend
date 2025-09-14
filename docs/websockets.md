# WebSockets

<!-- toc -->

- [Overview](#overview)
- [Enable WebSockets](#enable-websockets)
- [Register Handlers](#register-handlers)
  - [preValidate: upgrade vs reject](#prevalidate-upgrade-vs-reject)
  - [Handler signature](#handler-signature)
- [Options](#options)
- [Accessing Connected Clients](#accessing-connected-clients)
  - [Broadcasting example](#broadcasting-example)
- [Demo](#demo)
- [Behavior notes](#behavior-notes)
- [Known Issues (Bun)](#known-issues-bun)

<!-- tocstop -->

## Overview

Both `SSRServer` and `APIServer` support WebSockets via `@fastify/websocket` on the underlying Fastify server. Unirend provides a helper to:

- Register WebSocket routes consistently on either server
- Perform pre‑validation before the upgrade and return standardized API envelopes on rejection
- Gracefully close connections during shutdown

Under the hood, the `WebSocketServerHelpers` class wires `@fastify/websocket`, a `preValidation` hook for upgrade decisions, and binds your handlers.

## Enable WebSockets

Enable support when creating the server. Works for both SSR dev/prod and the standalone API server:

```ts
import { serveSSRDev, serveSSRProd, serveAPI } from "unirend/server";

// SSR (dev)
const ssr = serveSSRDev(
  {
    serverEntry: "./src/entry-server.tsx",
    template: "./index.html",
    viteConfig: "./vite.config.ts",
  },
  {
    enableWebSockets: true,
    webSocketOptions: {
      /* optional */
    },
  },
);

// SSR (prod)
const ssrProd = serveSSRProd("./build", {
  enableWebSockets: true,
  webSocketOptions: {
    /* optional */
  },
});

// API server
const api = serveAPI({
  enableWebSockets: true,
  webSocketOptions: {
    /* optional */
  },
});
```

## Register Handlers

Use `server.registerWebSocketHandler({ path, preValidate?, handler })` on either server instance:

```ts
server.registerWebSocketHandler({
  path: "/ws/echo",
  preValidate: async (request) => {
    const ok = (request.query as Record<string, string>)["token"] === "yes";

    if (!ok) {
      return {
        action: "reject",
        envelope: APIResponseHelpers.createAPIErrorResponse({
          request,
          statusCode: 401,
          errorCode: "websocket_invalid_token",
          errorMessage: "Missing or invalid token",
        }),
      };
    }

    return { action: "upgrade", data: { authenticated: true } };
  },
  handler: (socket, request, upgradeData) => {
    socket.send(JSON.stringify({ type: "welcome", upgradeData }));
    socket.on("message", (msg) => socket.send(msg.toString()));

    socket.on("close", () => {
      console.log("WebSocket disconnected");
    });
  },
});
```

### preValidate: upgrade vs reject

`preValidate(request)` can return one of:

- `{ action: "upgrade", data?: Record<string, unknown> }` — allow the upgrade; `data` is passed to your handler
- `{ action: "reject", envelope: APIResponseEnvelope }` — send the JSON envelope (with your status code) and do not upgrade the connection

If `preValidate` throws, a standardized 500 envelope is sent.

### Handler signature

```ts
type WebSocketHandler = (
  socket: WebSocket,
  request: FastifyRequest,
  upgradeData?: Record<string, unknown>,
) => void | Promise<void>;
```

The `upgradeData` is whatever you returned from `preValidate` when `action === "upgrade"`.

## Options

`webSocketOptions` (for both servers):

- `perMessageDeflate?: boolean` — enable permessage‑deflate (default `false`)
- `maxPayload?: number` — max message size in bytes (default `100MB`)
- `preClose?: (clients: Set<unknown>) => Promise<void>` — called on server shutdown so you can broadcast and close connections gracefully

Example graceful shutdown:

```ts
webSocketOptions: {
  preClose: async (clients) => {
    for (const client of clients) {
      (client as { close: (code: number, reason: string) => void }).close(
        1001,
        "Server shutting down"
      );
    }
  },
}
```

## Accessing Connected Clients

Both servers expose `getWebSocketClients(): Set<unknown>`:

```ts
const count = server.getWebSocketClients().size;
```

Useful for stats endpoints or broadcasting.

### Broadcasting example

```ts
// Broadcast a JSON message to all connected clients
for (const client of server.getWebSocketClients()) {
  (client as { readyState: number; send: (data: string) => void }).send(
    JSON.stringify({ type: "broadcast", at: new Date().toISOString() }),
  );
}
```

## Demo

See a complete working example in `demos/ws-server-demo.ts`. It registers several endpoints (always‑allow, always‑reject, token‑validation, echo) on both an SSR dev server and a standalone API server, plus graceful shutdown handling and a stats endpoint.

Run:

```bash
bun run demos/ws-server-demo.ts
```

## Behavior notes

- Paths must match exactly (no wildcards). If you register the same path multiple times, the last registration wins.
- If no handler is registered for the requested path, the upgrade is blocked and a 404 JSON envelope is returned.
- If the `Connection`/`Upgrade` headers are invalid for a WebSocket upgrade, a 400 JSON error response is sent and the connection is not upgraded.
- When a `preValidate` is present but does not return `{ action: "upgrade" }`, the server prevents the upgrade; any attempt to connect to the handler will be closed with code `1008`.

## Known Issues (Bun)

When running with Bun, Fastify's WebSocket `preValidation` interactions can hang under certain conditions. Track progress here: [Fastify Websocket preValidation hook hangs server](https://github.com/oven-sh/bun/issues/22119).

Workarounds you can consider if you hit this in Bun environments:

- Allow upgrade, check auth on first connection, then immediately close on first message if unauthorized
- Use Bun Build to create a server bundle targeting Node, and run under that environment.

Node.js does not exhibit this hang with the same code paths.

Recommendation:

- Until the Bun issue is resolved, avoid enabling WebSockets when running this server under Bun. Prefer running under Node.js directly, or bundle with Bun Build targeting Node and run the result with Node.

Bundling note (Bun Build):

- When bundling with Bun, you may need to externalize `vite` to avoid transitive resolution errors (e.g., lightningcss). Example:

```bash
bun build ./demos/ws-server-demo.ts \
  --outfile ./tmp/unirend-ws-test/ws-server-demo.cjs \
  --target node \
  --format cjs \
  --external vite
```

# Lifecycleion Logger Adaptor

`UnirendLifecycleionLoggerAdaptor` wraps a [Lifecycleion](https://github.com/keverw/lifecycleion) logger as a `UnirendLoggerObject`, so you can pass it directly to the `logging.logger` option of any Unirend server. This lets you use a single Lifecycleion logger across your entire application — server startup and lifecycle events, background jobs, and Fastify request handling — with all logs routed through the same sinks (console, file, pipe, array, etc.).

<!-- toc -->

- [Basic Usage](#basic-usage)
- [Using a Service or Entity Logger](#using-a-service-or-entity-logger)
- [Context Options (`context.logger`)](#context-options-contextlogger)
  - [Template Rendering with Params](#template-rendering-with-params)
  - [Redaction](#redaction)
  - [Tags](#tags)
- [Level Mapping](#level-mapping)
- [Fastify Bindings and Context](#fastify-bindings-and-context)
  - [Argument Order Gotcha](#argument-order-gotcha)
- [Object and Array Log Edge Case](#object-and-array-log-edge-case)

<!-- tocstop -->

## Basic Usage

Create a Lifecycleion `Logger` instance, pass it to `UnirendLifecycleionLoggerAdaptor`, then pass that as the `logging.logger` option on the server:

```typescript
import { Logger, ConsoleSink } from 'lifecycleion';
import { UnirendLifecycleionLoggerAdaptor, serveSSRProd } from 'unirend/server';

const logger = new Logger({
  sinks: [new ConsoleSink()],
});

const server = serveSSRProd('./build', {
  logging: {
    level: 'info',
    logger: UnirendLifecycleionLoggerAdaptor(logger),
  },
});

await server.listen({ port: 3000 });
```

Works identically with `serveAPI`, `StaticWebServer`, and `RedirectServer`.

## Using a Service or Entity Logger

You can pass a `LoggerService` (created via `logger.service(name)`) or an entity logger (`loggerService.entity(name)`) — they all have the same log-method interface:

```typescript
const serverLogger = logger.service('Server');

const server = serveSSRProd('./build', {
  logging: {
    logger: UnirendLifecycleionLoggerAdaptor(serverLogger),
  },
});
```

All Fastify/Unirend logs will include `serviceName: 'Server'` as a field on each Lifecycleion log entry. This scopes server logs under their own service name rather than the root logger — useful when you want to separate server logs from the rest of your application (e.g. name it `'SSRServer'` or `'APIServer'` to match your setup).

## Context Options (`context.logger`)

`request.log` and `pluginHost.log` accept a `logger` key in the context object (the first argument in pino's `(obj, msg)` order) to pass Lifecycleion-specific options. Use the `LifecycleionLogContextOptions` type for the value.

### Template Rendering with Params

Lifecycleion supports `{{variableName}}` placeholders in log messages. Pass a `params` field to supply values:

```typescript
import type { LifecycleionLogContextOptions } from 'unirend/server';

// Inside a route or data loader handler:
const logCtx: LifecycleionLogContextOptions = {
  params: { userId: 'u_abc123', action: 'login' },
};

request.log.info({ logger: logCtx }, 'User {{userId}} performed {{action}}');
// Lifecycleion renders: "User u_abc123 performed login"
```

Dot notation and array indexing work as Lifecycleion supports them:

```typescript
request.log.warn(
  { logger: { params: { req: { ip: '1.2.3.4' } } } },
  'Request from {{req.ip}} failed',
);
```

### Redaction

Sensitive values in params can be redacted in Lifecycleion output using `redactedKeys`. The redaction behavior depends on your Lifecycleion logger's `redactFunction` configuration.

```typescript
request.log.info(
  {
    logger: {
      params: { username: 'alice', password: 'secret123' },
      redactedKeys: ['password'],
    },
  },
  'Auth attempt for {{username}}',
);
// "password" is redacted in sinks; "username" is rendered in the template
```

### Tags

Pass `tags` to attach categorization labels to the Lifecycleion log entry:

```typescript
request.log.error(
  {
    logger: {
      params: { orderId: 'ord_999' },
      tags: ['billing', 'critical'],
    },
  },
  'Payment failed for order {{orderId}}',
);
```

## Level Mapping

Lifecycleion has a different level set from Unirend/Fastify. The adaptor maps levels as follows:

| Unirend / Fastify | Lifecycleion | Note                            |
| ----------------- | ------------ | ------------------------------- |
| `trace`           | `debug`      | Lifecycleion has no trace level |
| `debug`           | `debug`      |                                 |
| `info`            | `info`       |                                 |
| `warn`            | `warn`       |                                 |
| `error`           | `error`      |                                 |
| `fatal`           | `error`      | Lifecycleion has no fatal level |

The `level` option in `logging.level` controls what Fastify emits — logs below the threshold are filtered before reaching the adaptor.

## Fastify Bindings and Context

Both `request.log` (per-request) and `pluginHost.log` (server-level, available during plugin setup or background tasks) route through the same adaptor and use pino's `(obj, msg)` argument order:

```typescript
const myPlugin: ServerPlugin = (pluginHost) => {
  pluginHost.log.info(
    { logger: { params: { name: 'myPlugin' } } },
    'Plugin {{name}} registered',
  );
};
```

Fastify/pino automatically attaches bindings (like `reqId`, `pid`, `hostname`) to child loggers for each request. These are useful for pino's JSON serializer but are **not automatically forwarded** to Lifecycleion params — passing them all would be verbose and most sinks don't need them.

If you want specific Fastify request metadata available in Lifecycleion template rendering or redaction, pass it explicitly via `context.logger.params`:

```typescript
const authPlugin: ServerPlugin = (pluginHost) => {
  pluginHost.addHook('preHandler', async (request) => {
    request.log.warn(
      {
        logger: {
          params: { reqId: request.id, url: request.url },
          tags: ['auth'],
        },
      },
      'Unauthorized request {{reqId}} to {{url}}',
    );
  });
};
```

### Argument Order Gotcha

`request.log` is pino (Fastify's built-in logger) — if you're used to calling Lifecycleion directly, note that pino flips the argument order to `(obj, msg)` instead of `(message, options)`. **TypeScript will not catch the wrong order** — passing the message first compiles fine but silently drops your params.

Always use `(obj, msg)` when calling `request.log` directly:

```typescript
// ✅ Correct — obj first, message second
request.log.info({ logger: { params: { id: 'u_1' } } }, 'User {{id}} loaded');

// ❌ Silent bug — params never reach Lifecycleion
request.log.info('User {{id}} loaded', { logger: { params: { id: 'u_1' } } });
```

## Object and Array Log Edge Case

Pino (which Fastify uses internally) allows logging a plain object with no message string: `logger.info({ foo: 'bar' })`. When this happens, Unirend's normalization layer produces an empty string `''` as the message and wraps the object as context. Arrays logged without a message string are similarly normalized.

The adaptor will forward an empty string `''` to Lifecycleion in these cases. Lifecycleion logs it as a blank message. This is an edge case that comes from Fastify's internal framework logs — it's uncommon in practice, though it will produce blank-message entries in your Lifecycleion sinks.

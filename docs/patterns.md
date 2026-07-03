# Patterns

Recurring architectural patterns for Unirend applications.

<!-- toc -->

- [Resilient Write Queue](#resilient-write-queue)
- [Dark Mode With Cookie Persistence](#dark-mode-with-cookie-persistence)
- [Safe Database Access via Lifecycle Component](#safe-database-access-via-lifecycle-component)
  - [Unirend Plugin Integration](#unirend-plugin-integration)
  - [Registering the Plugin on the Web Server Component](#registering-the-plugin-on-the-web-server-component)
  - [Checking Database Health in Middleware (Circuit Breaker)](#checking-database-health-in-middleware-circuit-breaker)
  - [Route-Specific Hijacking via API Response Helpers](#route-specific-hijacking-via-api-response-helpers)
    - [Usage in Route Handlers:](#usage-in-route-handlers)
  - [Usage in Page Data Loaders and Route Handlers](#usage-in-page-data-loaders-and-route-handlers)

<!-- tocstop -->

## Resilient Write Queue

When writing to an external store (database, analytics service, etc.) from a log sink or access log handler, network issues or downtime can silently drop data. A resilient write queue keeps data safe by falling back to a local queue and retrying in the background.

**How it works:**

1. Attempt the write to the primary store.
2. On failure, append the payload to a local queue (SQLite is a good fit, flat JSON files also work for low volume).
3. A background timer (`setInterval`, registered in a plugin or your main server script) periodically reads the queue and retries failed entries.
4. On successful retry, remove the entry from the queue.

**Pseudocode sketch:**

```
// Custom Lifecycleion sink

onLog(entry):
  try:
    writeToDatabase(entry)
  catch:
    appendToLocalQueue(entry)  // SQLite or flat JSON file

// Server setup (plugin or main script)

onSetup():
  retryTimer = setInterval(() => {
    entries = readLocalQueue()

    for entry in entries:
      try:
        writeToDatabase(entry)
        removeFromQueue(entry)
      catch:
        // leave in queue, try again next tick
  }, retryIntervalMs)

  // Save retryTimer so you can clearInterval(retryTimer) on shutdown
```

This pattern applies anywhere you can't afford to lose data on write failure, such as access logs, audit trails, analytics events, etc. For Lifecycleion logger adaptor users, the natural place to implement this is a custom sink.

## Dark Mode With Cookie Persistence

Store the user's theme preference ('light', 'dark', or 'auto') in a cookie so it's available on the first render. A server plugin reads the cookie in an `onRequest` hook and seeds it into request context. A small inline `<head>` script reads the preference from `window.__FRONTEND_REQUEST_CONTEXT__` and applies the `dark` class to `<html>` only when the resolved theme is dark, before any JS loads, eliminating flash. For 'auto', the script resolves the OS preference via `matchMedia` right away. To ensure the client-side `<UnirendHead>` can cleanly manage and toggle these classes after hydration (without permanently capturing them as part of the static baseline attributes), the inline script also registers the class in `window.__UNIREND_IGNORED_CLASSES__`. Tailwind `dark:` classes or CSS selectors on the `<html>` class handle all theming, keeping components free of conditional theme logic. The client keeps the cookie in sync as the user changes their preference.

See [Theme Management (Hydration-Safe)](./unirend-context.md#theme-management-hydration-safe) in the context docs for a full walkthrough including the plugin, SSR component, and client-side cookie update. For the SSR/API request boundary, including how separated page data loaders bridge `requestContext`, see [SSR Request Context Injection](./ssr.md#request-context-injection).

## Safe Database Access via Lifecycle Component

When integrating the `LifecycleManager` (from `lifecycleion`) with a Unirend web server, request handlers and loaders often need access to database connection pools. Instead of sharing raw connection pool instances globally or attaching them directly to request objects without safety checks, you can combine the **Safe Resource Sharing via Dynamic Wrappers** pattern with a Unirend server plugin to ensure safe, zero-downtime, and resilient database access.

For the core implementation of the `DatabaseConnectionManager` and the `DatabaseHelper` client wrapper, see [Safe Resource Sharing via Dynamic Wrappers](https://github.com/keverw/lifecycleion/blob/master/docs/lifecycle-manager.md#8-safe-resource-sharing-via-dynamic-wrappers) in the LifecycleManager documentation.

### Unirend Plugin Integration

A Unirend plugin can instantiate the database helper wrapper once and automatically decorate it directly on the request object (`request.db`). This makes the database connection available to all downstream route handlers, page data loaders, and middleware in a safe and uniform way.

<!-- prettier-ignore -->
> [!IMPORTANT]
> **Server-Only Resources and Request Context:** In Unirend, the `request.requestContext` object is serialized and sent to the client (browser) during server-side rendering (SSR) so that the frontend can access the same state via `useRequestContext()`. Server-only resources (like connection pools, database wrappers, or loggers) should never be stored in `requestContext` to prevent serialization crashes and security/credential exposure. Always decorate them directly on the `request` object (e.g. `request.db`).

```typescript
import { DatabaseHelper } from '../lib/db-helper'; // local file path (implementation copied from Lifecycleion docs)
import type { ServerPlugin } from 'unirend/server';
import type { LifecycleValueProvider } from 'lifecycleion/lifecycle-manager';

// Extend the Fastify Request interface to support the db helper
declare module 'fastify' {
  interface FastifyRequest {
    db: DatabaseHelper;
  }
}

interface DatabasePluginOptions {
  // Pass the component-scoped lifecycle reference directly
  lifecycle: LifecycleValueProvider;
}

export function databasePlugin(options: DatabasePluginOptions): ServerPlugin {
  return async (pluginHost) => {
    const { lifecycle } = options;

    const dbHelper = new DatabaseHelper(lifecycle);

    // Declare the request decoration up front so Fastify knows the property shape.
    pluginHost.decorateRequest('db', null);

    // Decorate the request with the helper on every request.
    pluginHost.addHook('onRequest', async (request) => {
      request.db = dbHelper;
    });

    pluginHost.log.info('Database middleware plugin successfully registered');

    return {
      name: 'database-middleware',
    };
  };
}
```

### Registering the Plugin on the Web Server Component

Below is an example of a web server component subclassing `BaseComponent` that instantiates the Unirend server inside its `start()` hook, passing the component's own `this.lifecycle` reference directly to `databasePlugin`:

```typescript
import { BaseComponent } from 'lifecycleion/lifecycle-manager';
import { serveSSRWithHMR } from 'unirend/server';
import { databasePlugin } from './plugins/database-plugin';
import type { SSRServer } from 'unirend/server';
import type { Logger } from 'lifecycleion/logger';

export class WebServerComponent extends BaseComponent {
  private server: SSRServer | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;

  constructor(logger: Logger) {
    super(logger, {
      name: 'web-server',
      dependencies: ['database'], // Declares the topological dependency on the database component
      // 30s graceful: gives the server time to drain in-flight requests and active
      // WebSocket connections before force-closing.
      shutdownGracefulTimeoutMS: 30_000,
      // 5s force: after closeAllConnections() kicks in, stop() should resolve almost
      // immediately — this is just a safety net for anything that still hangs.
      shutdownForceTimeoutMS: 5_000,
    });
  }

  async start(): Promise<void> {
    // Starting while shutdown is active is not a safe no-op: the manager could
    // mark the component running while the old stop() is still draining.
    if (this.stopPromise) {
      throw new Error('Cannot start server while shutdown is in progress');
    }

    // Return the same promise if start is already running, so concurrent callers
    // join the in-flight operation instead of starting a second concurrent startup.
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      try {
        this.server = serveSSRWithHMR(
          {
            serverEntry: './src/EntrySSR.tsx',
            template: './src/index.html',
            viteConfig: './vite.config.ts',
          },
          {
            plugins: [
              databasePlugin({
                lifecycle: this.lifecycle, // Pass the proxy reference directly by reference
              }),
            ],
          },
        );

        await this.server.listen(3000);
      } catch (error) {
        this.startPromise = null;
        this.server = null;
        throw error;
      }
    })();

    return this.startPromise;
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopPromise = (async () => {
      try {
        // Await active startup to settle before stopping, preventing orphaned listening
        // sockets if shutdown is initiated mid-boot. If startup hangs, the manager's
        // shutdown timeouts or process termination will clean it up.
        if (this.startPromise) {
          try {
            await this.startPromise;
          } catch {
            // Ignore startup errors because shutdown is already in progress.
          }
        }

        // Stop the server if it successfully started and is listening. Keep a
        // local reference so the callback stops the same server instance even if
        // component state changes while shutdown is in progress.
        const server = this.server;
        if (server?.isListening()) {
          await server.stop();
        }

        // Only clear the server reference after a successful stop. If stop()
        // rejects, force shutdown still needs this.server to close connections.
        this.server = null;
        this.startPromise = null;
      } finally {
        // Runs on both success and error. Without this, a thrown error would leave
        // stopPromise pointing at a rejected promise forever.
        this.stopPromise = null;
      }
    })();

    return this.stopPromise;
  }

  async onShutdownForce(): Promise<void> {
    // Force-close open connections so server.stop() can finish draining and resolve.
    this.server?.closeAllConnections?.();
    await this.stop();
  }

  healthCheck() {
    if (!this.server) {
      return {
        healthy: false,
        message: 'Server is not started',
      };
    }

    const isHealthy = this.server.isListening();
    return {
      healthy: isHealthy,
      message: isHealthy ? 'Server is listening' : 'Server is not listening',
    };
  }
}
```

<!-- prettier-ignore -->
> [!IMPORTANT]
> **Availability of `this.lifecycle`:** The `this.lifecycle` reference is populated dynamically on registration. It is `undefined` inside the component's `constructor()`. Never access `this.lifecycle` or pass it to dependencies in the constructor. Always do so inside the `start()` hook or later.

The example follows the same start/stop coordination pattern as the demo server component: concurrent starts share the same promise, shutdown waits for in-flight startup to settle, and force shutdown asks Unirend to close open connections before joining the normal stop flow.

### Checking Database Health in Middleware (Circuit Breaker)

For database-dependent routes, you can use the lifecycle state of the database component to implement a simple circuit-breaker middleware. If the database is currently stopped or stalled, the middleware can short-circuit the request and return an HTTP `503 Service Unavailable` error instead of allowing queries to fail or hang.

<!-- prettier-ignore -->
> [!WARNING]
> **Global vs. Route-Specific Hooks:** Registering this health check as a global middleware/hook (e.g. via `pluginHost.addHook`) will reject _all_ incoming requests when the database is offline, including requests for static assets, public static files, or routes that do not interact with the database. To avoid this, prefer route-specific helpers such as `ensureDatabase()` inside the `server.api.*` or `server.pageDataHandler.register(...)` handlers that actually query the database, or handle connection issues dynamically within your queries/loaders using `DatabaseHelper`.

```typescript
pluginHost.addHook('preHandler', async (request, reply) => {
  // Check the status of the database component
  const statusResult = lifecycle.getValue<{ connected: boolean }>(
    'database',
    'status',
  );

  if (!statusResult.found || !statusResult.value.connected) {
    request.log.warn('Request rejected: Database connection is offline');

    return reply.code(503).send({
      error: 'Service Unavailable',
      message:
        'The database is currently undergoing maintenance or is offline.',
    });
  }
});
```

### Route-Specific Hijacking via API Response Helpers

Instead of registering hooks globally (which can block static files or public pages), you can define a custom validation helper (e.g. `ensureDatabase`) modeled after Unirend's built-in `APIResponseHelpers` (such as `ensureJSONBody`).

Expose a public status method from your copied `DatabaseHelper` implementation so callers do not need to reach into its private lifecycle provider:

```typescript
import type { ValueResult } from 'lifecycleion/lifecycle-manager';

export interface DatabaseStatusRef {
  connected: boolean;
  poolID: string | null;
  state: string;
  hasPendingConfig: boolean;
  totalConnections: number;
  idleConnections: number;
  waitingRequests: number;
}

export class DatabaseHelper {
  // Existing constructor and query helpers from the Lifecycleion docs...

  getStatus(): ValueResult<DatabaseStatusRef> {
    return this.lifecycle.getValue<DatabaseStatusRef>('database', 'status');
  }
}
```

This helper validates database availability and accepts the handler `params` object, mirroring API route and page data handler signatures. It uses `params.APIResponseHelpers` to send a standardized `503 Service Unavailable` JSON response before the handler runs database work, and returns a boolean that handlers can use to exit early:

```typescript
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { APIResponseHelpers } from 'unirend/api-envelope';
import type { ControlledReply } from 'unirend/server';

/**
 * Ensures the database connection is healthy before executing database-dependent route logic.
 * Hijacks the request with a 503 error envelope if the database is offline.
 */
export async function ensureDatabase(
  request: FastifyRequest,
  reply: FastifyReply | ControlledReply,
  params: { APIResponseHelpers: typeof APIResponseHelpers },
): Promise<boolean> {
  const statusResult = request.db.getStatus();

  if (!statusResult.found || !statusResult.value.connected) {
    const errorResponse = params.APIResponseHelpers.createAPIErrorResponse({
      request,
      statusCode: 503,
      errorCode: 'database_offline',
      errorMessage:
        'The database is currently offline or undergoing maintenance.',
    });

    // Hijacks/sends the error response and terminates early
    await params.APIResponseHelpers.sendErrorEnvelope(
      request,
      reply,
      503,
      errorResponse,
    );
    return false;
  }

  return true;
}
```

#### Usage in Route Handlers:

```typescript
server.api.post('users', async (request, reply, params) => {
  // 1. Hijack the request early if the database is offline
  if (!(await ensureDatabase(request, reply, params))) {
    return false; // Early exit, response has already been sent by the helper
  }

  // 2. Perform database logic safely
  const users = await request.db.query('SELECT * FROM users');
  return params.APIResponseHelpers.createAPISuccessResponse({
    request,
    data: { users: users.rows },
  });
});
```

<!-- prettier-ignore -->
> [!IMPORTANT]
> **Dependency Shutdowns and Stalls:** Since components stop in reverse dependency order, a Unirend web server component (which depends on the database connection manager) is stopped first.
>
> A component is only considered **stalled** if its graceful shutdown phase (its `stop()` method) times out or throws an error, **and** its subsequent force shutdown phase (its `onShutdownForce()` method) is either not implemented, also times out, or throws an error.
>
> If the web server component stalls after both phases fail, the `LifecycleManager` will halt the shutdown process by default (`haltOnStall: true`), meaning subsequent components (like the database) won't run their `stop()` methods and their resources won't be cleaned up. To ensure database connections are closed regardless of prior component stalls, you can configure the manager with `{ shutdownOptions: { haltOnStall: false } }`.

### Usage in Page Data Loaders and Route Handlers

Once registered, handlers can execute database operations safely. The helper exposes:

- **`db.getStatus()`**: Used to read the lifecycle-backed database health/status reference without exposing the helper's private lifecycle provider.
- **`db.readQuery()`**: Used for read-only `SELECT` statements. It is safe to automatically replay once if a network error or connection drop races with a connection pool swap.
- **`db.query()`**: Used for direct queries that should not be replayed (e.g. single-step `INSERT`, `UPDATE`, or `DELETE`). It dynamically resolves the active pool but never replays failed operations because the client cannot guarantee if the database server already processed the request.
- **`db.runInTransaction()`**: Used for multi-step atomic operations where a transaction context (`tx`) manages explicit commit/rollback safety.

Because the web server component is configured to depend on the database component, the `LifecycleManager` guarantees that the database is started first and stopped last. Once registered, handlers can safely execute queries or transactions without needing to manually verify if the pool has been closed, restarted, or reconfigured, as the wrapper helper dynamically resolves active references and handles configuration swaps transparently:

```typescript
// Inside a page data handler
server.pageDataHandler.register('users', async (request, reply, params) => {
  const db = request.db;

  try {
    // 1. Direct read-only query (safe to replay once on pool swap)
    const users = await db.readQuery('SELECT id, name FROM users LIMIT 10');

    // 2. Direct query that should not be replayed (never replayed automatically on pool swap because it performs a write mutation)
    await db.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [123],
    );

    // 3. Transaction safety helper (returns a TransactionResult)
    const txResult = await db.runInTransaction(async (tx) => {
      const insertResult = await tx.query(
        'INSERT INTO users (name) VALUES ($1) RETURNING id',
        ['Jane Doe'],
      );

      const newID = insertResult.rows[0].id;
      await tx.query('INSERT INTO logs (user_id, action) VALUES ($1, $2)', [
        newID,
        'created',
      ]);

      // Explicitly commit the transaction before resolving
      await tx.commit();

      return newID;
    });

    // Check if the transaction rolled back, or if the callback threw after an
    // explicit commit/rollback had already completed.
    if (txResult.status === 'rolled_back') {
      throw txResult.error || new Error('Transaction failed');
    }

    // The callback can still throw after an explicit commit succeeds, such as
    // building the post-commit response return value.
    if (txResult.error) {
      throw txResult.error;
    }

    const newUserID = txResult.value;

    return params.APIResponseHelpers.createPageSuccessResponse({
      request,
      data: { users: users.rows, newUserID },
      pageMetadata: {
        title: 'Users',
        description: 'Recent users',
      },
    });
  } catch (error) {
    // Log the error. Catches database offline/restart helper errors as well as query syntax/validation errors.
    request.log.error({ error }, 'Database query failed');

    // Rethrow to let the global 500 handler take over (or handle locally for route-specific fallback data)
    throw error;
  }
});
```

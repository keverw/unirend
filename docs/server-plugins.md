# Unirend SSR Plugin System

<!-- toc -->

- [Overview](#overview)
- [Basic Usage](#basic-usage)
- [Plugin Interface](#plugin-interface)
  - [ServerPlugin Type](#serverplugin-type)
  - [PluginOptions](#pluginoptions)
  - [Plugin Host Methods (ControlledFastifyInstance)](#plugin-host-methods-controlledfastifyinstance)
    - [Route Registration](#route-registration)
    - [Plugin Registration](#plugin-registration)
    - [Hooks](#hooks)
    - [Decorators](#decorators)
    - [Reading server decorations](#reading-server-decorations)
    - [API Shortcuts (Envelope Helpers)](#api-shortcuts-envelope-helpers)
    - [Page Data Loader Handler Registration](#page-data-loader-handler-registration)
- [Example Plugins](#example-plugins)
  - [API Routes Plugin](#api-routes-plugin)
  - [Plugin Configuration via Factory Functions](#plugin-configuration-via-factory-functions)
  - [Authentication Plugin](#authentication-plugin)
- [Plugin Registration](#plugin-registration-1)
  - [Basic Registration](#basic-registration)
  - [Plugin Dependencies](#plugin-dependencies)
- [Best Practices](#best-practices)
  - [1. Prefix API Routes](#1-prefix-api-routes)
  - [2. Handle Errors Gracefully](#2-handle-errors-gracefully)
  - [3. Use Environment-Specific Logic](#3-use-environment-specific-logic)
  - [4. Validate Input](#4-validate-input)
- [File Upload Helpers](#file-upload-helpers)
- [Common Pitfalls](#common-pitfalls)
  - [Setting Headers in onSend Hook](#setting-headers-in-onsend-hook)
- [Limitations](#limitations)
  - [Forbidden Operations](#forbidden-operations)
  - [Route Conflicts](#route-conflicts)
- [Integration with Third-Party Plugins](#integration-with-third-party-plugins)
- [Error Handling](#error-handling)
- [Testing Your Plugins](#testing-your-plugins)
- [Lifecycle and Persistence](#lifecycle-and-persistence)
  - [Framework-Managed Registries](#framework-managed-registries)
  - [Per-Fastify Instance Methods](#per-fastify-instance-methods)
  - [Best Practices](#best-practices-1)

<!-- tocstop -->

> Note: This document is a guide to the plugin system and how to create your own plugins (for both SSR and API servers). If you're looking for ready-to-use, maintained plugins that ship with Unirend, see the built-in plugins catalog: [docs/built-in-plugins.md](./built-in-plugins.md).

The Unirend SSR server supports a controlled plugin system that allows you to extend functionality while maintaining the integrity of the SSR rendering process. The same plugin model applies to the standalone API server as well. This guide is relevant to both SSR and API servers.

## Overview

The plugin system provides a **controlled interface** to Fastify that allows you to:

- ✅ Add custom API routes, both raw `.get(` or `.api.get(` when wanting to enforce the envelope pattern
- ✅ Register custom hooks and middleware
- ✅ Add file upload handling
- ✅ Implement authentication/authorization
- ✅ Add request decorators
- ✅ Register third-party Fastify plugins
- ✅ Handle global request logging and processing

While preventing dangerous operations that could break SSR:

- ❌ Cannot register catch-all routes (`*`) that conflict with SSR
- ❌ Cannot override critical SSR hooks
- ❌ Cannot access destructive Fastify methods
- ❌ Cannot interfere with the main SSR request handler

Use plugins to register routes, hooks, decorators, and third-party integrations. For example, add hooks with `pluginHost.addHook("onRequest", ...)` inside a plugin.

## Basic Usage

```typescript
import { serveSSRDev } from 'unirend/server';
import type { ServerPlugin } from 'unirend/server';
// Define a plugin
const myPlugin: ServerPlugin = async (pluginHost, options) => {
  // Add custom routes (use envelope pattern via API shortcuts method when possible)
  pluginHost.api.get('status', async (request) => {
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: { healthy: true, mode: options.mode },
      statusCode: 200,
    });
  });

  // Add hooks
  pluginHost.addHook('preHandler', async (request, reply) => {
    console.log(`Request: ${request.method} ${request.url}`);
  });

  // Optional: return metadata for dependency tracking
  return {
    name: 'status-plugin',
  };
};

// Register the plugin
const server = serveSSRDev(paths, {
  plugins: [myPlugin],
  // ... other options
});
```

## Plugin Interface

### ServerPlugin Type

```typescript
type ServerPlugin = (
  fastify: ControlledFastifyInstance,
  options: PluginOptions,
) => Promise<PluginMetadata | void> | PluginMetadata | void;
```

Plugins can optionally return metadata for dependency tracking, using the `PluginMetadata` type from `unirend/server`:

```typescript
import type { PluginMetadata } from 'unirend/server';
// PluginMetadata interface:
// {
//   name: string;                    // Unique name for this plugin
//   dependsOn?: string | string[];   // Plugin dependencies
// }
```

### PluginOptions

```typescript
interface PluginOptions {
  mode: 'development' | 'production';
  isDevelopment: boolean;
  buildDir?: string; // Available in production mode
  serverType: 'ssr' | 'api'; // Server type context
  apiEndpoints: APIEndpointConfig; // API endpoint configuration
}
```

Plugins receive context about the server environment and configuration:

- **`mode`** / **`isDevelopment`**: Current environment mode for conditional plugin behavior
- **`buildDir`**: Build directory path (available in production mode)
- **`serverType`**: Whether the plugin is running on an SSR server or standalone API server
- **`apiEndpoints`**: API endpoint configuration including `apiEndpointPrefix` (default `"/api"`) and other settings

**Example usage:**

```typescript
const contextAwarePlugin: ServerPlugin = async (pluginHost, options) => {
  // Different behavior based on server type
  if (options.serverType === 'ssr') {
    // SSR-specific logic
    console.log('Running on SSR server');
  } else {
    // API server-specific logic
    console.log('Running on standalone API server');
  }

  // Use API endpoint configuration
  const apiPrefix = options.apiEndpoints.apiEndpointPrefix; // "/api" by default

  // Skip domain redirects for API endpoints
  pluginHost.addHook('onRequest', async (request) => {
    if (request.url.startsWith(apiPrefix)) {
      // Skip processing for API routes
      return;
    }
    // Process non-API routes
  });
};
```

### Plugin Host Methods (ControlledFastifyInstance)

#### Route Registration

```typescript
// HTTP methods (no catch-all routes allowed)
pluginHost.get(path, handler);
pluginHost.post(path, handler);
pluginHost.put(path, handler);
pluginHost.delete(path, handler);
pluginHost.patch(path, handler);

// General route registration with constraints
pluginHost.route({
  method: 'GET',
  url: '/api/users/:id',
  handler: async (request, reply) => {
    /* ... */
  },
});
```

#### Plugin Registration

```typescript
// Register third-party Fastify plugins
await pluginHost.register(somePlugin, options);
```

#### Hooks

```typescript
// Add lifecycle hooks (except conflicting ones)
pluginHost.addHook('onRequest', handler);
pluginHost.addHook('preHandler', handler);
pluginHost.addHook('onSend', handler);
// ... other Fastify hooks

// ⚠️ Important: Headers must be set before response is sent
// Use onRequest or preHandler for headers, not onSend
```

#### Decorators

```typescript
// Add properties to request/reply objects
pluginHost.decorateRequest('userID', null);
pluginHost.decorateReply('setUser', function (user) {
  /* ... */
});
pluginHost.decorate('db', databaseConnection);
```

#### Reading server decorations

Plugins can read server-level decorations added by other plugins using read-only helpers:

```ts
// Check if a decoration exists
const hasCookiesInfo = pluginHost.hasDecoration('cookiePluginInfo');

// Get a typed decoration value
const cookieInfo = pluginHost.getDecoration<{
  signingSecretProvided: boolean;
  algorithm: string;
}>('cookiePluginInfo');

if (cookieInfo?.signingSecretProvided) {
  // Safe to expect signed cookie support
}
```

#### API Shortcuts (Envelope Helpers)

```typescript
// Register versioned API endpoints that must return the standardized envelopes
// Available helpers: pluginHost.api.get | post | put | delete | patch

import { APIResponseHelpers } from 'unirend/api-envelope';

pluginHost.api.get('demo/echo/:id', async (request, reply, params) => {
  // Build and return an API envelope, status taken from status_code
  return APIResponseHelpers.createAPISuccessResponse({
    request,
    data: {
      id: (request.params as Record<string, unknown>).id,
      query: request.query,
      endpoint: params.endpoint,
      version: params.version,
    },
    statusCode: 200,
  });
});

// Explicit version example
pluginHost.api.post('demo/items', 2, async (request, reply, params) => {
  const body = request.body as Record<string, unknown>;
  return APIResponseHelpers.createAPISuccessResponse({
    request,
    data: { created: true, body, version: params.version },
    statusCode: 201,
  });
});
```

Notes:

- Prefer `pluginHost.api.*` for JSON endpoints to keep responses standardized with the envelope pattern. HTTP status is taken from `status_code` in the returned envelope.
- Use raw `pluginHost.get/post/...` when you deliberately need non-envelope responses (e.g., file downloads, HTML), but avoid mixing patterns for JSON APIs.
- Wildcard endpoints are allowed via `pluginHost.api.*` only when the API prefix is non-root (default `"/api"`), raw wildcard routes are blocked to avoid SSR conflicts.
- For the full `params` shape passed to `pluginHost.api.*` handlers, see Custom API Routes in `docs/ssr.md`.
- Duplicate registrations for the API same method + endpoint + version: last registration wins. Prefer centralizing your API shortcut registrations to avoid surprises, use distinct versions when you need multiple version handlers.
- Handlers use the signature `(request, reply, params)`, `reply` is a controlled surface that allows setting headers and cookies.
- Endpoints are mounted under `apiEndpoints.apiEndpointPrefix` and, when `versioned` is true, under `/v{n}`.
- Status is taken from `status_code` in the returned API envelope.

#### Page Data Loader Handler Registration

Register backend page data loader handlers from a plugin. Last registration wins for the same `pageType` + `version`.

```typescript
// Handler without explicit version (defaults to version 1)
pluginHost.pageDataHandler.register('home', (request, reply, params) => {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: 'home', version: params.version },
    pageMetadata: { title: 'Home' },
  });
});

// Handler with explicit version
pluginHost.pageDataHandler.register('home', 2, (request, reply, params) => {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: 'home v2', version: params.version },
    pageMetadata: { title: 'Home v2' },
  });
});
```

## Example Plugins

### API Routes Plugin

```typescript
const apiRoutesPlugin: ServerPlugin = async (pluginHost, options) => {
  // Health check endpoint (envelope)
  pluginHost.api.get('health', async (request) => {
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: {
        healthy: true,
        timestamp: new Date().toISOString(),
        mode: options.mode,
      },
      statusCode: 200,
    });
  });

  // Contact form endpoint
  pluginHost.post('/api/contact', async (request) => {
    const body = request.body as any;

    // Process contact form
    await processContactForm(body);

    return { success: true, message: 'Message received' };
  });

  // Request timing
  pluginHost.addHook('preHandler', async (request) => {
    if (request.url.startsWith('/api/')) {
      (request as any).startTime = Date.now();
    }
  });

  pluginHost.addHook('onSend', async (request, reply, payload) => {
    if (request.url.startsWith('/api/') && (request as any).startTime) {
      const duration = Date.now() - (request as any).startTime;
      reply.header('X-Response-Time', `${duration}ms`);
    }
    return payload;
  });
};
```

### Plugin Configuration via Factory Functions

For plugin-specific configuration, use factory functions that return the plugin. This provides type-safe configuration through closures:

```typescript
import { serveSSRDev } from 'unirend/server';
import type { ServerPlugin } from 'unirend/server';
// Plugin factory function for rate limiting
const RateLimitPlugin = (config: { maxRequests: number; windowMs: number }) => {
  const rateLimitPlugin: ServerPlugin = async (pluginHost, options) => {
    const requestCounts = new Map<
      string,
      { count: number; resetTime: number }
    >();

    pluginHost.addHook('onRequest', async (request, reply) => {
      const clientIP = request.ip;
      const now = Date.now();
      const windowStart = now - config.windowMs;

      const clientData = requestCounts.get(clientIP) || {
        count: 0,
        resetTime: now + config.windowMs,
      };

      if (now > clientData.resetTime) {
        clientData.count = 1;
        clientData.resetTime = now + config.windowMs;
      } else {
        clientData.count++;
      }

      requestCounts.set(clientIP, clientData);

      if (clientData.count > config.maxRequests) {
        return reply
          .code(429)
          .header('Cache-Control', 'no-store')
          .send({ error: 'Too many requests' });
      }
    });
  };
  return rateLimitPlugin;
};

const server = serveSSRDev(paths, {
  plugins: [
    RateLimitPlugin({ maxRequests: 100, windowMs: 60000 }), // 100 requests per minute
  ],
});
```

### Authentication Plugin

```typescript
const authPlugin: ServerPlugin = async (pluginHost, options) => {
  // Decorate request with user
  pluginHost.decorateRequest('user', null);

  // Authentication hook for API routes
  pluginHost.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/api/protected/')) {
      const token = request.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        return reply
          .code(401)
          .header('Cache-Control', 'no-store')
          .send({ error: 'Missing authorization token' });
      }

      try {
        const user = await verifyToken(token);
        (request as any).user = user;
      } catch (error) {
        return reply
          .code(401)
          .header('Cache-Control', 'no-store')
          .send({ error: 'Invalid token' });
      }
    }
  });

  // Protected route example
  pluginHost.get('/api/protected/profile', async (request) => {
    const user = (request as any).user;
    return { user: user.profile };
  });
};
```

## Plugin Registration

### Basic Registration

Plugins are registered as an array of functions. Each plugin receives the controlled Fastify instance and server options:

```typescript
// In your server setup
const server = serveSSRDev(paths, {
  plugins: [apiRoutesPlugin, authPlugin, fileUploadPlugin, securityPlugin],
  // ... other options
});

// Or for production
const server = serveSSRProd(buildDir, {
  plugins: [apiRoutesPlugin, authPlugin, fileUploadPlugin, securityPlugin],
  // ... other options
});

// With configuration via factory functions
const server = serveSSRDev(paths, {
  plugins: [
    DatabasePlugin({ connectionString: process.env.DB_URL }),
    SessionPlugin({ idCookieName: 'auth-id', secretCookieName: 'auth-secret' }),
  ],
});
```

### Plugin Dependencies

Plugins can declare dependencies on other plugins. Dependent plugins must be registered **after** their dependencies in the plugins array:

```typescript
const databasePlugin: ServerPlugin = async (pluginHost, options) => {
  // Setup database connection
  const db = await connectToDatabase();
  pluginHost.decorate('db', db);

  return {
    name: 'database',
  };
};

const sessionPlugin: ServerPlugin = async (pluginHost, options) => {
  // Use database from dependency
  const db = pluginHost.db;

  pluginHost.addHook('preHandler', async (request, reply) => {
    const sessionId = request.headers['x-session-id'];
    if (sessionId) {
      request.session = await db.getSession(sessionId);
    }
  });

  return {
    name: 'session',
    dependsOn: 'database', // Must be registered after database
  };
};

const server = serveSSRDev(paths, {
  plugins: [
    databasePlugin, // Must come first
    sessionPlugin, // Depends on database
  ],
});
```

**Multiple Dependencies:**

```typescript
const complexPlugin: ServerPlugin = async (pluginHost, options) => {
  // Plugin logic here

  return {
    name: 'complex-plugin',
    dependsOn: ['database', 'auth', 'session'], // Multiple dependencies
  };
};
```

**Dependency Validation:**

- Plugins are registered in array order
- If a plugin declares dependencies that haven't been registered yet, server startup will fail with a clear error message
- Duplicate plugin names are not allowed
- Plugins without metadata (no return value) are registered normally but can't be depended upon

## Best Practices

### 1. Prefix API Routes

Always prefix your API routes to avoid conflicts with SSR routes:

```typescript
// ✅ Good
pluginHost.get('/api/users', handler);
pluginHost.post('/api/auth/login', handler);

// ❌ Bad - could conflict with SSR pages
pluginHost.get('/users', handler);
pluginHost.get('/login', handler);
```

### 2. Handle Errors Gracefully

```typescript
pluginHost.post('/api/data', async (request, reply) => {
  try {
    const result = await processData(request.body);
    return result;
  } catch (error) {
    console.error('API Error:', error);
    return reply.code(500).send({
      error: 'Internal server error',
      requestID: (request as any).requestID,
    });
  }
});
```

Tip: For error responses (status >= 400), consider `reply.header("Cache-Control", "no-store")` to avoid intermediaries caching transient failures — especially for GET/HEAD. This is typically unnecessary for POST/PUT/PATCH/DELETE.

### 3. Use Environment-Specific Logic

```typescript
const myPlugin: ServerPlugin = async (pluginHost, options) => {
  if (options.isDevelopment) {
    // Development-only features
    pluginHost.get('/api/debug', debugHandler);
  } else {
    // Production-only features
    pluginHost.addHook('onRequest', rateLimitHook);
  }
};
```

**Note**: Use `options.isDevelopment`/`options.mode` for registration-time decisions (what your plugin registers). For per-request branching inside handlers or middleware, read `request.isDevelopment`.

You can also branch inside request handlers using an environment flag on the request:

```typescript
const envAwarePlugin: ServerPlugin = async (pluginHost, options) => {
  pluginHost.get('/api/env', async (request) => {
    const isDev = (request as FastifyRequest & { isDevelopment?: boolean })
      .isDevelopment;
    return { mode: isDev ? 'development' : 'production' };
  });
};
```

### 4. Validate Input

```typescript
pluginHost.post(
  '/api/users',
  {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'email'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      },
    },
  },
  async (request) => {
    // request.body is now validated
    return createUser(request.body);
  },
);
```

## File Upload Helpers

When using `processFileUpload()` in your plugins, keep in mind that it returns an **envelope response** (API-friendly format). This works seamlessly when used in API routes registered via `pluginHost.api.*`.

However, if you're using file upload helpers outside the standard API context (e.g., in a custom Fastify route registered with `pluginHost.get/post/...`), you'll need to extract the envelope and convert it to a Fastify reply:

```typescript
const uploadPlugin: ServerPlugin = async (pluginHost, options) => {
  pluginHost.post('/custom-upload', async (request, reply) => {
    const result = await processFileUpload({
      request,
      reply,
      maxSizePerFile: 5 * 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png'],
      processor: async (stream, metadata, context) => {
        // Your upload logic
        return { uploadID: 'abc123' };
      },
    });

    if (!result.success) {
      // Extract envelope and send as reply
      const envelope = result.errorEnvelope;

      /*
       * Cache-Control: no-store prevents intermediaries (proxies, CDNs) from
       * caching transient failures (upload errors, auth errors, validation errors).
       * Recommended for all 4xx/5xx responses, especially important for GET/HEAD.
       */
      reply.header('Cache-Control', 'no-store');

      return reply.code(envelope.status_code).send(envelope);
    }

    // Handle success
    return reply.code(200).send({ files: result.files });
  });
};
```

**Note**: When using `pluginHost.api.*` shortcuts, the framework automatically sets this header for responses with `status_code >= 400`, so you don't need to handle it manually.

## Common Pitfalls

### Setting Headers in onSend Hook

❌ **Wrong - will cause "headers already sent" errors:**

```typescript
pluginHost.addHook('onSend', async (request, reply, payload) => {
  reply.header('X-Request-ID', request.id); // ❌ Too late!
  return payload;
});
```

✅ **Correct - set headers before response is sent:**

```typescript
pluginHost.addHook('onRequest', async (request, reply) => {
  reply.header('X-Request-ID', request.id); // ✅ Perfect timing
});

// Or in preHandler
pluginHost.addHook('preHandler', async (request, reply) => {
  reply.header('X-Custom-Header', 'value'); // ✅ Also works
});
```

**Why this happens:** The `onSend` hook runs after headers have been sent to the client. Use `onRequest` or `preHandler` for setting headers.

## Limitations

### Forbidden Operations

These operations will throw errors:

```typescript
// ❌ Cannot register catch-all routes
pluginHost.get('*', handler); // Error!
pluginHost.route({ url: '*', handler }); // Error!

// ❌ Cannot register conflicting hooks
pluginHost.addHook('onRoute', handler); // Error!
```

### Route Conflicts

The SSR handler uses a catch-all GET route (`*`) that runs last. Your plugin routes will be matched first if they're more specific:

```typescript
// ✅ This works - specific route matched before SSR catch-all
pluginHost.get('/api/users', handler);

// ✅ This also works - different HTTP method
pluginHost.post('/some-page', handler);

// ❌ This would conflict if you tried to register it (but it's prevented)
pluginHost.get('*', handler);
```

## Integration with Third-Party Plugins

Many Fastify ecosystem plugins work seamlessly:

```typescript
const corsPlugin: ServerPlugin = async (pluginHost) => {
  await pluginHost.register(require('@fastify/cors'), {
    origin: ['https://yourdomain.com'],
    credentials: true,
  });
};

const rateLimitPlugin: ServerPlugin = async (pluginHost) => {
  await pluginHost.register(require('@fastify/rate-limit'), {
    max: 100,
    timeWindow: '1 minute',
  });
};
```

## Error Handling

Plugin registration errors are caught and reported:

```typescript
const faultyPlugin: ServerPlugin = async (fastify) => {
  throw new Error('Something went wrong!');
};

// This will log the error and throw during server startup
const server = serveSSRDev(paths, {
  plugins: [faultyPlugin], // Will cause startup to fail with clear error message
});
```

**Dependency Errors:**

```typescript
// This will fail - session depends on database but database comes after
const server = serveSSRDev(paths, {
  plugins: [
    sessionPlugin, // depends on 'database'
    databasePlugin, // provides 'database' - too late!
  ],
});
// Error: Plugin "session" depends on "database" which has not been registered yet

// This will fail - duplicate names
const duplicateDBPlugin: ServerPlugin = async (pluginHost, options) => {
  // Different implementation but same name
  return { name: 'database' };
};

const server = serveSSRDev(paths, {
  plugins: [
    databasePlugin, // returns { name: 'database' }
    duplicateDBPlugin, // also returns { name: 'database' } - conflict!
  ],
});
// Error: Plugin with name "database" is already registered
```

## Testing Your Plugins

You can test plugins independently by creating a minimal Fastify instance:

```typescript
import fastify from 'fastify';

const app = fastify();
const mockControlledInstance = /* create mock */;

await myPlugin(mockControlledInstance, {
  mode: 'development',
  isDevelopment: true
});

const response = await app.inject({
  method: 'GET',
  url: '/api/test'
});

expect(response.statusCode).toBe(200);
```

This plugin system gives you the flexibility to extend your SSR server while maintaining the reliability and performance of the core SSR functionality.

## Lifecycle and Persistence

Understanding how routes and handlers persist helps you avoid surprises when restarting or reconfiguring your server.

### Framework-Managed Registries

The plugin host's shortcut methods write into Unirend's internal registries and persist on the server instance:

- `pluginHost.api.*` and `pluginHost.pageDataHandler.register(...)` persist across `stop()`/`listen()` cycles on the same server object (last registration wins for duplicates).
- These are applied to the Fastify instance during `listen()` when routes are mounted, after plugins are registered.

### Per-Fastify Instance Methods

The direct Fastify-style methods are tied to the underlying Fastify instance:

- `pluginHost.get/post/put/delete/patch/route/addHook/register` are invoked against the Fastify instance, which is created fresh on each `listen()` call.
- Your plugin function runs on each `listen()`, so these routes/hooks are re-registered each time.

### Best Practices

- **Prefer deterministic plugin setup**: Declare routes and handlers during server startup (inside your plugin function). Adding/removing routes dynamically at runtime can make behavior unpredictable across `stop()`/`listen()` cycles.
- **Branch inside handlers, not registrations**: If you need feature flags, keep the route registrations stable and branch inside the handler logic instead.
- **Use a factory function for dynamic scenarios**: If you need to dynamically create or reassign server instances with different route configurations, use a factory function that returns a fresh server:

```typescript
import { serveSSRProd } from 'unirend/server';
import type { SSRServer } from 'unirend/server';
interface CreateServerOptions {
  isDevelopment: boolean;
}

function createServer(options: CreateServerOptions): SSRServer {
  return serveSSRProd('./build', {
    isDevelopment: options.isDevelopment,
    // Compute other SSRServerOptions based on your params
  });
}

// Create initial server
let server = createServer({ isDevelopment: false });
await server.listen(3000, 'localhost');

// Later, if you need a fresh server with different config:
await server.stop();
server = createServer({ isDevelopment: true });
await server.listen(3000, 'localhost');
```

This pattern ensures you get a clean server instance with fresh registries, avoiding stale route handlers from previous configurations.

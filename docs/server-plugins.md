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
    - [API Shortcuts (Envelope Helpers)](#api-shortcuts-envelope-helpers)
    - [Page Data Loader Registration](#page-data-loader-registration)
- [Example Plugins](#example-plugins)
  - [API Routes Plugin](#api-routes-plugin)
  - [Plugin-specific user options](#plugin-specific-user-options)
  - [Authentication Plugin](#authentication-plugin)
  - [File Upload Plugin](#file-upload-plugin)
  - [Security Plugin](#security-plugin)
- [Plugin Registration](#plugin-registration-1)
- [Best Practices](#best-practices)
  - [1. Prefix API Routes](#1-prefix-api-routes)
  - [2. Handle Errors Gracefully](#2-handle-errors-gracefully)
  - [3. Use Environment-Specific Logic](#3-use-environment-specific-logic)
  - [4. Validate Input](#4-validate-input)
- [Common Pitfalls](#common-pitfalls)
  - [Setting Headers in onSend Hook](#setting-headers-in-onsend-hook)
- [Limitations](#limitations)
  - [Forbidden Operations](#forbidden-operations)
  - [Route Conflicts](#route-conflicts)
- [Integration with Third-Party Plugins](#integration-with-third-party-plugins)
- [Error Handling](#error-handling)
- [Testing Your Plugins](#testing-your-plugins)
- [Lifecycle and Persistence](#lifecycle-and-persistence)

<!-- tocstop -->

The Unirend SSR server supports a controlled plugin system that allows you to extend functionality while maintaining the integrity of the SSR rendering process. The same plugin model applies to the standalone API server as well; this guide is relevant to both SSR and API servers.

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
import { serveSSRDev, type ServerPlugin } from "unirend/server";

// Define a plugin
const myPlugin: ServerPlugin = async (pluginHost, options) => {
  // Add custom routes
  pluginHost.get("/api/status", async () => {
    return { status: "ok", mode: options.mode };
  });

  // Add hooks
  pluginHost.addHook("preHandler", async (request, reply) => {
    console.log(`Request: ${request.method} ${request.url}`);
  });
};

// Register the plugin
const server = await serveSSRDev(paths, {
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
) => Promise<void> | void;
```

### PluginOptions

```typescript
interface PluginOptions {
  mode: "development" | "production";
  isDevelopment: boolean;
  buildDir?: string; // Available in production mode
}
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
  method: "GET",
  url: "/api/users/:id",
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
pluginHost.addHook("onRequest", handler);
pluginHost.addHook("preHandler", handler);
pluginHost.addHook("onSend", handler);
// ... other Fastify hooks

// ⚠️ Important: Headers must be set before response is sent
// Use onRequest or preHandler for headers, not onSend
```

#### Decorators

```typescript
// Add properties to request/reply objects
pluginHost.decorateRequest("userId", null);
pluginHost.decorateReply("setUser", function (user) {
  /* ... */
});
pluginHost.decorate("db", databaseConnection);
```

#### API Shortcuts (Envelope Helpers)

```typescript
// Register versioned API endpoints that must return the standardized envelopes
// Available helpers: pluginHost.api.get | post | put | delete | patch

import { APIResponseHelpers } from "unirend/api-envelope";

pluginHost.api.get("demo/echo/:id", async (request, reply, params) => {
  // Build and return an API envelope; status taken from status_code
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
pluginHost.api.post("demo/items", 2, async (request, reply, params) => {
  const body = request.body as Record<string, unknown>;
  return APIResponseHelpers.createAPISuccessResponse({
    request,
    data: { created: true, body, version: params.version },
    statusCode: 201,
  });
});
```

Notes:

- These helpers enforce the API envelope contract and derive the HTTP status from `status_code` in the returned envelope.
- Use raw `pluginHost.get/post/...` when you need to return non-JSON responses; `pluginHost.api.*` is for JSON envelopes only, to keep things consistent.
- Wildcard endpoints are only allowed via `pluginHost.api.*` when your `apiEndpointPrefix` is non-root (default is `"/api"`); raw wildcard routes on the host are blocked to avoid conflicts with SSR.
- For the full `params` shape passed to `pluginHost.api.*` handlers, see Generic API Routes in `docs/ssr.md`.
- Duplicate registrations for the API same method + endpoint + version: last registration wins. Prefer centralizing your API shortcut registrations to avoid surprises; use distinct versions when you need multiple version handlers.

Notes:

- Handlers use the signature `(request, reply, params)`; `reply` is a controlled surface that allows setting headers and cookies.
- Endpoints are mounted under `apiEndpoints.apiEndpointPrefix` and, when `versioned` is true, under `/v{n}`.
- Status is taken from `status_code` in the returned API envelope.

#### Page Data Loader Registration

Register page data handlers from a plugin using the pageLoader shortcut. Last registration wins for the same `pageType` + `version`.

```typescript
// Unversioned handler (defaults to version 1 when versioning is enabled)
pluginHost.pageLoader.register("home", (request, reply, params) => {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: "home", version: params.version },
    pageMetadata: { title: "Home" },
  });
});

// Explicit version
pluginHost.pageLoader.register("home", 2, (request, reply, params) => {
  return APIResponseHelpers.createPageSuccessResponse({
    request,
    data: { message: "home v2", version: params.version },
    pageMetadata: { title: "Home v2" },
  });
});
```

## Example Plugins

### API Routes Plugin

```typescript
const apiRoutesPlugin: ServerPlugin = async (pluginHost, options) => {
  // Health check endpoint
  pluginHost.get("/api/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    mode: options.mode,
  }));

  // Contact form endpoint
  pluginHost.post("/api/contact", async (request) => {
    const body = request.body as any;

    // Process contact form
    await processContactForm(body);

    return { success: true, message: "Message received" };
  });

  // Request timing
  pluginHost.addHook("preHandler", async (request) => {
    if (request.url.startsWith("/api/")) {
      (request as any).startTime = Date.now();
    }
  });

  pluginHost.addHook("onSend", async (request, reply, payload) => {
    if (request.url.startsWith("/api/") && (request as any).startTime) {
      const duration = Date.now() - (request as any).startTime;
      reply.header("X-Response-Time", `${duration}ms`);
    }
    return payload;
  });
};
```

### Plugin-specific user options

You can supply per-plugin user options when registering plugins. Use either a bare function or an object entry with an `options` field. The provided options are available as `options.userOptions` inside the plugin.

```typescript
import { serveSSRDev, type ServerPlugin } from "unirend/server";

const loggerPlugin: ServerPlugin = async (pluginHost, options) => {
  const level = (options.userOptions?.level as string) || "info";
  pluginHost.addHook("onRequest", async () => {
    if (level === "debug") {
      // ... extra logging
    }
  });
};

const server = await serveSSRDev(paths, {
  plugins: [
    loggerPlugin, // bare plugin
    { plugin: loggerPlugin, options: { level: "debug" } }, // with user options
  ],
});
```

### Authentication Plugin

```typescript
const authPlugin: ServerPlugin = async (pluginHost, options) => {
  // Decorate request with user
  pluginHost.decorateRequest("user", null);

  // Authentication hook for API routes
  pluginHost.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/api/protected/")) {
      const token = request.headers.authorization?.replace("Bearer ", "");

      if (!token) {
        return reply.code(401).send({ error: "Missing authorization token" });
      }

      try {
        const user = await verifyToken(token);
        (request as any).user = user;
      } catch (error) {
        return reply.code(401).send({ error: "Invalid token" });
      }
    }
  });

  // Protected route example
  pluginHost.get("/api/protected/profile", async (request) => {
    const user = (request as any).user;
    return { user: user.profile };
  });
};
```

### File Upload Plugin

```typescript
const fileUploadPlugin: ServerPlugin = async (pluginHost, options) => {
  console.log(`📁 Registering file upload plugin (${options.mode} mode)`);

  try {
    // Register multipart plugin for file uploads
    // Install: npm install @fastify/multipart
    const multipart = await import("@fastify/multipart");
    await pluginHost.register(multipart.default, {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    });

    pluginHost.post("/api/upload", async (request, reply) => {
      try {
        // After @fastify/multipart is registered, request.file() becomes available
        const data = await (request as any).file();

        if (!data) {
          return reply.code(400).send({ error: "No file uploaded" });
        }

        console.log(`📤 File uploaded: ${data.filename} (${data.mimetype})`);

        // Save file (implement your storage logic)
        // const savedFile = await saveFileToStorage(data);

        return {
          success: true,
          filename: data.filename,
          mimetype: data.mimetype,
          size: data.file.bytesRead,
          message: "File uploaded successfully",
          // fileId: savedFile.id,
          // url: savedFile.url
        };
      } catch (uploadError) {
        console.error("Upload error:", uploadError);
        return reply.code(500).send({ error: "Upload failed" });
      }
    });
  } catch (importError) {
    console.warn(
      "⚠️  File upload plugin skipped - @fastify/multipart not installed",
    );
    console.warn("   Run: npm install @fastify/multipart");

    // Provide a placeholder endpoint that explains the missing dependency
    pluginHost.post("/api/upload", async (request, reply) => {
      return reply.code(501).send({
        error: "File upload not available",
        message: "Install @fastify/multipart to enable file uploads",
        install: "npm install @fastify/multipart",
      });
    });
  }
};
```

### Security Plugin

```typescript
const securityPlugin: ServerPlugin = async (pluginHost, options) => {
  // Add request ID for tracing
  pluginHost.decorateRequest("requestID", null);

  pluginHost.addHook("onRequest", async (request) => {
    (request as any).requestID = generateRequestId();
  });

  // Security headers
  pluginHost.addHook("onSend", async (request, reply, payload) => {
    if (!options.isDevelopment) {
      reply.header("X-Frame-Options", "DENY");
      reply.header("X-Content-Type-Options", "nosniff");
      reply.header("X-XSS-Protection", "1; mode=block");
      reply.header("Strict-Transport-Security", "max-age=31536000");
    }

    reply.header("X-Request-ID", (request as any).requestID);
    return payload;
  });
};
```

**Testing File Uploads:**

Once you have `@fastify/multipart` installed, you can test file uploads like this:

```bash
# Test with curl
curl -X POST http://localhost:3000/api/upload \
  -F "file=@path/to/your/file.png" \
  -H "Content-Type: multipart/form-data"

# Response:
# {
#   "success": true,
#   "filename": "file.png",
#   "mimetype": "image/png",
#   "size": 12345,
#   "message": "File uploaded successfully"
# }
```

**Available File Properties:**

When `@fastify/multipart` is installed, the `data` object from `request.file()` contains:

```typescript
{
  filename: string; // Original filename
  mimetype: string; // MIME type (e.g., 'image/png')
  encoding: string; // File encoding
  file: ReadableStream; // File stream for reading data
  fieldname: string; // Form field name
  fields: Object; // Other form fields
}
```

## Plugin Registration

```typescript
// In your server setup
const server = await serveSSRDev(paths, {
  plugins: [apiRoutesPlugin, authPlugin, fileUploadPlugin, securityPlugin],
  // ... other options
});

// Or for production
const server = await serveSSRProd(buildDir, {
  plugins: [apiRoutesPlugin, authPlugin, fileUploadPlugin, securityPlugin],
  // ... other options
});
```

## Best Practices

### 1. Prefix API Routes

Always prefix your API routes to avoid conflicts with SSR routes:

```typescript
// ✅ Good
pluginHost.get("/api/users", handler);
pluginHost.post("/api/auth/login", handler);

// ❌ Bad - could conflict with SSR pages
pluginHost.get("/users", handler);
pluginHost.get("/login", handler);
```

### 2. Handle Errors Gracefully

```typescript
pluginHost.post("/api/data", async (request, reply) => {
  try {
    const result = await processData(request.body);
    return result;
  } catch (error) {
    console.error("API Error:", error);
    return reply.code(500).send({
      error: "Internal server error",
      requestID: (request as any).requestID,
    });
  }
});
```

### 3. Use Environment-Specific Logic

```typescript
const myPlugin: ServerPlugin = async (pluginHost, options) => {
  if (options.isDevelopment) {
    // Development-only features
    pluginHost.get("/api/debug", debugHandler);
  } else {
    // Production-only features
    pluginHost.addHook("onRequest", rateLimitHook);
  }
};
```

**Note**: Use `options.isDevelopment`/`options.mode` for registration-time decisions (what your plugin registers). For per-request branching inside handlers or middleware, read `request.isDevelopment`.

You can also branch inside request handlers using an environment flag on the request:

```typescript
const envAwarePlugin: ServerPlugin = async (pluginHost, options) => {
  pluginHost.get("/api/env", async (request) => {
    const isDev = (request as FastifyRequest & { isDevelopment?: boolean })
      .isDevelopment;
    return { mode: isDev ? "development" : "production" };
  });
};
```

### 4. Validate Input

```typescript
pluginHost.post(
  "/api/users",
  {
    schema: {
      body: {
        type: "object",
        required: ["name", "email"],
        properties: {
          name: { type: "string" },
          email: { type: "string", format: "email" },
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

## Common Pitfalls

### Setting Headers in onSend Hook

❌ **Wrong - will cause "headers already sent" errors:**

```typescript
pluginHost.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Request-ID", request.id); // ❌ Too late!
  return payload;
});
```

✅ **Correct - set headers before response is sent:**

```typescript
pluginHost.addHook("onRequest", async (request, reply) => {
  reply.header("X-Request-ID", request.id); // ✅ Perfect timing
});

// Or in preHandler
pluginHost.addHook("preHandler", async (request, reply) => {
  reply.header("X-Custom-Header", "value"); // ✅ Also works
});
```

**Why this happens:** The `onSend` hook runs after headers have been sent to the client. Use `onRequest` or `preHandler` for setting headers.

## Limitations

### Forbidden Operations

These operations will throw errors:

```typescript
// ❌ Cannot register catch-all routes
pluginHost.get("*", handler); // Error!
pluginHost.route({ url: "*", handler }); // Error!

// ❌ Cannot register conflicting hooks
pluginHost.addHook("onRoute", handler); // Error!
```

### Route Conflicts

The SSR handler uses a catch-all GET route (`*`) that runs last. Your plugin routes will be matched first if they're more specific:

```typescript
// ✅ This works - specific route matched before SSR catch-all
pluginHost.get("/api/users", handler);

// ✅ This also works - different HTTP method
pluginHost.post("/some-page", handler);

// ❌ This would conflict if you tried to register it (but it's prevented)
pluginHost.get("*", handler);
```

## Integration with Third-Party Plugins

Many Fastify ecosystem plugins work seamlessly:

```typescript
const corsPlugin: ServerPlugin = async (pluginHost) => {
  await pluginHost.register(require("@fastify/cors"), {
    origin: ["https://yourdomain.com"],
    credentials: true,
  });
};

const rateLimitPlugin: ServerPlugin = async (pluginHost) => {
  await pluginHost.register(require("@fastify/rate-limit"), {
    max: 100,
    timeWindow: "1 minute",
  });
};
```

## Error Handling

Plugin registration errors are caught and reported:

```typescript
const faultyPlugin: ServerPlugin = async (fastify) => {
  throw new Error("Something went wrong!");
};

// This will log the error and throw during server startup
const server = await serveSSRDev(paths, {
  plugins: [faultyPlugin], // Will cause startup to fail with clear error message
});
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

- The plugin host’s shortcuts are framework-managed and persist on the server instance:
  - `pluginHost.api.*` and `pluginHost.pageLoader.register(...)` write into Unirend’s internal registries. They persist across `stop()`/`listen()` cycles on the same server object (last registration wins for duplicates).
  - These are applied to the Fastify instance during `listen()` when routes are mounted, after plugins are registered.
- The direct Fastify-style methods are per Fastify instance:
  - `pluginHost.get/post/put/delete/patch/route/addHook/register` are invoked against the underlying Fastify instance, which is created fresh on each `listen()` call. Your plugin function is run on each `listen()`, so these routes/hooks are re-registered each time.
- Prefer deterministic plugin setup:
  - Declare routes and handlers during server startup (inside your plugin function). Adding/removing routes dynamically at runtime can make behavior unpredictable across stop()/listen() cycles and may not persist after a restart as intended.
  - If you need feature flags, keep the registrations stable and branch inside handlers instead of changing route registration.

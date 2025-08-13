# Unirend SSR Plugin System

<!-- toc -->

- [Overview](#overview)
- [Basic Usage](#basic-usage)
- [Plugin Interface](#plugin-interface)
  - [ServerPlugin Type](#serverplugin-type)
  - [PluginOptions](#pluginoptions)
  - [ControlledFastifyInstance Methods](#controlledfastifyinstance-methods)
    - [Route Registration](#route-registration)
    - [Plugin Registration](#plugin-registration)
    - [Hooks](#hooks)
    - [Decorators](#decorators)
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

<!-- tocstop -->

The Unirend SSR server supports a controlled plugin system that allows you to extend functionality while maintaining the integrity of the SSR rendering process. The same plugin model applies to the standalone API server as well; this guide is relevant to both SSR and API servers.

## Overview

The plugin system provides a **controlled interface** to Fastify that allows you to:

- ✅ Add custom API routes
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

Use plugins to register routes, hooks, decorators, and third-party integrations. For example, add hooks with `fastify.addHook("onRequest", ...)` inside a plugin.

## Basic Usage

```typescript
import { serveSSRDev, type ServerPlugin } from "unirend/server";

// Define a plugin
const myPlugin: ServerPlugin = async (fastify, options) => {
  // Add custom routes
  fastify.get("/api/status", async () => {
    return { status: "ok", mode: options.mode };
  });

  // Add hooks
  fastify.addHook("preHandler", async (request, reply) => {
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

### ControlledFastifyInstance Methods

#### Route Registration

```typescript
// HTTP methods (no catch-all routes allowed)
fastify.get(path, handler);
fastify.post(path, handler);
fastify.put(path, handler);
fastify.delete(path, handler);
fastify.patch(path, handler);

// General route registration with constraints
fastify.route({
  method: "GET",
  url: "/api/users/:id",
  handler: async (request, reply) => {
    /* ... */
  },
});
```

#### Plugin Registration

```typescript
// Register third-party plugins
await fastify.register(somePlugin, options);
```

#### Hooks

```typescript
// Add lifecycle hooks (except conflicting ones)
fastify.addHook("onRequest", handler);
fastify.addHook("preHandler", handler);
fastify.addHook("onSend", handler);
// ... other Fastify hooks

// ⚠️ Important: Headers must be set before response is sent
// Use onRequest or preHandler for headers, not onSend
```

#### Decorators

```typescript
// Add properties to request/reply objects
fastify.decorateRequest("userId", null);
fastify.decorateReply("setUser", function (user) {
  /* ... */
});
fastify.decorate("db", databaseConnection);
```

## Example Plugins

### API Routes Plugin

```typescript
const apiRoutesPlugin: ServerPlugin = async (fastify, options) => {
  // Health check endpoint
  fastify.get("/api/health", async () => ({
    status: "ok",
    timestamp: new Date().toISOString(),
    mode: options.mode,
  }));

  // Contact form endpoint
  fastify.post("/api/contact", async (request) => {
    const body = request.body as any;

    // Process contact form
    await processContactForm(body);

    return { success: true, message: "Message received" };
  });

  // Request timing
  fastify.addHook("preHandler", async (request) => {
    if (request.url.startsWith("/api/")) {
      (request as any).startTime = Date.now();
    }
  });

  fastify.addHook("onSend", async (request, reply, payload) => {
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

const loggerPlugin: ServerPlugin = async (fastify, options) => {
  const level = (options.userOptions?.level as string) || "info";
  fastify.addHook("onRequest", async () => {
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
const authPlugin: ServerPlugin = async (fastify, options) => {
  // Decorate request with user
  fastify.decorateRequest("user", null);

  // Authentication hook for API routes
  fastify.addHook("preHandler", async (request, reply) => {
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
  fastify.get("/api/protected/profile", async (request) => {
    const user = (request as any).user;
    return { user: user.profile };
  });
};
```

### File Upload Plugin

```typescript
const fileUploadPlugin: ServerPlugin = async (fastify, options) => {
  console.log(`📁 Registering file upload plugin (${options.mode} mode)`);

  try {
    // Register multipart plugin for file uploads
    // Install: npm install @fastify/multipart
    const multipart = await import("@fastify/multipart");
    await fastify.register(multipart.default, {
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    });

    fastify.post("/api/upload", async (request, reply) => {
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
    fastify.post("/api/upload", async (request, reply) => {
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
const securityPlugin: ServerPlugin = async (fastify, options) => {
  // Add request ID for tracing
  fastify.decorateRequest("requestID", null);

  fastify.addHook("onRequest", async (request) => {
    (request as any).requestID = generateRequestId();
  });

  // Security headers
  fastify.addHook("onSend", async (request, reply, payload) => {
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
fastify.get("/api/users", handler);
fastify.post("/api/auth/login", handler);

// ❌ Bad - could conflict with SSR pages
fastify.get("/users", handler);
fastify.get("/login", handler);
```

### 2. Handle Errors Gracefully

```typescript
fastify.post("/api/data", async (request, reply) => {
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
const myPlugin: ServerPlugin = async (fastify, options) => {
  if (options.isDevelopment) {
    // Development-only features
    fastify.get("/api/debug", debugHandler);
  } else {
    // Production-only features
    fastify.addHook("onRequest", rateLimitHook);
  }
};
```

**Note**: Use `options.isDevelopment`/`options.mode` for registration-time decisions (what your plugin registers). For per-request branching inside handlers or middleware, read `request.isDevelopment`.

You can also branch inside request handlers using an environment flag on the request:

```typescript
const envAwarePlugin: ServerPlugin = async (fastify, options) => {
  fastify.get("/api/env", async (request) => {
    const isDev = (request as FastifyRequest & { isDevelopment?: boolean })
      .isDevelopment;
    return { mode: isDev ? "development" : "production" };
  });
};
```

### 4. Validate Input

```typescript
fastify.post(
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
fastify.addHook("onSend", async (request, reply, payload) => {
  reply.header("X-Request-ID", request.id); // ❌ Too late!
  return payload;
});
```

✅ **Correct - set headers before response is sent:**

```typescript
fastify.addHook("onRequest", async (request, reply) => {
  reply.header("X-Request-ID", request.id); // ✅ Perfect timing
});

// Or in preHandler
fastify.addHook("preHandler", async (request, reply) => {
  reply.header("X-Custom-Header", "value"); // ✅ Also works
});
```

**Why this happens:** The `onSend` hook runs after headers have been sent to the client. Use `onRequest` or `preHandler` for setting headers.

## Limitations

### Forbidden Operations

These operations will throw errors:

```typescript
// ❌ Cannot register catch-all routes
fastify.get("*", handler); // Error!
fastify.route({ url: "*", handler }); // Error!

// ❌ Cannot register conflicting hooks
fastify.addHook("onRoute", handler); // Error!
```

### Route Conflicts

The SSR handler uses a catch-all GET route (`*`) that runs last. Your plugin routes will be matched first if they're more specific:

```typescript
// ✅ This works - specific route matched before SSR catch-all
fastify.get("/api/users", handler);

// ✅ This also works - different HTTP method
fastify.post("/some-page", handler);

// ❌ This would conflict if you tried to register it (but it's prevented)
fastify.get("*", handler);
```

## Integration with Third-Party Plugins

Many Fastify ecosystem plugins work seamlessly:

```typescript
const corsPlugin: ServerPlugin = async (fastify) => {
  await fastify.register(require("@fastify/cors"), {
    origin: ["https://yourdomain.com"],
    credentials: true,
  });
};

const rateLimitPlugin: ServerPlugin = async (fastify) => {
  await fastify.register(require("@fastify/rate-limit"), {
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

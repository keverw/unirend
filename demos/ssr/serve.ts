/**
 * SSR Server Script for Testing
 *
 * This script demonstrates how to use the unirend SSR server in both
 * development and production modes. It follows the structure from ssr.ts
 * to test the SSRServer functionality.
 *
 * Usage:
 *   bun run serve.ts dev    # Development mode with Vite HMR
 *   bun run serve.ts prod   # Production mode with built assets
 */

import {
  serveSSRDev,
  serveSSRProd,
  type SSRPlugin,
  type ControlledFastifyInstance,
  type PluginOptions,
} from "../../src/server";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { mkdir } from "fs/promises";

const PORT = 3000;
const HOST = "localhost";

/**
 * Helper function to log server startup information
 */
function logServerStartup(mode: "dev" | "prod", host: string, port: number) {
  const modeEmoji = mode === "dev" ? "🔥" : "📦";
  const modeText = mode === "dev" ? "Development" : "Production";
  const extraInfo =
    mode === "dev"
      ? "Hot Module Replacement is enabled"
      : "Serving pre-built assets";

  console.log(`✅ ${modeText} SSR server listening on http://${host}:${port}`);
  console.log(`${modeEmoji} ${extraInfo}`);
  console.log("🧪 Try these plugin endpoints:");
  console.log(`   GET  http://${host}:${port}/api/health`);
  console.log(`   GET  http://${host}:${port}/api/contact`);
  console.log(
    `   GET  http://${host}:${port}/api/error (throws an error for testing)`,
  );
  console.log(
    `   GET  http://${host}:${port}/api/upload (info about upload endpoints)`,
  );
  console.log("📁 File upload endpoints with different size limits:");
  console.log(
    `   POST http://${host}:${port}/api/upload/avatar (1MB max, images only)`,
  );
  console.log(
    `   POST http://${host}:${port}/api/upload/document (5MB max, docs only)`,
  );
  console.log(
    `   POST http://${host}:${port}/api/upload/media (10MB max, media files)`,
  );
}

// Example plugin for API routes and request logging
const apiRoutesPlugin: SSRPlugin = async (
  fastify: ControlledFastifyInstance,
  options: PluginOptions,
) => {
  console.log(`🔌 Registering API routes plugin (${options.mode} mode)`);

  // Global request logging and timing (replaces the old onRequest hook)
  fastify.addHook("onRequest", async (request, reply) => {
    // Log all requests
    console.log(
      `[${new Date().toISOString()}] ${request.method} ${request.url}`,
    );

    // Add request timing
    (request as any).startTime = Date.now();

    // Add custom headers
    reply.header("X-Powered-By", "Unirend SSR");

    // You can add authentication, rate limiting, etc. here
    // const user = await authenticate(request.headers.authorization);
    // (request as any).user = user;
  });

  // Add API routes that won't conflict with SSR
  fastify.get("/api/health", async (_request, _reply) => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      mode: options.mode,
    };
  });

  // Contact endpoint - both GET (for browser testing) and POST (for real forms)
  fastify.get("/api/contact", async (_request, reply) => {
    reply.type("text/plain");
    return `Contact API Endpoint

Use POST with JSON body for actual contact form submissions

Examples:
GET:  curl http://localhost:3000/api/contact
POST: curl -X POST http://localhost:3000/api/contact -H 'Content-Type: application/json' -d '{"name":"John","email":"john@example.com","message":"Hello!"}'

Sample Data:
{
  "name": "John Doe",
  "email": "john@example.com", 
  "message": "Hello from the contact form!"
}`;
  });

  fastify.post("/api/contact", async (request, _reply) => {
    const body = request.body as any;
    console.log("Contact form submission:", body);

    // Simulate processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    return { success: true, message: "Contact form received", data: body };
  });

  // Test route that throws an error
  fastify.get("/api/error", async (_request, _reply) => {
    throw new Error("This is a test error from /api/error endpoint!");
  });

  // Add response timing for API requests
  fastify.addHook("onSend", async (request, _reply, payload) => {
    if (request.url.startsWith("/api/") && (request as any).startTime) {
      const duration = Date.now() - (request as any).startTime;
      console.log(
        `⚡ API Response: ${request.method} ${request.url} (${duration}ms)`,
      );
    }
    return payload;
  });
};

// Example plugin for file uploads with real @fastify/multipart integration
const fileUploadPlugin: SSRPlugin = async (
  fastify: ControlledFastifyInstance,
  options: PluginOptions,
) => {
  console.log(`📁 Registering file upload plugin (${options.mode} mode)`);

  try {
    // Try to register multipart plugin for file uploads
    const multipart = await import("@fastify/multipart");
    await fastify.register(multipart.default, {
      // Disable throwing errors on file size limit, rely on truncated flag
      throwFileSizeLimit: false,
      limits: {
        fileSize: 1, // 1 byte global max - can be overridden per request (just for testing!)
        fieldSize: 1024, // 1KB max for form field values (good security practice)
        files: 1,
        fields: 10,
      },
    });

    console.log(`✅ @fastify/multipart plugin loaded - file uploads enabled`);

    // Route guard: Only allow multipart data on specific, defined upload endpoints
    // This prevents multipart data from hitting other API routes (security/performance)
    const definedUploadRoutes = [
      "/api/upload/avatar",
      "/api/upload/document",
      "/api/upload/media",
      "/api/upload/test", // Test endpoint for global 1-byte limit
    ];

    fastify.addHook("preHandler", async (request, reply) => {
      const isDefinedUploadRoute = definedUploadRoutes.some(
        (route) => request.url === route,
      );

      const isMultipart = request.headers["content-type"]?.startsWith(
        "multipart/form-data",
      );

      if (isMultipart && !isDefinedUploadRoute) {
        return reply.code(400).send({
          error: "Multipart data not allowed on this endpoint",
          message:
            "Multipart uploads only allowed on specific, configured routes",
          received: request.url,
          allowedEndpoints: definedUploadRoutes,
          note: "This prevents bandwidth waste on undefined upload routes",
        });
      }
    });

    // Upload info endpoint (GET for browser testing)
    fastify.get("/api/upload", async (_request, reply) => {
      reply.type("text/plain");
      return `File Upload API Endpoints

✅ @fastify/multipart plugin is installed and active!

Route-specific size limits (enforced during STREAMING - monitoring actual bytes):
/api/upload/avatar    - Max 1MB   (profile pictures, images only)
/api/upload/document  - Max 5MB   (PDFs, docs only) 
/api/upload/media     - Max 10MB  (videos, images, audio)
/api/upload/test      - Global limit (1 byte for testing)

Examples:
curl -X POST -F 'file=@small-pic.jpg' http://localhost:3000/api/upload/avatar
curl -X POST -F 'file=@document.pdf' http://localhost:3000/api/upload/document  
curl -X POST -F 'file=@video.mp4' http://localhost:3000/api/upload/media
curl -X POST -F 'file=@tiny.txt' http://localhost:3000/api/upload/test

TRUE PER-REQUEST STREAMING VALIDATION:
- Each route uses req.file({ limits: { fileSize: N } }) for precise control
- Files are truncated during upload when exceeding route-specific limits
- Cannot be spoofed with fake Content-Length headers - monitors real bytes
- Route guard prevents multipart data on non-upload endpoints
- File type validation per route (images/documents/media)
- Detects file.truncated flag for immediate size limit feedback`;
    });

    /**
     * A reusable handler for processing file uploads with validation.
     * This consolidates the logic for avatars, documents, and media.
     */
    async function handleFileUpload(
      request: any,
      reply: any,
      config: {
        typeName: "Avatar" | "Document" | "Media" | "Test";
        maxSize?: number; // Optional - if undefined, uses global limit
        maxSizeLabel: string; // Human-readable size description
        allowedMimeTypes: string[] | ((mime: string) => boolean);
        allowedMimeTypesDesc: string;
      },
    ) {
      try {
        // Per-request size limit, explicitly disabling error throwing
        // If maxSize is undefined, don't override global limit
        const options = config.maxSize
          ? {
              throwFileSizeLimit: false,
              limits: { fileSize: config.maxSize },
            }
          : {
              throwFileSizeLimit: false,
              // No limits override - uses global multipart limits
            };

        const data = await request.file(options);

        if (!data) {
          return reply
            .code(400)
            .send({ error: `No file uploaded for ${config.typeName}` });
        }

        // --- Stream Validation & Processing ---

        // With throwFileSizeLimit: false, we must check the truncated flag after the stream ends.
        // We'll pipe the file to a temporary location to demonstrate a real-world scenario.

        const uploadDir = "./uploads";
        await mkdir(uploadDir, { recursive: true }); // Ensure upload directory exists
        const tempPath = `${uploadDir}/${Date.now()}-${data.filename}`;

        try {
          // In a real app, you would stream the file to disk, S3, etc.
          // This consumes the stream, preventing memory leaks.
          await pipeline(data.file, createWriteStream(tempPath));

          // IMPORTANT: Check for truncation *after* the pipeline finishes.
          if (data.file.truncated) {
            console.log(`🚨 File truncated after saving: ${tempPath}`);
            // In a real app, you would delete the partial file from storage.
            // await unlink(tempPath);

            return reply.code(413).send({
              error: `${config.typeName} file too large`,
              maxSize: config.maxSizeLabel,
              message: `File exceeded size limit during streaming and was truncated.`,
              note: "Partial file has been discarded.",
            });
          }
        } catch (streamError: any) {
          console.error(`🚨 Error during file stream pipeline:`, streamError);
          return reply
            .code(500)
            .send({ error: "Failed to save file during streaming." });
        }

        // --- Mime Type Validation (after saving) ---

        // SECURITY BEST PRACTICE: For robust security, NEVER trust the client-provided mimetype or filename alone.
        // A malicious user could upload a script renamed as 'image.jpg'. In a production app, you should
        // also verify the file's "magic bytes" to confirm its true type. Libraries like `file-type` can do this.

        // Example:
        // import { fileTypeFromFile } from 'file-type';
        // const typeInfo = await fileTypeFromFile(tempPath);
        // if (!typeInfo || !isMimeTypeAllowed(typeInfo.mime)) { /* reject file */ }

        // PRODUCTION STRATEGY: For image uploads, it's common to save the original file
        // and then create pre-processed versions (e.g., thumbnails, different resolutions)
        // for efficient delivery to clients. This can be done in a background job queue.
        // Libraries like `sharp` are excellent for image processing

        const isMimeTypeAllowed = Array.isArray(config.allowedMimeTypes)
          ? config.allowedMimeTypes.includes(data.mimetype)
          : config.allowedMimeTypes(data.mimetype);

        if (!isMimeTypeAllowed) {
          // In a real app, you would delete the invalid file.
          // await unlink(tempPath);
          return reply.code(415).send({
            error: `Invalid file type for ${config.typeName}`,
            allowed: config.allowedMimeTypesDesc,
            received: data.mimetype,
          });
        }

        const successMessage = `✅ ${config.typeName} uploaded and saved: ${data.filename} to ${tempPath}`;
        console.log(successMessage);

        // In a real app, you would now move the file from tempPath to permanent storage
        // or return the file path/URL. For the demo, we just confirm success.

        return {
          success: true,
          type: config.typeName.toLowerCase(),
          filename: data.filename,
          mimetype: data.mimetype,
          size: data.file.bytesRead,
          // In a real app, you'd return a URL or file ID, not the temp path.
          // path: tempPath
        };
      } catch (error: any) {
        console.error(`🚨 ${config.typeName} upload error:`, error);
        return reply.code(500).send({
          error: `${config.typeName} upload failed`,
          message: error.message || "An unknown error occurred",
        });
      }
    }

    // Avatar upload - Small files only (1MB limit enforced per-request)
    fastify.post("/api/upload/avatar", (request, reply) => {
      return handleFileUpload(request, reply, {
        typeName: "Avatar",
        maxSize: 1024 * 1024,
        maxSizeLabel: "1MB",
        allowedMimeTypes: ["image/jpeg", "image/png", "image/gif"],
        allowedMimeTypesDesc: "JPEG, PNG, GIF only",
      });
    });

    // Document upload - Medium files (5MB limit enforced per-request)
    fastify.post("/api/upload/document", (request, reply) => {
      return handleFileUpload(request, reply, {
        typeName: "Document",
        maxSize: 5 * 1024 * 1024,
        maxSizeLabel: "5MB",
        allowedMimeTypes: [
          "application/pdf",
          "text/plain",
          "application/msword",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ],
        allowedMimeTypesDesc: "PDF, TXT, DOC, DOCX only",
      });
    });

    // Media upload - Large files (10MB limit enforced per-request)
    fastify.post("/api/upload/media", (request, reply) => {
      return handleFileUpload(request, reply, {
        typeName: "Media",
        maxSize: 10 * 1024 * 1024,
        maxSizeLabel: "10MB",
        allowedMimeTypes: (mime) =>
          mime.startsWith("image/") ||
          mime.startsWith("video/") ||
          mime.startsWith("audio/"),
        allowedMimeTypesDesc: "Images, videos, and audio files only",
      });
    });

    // Test upload - Uses global 1-byte limit (no per-request override)
    fastify.post("/api/upload/test", (request, reply) => {
      return handleFileUpload(request, reply, {
        typeName: "Test",
        // maxSize: undefined - uses global 1-byte limit
        maxSizeLabel: "global (1 byte)",
        allowedMimeTypes: () => true, // Accept any file type for testing
        allowedMimeTypesDesc: "Any file type (testing global limit)",
      });
    });

    // The route guard in preHandler already prevents multipart data on undefined routes
    // Any undefined /api/upload/* routes will hit the SSR 404 handler
  } catch (error: any) {
    console.error(
      "❌ Failed to load @fastify/multipart plugin:",
      error.message,
    );

    console.error("💡 Install with: bun add @fastify/multipart");
    throw new Error("@fastify/multipart plugin is required for file uploads");
  }
};

// Example plugin for request tracking and decorators
const requestTrackingPlugin: SSRPlugin = async (
  fastify: ControlledFastifyInstance,
  options: PluginOptions,
) => {
  console.log(`🔍 Registering request tracking plugin (${options.mode} mode)`);

  // Add request ID decorator
  fastify.decorateRequest("requestId", null);

  // Add custom hook for request IDs
  fastify.addHook("onRequest", async (request, reply) => {
    // Generate unique request ID for tracking
    (request as any).requestId =
      `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Add request ID to response headers for debugging/tracing
    reply.header("X-Request-ID", (request as any).requestId);

    // Optional: Add environment info in development
    if (options.isDevelopment) {
      reply.header("X-Dev-Mode", "true");
    }
  });
};

// Parse command line arguments
const mode = process.argv[2];

if (!mode || !["dev", "prod"].includes(mode)) {
  console.error("Usage: bun run serve.ts <dev|prod>");
  console.error("  dev  - Start development server with Vite HMR");
  console.error("  prod - Start production server with built assets");
  process.exit(1);
}

async function startServer() {
  console.log(`🚀 Starting SSR server in ${mode} mode...`);

  try {
    if (mode === "dev") {
      // Development mode - uses source files with Vite HMR
      const server = await serveSSRDev(
        {
          // Required paths for development
          serverEntry: "./src/entry-server.tsx",
          template: "./index.html",
          viteConfig: "./vite.config.ts",
        },
        {
          // Development options
          containerID: "root",
          // Plugin system - register custom functionality
          plugins: [apiRoutesPlugin, fileUploadPlugin, requestTrackingPlugin],
          // Custom Fastify configuration
          fastifyOptions: {
            logger: true, // Enable Fastify's built-in logger for dev
          },
          // Custom 500 error page (optional)
          // Uncomment and customize the following function to provide a custom error page.
          // You have access to `request`, `error`, and `isDevelopment` variables.
          /*
          get500ErrorPage: (request, error, isDevelopment) => {
            return `
              <!DOCTYPE html>
              <html>
                <head>
                  <title>Oops! Something went wrong</title>
                  <style>
                    body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
                    .error-container { max-width: 600px; margin: 0 auto; }
                    h1 { color: #e74c3c; }
                  </style>
                </head>
                <body>
                  Custom 500 error page Body Here
                </body>
              </html>
            `;
          },
          */
          // clientFolderName: "dist", // Optional: custom client folder
          // serverFolderName: "backend", // Optional: custom server folder
        },
      );

      await server.listen(PORT, HOST);
      logServerStartup("dev", HOST, PORT);
    } else if (mode === "prod") {
      // Production mode - uses built assets
      const server = await serveSSRProd("./build", {
        // Production options
        containerID: "root",
        serverEntry: "entry-server", // Look for entry-server in manifest
        // Plugin system - same plugins work in production
        plugins: [apiRoutesPlugin, fileUploadPlugin, requestTrackingPlugin],
        // Custom Fastify configuration
        fastifyOptions: {
          logger: {
            level: "warn", // Only show warnings and errors in production
          },
        },
        frontendAppConfig: {
          // Example config that gets injected as window.__APP_CONFIG__
          apiUrl: "https://api.example.com",
          version: "1.0.0",
          environment: "production",
        },
        // clientFolderName: "client", // Default: "client"
        // serverFolderName: "server", // Default: "server"
      });

      await server.listen(PORT, HOST);
      logServerStartup("prod", HOST, PORT);
    }
  } catch (error) {
    console.error(`❌ Failed to start ${mode} server:`, error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down server...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Shutting down server...");
  process.exit(0);
});

// Start the server
startServer().catch((error) => {
  console.error("❌ Server startup failed:", error);
  process.exit(1);
});

/**
 * Demo of the APIServer functionality
 *
 * This demonstrates how to create an API-only server with full wildcard support
 * using the serveAPI function from unirend.
 */

import { serveAPI, type APIServerOptions } from "../src/server";

async function runAPIServerDemo() {
  console.log("🚀 Starting API Server Demo...\n");

  const options: APIServerOptions = {
    isDevelopment: true,
    plugins: [
      // Plugin demonstrating full wildcard support
      async (fastify, pluginOptions) => {
        console.log("📦 Registering API plugin with options:", pluginOptions);

        // Root wildcard route - this would be blocked in SSR servers!
        fastify.get("*", async (request, _reply) => {
          return {
            message: "Catch-all route - this works in API servers!",
            path: request.url,
            method: request.method,
            timestamp: new Date().toISOString(),
          };
        });

        // API wildcard routes
        fastify.get("/api/*", async (request, _reply) => {
          return {
            message: "API wildcard route",
            path: request.url,
            api: true,
            timestamp: new Date().toISOString(),
          };
        });

        // Specific API endpoints
        fastify.get("/api/users", async (_request, _reply) => {
          return {
            users: [
              { id: 1, name: "Alice" },
              { id: 2, name: "Bob" },
            ],
          };
        });

        fastify.post("/api/users", async (request, _reply) => {
          return {
            message: "User created",
            user: request.body,
            timestamp: new Date().toISOString(),
          };
        });

        // Health check
        fastify.get("/health", async (_request, _reply) => {
          return {
            status: "healthy",
            timestamp: new Date().toISOString(),
            server: "unirend-api",
          };
        });
      },
    ],
    errorHandler: (request, error, isDevelopment) => {
      console.error("🚨 API Error:", error.message);

      return {
        error: true,
        message: error.message,
        path: request.url,
        method: request.method,
        timestamp: new Date().toISOString(),
        ...(isDevelopment && { stack: error.stack }),
      };
    },
    fastifyOptions: {
      logger: {
        level: "info",
      },
    },
  };

  try {
    const server = serveAPI(options);
    await server.listen(3001, "localhost");

    console.log("✅ API Server started successfully!");
    console.log("🌐 Try these endpoints:");
    console.log("   GET  http://localhost:3001/health");
    console.log("   GET  http://localhost:3001/api/users");
    console.log("   POST http://localhost:3001/api/users");
    console.log("   GET  http://localhost:3001/api/anything (wildcard)");
    console.log("   GET  http://localhost:3001/anything (catch-all)");
    console.log("\n💡 Notice: Root wildcard (*) routes work in API servers!");
    console.log(
      "   This would be blocked in SSR servers to prevent conflicts.",
    );

    // Keep the demo running for a bit
    console.log("\n⏱️  Demo will run for 30 seconds...");
    setTimeout(async () => {
      console.log("\n🛑 Stopping API server...");
      await server.stop();
      console.log("✅ Demo completed!");
    }, 30000);
  } catch (error) {
    console.error("❌ Failed to start API server:", error);
    process.exit(1);
  }
}

// Run the demo
runAPIServerDemo().catch(console.error);

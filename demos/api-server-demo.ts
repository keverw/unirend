/**
 * Demo of the APIServer functionality
 *
 * This demonstrates how to create an API-only server with full wildcard support
 * using the serveAPI function from unirend.
 */

import { serveAPI } from '../src/server';
import type { APIServerOptions, APIServer } from '../src/server';
// import { APIResponseHelpers } from "../src/api-envelope"; // Uncomment when using custom handlers

// Track server instance for graceful shutdown
let server: APIServer | null = null;

async function runAPIServerDemo() {
  console.log('🚀 Starting API Server Demo...\n');

  const options: APIServerOptions = {
    isDevelopment: true,
    plugins: [
      // Plugin demonstrating full wildcard support
      async (fastify, pluginOptions) => {
        console.log('📦 Registering API plugin with options:', pluginOptions);

        // Root wildcard route - this would be blocked in SSR servers!
        // commented out to test 404 handling
        // fastify.get("*", async (request, _reply) => {
        //   return {
        //     message: "Catch-all route - this works in API servers!",
        //     path: request.url,
        //     method: request.method,
        //     timestamp: new Date().toISOString(),
        //   };
        // });

        // API wildcard routes
        fastify.get('/api/*', async (request, _reply) => {
          return {
            message: 'API wildcard route',
            path: request.url,
            api: true,
            timestamp: new Date().toISOString(),
          };
        });

        // Specific API endpoints
        fastify.get('/api/users', async (_request, _reply) => {
          return {
            users: [
              { id: 1, name: 'Alice' },
              { id: 2, name: 'Bob' },
            ],
          };
        });

        fastify.post('/api/users', async (request, _reply) => {
          return {
            message: 'User created',
            user: request.body,
            timestamp: new Date().toISOString(),
          };
        });

        // Health check
        fastify.get('/health', async (_request, _reply) => {
          return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            server: 'unirend-api',
          };
        });

        // Error testing routes
        fastify.get('/api/error', async (_request, _reply) => {
          throw new Error('This is a test error!');
        });

        fastify.get('/api/error/500', async (_request, _reply) => {
          const error = new Error('Custom 500 error') as Error & {
            statusCode?: number;
          };
          error.statusCode = 500;
          throw error;
        });

        fastify.get('/api/error/400', async (_request, _reply) => {
          const error = new Error('Bad request error') as Error & {
            statusCode?: number;
          };
          error.statusCode = 400;
          throw error;
        });

        // Page-data error route (to test envelope detection)
        // Note: page_data endpoints should always be under the API prefix
        fastify.get('/api/v1/page_data/error', async (_request, _reply) => {
          throw new Error('Page data error!');
        });
      },
    ],
    // errorHandler: (request, error, isDevelopment, isPageData) => {
    //   console.error("🚨 API Error:", error.message);

    //   // Return proper envelope response based on request type
    //   if (isPageData) {
    //     // Page data request - return PageErrorResponse
    //     return APIResponseHelpers.createPageErrorResponse({
    //       request,
    //       statusCode: 500,
    //       errorCode: "internal_server_error",
    //       errorMessage: error.message,
    //       pageMetadata: {
    //         title: "Server Error",
    //         description:
    //           "An internal server error occurred while processing your request",
    //       },
    //       errorDetails: {
    //         path: request.url,
    //         method: request.method,
    //         timestamp: new Date().toISOString(),
    //         ...(isDevelopment && { stack: error.stack }),
    //       },
    //     });
    //   } else {
    //     // API request - return APIErrorResponse
    //     return APIResponseHelpers.createAPIErrorResponse({
    //       request,
    //       statusCode: 500,
    //       errorCode: "internal_server_error",
    //       errorMessage: error.message,
    //       errorDetails: {
    //         path: request.url,
    //         method: request.method,
    //         timestamp: new Date().toISOString(),
    //         ...(isDevelopment && { stack: error.stack }),
    //       },
    //     });
    //   }
    // },
    // notFoundHandler: (request, isPageData) => {
    //   console.log("🔍 Custom 404 Handler:", request.url, "isPageData:", isPageData);

    //   // Return proper envelope response based on request type
    //   if (isPageData) {
    //     // Page data request - return PageErrorResponse
    //     return APIResponseHelpers.createPageErrorResponse({
    //       request,
    //       statusCode: 404,
    //       errorCode: "not_found",
    //       errorMessage: `Page data endpoint not found: ${request.url}`,
    //       pageMetadata: {
    //         title: "Page Not Found",
    //         description: "The requested page data could not be found",
    //       },
    //       errorDetails: {
    //         path: request.url,
    //         method: request.method,
    //         isPageRequest: true,
    //         timestamp: new Date().toISOString(),
    //         suggestion:
    //           "Try checking the page route or data loader configuration",
    //       },
    //     });
    //   } else {
    //     // API request - return APIErrorResponse
    //     return APIResponseHelpers.createAPIErrorResponse({
    //       request,
    //       statusCode: 404,
    //       errorCode: "not_found",
    //       errorMessage: `API endpoint not found: ${request.url}`,
    //       errorDetails: {
    //         path: request.url,
    //         method: request.method,
    //         isPageRequest: false,
    //         timestamp: new Date().toISOString(),
    //         suggestion: "Check the API endpoint URL and method",
    //       },
    //     });
    //   }
    // },
    fastifyOptions: {
      logger: {
        level: 'info',
      },
    },
  };

  try {
    server = serveAPI(options);
    await server.listen(3001, 'localhost');

    console.log('✅ API Server started successfully!');
    console.log('🌐 Try these endpoints:');
    console.log('\n📋 Working routes:');
    console.log('   GET  http://localhost:3001/health');
    console.log('   GET  http://localhost:3001/api/users');
    console.log('   POST http://localhost:3001/api/users');
    console.log('   GET  http://localhost:3001/api/anything (wildcard)');
    console.log('\n🚨 Error testing routes:');
    console.log('   GET  http://localhost:3001/api/error (throws error)');
    console.log('   GET  http://localhost:3001/api/error/500 (custom 500)');
    console.log('   GET  http://localhost:3001/api/error/400 (custom 400)');
    console.log(
      '   GET  http://localhost:3001/api/v1/page_data/error (page envelope)',
    );
    console.log('\n🔍 404 testing routes:');
    console.log('   GET  http://localhost:3001/not-found (API 404 envelope)');
    console.log(
      '   GET  http://localhost:3001/api/v1/page_data/not-found (Page 404 envelope)',
    );
    console.log(
      '\n💡 Notice: Wildcard route commented out to test 404 handling!',
    );
    console.log('   Uncomment the wildcard to see catch-all behavior.');

    // Keep the demo running for a bit
    // console.log("\n⏱️  Demo will run for 30 seconds...");
    // setTimeout(async () => {
    //   console.log("\n🛑 Stopping API server...");
    //   await server.stop();
    //   console.log("✅ Demo completed!");
    // }, 30000);
  } catch (error) {
    console.error('❌ Failed to start API server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
const shutdown = async (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Shutting down API server...`);

  try {
    if (server && server.isListening()) {
      await server.stop();
      server = null;
      console.log('✅ Server stopped gracefully');
    }
  } catch (err) {
    console.error('Error during shutdown:', err);
  } finally {
    process.exit(0);
  }
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Run the demo
runAPIServerDemo().catch(console.error);

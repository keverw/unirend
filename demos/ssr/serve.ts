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
  PluginHostInstance,
  FileUploadHelpers,
} from '../../src/server';
import type {
  ServerPlugin,
  SSRServer,
  PluginOptions,
  ControlledReply,
} from '../../src/server';
import { APIResponseHelpers } from '../../src/api-envelope';
import type { BaseMeta } from '../../src/api-envelope';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import { FastifyReply, FastifyRequest } from 'fastify';
import type { PageDataHandlerParams } from '../../src/lib/internal/DataLoaderServerHandlerHelpers';
import { clientInfo } from '../../src/plugins';

const PORT = 3000;
const HOST = 'localhost';

// Track the running server instance for graceful shutdown
let currentServer: SSRServer | null = null;

/**
 * Custom meta type for this demo that includes additional application context
 */
interface DemoMeta extends BaseMeta {
  account?: {
    isAuthenticated: boolean;
    userID?: string;
    role?: 'user' | 'admin';
  };
  app: {
    version: string;
    environment: string;
    buildTime: string;
  };
}

/**
 * DemoResponseHelpers - injects default app meta (version/environment/buildTime)
 * into envelopes to reduce duplication in handlers.
 */
class DemoResponseHelpers extends APIResponseHelpers {
  private static buildDefaultMeta(request: FastifyRequest): Partial<DemoMeta> {
    const isDev = Boolean(
      (request as FastifyRequest & { isDevelopment?: boolean }).isDevelopment,
    );

    return {
      // Could extract from headers/cookies/auth plugin decoration in real apps
      account: {
        isAuthenticated: false,
      },
      app: {
        version: '1.0.0',
        environment: isDev ? 'development' : 'production',
        buildTime: new Date().toISOString(),
      },
    } as Partial<DemoMeta>;
  }

  private static mergeMeta<M extends BaseMeta>(
    request: FastifyRequest,
    meta?: Partial<M>,
  ): M {
    const defaults = this.buildDefaultMeta(request) as Record<string, unknown>;
    const provided = (meta as unknown as Record<string, unknown>) || {};
    return {
      ...(defaults as Record<string, unknown>),
      ...provided,
    } as unknown as M;
  }

  static createAPISuccessResponse<T, M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    data: T;
    statusCode?: number;
    meta?: Partial<M>;
  }) {
    const meta = this.mergeMeta<M>(params.request, params.meta);
    return APIResponseHelpers.createAPISuccessResponse<T, M>({
      ...params,
      meta,
    });
  }

  static createAPIErrorResponse<M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    statusCode: number;
    errorCode: string;
    errorMessage: string;
    errorDetails?: Record<string, unknown>;
    meta?: Partial<M>;
  }) {
    const meta = this.mergeMeta<M>(params.request, params.meta);
    return APIResponseHelpers.createAPIErrorResponse<M>({
      ...params,
      meta,
    });
  }

  static createPageSuccessResponse<T, M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    data: T;
    pageMetadata: Parameters<
      typeof APIResponseHelpers.createPageSuccessResponse
    >[0]['pageMetadata'];
    statusCode?: number;
    meta?: Partial<M>;
  }) {
    const meta = this.mergeMeta<M>(params.request, params.meta);
    return APIResponseHelpers.createPageSuccessResponse<T, M>({
      ...params,
      meta,
    });
  }

  static createPageRedirectResponse<M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    redirectInfo: Parameters<
      typeof APIResponseHelpers.createPageRedirectResponse
    >[0]['redirectInfo'];
    pageMetadata: Parameters<
      typeof APIResponseHelpers.createPageRedirectResponse
    >[0]['pageMetadata'];
    meta?: Partial<M>;
  }) {
    const meta = this.mergeMeta<M>(params.request, params.meta);
    return APIResponseHelpers.createPageRedirectResponse<M>({
      ...params,
      meta,
    });
  }

  static createPageErrorResponse<M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    statusCode: number;
    errorCode: string;
    errorMessage: string;
    pageMetadata: Parameters<
      typeof APIResponseHelpers.createPageErrorResponse
    >[0]['pageMetadata'];
    errorDetails?: Record<string, unknown>;
    meta?: Partial<M>;
  }) {
    const meta = this.mergeMeta<M>(params.request, params.meta);
    return APIResponseHelpers.createPageErrorResponse<M>({
      ...params,
      meta,
    });
  }
}

/**
 * Shared configuration factory functions for dev and prod modes
 * This eliminates duplication and ensures consistency between environments
 *
 * This uses custom DemoMeta type for richer error responses
 */
function createSharedConfig() {
  // Shared API handling configuration
  const APIHandling = {
    errorHandler: (
      request: FastifyRequest,
      error: Error,
      isDevelopment: boolean,
      isPageData?: boolean,
    ) => {
      console.error('🚨 SSR API Error:', error.message);

      // Create proper envelope response based on request type
      if (isPageData) {
        // Page data request - return PageErrorResponse
        return DemoResponseHelpers.createPageErrorResponse<DemoMeta>({
          request,
          statusCode: 500,
          errorCode: 'internal_server_error',
          errorMessage: 'An internal server error occurred',
          pageMetadata: {
            title: 'Server Error',
            description:
              'An internal server error occurred while processing your request',
          },
          errorDetails: {
            path: request.url,
            method: request.method,
            timestamp: new Date().toISOString(),
            server: 'SSR+API',
            ...(isDevelopment && { stack: error.stack }),
          },
        });
      } else {
        // API request - return APIErrorResponse
        return DemoResponseHelpers.createAPIErrorResponse<DemoMeta>({
          request,
          statusCode: 500,
          errorCode: 'internal_server_error',
          errorMessage: 'An internal server error occurred',
          errorDetails: {
            path: request.url,
            method: request.method,
            timestamp: new Date().toISOString(),
            server: 'SSR+API',
            ...(isDevelopment && { stack: error.stack }),
          },
        });
      }
    },
    notFoundHandler: (request: FastifyRequest, isPageData?: boolean) => {
      console.log('🔍 SSR API 404:', request.url, 'isPageData:', isPageData);

      // Create proper envelope response based on request type
      if (isPageData) {
        // Page data request - return PageErrorResponse
        return DemoResponseHelpers.createPageErrorResponse<DemoMeta>({
          request,
          statusCode: 404,
          errorCode: 'not_found',
          errorMessage: `Page data endpoint not found: ${request.url}`,
          pageMetadata: {
            title: 'Page Not Found',
            description: 'The requested page data could not be found',
          },
          errorDetails: {
            path: request.url,
            method: request.method,
            isPageRequest: true,
            timestamp: new Date().toISOString(),
            server: 'SSR+API',
            suggestion: 'Check your page data loader or route configuration',
          },
        });
      } else {
        // API request - return APIErrorResponse
        return DemoResponseHelpers.createAPIErrorResponse<DemoMeta>({
          request,
          statusCode: 404,
          errorCode: 'not_found',
          errorMessage: `API endpoint not found: ${request.url}`,
          errorDetails: {
            path: request.url,
            method: request.method,
            isPageRequest: false,
            timestamp: new Date().toISOString(),
            server: 'SSR+API',
            suggestion:
              'Verify the API endpoint exists and is properly configured',
          },
        });
      }
    },
  };

  return {
    apiEndpoints: {
      apiEndpointPrefix: '/api',
      versioned: true,
      pageDataEndpoint: 'page_data',
    },
    fileUploads: {
      enabled: true,
      limits: {
        fileSize: 1, // 1 byte global limit - demonstrates per-route overrides work!
        files: 10,
        fields: 10,
        fieldSize: 1024, // 1KB
      },
      allowedRoutes: [
        '/api/upload/avatar',
        '/api/upload/document',
        '/api/upload/media',
        '/api/upload/test',
        '/api/upload/checksum',
      ],
    },
    APIHandling,
    APIResponseHelpersClass: DemoResponseHelpers,
    containerID: 'root' as const,
  };
}

/**
 * Register page data loader handlers for debugging and testing
 * This function is shared between dev and prod modes to avoid duplication
 */
function registerPageDataHandlers(server: SSRServer) {
  // Register test page data loader handler for debugging (success cases)
  server.pageDataHandler.register(
    'test',
    async (
      request: FastifyRequest,
      reply: ControlledReply,
      params: PageDataHandlerParams,
    ) => {
      const devFlag = (request as FastifyRequest & { isDevelopment?: boolean })
        .isDevelopment;

      const environment = devFlag ? 'development' : 'production';

      // Example of setting a cookie from within a page data loader handler
      if (reply.setCookie) {
        reply.setCookie('ssr_demo', environment, {
          path: '/',
          httpOnly: true,
          sameSite: 'lax',
        });
      }

      const reqWithClient = request as FastifyRequest & {
        clientInfo?:
          | { requestID?: string }
          | Record<string, unknown>
          | undefined;
      };

      return DemoResponseHelpers.createPageSuccessResponse({
        request,
        data: {
          message: 'Test page data loader handler response',
          page_type: params.pageType,
          version: params.version,
          invocation_origin: params.invocationOrigin,
          timestamp: new Date().toISOString(),
          server_isDevelopment: !!devFlag,
          request: {
            method: request.method,
            url: request.url,
            // Using the new shortcuts instead of manual extraction
            route_params: params.routeParams,
            query_params: params.queryParams,
            request_path: params.requestPath,
            original_url: params.originalURL,
            headers: Object.fromEntries(Object.entries(request.headers)),
            client_info: reqWithClient.clientInfo ?? null,
          },
        },
        pageMetadata: {
          title: params.routeParams.id
            ? `Test Page Data (ID: ${params.routeParams.id})`
            : 'Test Page Data',
          description:
            'Debug page showing page data loader request and response details',
        },
      });
    },
  );

  // Register 500 error handler
  server.pageDataHandler.register(
    'test-500',
    async (request: FastifyRequest, reply, params: PageDataHandlerParams) => {
      return DemoResponseHelpers.createPageErrorResponse<DemoMeta>({
        request,
        statusCode: 500,
        errorCode: 'internal_error',
        errorMessage:
          'This is a simulated 500 error response (not a thrown error)',
        pageMetadata: {
          title: 'Internal Server Error',
          description: 'An internal server error occurred',
        },
        errorDetails: {
          context: 'This is a simulated 500 error response for testing',
          invocation_origin: params.invocationOrigin,
          timestamp: new Date().toISOString(),
        },
      });
    },
  );

  // Register stacktrace error handler demo for testing
  server.pageDataHandler.register(
    'test-stacktrace',
    async (request: FastifyRequest, reply, params: PageDataHandlerParams) => {
      // Create a sample stacktrace
      let stacktrace: string;

      try {
        throw new Error('Demo error for stacktrace display');
      } catch (error) {
        stacktrace =
          error instanceof Error && error.stack
            ? error.stack
            : 'Error: Demo error\n    at createSampleStacktrace (/demos/ssr/serve.ts)';
      }

      return DemoResponseHelpers.createPageErrorResponse<DemoMeta>({
        request,
        statusCode: 500,
        errorCode: 'demo_stacktrace',
        errorMessage: 'This is a demonstration of an error with stacktrace',
        pageMetadata: {
          title: 'Error with Stacktrace',
          description: 'Demonstration of an error with stacktrace display',
        },
        errorDetails: {
          context:
            'This is a simulated error response that includes a stacktrace',
          invocation_origin: params.invocationOrigin,
          timestamp: new Date().toISOString(),
          stacktrace,
        },
      });
    },
  );

  // Register generic error handler
  server.pageDataHandler.register(
    'test-generic-error',
    async (request: FastifyRequest, reply, params: PageDataHandlerParams) => {
      return DemoResponseHelpers.createPageErrorResponse<DemoMeta>({
        request,
        statusCode: 400,
        errorCode: 'generic_error',
        errorMessage: 'We encountered a problem processing your request',
        pageMetadata: {
          title: 'Error',
          description: 'We encountered an error processing your request.',
        },
        errorDetails: {
          context:
            'This is a demo of a generic error page that is not a 404 or a 500',
          invocation_origin: params.invocationOrigin,
          timestamp: new Date().toISOString(),
        },
      });
    },
  );

  // Register 404 not found handler
  // This might come in handy if you explicitly want to handle 404s in a data loader set within react-router
  // Such as still returning back custom account meta data, etc for a page.
  server.pageDataHandler.register(
    'not-found',
    async (request: FastifyRequest, reply, params: PageDataHandlerParams) => {
      const requestPath = params.requestPath;

      return DemoResponseHelpers.createPageErrorResponse<DemoMeta>({
        request,
        statusCode: 404,
        errorCode: 'not_found',
        errorMessage: 'The requested resource was not found',
        pageMetadata: {
          title: '404 - Page Not Found',
          description: 'The page you are looking for does not exist',
        },
        errorDetails: {
          context: `The requested path '${requestPath}' could not be found`,
          invocation_origin: params.invocationOrigin,
          timestamp: new Date().toISOString(),
        },
      });
    },
  );
}

/**
 * Helper function to log server startup information
 */
function logServerStartup(mode: 'dev' | 'prod', host: string, port: number) {
  const modeEmoji = mode === 'dev' ? '🔥' : '📦';
  const modeText = mode === 'dev' ? 'Development' : 'Production';
  const extraInfo =
    mode === 'dev'
      ? 'Hot Module Replacement is enabled'
      : 'Serving pre-built assets';

  console.log(`✅ ${modeText} SSR server listening on http://${host}:${port}`);
  console.log(`${modeEmoji} ${extraInfo}`);
  console.log('🧪 Try these plugin endpoints:');
  console.log(`   GET  http://${host}:${port}/api/health`);
  console.log(`   GET  http://${host}:${port}/api/contact`);
  console.log(
    `   GET  http://${host}:${port}/api/error (throws an error for testing)`,
  );
  console.log(
    `   GET  http://${host}:${port}/api/upload (info about upload endpoints)`,
  );
  console.log('📁 File upload endpoints with different size limits:');
  console.log(
    `   POST http://${host}:${port}/api/upload/avatar (1MB max, images only)`,
  );
  console.log(
    `   POST http://${host}:${port}/api/upload/document (5MB max, docs only)`,
  );
  console.log(
    `   POST http://${host}:${port}/api/upload/media (10MB max, media files)`,
  );
  console.log('\n🔄 Mixed SSR+API handling:');
  console.log(
    `   GET  http://${host}:${port}/api/not-found (API 404 envelope)`,
  );
  console.log(
    `   GET  http://${host}:${port}/api/page_data/not-found (Page 404 envelope)`,
  );
  console.log(
    `   GET  http://${host}:${port}/api/v1/page_data/not-found (Page 404 envelope - v1 style)`,
  );
  console.log(`   GET  http://${host}:${port}/not-found (SSR 404 page)`);
  console.log('\n🧪 Test page data loader routes:');
  console.log(
    `   GET  http://${host}:${port}/test-page-loader (test page data)`,
  );
  console.log(
    `   GET  http://${host}:${port}/test-page-loader/123 (test page data with ID)`,
  );
  console.log('\n🧰 Custom API shortcut routes:');
  console.log(
    `   GET  http://${host}:${port}/api/v1/demo/echo/123 (API shortcuts demo)`,
  );
  console.log(
    `   GET  http://${host}:${port}/api/v1/demo/bad-envelope (invalid envelope demo)`,
  );
}

// Example plugin for API routes and request logging
const apiRoutesPlugin: ServerPlugin = async (
  fastify: PluginHostInstance,
  options: PluginOptions,
) => {
  console.log(`🔌 Registering API routes plugin (${options.mode} mode)`);

  // Global request logging and timing
  fastify.addHook('onRequest', async (request, reply) => {
    // Log all requests
    console.log(
      `[${new Date().toISOString()}] ${request.method} ${request.url}`,
    );

    // Add request timing
    (request as FastifyRequest & { startTime: number }).startTime = Date.now();

    // Add custom headers
    reply.header('X-Powered-By', 'Unirend SSR Demo');

    // You can add authentication, rate limiting, etc. here
    // const user = await authenticate(request.headers.authorization);
    // (request as any).user = user;
  });

  // Add API routes that won't conflict with SSR
  fastify.get('/api/health', async (request, reply) => {
    reply.type('application/json');
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

  // Contact endpoint - GET returns info about the endpoint
  fastify.get('/api/contact', async (request, _reply) => {
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: {
        endpoint: '/api/contact',
        methods: ['GET', 'POST'],
        description: 'Contact form submission endpoint',
        post_example: {
          url: 'http://localhost:3000/api/contact',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: {
            name: 'John Doe',
            email: 'john@example.com',
            message: 'Hello from the contact form!',
          },
        },
      },
      statusCode: 200,
    });
  });

  fastify.post('/api/contact', async (request, _reply) => {
    const body = request.body as Record<string, unknown>;
    console.log('Contact form submission:', body);

    // Simulate processing
    await new Promise((resolve) => setTimeout(resolve, 100));

    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: { success: true, message: 'Contact form received', data: body },
      statusCode: 201,
    });
  });

  // Test route that throws an error
  fastify.get('/api/error', async (_request, _reply) => {
    throw new Error('This is a test error from /api/error endpoint!');
  });

  // Add response timing for API requests
  fastify.addHook('onSend', async (request, reply, payload) => {
    const requestWithTiming = request as FastifyRequest & {
      startTime?: number;
    };

    if (request.url.startsWith('/api/') && requestWithTiming.startTime) {
      const duration = Date.now() - requestWithTiming.startTime;

      console.log(
        `⚡ API Response: ${request.method} ${request.url} (${duration}ms)`,
      );
    }
    return payload;
  });
};

/**
 * Register file upload routes using server.api helpers
 *
 * Examples:
 * curl -X POST -F 'file=@small-pic.jpg' http://localhost:3000/api/upload/avatar
 * curl -X POST -F 'file=@document.pdf' http://localhost:3000/api/upload/document
 * curl -X POST -F 'file=@video.mp4' http://localhost:3000/api/upload/media
 * curl -X POST -F 'file=@tiny.txt' http://localhost:3000/api/upload/test
 *
 * SECURITY NOTE: All examples below stream files to disk for demonstration.
 * In production, you should ALSO verify file types using magic bytes (e.g., file-type library)
 * to prevent malicious files disguised with fake extensions/MIME types.
 * See docs/file-upload-helpers.md for comprehensive security best practices.
 */
function registerFileUploadRoutes(server: SSRServer) {
  console.log('📁 Registering file upload routes');

  // Upload info endpoint (GET) - returns JSON info about upload endpoints
  server.api.get('upload', async (request) => {
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: {
        endpoint: '/api/upload',
        description: 'File upload endpoints with streaming validation',
        global_limit: '1 byte (demonstrates per-route overrides)',
        routes: {
          '/api/upload/avatar': {
            method: 'POST',
            max_size: '1MB',
            allowed_types: ['image/jpeg', 'image/png', 'image/gif'],
            description: 'Profile pictures',
          },
          '/api/upload/document': {
            method: 'POST',
            max_size: '5MB',
            allowed_types: [
              'application/pdf',
              'text/plain',
              'application/msword',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ],
            description: 'Document uploads',
          },
          '/api/upload/media': {
            method: 'POST',
            max_size: '10MB',
            allowed_types: ['image/*', 'video/*', 'audio/*'],
            description: 'Media files',
          },
          '/api/upload/test': {
            method: 'POST',
            max_size: '1 byte',
            allowed_types: ['*/*'],
            description: 'Test endpoint for demonstrating size limit errors',
          },
          '/api/upload/checksum': {
            method: 'POST',
            max_size: '5MB',
            allowed_types: ['*/*'],
            description:
              'Demonstrates manual chunk processing with abort checks (computes SHA256)',
          },
        },
        examples: {
          avatar:
            "curl -X POST -F 'file=@small-pic.jpg' http://localhost:3000/api/upload/avatar",
          document:
            "curl -X POST -F 'file=@document.pdf' http://localhost:3000/api/upload/document",
          media:
            "curl -X POST -F 'file=@video.mp4' http://localhost:3000/api/upload/media",
          checksum:
            "curl -X POST -F 'file=@document.txt' http://localhost:3000/api/upload/checksum",
        },
      },
      statusCode: 200,
    });
  });

  // Avatar upload - Small files only (1MB limit)
  server.api.post('upload/avatar', async (request, reply) => {
    const result = await FileUploadHelpers.processUpload({
      request,
      reply,
      maxSizePerFile: 1024 * 1024, // 1MB
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
      processor: async (fileStream, metadata, context) => {
        const uploadDir = './uploads';
        await mkdir(uploadDir, { recursive: true });
        const tempPath = `${uploadDir}/${Date.now()}-${metadata.filename}`;

        context.onCleanup(async () => {
          try {
            await unlink(tempPath);
            console.log(`🧹 Cleaned up avatar upload`);
          } catch (err) {
            // File might not exist yet
          }
        });

        await pipeline(fileStream, createWriteStream(tempPath));
        console.log(`✅ Avatar uploaded: ${metadata.filename}`);

        return {
          type: 'avatar',
          filename: metadata.filename,
          mimetype: metadata.mimetype,
          path: tempPath,
        };
      },
    });

    // Handle upload result - return error envelope or success envelope
    if (!result.success) {
      return result.errorEnvelope;
    }

    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: result.files[0].data,
      statusCode: 200,
    });
  });

  // Document upload - Medium files (5MB limit)
  server.api.post('upload/document', async (request, reply) => {
    const result = await FileUploadHelpers.processUpload({
      request,
      reply,
      maxSizePerFile: 5 * 1024 * 1024, // 5MB
      allowedMimeTypes: [
        'application/pdf',
        'text/plain',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      processor: async (fileStream, metadata, context) => {
        const uploadDir = './uploads';
        await mkdir(uploadDir, { recursive: true });
        const tempPath = `${uploadDir}/${Date.now()}-${metadata.filename}`;

        context.onCleanup(async () => {
          try {
            await unlink(tempPath);
            console.log(`🧹 Cleaned up document upload`);
          } catch (err) {
            // File might not exist yet
          }
        });

        await pipeline(fileStream, createWriteStream(tempPath));
        console.log(`✅ Document uploaded: ${metadata.filename}`);

        return {
          type: 'document',
          filename: metadata.filename,
          mimetype: metadata.mimetype,
          path: tempPath,
        };
      },
    });

    // Handle upload result - return error envelope or success envelope
    if (!result.success) {
      return result.errorEnvelope;
    }

    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: result.files[0].data,
      statusCode: 200,
    });
  });

  // Media upload - Large files (10MB limit)
  server.api.post('upload/media', async (request, reply) => {
    const result = await FileUploadHelpers.processUpload({
      request,
      reply,
      maxSizePerFile: 10 * 1024 * 1024, // 10MB
      allowedMimeTypes: (mime: string) => {
        if (
          mime.startsWith('image/') ||
          mime.startsWith('video/') ||
          mime.startsWith('audio/')
        ) {
          return { allowed: true };
        }

        return {
          allowed: false,
          rejectionReason: 'Only image, video, and audio files are allowed',
          allowedTypes: ['image/*', 'video/*', 'audio/*'],
        };
      },
      processor: async (fileStream, metadata, context) => {
        const uploadDir = './uploads';
        await mkdir(uploadDir, { recursive: true });
        const tempPath = `${uploadDir}/${Date.now()}-${metadata.filename}`;

        context.onCleanup(async () => {
          try {
            await unlink(tempPath);
            console.log(`🧹 Cleaned up media upload`);
          } catch (err) {
            // File might not exist yet
          }
        });

        await pipeline(fileStream, createWriteStream(tempPath));
        console.log(`✅ Media uploaded: ${metadata.filename}`);

        return {
          type: 'media',
          filename: metadata.filename,
          mimetype: metadata.mimetype,
          path: tempPath,
        };
      },
    });

    // Handle upload result - return error envelope or success envelope
    if (!result.success) {
      return result.errorEnvelope;
    }

    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: result.files[0].data,
      statusCode: 200,
    });
  });

  // Test upload - 1-byte limit for testing failure path
  server.api.post('upload/test', async (request, reply) => {
    const result = await FileUploadHelpers.processUpload({
      request,
      reply,
      maxSizePerFile: 1, // 1 byte (testing failure path)
      allowedMimeTypes: () => ({ allowed: true }), // Accept any file type
      processor: async (fileStream, metadata, context) => {
        const uploadDir = './uploads';
        await mkdir(uploadDir, { recursive: true });
        const tempPath = `${uploadDir}/${Date.now()}-${metadata.filename}`;

        context.onCleanup(async () => {
          try {
            await unlink(tempPath);
            console.log(`🧹 Cleaned up test upload`);
          } catch (err) {
            // File might not exist yet
          }
        });

        await pipeline(fileStream, createWriteStream(tempPath));
        console.log(`✅ Test uploaded: ${metadata.filename}`);

        return {
          type: 'test',
          filename: metadata.filename,
          mimetype: metadata.mimetype,
          path: tempPath,
        };
      },
    });

    // Handle upload result - return error envelope or success envelope
    if (!result.success) {
      return result.errorEnvelope;
    }

    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: result.files[0].data,
      statusCode: 200,
    });
  });

  // Manual chunk processing with abort checks - demonstrates isAborted() usage
  server.api.post('upload/checksum', async (request, reply) => {
    const result = await FileUploadHelpers.processUpload({
      request,
      reply,
      maxSizePerFile: 5 * 1024 * 1024, // 5MB
      allowedMimeTypes: ['*/*'],
      processor: async (fileStream, metadata, context) => {
        const crypto = await import('crypto');
        const hash = crypto.createHash('sha256');
        const chunks: Buffer[] = [];
        let totalBytes = 0;

        context.onCleanup(async () => {
          console.log(`🧹 Cleaned up checksum upload`);
        });

        // Process stream chunk by chunk with abort checks
        for await (const chunk of fileStream) {
          // Check if aborted before processing this chunk
          if (context.isAborted()) {
            throw new Error('Upload aborted during checksum calculation');
          }

          // Ensure chunk is a Buffer
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;
          hash.update(buffer);
          chunks.push(buffer);
        }

        const checksum = hash.digest('hex');
        console.log(
          `✅ Checksum calculated: ${metadata.filename} (${totalBytes} bytes)`,
        );

        return {
          filename: metadata.filename,
          size: totalBytes,
          checksum,
        };
      },
    });

    if (!result.success) {
      return result.errorEnvelope;
    }

    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: result.files[0].data,
      statusCode: 200,
    });
  });

  // Note: Multipart route guard is handled automatically via fileUploads.allowedRoutes config
  // Any undefined /api/upload/* routes will hit the SSR 404 handler
}

// Shared plugins array used by both dev and prod modes
const SHARED_PLUGINS = [
  clientInfo({
    setResponseHeaders: true,
    logging: { requestReceived: true },
  }),
  apiRoutesPlugin,
];

// Parse command line arguments
const mode = process.argv[2];

if (!mode || !['dev', 'prod'].includes(mode)) {
  console.error('Usage: bun run serve.ts <dev|prod>');
  console.error('  dev  - Start development server with Vite HMR');
  console.error('  prod - Start production server with built assets');
  process.exit(1);
}

async function startServer() {
  console.log(`🚀 Starting SSR server in ${mode} mode...`);

  try {
    if (mode === 'dev') {
      // Development mode - uses source files with Vite HMR
      const server = serveSSRDev(
        {
          // Required paths for development
          serverEntry: './src/entry-server.tsx',
          template: './index.html',
          viteConfig: './vite.config.ts',
        },
        {
          // Development options
          ...createSharedConfig(),
          plugins: SHARED_PLUGINS,
          frontendAppConfig: {
            // Example config that gets injected on the frontend html (SSG/SSR) - see the Frontend App Config Pattern section of the README
            apiUrl: 'http://localhost:3001',
            version: '1.0.0-dev',
            environment: 'development',
          },
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

      // Register page data loader handlers for debugging
      registerPageDataHandlers(server);

      // Register file upload routes
      registerFileUploadRoutes(server);

      // Register a generic API route using versioned API shortcuts
      // Demonstrates server.api.get/post helpers and envelope response helpers
      server.api.get('demo/echo/:id', async (request) => {
        return APIResponseHelpers.createAPISuccessResponse({
          request,
          data: {
            message: 'Hello from API shortcuts',
            id: (request.params as Record<string, unknown>).id,
            query: request.query,
          },
          statusCode: 200,
        });
      });

      // Intentionally invalid envelope demo for validation behavior
      server.api.get('demo/bad-envelope', async (_request) => {
        // This will throw at runtime due to invalid envelope validation
        return { invalid: true } as unknown as ReturnType<
          typeof APIResponseHelpers.createAPISuccessResponse
        >;
      });

      currentServer = server;
      await server.listen(PORT, HOST);
      logServerStartup('dev', HOST, PORT);
    } else if (mode === 'prod') {
      // Production mode - uses built assets
      const server = serveSSRProd('./build', {
        // Production options
        ...createSharedConfig(),
        plugins: SHARED_PLUGINS,
        serverEntry: 'entry-server', // Look for entry-server in manifest
        // Custom Fastify configuration
        fastifyOptions: {
          logger: {
            level: 'warn', // Only show warnings and errors in production
          },
        },
        frontendAppConfig: {
          // Example config that gets injected on the frontend html (SSG/SSR) - see the Frontend App Config Pattern section of the README
          apiUrl: 'https://api.example.com',
          version: '1.0.0-prod',
          environment: 'production',
        },
        // clientFolderName: "client", // Default: "client"
        // serverFolderName: "server", // Default: "server"
      });

      // Register page data loader handlers for debugging
      registerPageDataHandlers(server);

      // Register file upload routes
      registerFileUploadRoutes(server);

      currentServer = server;
      await server.listen(PORT, HOST);
      logServerStartup('prod', HOST, PORT);
    }
  } catch (error) {
    console.error(`❌ Failed to start ${mode} server:`, error);
    process.exit(1);
  }
}

// Handle graceful shutdown by stopping the running server instance
const shutdown = async (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Shutting down server...`);

  try {
    if (currentServer && currentServer.isListening()) {
      await currentServer.stop();
      currentServer = null;
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

// Start the server
startServer().catch((error) => {
  console.error('❌ Server startup failed:', error);
  process.exit(1);
});

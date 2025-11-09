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
  type ServerPlugin,
  type SSRServer,
  type PluginOptions,
  PluginHostInstance,
  type ControlledReply,
} from '../../src/server';
import { APIResponseHelpers, type BaseMeta } from '../../src/api-envelope';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { mkdir } from 'fs/promises';
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
    prefix: '/api', // API routes prefix
    errorHandler: (
      request: FastifyRequest,
      error: Error,
      isDevelopment: boolean,
      isPage?: boolean,
    ) => {
      console.error('🚨 SSR API Error:', error.message);

      // Create proper envelope response based on request type
      if (isPage) {
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
    notFoundHandler: (request: FastifyRequest, isPage?: boolean) => {
      console.log('🔍 SSR API 404:', request.url, 'isPage:', isPage);

      // Create proper envelope response based on request type
      if (isPage) {
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
      defaultVersion: 1,
      pageDataEndpoint: 'page_data',
    },
    APIHandling,
    APIResponseHelpersClass: DemoResponseHelpers,
    containerID: 'root' as const,
  };
}

/**
 * Register page data handlers for debugging and testing
 * This function is shared between dev and prod modes to avoid duplication
 */
function registerPageDataHandlers(server: SSRServer) {
  // Register test page data handler for debugging (success cases)
  server.registerDataLoaderHandler(
    'test',
    async (
      request: FastifyRequest,
      reply: ControlledReply,
      params: PageDataHandlerParams,
    ) => {
      const devFlag = (request as FastifyRequest & { isDevelopment?: boolean })
        .isDevelopment;

      const environment = devFlag ? 'development' : 'production';

      // Example of setting a cookie from within a page data handler
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
          message: 'Test page data handler response',
          pageType: params.pageType,
          version: params.version,
          invocation_origin: params.invocation_origin,
          timestamp: new Date().toISOString(),
          server_isDevelopment: !!devFlag,
          request: {
            method: request.method,
            url: request.url,
            // Using the new shortcuts instead of manual extraction
            route_params: params.route_params,
            query_params: params.query_params,
            request_path: params.request_path,
            original_url: params.original_url,
            headers: Object.fromEntries(Object.entries(request.headers)),
            client_info: reqWithClient.clientInfo ?? null,
          },
        },
        pageMetadata: {
          title: params.route_params.id
            ? `Test Page Data (ID: ${params.route_params.id})`
            : 'Test Page Data',
          description:
            'Debug page showing page data loader request and response details',
        },
      });
    },
  );

  // Register 500 error handler
  server.registerDataLoaderHandler(
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
          invocation_origin: params.invocation_origin,
          timestamp: new Date().toISOString(),
        },
      });
    },
  );

  // Register stacktrace error handler demo for testing
  server.registerDataLoaderHandler(
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
          invocation_origin: params.invocation_origin,
          timestamp: new Date().toISOString(),
          stacktrace,
        },
      });
    },
  );

  // Register generic error handler
  server.registerDataLoaderHandler(
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
          invocation_origin: params.invocation_origin,
          timestamp: new Date().toISOString(),
        },
      });
    },
  );

  // Register 404 not found handler
  // This might come in handy if you explicitly want to handle 404s in a data loader set within react-router
  // Such as still returning back custom account meta data, etc for a page.
  server.registerDataLoaderHandler(
    'not-found',
    async (request: FastifyRequest, reply, params: PageDataHandlerParams) => {
      const request_path = params.request_path;

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
          context: `The requested path '${request_path}' could not be found`,
          invocation_origin: params.invocation_origin,
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

  // Contact endpoint - both GET (for browser testing) and POST (for real forms)
  fastify.get('/api/contact', async (_request, reply) => {
    reply.type('text/plain');
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
 * A reusable handler for processing file uploads with validation.
 * This consolidates the logic for avatars, documents, and media.
 *
 * Note: This handler is only used by POST upload routes below.
 * Since POST responses are typically not cached by intermediaries,
 * we do not add Cache-Control: no-store headers here.
 */
async function handleFileUpload(
  request: FastifyRequest,
  reply: FastifyReply,
  config: {
    typeName: 'Avatar' | 'Document' | 'Media' | 'Test';
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

    const uploadDir = './uploads';
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
          note: 'Partial file has been discarded.',
        });
      }
    } catch (streamError: unknown) {
      console.error(`🚨 Error during file stream pipeline:`, streamError);
      return reply
        .code(500)
        .send({ error: 'Failed to save file during streaming.' });
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
  } catch (error: unknown) {
    console.error(`🚨 ${config.typeName} upload error:`, error);
    return reply.code(500).send({
      error: `${config.typeName} upload failed`,
      message:
        error instanceof Error ? error.message : 'An unknown error occurred',
    });
  }
}

// Example plugin for file uploads with real @fastify/multipart integration
const fileUploadPlugin: ServerPlugin = async (
  fastify: PluginHostInstance,
  options: PluginOptions,
) => {
  console.log(`📁 Registering file upload plugin (${options.mode} mode)`);

  try {
    // Try to register multipart plugin for file uploads
    const multipart = await import('@fastify/multipart');
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
      '/api/upload/avatar',
      '/api/upload/document',
      '/api/upload/media',
      '/api/upload/test', // Test endpoint for global 1-byte limit
    ];

    fastify.addHook('preHandler', async (request, reply) => {
      const isDefinedUploadRoute = definedUploadRoutes.some(
        (route) => request.url === route,
      );

      const isMultipart = request.headers['content-type']?.startsWith(
        'multipart/form-data',
      );

      if (isMultipart && !isDefinedUploadRoute) {
        return reply.code(400).header('Cache-Control', 'no-store').send({
          error: 'Multipart data not allowed on this endpoint',
          message:
            'Multipart uploads only allowed on specific, configured routes',
          received: request.url,
          allowedEndpoints: definedUploadRoutes,
          note: 'This prevents bandwidth waste on undefined upload routes',
        });
      }
    });

    // Upload info endpoint (GET for browser testing)
    fastify.get('/api/upload', async (request, reply) => {
      reply.type('text/plain');
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

    // Avatar upload - Small files only (1MB limit enforced per-request)
    fastify.post('/api/upload/avatar', (request, reply) => {
      return handleFileUpload(request, reply, {
        typeName: 'Avatar',
        maxSize: 1024 * 1024,
        maxSizeLabel: '1MB',
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
        allowedMimeTypesDesc: 'JPEG, PNG, GIF only',
      });
    });

    // Document upload - Medium files (5MB limit enforced per-request)
    fastify.post('/api/upload/document', (request, reply) => {
      return handleFileUpload(request, reply, {
        typeName: 'Document',
        maxSize: 5 * 1024 * 1024,
        maxSizeLabel: '5MB',
        allowedMimeTypes: [
          'application/pdf',
          'text/plain',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        allowedMimeTypesDesc: 'PDF, TXT, DOC, DOCX only',
      });
    });

    // Media upload - Large files (10MB limit enforced per-request)
    fastify.post('/api/upload/media', (request, reply) => {
      return handleFileUpload(request, reply, {
        typeName: 'Media',
        maxSize: 10 * 1024 * 1024,
        maxSizeLabel: '10MB',
        allowedMimeTypes: (mime) =>
          mime.startsWith('image/') ||
          mime.startsWith('video/') ||
          mime.startsWith('audio/'),
        allowedMimeTypesDesc: 'Images, videos, and audio files only',
      });
    });

    // Test upload - Uses global 1-byte limit (no per-request override)
    fastify.post('/api/upload/test', (request, reply) => {
      return handleFileUpload(request, reply, {
        typeName: 'Test',
        // maxSize: undefined - uses global 1-byte limit
        maxSizeLabel: 'global (1 byte)',
        allowedMimeTypes: () => true, // Accept any file type for testing
        allowedMimeTypesDesc: 'Any file type (testing global limit)',
      });
    });

    // The route guard in preHandler already prevents multipart data on undefined routes
    // Any undefined /api/upload/* routes will hit the SSR 404 handler
  } catch (error: unknown) {
    console.error(
      '❌ Failed to load @fastify/multipart plugin:',
      error instanceof Error ? error.message : String(error),
    );

    console.error('💡 Install with: bun add @fastify/multipart');
    throw new Error('@fastify/multipart plugin is required for file uploads');
  }
};

// Shared plugins array used by both dev and prod modes
const SHARED_PLUGINS = [
  clientInfo({
    setResponseHeaders: true,
    logging: { requestReceived: true },
  }),
  apiRoutesPlugin,
  fileUploadPlugin,
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

      // Register page data handlers for debugging
      registerPageDataHandlers(server);

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

      // Register page data handlers for debugging
      registerPageDataHandlers(server);

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

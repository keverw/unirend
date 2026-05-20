import { BaseComponent } from 'lifecycleion/lifecycle-manager';
import type { Logger } from 'lifecycleion/logger';
import {
  serveSSRDev,
  serveSSRProd,
  UnirendLifecycleionLoggerAdaptor,
  processFileUpload,
} from '../../../src/server';
import type {
  SSRServer,
  ServerPlugin,
  PluginOptions,
  PluginHostInstance,
  ControlledReply,
} from '../../../src/server';
import { APIResponseHelpers } from '../../../src/api-envelope';
import type { BaseMeta } from '../../../src/api-envelope';
import { clientInfo, cookies } from '../../../src/plugins';
import type { PageDataHandlerParams } from '../../../src/lib/internal/data-loader-server-handler-helpers';
import { themePlugin } from './plugins/theme';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { mkdir, unlink } from 'fs/promises';
import type { FastifyRequest } from 'fastify';
import path from 'path';
import type { ServerMode } from './start';

const PORT = 3000;
const HOST = '0.0.0.0';

// Resolved relative to this file's location (demos/ssr/server/).
const SRC_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(__dirname, '../build');

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Custom meta type ────────────────────────────────────────────────────────

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

// ─── DemoResponseHelpers ─────────────────────────────────────────────────────
// Injects default app meta (version/environment/buildTime) into envelopes
// to reduce duplication in handlers.

class DemoResponseHelpers extends APIResponseHelpers {
  private static buildDefaultMeta(request: FastifyRequest): Partial<DemoMeta> {
    const isDev = Boolean(
      (request as FastifyRequest & { isDevelopment?: boolean }).isDevelopment,
    );

    return {
      // In a real app this could come from headers, cookies, or an auth plugin decoration.
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
    return { ...defaults, ...provided } as unknown as M;
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
    return APIResponseHelpers.createAPIErrorResponse<M>({ ...params, meta });
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
    return APIResponseHelpers.createPageErrorResponse<M>({ ...params, meta });
  }
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

const apiRoutesPlugin: ServerPlugin = async (
  fastify: PluginHostInstance,
  options: PluginOptions,
) => {
  console.log(`🔌 Registering API routes plugin (${options.mode} mode)`);

  fastify.addHook('onRequest', async (request, reply) => {
    console.log(
      `[${new Date().toISOString()}] ${request.method} ${request.url}`,
    );
    reply.header('X-Powered-By', 'Unirend SSR Demo');

    // Request-wide concerns such as auth, rate limiting, or user decoration
    // are usually registered here before route handlers and SSR rendering run.
  });

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
            message: 'Hello!',
          },
        },
      },
      statusCode: 200,
    });
  });

  fastify.post('/api/contact', async (request, _reply) => {
    const body = request.body as Record<string, unknown>;
    console.log('Contact form submission:', body);
    await new Promise((resolve) => setTimeout(resolve, 100));
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: { success: true, message: 'Contact form received', data: body },
      statusCode: 201,
    });
  });

  fastify.get('/api/error', async (_request, _reply) => {
    throw new Error('This is a test error from /api/error endpoint!');
  });
};

// ─── Page data handlers ───────────────────────────────────────────────────────

function registerPageDataHandlers(server: SSRServer) {
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

  server.pageDataHandler.register(
    'test-500',
    async (request: FastifyRequest, _reply, params: PageDataHandlerParams) => {
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

  server.pageDataHandler.register(
    'test-stacktrace',
    async (request: FastifyRequest, _reply, params: PageDataHandlerParams) => {
      let stack: string;
      try {
        throw new Error('Demo error for stack trace display');
      } catch (error) {
        stack =
          error instanceof Error && error.stack
            ? error.stack
            : 'Error: Demo error\n    at handler (/demos/ssr/server/ssr-component.ts)';
      }

      return DemoResponseHelpers.createPageErrorResponse<DemoMeta>({
        request,
        statusCode: 500,
        errorCode: 'demo_stacktrace',
        errorMessage: 'This is a demonstration of an error with a stack trace',
        pageMetadata: {
          title: 'Error with Stack Trace',
          description: 'Demonstration of an error with stack trace display',
        },
        errorDetails: {
          context:
            'This is a simulated error response that includes a stack trace',
          invocation_origin: params.invocationOrigin,
          timestamp: new Date().toISOString(),
          stack,
        },
      });
    },
  );

  server.pageDataHandler.register(
    'test-generic-error',
    async (request: FastifyRequest, _reply, params: PageDataHandlerParams) => {
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

  // Explicit page-data 404s are useful when a route should still return
  // custom account/app meta along with the not-found envelope.
  server.pageDataHandler.register(
    'not-found',
    async (request: FastifyRequest, _reply, params: PageDataHandlerParams) => {
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
          context: `The requested path '${params.requestPath}' could not be found`,
          invocation_origin: params.invocationOrigin,
          timestamp: new Date().toISOString(),
        },
      });
    },
  );
}

// ─── File upload routes ───────────────────────────────────────────────────────
// SECURITY NOTE: All examples below stream files to disk for demonstration.
// In production, also verify file types using magic bytes (e.g., file-type library)
// to prevent malicious files disguised with fake extensions/MIME types.
// See docs/file-upload-helpers.md for more security guidance.

function registerFileUploadRoutes(server: SSRServer) {
  console.log('📁 Registering file upload routes');

  server.api.get('upload', async (request) => {
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: {
        endpoint: '/api/v1/upload',
        description: 'File upload endpoints with streaming validation',
        global_limit: '1 byte (demonstrates per-route overrides)',
        routes: {
          '/api/v1/upload/avatar': {
            method: 'POST',
            max_size: '1MB',
            allowed_types: ['image/jpeg', 'image/png', 'image/gif'],
            description: 'Profile pictures',
          },
          '/api/v1/upload/document': {
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
          '/api/v1/upload/media': {
            method: 'POST',
            max_size: '10MB',
            allowed_types: ['image/*', 'video/*', 'audio/*'],
            description: 'Media files',
          },
          '/api/v1/upload/test': {
            method: 'POST',
            max_size: '1 byte',
            allowed_types: ['*/*'],
            description: 'Test endpoint for demonstrating size limit errors',
          },
          '/api/v1/upload/checksum': {
            method: 'POST',
            max_size: '5MB',
            allowed_types: ['*/*'],
            description:
              'Demonstrates manual chunk processing with abort checks (computes SHA256)',
          },
        },
        examples: {
          avatar:
            "curl -X POST -F 'file=@small-pic.jpg' http://localhost:3000/api/v1/upload/avatar",
          document:
            "curl -X POST -F 'file=@document.pdf' http://localhost:3000/api/v1/upload/document",
          media:
            "curl -X POST -F 'file=@video.mp4' http://localhost:3000/api/v1/upload/media",
          checksum:
            "curl -X POST -F 'file=@document.txt' http://localhost:3000/api/v1/upload/checksum",
        },
      },
      statusCode: 200,
    });
  });

  server.api.post('upload/avatar', async (request, reply) => {
    const result = await processFileUpload({
      request,
      reply,
      maxSizePerFile: 1024 * 1024,
      allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
      processor: async (fileStream, metadata, context) => {
        const uploadDir = './uploads';
        await mkdir(uploadDir, { recursive: true });
        const tempPath = `${uploadDir}/${Date.now()}-${metadata.filename}`;
        context.onCleanup(async () => {
          try {
            await unlink(tempPath);
          } catch {}
        });
        await pipeline(fileStream, createWriteStream(tempPath));
        return {
          type: 'avatar',
          filename: metadata.filename,
          mimetype: metadata.mimetype,
          path: tempPath,
        };
      },
    });
    if (!result.success) return result.errorEnvelope;
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: result.files[0].data,
      statusCode: 200,
    });
  });

  server.api.post('upload/document', async (request, reply) => {
    const result = await processFileUpload({
      request,
      reply,
      maxSizePerFile: 5 * 1024 * 1024,
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
          } catch {}
        });
        await pipeline(fileStream, createWriteStream(tempPath));
        return {
          type: 'document',
          filename: metadata.filename,
          mimetype: metadata.mimetype,
          path: tempPath,
        };
      },
    });
    if (!result.success) return result.errorEnvelope;
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: result.files[0].data,
      statusCode: 200,
    });
  });

  server.api.post('upload/media', async (request, reply) => {
    const result = await processFileUpload({
      request,
      reply,
      maxSizePerFile: 10 * 1024 * 1024,
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
          } catch {}
        });
        await pipeline(fileStream, createWriteStream(tempPath));
        return {
          type: 'media',
          filename: metadata.filename,
          mimetype: metadata.mimetype,
          path: tempPath,
        };
      },
    });
    if (!result.success) return result.errorEnvelope;
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: result.files[0].data,
      statusCode: 200,
    });
  });

  server.api.post('upload/test', async (request, reply) => {
    const result = await processFileUpload({
      request,
      reply,
      maxSizePerFile: 1, // 1 byte — demonstrates size limit error path
      allowedMimeTypes: () => ({ allowed: true }),
      processor: async (fileStream, metadata, context) => {
        const uploadDir = './uploads';
        await mkdir(uploadDir, { recursive: true });
        const tempPath = `${uploadDir}/${Date.now()}-${metadata.filename}`;
        context.onCleanup(async () => {
          try {
            await unlink(tempPath);
          } catch {}
        });
        await pipeline(fileStream, createWriteStream(tempPath));
        return {
          type: 'test',
          filename: metadata.filename,
          mimetype: metadata.mimetype,
          path: tempPath,
        };
      },
    });
    if (!result.success) return result.errorEnvelope;
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: result.files[0].data,
      statusCode: 200,
    });
  });

  server.api.post('upload/checksum', async (request, reply) => {
    const result = await processFileUpload({
      request,
      reply,
      maxSizePerFile: 5 * 1024 * 1024,
      allowedMimeTypes: ['*/*'],
      processor: async (fileStream, metadata, context) => {
        const crypto = await import('crypto');
        const hash = crypto.createHash('sha256');
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        context.onCleanup(async () => {
          console.log('🧹 Cleaned up checksum upload');
        });
        for await (const chunk of fileStream) {
          if (context.isAborted())
            throw new Error('Upload aborted during checksum calculation');
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          totalBytes += buffer.length;
          hash.update(buffer);
          chunks.push(buffer);
        }
        return {
          filename: metadata.filename,
          size: totalBytes,
          checksum: hash.digest('hex'),
        };
      },
    });
    if (!result.success) return result.errorEnvelope;
    return APIResponseHelpers.createAPISuccessResponse({
      request,
      data: result.files[0].data,
      statusCode: 200,
    });
  });

  // Multipart route guarding is handled by fileUploads.allowedRoutes below.
  // Undefined /api/v1/upload/* routes fall through to the normal 404 handling.
}

// ─── Shared config ────────────────────────────────────────────────────────────
// This factory keeps HMR and built SSR modes on the same API, upload, and
// envelope behavior while letting each mode provide its own assets/config.

function createSharedConfig() {
  const APIHandling = {
    responseTimeHeader: true,
    errorHandler: (
      request: FastifyRequest,
      error: Error,
      isDevelopment: boolean,
      isPageData?: boolean,
    ) => {
      console.error('🚨 SSR API Error:', error.message);
      if (isPageData) {
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
      }
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
    },
    notFoundHandler: (request: FastifyRequest, isPageData?: boolean) => {
      console.log('🔍 SSR API 404:', request.url, 'isPageData:', isPageData);
      if (isPageData) {
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
      }
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
      limits: { fileSize: 1, files: 10, fields: 10, fieldSize: 1024 },
      allowedRoutes: [
        '/api/v1/upload/avatar',
        '/api/v1/upload/document',
        '/api/v1/upload/media',
        '/api/v1/upload/test',
        '/api/v1/upload/checksum',
      ],
    },
    APIHandling,
    APIResponseHelpersClass: DemoResponseHelpers,
    containerID: 'root' as const,
  };
}

function getDemo500ErrorPage(
  request: FastifyRequest,
  error: Error,
  isDevelopment: boolean,
) {
  const requestContext = (
    request as FastifyRequest & {
      requestContext?: Record<string, unknown>;
    }
  ).requestContext;
  const preference =
    requestContext?.themePreference === 'dark' ||
    requestContext?.themePreference === 'light' ||
    requestContext?.themePreference === 'auto'
      ? requestContext.themePreference
      : 'auto';
  const safeMessage = escapeHTML(error.message || 'Unexpected server error');
  const safeStack = error.stack ? escapeHTML(error.stack) : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>500 - Server Error | Unirend SSR Demo</title>
    <meta name="description" content="The server encountered an unexpected error." />
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      * {
        box-sizing: border-box;
      }

      body {
        min-height: 100vh;
        margin: 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: #ffffff;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem;
      }

      html.dark,
      html.dark body {
        background: #1a1a1a;
        color: rgba(255, 255, 255, 0.87);
        color-scheme: dark;
      }

      .card {
        width: min(100%, 640px);
        padding: 2.5rem;
        text-align: center;
        background: rgba(255, 255, 255, 0.14);
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 8px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(10px);
      }

      html.dark .card {
        background: #2d2d2d;
        border-color: #404040;
        box-shadow: none;
        backdrop-filter: none;
      }

      .icon {
        width: 80px;
        height: 80px;
        margin: 0 auto 1.5rem;
        border-radius: 50%;
        display: grid;
        place-items: center;
        background: rgba(255, 255, 255, 0.2);
        font-size: 2.5rem;
      }

      h1 {
        margin: 0 0 1rem;
        font-size: clamp(2rem, 6vw, 2.75rem);
        line-height: 1.1;
      }

      p {
        margin: 0 0 1.5rem;
        color: rgba(255, 255, 255, 0.9);
        font-size: 1.05rem;
        line-height: 1.6;
      }

      .actions {
        display: flex;
        justify-content: center;
        gap: 1rem;
        flex-wrap: wrap;
        margin-top: 2rem;
      }

      a,
      button {
        display: inline-block;
        min-width: 8rem;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: #ffffff;
        font: inherit;
        font-weight: 600;
        text-decoration: none;
        cursor: pointer;
      }

      button {
        background: rgba(255, 255, 255, 0.2);
      }

      a {
        background: transparent;
        color: rgba(255, 255, 255, 0.9);
      }

      .details {
        margin-top: 2rem;
        text-align: left;
      }

      .details h2 {
        font-size: 1rem;
        margin: 0 0 0.75rem;
      }

      pre {
        margin: 0;
        max-height: 240px;
        overflow: auto;
        white-space: pre-wrap;
        word-break: break-word;
        padding: 1rem;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        background: rgba(0, 0, 0, 0.3);
        color: rgba(255, 255, 255, 0.86);
        font-size: 0.85rem;
        line-height: 1.45;
      }
    </style>
    <script>
      (function () {
        var pref = ${JSON.stringify(preference)};
        var systemDark =
          typeof window.matchMedia === 'function' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches;
        var theme = pref === 'auto' ? (systemDark ? 'dark' : 'light') : pref;

        if (theme === 'dark') {
          document.documentElement.classList.add('dark');
        }
      })();
    </script>
  </head>
  <body>
    <main class="card">
      <div class="icon" aria-hidden="true">💥</div>
      <h1>Oops! Something went wrong</h1>
      <p>
        We're sorry, but the server encountered an unexpected error while rendering this page.
        Please try again or return home.
      </p>
      <div class="actions">
        <button type="button" onclick="window.location.reload()">Try Again</button>
        <a href="/">Go Home</a>
      </div>
      ${
        isDevelopment
          ? `<section class="details">
        <h2>Development Error Details</h2>
        <pre>${safeMessage}${safeStack ? `\n\n${safeStack}` : ''}</pre>
      </section>`
          : ''
      }
    </main>
  </body>
</html>`;
}

// ─── SSRServerComponent ───────────────────────────────────────────────────────

interface SSRServerComponentOptions {
  mode: ServerMode;
}

export class SSRServerComponent extends BaseComponent {
  private server: SSRServer | null = null;
  // Stored so concurrent callers (e.g. onShutdownForce) join the same
  // in-flight promise rather than starting a second concurrent close.
  private stopPromise: Promise<void> | null = null;
  private readonly mode: ServerMode;

  constructor(logger: Logger, options: SSRServerComponentOptions) {
    super(logger, {
      name: 'ssr-server',
      // 30s graceful: gives the server time to drain in-flight requests and active
      // WebSocket connections before force-closing.
      shutdownGracefulTimeoutMS: 30_000,
      // 5s force: after closeAllConnections() kicks in, stop() should resolve almost
      // immediately — this is just a safety net for anything that still hangs.
      shutdownForceTimeoutMS: 5_000,
    });
    this.mode = options.mode;
  }

  public async start() {
    const sharedConfig = createSharedConfig();

    // This level controls the adapter's gate — what Fastify passes to the Lifecycleion
    // logger. Set to 'debug' so everything gets through and the ConsoleSink's minLevel
    // does the real filtering in one place.
    const loggingConfig = {
      logger: UnirendLifecycleionLoggerAdaptor(this.logger),
      level: 'debug' as const,
    };

    const SHARED_PLUGINS = [
      clientInfo({
        setResponseHeaders: true,
        logging: { requestReceived: true },
      }),
      cookies(),
      themePlugin(),
      apiRoutesPlugin,
    ];

    if (this.mode === 'hmr') {
      this.server = serveSSRDev(
        {
          serverEntry: path.join(SRC_DIR, 'src/EntrySSR.tsx'),
          template: path.join(SRC_DIR, 'index.html'),
          viteConfig: path.join(SRC_DIR, 'vite.config.ts'),
        },
        {
          ...sharedConfig,
          plugins: SHARED_PLUGINS,
          publicAppConfig: {
            api_endpoint: 'http://localhost:3001',
            version: '1.0.0-dev',
            environment: 'development',
          },
          get500ErrorPage: getDemo500ErrorPage,
          logging: loggingConfig,
        },
      );
    } else {
      this.server = serveSSRProd(DIST_DIR, {
        ...sharedConfig,
        serverEntry: 'EntrySSR',
        plugins: SHARED_PLUGINS,
        publicAppConfig: {
          api_endpoint: 'https://api.example.com',
          version: '1.0.0-prod',
          environment: 'production',
        },
        get500ErrorPage: getDemo500ErrorPage,
        logging: loggingConfig,
      });
    }

    // Register page data loader handlers
    registerPageDataHandlers(this.server);

    // Register file upload routes
    registerFileUploadRoutes(this.server);

    // Register API shortcut routes
    this.server.api.get('demo/echo/:id', async (request) => {
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
    this.server.api.get('demo/bad-envelope', async (_request) => {
      return { invalid: true } as unknown as ReturnType<
        typeof APIResponseHelpers.createAPISuccessResponse
      >;
    });

    await this.server.listen(PORT, HOST);

    this.logger.success(
      '{{mode}} SSR server running at http://localhost:{{port}}',
      {
        params: { mode: this.mode === 'hmr' ? 'HMR' : 'Built', port: PORT },
      },
    );

    this.logger.info(
      'Endpoints: GET /api/health, GET /api/contact, POST /api/contact, GET /api/error',
    );
    this.logger.info(
      'Upload endpoints: POST /api/v1/upload/avatar|document|media|test|checksum',
    );
    this.logger.info(
      'Page data: GET /test-page-loader, GET /test-page-loader/:id',
    );
    this.logger.info(
      'API shortcuts: GET /api/v1/demo/echo/:id, GET /api/v1/demo/bad-envelope',
    );
    this.logger.info(
      'Mixed SSR+API: GET /api/not-found, GET /api/v1/page_data/not-found, GET /not-found',
    );
  }

  public async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    this.stopPromise = (async () => {
      try {
        if (this.server?.isListening()) {
          await this.server.stop();
        }
      } finally {
        this.server = null;
        this.stopPromise = null;
      }
    })();

    return this.stopPromise;
  }

  public async onShutdownForce(): Promise<void> {
    // Force-close open connections so server.stop() can finish draining and resolve.
    this.server?.closeAllConnections?.();
    await this.stop();
  }

  public healthCheck() {
    const isHealthy = this.server?.isListening() ?? false;
    return {
      healthy: isHealthy,
      message: isHealthy
        ? `Listening on port ${PORT}`
        : 'Server is not listening',
    };
  }
}

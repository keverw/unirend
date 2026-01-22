import { describe, it, expect, mock } from 'bun:test';
import {
  matchesRoutePattern,
  registerFileUploadValidationHooks,
  registerMultipartPlugin,
} from './file-upload-validation-helpers';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { FileUploadsConfig } from '../types';

describe('matchesRoutePattern', () => {
  describe('Exact matching', () => {
    it('should match exact routes', () => {
      expect(matchesRoutePattern('/api/upload', '/api/upload')).toBe(true);
      expect(
        matchesRoutePattern('/api/upload/avatar', '/api/upload/avatar'),
      ).toBe(true);
    });

    it('should not match different routes', () => {
      expect(matchesRoutePattern('/api/upload', '/api/download')).toBe(false);
      expect(matchesRoutePattern('/api/upload/avatar', '/api/upload/doc')).toBe(
        false,
      );
    });

    it('should not match partial routes', () => {
      expect(matchesRoutePattern('/api/upload', '/api/upload/avatar')).toBe(
        false,
      );
      expect(matchesRoutePattern('/api/upload/avatar', '/api/upload')).toBe(
        false,
      );
    });
  });

  describe('Wildcard patterns', () => {
    it('should match single wildcard segment', () => {
      expect(
        matchesRoutePattern(
          '/api/workspace/123/upload',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
      expect(
        matchesRoutePattern(
          '/api/workspace/abc/upload',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
      expect(
        matchesRoutePattern(
          '/api/workspace/test-id/upload',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
    });

    it('should not match single wildcard with multiple segments', () => {
      // Single * wildcard only matches a single segment
      expect(
        matchesRoutePattern(
          '/api/workspace/123/456/upload',
          '/api/workspace/*/upload',
        ),
      ).toBe(false);
    });

    it('should match double wildcard with multiple segments', () => {
      // ** wildcard matches zero or more segments
      expect(
        matchesRoutePattern('/api/upload/foo/bar/baz', '/api/upload/**'),
      ).toBe(true);
      expect(matchesRoutePattern('/api/upload/foo/bar', '/api/upload/**')).toBe(
        true,
      );
      expect(matchesRoutePattern('/api/upload/foo', '/api/upload/**')).toBe(
        true,
      );
      // Zero segments after **
      expect(matchesRoutePattern('/api/upload', '/api/upload/**')).toBe(true);
    });

    it('should match double wildcard in middle of pattern', () => {
      expect(
        matchesRoutePattern(
          '/api/v1/nested/deep/path/upload',
          '/api/**/upload',
        ),
      ).toBe(true);
      expect(matchesRoutePattern('/api/single/upload', '/api/**/upload')).toBe(
        true,
      );
      expect(matchesRoutePattern('/api/upload', '/api/**/upload')).toBe(true);
    });

    it('should not match double wildcard when suffix does not match', () => {
      expect(
        matchesRoutePattern('/api/upload/foo/bar', '/api/upload/**/download'),
      ).toBe(false);
    });

    it('should match multiple wildcards', () => {
      expect(
        matchesRoutePattern(
          '/api/workspace/123/file/456',
          '/api/workspace/*/file/*',
        ),
      ).toBe(true);
      expect(
        matchesRoutePattern(
          '/api/workspace/abc/file/xyz',
          '/api/workspace/*/file/*',
        ),
      ).toBe(true);
    });

    it('should not match incorrect wildcard patterns', () => {
      expect(
        matchesRoutePattern(
          '/api/workspace/123/upload',
          '/api/workspace/*/download',
        ),
      ).toBe(false);
      expect(
        matchesRoutePattern(
          '/api/different/123/upload',
          '/api/workspace/*/upload',
        ),
      ).toBe(false);
    });
  });

  describe('Path normalization', () => {
    it('should handle trailing slashes - matching with or without', () => {
      // Trailing slashes are normalized away (except for root)
      expect(matchesRoutePattern('/api/upload', '/api/upload/')).toBe(true);
      expect(matchesRoutePattern('/api/upload/', '/api/upload')).toBe(true);
      expect(matchesRoutePattern('/api/upload/', '/api/upload/')).toBe(true);
      expect(matchesRoutePattern('/api/upload', '/api/upload')).toBe(true);
    });

    it('should preserve root path with trailing slash', () => {
      expect(matchesRoutePattern('/', '/')).toBe(true);
      expect(matchesRoutePattern('/api', '/')).toBe(false);
    });

    it('should collapse multiple consecutive slashes', () => {
      // Multiple slashes are normalized to single slash
      expect(matchesRoutePattern('/api//upload', '/api/upload')).toBe(true);
      expect(matchesRoutePattern('/api/upload', '/api//upload')).toBe(true);
      expect(matchesRoutePattern('/api///upload', '/api/upload')).toBe(true);
      expect(matchesRoutePattern('/api/upload///', '/api/upload')).toBe(true);
    });

    it('should escape regex special characters in patterns', () => {
      expect(matchesRoutePattern('/api/upload.json', '/api/upload.json')).toBe(
        true,
      );
      expect(matchesRoutePattern('/api/upload+test', '/api/upload+test')).toBe(
        true,
      );
      expect(matchesRoutePattern('/api/upload(1)', '/api/upload(1)')).toBe(
        true,
      );
    });
  });

  describe('Query string handling (automatic normalization)', () => {
    it('should automatically strip query strings from URLs', () => {
      // Query strings are automatically removed during normalization
      expect(matchesRoutePattern('/api/upload?test=1', '/api/upload')).toBe(
        true,
      );
      expect(
        matchesRoutePattern(
          '/api/upload/avatar?user=123',
          '/api/upload/avatar',
        ),
      ).toBe(true);
      expect(
        matchesRoutePattern(
          '/api/upload/avatar?user=123&token=abc',
          '/api/upload/avatar',
        ),
      ).toBe(true);
    });

    it('should handle query strings with wildcards', () => {
      expect(
        matchesRoutePattern(
          '/api/workspace/123/upload?version=2',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
      expect(
        matchesRoutePattern(
          '/api/workspace/abc/upload?foo=bar&baz=qux',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
    });

    it('should handle query strings with trailing slashes', () => {
      expect(matchesRoutePattern('/api/upload/?test=1', '/api/upload')).toBe(
        true,
      );
      expect(matchesRoutePattern('/api/upload?test=1', '/api/upload/')).toBe(
        true,
      );
    });
  });

  describe('Combined normalization (real-world scenarios)', () => {
    it('should handle messy URLs with all normalization features', () => {
      // URL with trailing slash, query string, and extra slashes
      expect(
        matchesRoutePattern('/api//upload/?test=1&foo=bar', '/api/upload'),
      ).toBe(true);

      // Pattern with trailing slash, URL with query string
      expect(matchesRoutePattern('/api/upload?test=1', '/api/upload/')).toBe(
        true,
      );

      // Wildcard with multiple slashes and query strings
      expect(
        matchesRoutePattern(
          '/api//workspace//123//upload/?version=2',
          '/api/workspace/*/upload',
        ),
      ).toBe(true);
    });
  });
});

describe('registerFileUploadValidationHooks', () => {
  function createMockFastify(): FastifyInstance {
    const hooks: Array<{
      event: string;
      handler: (
        request: FastifyRequest,
        reply: FastifyReply,
      ) => Promise<void> | void;
    }> = [];

    return {
      addHook(event: string, handler: unknown) {
        hooks.push({
          event,
          handler: handler as (
            request: FastifyRequest,
            reply: FastifyReply,
          ) => Promise<void> | void,
        });
      },
      _getHooks() {
        return hooks;
      },
    } as unknown as FastifyInstance;
  }

  function createMockRequest(
    url: string,
    contentType?: string,
    customHelpers?: unknown,
  ): FastifyRequest {
    const request = {
      url,
      headers: contentType ? { 'content-type': contentType } : {},
      log: {
        error: mock(),
        warn: mock(),
        info: mock(),
      },
      id: 'test-request-id',
    } as unknown as FastifyRequest;

    if (customHelpers) {
      (
        request as FastifyRequest & { APIResponseHelpersClass?: unknown }
      ).APIResponseHelpersClass = customHelpers;
    }

    return request;
  }

  function createMockReply(): FastifyReply {
    const reply = {
      code: mock((_code: number) => reply),
      header: mock((_name: string, _value: string) => reply),
      send: mock((_data: unknown) => reply),
    } as unknown as FastifyReply;

    return reply;
  }

  describe('No validation config', () => {
    it('should not register hook when enabled but no validation rules configured', () => {
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{ event: string }>;
        }
      )._getHooks();
      expect(hooks.length).toBe(0);
    });

    it('should not register hook when allowedRoutes is empty array', () => {
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        allowedRoutes: [],
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{ event: string }>;
        }
      )._getHooks();
      expect(hooks.length).toBe(0);
    });
  });

  describe('Allowed routes validation', () => {
    it('should register hook when enabled and allowedRoutes configured', () => {
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        allowedRoutes: ['/api/upload'],
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{ event: string }>;
        }
      )._getHooks();
      expect(hooks.length).toBe(1);
      expect(hooks[0].event).toBe('preHandler');
    });

    it('should block multipart uploads on non-allowed routes', async () => {
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        allowedRoutes: ['/api/upload'],
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      const request = createMockRequest('/api/download', 'multipart/form-data');
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.code).toHaveBeenCalledWith(400);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).toHaveBeenCalled();
    });

    it('should allow multipart uploads on allowed routes', async () => {
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        allowedRoutes: ['/api/upload'],
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      const request = createMockRequest('/api/upload', 'multipart/form-data');
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      // Should not send error response (reply.send not called)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should skip validation for non-multipart requests', async () => {
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        allowedRoutes: ['/api/upload'],
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      const request = createMockRequest('/api/other', 'application/json');
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      // Should not send error response (non-multipart request)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should support wildcard patterns in allowed routes', async () => {
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        allowedRoutes: ['/api/workspace/*/upload'],
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      const request = createMockRequest(
        '/api/workspace/123/upload',
        'multipart/form-data',
      );
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      // Should not send error response (matches wildcard pattern)
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).not.toHaveBeenCalled();
    });
  });

  describe('Early validation', () => {
    it('should register hook when preValidation configured', () => {
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        // eslint-disable-next-line @typescript-eslint/require-await
        preValidation: async () => true as const,
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{ event: string }>;
        }
      )._getHooks();
      expect(hooks.length).toBe(1);
      expect(hooks[0].event).toBe('preHandler');
    });

    it('should run early validation for multipart requests', async () => {
      // eslint-disable-next-line @typescript-eslint/require-await
      const preValidationMock = mock(async () => true as const);
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        preValidation: preValidationMock,
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      const request = createMockRequest('/api/upload', 'multipart/form-data');
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      expect(preValidationMock).toHaveBeenCalledWith(request);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should block upload when early validation fails', async () => {
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        // eslint-disable-next-line @typescript-eslint/require-await
        preValidation: async () => ({
          statusCode: 401,
          error: 'unauthorized',
          message: 'Authentication required',
        }),
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      const request = createMockRequest('/api/upload', 'multipart/form-data');
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.code).toHaveBeenCalledWith(401);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).toHaveBeenCalled();
    });

    it('should not run early validation for non-multipart requests', async () => {
      // eslint-disable-next-line @typescript-eslint/require-await
      const preValidationMock = mock(async () => true as const);
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        preValidation: preValidationMock,
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      const request = createMockRequest('/api/upload', 'application/json');
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      // Should not call early validation for non-multipart

      expect(preValidationMock).not.toHaveBeenCalled();
    });

    it('should support synchronous early validation that returns true', async () => {
      const preValidationMock = mock(() => true as const);
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        preValidation: preValidationMock,
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      const request = createMockRequest('/api/upload', 'multipart/form-data');
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      expect(preValidationMock).toHaveBeenCalledWith(request);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).not.toHaveBeenCalled();
    });

    it('should support synchronous early validation that rejects', async () => {
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        preValidation: () => ({
          statusCode: 403,
          error: 'forbidden',
          message: 'Synchronous rejection',
        }),
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      const request = createMockRequest('/api/upload', 'multipart/form-data');
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.code).toHaveBeenCalledWith(403);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).toHaveBeenCalled();
    });
  });

  describe('Combined validation (routes + early)', () => {
    it('should check allowed routes before early validation', async () => {
      // eslint-disable-next-line @typescript-eslint/require-await
      const preValidationMock = mock(async () => true as const);
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        allowedRoutes: ['/api/upload'],
        preValidation: preValidationMock,
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      // Request to non-allowed route
      const request = createMockRequest('/api/download', 'multipart/form-data');
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      // Should block at route check, never reach early validation
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.code).toHaveBeenCalledWith(400);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).toHaveBeenCalled();

      expect(preValidationMock).not.toHaveBeenCalled();
    });

    it('should run early validation after route check passes', async () => {
      // eslint-disable-next-line @typescript-eslint/require-await
      const preValidationMock = mock(async () => true as const);
      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        allowedRoutes: ['/api/upload'],
        preValidation: preValidationMock,
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      // Request to allowed route
      const request = createMockRequest('/api/upload', 'multipart/form-data');
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      // Should pass route check and call early validation

      expect(preValidationMock).toHaveBeenCalledWith(request);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).not.toHaveBeenCalled();
    });
  });

  describe('Custom APIResponseHelpersClass', () => {
    it('should use custom helpers class when decorated on request', async () => {
      const customCreateError = mock(
        (params: { statusCode: number; errorCode: string }) => ({
          error: {
            code: params.errorCode,
            message: 'Custom error',
          },
          metadata: { request_id: 'custom' },
        }),
      );

      const customHelpers = {
        createAPIErrorResponse: customCreateError,
      };

      const fastify = createMockFastify();
      const config: FileUploadsConfig = {
        enabled: true,
        allowedRoutes: ['/api/upload'],
      };

      registerFileUploadValidationHooks(fastify, config);

      const hooks = (
        fastify as FastifyInstance & {
          _getHooks: () => Array<{
            event: string;
            handler: (
              request: FastifyRequest,
              reply: FastifyReply,
            ) => Promise<void> | void;
          }>;
        }
      )._getHooks();

      const request = createMockRequest(
        '/api/download',
        'multipart/form-data',
        customHelpers,
      );
      const reply = createMockReply();

      await hooks[0].handler(request, reply);

      expect(customCreateError).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(reply.send).toHaveBeenCalled();
    });
  });
});

describe('registerMultipartPlugin', () => {
  it('should register multipart plugin with default limits', async () => {
    const registerMock = mock(async () => {});
    const decorateMock = mock(() => {});

    const fastify = {
      register: registerMock,
      decorate: decorateMock,
    } as unknown as FastifyInstance;

    const config: FileUploadsConfig = {
      enabled: true,
    };

    await registerMultipartPlugin(fastify, config);

    expect(registerMock).toHaveBeenCalled();
    expect(decorateMock).toHaveBeenCalledWith('multipartEnabled', true);
  });

  it('should register multipart plugin with custom limits', async () => {
    let capturedOptions: {
      throwFileSizeLimit?: boolean;
      limits?: {
        fileSize?: number;
        files?: number;
        fields?: number;
        fieldSize?: number;
      };
    } = {};

    const registerMock = mock(
      // eslint-disable-next-line @typescript-eslint/require-await
      async (_plugin: unknown, options?: unknown) => {
        capturedOptions = options as typeof capturedOptions;
      },
    );
    const decorateMock = mock(() => {});

    const fastify = {
      register: registerMock,
      decorate: decorateMock,
    } as unknown as FastifyInstance;

    const config: FileUploadsConfig = {
      enabled: true,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 20,
        fields: 30,
        fieldSize: 2048,
      },
    };

    await registerMultipartPlugin(fastify, config);

    expect(registerMock).toHaveBeenCalled();
    expect(capturedOptions.throwFileSizeLimit).toBe(false);
    expect(capturedOptions.limits?.fileSize).toBe(5 * 1024 * 1024);
    expect(capturedOptions.limits?.files).toBe(20);
    expect(capturedOptions.limits?.fields).toBe(30);
    expect(capturedOptions.limits?.fieldSize).toBe(2048);
    expect(decorateMock).toHaveBeenCalledWith('multipartEnabled', true);
  });

  it('should use defaults when limits not provided', async () => {
    let capturedOptions: {
      throwFileSizeLimit?: boolean;
      limits?: {
        fileSize?: number;
        files?: number;
        fields?: number;
        fieldSize?: number;
      };
    } = {};

    const registerMock = mock(
      // eslint-disable-next-line @typescript-eslint/require-await
      async (_plugin: unknown, options?: unknown) => {
        capturedOptions = options as typeof capturedOptions;
      },
    );
    const decorateMock = mock(() => {});

    const fastify = {
      register: registerMock,
      decorate: decorateMock,
    } as unknown as FastifyInstance;

    const config: FileUploadsConfig = {
      enabled: true,
      limits: {},
    };

    await registerMultipartPlugin(fastify, config);

    expect(capturedOptions.limits?.fileSize).toBe(10 * 1024 * 1024); // 10MB default
    expect(capturedOptions.limits?.files).toBe(10); // default
    expect(capturedOptions.limits?.fields).toBe(10); // default
    expect(capturedOptions.limits?.fieldSize).toBe(1024); // 1KB default
  });
});

import type { FastifyRequest, FastifyReply } from 'fastify';
import type {
  ErrorDetailsValue,
  BaseMeta,
  APIErrorResponse,
  APISuccessResponse,
  PageErrorResponse,
  PageSuccessResponse,
  PageRedirectResponse,
  RedirectInfo,
  PageMetadata,
  APIResponseEnvelope,
  PageResponseEnvelope,
} from './api-envelope-types';
import type { ControlledReply } from '../types';

/**
 * Helper utilities for constructing API/Page response envelopes.
 *
 * These are static so the class can be easily subclassed or the methods can be
 * re-exported. Users may extend this class to inject their own default meta or
 * wrap additional logic (e.g., account metadata, logging, etc.).
 */
export class APIResponseHelpers {
  // API Response Helpers

  /**
   * Creates a standardized API success response envelope for API (AJAX/JSON) endpoints.
   *
   * @typeParam T - The type of the response data payload.
   * @typeParam M - Meta type that extends BaseMeta.
   *   Allows consumers to add application specific meta keys
   *   (e.g. `account`, `pagination`, etc.).
   * @param params - Object containing request, data, statusCode (default 200), and optional meta.
   * @returns An APISuccessResponse envelope with merged meta and a request_id.
   */

  public static createAPISuccessResponse<
    T,
    M extends BaseMeta = BaseMeta,
  >(params: {
    request: FastifyRequest;
    data: T;
    statusCode?: number;
    meta?: Partial<M>;
  }): APISuccessResponse<T, M> {
    const { request, data, statusCode = 200, meta } = params;

    // API responses should not include page metadata by default
    // Only include meta if explicitly provided
    const defaultMeta = {} as M;

    return {
      status: 'success',
      status_code: statusCode,
      request_id: (request as { requestID?: string }).requestID ?? 'unknown',
      type: 'api',
      data,
      meta: { ...defaultMeta, ...(meta as Partial<M>) } as M,
      error: null,
    };
  }

  /**
   * Creates a standardized API error response envelope for API (AJAX/JSON) endpoints.
   *
   * @typeParam M - Meta type that extends BaseMeta.
   *   Allows consumers to add application specific meta keys
   *   (e.g. `account`, `pagination`, etc.).
   * @param params - Object containing request, statusCode, errorCode, errorMessage, optional errorDetails, and optional meta.
   * @returns An APIErrorResponse envelope with merged meta and a request_id.
   */
  public static createAPIErrorResponse<M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    statusCode: number;
    errorCode: string;
    errorMessage: string;
    errorDetails?: ErrorDetailsValue;
    meta?: Partial<M>;
  }): APIErrorResponse<M> {
    const { request, statusCode, errorCode, errorMessage, errorDetails, meta } =
      params;

    // API responses should not include page metadata by default
    // Only include meta if explicitly provided
    const defaultMeta = {} as M;

    return {
      status: 'error',
      status_code: statusCode,
      request_id: (request as { requestID?: string }).requestID ?? 'unknown',
      type: 'api',
      data: null,
      meta: { ...defaultMeta, ...(meta as Partial<M>) } as M,
      error: {
        code: errorCode,
        message: errorMessage,
        ...(errorDetails && { details: errorDetails }),
      },
    };
  }

  // Page Response Helpers

  /**
   * Creates a standardized Page success response envelope for SSR/data loaders.
   *
   * @typeParam T - The type of the response data payload.
   * @typeParam M - Meta type that extends BaseMeta.
   *   Allows consumers to add application specific meta keys
   *   (e.g. `account`, `pagination`, etc.).
   * @param params - Object containing request, data, pageMetadata, statusCode (default 200), and optional meta.
   * @returns A PageSuccessResponse envelope with merged meta and a request_id.
   */
  public static createPageSuccessResponse<
    T,
    M extends BaseMeta = BaseMeta,
  >(params: {
    request: FastifyRequest;
    data: T;
    pageMetadata: PageMetadata;
    statusCode?: number;
    meta?: Partial<M>;
  }): PageSuccessResponse<T, M> {
    const { request, data, pageMetadata, statusCode = 200, meta } = params;

    const baseMeta: BaseMeta = {
      page: pageMetadata,
    };

    // Auto-populate ssr_request_context from request.requestContext if available and non-empty
    const requestContext = (
      request as { requestContext?: Record<string, unknown> }
    ).requestContext;

    return {
      status: 'success',
      status_code: statusCode,
      request_id: (request as { requestID?: string }).requestID ?? 'unknown',
      type: 'page',
      data,
      meta: { ...(baseMeta as M), ...(meta as Partial<M>) } as M,
      error: null,
      ...(requestContext &&
      typeof requestContext === 'object' &&
      !Array.isArray(requestContext) &&
      Object.keys(requestContext).length > 0
        ? { ssr_request_context: requestContext }
        : {}),
    };
  }

  /**
   * Creates a standardized Page redirect response envelope for SSR/data loaders.
   * Always uses status code 200 to avoid confusion with HTTP redirects.
   *
   * @typeParam M - Meta type that extends BaseMeta.
   *   Allows consumers to add application specific meta keys.
   * @param params - Object containing request, redirectInfo, pageMetadata, and optional meta.
   * @returns A PageRedirectResponse envelope with merged meta and a request_id.
   */
  public static createPageRedirectResponse<
    M extends BaseMeta = BaseMeta,
  >(params: {
    request: FastifyRequest;
    redirectInfo: RedirectInfo;
    pageMetadata: PageMetadata;
    meta?: Partial<M>;
  }): PageRedirectResponse<M> {
    const { request, redirectInfo, pageMetadata, meta } = params;

    const baseMeta: BaseMeta = {
      page: pageMetadata,
    };

    // Auto-populate ssr_request_context from request.requestContext if available and non-empty
    const requestContext = (
      request as { requestContext?: Record<string, unknown> }
    ).requestContext;

    return {
      status: 'redirect',
      status_code: 200,
      request_id: (request as { requestID?: string }).requestID ?? 'unknown',
      type: 'page',
      data: null,
      meta: { ...(baseMeta as M), ...(meta as Partial<M>) } as M,
      error: null,
      redirect: redirectInfo,
      ...(requestContext &&
      typeof requestContext === 'object' &&
      !Array.isArray(requestContext) &&
      Object.keys(requestContext).length > 0
        ? { ssr_request_context: requestContext }
        : {}),
    };
  }

  /**
   * Creates a standardized Page error response envelope for SSR/data loaders.
   *
   * @typeParam M - Meta type that extends BaseMeta.
   *   Allows consumers to add application specific meta keys
   *   (e.g. `account`, `pagination`, etc.).
   * @param params - Object containing request, statusCode, errorCode, errorMessage,
   *   pageMetadata, optional errorDetails, and optional meta.
   * @returns A PageErrorResponse envelope with merged meta and a request_id.
   */

  public static createPageErrorResponse<M extends BaseMeta = BaseMeta>(params: {
    request: FastifyRequest;
    statusCode: number;
    errorCode: string;
    errorMessage: string;
    pageMetadata: PageMetadata;
    errorDetails?: ErrorDetailsValue;
    meta?: Partial<M>;
  }): PageErrorResponse<M> {
    const {
      request,
      statusCode,
      errorCode,
      errorMessage,
      pageMetadata,
      errorDetails,
      meta,
    } = params;

    const baseMeta: BaseMeta = {
      page: pageMetadata,
    };

    // Auto-populate ssr_request_context from request.requestContext if available and non-empty
    const requestContext = (
      request as { requestContext?: Record<string, unknown> }
    ).requestContext;

    return {
      status: 'error',
      status_code: statusCode,
      request_id: (request as { requestID?: string }).requestID ?? 'unknown',
      type: 'page',
      data: null,
      meta: { ...(baseMeta as M), ...(meta as Partial<M>) } as M,
      error: {
        code: errorCode,
        message: errorMessage,
        ...(errorDetails && { details: errorDetails }),
      },
      ...(requestContext &&
      typeof requestContext === 'object' &&
      !Array.isArray(requestContext) &&
      Object.keys(requestContext).length > 0
        ? { ssr_request_context: requestContext }
        : {}),
    };
  }

  // Validation Helpers

  /**
   * Send an error envelope response with the appropriate method
   * Works with both FastifyReply and ControlledReply
   *
   * This is a public utility for sending error responses in a way that works
   * with both standard Fastify handlers and controlled reply handlers.
   *
   * @param reply - Fastify reply object or ControlledReply
   * @param statusCode - HTTP status code to send
   * @param errorResponse - Error envelope to send
   *
   * @example
   * ```typescript
   * const errorResponse = APIResponseHelpers.createAPIErrorResponse({
   *   request,
   *   statusCode: 400,
   *   errorCode: 'invalid_input',
   *   errorMessage: 'Invalid input provided',
   * });
   * APIResponseHelpers.sendErrorResponse(reply, 400, errorResponse);
   * ```
   */
  public static sendErrorResponse(
    reply: FastifyReply | ControlledReply,
    statusCode: number,
    errorResponse: APIErrorResponse<BaseMeta> | PageErrorResponse<BaseMeta>,
  ): void {
    // Check if this is a ControlledReply (has _sendErrorEnvelope) or FastifyReply
    if ('_sendErrorEnvelope' in reply) {
      reply._sendErrorEnvelope(statusCode, errorResponse);
    } else {
      // Using optional chaining in case reply is mocked in tests
      reply.code?.(statusCode)?.send(errorResponse);
    }
  }

  /**
   * Ensures an incoming Fastify request has a valid JSON body.
   * If invalid, sends a standardized error response and returns false.
   *
   * Use this helper for POST, PUT, PATCH, and DELETE endpoints that expect JSON payloads.
   * This is a pre-validation convenience before using schema validators like Zod.
   *
   * @param request - Fastify request object
   * @param reply - Fastify reply object or ControlledReply
   * @returns true if body is valid JSON, otherwise false (error already sent)
   *
   * @example
   * ```typescript
   * server.api.post('users', async (request, reply) => {
   *   if (!APIResponseHelpers.ensureJSONBody(request, reply)) {
   *     return; // Error response already sent
   *   }
   *
   *   // Now safe to validate using a schema validator (e.g. Zod) or process the body
   *   const validated = userSchema.parse(request.body);
   *   // ...
   * });
   * ```
   */
  public static ensureJSONBody(
    request: FastifyRequest,
    reply: FastifyReply | ControlledReply,
  ): boolean {
    // Check Content-Type header first
    const contentType = request.headers['content-type'];

    if (!contentType || !contentType.includes('application/json')) {
      const errorResponse = this.createAPIErrorResponse({
        request,
        statusCode: 415, // Unsupported Media Type
        errorCode: 'invalid_content_type',
        errorMessage: 'Content-Type must be application/json',
        errorDetails: {
          received_content_type: contentType || 'none',
          expected_content_type: 'application/json',
        },
      });

      // Send response and terminate early
      this.sendErrorResponse(reply, 415, errorResponse);
      return false;
    }

    // Then validate the parsed body exists and is an object
    if (!request.body || typeof request.body !== 'object') {
      const errorResponse = this.createAPIErrorResponse({
        request,
        statusCode: 400,
        errorCode: 'invalid_request_body_format',
        errorMessage:
          'Request body is required and must be a valid JSON object',
        errorDetails: {
          received_body_type: typeof request.body,
        },
      });

      // Send response and terminate early
      this.sendErrorResponse(reply, 400, errorResponse);
      return false;
    }

    return true;
  }

  /**
   * Ensures an incoming Fastify request has a valid URL-encoded form body.
   * If invalid, sends a standardized error response and returns false.
   *
   * Use this helper for POST, PUT, or PATCH endpoints that expect URL-encoded form data.
   * This is a pre-validation convenience before processing form fields.
   *
   * Note: For file uploads with multipart/form-data, use ensureMultipartBody instead.
   *
   * @param request - Fastify request object
   * @param reply - Fastify reply object or ControlledReply
   * @returns true if form body is valid, otherwise false (error already sent)
   *
   * @example
   * ```typescript
   * server.api.post('contact', async (request, reply) => {
   *   if (!APIResponseHelpers.ensureURLEncodedBody(request, reply)) {
   *     return; // Error response already sent
   *   }
   *
   *   // Now safe to process form fields
   *   const formData = request.body as Record<string, unknown>;
   *   // ...
   * });
   * ```
   */
  public static ensureURLEncodedBody(
    request: FastifyRequest,
    reply: FastifyReply | ControlledReply,
  ): boolean {
    // Check Content-Type header first
    const contentType = request.headers['content-type'];

    if (
      !contentType ||
      !contentType.includes('application/x-www-form-urlencoded')
    ) {
      const errorResponse = this.createAPIErrorResponse({
        request,
        statusCode: 415, // Unsupported Media Type
        errorCode: 'invalid_content_type',
        errorMessage: 'Content-Type must be application/x-www-form-urlencoded',
        errorDetails: {
          received_content_type: contentType || 'none',
          expected_content_type: 'application/x-www-form-urlencoded',
        },
      });

      // Send response and terminate early
      this.sendErrorResponse(reply, 415, errorResponse);
      return false;
    }

    // Validate the parsed body exists and is an object
    if (!request.body || typeof request.body !== 'object') {
      const errorResponse = this.createAPIErrorResponse({
        request,
        statusCode: 400,
        errorCode: 'invalid_request_body_format',
        errorMessage:
          'Request body is required and must be valid URL-encoded form data',
        errorDetails: {
          received_body_type: typeof request.body,
        },
      });

      this.sendErrorResponse(reply, 400, errorResponse);
      return false;
    }

    return true;
  }

  /**
   * Ensures an incoming Fastify request has multipart/form-data Content-Type.
   * If invalid, sends a standardized error response and returns false.
   *
   * **Note:** `processFileUpload()` automatically validates Content-Type,
   * so you typically don't need this helper when using `processFileUpload()`.
   *
   * **Advanced use case:** Use this for early validation in middleware (e.g., auth/rate-limiting)
   * before multipart parsing begins:
   *
   * ```typescript
   * // Block uploads for non-premium users before parsing
   * pluginHost.addHook('preHandler', async (request, reply) => {
   *   if (request.headers['content-type']?.includes('multipart/form-data')) {
   *     if (!user.isPremium) {
   *       return reply.code(403).send({ error: 'Premium feature' });
   *     }
   *   }
   * });
   * ```
   *
   * For standard file uploads, use `processFileUpload()` instead:
   * ```typescript
   * import { processFileUpload } from 'unirend/server';
   *
   * const results = await processFileUpload({
   *   request,
   *   reply,
   *   maxSizePerFile: 5 * 1024 * 1024,
   *   allowedMimeTypes: ['image/jpeg', 'image/png'],
   *   processor: async (stream, metadata, context) => {
   *     // ... handle upload
   *   },
   * });
   * ```
   *
   * @param request - Fastify request object
   * @param reply - Fastify reply object or ControlledReply
   * @returns true if Content-Type is multipart/form-data, otherwise false (error already sent)
   */
  public static ensureMultipartBody(
    request: FastifyRequest,
    reply: FastifyReply | ControlledReply,
  ): boolean {
    // Check Content-Type header
    const contentType = request.headers['content-type'];

    if (!contentType || !contentType.includes('multipart/form-data')) {
      const errorResponse = this.createAPIErrorResponse({
        request,
        statusCode: 415, // Unsupported Media Type
        errorCode: 'invalid_content_type',
        errorMessage: 'Content-Type must be multipart/form-data',
        errorDetails: {
          received_content_type: contentType || 'none',
          expected_content_type: 'multipart/form-data',
        },
      });

      // Send response and terminate early
      this.sendErrorResponse(reply, 415, errorResponse);
      return false;
    }

    // Note: We do NOT validate request.body here because multipart data
    // is accessed through request.file() or request.files(), not request.body
    return true;
  }

  // ---------------------------------------------------------------------------
  // Static Type-Guard Helpers
  // ---------------------------------------------------------------------------

  /** Determines if envelope is a success response */
  public static isSuccessResponse<T, M extends BaseMeta = BaseMeta>(
    response: APIResponseEnvelope<T, M> | PageResponseEnvelope<T, M>,
  ): response is APISuccessResponse<T, M> | PageSuccessResponse<T, M> {
    return response.status === 'success';
  }

  /** Determines if envelope is an error response */
  public static isErrorResponse<M extends BaseMeta = BaseMeta>(
    response:
      | APIResponseEnvelope<unknown, M>
      | PageResponseEnvelope<unknown, M>,
  ): response is APIErrorResponse<M> | PageErrorResponse<M> {
    return response.status === 'error';
  }

  /** Determines if envelope is a redirect response */
  public static isRedirectResponse<M extends BaseMeta = BaseMeta>(
    response:
      | APIResponseEnvelope<unknown, M>
      | PageResponseEnvelope<unknown, M>,
  ): response is PageRedirectResponse<M> {
    return response.status === 'redirect';
  }

  /** Determines if envelope is a page (SSR) response */
  public static isPageResponse<T, M extends BaseMeta = BaseMeta>(
    response: APIResponseEnvelope<T, M> | PageResponseEnvelope<T, M>,
  ): response is PageResponseEnvelope<T, M> {
    return response.type === 'page';
  }

  /**
   * Validates that an unknown value is a proper envelope object
   * This is a catch-all validation function that checks for proper envelope structure
   * without requiring specific typing - useful for runtime validation of handler responses
   */
  public static isValidEnvelope(
    result: unknown,
  ): result is PageResponseEnvelope | APIResponseEnvelope {
    if (!result || typeof result !== 'object') {
      return false;
    }

    const envelope = result as Record<string, unknown>;

    // Check required fields
    const hasStatus =
      typeof envelope.status === 'string' &&
      ['success', 'error', 'redirect'].includes(envelope.status);

    const hasStatusCode = typeof envelope.status_code === 'number';

    const hasType =
      typeof envelope.type === 'string' &&
      ['api', 'page'].includes(envelope.type);

    const hasRequestID = typeof envelope.request_id === 'string';
    const hasMeta = envelope.meta && typeof envelope.meta === 'object';

    // Basic structure validation
    if (!hasStatus || !hasStatusCode || !hasType || !hasRequestID || !hasMeta) {
      return false;
    }

    // Validate meta has required page field ONLY for page type envelopes
    // API type envelopes do not require page metadata
    if (envelope.type === 'page') {
      const meta = envelope.meta as Record<string, unknown>;

      if (!meta.page || typeof meta.page !== 'object') {
        return false;
      }

      const page = meta.page as Record<string, unknown>;

      if (
        typeof page.title !== 'string' ||
        typeof page.description !== 'string'
      ) {
        return false;
      }
    }

    // Status-specific validation
    if (envelope.status === 'success') {
      return envelope.data !== undefined && envelope.error === null;
    } else if (envelope.status === 'error') {
      return (
        envelope.data === null &&
        envelope.error !== null &&
        typeof envelope.error === 'object'
      );
    } else if (envelope.status === 'redirect') {
      return (
        envelope.data === null &&
        envelope.error === null &&
        envelope.redirect !== null &&
        typeof envelope.redirect === 'object'
      );
    }

    return false;
  }
}

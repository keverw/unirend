import type { FastifyRequest, FastifyReply } from 'fastify';
import type {
  ErrorDetails,
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
    errorDetails?: ErrorDetails;
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

    return {
      status: 'success',
      status_code: statusCode,
      request_id: (request as { requestID?: string }).requestID ?? 'unknown',
      type: 'page',
      data,
      meta: { ...(baseMeta as M), ...(meta as Partial<M>) } as M,
      error: null,
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

    return {
      status: 'redirect',
      status_code: 200,
      request_id: (request as { requestID?: string }).requestID ?? 'unknown',
      type: 'page',
      data: null,
      meta: { ...(baseMeta as M), ...(meta as Partial<M>) } as M,
      error: null,
      redirect: redirectInfo,
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
    errorDetails?: ErrorDetails;
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
    };
  }

  // Validation Helpers

  /**
   * Ensures an incoming Fastify request has a valid JSON body.
   * If invalid, sends a standardized 400 error response and returns false.
   *
   * @param request - Fastify request object
   * @param reply - Fastify reply object
   * @returns true if body is valid, otherwise false (error already sent)
   */
  public static ensureJsonBody(
    request: FastifyRequest,
    reply: FastifyReply,
  ): boolean {
    if (!request.body || typeof request.body !== 'object') {
      const errorResponse = this.createAPIErrorResponse({
        request,
        statusCode: 400,
        errorCode: 'invalid_request',
        errorMessage:
          'Request body is required and must be a valid JSON object',
      });

      // Send response and terminate early
      // Using optional chaining in case reply is mocked in tests
      reply.code?.(400).send(errorResponse);
      return false;
    }

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

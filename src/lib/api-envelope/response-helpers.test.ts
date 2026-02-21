import { describe, it, expect, mock } from 'bun:test';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { APIResponseHelpers } from './response-helpers';
import type { ControlledReply } from '../types';

// cspell:ignore userID requestid

// Helper to create a mock FastifyRequest
const createMockRequest = (
  overrides?: Partial<FastifyRequest>,
): FastifyRequest => {
  return {
    requestID: 'test-request-id-123',
    headers: {},
    body: {},
    ...overrides,
  } as unknown as FastifyRequest;
};

// Helper to create a mock FastifyReply
const createMockReply = () => {
  const reply = {
    code: mock((statusCode: number) => {
      (reply as any)._statusCode = statusCode;
      return reply;
    }),
    send: mock((data: unknown) => {
      (reply as any)._sent = data;
      return reply;
    }),
    _statusCode: 200,
    _sent: null,
  };
  return reply as unknown as FastifyReply;
};

// Helper to create a mock ControlledReply
const createMockControlledReply = () => {
  const reply = {
    _sendErrorEnvelope: mock((statusCode: number, errorEnvelope: unknown) => {
      (reply as any)._statusCode = statusCode;
      (reply as any)._sent = errorEnvelope;
    }),
    _statusCode: 200,
    _sent: null,
  };
  return reply as unknown as ControlledReply;
};

describe('APIResponseHelpers', () => {
  describe('createAPISuccessResponse', () => {
    it('creates a valid API success response with default status code 200', () => {
      const request = createMockRequest();
      const data = { userID: 123, name: 'John' };

      const response = APIResponseHelpers.createAPISuccessResponse({
        request,
        data,
      });

      expect(response.status).toBe('success');
      expect(response.status_code).toBe(200);
      expect(response.request_id).toBe('test-request-id-123');
      expect(response.type).toBe('api');
      expect(response.data).toEqual(data);
      expect(response.error).toBeNull();
      expect(response.meta).toEqual({});
    });

    it('creates a success response with custom status code', () => {
      const request = createMockRequest();
      const data = { created: true };

      const response = APIResponseHelpers.createAPISuccessResponse({
        request,
        data,
        statusCode: 201,
      });

      expect(response.status_code).toBe(201);
      expect(response.data).toEqual(data);
    });

    it('creates a success response with custom meta', () => {
      const request = createMockRequest();
      const data = { items: [] };
      const meta = { page: undefined, pagination: { page: 1, total: 100 } };

      const response = APIResponseHelpers.createAPISuccessResponse({
        request,
        data,
        meta,
      });

      expect(response.meta).toEqual(meta);
    });

    it('uses "unknown" as request_id when requestID is not available', () => {
      const request = createMockRequest({ requestID: undefined } as any);
      const data = { test: true };

      const response = APIResponseHelpers.createAPISuccessResponse({
        request,
        data,
      });

      expect(response.request_id).toBe('unknown');
    });
  });

  describe('createAPIErrorResponse', () => {
    it('creates a valid API error response', () => {
      const request = createMockRequest();

      const response = APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 400,
        errorCode: 'invalid_input',
        errorMessage: 'Invalid user input',
      });

      expect(response.status).toBe('error');
      expect(response.status_code).toBe(400);
      expect(response.request_id).toBe('test-request-id-123');
      expect(response.type).toBe('api');
      expect(response.data).toBeNull();
      expect(response.error).toEqual({
        code: 'invalid_input',
        message: 'Invalid user input',
      });
      expect(response.meta).toEqual({});
    });

    it('creates an error response with error details', () => {
      const request = createMockRequest();
      const errorDetails = { field: 'email', reason: 'invalid format' };

      const response = APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 422,
        errorCode: 'validation_error',
        errorMessage: 'Validation failed',
        errorDetails,
      });

      expect(response.error).toEqual({
        code: 'validation_error',
        message: 'Validation failed',
        details: errorDetails,
      });
    });

    it('creates an error response with custom meta', () => {
      const request = createMockRequest();
      const meta = { page: undefined, account: { id: 'acc_123' } };

      const response = APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 403,
        errorCode: 'forbidden',
        errorMessage: 'Access denied',
        meta,
      });

      expect(response.meta).toEqual(meta);
    });

    it('creates an error response with array-based error details (multiple validation errors)', () => {
      const request = createMockRequest();
      const errorDetails = [
        {
          field: 'email',
          type: 'invalid_email',
          message: 'Must be a valid email address',
        },
        {
          field: 'password',
          type: 'invalid_length',
          message: 'Must be at least 8 characters long',
        },
        {
          field: 'username',
          type: 'already_exists',
          message: 'Username is already taken',
        },
      ];

      const response = APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 422,
        errorCode: 'validation_errors',
        errorMessage: 'The request parameters did not pass validation',
        errorDetails,
      });

      expect(response.error).toEqual({
        code: 'validation_errors',
        message: 'The request parameters did not pass validation',
        details: errorDetails,
      });
      expect(Array.isArray(response.error.details)).toBe(true);
      expect(response.error.details).toHaveLength(3);
    });

    it('creates an error response with array-based error details (error trace)', () => {
      const request = createMockRequest();
      const errorDetails = [
        'Database connection failed',
        'Attempting retry (1/3)',
        'Retry failed',
        'Fallback to cache initiated',
      ];

      const response = APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 500,
        errorCode: 'database_error',
        errorMessage: 'Database operation failed',
        errorDetails,
      });

      expect(response.error.details).toEqual(errorDetails);
      expect(Array.isArray(response.error.details)).toBe(true);
    });
  });

  describe('createPageSuccessResponse', () => {
    it('creates a valid page success response', () => {
      const request = createMockRequest();
      const data = { user: { id: 1, name: 'Alice' } };
      const pageMetadata = {
        title: 'User Profile',
        description: 'View user profile',
      };

      const response = APIResponseHelpers.createPageSuccessResponse({
        request,
        data,
        pageMetadata,
      });

      expect(response.status).toBe('success');
      expect(response.status_code).toBe(200);
      expect(response.request_id).toBe('test-request-id-123');
      expect(response.type).toBe('page');
      expect(response.data).toEqual(data);
      expect(response.error).toBeNull();
      expect(response.meta.page).toEqual(pageMetadata);
    });

    it('creates a page success response with custom status code', () => {
      const request = createMockRequest();
      const data = { content: 'Page content' };
      const pageMetadata = { title: 'Test', description: 'Test page' };

      const response = APIResponseHelpers.createPageSuccessResponse({
        request,
        data,
        pageMetadata,
        statusCode: 201,
      });

      expect(response.status_code).toBe(201);
    });

    it('includes ssr_request_context when available', () => {
      const requestContext = { userID: '123', role: 'admin' };
      const request = createMockRequest({
        requestContext,
      } as any);
      const data = { page: 'home' };
      const pageMetadata = { title: 'Home', description: 'Home page' };

      const response = APIResponseHelpers.createPageSuccessResponse({
        request,
        data,
        pageMetadata,
      });

      expect(response.ssr_request_context).toEqual(requestContext);
    });

    it('excludes ssr_request_context when empty', () => {
      const request = createMockRequest({
        requestContext: {},
      } as any);
      const data = { page: 'home' };
      const pageMetadata = { title: 'Home', description: 'Home page' };

      const response = APIResponseHelpers.createPageSuccessResponse({
        request,
        data,
        pageMetadata,
      });

      expect(response.ssr_request_context).toBeUndefined();
    });

    it('excludes ssr_request_context when not an object', () => {
      const request = createMockRequest({
        requestContext: 'invalid',
      } as any);
      const data = { page: 'home' };
      const pageMetadata = { title: 'Home', description: 'Home page' };

      const response = APIResponseHelpers.createPageSuccessResponse({
        request,
        data,
        pageMetadata,
      });

      expect(response.ssr_request_context).toBeUndefined();
    });

    it('excludes ssr_request_context when it is an array', () => {
      const request = createMockRequest({
        requestContext: ['item1', 'item2'],
      } as any);
      const data = { page: 'home' };
      const pageMetadata = { title: 'Home', description: 'Home page' };

      const response = APIResponseHelpers.createPageSuccessResponse({
        request,
        data,
        pageMetadata,
      });

      expect(response.ssr_request_context).toBeUndefined();
    });
  });

  describe('createPageRedirectResponse', () => {
    it('creates a valid page redirect response', () => {
      const request = createMockRequest();
      const redirectInfo = { target: '/login', permanent: false };
      const pageMetadata = {
        title: 'Redirecting',
        description: 'Redirecting to login',
      };

      const response = APIResponseHelpers.createPageRedirectResponse({
        request,
        redirectInfo,
        pageMetadata,
      });

      expect(response.status).toBe('redirect');
      expect(response.status_code).toBe(200); // Always 200 for redirect responses
      expect(response.request_id).toBe('test-request-id-123');
      expect(response.type).toBe('page');
      expect(response.data).toBeNull();
      expect(response.error).toBeNull();
      expect(response.redirect).toEqual(redirectInfo);
      expect(response.meta.page).toEqual(pageMetadata);
    });

    it('includes ssr_request_context when available', () => {
      const requestContext = { userID: '456' };
      const request = createMockRequest({
        requestContext,
      } as any);
      const redirectInfo = { target: '/dashboard', permanent: false };
      const pageMetadata = { title: 'Redirect', description: 'Redirecting' };

      const response = APIResponseHelpers.createPageRedirectResponse({
        request,
        redirectInfo,
        pageMetadata,
      });

      expect(response.ssr_request_context).toEqual(requestContext);
    });
  });

  describe('createPageErrorResponse', () => {
    it('creates a valid page error response', () => {
      const request = createMockRequest();
      const pageMetadata = {
        title: 'Error',
        description: 'An error occurred',
      };

      const response = APIResponseHelpers.createPageErrorResponse({
        request,
        statusCode: 404,
        errorCode: 'not_found',
        errorMessage: 'Page not found',
        pageMetadata,
      });

      expect(response.status).toBe('error');
      expect(response.status_code).toBe(404);
      expect(response.request_id).toBe('test-request-id-123');
      expect(response.type).toBe('page');
      expect(response.data).toBeNull();
      expect(response.error).toEqual({
        code: 'not_found',
        message: 'Page not found',
      });
      expect(response.meta.page).toEqual(pageMetadata);
    });

    it('includes error details when provided', () => {
      const request = createMockRequest();
      const errorDetails = { path: '/missing', reason: 'does not exist' };
      const pageMetadata = { title: 'Error', description: 'Error page' };

      const response = APIResponseHelpers.createPageErrorResponse({
        request,
        statusCode: 404,
        errorCode: 'not_found',
        errorMessage: 'Resource not found',
        pageMetadata,
        errorDetails,
      });

      expect(response.error).toEqual({
        code: 'not_found',
        message: 'Resource not found',
        details: errorDetails,
      });
    });

    it('includes ssr_request_context when available', () => {
      const requestContext = { userID: '789' };
      const request = createMockRequest({
        requestContext,
      } as any);
      const pageMetadata = { title: 'Error', description: 'Error page' };

      const response = APIResponseHelpers.createPageErrorResponse({
        request,
        statusCode: 500,
        errorCode: 'server_error',
        errorMessage: 'Internal server error',
        pageMetadata,
      });

      expect(response.ssr_request_context).toEqual(requestContext);
    });

    it('creates a page error response with array-based error details', () => {
      const request = createMockRequest();
      const errorDetails = [
        { component: 'UserProfile', error: 'Failed to load user data' },
        { component: 'ActivityFeed', error: 'Failed to load activities' },
      ];
      const pageMetadata = { title: 'Error', description: 'Page load failed' };

      const response = APIResponseHelpers.createPageErrorResponse({
        request,
        statusCode: 500,
        errorCode: 'page_load_error',
        errorMessage: 'Multiple components failed to load',
        pageMetadata,
        errorDetails,
      });

      expect(response.error.details).toEqual(errorDetails);
      expect(Array.isArray(response.error.details)).toBe(true);
      expect(response.error.details).toHaveLength(2);
    });
  });

  describe('sendErrorResponse', () => {
    it('sends error response using ControlledReply._sendErrorEnvelope', () => {
      const request = createMockRequest();
      const controlledReply = createMockControlledReply();
      const errorResponse = APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 400,
        errorCode: 'bad_request',
        errorMessage: 'Bad request',
      });

      APIResponseHelpers.sendErrorResponse(controlledReply, 400, errorResponse);

      expect(controlledReply._sendErrorEnvelope).toHaveBeenCalledWith(
        400,
        errorResponse,
      );
    });

    it('sends error response using FastifyReply.code().send()', () => {
      const request = createMockRequest();
      const fastifyReply = createMockReply();
      const errorResponse = APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 404,
        errorCode: 'not_found',
        errorMessage: 'Not found',
      });

      APIResponseHelpers.sendErrorResponse(fastifyReply, 404, errorResponse);

      expect((fastifyReply as any).code).toHaveBeenCalledWith(404);
      expect((fastifyReply as any).send).toHaveBeenCalledWith(errorResponse);
    });
  });

  describe('ensureJSONBody', () => {
    it('returns true when Content-Type is application/json and body is valid', () => {
      const request = createMockRequest({
        headers: { 'content-type': 'application/json' },
        body: { test: 'data' },
      });
      const reply = createMockReply();

      const isValidJSONBody = APIResponseHelpers.ensureJSONBody(request, reply);

      expect(isValidJSONBody).toBe(true);
      expect((reply as any).code).not.toHaveBeenCalled();
    });

    it('returns false and sends 415 when Content-Type is missing', () => {
      const request = createMockRequest({
        headers: {},
        body: { test: 'data' },
      });
      const reply = createMockReply();

      const isValidJSONBody = APIResponseHelpers.ensureJSONBody(request, reply);

      expect(isValidJSONBody).toBe(false);
      expect((reply as any).code).toHaveBeenCalledWith(415);
    });

    it('returns false and sends 415 when Content-Type is not application/json', () => {
      const request = createMockRequest({
        headers: { 'content-type': 'text/plain' },
        body: { test: 'data' },
      });
      const reply = createMockReply();

      const isValidJSONBody = APIResponseHelpers.ensureJSONBody(request, reply);

      expect(isValidJSONBody).toBe(false);
      expect((reply as any).code).toHaveBeenCalledWith(415);
      expect((reply as any)._sent.error.code).toBe('invalid_content_type');
    });

    it('returns false and sends 400 when body is null', () => {
      const request = createMockRequest({
        headers: { 'content-type': 'application/json' },
        body: null,
      });
      const reply = createMockReply();

      const isValidJSONBody = APIResponseHelpers.ensureJSONBody(request, reply);

      expect(isValidJSONBody).toBe(false);
      expect((reply as any).code).toHaveBeenCalledWith(400);
      expect((reply as any)._sent.error.code).toBe(
        'invalid_request_body_format',
      );
    });

    it('returns false and sends 400 when body is not an object', () => {
      const request = createMockRequest({
        headers: { 'content-type': 'application/json' },
        body: 'string body',
      });
      const reply = createMockReply();

      const isValidJSONBody = APIResponseHelpers.ensureJSONBody(request, reply);

      expect(isValidJSONBody).toBe(false);
      expect((reply as any).code).toHaveBeenCalledWith(400);
    });

    it('accepts Content-Type with charset parameter', () => {
      const request = createMockRequest({
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: { test: 'data' },
      });
      const reply = createMockReply();

      const isValidJSONBody = APIResponseHelpers.ensureJSONBody(request, reply);

      expect(isValidJSONBody).toBe(true);
    });
  });

  describe('ensureURLEncodedBody', () => {
    it('returns true when Content-Type is application/x-www-form-urlencoded', () => {
      const request = createMockRequest({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: { field: 'value' },
      });
      const reply = createMockReply();

      const isValidURLEncodedBody = APIResponseHelpers.ensureURLEncodedBody(
        request,
        reply,
      );

      expect(isValidURLEncodedBody).toBe(true);
      expect((reply as any).code).not.toHaveBeenCalled();
    });

    it('returns false and sends 415 when Content-Type is missing', () => {
      const request = createMockRequest({
        headers: {},
        body: { field: 'value' },
      });
      const reply = createMockReply();

      const isValidURLEncodedBody = APIResponseHelpers.ensureURLEncodedBody(
        request,
        reply,
      );

      expect(isValidURLEncodedBody).toBe(false);
      expect((reply as any).code).toHaveBeenCalledWith(415);
    });

    it('returns false and sends 415 when Content-Type is not form-urlencoded', () => {
      const request = createMockRequest({
        headers: { 'content-type': 'application/json' },
        body: { field: 'value' },
      });
      const reply = createMockReply();

      const isValidURLEncodedBody = APIResponseHelpers.ensureURLEncodedBody(
        request,
        reply,
      );

      expect(isValidURLEncodedBody).toBe(false);
      expect((reply as any).code).toHaveBeenCalledWith(415);
    });

    it('returns false and sends 400 when body is not an object', () => {
      const request = createMockRequest({
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: null,
      });
      const reply = createMockReply();

      const isValidURLEncodedBody = APIResponseHelpers.ensureURLEncodedBody(
        request,
        reply,
      );

      expect(isValidURLEncodedBody).toBe(false);
      expect((reply as any).code).toHaveBeenCalledWith(400);
    });
  });

  describe('ensureMultipartBody', () => {
    it('returns true when Content-Type is multipart/form-data', () => {
      const request = createMockRequest({
        headers: { 'content-type': 'multipart/form-data; boundary=----123' },
      });
      const reply = createMockReply();

      const isValidMultipartBody = APIResponseHelpers.ensureMultipartBody(
        request,
        reply,
      );

      expect(isValidMultipartBody).toBe(true);
      expect((reply as any).code).not.toHaveBeenCalled();
    });

    it('returns false and sends 415 when Content-Type is missing', () => {
      const request = createMockRequest({
        headers: {},
      });
      const reply = createMockReply();

      const isValidMultipartBody = APIResponseHelpers.ensureMultipartBody(
        request,
        reply,
      );

      expect(isValidMultipartBody).toBe(false);
      expect((reply as any).code).toHaveBeenCalledWith(415);
    });

    it('returns false and sends 415 when Content-Type is not multipart', () => {
      const request = createMockRequest({
        headers: { 'content-type': 'application/json' },
      });
      const reply = createMockReply();

      const isValidMultipartBody = APIResponseHelpers.ensureMultipartBody(
        request,
        reply,
      );

      expect(isValidMultipartBody).toBe(false);
      expect((reply as any).code).toHaveBeenCalledWith(415);
    });
  });

  describe('Type Guard Helpers', () => {
    describe('isSuccessResponse', () => {
      it('returns true for API success response', () => {
        const request = createMockRequest();
        const response = APIResponseHelpers.createAPISuccessResponse({
          request,
          data: { test: true },
        });

        expect(APIResponseHelpers.isSuccessResponse(response)).toBe(true);
      });

      it('returns true for page success response', () => {
        const request = createMockRequest();
        const response = APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { test: true },
          pageMetadata: { title: 'Test', description: 'Test page' },
        });

        expect(APIResponseHelpers.isSuccessResponse(response)).toBe(true);
      });

      it('returns false for error response', () => {
        const request = createMockRequest();
        const response = APIResponseHelpers.createAPIErrorResponse({
          request,
          statusCode: 400,
          errorCode: 'error',
          errorMessage: 'Error',
        });

        expect(APIResponseHelpers.isSuccessResponse(response)).toBe(false);
      });
    });

    describe('isErrorResponse', () => {
      it('returns true for API error response', () => {
        const request = createMockRequest();
        const response = APIResponseHelpers.createAPIErrorResponse({
          request,
          statusCode: 400,
          errorCode: 'error',
          errorMessage: 'Error',
        });

        expect(APIResponseHelpers.isErrorResponse(response)).toBe(true);
      });

      it('returns false for success response', () => {
        const request = createMockRequest();
        const response = APIResponseHelpers.createAPISuccessResponse({
          request,
          data: { test: true },
        });

        expect(APIResponseHelpers.isErrorResponse(response)).toBe(false);
      });
    });

    describe('isRedirectResponse', () => {
      it('returns true for redirect response', () => {
        const request = createMockRequest();
        const response = APIResponseHelpers.createPageRedirectResponse({
          request,
          redirectInfo: { target: '/login', permanent: false },
          pageMetadata: { title: 'Redirect', description: 'Redirecting' },
        });

        expect(APIResponseHelpers.isRedirectResponse(response)).toBe(true);
      });

      it('returns false for success response', () => {
        const request = createMockRequest();
        const response = APIResponseHelpers.createAPISuccessResponse({
          request,
          data: { test: true },
        });

        expect(APIResponseHelpers.isRedirectResponse(response)).toBe(false);
      });
    });

    describe('isPageResponse', () => {
      it('returns true for page success response', () => {
        const request = createMockRequest();
        const response = APIResponseHelpers.createPageSuccessResponse({
          request,
          data: { test: true },
          pageMetadata: { title: 'Test', description: 'Test page' },
        });

        expect(APIResponseHelpers.isPageResponse(response)).toBe(true);
      });

      it('returns false for API response', () => {
        const request = createMockRequest();
        const response = APIResponseHelpers.createAPISuccessResponse({
          request,
          data: { test: true },
        });

        expect(APIResponseHelpers.isPageResponse(response)).toBe(false);
      });
    });
  });

  describe('isValidEnvelope', () => {
    it('returns true for valid API success envelope', () => {
      const request = createMockRequest();
      const response = APIResponseHelpers.createAPISuccessResponse({
        request,
        data: { test: true },
      });

      expect(APIResponseHelpers.isValidEnvelope(response)).toBe(true);
    });

    it('returns true for valid page success envelope', () => {
      const request = createMockRequest();
      const response = APIResponseHelpers.createPageSuccessResponse({
        request,
        data: { test: true },
        pageMetadata: { title: 'Test', description: 'Test page' },
      });

      expect(APIResponseHelpers.isValidEnvelope(response)).toBe(true);
    });

    it('returns true for valid error envelope', () => {
      const request = createMockRequest();
      const response = APIResponseHelpers.createAPIErrorResponse({
        request,
        statusCode: 400,
        errorCode: 'error',
        errorMessage: 'Error',
      });

      expect(APIResponseHelpers.isValidEnvelope(response)).toBe(true);
    });

    it('returns true for valid redirect envelope', () => {
      const request = createMockRequest();
      const response = APIResponseHelpers.createPageRedirectResponse({
        request,
        redirectInfo: { target: '/login', permanent: false },
        pageMetadata: { title: 'Redirect', description: 'Redirecting' },
      });

      expect(APIResponseHelpers.isValidEnvelope(response)).toBe(true);
    });

    it('returns false for non-object values', () => {
      expect(APIResponseHelpers.isValidEnvelope(null)).toBe(false);
      expect(APIResponseHelpers.isValidEnvelope(undefined)).toBe(false);
      expect(APIResponseHelpers.isValidEnvelope('string')).toBe(false);
      expect(APIResponseHelpers.isValidEnvelope(123)).toBe(false);
    });

    it('returns false when missing required fields', () => {
      expect(APIResponseHelpers.isValidEnvelope({ status: 'success' })).toBe(
        false,
      );
      expect(
        APIResponseHelpers.isValidEnvelope({
          status: 'success',
          status_code: 200,
        }),
      ).toBe(false);
      expect(
        APIResponseHelpers.isValidEnvelope({
          status: 'success',
          status_code: 200,
          type: 'api',
        }),
      ).toBe(false);
    });

    it('returns false when status is invalid', () => {
      expect(
        APIResponseHelpers.isValidEnvelope({
          status: 'invalid',
          status_code: 200,
          type: 'api',
          request_id: 'test',
          meta: {},
        }),
      ).toBe(false);
    });

    it('returns false when type is invalid', () => {
      expect(
        APIResponseHelpers.isValidEnvelope({
          status: 'success',
          status_code: 200,
          type: 'invalid',
          request_id: 'test',
          meta: {},
        }),
      ).toBe(false);
    });

    it('returns false for page type without page metadata', () => {
      expect(
        APIResponseHelpers.isValidEnvelope({
          status: 'success',
          status_code: 200,
          type: 'page',
          request_id: 'test',
          meta: {},
          data: { test: true },
          error: null,
        }),
      ).toBe(false);
    });

    it('returns false for page type with invalid page metadata', () => {
      expect(
        APIResponseHelpers.isValidEnvelope({
          status: 'success',
          status_code: 200,
          type: 'page',
          request_id: 'test',
          meta: { page: { title: 123 } }, // title should be string
          data: { test: true },
          error: null,
        }),
      ).toBe(false);
    });

    it('returns false for success envelope with undefined data', () => {
      expect(
        APIResponseHelpers.isValidEnvelope({
          status: 'success',
          status_code: 200,
          type: 'api',
          request_id: 'test',
          meta: {},
          error: null,
          // data is missing
        }),
      ).toBe(false);
    });

    it('returns false for error envelope without error object', () => {
      expect(
        APIResponseHelpers.isValidEnvelope({
          status: 'error',
          status_code: 400,
          type: 'api',
          request_id: 'test',
          meta: {},
          data: null,
          error: null, // should not be null for error status
        }),
      ).toBe(false);
    });

    it('returns false for redirect envelope without redirect object', () => {
      expect(
        APIResponseHelpers.isValidEnvelope({
          status: 'redirect',
          status_code: 200,
          type: 'page',
          request_id: 'test',
          meta: { page: { title: 'Test', description: 'Test' } },
          data: null,
          error: null,
          // redirect is missing
        }),
      ).toBe(false);
    });
  });
});

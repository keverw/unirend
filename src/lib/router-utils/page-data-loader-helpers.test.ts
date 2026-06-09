import { describe, expect, it } from 'bun:test';
import type { PageResponseEnvelope } from '../api-envelope/api-envelope-types';
import {
  processAPIResponse,
  processRedirectResponse,
} from './page-data-loader-helpers';
import type { PageDataLoaderConfig } from './page-data-loader-types';

const baseConfig: PageDataLoaderConfig = {
  APIBaseURL: 'https://api.example.com',
  loginURL: '/login',
  returnToParam: 'return_to',
  generateFallbackRequestID: (context) => `fallback_${context}`,
  errorDefaults: {
    notFound: {
      title: 'Page Not Found',
      description: 'The page you are looking for could not be found.',
      code: 'not_found',
      message: 'The requested resource was not found.',
    },
    internalError: {
      title: 'Server Error',
      description: 'An internal server error occurred.',
      code: 'internal_server_error',
      message: 'An internal server error occurred.',
    },
    authRequired: {
      title: 'Authentication Required',
      description: 'You must be logged in to access this page.',
    },
    accessDenied: {
      title: 'Access Denied',
      description: 'You do not have permission to access this page.',
      code: 'access_denied',
      message: 'You do not have permission to access this resource.',
    },
    genericError: {
      title: 'Error',
      description: 'An unexpected error occurred.',
      code: 'unknown_error',
      message: 'An unexpected error occurred.',
    },
    invalidResponse: {
      title: 'Invalid Response',
      description: 'The server returned an unexpected response format.',
      code: 'invalid_response',
      message: 'The server returned an unexpected response format.',
    },
    invalidRedirect: {
      title: 'Invalid Redirect',
      description: 'The server attempted an invalid redirect.',
      code: 'invalid_redirect',
      message: 'Redirect target not specified in response',
    },
    redirectNotFollowed: {
      title: 'Redirect Not Followed',
      description: 'HTTP redirects from the API are not supported.',
      code: 'api_redirect_not_followed',
      message:
        'The API attempted to redirect the request, which is not supported.',
    },
    unsafeRedirect: {
      title: 'Unsafe Redirect Blocked',
      description: 'The redirect target is not allowed for security reasons.',
      code: 'unsafe_redirect',
      message: 'Unsafe redirect blocked',
    },
  },
};

function withWindow<T>(href: string, run: () => T): T {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    value: { location: { href } },
    configurable: true,
  });

  try {
    return run();
  } finally {
    if (originalWindow === undefined) {
      delete (globalThis as { window?: unknown }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        value: originalWindow,
        configurable: true,
      });
    }
  }
}

describe('processRedirectResponse', () => {
  it('returns invalid redirect error when target is missing', () => {
    const result = processRedirectResponse(
      baseConfig,
      {
        request_id: 'req_invalid_redirect',
        meta: { site_info: { current_year: 2026 } },
        redirect: {},
      },
      {},
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('invalid_redirect');
  });

  it('blocks unsafe redirect targets', () => {
    const result = processRedirectResponse(
      {
        ...baseConfig,
        allowedRedirectOrigins: ['https://app.example.com'],
      },
      {
        request_id: 'req_unsafe_redirect',
        redirect: {
          target: 'https://evil.example/path',
          permanent: false,
        },
      },
      {},
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('unsafe_redirect');
  });

  it('preserves query parameters when requested in the browser', () => {
    const result = withWindow(
      'https://app.example.com/current?page=2',
      () =>
        processRedirectResponse(
          baseConfig,
          {
            redirect: {
              target: '/next',
              permanent: false,
              preserve_query: true,
            },
          },
          {},
        ) as unknown as Response,
    );

    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe('/next?page=2');
  });

  it('returns permanent redirects when requested', () => {
    const result = processRedirectResponse(
      baseConfig,
      {
        redirect: {
          target: '/moved',
          permanent: true,
        },
      },
      {},
    ) as unknown as Response;

    expect(result.status).toBe(301);
    expect(result.headers.get('Location')).toBe('/moved');
  });
});

describe('processAPIResponse', () => {
  it('converts HTTP redirects into page errors', async () => {
    const response = new Response(null, {
      status: 302,
      headers: {
        Location: '/login',
      },
    });

    const result = await processAPIResponse(response, baseConfig, false);
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('api_redirect_not_followed');
    expect(result.error?.details).toEqual({
      originalStatus: 302,
      location: '/login',
    });
  });

  it('returns page responses as-is for successful page envelopes', async () => {
    const response = new Response(
      JSON.stringify({
        status: 'success',
        status_code: 200,
        request_id: 'req_page',
        type: 'page',
        data: { hello: 'world' },
        meta: {
          page: {
            title: 'Home',
            description: 'Welcome',
          },
        },
        error: null,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const result = await processAPIResponse(response, baseConfig, false);
    expect(result.status).toBe('success');
    expect(result.type).toBe('page');
    expect(result.data).toEqual({ hello: 'world' });
  });

  it('processes custom status handler redirects', async () => {
    const response = new Response('null', {
      status: 402,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = (await processAPIResponse(
      response,
      {
        ...baseConfig,
        statusCodeHandlers: {
          ['402']: () => ({
            status: 'redirect',
            status_code: 200,
            request_id: 'req_payment_redirect',
            type: 'page',
            data: null,
            meta: {
              page: {
                title: 'Payment',
                description: 'Redirecting',
              },
            },
            error: null,
            redirect: {
              target: '/billing',
              permanent: false,
            },
          }),
        },
      },
      false,
    )) as unknown as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe('/billing');
  });

  it('redirects to login for authentication_required responses', async () => {
    const response = new Response(
      JSON.stringify({
        status: 'error',
        status_code: 401,
        request_id: 'req_auth_redirect',
        type: 'api',
        data: null,
        meta: {},
        error: {
          code: 'authentication_required',
          message: 'Login required',
          details: {
            return_to: '/projects/123',
          },
        },
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const result = (await processAPIResponse(
      response,
      baseConfig,
      false,
    )) as unknown as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe(
      '/login?return_to=%2Fprojects%2F123',
    );
  });

  it('blocks unsafe loginURL values using allowedRedirectOrigins', async () => {
    const response = new Response(
      JSON.stringify({
        status: 'error',
        status_code: 401,
        request_id: 'req_auth_redirect_unsafe',
        type: 'api',
        data: null,
        meta: {
          site_info: {
            current_year: 2026,
          },
        },
        error: {
          code: 'authentication_required',
          message: 'Login required',
        },
      }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const result = await processAPIResponse(
      response,
      {
        ...baseConfig,
        loginURL: 'https://evil.example/login',
        allowedRedirectOrigins: ['https://app.example.com'],
      },
      false,
    );

    expect(result.status).toBe('error');
    expect(result.status_code).toBe(400);
    expect(result.error?.code).toBe('unsafe_redirect');
    expect(result.error?.details).toEqual({
      loginURL: 'https://evil.example/login',
    });
  });

  it('converts API 403 errors into page errors', async () => {
    const response = new Response(
      JSON.stringify({
        status: 'error',
        status_code: 403,
        request_id: 'req_403',
        type: 'api',
        data: null,
        meta: {
          site_info: { current_year: 2026 },
        },
        error: {
          code: 'permission_denied',
          message: 'Forbidden',
          details: {
            required_role: 'admin',
          },
        },
      }),
      {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const result = await processAPIResponse(response, baseConfig, false);
    expect(result.status).toBe('error');
    expect(result.type).toBe('page');
    expect(result.error?.code).toBe('access_denied');
    expect(result.error?.message).toBe('Forbidden');
  });

  it('includes 500 API error details only in development mode', async () => {
    const response = new Response(
      JSON.stringify({
        status: 'error',
        status_code: 500,
        request_id: 'req_500',
        type: 'api',
        data: null,
        meta: {},
        error: {
          code: 'internal_error',
          message: 'Server blew up',
          details: {
            stack: 'trace',
          },
        },
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const devResult = await processAPIResponse(
      response.clone(),
      baseConfig,
      true,
    );

    const prodResult = await processAPIResponse(response, baseConfig, false);

    expect(devResult.error?.details).toEqual({ stack: 'trace' });
    expect(prodResult.error?.details).toBeUndefined();
  });

  it('converts successful API envelopes into invalid response errors', async () => {
    const response = new Response(
      JSON.stringify({
        status: 'success',
        status_code: 200,
        request_id: 'req_api_success',
        type: 'api',
        data: { value: 1 },
        meta: {},
        error: null,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );

    const result = await processAPIResponse(response, baseConfig, false);
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('invalid_response');
  });

  it('returns invalid response for non-json responses without handlers', async () => {
    const response = new Response('<html>bad gateway</html>', {
      status: 502,
      headers: {
        'Content-Type': 'text/html',
      },
    });

    const result = await processAPIResponse(response, baseConfig, false);
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('invalid_response');
  });

  it('lets non-json responses be handled by custom handlers', async () => {
    const response = new Response('<html>payment</html>', {
      status: 402,
      headers: {
        'Content-Type': 'text/html',
      },
    });

    const result = await processAPIResponse(
      response,
      {
        ...baseConfig,
        statusCodeHandlers: {
          ['402']: () =>
            ({
              status: 'error',
              status_code: 402,
              request_id: 'req_custom_non_json',
              type: 'page',
              data: null,
              meta: {
                page: {
                  title: 'Payment Required',
                  description: 'Need payment',
                },
              },
              error: {
                code: 'payment_required',
                message: 'Payment required',
              },
            }) as PageResponseEnvelope,
        },
      },
      false,
    );

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('payment_required');
  });

  it('creates generic http errors for non-envelope JSON payloads', async () => {
    const response = new Response(JSON.stringify({ message: 'teapot' }), {
      status: 418,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const result = await processAPIResponse(response, baseConfig, false);
    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('http_error');
    expect(result.error?.message).toBe('HTTP Error: 418');
  });

  it('returns a custom handler result directly when it is not a redirect', async () => {
    // Covers the JSON-path branch where customHandlerResult is not a redirect
    // (line 185: return customHandlerResult after the redirect-guard block).
    const response = new Response(JSON.stringify({ x: 1 }), {
      status: 402,
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await processAPIResponse(
      response,
      {
        ...baseConfig,
        statusCodeHandlers: {
          ['402']: () =>
            ({
              status: 'error',
              status_code: 402,
              request_id: 'req_custom_json_error',
              type: 'page',
              data: null,
              meta: {
                page: {
                  title: 'Payment Required',
                  description: 'Need payment',
                },
              },
              error: {
                code: 'payment_required',
                message: 'Payment required',
              },
            }) as PageResponseEnvelope,
        },
      },
      false,
    );

    expect(result.status).toBe('error');
    expect(result.type).toBe('page');
    expect(result.error?.code).toBe('payment_required');
  });

  it('passes through a non-200 page envelope unchanged', async () => {
    // A 400 response whose body already has type:'page' — returned as-is
    // (lines 227-231 in the else-branch after the status-200 page check).
    const response = new Response(
      JSON.stringify({
        status: 'error',
        status_code: 400,
        request_id: 'req_page_400',
        type: 'page',
        data: null,
        meta: { page: { title: 'Bad Request', description: 'Oops' } },
        error: { code: 'bad_request', message: 'Bad request' },
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const result = await processAPIResponse(response, baseConfig, false);
    expect(result.status).toBe('error');
    expect(result.type).toBe('page');
    expect(result.error?.code).toBe('bad_request');
  });

  it('uses fallback request_id when auth_required response omits one', async () => {
    // Covers the ternary at lines 256-257: authResponse.request_id is absent
    // so config.generateFallbackRequestID is called instead.
    const response = new Response(
      JSON.stringify({
        status: 'error',
        status_code: 401,
        type: 'api',
        data: null,
        meta: {},
        error: {
          code: 'authentication_required',
          message: 'Login required',
          details: { return_to: '/dashboard' },
        },
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const result = (await processAPIResponse(
      response,
      baseConfig,
      false,
    )) as unknown as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe(
      `/login?return_to=${encodeURIComponent('/dashboard')}`,
    );
  });

  it('redirects to loginURL without return_to when error details are absent', async () => {
    // Covers line 300: redirect(config.loginURL) when returnTo is undefined.
    const response = new Response(
      JSON.stringify({
        status: 'error',
        status_code: 401,
        request_id: 'req_no_return_to',
        type: 'api',
        data: null,
        meta: {},
        error: {
          code: 'authentication_required',
          message: 'Login required',
        },
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const result = (await processAPIResponse(
      response,
      baseConfig,
      false,
    )) as unknown as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe('/login');
  });

  it('uses fallback request_id for API errors that omit one', async () => {
    // Covers lines 321-322: apiResponse.request_id is absent, so the ternary
    // falls through to config.generateFallbackRequestID('error').
    const response = new Response(
      JSON.stringify({
        status: 'error',
        status_code: 404,
        // NO request_id field
        type: 'api',
        data: null,
        meta: {},
        error: { code: 'not_found', message: 'Resource not found' },
      }),
      {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const result = await processAPIResponse(response, baseConfig, false);
    expect(result.status).toBe('error');
    expect(result.type).toBe('page');
    expect(result.error?.code).toBe('not_found');
    // Fallback request_id starts with 'fallback_' (from baseConfig.generateFallbackRequestID)
    expect(result.request_id).toMatch(/^fallback_/);
  });

  it('converts a 422 API error into a generic page error', async () => {
    // Covers lines 368-384: the generic-error branch for API errors that are
    // not 404, 500, or 403.
    const response = new Response(
      JSON.stringify({
        status: 'error',
        status_code: 422,
        request_id: 'req_422',
        type: 'api',
        data: null,
        meta: {},
        error: {
          code: 'unprocessable_entity',
          message: 'Validation failed',
          details: { field: 'email' },
        },
      }),
      {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const result = await processAPIResponse(response, baseConfig, true);
    expect(result.status).toBe('error');
    expect(result.status_code).toBe(422);
    expect(result.type).toBe('page');
    expect(result.error?.code).toBe('unprocessable_entity');
    expect(result.error?.message).toBe('Validation failed');
    expect(result.error?.details).toEqual({ field: 'email' });
  });

  it('converts a non-api 404 JSON response into a not_found page error', async () => {
    // Covers lines 408-416: status 404, valid JSON, but not type:'api'.
    const response = new Response(JSON.stringify({ message: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await processAPIResponse(response, baseConfig, false);
    expect(result.status).toBe('error');
    expect(result.type).toBe('page');
    expect(result.error?.code).toBe('not_found');
  });

  it('converts a non-api 500 JSON response into an internal error page error', async () => {
    // Covers lines 418-426: status 500, valid JSON, but not type:'api'.
    const response = new Response(
      // Valid JSON but not following our API envelope format (no type/status fields).
      JSON.stringify({ message: 'server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );

    const result = await processAPIResponse(response, baseConfig, false);
    expect(result.status).toBe('error');
    expect(result.type).toBe('page');
    expect(result.error?.code).toBe('internal_server_error');
    // The original body message is discarded — the default message is used instead.
    expect(result.error?.message).toBe(
      baseConfig.errorDefaults.internalError.message,
    );
  });

  it('follows a redirect returned by a non-json custom handler', async () => {
    // Covers lines 458-463: non-JSON response, custom handler returns a redirect
    // response, which processRedirectResponse processes into a real HTTP redirect.
    const response = new Response('<html>payment</html>', {
      status: 402,
      headers: { 'Content-Type': 'text/html' },
    });

    const result = (await processAPIResponse(
      response,
      {
        ...baseConfig,
        statusCodeHandlers: {
          ['402']: () =>
            ({
              status: 'redirect',
              status_code: 200,
              request_id: 'req_non_json_redirect',
              type: 'page',
              data: null,
              meta: { page: { title: 'Billing', description: 'Redirecting' } },
              error: null,
              redirect: { target: '/billing', permanent: false },
            }) as unknown as PageResponseEnvelope,
        },
      },
      false,
    )) as unknown as Response;

    expect(result.status).toBe(302);
    expect(result.headers.get('Location')).toBe('/billing');
  });
});

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { PageResponseEnvelope } from '../api-envelope/api-envelope-types';
import {
  applyCustomHTTPStatusHandler,
  createBaseHeaders,
  createErrorResponse,
  decorateWithSsrOnlyData,
  fetchWithTimeout,
  isSafeRedirect,
} from './page-data-loader-utils';
import type { PageDataLoaderConfig } from './page-data-loader-types';

const baseConfig: PageDataLoaderConfig = {
  APIBaseURL: 'https://api.example.com',
  loginURL: '/login',
  returnToParam: 'return_to',
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

const sampleEnvelope: PageResponseEnvelope = {
  status: 'success',
  status_code: 200,
  request_id: 'req_1',
  type: 'page',
  data: { ok: true },
  meta: {
    page: {
      title: 'Title',
      description: 'Description',
    },
  },
  error: null,
};

describe('createBaseHeaders', () => {
  it('sets application/json content type', () => {
    const headers = createBaseHeaders();
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});

describe('decorateWithSsrOnlyData', () => {
  it('adds __ssOnly on the server', () => {
    const result = decorateWithSsrOnlyData(sampleEnvelope, {
      cookies: ['a=1'],
    });

    expect(Reflect.get(result as object, '__ssOnly')).toEqual({
      cookies: ['a=1'],
    });
  });

  it('returns the response unchanged in the browser', () => {
    const originalWindow = globalThis.window;
    Object.defineProperty(globalThis, 'window', {
      value: { location: { href: 'https://app.example.com' } },
      configurable: true,
    });

    try {
      const result = decorateWithSsrOnlyData(sampleEnvelope, {
        cookies: ['a=1'],
      });

      expect(result).toBe(sampleEnvelope);
      expect('__ssOnly' in result).toBe(false);
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
  });
});

describe('isSafeRedirect', () => {
  it('allows any target when validation is disabled', () => {
    expect(isSafeRedirect('https://evil.example/path')).toBe(true);
  });

  it('allows root-relative paths but blocks protocol-relative URLs', () => {
    expect(isSafeRedirect('/dashboard', [])).toBe(true);
    expect(isSafeRedirect('//evil.example/login', [])).toBe(false);
  });

  it('blocks external URLs when only relative paths are allowed', () => {
    expect(isSafeRedirect('https://app.example.com/login', [])).toBe(false);
  });

  it('allows exact origin matches for http and https', () => {
    expect(
      isSafeRedirect('https://app.example.com/login', [
        'https://app.example.com',
      ]),
    ).toBe(true);
    expect(
      isSafeRedirect('http://localhost:3000/login', ['http://localhost:3000']),
    ).toBe(true);
  });

  it('allows wildcard and bare-domain allowlist entries through domain-utils', () => {
    expect(
      isSafeRedirect('https://tenant.example.com/dashboard', [
        'https://*.example.com',
      ]),
    ).toBe(true);
    expect(
      isSafeRedirect('https://deep.tenant.example.com/dashboard', [
        'https://**.example.com',
      ]),
    ).toBe(true);
    expect(
      isSafeRedirect('https://tenant.example.com/dashboard', ['*.example.com']),
    ).toBe(true);
  });

  it('blocks prefix and userinfo origin bypasses', () => {
    expect(
      isSafeRedirect('https://app.example.com.evil.com/login', [
        'https://app.example.com',
      ]),
    ).toBe(false);
    expect(
      isSafeRedirect('https://app.example.com@evil.com/login', [
        'https://app.example.com',
      ]),
    ).toBe(false);
  });

  it('blocks invalid schemes and malformed URLs', () => {
    expect(
      isSafeRedirect('javascript:alert(1)', ['https://app.example.com']),
    ).toBe(false);
    expect(isSafeRedirect('not a url', ['https://app.example.com'])).toBe(
      false,
    );
    expect(isSafeRedirect('https://app.example.com/login', ['not-a-url'])).toBe(
      false,
    );
  });
});

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    mock.restore();
  });

  it('uses fetch directly when timeout is disabled', async () => {
    const response = new Response('ok');
    const fetchMock = mock(() => Promise.resolve(response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await fetchWithTimeout('https://api.example.com', {}, 0);
    expect(result).toBe(response);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('translates AbortError into a timeout error', () => {
    const fetchMock = mock(() =>
      Promise.reject(new DOMException('Aborted', 'AbortError')),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    return expect(
      fetchWithTimeout('https://api.example.com', {}, 5),
    ).rejects.toThrow('Request timeout after 5ms');
  });

  it('rethrows non-timeout fetch errors', () => {
    const fetchMock = mock(() => Promise.reject(new Error('network down')));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    return expect(
      fetchWithTimeout('https://api.example.com', {}, 5),
    ).rejects.toThrow('network down');
  });
});

describe('createErrorResponse', () => {
  it('uses not found defaults for 404 responses', () => {
    const result = createErrorResponse(
      baseConfig,
      404,
      'not_found',
      'Missing',
      'req_404',
    );

    expect(result.request_id).toBe('req_404');
    expect(result.meta.page?.title).toBe('Page Not Found');
    expect(result.meta.page?.description).toBe(
      'The page you are looking for could not be found.',
    );
  });

  it('uses access denied defaults for 403 responses', () => {
    const result = createErrorResponse(
      baseConfig,
      403,
      'access_denied',
      'Forbidden',
      'req_403',
    );

    expect(result.request_id).toBe('req_403');
    expect(result.meta.page?.title).toBe('Access Denied');
    expect(result.meta.page?.description).toBe(
      'You do not have permission to access this page.',
    );
  });

  it('uses status-specific defaults and fallback request ids', () => {
    const result = createErrorResponse(
      {
        ...baseConfig,
        generateFallbackRequestID: (context) => `fallback_${context}`,
      },
      401,
      'authentication_required',
      'Login required',
    );

    expect(result.request_id).toBe('fallback_error');
    expect(result.meta.page?.title).toBe('Authentication Required');
    expect(result.meta.page?.description).toBe(
      'You must be logged in to access this page.',
    );
  });

  it('allows metadata overrides and transformErrorMeta', () => {
    const result = createErrorResponse(
      {
        ...baseConfig,
        transformErrorMeta: ({ baseMeta, originalMetadata }) => ({
          ...baseMeta,
          site_info: { current_year: 2026 },
          sourceTitle: originalMetadata?.title,
        }),
      },
      500,
      'internal_server_error',
      'Boom',
      'req_meta',
      {
        title: 'Custom Title',
        description: 'Custom Description',
      },
      { debug: true },
    );

    expect(result.request_id).toBe('req_meta');
    expect(result.meta).toMatchObject({
      page: {
        title: 'Custom Title',
        description: 'Custom Description',
      },
      site_info: { current_year: 2026 },
      sourceTitle: 'Custom Title',
    });
    expect(result.error?.details).toEqual({ debug: true });
  });
});

describe('applyCustomHTTPStatusHandler', () => {
  it('returns null when no handler matches', () => {
    expect(
      applyCustomHTTPStatusHandler(418, {}, baseConfig, {}, false),
    ).toBeNull();
  });

  it('prefers specific handlers over wildcard handlers', () => {
    const result = applyCustomHTTPStatusHandler(
      418,
      {},
      {
        ...baseConfig,
        statusCodeHandlers: {
          ['*']: () => ({
            ...sampleEnvelope,
            request_id: 'wildcard',
          }),
          ['418']: () => ({
            ...sampleEnvelope,
            request_id: 'specific',
          }),
        },
      },
      { cookies: ['a=1'] },
      false,
    ) as PageResponseEnvelope;

    expect(result.request_id).toBe('specific');
    expect(Reflect.get(result as object, '__ssOnly')).toEqual({
      cookies: ['a=1'],
    });
  });

  it('falls back when a custom handler returns null', () => {
    expect(
      applyCustomHTTPStatusHandler(
        418,
        {},
        {
          ...baseConfig,
          statusCodeHandlers: {
            ['418']: () => null,
          },
        },
        {},
        false,
      ),
    ).toBeNull();
  });
});

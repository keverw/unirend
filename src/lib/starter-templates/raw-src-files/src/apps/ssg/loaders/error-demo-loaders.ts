import {
  createDefaultLocalPageDataLoaderConfig,
  createPageDataLoader,
} from 'unirend/router-utils';

const localPageLoaderConfig = createDefaultLocalPageDataLoaderConfig({
  timeoutMS: 8000,
});

// Demo route 1: the local handler throws.
// Unirend converts it into an internal 500 page envelope.
export const simulateDataloaderThrowLoader = createPageDataLoader(
  localPageLoaderConfig,
  function () {
    throw new Error('Simulated data loader throw error');
  },
);

// Demo route 2: the local handler returns an explicit 500 page envelope without throwing.
export const simulateDataloader500Loader = createPageDataLoader(
  localPageLoaderConfig,
  function () {
    return {
      status: 'error' as const,
      status_code: 500,
      request_id: `local_500_${Date.now()}`,
      type: 'page' as const,
      data: null,
      meta: {
        page: {
          title: '500 - Returned Error Envelope',
          description: 'A demo local loader returned a 500 page envelope.',
        },
      },
      error: {
        code: 'internal_server_error',
        message: 'Simulated local loader 500 response.',
        details: {
          reason: 'demo_explicit_500_path',
          stack:
            'Error: Simulated local loader 500 response\n' +
            '    at simulateDataloader500Loader (demo-loader.ts:12:7)\n' +
            '    at renderPageData (unirend/router-utils:mock:1:1)',
        },
      },
    };
  },
);

// Demo route 3: the local handler returns an explicit 503 page envelope.
// Rendering succeeds, but failOn5xx can still mark the page as an SSG error.
export const simulateDataloader503Loader = createPageDataLoader(
  localPageLoaderConfig,
  function () {
    return {
      status: 'error' as const,
      status_code: 503,
      request_id: `local_503_${Date.now()}`,
      type: 'page' as const,
      data: null,
      meta: {
        page: {
          title: '503 - Service Unavailable',
          description: 'A demo local loader returned a 503 page envelope.',
        },
      },
      error: {
        code: 'service_unavailable',
        message: 'Simulated local loader 503 response.',
        details: {
          reason: 'demo_status_code_path',
        },
      },
    };
  },
);

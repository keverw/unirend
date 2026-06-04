import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSG app's `loaders/error-demo-loaders.ts`.
 *
 * SSG-specific — lives in `templates-specific/ssg/`. Provides three local
 * page-data loaders used by the error-simulation routes: one that throws
 * (converted to a 500 envelope by Unirend), one that returns an explicit 500
 * envelope, and one that returns an explicit 503 envelope. SSR handles its
 * error-demo loaders server-side via `createPageDataLoader` wired in
 * `Routes.tsx` — it doesn't ship a separate loaders file.
 */
const fileSrc = `import {
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
      request_id: \`local_500_\${Date.now()}\`,
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
            'Error: Simulated local loader 500 response\\n' +
            '    at simulateDataloader500Loader (demo-loader.ts:12:7)\\n' +
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
      request_id: \`local_503_\${Date.now()}\`,
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
`;

/**
 * Ensure the SSG app's `loaders/error-demo-loaders.ts` exists at
 * `${projectPath}/loaders/error-demo-loaders.ts`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSGErrorDemoLoaders(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/loaders/error-demo-loaders.ts`;

  try {
    const didWrite = await vfsWriteIfNotExists(root, relPath, fileSrc);

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}

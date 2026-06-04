import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for the SSG app's `generate-ssg.ts`.
 *
 * SSG-specific — lives in `templates-specific/ssg/`. The script that drives
 * `generateSSG` to pre-render pages at build time. Two per-project
 * substitutions: the build directory path in functional code
 * (`'../../../build/${appName}'`) and the same path in the JSDoc header
 * comment. Template-literal escaping needed for three `pageInfo` ternary
 * template literals and one error-count template literal in the
 * results-logging block.
 */
function buildGenerateSSGSrc(appName: string): string {
  return `import { initDevMode } from 'lifecycleion/dev-mode';
import { Logger, ConsoleSink } from 'lifecycleion/logger';
import { generateSSG, SSGLifecycleionLogger } from 'unirend/server';
import { assertSupportedRuntime } from 'unirend/utils';
import path from 'path';
import { ENABLE_TEST_ROUTES } from './consts';

/**
 * SSG Generation Script
 *
 * This script demonstrates how developers would use the generateSSG function
 * to pre-render their React application pages at build time.
 *
 * IMPORTANT: Make sure to build both client and server:
 * vite build --outDir ../../../build/${appName}/client --base=/ --ssrManifest
 * vite build --outDir ../../../build/${appName}/server --ssr EntrySSG.tsx
 *
 * Note: Use different output directories for client and server (e.g., build/client and
 * build/server). Reusing the same output directory for both can cause files to overwrite each other.
 *
 * This generates both the client build (with regular and SSR manifests) and the server build
 * that unirend uses to automatically locate your server entry file.
 *
 * Template Caching: Unirend caches the processed HTML template in .unirend-ssg.json within
 * your client build directory. Vite clears this on each build (build.emptyOutDir: true),
 * ensuring fresh template processing. If you've disabled emptyOutDir in your Vite config,
 * the cache will persist between builds. While this improves performance, make sure to
 * rebuild when you change your HTML template or app configuration.
 */

// ─── Bootstrap ───────────────────────────────────────────────────────────────
assertSupportedRuntime();
initDevMode({ detect: 'cmd', strict: true });

// ─── Logger ──────────────────────────────────────────────────────────────────
const logger = new Logger({
  sinks: [new ConsoleSink({ colors: true, timestamps: true })],
});

async function main() {
  logger.info('🚀 Starting SSG generation...');

  // Define the build directory (where Vite outputs the built files)
  const buildDir = path.resolve(__dirname, '../../../build/${appName}');

  // Request context is per-request key-value data passed into the render.
  // Access it in components via useRequestContextValue('key') (reactive, like useState)
  // or useRequestContext() (non-reactive) from 'unirend/client'.
  // Unlike publicAppConfig (global, immutable constants shared across all pages),
  // request context is per-page and mutable after hydration.
  const requestContext = {
    // Demo: seed dark theme so the flash-prevention script and ThemeProvider both
    // start in dark mode.
    //
    // WHen building an SSR template instead, this would populate
    // from the user's themePreference cookie instead in a middleware.
    themePreference: 'dark',
  };

  // SSG failOn5xx demos live in routes.tsx and are intentionally commented out in here and
  // in generate-ssg.ts so the starter template still builds cleanly by default.
  // When commented out they will generate 404 pages instead of 500/503 pages.

  // Define the pages to generate - mix of SSG and SPA
  const pages = [
    // SSG pages - server-rendered at build time
    {
      type: 'ssg' as const,
      path: '/',
      filename: 'index.html',
      requestContext,
    },
    {
      type: 'ssg' as const,
      path: '/about',
      filename: 'about.html',
      requestContext,
    },
    // Static error pages — auto-detected by StaticWebServer and unirend/php-static-server
    // from the page map and served with the correct status codes. Other setups
    // (Apache .htaccess, nginx, etc.) can be pointed at these files manually.
    //
    // 404: generated as a normal SSG page so it shares the app chrome (layout, theme, etc.).
    // A 404 means the server is healthy — external assets still load fine.
    {
      type: 'ssg' as const,
      path: '/404',
      filename: '404.html',
      requestContext,
    },
    // 500: generated as a self-contained html page with an inline stylesheet — no external JS or CSS.
    // A real 500 means the server itself may be struggling, so assets hosted on the same server
    // could also be failing to load. This page is intentionally standalone with inline styles.
    // SSR handles 500s differently: get500ErrorPage on SSRServer renders a response on-the-fly,
    // unlike a static server, and can include live data (auth state, request IDs, etc.) per-request.
    {
      type: 'html' as const,
      filename: '500.html',
      source: path.resolve(__dirname, './error-pages/500.html'),
    },
    // Demo routes for SSG 5xx handling (enabled via ENABLE_TEST_ROUTES in consts.ts):
    // - component-error: component throws only in the browser (window check), so SSG renders
    //   the static placeholder fine — the ApplicationError boundary only triggers on hydration
    // - throw: local loader throws and Unirend generates an internal 500 page envelope
    // - 500: local loader returns an explicit 500 page envelope with mock stack details
    // - 503: local loader returns an explicit 503 page envelope
    ...(ENABLE_TEST_ROUTES
      ? [
          {
            type: 'ssg' as const,
            path: '/simulate-component-error',
            filename: 'simulate-component-error.html',
            requestContext,
          },
          {
            type: 'ssg' as const,
            path: '/simulate-dataloader-500-error',
            filename: 'simulate-dataloader-500-error.html',
            requestContext,
          },
          {
            type: 'ssg' as const,
            path: '/simulate-dataloader-500-status',
            filename: 'simulate-dataloader-500-status.html',
            requestContext,
          },
          {
            type: 'ssg' as const,
            path: '/simulate-dataloader-503-status',
            filename: 'simulate-dataloader-503-status.html',
            requestContext,
          },
        ]
      : []),
    // SPA pages - client-rendered with custom metadata
    // while SSG pages can set metadata just like regular SSR pages
    {
      type: 'spa' as const,
      filename: 'dashboard.html',
      title: 'Dashboard (SPA)',
      description: 'User dashboard with real-time data',
      meta: {
        'og:title': 'Dashboard',
        'og:description': 'Access your personalized dashboard',
      },
      requestContext,
    },
  ];

  // Optional configuration
  const options = {
    // serverEntry: "EntrySSG", // Default for SSG, can be customized
    // serverEntry: "entry-server", // Use this if you want to share with SSR
    publicAppConfig: {
      // Any config you want to inject into the frontend
      api_endpoint: 'https://api.example.com',
      version: '1.0.0',
    },
    containerID: 'root', // Default React root container

    // Generate page map for StaticWebServer (maps URLs to files)
    pageMapOutput: 'page-map.json', // Written to build/client/page-map.json

    logger: SSGLifecycleionLogger(logger), // service name defaults to 'SSG'
    // logger: SSGLifecycleionLogger(logger, 'my-site-generator'), // Custom service name
    // logger: SSGConsoleLogger, // import { SSGConsoleLogger } from 'unirend/server' — simpler alternative, no Lifecycleion needed, prefixes each line with [SSG Info] / [SSG Warn] / [SSG Error]
    // logger: {
    //   info: (msg: string) => console.log(\`[Custom] \${msg}\`),
    //   warn: (msg: string) => console.warn(\`[Custom] \${msg}\`),
    //   error: (msg: string) => console.error(\`[Custom] \${msg}\`),
    // }, // Custom logger with your own prefixes
    // logger: undefined, // Silent mode (default)

    failOn5xx: !ENABLE_TEST_ROUTES, // false when test routes are on — they intentionally produce 5xx pages
    // Relevant for any SSG render that completes as a
    // page with status >= 500, including explicit 500/503 envelopes returned by
    // local loaders and loader-throw cases that React Router can still resolve into
    // a rendered error page. It does not affect component/render throws that end up
    // as raw \`render-error\` failures during SSG that considers the overall generation a failure.
    // Note: When using SSR, it has a separate internal 500 error-page path for those cases
    // through the get500ErrorPage option that can be configured to return raw HTML for a custom error page.
  };

  try {
    // Generate the static pages
    const result = await generateSSG(buildDir, pages, options);

    // Always log the page report so errors are visible before we exit
    if (result.pagesReport) {
      const { pagesReport } = result;

      logger.info(
        '📊 Summary:\\n  • Total pages: {{total}}\\n  • Successful: {{success}}\\n  • Errors: {{errors}}\\n  • Not found: {{notFound}}\\n  • Total time: {{time}}ms\\n  • Build dir: {{dir}}',
        {
          params: {
            total: pagesReport.totalPages,
            success: pagesReport.successCount,
            errors: pagesReport.errorCount,
            notFound: pagesReport.notFoundCount,
            time: pagesReport.totalTimeMS,
            dir: pagesReport.buildDir,
          },
        },
      );

      // Log individual page results
      logger.info('📄 Page Results:');

      for (const page of pagesReport.pages) {
        const pageInfo =
          page.page.type === 'ssg'
            ? \`\${page.page.path} → \${page.page.filename}\`
            : page.page.type === 'html'
              ? \`HTML → \${page.page.filename}\`
              : \`SPA → \${page.page.filename}\`;

        if (page.status === 'success') {
          logger.success('  ✅ {{pageInfo}} ({{time}}ms)', {
            params: { pageInfo, time: page.timeMS },
          });
        } else if (page.status === 'not_found') {
          logger.warn(
            '  ⚠️ {{pageInfo}} ({{time}}ms) — rendered with 404 status (expected for custom 404 pages)',
            {
              params: { pageInfo, time: page.timeMS },
            },
          );
        } else if (page.status === 'error') {
          logger.error(
            page.errorDetails
              ? '  ❌ {{pageInfo}} ({{time}}ms)\\n      Error: {{error}}'
              : '  ❌ {{pageInfo}} ({{time}}ms)',
            {
              params: { pageInfo, time: page.timeMS, error: page.errorDetails },
            },
          );
        } else {
          logger.warn(
            '  ⚠️ {{pageInfo}} ({{time}}ms) — unknown status: {{status}}',
            {
              params: { pageInfo, time: page.timeMS, status: page.status },
            },
          );
        }

        if (page.outputPath) {
          logger.info('      Output: {{path}}', {
            params: { path: page.outputPath },
          });
        }
      }
    }

    // Exit with error if generation failed (fatal pre-generation error or page-level errors)
    if (result.generationFailed) {
      logger.error('SSG generation failed: {{error}}', {
        params: {
          error: result.fatalError
            ? result.fatalError.message
            : \`\${result.pagesReport.errorCount} page error(s)\`,
        },
        exitCode: 1,
      });

      return;
    }

    logger.success('🎉 Static site generation complete!');
  } catch (error) {
    logger.error('Unexpected error during SSG generation: {{error}}', {
      params: { error },
      exitCode: 1,
    });
  }
}

// Run the script
main().catch((error) => {
  logger.error('Script failed: {{error}}', {
    params: { error },
    exitCode: 1,
  });
});
`;
}

/**
 * Ensure the SSG app's `generate-ssg.ts` exists at
 * `${projectPath}/generate-ssg.ts`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param projectName - Name of the project (used to derive the build directory path and page title)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureSSGGenerate(
  root: FileRoot,
  projectPath: string,
  projectName: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/generate-ssg.ts`;

  try {
    const didWrite = await vfsWriteIfNotExists(
      root,
      relPath,
      buildGenerateSSGSrc(projectName),
    );

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}

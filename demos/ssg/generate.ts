import { initDevMode } from 'lifecycleion/dev-mode';
import { Logger, ConsoleSink } from 'lifecycleion/logger';
import { generateSSG, SSGLifecycleionLogger } from '../../src/server';
import path from 'path';

/**
 * SSG Generation Script
 *
 * This script demonstrates how frontend users would use the generateSSG function
 * to pre-render their React application pages at build time.
 *
 * IMPORTANT: Make sure to build both client and server:
 * vite build --outDir build/client --base=/ --ssrManifest
 * vite build --outDir build/server --ssr src/entry-ssg.tsx
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

initDevMode({ detect: 'cmd', strict: true });

const logger = new Logger({
  sinks: [new ConsoleSink({ colors: true, timestamps: true })],
});

async function main() {
  logger.info('🚀 Starting SSG generation...');

  // Define the build directory (where Vite outputs the built files)
  const buildDir = path.resolve(__dirname, 'build');

  // Define the pages to generate - mix of SSG and SPA
  const pages = [
    // SSG pages - server-rendered at build time
    {
      type: 'ssg' as const,
      path: '/',
      filename: 'index.html',
    },
    {
      type: 'ssg' as const,
      path: '/about',
      filename: 'about.html',
    },
    {
      type: 'ssg' as const,
      path: '/contact',
      filename: 'contact.html',
    },
    {
      type: 'ssg' as const,
      path: '/context-demo',
      filename: 'context-demo.html',
    },
    {
      type: 'ssg' as const,
      path: '/404', // We'll use a specific path for SSG generation
      filename: '404.html',
    },
    // SPA pages - client-rendered with custom metadata
    {
      type: 'spa' as const,
      filename: 'dashboard.html',
      title: 'Dashboard - My App',
      description: 'User dashboard with real-time data',
      meta: {
        'og:title': 'Dashboard',
        'og:description': 'Access your personalized dashboard',
      },
    },
    {
      type: 'spa' as const,
      filename: 'app.html',
      title: 'App - My App',
      description: 'Main application interface',
    },
  ];

  // Optional configuration
  const options = {
    // serverEntry: "entry-ssg", // Default for SSG, can be customized
    // serverEntry: "entry-server", // Use this if you want to share with SSR
    frontendAppConfig: {
      // Any config you want to inject into the frontend
      apiUrl: 'https://api.example.com',
      version: '1.0.0',
    },
    containerID: 'root', // Default React root container

    // Generate page map for StaticWebServer (maps URLs to files)
    pageMapOutput: 'page-map.json', // Written to build/client/page-map.json

    logger: SSGLifecycleionLogger(logger), // service name defaults to 'SSG'
    // logger: SSGLifecycleionLogger(logger, 'my-site-generator'), // Custom service name
    // logger: SSGConsoleLogger, // import { SSGConsoleLogger } from 'unirend/server' — simpler alternative, no Lifecycleion needed, prefixes each line with [SSG Info] / [SSG Warn] / [SSG Error]
    // logger: {
    //   info: (msg: string) => console.log(`[Custom] ${msg}`),
    //   warn: (msg: string) => console.warn(`[Custom] ${msg}`),
    //   error: (msg: string) => console.error(`[Custom] ${msg}`),
    // }, // Custom logger with your own prefixes
    // logger: undefined, // Silent mode (default)
  };

  try {
    // Generate the static pages
    const result = await generateSSG(buildDir, pages, options);

    if (result.fatalError) {
      logger.error('Fatal error during SSG generation: {{error}}', {
        params: { error: result.fatalError.message },
        exitCode: 1,
      });

      return;
    }

    if (result.pagesReport) {
      const { pagesReport } = result;

      logger.success('✅ SSG generation completed!');

      logger.info(
        '📊 Summary:\n  • Total pages: {{total}}\n  • Successful: {{success}}\n  • Errors: {{errors}}\n  • Not found: {{notFound}}\n  • Total time: {{time}}ms\n  • Build dir: {{dir}}',
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
            ? `${page.page.path} → ${page.page.filename}`
            : `SPA → ${page.page.filename}`;

        if (page.status === 'success') {
          logger.success('  ✅ {{pageInfo}} ({{time}}ms)', {
            params: { pageInfo, time: page.timeMS },
          });
        } else if (page.status === 'error') {
          logger.error(
            page.errorDetails
              ? '  ❌ {{pageInfo}} ({{time}}ms)\n      Error: {{error}}'
              : '  ❌ {{pageInfo}} ({{time}}ms)',
            {
              params: { pageInfo, time: page.timeMS, error: page.errorDetails },
            },
          );
        } else {
          logger.warn('  ⚠️ {{pageInfo}} ({{time}}ms)', {
            params: { pageInfo, time: page.timeMS },
          });
        }

        if (page.outputPath) {
          logger.info('      Output: {{path}}', {
            params: { path: page.outputPath },
          });
        }
      }
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

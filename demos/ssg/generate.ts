import { generateSSG, SSGConsoleLogger } from '../../src/server';
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
 * This generates both the client build (with regular and SSR manifests) and the server build
 * that unirend uses to automatically locate your server entry file.
 */

async function main() {
  console.log('🚀 Starting SSG generation...');

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

    // Logging options (silent by default):
    logger: SSGConsoleLogger, // Use built-in console logger with prefixes
    // logger: undefined, // Silent mode (default)
    // logger: {
    //   info: (msg: string) => console.log(`[Custom] ${msg}`),
    //   warn: (msg: string) => console.warn(`[Custom] ${msg}`),
    //   error: (msg: string) => console.error(`[Custom] ${msg}`),
    // }, // Custom logger with your own prefixes
  };

  try {
    // Generate the static pages
    const result = await generateSSG(buildDir, pages, options);

    if (result.fatalError) {
      console.error('❌ Fatal error during SSG generation:');
      console.error(result.fatalError.message);
      process.exit(1);
    }

    if (result.pagesReport) {
      const { pagesReport } = result;

      console.log('✅ SSG generation completed!');
      console.log(`📊 Summary:`);
      console.log(`  • Total pages: ${pagesReport.totalPages}`);
      console.log(`  • Successful: ${pagesReport.successCount}`);
      console.log(`  • Errors: ${pagesReport.errorCount}`);
      console.log(`  • Not found: ${pagesReport.notFoundCount}`);
      console.log(`  • Total time: ${pagesReport.totalTimeMS}ms`);
      console.log(`  • Build dir: ${pagesReport.buildDir}`);

      // Log individual page results
      console.log('\n📄 Page Results:');
      pagesReport.pages.forEach((page) => {
        const status =
          page.status === 'success'
            ? '✅'
            : page.status === 'error'
              ? '❌'
              : '⚠️';
        const pageInfo =
          page.page.type === 'ssg'
            ? `${page.page.path} → ${page.page.filename}`
            : `SPA → ${page.page.filename}`;
        console.log(`  ${status} ${pageInfo} (${page.timeMS}ms)`);

        if (page.status === 'error' && page.errorDetails) {
          console.log(`      Error: ${page.errorDetails}`);
        }

        if (page.outputPath) {
          console.log(`      Output: ${page.outputPath}`);
        }
      });
    }

    console.log('\n🎉 Static site generation complete!');
  } catch (error) {
    console.error('❌ Unexpected error during SSG generation:');
    console.error(error);
    process.exit(1);
  }
}

// Run the script
main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

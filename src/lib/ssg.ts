import {
  IPageWanted,
  SSGOptions,
  SSGPageReport,
  SSGPagesReport,
  SSGReport,
} from "./types";

/**
 * Static Site Generator for pre-rendering pages at build time.
 *
 * Similar to the production SSR function but designed for generating static HTML files
 * during the build process rather than serving them dynamically.
 *
 * @param buildDir Directory containing built assets (HTML template, static files, manifest, etc.)
 * @param importFn Dynamic import function that returns a module with a render function.
 *                 This should point to the built/bundled server entry file, not the source file.
 *                 (e.g. () => import('./dist/server/entry-server.js'))
 * @param pages Array of pages to generate, each with a path and output filename
 * @param options Additional options for the SSG process, including frontendAppConfig
 * @returns Promise that resolves to a detailed report of the generation process
 */
export async function generateSSG(
  buildDir: string,
  importFn: () => Promise<{ render: (url: string) => Promise<string> }>,
  pages: IPageWanted[],
  options: SSGOptions = {},
): Promise<SSGReport> {
  const startTime = Date.now();
  const pageReports: SSGPageReport[] = [];

  let successCount = 0;
  let errorCount = 0;
  let notFoundCount = 0;
  
  
  // Return the complete report
  return {
    pages: pageReports,
    totalPages: pages.length,
    successCount,
    errorCount,
    notFoundCount,
    totalTimeMs: Date.now() - startTime,
    buildDir
  };
}

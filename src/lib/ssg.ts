import { IPageWanted, SSGOptions, SSGPageReport, SSGReport } from "./types";
import path from "path";
import {
  checkAndLoadManifest,
  getServerEntryFromManifest,
} from "./internal/fs-utils";

/**
 * Creates a complete SSGReport with proper typing and defaults
 */
function createSSGReport({
  buildDir,
  startTime,
  fatalError,
  pages = [],
  successCount = 0,
  errorCount = 0,
  notFoundCount = 0,
}: {
  buildDir: string;
  startTime: number;
  fatalError?: Error;
  pages?: SSGPageReport[];
  successCount?: number;
  errorCount?: number;
  notFoundCount?: number;
}): SSGReport {
  return {
    fatalError,
    pagesReport: {
      pages,
      totalPages: pages.length,
      successCount,
      errorCount,
      notFoundCount,
      totalTimeMs: Date.now() - startTime,
      buildDir,
    },
  };
}

/**
 * Static Site Generator for pre-rendering pages at build time.
 *
 * Similar to the production SSR function but designed for generating static HTML files
 * during the build process rather than serving them dynamically.
 *
 * @param buildDir Directory containing built assets (HTML template, static files, manifest, etc.)
 * @param pages Array of pages to generate, each with a path and output filename
 * @param options Additional options for the SSG process, including frontendAppConfig and serverEntry
 * @returns Promise that resolves to a detailed report of the generation process
 */

export async function generateSSG(
  buildDir: string,
  pages: IPageWanted[],
  options: SSGOptions = {},
): Promise<SSGReport> {
  const startTime = Date.now();
  const pageReports: SSGPageReport[] = [];

  const successCount = 0;
  const errorCount = 0;
  const notFoundCount = 0;

  // Load the manifest
  const manifestResult = await checkAndLoadManifest(buildDir);

  if (!manifestResult.success || !manifestResult.manifest) {
    return createSSGReport({
      buildDir,
      startTime,
      fatalError: new Error(
        `Failed to load Vite manifest: ${manifestResult.error}`,
      ),
    });
  }

  // Find the server entry in the manifest
  const serverEntry = options.serverEntry || "entry-server";
  const entryResult = await getServerEntryFromManifest(
    manifestResult.manifest,
    buildDir,
    serverEntry,
  );

  if (!entryResult.success || !entryResult.entryPath) {
    return createSSGReport({
      buildDir,
      startTime,
      fatalError: new Error(
        `Failed to find server entry: ${entryResult.error}`,
      ),
    });
  }

  // Create the import function
  const importFn = async () => {
    try {
      return await import(entryResult.entryPath as string);
    } catch (error) {
      throw new Error(
        `Failed to import server entry from ${entryResult.entryPath}: ${error}`,
      );
    }
  };

  return createSSGReport({
    buildDir,
    startTime,
    pages: pageReports,
    successCount,
    errorCount,
    notFoundCount,
  });
}

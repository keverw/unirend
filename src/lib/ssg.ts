import type {
  PageTypeWanted,
  RenderResult,
  RenderRequest,
  SSGOptions,
  SSGPageReport,
  SSGReport,
  SSGLogger,
  SSGHelpers,
} from './types';
import path from 'path';
import {
  checkAndLoadManifest,
  getServerEntryFromManifest,
  readHTMLFile,
  readJSONFile,
  writeJSONFile,
  writeHTMLFile,
} from './internal/fs-utils';
import { processTemplate } from './internal/html-utils/format';
import { injectContent } from './internal/html-utils/inject';

/**
 * Normalize a URL path: collapse multiple slashes, remove trailing slash (except root),
 * ensure leading slash.
 *
 * Examples: "///about//", "/about/", "about" → "/about"
 *           "/", "//", "///" → "/"
 */
function normalizeURLPath(p: string): string {
  // Collapse multiple slashes into one
  let normalized = p.replace(/\/+/g, '/');

  // Remove trailing slash (but keep "/" for root)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Ensure it starts with /
  if (!normalized.startsWith('/')) {
    normalized = '/' + normalized;
  }

  return normalized;
}

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
      totalTimeMS: Date.now() - startTime,
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
 * @param options Additional options for the SSG process, including frontendAppConfig and serverEntry (defaults to "entry-ssg")
 * @returns Promise that resolves to a detailed report of the generation process
 */

export async function generateSSG(
  buildDir: string,
  pages: PageTypeWanted[],
  options: SSGOptions = {},
): Promise<SSGReport> {
  const startTime = Date.now();
  const pageReports: SSGPageReport[] = [];

  let successCount = 0;
  let errorCount = 0;
  let notFoundCount = 0;

  // Set up logger - default to silent, opt-in for logging
  const logger: SSGLogger = options.logger || {
    info: () => {}, // Silent by default
    warn: () => {}, // Silent by default
    error: () => {}, // Silent by default
  };

  // Load the server manifest and find the server entry
  const serverEntry = options.serverEntry || 'entry-ssg';
  const serverFolderName = options.serverFolderName || 'server';
  const clientFolderName = options.clientFolderName || 'client';
  const serverBuildDir = path.join(buildDir, serverFolderName);

  // Load the server's regular manifest
  const serverManifestResult = await checkAndLoadManifest(
    serverBuildDir,
    false,
  );

  if (!serverManifestResult.success || !serverManifestResult.manifest) {
    return createSSGReport({
      buildDir,
      startTime,
      fatalError: new Error(
        `Failed to load server manifest: ${serverManifestResult.error}`,
      ),
    });
  }

  const entryResult = getServerEntryFromManifest(
    serverManifestResult.manifest,
    serverBuildDir,
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
  // At this point we know entryPath exists due to the check above
  const entryPath = entryResult.entryPath;

  const importFn = async (): Promise<unknown> => {
    try {
      return await import(entryPath);
    } catch (error: unknown) {
      throw new Error(
        `Failed to import server entry from ${entryPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  // Check for .unirend-ssg.json file in client folder
  // This stores the process html template
  const clientBuildDir = path.join(buildDir, clientFolderName);
  const unirendSsgPath = path.join(clientBuildDir, '.unirend-ssg.json');

  const ssgConfigResult = await readJSONFile(unirendSsgPath);

  // If there's an error reading/parsing the config file, treat it as fatal
  // Note: file not existing is not an error, only read/parse errors are fatal
  if (ssgConfigResult.error) {
    return createSSGReport({
      buildDir,
      startTime,
      fatalError: new Error(
        `Failed to read or parse .unirend-ssg.json config file: ${ssgConfigResult.error}`,
      ),
    });
  }

  let htmlTemplate: string;

  if (ssgConfigResult.exists && ssgConfigResult.data) {
    // Found the unirend SSG config file - use cached template
    const template = ssgConfigResult.data.template;
    if (typeof template === 'string') {
      htmlTemplate = template;
      // Using cached template from .unirend-ssg.json
    } else {
      return createSSGReport({
        buildDir,
        startTime,
        fatalError: new Error(
          'Invalid .unirend-ssg.json: template key is not a string',
        ),
      });
    }
  } else {
    // No config file found, read the HTML template and create config if needed
    // Read the HTML template from client build directory
    const templatePath = path.join(clientBuildDir, 'index.html');
    const templateResult = await readHTMLFile(templatePath);

    if (!templateResult.exists) {
      return createSSGReport({
        buildDir,
        startTime,
        fatalError: new Error(
          `HTML template not found at ${templatePath}. Make sure to run the client build first.`,
        ),
      });
    }

    if (templateResult.error) {
      return createSSGReport({
        buildDir,
        startTime,
        fatalError: new Error(
          `Failed to read HTML template: ${templateResult.error}`,
        ),
      });
    }

    // Process the template with SSG options
    // Assert that content exists since we've already checked templateResult.exists and !templateResult.error
    const templateContent = templateResult.content as string;

    const processResult = await processTemplate(
      templateContent,
      'ssg', // mode
      false, // isDevelopment = false for SSG
      options.containerID,
    );

    // Check if processing failed
    if (!processResult.success) {
      return createSSGReport({
        buildDir,
        startTime,
        fatalError: new Error(
          `Failed to process HTML template: ${processResult.error}`,
        ),
      });
    }

    // Store the processed template for future use
    htmlTemplate = processResult.html;

    // Write the processed template to .unirend-ssg.json with timestamp
    const ssgConfig = {
      template: htmlTemplate,
      generatedAt: new Date().toISOString(),
    };

    const writeResult = await writeJSONFile(unirendSsgPath, ssgConfig);
    if (!writeResult.success) {
      return createSSGReport({
        buildDir,
        startTime,
        fatalError: new Error(
          `Failed to write .unirend-ssg.json: ${writeResult.error}`,
        ),
      });
    }
  }

  // At this point, htmlTemplate contains the processed HTML template
  // ready for page generation (either from cache or freshly processed)

  // Validate that we have a template to work with
  if (!htmlTemplate || htmlTemplate.length === 0) {
    return createSSGReport({
      buildDir,
      startTime,
      fatalError: new Error('HTML template is empty or invalid'),
    });
  }

  // Import the server entry module with error handling
  let entryServer: unknown;

  try {
    entryServer = await importFn();
  } catch (error) {
    return createSSGReport({
      buildDir,
      startTime,
      fatalError: new Error(
        `Failed to import server entry module: ${error instanceof Error ? error.message : String(error)}`,
      ),
    });
  }

  // Validate that the imported module has a render function
  if (
    !entryServer ||
    typeof (entryServer as { render: unknown }).render !== 'function'
  ) {
    return createSSGReport({
      buildDir,
      startTime,
      fatalError: new Error(
        "Server entry module must export a 'render' function",
      ),
    });
  }

  const render: (renderRequest: RenderRequest) => Promise<RenderResult> = (
    entryServer as {
      render: (renderRequest: RenderRequest) => Promise<RenderResult>;
    }
  ).render;

  // Process pages here...
  for (const page of pages) {
    const pageStartedAt = Date.now();

    if (page.type === 'ssg') {
      // Create a simulated fetch request for the current page
      const fetchRequest = new Request(`http://localhost${page.path}`);

      // Clone frontendAppConfig to ensure it stays immutable for the entire request
      const frontendAppConfig = options.frontendAppConfig
        ? Object.freeze(structuredClone(options.frontendAppConfig))
        : undefined;

      // Create SSGHelpers with requestContext that can be populated during render
      const SSGHelpers: SSGHelpers = {
        requestContext: {},
      };

      // Attach SSGHelpers to fetch request for access during rendering
      (fetchRequest as Request & { SSGHelpers?: SSGHelpers }).SSGHelpers =
        SSGHelpers;

      const renderRequest: RenderRequest = {
        type: 'ssg',
        fetchRequest: fetchRequest,
        unirendContext: {
          renderMode: 'ssg',
          isDevelopment: false, // SSG is always production (build-time)
          fetchRequest: fetchRequest, // Fetch request available in SSG
          frontendAppConfig,
          requestContextRevision: '0-0', // Initial revision for this page
        },
      };

      const renderResult = await render(renderRequest);

      if (renderResult.resultType === 'page') {
        // --- Prepare Helmet data for injection ---
        const headInject = `
        ${renderResult.helmet?.title.toString() || ''}
        ${renderResult.helmet?.meta.toString() || ''}
        ${renderResult.helmet?.link.toString() || ''}
        ${renderResult.preloadLinks}
      `;

        // Get the requestContext from ssgHelper (may have been populated during render)
        const requestContext = (
          fetchRequest as Request & { SSGHelpers?: SSGHelpers }
        ).SSGHelpers?.requestContext;

        const htmlToWrite = injectContent(
          htmlTemplate,
          headInject,
          renderResult.html,
          {
            app: options.frontendAppConfig,
            request: requestContext,
          },
        );

        // Write the HTML file to the client directory (where assets are)
        const clientBuildDir = path.join(buildDir, clientFolderName);
        const outputPath = path.join(clientBuildDir, page.filename);
        const writeResult = await writeHTMLFile(outputPath, htmlToWrite);

        const pageEndedAt = Date.now();
        const timeMS = pageEndedAt - pageStartedAt;

        if (writeResult.success) {
          // Check if the page rendered with a 404 status
          if (renderResult.statusCode === 404) {
            // Page rendered successfully but with 404 status (e.g., custom 404 page)
            notFoundCount++;

            pageReports.push({
              page,
              status: 'not_found',
              outputPath,
              timeMS,
            });

            logger.warn(`⚠ Generated 404 page ${page.filename} (${timeMS}ms)`);
          } else {
            // Normal success
            successCount++;

            pageReports.push({
              page,
              status: 'success',
              outputPath,
              timeMS,
            });

            logger.info(`✓ Generated ${page.filename} (${timeMS}ms)`);
          }
        } else {
          // Write failed - treat as error
          errorCount++;

          pageReports.push({
            page,
            status: 'error',
            errorDetails: writeResult.error,
            timeMS,
          });

          logger.error(
            `✗ Failed to write ${page.filename}: ${writeResult.error}`,
          );
        }
      } else {
        // Handle all non-page results (redirects, errors, unexpected types)
        const pageEndedAt = Date.now();
        const timeMS = pageEndedAt - pageStartedAt;
        let errorDetails: string;

        if (renderResult.resultType === 'response') {
          const status = renderResult.response.status;
          const statusText =
            renderResult.response.statusText || 'Unknown error';
          errorDetails = `Non-page response (${status}): ${statusText}`;
        } else if (renderResult.resultType === 'render-error') {
          errorDetails = `Render error: ${renderResult.error.message}`;
        } else {
          // This should never happen with proper RenderResult types, but handle gracefully
          const resultType =
            (renderResult as unknown as { resultType?: string }).resultType ||
            'unknown';
          errorDetails = `Unexpected render result type: ${resultType}`;
        }

        errorCount++;

        pageReports.push({
          page,
          status: 'error',
          errorDetails,
          timeMS,
        });

        logger.error(
          `✗ Error on page ${page.path}: ${errorDetails} (${timeMS}ms)`,
        );
      }
    } else if (page.type === 'spa') {
      // Generate SPA page with custom metadata but no server-side content
      const pageEndedAt = Date.now();
      const timeMS = pageEndedAt - pageStartedAt;

      // Build head content from SPA page metadata
      let headInject = '';

      if (page.title) {
        headInject += `<title>${page.title}</title>\n`;
      }

      if (page.description) {
        headInject += `<meta name="description" content="${page.description}">\n`;
      }

      if (page.meta) {
        for (const [name, content] of Object.entries(page.meta)) {
          headInject += `<meta property="${name}" content="${content}">\n`;
        }
      }

      // For SPA pages, use empty body content (client will render)
      const htmlToWrite = injectContent(
        htmlTemplate,
        headInject.trim(),
        '', // Empty body content for SPA
        {
          app: options.frontendAppConfig, // Inject app config for SPA pages if provided from options
          request: page.requestContext, // Inject request context for SPA pages that was manually provided for the specific page
        },
      );

      // Write the HTML file to the client directory (where assets are)
      const clientBuildDir = path.join(buildDir, clientFolderName);
      const outputPath = path.join(clientBuildDir, page.filename);
      const writeResult = await writeHTMLFile(outputPath, htmlToWrite);

      if (writeResult.success) {
        // Success - increment count and add to reports
        successCount++;

        pageReports.push({
          page,
          status: 'success',
          outputPath,
          timeMS,
        });

        logger.info(`✓ Generated SPA ${page.filename} (${timeMS}ms)`);
      } else {
        // Write failed - treat as error
        errorCount++;

        pageReports.push({
          page,
          status: 'error',
          errorDetails: writeResult.error,
          timeMS,
        });

        logger.error(
          `✗ Failed to write SPA ${page.filename}: ${writeResult.error}`,
        );
      }
    } else {
      // Handle unknown page type
      const pageEndedAt = Date.now();
      const timeMS = pageEndedAt - pageStartedAt;

      errorCount++;

      pageReports.push({
        page,
        status: 'error',
        errorDetails: `Unknown page type: ${(page as unknown as { type?: string }).type || 'undefined'}`,
        timeMS,
      });

      logger.error(
        `✗ Unknown page type for ${(page as unknown as { filename?: string }).filename || 'unknown'}: ${(page as unknown as { type?: string }).type || 'undefined'} (${timeMS}ms)`,
      );
    }
  }

  // Generate page map file if pageMapOutput is specified
  if (options.pageMapOutput) {
    const pageMap: Record<string, string> = {};
    const pathConflicts: Array<{ path: string; files: string[] }> = [];

    // Build the path-to-filename mapping from successful pages
    for (const report of pageReports) {
      if (report.status === 'success' || report.status === 'not_found') {
        let urlPath: string;

        // For SSG pages, use the path; for SPA pages, derive path from filename
        if (report.page.type === 'ssg') {
          urlPath = normalizeURLPath(report.page.path);
        } else {
          // SPA pages don't have a path, derive from filename
          // e.g., "dashboard.html" -> "/dashboard", "index.html" -> "/"
          const basename = report.page.filename.replace(/\.html$/, '');
          urlPath = basename === 'index' ? '/' : `/${basename}`;
        }

        // Check for path conflicts
        if (pageMap[urlPath]) {
          // Find existing conflict or create new one
          const existingConflict = pathConflicts.find(
            (c) => c.path === urlPath,
          );

          if (existingConflict) {
            existingConflict.files.push(report.page.filename);
          } else {
            pathConflicts.push({
              path: urlPath,
              files: [pageMap[urlPath], report.page.filename],
            });
          }
        }

        pageMap[urlPath] = report.page.filename;
      }
    }

    // If there are path conflicts, return fatal error
    if (pathConflicts.length > 0) {
      const conflictDetails = pathConflicts
        .map((c) => `  "${c.path}" -> [${c.files.join(', ')}]`)
        .join('\n');

      return createSSGReport({
        buildDir,
        startTime,
        pages: pageReports,
        successCount,
        errorCount,
        notFoundCount,
        fatalError: new Error(
          `Page map has conflicting paths (multiple files map to the same URL):\n${conflictDetails}`,
        ),
      });
    }

    // Write the page map file to the build directory
    const pageMapPath = path.join(buildDir, options.pageMapOutput);

    const pageMapWriteResult = await writeJSONFile(pageMapPath, pageMap);

    if (!pageMapWriteResult.success) {
      return createSSGReport({
        buildDir,
        startTime,
        pages: pageReports,
        successCount,
        errorCount,
        notFoundCount,
        fatalError: new Error(
          `Failed to write page map file: ${pageMapWriteResult.error}`,
        ),
      });
    }

    logger.info(`✓ Generated page map: ${pageMapPath}`);
  }

  return createSSGReport({
    buildDir,
    startTime,
    pages: pageReports,
    successCount,
    errorCount,
    notFoundCount,
  });
}

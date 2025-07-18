import {
  IPageWanted,
  IRenderResult,
  IRenderRequest,
  SSGOptions,
  SSGPageReport,
  SSGReport,
  SSGLogger,
  consoleLogger,
} from "./types";
import path from "path";
import {
  checkAndLoadManifest,
  getServerEntryFromManifest,
  readHTMLFile,
  readJSONFile,
  writeJSONFile,
  writeHTMLFile,
} from "./internal/fs-utils";
import { processTemplate } from "./internal/html-utils/format";
import { injectContent } from "./internal/html-utils/inject";

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
 * @param options Additional options for the SSG process, including frontendAppConfig and serverEntry (defaults to "entry-ssg")
 * @returns Promise that resolves to a detailed report of the generation process
 */

export async function generateSSG(
  buildDir: string,
  pages: IPageWanted[],
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
  const serverEntry = options.serverEntry || "entry-ssg";
  const serverBuildDir = path.join(buildDir, "server");

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
  const importFn = async () => {
    try {
      return await import(entryResult.entryPath as string);
    } catch (error) {
      throw new Error(
        `Failed to import server entry from ${entryResult.entryPath}: ${error}`,
      );
    }
  };

  // Check for .unirend-ssg.json file in client folder
  // This stores the process html template
  const clientBuildDir = path.join(buildDir, "client");
  const unirendSsgPath = path.join(clientBuildDir, ".unirend-ssg.json");

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
    if (typeof template === "string") {
      htmlTemplate = template;
      // Using cached template from .unirend-ssg.json
    } else {
      return createSSGReport({
        buildDir,
        startTime,
        fatalError: new Error(
          "Invalid .unirend-ssg.json: template key is not a string",
        ),
      });
    }
  } else {
    // No config file found, read the HTML template and create config if needed
    // Read the HTML template from client build directory
    const templatePath = path.join(clientBuildDir, "index.html");
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

    const processedTemplate = processTemplate(
      templateContent,
      false, // isDevelopment = false for SSG
      options.frontendAppConfig,
      options.containerID,
    );

    // Store the processed template for future use
    htmlTemplate = processedTemplate;

    // Write the processed template to .unirend-ssg.json with timestamp
    const ssgConfig = {
      template: processedTemplate,
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
      fatalError: new Error("HTML template is empty or invalid"),
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
    typeof (entryServer as { render: unknown }).render !== "function"
  ) {
    return createSSGReport({
      buildDir,
      startTime,
      fatalError: new Error(
        "Server entry module must export a 'render' function",
      ),
    });
  }

  const render: (renderRequest: IRenderRequest) => Promise<IRenderResult> = (
    entryServer as {
      render: (renderRequest: IRenderRequest) => Promise<IRenderResult>;
    }
  ).render;

  // Process pages here...
  for (const page of pages) {
    const pageStartedAt = Date.now();

    if (page.type === "ssg") {
      // Create a simulated fetch request for the current page
      const fetchRequest = new Request(`http://localhost${page.path}`);
      const renderRequest: IRenderRequest = {
        type: "ssg",
        fetchRequest: fetchRequest,
      };

      const renderResult = await render(renderRequest);

      if (renderResult.resultType === "page") {
        // --- Prepare Helmet data for injection ---
        const headInject = `
        ${renderResult.helmet?.title.toString() || ""}
        ${renderResult.helmet?.meta.toString() || ""}
        ${renderResult.helmet?.link.toString() || ""}
        ${renderResult.preloadLinks}
      `;

        const htmlToWrite = injectContent(
          htmlTemplate,
          headInject,
          renderResult.html,
          false,
        );

        // Write the HTML file to the client directory (where assets are)
        const clientBuildDir = path.join(buildDir, "client");
        const outputPath = path.join(clientBuildDir, page.filename);
        const writeResult = await writeHTMLFile(outputPath, htmlToWrite);

        const pageEndedAt = Date.now();
        const timeMs = pageEndedAt - pageStartedAt;

        if (writeResult.success) {
          // Check if the page rendered with a 404 status
          if (renderResult.statusCode === 404) {
            // Page rendered successfully but with 404 status (e.g., custom 404 page)
            notFoundCount++;

            pageReports.push({
              page,
              status: "not_found",
              outputPath,
              timeMs,
            });

            logger.warn(`⚠ Generated 404 page ${page.filename} (${timeMs}ms)`);
          } else {
            // Normal success
            successCount++;

            pageReports.push({
              page,
              status: "success",
              outputPath,
              timeMs,
            });

            logger.info(`✓ Generated ${page.filename} (${timeMs}ms)`);
          }
        } else {
          // Write failed - treat as error
          errorCount++;

          pageReports.push({
            page,
            status: "error",
            errorDetails: writeResult.error,
            timeMs,
          });

          logger.error(
            `✗ Failed to write ${page.filename}: ${writeResult.error}`,
          );
        }
      } else {
        // Handle all non-page results (redirects, errors, unexpected types)
        const pageEndedAt = Date.now();
        const timeMs = pageEndedAt - pageStartedAt;
        let errorDetails: string;

        if (renderResult.resultType === "response") {
          const status = renderResult.response.status;
          const statusText =
            renderResult.response.statusText || "Unknown error";
          errorDetails = `Non-page response (${status}): ${statusText}`;
        } else {
          const resultType = (renderResult as any).resultType || "unknown";
          errorDetails = `Unexpected render result type: ${resultType}`;
        }

        errorCount++;

        pageReports.push({
          page,
          status: "error",
          errorDetails,
          timeMs,
        });

        logger.error(
          `✗ Error on page ${page.path}: ${errorDetails} (${timeMs}ms)`,
        );
      }
    } else if (page.type === "spa") {
      // Generate SPA page with custom metadata but no server-side content
      const pageEndedAt = Date.now();
      const timeMs = pageEndedAt - pageStartedAt;

      // Build head content from SPA page metadata
      let headInject = "";

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
        "", // Empty body content for SPA
        false,
      );

      // Write the HTML file to the client directory (where assets are)
      const clientBuildDir = path.join(buildDir, "client");
      const outputPath = path.join(clientBuildDir, page.filename);
      const writeResult = await writeHTMLFile(outputPath, htmlToWrite);

      if (writeResult.success) {
        // Success - increment count and add to reports
        successCount++;

        pageReports.push({
          page,
          status: "success",
          outputPath,
          timeMs,
        });

        logger.info(`✓ Generated SPA ${page.filename} (${timeMs}ms)`);
      } else {
        // Write failed - treat as error
        errorCount++;

        pageReports.push({
          page,
          status: "error",
          errorDetails: writeResult.error,
          timeMs,
        });

        logger.error(
          `✗ Failed to write SPA ${page.filename}: ${writeResult.error}`,
        );
      }
    } else {
      // Handle unknown page type
      const pageEndedAt = Date.now();
      const timeMs = pageEndedAt - pageStartedAt;

      errorCount++;

      pageReports.push({
        page,
        status: "error",
        errorDetails: `Unknown page type: ${(page as any).type || "undefined"}`,
        timeMs,
      });

      logger.error(
        `✗ Unknown page type for ${(page as any).filename || "unknown"}: ${(page as any).type || "undefined"} (${timeMs}ms)`,
      );
    }
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

import { IPageWanted, SSGOptions, SSGPageReport, SSGReport } from "./types";
import path from "path";
import {
  checkAndLoadManifest,
  getServerEntryFromManifest,
  readHTMLFile,
  readJSONFile,
  writeJSONFile,
} from "./internal/fs-utils";
import { processTemplate } from "./internal/html-utils/format";

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

  const successCount = 0;
  const errorCount = 0;
  const notFoundCount = 0;

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
  return createSSGReport({
    buildDir,
    startTime,
    pages: pageReports,
    successCount,
    errorCount,
    notFoundCount,
  });
}

import { SSRServer } from "./internal/SSRServer";
import { ServeSSRDevOptions, ServeSSRProdOptions } from "./types";
import {
  checkAndLoadManifest,
  getServerEntryFromManifest,
} from "./internal/fs-utils";

/**
 * Development server handler for SSR applications using Vite's HMR and middleware.
 * Simplifies dev workflow while preserving React Router SSR consistency.
 *
 * For development, we take a string path to the source entry file which will be processed
 * by Vite's dev server with HMR support.
 *
 * @param serverSourceEntryPath String path to the source entry file (e.g. "./src/entry-server.tsx")
 * @param options Development SSR options
 */

export async function serveSSRDev(
  serverSourceEntryPath: string,
  options: ServeSSRDevOptions = {},
): Promise<SSRServer> {
  return new SSRServer({
    mode: "development",
    serverSourceEntryPath,
    options,
  });
}

/**
 * Production server handler for SSR applications.
 *
 * Uses dynamic imports to prevent bundlers from re-bundling the already built
 * Vite application. This approach ensures proper code splitting and avoids
 * duplicate bundling of the server entry point.
 *
 * @param buildDir Directory containing built assets (HTML template, static files, manifest, etc.)
 * @param options Production SSR options, including serverEntry to specify which entry file to use
 */

export async function serveSSRProd(
  buildDir: string,
  options: ServeSSRProdOptions = {},
): Promise<SSRServer> {
  // Load the manifest
  const manifestResult = await checkAndLoadManifest(buildDir);

  if (!manifestResult.success || !manifestResult.manifest) {
    throw new Error(`Failed to load Vite manifest: ${manifestResult.error}`);
  }

  // Find the server entry in the manifest
  const serverEntry = options.serverEntry || "entry-server";
  const entryResult = await getServerEntryFromManifest(
    manifestResult.manifest,
    buildDir,
    serverEntry,
  );

  if (!entryResult.success || !entryResult.entryPath) {
    throw new Error(`Failed to find server entry: ${entryResult.error}`);
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

  return new SSRServer({
    mode: "production",
    buildDir,
    importFn,
    options,
  });
}

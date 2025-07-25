import { SSRServer } from "./internal/SSRServer";
import { ServeSSRDevOptions, ServeSSRProdOptions, SSRDevPaths } from "./types";
import {
  checkAndLoadManifest,
  getServerEntryFromManifest,
} from "./internal/fs-utils";
import path from "path";

/**
 * Development server handler for SSR applications using Vite's HMR and middleware.
 * Simplifies dev workflow while preserving React Router SSR consistency.
 *
 * For development, we integrate with Vite's dev server for HMR support and middleware mode.
 *
 * @param paths Required file paths for development server setup
 * @param options Development SSR options
 */

export async function serveSSRDev(
  paths: SSRDevPaths,
  options: ServeSSRDevOptions = {},
): Promise<SSRServer> {
  return new SSRServer({
    mode: "development",
    paths,
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
  // Get folder names from options with defaults
  const serverFolderName = options.serverFolderName || "server";
  const serverBuildDir = path.join(buildDir, serverFolderName);

  // Load the manifest from the server build directory
  const manifestResult = await checkAndLoadManifest(serverBuildDir);

  if (!manifestResult.success || !manifestResult.manifest) {
    throw new Error(`Failed to load Vite manifest: ${manifestResult.error}`);
  }

  // Find the server entry in the manifest
  const serverEntry = options.serverEntry || "entry-server";
  const entryResult = getServerEntryFromManifest(
    manifestResult.manifest,
    serverBuildDir,
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

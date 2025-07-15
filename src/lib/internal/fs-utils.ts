import fs from "fs/promises";
import path from "path";

interface ManifestResult {
  success: boolean;
  manifest?: Record<string, unknown>;
  error?: string;
}

interface ServerEntryResult {
  success: boolean;
  entryPath?: string;
  error?: string;
}

/**
 * Checks for and loads the Vite manifest file
 * @param buildDir Directory containing built assets
 * @returns Result object with success status and manifest data or error
 */

export async function checkAndLoadManifest(
  buildDir: string,
): Promise<ManifestResult> {
  const manifestPath = path.resolve(buildDir, ".vite/manifest.json");

  try {
    const manifestContent = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestContent);

    return {
      success: true,
      manifest,
    };
  } catch (error) {
    return {
      success: false,
      error: `Failed to load manifest from ${manifestPath}: ${error}`,
    };
  }
}

/**
 * Scans the Vite manifest to find the built server entry file
 * @param manifest The parsed manifest JSON object
 * @param buildDir Directory containing built assets
 * @param serverEntry Name of the server entry file to look for (without extension)
 * @returns Result object with success status and entry path or error
 */

export async function getServerEntryFromManifest(
  manifest: Record<string, unknown>,
  buildDir: string,
  serverEntry: string = "entry-server",
): Promise<ServerEntryResult> {
  // Find the entry in the manifest
  for (const [key, value] of Object.entries(manifest)) {
    if (
      key.includes(serverEntry) &&
      typeof value === "object" &&
      value !== null &&
      "file" in value
    ) {
      const fileName = (value as { file: string }).file;
      const entryPath = path.resolve(buildDir, fileName);
      return {
        success: true,
        entryPath,
      };
    }
  }

  // Entry not found in manifest
  return {
    success: false,
    error: `Server entry '${serverEntry}' not found in manifest`,
  };
}

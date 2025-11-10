import fs from 'fs/promises';
import path from 'path';

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

interface HTMLFileResult {
  exists: boolean;
  content?: string;
  error?: string;
}

interface JSONFileResult {
  exists: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

interface WriteResult {
  success: boolean;
  error?: string;
}

/**
 * Checks for and loads the Vite manifest file
 * @param buildDir Directory containing built assets
 * @param isSSR Whether to load SSR manifest (default: false for regular manifest)
 * @returns Result object with success status and manifest data or error
 */

export async function checkAndLoadManifest(
  buildDir: string,
  isSSR: boolean = false,
): Promise<ManifestResult> {
  const manifestFile = isSSR ? 'ssr-manifest.json' : 'manifest.json';
  const manifestPath = path.resolve(buildDir, `.vite/${manifestFile}`);

  try {
    const manifestContent = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(manifestContent) as Record<string, unknown>;

    return {
      success: true,
      manifest,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: `Failed to load ${isSSR ? 'SSR ' : ''}manifest from ${manifestPath}: ${errorMessage}`,
    };
  }
}

/**
 * Finds the built server entry file from an already-loaded manifest
 * @param manifest The already-loaded server manifest
 * @param serverBuildDir Directory containing server build assets
 * @param serverEntry Name of the server entry file to look for (without extension)
 * @returns Result object with success status and entry path or error
 */
export function getServerEntryFromManifest(
  manifest: Record<string, unknown>,
  serverBuildDir: string,
  serverEntry: string = 'entry-server',
): ServerEntryResult {
  // Find the entry in the manifest
  for (const [key, value] of Object.entries(manifest)) {
    if (
      key.includes(serverEntry) &&
      typeof value === 'object' &&
      value !== null &&
      'file' in value
    ) {
      const fileName = (value as { file: string }).file;
      const entryPath = path.resolve(serverBuildDir, fileName);
      return {
        success: true,
        entryPath,
      };
    }
  }

  // Entry not found in manifest
  return {
    success: false,
    error: `Server entry '${serverEntry}' not found in server manifest`,
  };
}

/**
 * Reads an HTML file and returns its contents as a string
 * @param filePath Path to the HTML file
 * @returns Result object with existence status and file content or error
 */
export async function readHTMLFile(filePath: string): Promise<HTMLFileResult> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return {
      exists: true,
      content,
    };
  } catch (error: unknown) {
    // Check if it's a file not found error
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {
        exists: false,
      };
    }

    // File exists but couldn't be read
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      exists: true,
      error: `Failed to read HTML file ${filePath}: ${errorMessage}`,
    };
  }
}

/**
 * Reads a JSON file and returns its parsed contents
 * @param filePath Path to the JSON file
 * @returns Result object with existence status and parsed JSON data or error
 */
export async function readJSONFile(filePath: string): Promise<JSONFileResult> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content) as Record<string, unknown>;

    return {
      exists: true,
      data,
    };
  } catch (error: unknown) {
    // Check if it's a file not found error
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {
        exists: false,
      };
    }

    // File exists but couldn't be read or parsed
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      exists: true,
      error: `Failed to read or parse JSON file ${filePath}: ${errorMessage}`,
    };
  }
}

/**
 * Writes data to a JSON file with human-readable formatting
 * @param filePath Path to the JSON file to write
 * @param data Data to write to the file
 * @returns Result object with success status and optional error
 */
export async function writeJSONFile(
  filePath: string,
  data: Record<string, unknown>,
): Promise<WriteResult> {
  try {
    // Format JSON with 2-space indentation for human readability
    const jsonContent = JSON.stringify(data, null, 2);
    await fs.writeFile(filePath, jsonContent, 'utf-8');

    return {
      success: true,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: `Failed to write JSON file ${filePath}: ${errorMessage}`,
    };
  }
}

/**
 * Writes HTML content to a file
 * @param filePath Path to the HTML file to write
 * @param content HTML content to write to the file
 * @returns Result object with success status and optional error
 */
export async function writeHTMLFile(
  filePath: string,
  content: string,
): Promise<WriteResult> {
  try {
    await fs.writeFile(filePath, content, 'utf-8');

    return {
      success: true,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: `Failed to write HTML file ${filePath}: ${errorMessage}`,
    };
  }
}

/**
 * Validates that all required development paths exist
 * @param paths SSRDevPaths object containing serverEntry, template, and viteConfig paths
 * @returns Result object with success status and error details for any missing files
 */
export async function validateDevPaths(paths: {
  serverEntry: string;
  template: string;
  viteConfig: string;
}): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Check server entry file
  try {
    await fs.access(paths.serverEntry);
  } catch {
    errors.push(`Server entry file not found: ${paths.serverEntry}`);
  }

  // Check template file
  try {
    await fs.access(paths.template);
  } catch {
    errors.push(`Template file not found: ${paths.template}`);
  }

  // Check vite config file
  try {
    await fs.access(paths.viteConfig);
  } catch {
    errors.push(`Vite config file not found: ${paths.viteConfig}`);
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

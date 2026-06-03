import { vfsReadJSON, vfsWriteJSON } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Shape of the repo-level `build-info.config.json` manifest. `outputs` is typed
 * `unknown` because the file is user-editable and is validated at runtime.
 */
interface BuildInfoConfig {
  outputs?: unknown;
}

/**
 * Ensure `build-info.config.json` at the repo root lists `outputPath`.
 *
 * The manifest is shared by every server template (SSR, API): each app appends
 * its own `current-build-info.ts` output path, and the single
 * `scripts/generate-build-info.ts` writes them all. Creates the file with the
 * one entry if it's missing, otherwise appends `outputPath` only when absent so
 * re-running for another app (or the same one) doesn't duplicate it.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param outputPath - Repo-root-relative output path to register
 *   (e.g. "src/apps/my-app/current-build-info.ts")
 * @param log - Optional logger function for output
 * @throws {Error} If the file read/write fails, the JSON is invalid, or the
 *   existing `outputs` field is present but not an array
 */
export async function ensureBuildInfoOutput(
  root: FileRoot,
  outputPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const filePath = 'build-info.config.json';

  try {
    const readResult = await vfsReadJSON<BuildInfoConfig>(root, filePath);

    if (!readResult.ok) {
      if (readResult.code !== 'ENOENT') {
        if (readResult.code === 'PARSE_ERROR') {
          throw new Error(`Invalid JSON in ${filePath}: ${readResult.message}`);
        }

        throw new Error(`Failed to read ${filePath}: ${readResult.message}`);
      }

      // File doesn't exist — create it with this app's output.
      await vfsWriteJSON(root, filePath, { outputs: [outputPath] });

      if (log) {
        log('info', `Created ${filePath}`);
      }

      return;
    }

    // File exists — append the output path only when it's not already listed.
    const config = readResult.data;

    // A missing `outputs` is fine (initialized below), but a present value of
    // the wrong type means a malformed manifest — error instead of silently
    // overwriting whatever the user put there.
    if (config.outputs !== undefined && !Array.isArray(config.outputs)) {
      throw new Error(
        `${filePath} has an "outputs" field that is not an array of paths`,
      );
    }

    // Reuse the existing array (now known to be an valid array type) or start a
    // fresh one when the key was absent. Typed `unknown[]` since we only
    // validated that it's an array, not that every element is a string.
    const outputs: unknown[] = Array.isArray(config.outputs)
      ? (config.outputs as unknown[])
      : [];

    // Append only when missing to avoid potential duplicate entries
    // in the root build-info.config.json file.
    // For example, if the same app is deleted and re-created
    // This also becomes a no-op when the output is already present.
    if (!outputs.includes(outputPath)) {
      outputs.push(outputPath);
      config.outputs = outputs;
      await vfsWriteJSON(root, filePath, config);

      if (log) {
        log('info', `Added ${outputPath} to ${filePath}`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${filePath}: ${errorMessage}`);
  }
}

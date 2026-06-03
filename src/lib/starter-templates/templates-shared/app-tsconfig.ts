import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for a Vite app's `tsconfig.json`.
 *
 * Identical across the Vite-based templates (SSG, SSR), so it lives in
 * `templates-shared/` rather than being duplicated per template. It extends the
 * repo-root tsconfig and layers on the Vite-specific bits (the `vite/client`
 * ambient types and a `baseUrl` pointing back at the repo root). The API
 * template doesn't ship one — it has no Vite/client surface and just uses the
 * repo-root config.
 */
const fileSrc = `{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "types": ["vite/client"],
    "baseUrl": "../../.."
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "dist"]
}
`;

/**
 * Ensure a Vite app's `tsconfig.json` exists at `${projectPath}/tsconfig.json`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppTsConfig(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/tsconfig.json`;

  try {
    const didWrite = await vfsWriteIfNotExists(root, relPath, fileSrc);

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}

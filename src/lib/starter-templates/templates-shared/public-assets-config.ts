import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Default `public-assets.config.json` written into each Vite app's project
 * folder. It tells the repo-level `scripts/check-public-assets.ts` where to
 * find the app's declared public-asset lists and its `public/` directory.
 *
 * The scaffolded file has a single entry mirroring the template conventions
 * (all paths relative to the app folder). The key is just a label used in the
 * check's error messages. Every field is optional in the checker and defaults
 * to exactly these values, but the scaffold spells them out so the file is
 * self-documenting — JSON has no comments to explain the shape otherwise.
 *
 * The point of the indirection is the multi-app SSR pattern (see the
 * "Multi-App SSR Support" section of docs/ssr.md): a project restructured to
 * host several apps (each its own Vite root with its own `public/` and its
 * own declared lists) adds an entry per additional app, and updates the
 * `default` entry's paths if the default app's source moved into a subfolder.
 * The framework has no opinion on multi-app folder layout, so the check
 * can't discover those apps by convention — this file declares them.
 *
 * Deleting the file opts the project out of the check entirely (the checker
 * logs the skip so CI output shows it).
 */
const fileContent = `${JSON.stringify(
  {
    default: {
      publicDir: 'public',
      constsFile: 'consts.ts',
      filesExport: 'PUBLIC_FILES',
      foldersExport: 'PUBLIC_FOLDERS',
    },
  },
  null,
  2,
)}\n`;

/**
 * Ensure a Vite app's `public-assets.config.json` exists at
 * `${projectPath}/public-assets.config.json`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensurePublicAssetsConfig(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/public-assets.config.json`;

  try {
    const didWrite = await vfsWriteIfNotExists(root, relPath, fileContent);

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}

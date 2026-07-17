import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for the repo-level `scripts/check-public-assets.ts`.
 *
 * The script is a thin wrapper over `checkPublicAssets()` from
 * `unirend/repo-tools` (see `src/lib/repo-tools/check-public-assets.ts` for
 * the actual check): the function acts as the main and prints its own
 * report, the wrapper turns the result into an exit code. Keeping the logic
 * in the package means repos pick up fixes by upgrading unirend — the
 * wrapper is written create-if-missing and would otherwise freeze at
 * scaffold time. It doubles as the customization point, same as the
 * `generate-build-info.ts` wrapper: options to `checkPublicAssets()` go
 * here.
 *
 * A single script services every Vite app in the repo: the check reads
 * `unirend-repo.json`, and for each SSR/SSG project compares the app's
 * declared public-asset lists against the files actually present in its
 * `public/` directory, located via the project's `public-assets.config.json`
 * (see `public-assets-config.ts`). It's registered in
 * `base-files/package-json.ts` (its own script entry plus the `check` chain)
 * and exits non-zero on drift so it fails CI.
 */
const fileSrc = `import { join } from 'path';
import { checkPublicAssets } from 'unirend/repo-tools';

// Verifies each Vite app's declared public-asset lists (PUBLIC_FILES/
// PUBLIC_FOLDERS by default) match the files actually present in its public/
// directory. Runs from the project root (invoked via check:public-assets,
// chained into \`bun run check\`).
//
// Why this exists: files in public/ are copied verbatim to the client build
// root and are served in production ONLY if declared. Dev servers serve them
// implicitly, so drift is invisible until production — this check makes it
// fail CI instead.
//
// Each project declares where its lists live in public-assets.config.json
// (one entry per app — multi-app SSR projects add an entry for each Vite
// root). A project without the file is skipped: deleting it is the opt-out.
//
// The check itself lives in unirend and upgrades with it; this wrapper is
// the place to customize (e.g. pass options to checkPublicAssets()).

try {
  const result = await checkPublicAssets({
    // Anchor to the repo root (this file lives in scripts/) so running the
    // file directly from a subfolder behaves the same as \`bun run
    // check:public-assets\`, which always runs from the package.json's
    // directory.
    rootDir: join(import.meta.dirname, '..'),
  });

  if (!result.success) {
    process.exit(1);
  }
} catch (error) {
  console.error('Failed to run public-assets check:', error);
  process.exit(1);
}
`;

/**
 * Ensure `scripts/check-public-assets.ts` exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites. Written for
 * every repo (the check no-ops without SSR/SSG projects), so it lives with
 * the base-file ensures and a second scaffold run is a no-op.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureCheckPublicAssets(
  root: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = 'scripts/check-public-assets.ts';

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

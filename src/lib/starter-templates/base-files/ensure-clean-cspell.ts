import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for the repo-level `scripts/clean-cspell.ts`.
 *
 * The script is a thin wrapper over `cleanCspell()` from
 * `unirend/repo-tools` (see `src/lib/repo-tools/clean-cspell.ts` for the
 * actual scan): the function acts as the main and prints its own report, the
 * wrapper parses `--fix`/`--write` and turns the result into an exit code.
 * Keeping the logic in the package means repos pick up fixes by upgrading
 * unirend — the wrapper is written create-if-missing and would otherwise
 * freeze at scaffold time. It doubles as the customization point, same as
 * the `generate-build-info.ts` wrapper: options to `cleanCspell()` go here.
 */
const fileSrc = `import { join } from 'path';
import { cleanCspell } from 'unirend/repo-tools';

// Reports custom words in cspell.json that no longer appear anywhere in the
// repo (invoked via cspell:clean, or cspell:clean:fix to remove them).
//
// The scan itself lives in unirend and upgrades with it; this wrapper is the
// place to customize (e.g. pass options to cleanCspell()).

const isFix =
  process.argv.includes('--write') || process.argv.includes('--fix');

try {
  const result = await cleanCspell({
    // Anchor to the repo root (this file lives in scripts/) so running the
    // file directly from a subfolder behaves the same as \`bun run
    // cspell:clean\`, which always runs from the package.json's directory.
    rootDir: join(import.meta.dirname, '..'),
    fix: isFix,
  });

  if (!result.success) {
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Script failed with error:', error);
  process.exit(1);
}
`;

/**
 * Ensure scripts/clean-cspell.ts exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites.
 * @throws {Error} If file creation fails
 */
export async function ensureCleanCspell(
  repoRoot: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  try {
    const didWrite = await vfsWriteIfNotExists(
      repoRoot,
      'scripts/clean-cspell.ts',
      fileSrc,
    );

    if (didWrite && log) {
      log('info', 'Created scripts/clean-cspell.ts');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to ensure scripts/clean-cspell.ts: ${errorMessage}`,
    );
  }
}

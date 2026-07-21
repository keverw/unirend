import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for the repo-level `scripts/check-overrides.ts`.
 *
 * The script is a thin wrapper over `checkOverrides()` from
 * `unirend/repo-tools` (see `src/lib/repo-tools/check-overrides.ts` for the
 * actual check): the function acts as the main and prints its own report, the
 * wrapper turns the result into an exit code. Keeping the logic in the package
 * means repos pick up fixes by upgrading unirend — the wrapper is written
 * create-if-missing and would otherwise freeze at scaffold time. It doubles as
 * the customization point, same as the `check-public-assets.ts` wrapper:
 * options to `checkOverrides()` go here.
 *
 * It's registered in `base-files/package-json.ts` (its own script entry plus
 * the `check` chain) and exits non-zero on a stale override so it fails CI.
 */
const fileSrc = `import { join } from 'path';
import { checkOverrides } from 'unirend/repo-tools';

// Fails on an override (or resolution) that looks applied but isn't. Runs from
// the project root (invoked via check:overrides, chained into \`bun run check\`).
//
// An override is almost always a temporary pin around an upstream bug or
// advisory, and there are several ways one ends up declared but not actually
// in effect. Bun fails the install for none of them — at most it prints a
// warning that scrolls past in install output. Each one reads as applied while
// pinning nothing, which is the whole reason this runs in CI.
//
// The individual cases, and the bun behavior verified behind each, are
// documented in
// https://github.com/keverw/unirend/blob/master/docs/starter-templates.md
// rather than restated here. That list tracks what a given bun release
// actually does, so it belongs somewhere it can be corrected once, not copied
// into every generated repo where it would quietly go stale.
//
// The check itself lives in unirend and upgrades with it; this wrapper is the
// place to customize. If a package is deliberately pinned below a dependent's
// range to avoid an upstream regression, list its name in allowBackwardPins.

// --verbose additionally prints what each surviving override is doing to the
// resolved tree (which dependents it forces past, or that it forces nothing
// right now, which hints it may have outlived its reason). Off by default so
// the every-CI-run output stays one line.
const isVerbose = process.argv.includes('--verbose');

try {
  const result = await checkOverrides({
    // Anchor to the repo root (this file lives in scripts/) so running the
    // file directly from a subfolder behaves the same as \`bun run
    // check:overrides\`, which always runs from the package.json's directory.
    rootDir: join(import.meta.dirname, '..'),
    verbose: isVerbose,
    // allowBackwardPins: ['package-with-an-intentional-downgrade'],
  });

  if (!result.success) {
    process.exit(1);
  }
} catch (error) {
  console.error('Failed to run overrides check:', error);
  process.exit(1);
}
`;

/**
 * Ensure `scripts/check-overrides.ts` exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites. Written for
 * every repo (the check no-ops when no overrides are declared), so it lives
 * with the base-file ensures and a second scaffold run is a no-op.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureCheckOverrides(
  root: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = 'scripts/check-overrides.ts';

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

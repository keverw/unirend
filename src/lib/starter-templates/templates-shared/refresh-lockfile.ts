import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for the repo-level `scripts/refresh-lockfile.ts`.
 *
 * The script is a thin wrapper over `refreshLockfile()` from
 * `unirend/repo-tools` (see `src/lib/repo-tools/refresh-lockfile.ts` for the
 * actual work): the function acts as the main and prints its own change
 * report, the wrapper turns the result into an exit code. Keeping the logic in
 * the package means repos pick up fixes by upgrading unirend — the wrapper is
 * written create-if-missing and would otherwise freeze at scaffold time. It
 * doubles as the customization point: options to `refreshLockfile()` go here.
 *
 * It's registered in `base-files/package-json.ts` as `install:fresh` and is
 * deliberately NOT part of the `check` chain, since it mutates the lockfile.
 */
const fileSrc = `import { join } from 'path';
import { refreshLockfile } from 'unirend/repo-tools';

// Deletes bun.lock, resolves it from scratch, and reports exactly which
// packages changed. Runs from the project root (invoked via install:fresh).
// Not part of \`bun run check\` — it mutates the lockfile.
//
// Why this exists: a lockfile holds every resolved version steady, including
// versions that are merely in range, and a plain \`bun install\` will not move
// them. That is what a lockfile is for, not a bug. Resolving from scratch is
// the only way to take the in-range updates your ranges already permit, and
// nothing reports what that would change until you do it.
//
// This is NOT needed to make an \`overrides\` entry take effect — bun applies an
// added, changed, or removed override on a plain \`bun install\`, and
// check:overrides fails the build if bun.lock ever disagrees with a declared
// pin. Where it helps with overrides is the opposite question, which no offline
// check can answer: is this pin still needed? Delete the suspect override, run
// this, and read the change report for the version the package moves to. See
// https://github.com/keverw/unirend/blob/master/docs/starter-templates.md,
// which is where the bun behavior above is verified and kept current.
//
// A fresh resolve picks up every in-range update at once, so the change report
// exists to make regeneration a deliberate review step. The previous lockfile
// is restored automatically if the install fails.
//
// The logic itself lives in unirend and upgrades with it; this wrapper is the
// place to customize (e.g. pass options to refreshLockfile()).

try {
  const result = await refreshLockfile({
    // Anchor to the repo root (this file lives in scripts/) so running the
    // file directly from a subfolder behaves the same as \`bun run
    // install:fresh\`, which always runs from the package.json's directory.
    rootDir: join(import.meta.dirname, '..'),
  });

  if (!result.success) {
    process.exit(1);
  }
} catch (error) {
  console.error('Failed to refresh the lockfile:', error);
  process.exit(1);
}
`;

/**
 * Ensure `scripts/refresh-lockfile.ts` exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites. Written for
 * every repo, so it lives with the base-file ensures and a second scaffold run
 * is a no-op.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureRefreshLockfile(
  root: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = 'scripts/refresh-lockfile.ts';

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

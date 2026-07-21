import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Source for the repo-level `scripts/check-null-bytes.ts`.
 *
 * Thin wrapper over `checkNullBytes()` from `unirend/repo-tools` (see
 * `src/lib/repo-tools/check-null-bytes.ts` for the actual scan): the function
 * acts as the main and prints its own report, the wrapper turns the result
 * into an exit code. Written create-if-missing and registered in
 * `base-files/package-json.ts` (its own script entry plus the `check` chain).
 */
const fileSrc = `import { join } from 'path';
import { checkNullBytes } from 'unirend/repo-tools';

// Fails when a file that should be plain text contains a NUL (0x00) byte.
// Runs from the project root (invoked via check:null-bytes, chained into
// \`bun run check\`).
//
// Why this exists: a stray NUL in source is invisible in virtually every
// editor and slips past Prettier, ESLint, and spellcheck without complaint.
// What it does break is the tooling you reach for when something goes wrong.
// Git treats the whole file as binary and stops showing diffs for it, so no
// one can review a change to it again, and grep silently finds nothing in it,
// so a pattern
// that is definitely there simply does not match and any search-based audit
// of that file quietly comes back clean.
//
// If you want a NUL as a value (it makes a good separator), that is fine —
// write the escape in source rather than embedding the raw byte.
//
// The scan itself lives in unirend and upgrades with it; this wrapper is the
// place to customize (e.g. pass extraExtensions for a project-specific text
// format, extraFileNames for an extensionless text file, or skipDirectories
// for generated output).

try {
  const result = await checkNullBytes({
    // Anchor to the repo root (this file lives in scripts/) so running the
    // file directly from a subfolder behaves the same as \`bun run
    // check:null-bytes\`, which always runs from the package.json's directory.
    rootDir: join(import.meta.dirname, '..'),
  });

  if (!result.success) {
    process.exit(1);
  }
} catch (error) {
  console.error('Failed to run null-byte check:', error);
  process.exit(1);
}
`;

/**
 * Ensure `scripts/check-null-bytes.ts` exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureCheckNullBytes(
  root: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = 'scripts/check-null-bytes.ts';

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

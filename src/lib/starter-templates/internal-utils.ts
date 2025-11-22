import { FileRoot, vfsListDir } from './vfs';

/**
 * Check if a directory is empty or "empty-ish" (safe to initialize as a new unirend repo).
 *
 * A directory is considered empty-ish if it:
 * - Is completely empty
 * - Has only .git and/or .gitignore (empty git repo, not yet in use)
 *
 * A directory is NOT empty-ish if it:
 * - Contains other files/folders (suggests it's already in use)
 *
 * @param dirPath - Directory to check
 * @returns Object with safe status and optional error message
 */
export async function isRepoDirEmptyish(
  dirPath: FileRoot,
): Promise<{ safe: boolean; reason?: string }> {
  // List directory contents
  const entries = await vfsListDir(dirPath);

  // Empty directory is safe
  if (entries.length === 0) {
    return { safe: true };
  }

  // Filter out .git and .gitignore (these are OK for an "empty" repo)
  // as somebody might have ran `git init` but not added any files yet
  const nonGitEntries = entries.filter(
    (entry) => entry !== '.git' && entry !== '.gitignore',
  );

  // If only .git/.gitignore exist (or directory is empty), it's safe
  if (nonGitEntries.length === 0) {
    return { safe: true };
  }

  // If other files/folders exist, it's unsafe (directory in use)
  return {
    safe: false,
    reason: `Directory is not empty and not a unirend repository. Found: ${nonGitEntries.slice(0, 5).join(', ')}${nonGitEntries.length > 5 ? '...' : ''}`,
  };
}

/**
 * Check if a directory is completely empty, optionally excluding specific files.
 *
 * @param root - Root directory
 * @param relPath - Relative path to check (default: '')
 * @param excludes - Array of filenames to ignore (e.g. ['.gitkeep'])
 * @returns true if directory is empty (after filtering excludes), false otherwise
 */
export async function isDirEmpty(
  root: FileRoot,
  relPath = '',
  excludes: string[] = [],
): Promise<boolean> {
  const entries = await vfsListDir(root, relPath, excludes);
  return entries.length === 0;
}

import { vfsListDir } from './vfs';
import type { FileRoot } from './vfs';

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

function normalizeEntry(entry: string): string {
  return entry.trim();
}

function findTemplateSectionInsertIndex(
  lines: string[],
  sectionHeader: string,
): number | undefined {
  const headerIndex = lines.findIndex((line) => line.trim() === sectionHeader);

  if (headerIndex === -1) {
    return undefined;
  }

  let insertIndex = lines.length;

  // Treat a section as ending at the next comment header. Most generated
  // .gitignore/.prettierignore sections are separated by a blank line, but existing
  // user files may put headers directly adjacent, so handle both shapes.
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const currentLine = lines[index]?.trim() ?? '';
    const nextLine = lines[index + 1]?.trim() ?? '';

    if (currentLine.startsWith('#') && currentLine !== sectionHeader) {
      insertIndex = index;
      break;
    }

    if (
      currentLine === '' &&
      nextLine.startsWith('#') &&
      nextLine !== sectionHeader
    ) {
      insertIndex = index;
      break;
    }
  }

  return insertIndex;
}

/**
 * Appends missing entries to an ignore file string under a specific section header.
 * Reuses existing section header and avoids duplicates.
 */
export function appendMissingIgnoreEntries(
  existing: string,
  sectionHeader: string,
  entries: string[],
): string {
  // Normalize caller-provided entries so whitespace-only differences do not
  // create duplicate ignore patterns.
  const normalizedEntries = entries.map(normalizeEntry).filter(Boolean);

  if (normalizedEntries.length === 0) {
    return existing;
  }

  // Dedup against the whole file, not only this template section. If a user
  // already ignores the path somewhere else, leave their grouping untouched.
  const existingEntries = new Set(
    existing.split(/\r?\n/).map(normalizeEntry).filter(Boolean),
  );

  const missingEntries = normalizedEntries.filter(
    (entry) => !existingEntries.has(entry),
  );

  if (missingEntries.length === 0) {
    return existing;
  }

  // Work with a trimmed line list for insertion. This removes trailing blank
  // lines so new entries land in the section body instead of after file-end
  // whitespace, then split on either Unix or Windows line endings.
  const lines = existing.replace(/\s*$/, '').split(/\r?\n/);
  const insertIndex = findTemplateSectionInsertIndex(lines, sectionHeader);

  // Reuse the existing section when present, rather than creating another
  // section with the same header at the end of the file.
  if (insertIndex !== undefined) {
    lines.splice(insertIndex, 0, ...missingEntries);

    // If inserting directly before the next section header, keep sections
    // visually separated even when the original file omitted the blank line.
    if (lines[insertIndex + missingEntries.length]?.trim().startsWith('#')) {
      lines.splice(insertIndex + missingEntries.length, 0, '');
    }

    return lines.join('\n');
  }

  const trimmedEnd = existing.replace(/\s*$/, '');
  const prefix = trimmedEnd.length > 0 ? `${trimmedEnd}\n\n` : '';

  return `${prefix}${sectionHeader}\n${missingEntries.join('\n')}`;
}

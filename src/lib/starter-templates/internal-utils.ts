import { vfsListDir } from './vfs';
import type { FileRoot } from './vfs';

/**
 * Derive an app-scoped environment variable name from a project name and suffix.
 * Project names are validated as kebab-case, so hyphens map to env-var
 * underscores.
 */
export function buildAppEnvVarName(appName: string, suffix: string): string {
  return `${appName.toUpperCase().replace(/-/g, '_')}_${suffix}`;
}

/**
 * Non-content entries that never count toward a directory being "non-empty".
 * These are OS/cloud junk files plus git and config files that are fine to find
 * in an otherwise-fresh repo. Matched case-insensitively against the lowercased
 * entry name.
 */
const IGNORED_ENTRY_NAMES = new Set([
  // Git (someone may have run `git init` but not added any files yet)
  '.git',
  '.gitignore',
  '.gitattributes',
  '.gitkeep',
  // macOS
  '.ds_store',
  '.appledouble',
  '.lsoverride',
  '.spotlight-v100',
  '.trashes',
  '.fseventsd',
  'icon\r',
  // Windows
  'thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  // Linux
  '.directory',
  // Cloud
  '.dropbox',
  '.dropbox.attr',
]);

/**
 * Glob-style junk patterns, tested against the lowercased entry name.
 */
const IGNORED_ENTRY_PATTERNS: RegExp[] = [
  /^\._.*$/, // macOS AppleDouble resource forks (._*)
  /^\.trash-.*$/, // Linux trash dirs (.Trash-*)
];

// Real content files that shouldn't block init, but are worth surfacing so the
// user knows they were found and left untouched. Matched case-insensitively.
// These predicates are also the source of truth for the base-file writers
// (`ensureReadmeMD`/`ensureLicense`): they skip when a variant already exists,
// so init never notices "left untouched" and then adds a conflicting duplicate.
const README_ENTRY_PATTERN = /^readme\.md$/i;
const LICENSE_ENTRY_PATTERN = /^license(\.md|\.txt)?$/i;

/**
 * Whether a directory entry is an existing README the generator should leave
 * alone (matched case-insensitively, so `readme.md` counts on a case-sensitive
 * filesystem).
 */
export function isReadmeEntry(entry: string): boolean {
  return README_ENTRY_PATTERN.test(entry);
}

/**
 * Whether a directory entry is an existing LICENSE the generator should leave
 * alone: bare `LICENSE`, or `LICENSE.md`/`LICENSE.txt`, matched
 * case-insensitively.
 */
export function isLicenseEntry(entry: string): boolean {
  return LICENSE_ENTRY_PATTERN.test(entry);
}

function isIgnoredEntry(entry: string): boolean {
  const lower = entry.toLowerCase();

  if (IGNORED_ENTRY_NAMES.has(lower)) {
    return true;
  }

  return IGNORED_ENTRY_PATTERNS.some((pattern) => pattern.test(lower));
}

function isNoticeEntry(entry: string): boolean {
  return isReadmeEntry(entry) || isLicenseEntry(entry);
}

/**
 * Check if a directory is empty or "empty-ish" (safe to initialize as a new unirend repo).
 *
 * A directory is considered empty-ish if it:
 * - Is completely empty
 * - Contains only ignorable entries: git/config files (.git, .gitignore,
 *   .gitattributes, .gitkeep) and OS/cloud junk (.DS_Store, Thumbs.db, etc.)
 * - Contains notice-only content (README.md, LICENSE) - these don't block init
 *   but are surfaced via `notices` so the caller can log that they were left
 *   untouched.
 *
 * A directory is NOT empty-ish if it contains any other files/folders (source
 * files, configs, etc.), which suggests it's already in use.
 *
 * @param dirPath - Directory to check
 * @returns Object with safe status, optional error message, and optional
 *   notices (filenames of real content that was found but not blocking).
 */
export async function isRepoDirEmptyish(
  dirPath: FileRoot,
): Promise<{ safe: boolean; reason?: string; notices?: string[] }> {
  // List directory contents
  const entries = await vfsListDir(dirPath);

  // Empty directory is safe
  if (entries.length === 0) {
    return { safe: true };
  }

  // Partition entries: junk/git files are ignored outright, README/LICENSE are
  // surfaced as notices but don't block, and anything else is blocking content.
  const notices: string[] = [];
  const blocking: string[] = [];

  for (const entry of entries) {
    if (isIgnoredEntry(entry)) {
      continue;
    }

    if (isNoticeEntry(entry)) {
      notices.push(entry);
      continue;
    }

    blocking.push(entry);
  }

  // If genuinely unexpected content exists, it's unsafe (directory in use). Only
  // list the offending files, so the message never mentions ignored junk.
  if (blocking.length > 0) {
    return {
      safe: false,
      reason: `Directory is not empty and not a unirend repository. Found: ${blocking.slice(0, 5).join(', ')}${blocking.length > 5 ? '...' : ''}`,
      ...(notices.length > 0 ? { notices } : {}),
    };
  }

  // Only ignorable/notice entries remain, so it's safe to initialize.
  return notices.length > 0 ? { safe: true, notices } : { safe: true };
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

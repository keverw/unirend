import { vfsReadText, vfsWrite } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

// NOTE: Keep this in sync with ensure-prettier-ignore.ts
// Both .gitignore and .prettierignore should have the same patterns
const fileSrc = `# Logs
logs
*.log
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*
lerna-debug.log*

# Dependencies
node_modules

# Package manager lockfiles
# This project uses Bun - ignore npm/yarn/pnpm lockfiles to avoid confusion
package-lock.json
yarn.lock
pnpm-lock.yaml
# Ignore Bun's binary lockfile (bun.lock JSON format is preferred and should be committed)
bun.lockb

# Environment variables
# Keep secrets out of source control! Document required variables in README or create .env.example
*.local
.env
.env.local
.env.*.local

# AI Development Tools
# Claude Code local settings (personal preferences not shared with team)
.claude/**/*.local*

# Build outputs
dist/
build/
coverage/
.nyc_output/
*.tsbuildinfo
.eslintcache

# Editor directories and files
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea
.DS_Store
Thumbs.db
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?

# Temporary files
tmp/`;

const defaultTemplateSectionHeader = '# Template-specific';

export interface EnsureGitignoreOptions {
  /** Optional logger function */
  log?: LoggerFunction;
  /** Header used for template-specific .gitignore entries */
  templateSectionHeader?: string;
  /** Template-specific .gitignore entries to append if missing */
  templateEntries?: string[];
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
  // .gitignore sections are separated by a blank line, but existing user files
  // may put headers directly adjacent, so handle both shapes.
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

function appendMissingEntries(
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

/**
 * Ensure .gitignore exists at the repo root.
 * Creates the file if it doesn't exist, and appends template-specific entries
 * to an existing file when they are missing.
 * @throws {Error} If file creation fails
 */
export async function ensureGitignore(
  repoRoot: FileRoot,
  options?: EnsureGitignoreOptions,
): Promise<void> {
  const templateEntries = options?.templateEntries ?? [];
  const templateSectionHeader =
    options?.templateSectionHeader ?? defaultTemplateSectionHeader;

  try {
    // Read first so the create and update paths are explicit. A missing file is
    // the normal creation path, while other read problems are surfaced.
    const existing = await vfsReadText(repoRoot, '.gitignore');

    if (!existing.ok) {
      if (existing.code !== 'ENOENT') {
        throw new Error(existing.message ?? existing.code);
      }

      // New repos get the standard ignore file plus any template-specific
      // entries in one write.
      const initialSrc = appendMissingEntries(
        fileSrc,
        templateSectionHeader,
        templateEntries,
      );

      await vfsWrite(repoRoot, '.gitignore', initialSrc);

      if (options?.log) {
        options.log('info', 'Created repo root .gitignore');
      }

      return;
    }

    // Existing files do not need to be rewritten unless the template has
    // additional ignore patterns to merge.
    if (templateEntries.length === 0) {
      return;
    }

    // Append only the missing template entries. appendMissingEntries also
    // handles grouping under an existing custom/default section header.
    const updated = appendMissingEntries(
      existing.text,
      templateSectionHeader,
      templateEntries,
    );

    if (updated !== existing.text) {
      await vfsWrite(repoRoot, '.gitignore', updated);

      if (options?.log) {
        options.log(
          'info',
          'Updated repo root .gitignore (added template entries)',
        );
      }
    }
  } catch (error) {
    // Keep callers insulated from the exact VFS/filesystem error shape.
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure .gitignore: ${errorMessage}`);
  }
}

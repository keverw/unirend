import { vfsReadText, vfsWrite } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';
import { appendMissingIgnoreEntries } from '../internal-utils';

// NOTE: Keep this in sync with ensure-gitignore.ts
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

export interface EnsurePrettierIgnoreOptions {
  /** Optional logger function */
  log?: LoggerFunction;
  /** Header used for template-specific .prettierignore entries */
  templateSectionHeader?: string;
  /** Template-specific .prettierignore entries to append if missing */
  templateEntries?: string[];
}

/**
 * Ensure .prettierignore exists at the repo root.
 * Creates the file if it doesn't exist, and appends template-specific entries
 * to an existing file when they are missing.
 * @throws {Error} If file creation fails
 */
export async function ensurePrettierIgnore(
  repoRoot: FileRoot,
  options?: EnsurePrettierIgnoreOptions,
): Promise<void> {
  const templateEntries = options?.templateEntries ?? [];
  const templateSectionHeader =
    options?.templateSectionHeader ?? defaultTemplateSectionHeader;

  try {
    // Read first so the create and update paths are explicit. A missing file is
    // the normal creation path, while other read problems are surfaced.
    const existing = await vfsReadText(repoRoot, '.prettierignore');

    if (!existing.ok) {
      if (existing.code !== 'ENOENT') {
        throw new Error(existing.message ?? existing.code);
      }

      // New repos get the standard ignore file plus any template-specific
      // entries in one write.
      const initialSrc = appendMissingIgnoreEntries(
        fileSrc,
        templateSectionHeader,
        templateEntries,
      );

      await vfsWrite(repoRoot, '.prettierignore', initialSrc);

      if (options?.log) {
        options.log('info', 'Created repo root .prettierignore');
      }

      return;
    }

    // Existing files do not need to be rewritten unless the template has
    // additional ignore patterns to merge.
    if (templateEntries.length === 0) {
      return;
    }

    // Append only the missing template entries. appendMissingIgnoreEntries also
    // handles grouping under an existing custom/default section header.
    const updated = appendMissingIgnoreEntries(
      existing.text,
      templateSectionHeader,
      templateEntries,
    );

    if (updated !== existing.text) {
      await vfsWrite(repoRoot, '.prettierignore', updated);

      if (options?.log) {
        options.log(
          'info',
          'Updated repo root .prettierignore (added template entries)',
        );
      }
    }
  } catch (error) {
    // Keep callers insulated from the exact VFS/filesystem error shape.
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure .prettierignore: ${errorMessage}`);
  }
}

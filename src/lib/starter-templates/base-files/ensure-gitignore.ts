import { vfsWriteIfNotExists, type FileRoot } from '../vfs';
import type { Logger } from '../types';

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

node_modules
*.local

# Environment variables
# Keep secrets out of source control! Document required variables in README or create .env.example
.env
.env.local
.env.*.local

# Build outputs
dist/

# Editor directories and files
.vscode/*
!.vscode/extensions.json
!.vscode/settings.json
.idea
.DS_Store
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?`;

/**
 * Ensure .gitignore exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites.
 * @throws {Error} If file creation fails
 */
export async function ensureGitignore(
  repoRoot: FileRoot,
  log?: Logger,
): Promise<void> {
  try {
    const didWrite = await vfsWriteIfNotExists(repoRoot, '.gitignore', fileSrc);

    if (didWrite && log) {
      log('info', 'Created repo root .gitignore');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure .gitignore: ${errorMessage}`);
  }
}

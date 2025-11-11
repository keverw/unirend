import { vfsWriteIfNotExists, type FileRoot } from '../vfs';
import type { Logger } from '../types';

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
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to ensure .gitignore: ${errorMessage}`);
  }
}

import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { Logger } from '../types';

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

/**
 * Ensure .prettierignore exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites.
 * @throws {Error} If file creation fails
 */
export async function ensurePrettierIgnore(
  repoRoot: FileRoot,
  log?: Logger,
): Promise<void> {
  try {
    const didWrite = await vfsWriteIfNotExists(
      repoRoot,
      '.prettierignore',
      fileSrc,
    );

    if (didWrite && log) {
      log('info', 'Created repo root .prettierignore');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure .prettierignore: ${errorMessage}`);
  }
}

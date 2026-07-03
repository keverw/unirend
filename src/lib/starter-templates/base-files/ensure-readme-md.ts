import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

/**
 * Build the generic workspace README, titled with the repo name.
 */
function buildReadmeSrc(repoName: string): string {
  return `# ${repoName}

A monorepo workspace scaffolded with [unirend](https://github.com/keverw/unirend).

## Structure

- \`src/apps/\` holds deployable apps. Add one with \`unirend create <type> <name>\`.
- \`src/libs/\` holds shared libraries used across apps.
- \`scripts/\` holds repo-wide tooling and maintenance scripts.

## Getting Started

Create a new app in this workspace:

\`\`\`bash
bunx unirend create ssr my-app
\`\`\`

By default this scaffolds the app, installs dependencies, and formats the code. Each app gets its own \`package.json\` scripts prefixed with the app name (for example \`my-app:dev\` and \`my-app:serve:dev\`), which you run from the workspace root.

## License

This workspace is private by default. Its \`package.json\` sets \`"private": true\` and \`"license": "UNLICENSED"\`, so all rights are reserved. See [LICENSE](./LICENSE) before making this repository public or sharing it outside your team.
`;
}

/**
 * Ensure README.md exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites, so a user's own
 * README is always left intact. `hasReadme` is the caller's single scan of the
 * repo root (true when any README variant is already present, e.g. a lowercase
 * `readme.md`), so we never add a duplicate next to the user's own.
 * @throws {Error} If file creation fails
 */
export async function ensureReadmeMD(
  repoRoot: FileRoot,
  repoName: string,
  hasReadme: boolean,
  log?: LoggerFunction,
): Promise<void> {
  if (hasReadme) {
    return;
  }

  try {
    const didWrite = await vfsWriteIfNotExists(
      repoRoot,
      'README.md',
      buildReadmeSrc(repoName),
    );

    if (didWrite && log) {
      log('info', 'Created repo root README.md');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure README.md: ${errorMessage}`);
  }
}

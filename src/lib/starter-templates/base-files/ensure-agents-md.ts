import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

const fileSrc = `# Agent Guidelines

Guidelines and constraints for AI coding agents working in this repository.

## Git Workflow

- **Use Git as Read-Only / Non-Destructive:** Treat Git as read-only by default. Use Git for inspection unless a command is explicitly allowed below.
- **Do Not Modify Repository State:** Do not stage changes, commit changes, discard local changes, reset state, clean files, or switch branches (e.g., do not run \`git add\`, \`git commit\`, \`git checkout\`, \`git reset\`, \`git clean\`, etc.). The human developer is the peer programmer who will review all changes, provide feedback, and handle normal staging, committing, and checkout actions manually.
- **Exception for Renames:** \`git mv\` is allowed for intentional file renames, including case-only renames on case-insensitive filesystems. This command updates Git's index, but is acceptable because it preserves Git's view of the move during refactors.

## Language Style

- **Use American English:** Use American English spelling in code, comments, documentation, tests, and generated text. Keep existing American spellings intact and do not rewrite them to another English locale.
`;

/**
 * Ensure AGENTS.md exists at the repo root.
 * Only creates the file if it doesn't exist - never overwrites.
 * @throws {Error} If file creation fails
 */
export async function ensureAgentsMD(
  repoRoot: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  try {
    const didWrite = await vfsWriteIfNotExists(repoRoot, 'AGENTS.md', fileSrc);

    if (didWrite && log) {
      log('info', 'Created repo root AGENTS.md');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure AGENTS.md: ${errorMessage}`);
  }
}

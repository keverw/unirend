import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

const fileSrc = `# Claude Code Guidelines

This project keeps its agent guidelines in \`AGENTS.md\` so they're shared across tools. As of June 2026, Claude Code does not read \`AGENTS.md\` automatically, so this file pulls it in:

@AGENTS.md
`;

/**
 * Ensure CLAUDE.md exists at the repo root.
 *
 * Claude Code reads CLAUDE.md but not AGENTS.md, so this file bridges the two by
 * importing AGENTS.md (the shared, tool-agnostic guidelines) via Claude Code's
 * `@path` import syntax. Only creates the file if it doesn't exist - never
 * overwrites.
 * @throws {Error} If file creation fails
 */
export async function ensureClaudeMD(
  repoRoot: FileRoot,
  log?: LoggerFunction,
): Promise<void> {
  try {
    const didWrite = await vfsWriteIfNotExists(repoRoot, 'CLAUDE.md', fileSrc);

    if (didWrite && log) {
      log('info', 'Created repo root CLAUDE.md');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure CLAUDE.md: ${errorMessage}`);
  }
}

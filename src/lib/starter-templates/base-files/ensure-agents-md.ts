import { vfsWriteIfNotExists } from '../vfs';
import type { FileRoot } from '../vfs';
import type { LoggerFunction } from '../types';

const fileSrc = `# Agent Guidelines

Guidelines and constraints for AI coding agents working in this repository.

## Git Workflow

- **Use Git as Read-Only / Non-Destructive:** Treat Git as read-only by default. Use Git for inspection unless a command is explicitly allowed below.
- **Do Not Modify Repository State:** Do not stage changes, commit changes, discard local changes, reset state, clean files, or switch branches (e.g., do not run \`git add\`, \`git commit\`, \`git checkout\`, \`git reset\`, \`git clean\`, etc.). The human developer is the peer programmer who will review all changes, provide feedback, and handle normal staging, committing, and checkout actions manually. This default is not absolute. The explicit exceptions below take precedence when they apply, so treat a direct user request to branch, stage, or commit as authorization to run that command.
- **Exception for Renames:** \`git mv\` is allowed for intentional file renames, including case-only renames on case-insensitive filesystems. This command updates Git's index, but is acceptable because it preserves Git's view of the move during refactors.
- **Exception for User-Requested Branching/Committing:** Creating new branches (\`git checkout -b\`, \`git switch -c\`), staging files (\`git add\`), and committing changes (\`git commit\`) are allowed when the user explicitly requests the agent to perform them during the conversation.

## Dependencies

- **Treat overrides as temporary, and not as a first resort:** An \`overrides\` entry exists to route around a specific upstream bug or advisory until the fix reaches you normally. Prefer upgrading the direct dependency that pulls in the bad version, and reach for an override only when that isn't available yet. When you do add one, record why in the commit message that introduces it. \`package.json\` is JSON and cannot carry a comment, so that commit is the only durable place the reason lives, and \`git log -S '"package-name"' -- package.json\` finds it again later. A pin nobody can explain is one nobody will dare remove.
- **Don't regenerate the lockfile on your own:** \`bun run install:fresh\` deletes \`bun.lock\` and resolves from scratch, which picks up every in-range update at once, not just the one you were after. Treat it like the Git commands above and run it only when the user asks. Plain \`bun install\` is fine.
- **Write overrides as a bare package name at the top level:** \`{ "child": "1.2.3" }\` is the only form bun applies, and it applies the pin everywhere in the tree. npm allows two other ways to write a key that bun does not support, and bun rejects neither one, it accepts them and pins nothing. A nested entry (\`{ "parent": { "child": "1.2.3" } }\`) is ignored outright, bun neither scopes it the way npm does nor flattens it. A version selector in the key (\`{ "child@^2": "1.2.3" }\`) is not implemented, so bun reads \`child@^2\` as a package name, which matches nothing. Either one leaves you with no pin at all, so keep the key flat and free of a selector. \`bun run check:overrides\` fails on both, along with overrides whose target left the dependency tree and pins that have fallen below what a dependent declares it needs.

## Source Files

- **Never embed a raw NUL byte in a text file:** It is invisible in virtually every editor, and it makes git treat the file as binary (no more diffs) and grep silently find nothing in it, so the file drops out of reviews and searches with no error anywhere. If you need a NUL as a value, write the escape in source instead of the raw byte. \`bun run check:null-bytes\` fails on it.

## Language Style

- **Use American English:** Use American English spelling in code, comments, documentation, tests, and generated text. Keep existing American spellings intact and do not rewrite them to another English locale.

## Markdown & Prose Style

- **Don't hard-wrap prose:** Prettier is set to \`proseWrap: 'never'\`, so write each paragraph as a single line and let the editor soft-wrap it. Don't add manual line breaks inside a paragraph.
- **Avoid em dashes and semicolons in prose:** Don't use \`—\` or \`;\` in normal text. Write with commas, periods, or a cleaner sentence split so it reads naturally. When editing text that already has them, rewrite the sentence rather than swapping the character for a space. This does not apply to code fences, inline code, tables where the punctuation is literal content, URLs, or identifiers.
- **Use title case for subheadings:** Apply APA-style title case, except for filenames, variable/function/method names, and product/brand names.
- **Write GitHub alerts as a guarded two-line block:** Put the \`[!TYPE]\` marker alone on the first blockquote line, the body on the following \`>\` line, and a \`<!-- prettier-ignore -->\` comment directly above so \`proseWrap: 'never'\` doesn't collapse the marker into the body:

  \`\`\`markdown
  <!-- prettier-ignore -->
  > [!IMPORTANT]
  > Body text goes here on its own blockquote line.
  \`\`\`
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

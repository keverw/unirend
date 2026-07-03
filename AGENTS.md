# Agent Guidelines

Guidelines and constraints for AI coding agents working in this repository.

## Git Workflow

- **Use Git as Read-Only / Non-Destructive:** Treat Git as read-only by default. Use Git for inspection unless a command is explicitly allowed below.
- **Do Not Modify Repository State:** Do not stage changes, commit changes, discard local changes, reset state, clean files, or switch branches (e.g., do not run `git add`, `git commit`, `git checkout`, `git reset`, `git clean`, etc.). The human developer is the peer programmer who will review all changes, provide feedback, and handle normal staging, committing, and checkout actions manually. This default is not absolute. The explicit exceptions below take precedence when they apply, so treat a direct user request to branch, stage, or commit as authorization to run that command.
- **Exception for Renames:** `git mv` is allowed for intentional file renames, including case-only renames on case-insensitive filesystems. This command updates Git's index, but is acceptable because it preserves Git's view of the move during refactors.
- **Exception for User-Requested Branching/Committing:** Creating new branches (`git checkout -b`, `git switch -c`), staging files (`git add`), and committing changes (`git commit`) are allowed when the user explicitly requests the agent to perform them during the conversation.

## Changelog

- **Order:** `changelog.md` runs oldest to newest, so the newest entries go at the bottom of the file.
- **Log changes as you make them:** When a change is user-facing (features, fixes, behavior changes, dependency or platform changes), add a bullet to `changelog.md` under a `## Unreleased` section at the bottom as part of the same change, so changelog entries aren't deferred to release time. If there is no `## Unreleased` section yet, create one at the bottom, below the most recent released version.
- **Flag breaking changes:** If a change is breaking, call it out at the top of `## Unreleased` (e.g. a `**Breaking:**` note) so the human remembers to bump the version appropriately at release — version bumps are manual and not done by agents.
- **On release (human, not agents — reminder):** Rename `## Unreleased` to the new version with a date (e.g. `## 0.2.0 (Month D, YYYY)`) and bump the version in `package.json` — the build's `sync-version` and `update-docs` scripts then propagate it to `src/version.ts`, the README title, and the TOCs. Don't leave an empty `## Unreleased` behind; it's recreated on demand at the bottom when the next change lands.

## Language Style

- **Use American English:** Use American English spelling in code, comments, documentation, tests, and generated text. Keep existing American spellings intact and do not rewrite them to another English locale.

## Markdown & Prose Style

- **Don't hard-wrap prose:** Prettier is set to `proseWrap: 'never'`, so write each paragraph as a single line and let the editor soft-wrap it. Don't add manual line breaks inside a paragraph.
- **Avoid em dashes and semicolons in prose:** Don't use `—` or `;` in normal text. Write with commas, periods, or a cleaner sentence split so it reads naturally. When editing text that already has them, rewrite the sentence rather than swapping the character for a space. This does not apply to code fences, inline code, tables where the punctuation is literal content, URLs, or identifiers.
- **Use title case for subheadings:** Apply APA-style title case, except for filenames, variable/function/method names, and product/brand names.
- **Write GitHub alerts as a guarded two-line block:** Put the `[!TYPE]` marker alone on the first blockquote line, the body on the following `>` line, and a `<!-- prettier-ignore -->` comment directly above so `proseWrap: 'never'` doesn't collapse the marker into the body:

  ```markdown
  <!-- prettier-ignore -->
  > [!IMPORTANT]
  > Body text goes here on its own blockquote line.
  ```

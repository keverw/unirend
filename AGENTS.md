# Agent Guidelines

Guidelines and constraints for AI coding agents working in this repository.

## Git Workflow

- **Use Git as Read-Only / Non-Destructive:** Treat Git as read-only by default. Use Git for inspection unless a command is explicitly allowed below.
- **Do Not Modify Repository State:** Do not stage changes, commit changes, discard local changes, reset state, clean files, or switch branches (e.g., do not run `git add`, `git commit`, `git checkout`, `git reset`, `git clean`, etc.). The human developer is the peer programmer who will review all changes, provide feedback, and handle normal staging, committing, and checkout actions manually.
- **Exception for Renames:** `git mv` is allowed for intentional file renames, including case-only renames on case-insensitive filesystems. This command updates Git's index, but is acceptable because it preserves Git's view of the move during refactors.

## Changelog

- **Order:** `changelog.md` runs oldest to newest, so the newest entries go at the bottom of the file.
- **Log changes as you make them:** When a change is user-facing (features, fixes, behavior changes, dependency or platform changes), add a bullet to `changelog.md` under a `## Unreleased` section at the bottom as part of the same change, so changelog entries aren't deferred to release time. If there is no `## Unreleased` section yet, create one at the bottom, below the most recent released version.
- **Flag breaking changes:** If a change is breaking, call it out at the top of `## Unreleased` (e.g. a `**Breaking:**` note) so the human remembers to bump the version appropriately at release — version bumps are manual and not done by agents.
- **On release (human, not agents — reminder):** Rename `## Unreleased` to the new version with a date (e.g. `## 0.2.0 (Month D, YYYY)`) and bump the version in `package.json` — the build's `sync-version` and `update-docs` scripts then propagate it to `src/version.ts`, the README title, and the TOCs. Don't leave an empty `## Unreleased` behind; it's recreated on demand at the bottom when the next change lands.

## Language Style

- **Use American English:** Use American English spelling in code, comments, documentation, tests, and generated text. Keep existing American spellings intact and do not rewrite them to another English locale.

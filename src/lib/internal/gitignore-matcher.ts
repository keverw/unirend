import { promises as fs } from 'fs';
import path from 'path';
import ignore from 'ignore';
import type { Ignore } from 'ignore';

/**
 * Git-compatible ignore matching, evaluated in memory.
 *
 * Shared by the repo tools that walk the tree and need to know which files a
 * repo considers generated (`checkNullBytes`, `cleanCspell`). Matching happens
 * through the `ignore` package rather than by shelling out to git, so it costs
 * no subprocess and works the same in a checkout that is not a repo at all.
 *
 * Usage is a walk: create a matcher, call {@link addIgnoreRules} for the root
 * and again for each directory as the walk reaches it, and test entries with
 * {@link isIgnored}. Adding scopes parent-first is what makes nested files
 * resolve the way git resolves them.
 */

/**
 * One ordered ignore source, scoped to the literal directory that contains it.
 * Keeping the base separate from the glob patterns matters for directories
 * such as Next.js's `[slug]`: interpolating that path into a pattern turns the
 * brackets into range syntax and makes the rule apply to the wrong paths.
 */
interface IgnoreScope {
  base: string;
  matcher: Ignore;
}

/** Ordered collection of repository-local ignore sources. */
export interface GitignoreMatcher {
  scopes: IgnoreScope[];
}

/**
 * Locate `info/exclude` for the repo checked out at `dir`.
 *
 * Usually this is just `<dir>/.git/info/exclude`, but `.git` is a *file* rather
 * than a directory in a linked worktree (`git worktree add`) and in a submodule,
 * holding a `gitdir:` line that points elsewhere. Following it matters because
 * the naive path simply does not exist in a worktree, so every locally excluded
 * file would be treated as scannable there.
 *
 * Where it points differs between the two cases, which is what `commondir`
 * settles. A worktree's own git dir holds only per-worktree state (HEAD, index)
 * and has no `info/`, with the shared one named by `commondir`. A submodule has
 * no `commondir` at all, and its git dir is the whole thing.
 *
 * Verified against git 2.51: with an entry in the common `info/exclude`, git
 * reports a file in the linked worktree as ignored, while the same entry placed
 * in the worktree's own git dir is not honored at all. So the common directory
 * is the only one worth reading.
 *
 * Returns null when there is no git dir to speak of, which is the normal case
 * for a plain directory that was never a repo.
 */
async function resolveGitInfoExclude(dir: string): Promise<string | null> {
  const dotGit = path.join(dir, '.git');
  let gitDir: string;

  try {
    if ((await fs.stat(dotGit)).isDirectory()) {
      gitDir = dotGit;
    } else {
      const pointer = await fs.readFile(dotGit, 'utf8');
      const match = /^gitdir:\s*(.+?)\s*$/m.exec(pointer);

      if (match === null) {
        return null;
      }

      // The recorded path may be relative, and is relative to the checkout.
      gitDir = path.resolve(dir, match[1]);
    }
  } catch {
    return null;
  }

  try {
    const commonDir = await fs.readFile(path.join(gitDir, 'commondir'), 'utf8');

    // Relative to the worktree's git dir, and typically just "../..".
    return path.join(path.resolve(gitDir, commonDir.trim()), 'info', 'exclude');
  } catch {
    // No commondir, so this git dir is the common one (a plain repo, or a
    // submodule).
    return path.join(gitDir, 'info', 'exclude');
  }
}

/** A fresh matcher holding no ignore sources yet. */
export function createIgnoreMatcher(): GitignoreMatcher {
  return { scopes: [] };
}

/** Options controlling which ignore sources are loaded. */
export interface AddIgnoreRulesOptions {
  /**
   * Include the repository-local `info/exclude` file at the root. Defaults to
   * true, matching git. Set this to false for tools such as CSpell whose
   * `useGitignore` option deliberately reads only `.gitignore` files.
   */
  includeInfoExclude?: boolean;
}

/**
 * Read the ignore rules that apply at `dir`, if any.
 *
 * `relativeBase` is `dir` measured from the repo root, using forward slashes,
 * and is `''` for the root itself. At the root this also folds in
 * `info/exclude`, the per-clone list of rules kept out of version control. Both
 * files are optional and a missing one simply contributes nothing.
 *
 * Not covered: the global `core.excludesFile`, which lives in the user's git
 * config rather than the repo. Reading it would mean parsing git config or
 * shelling out to git, and rules kept in a personal config are the wrong thing
 * to let decide whether a shared check reads a file: the same commit would
 * pass on one machine and fail on another.
 */
export async function addIgnoreRules(
  matcher: GitignoreMatcher,
  dir: string,
  relativeBase: string,
  options?: AddIgnoreRulesOptions,
): Promise<void> {
  // Git never reads a nested .gitignore through an excluded parent directory,
  // and a negation inside that directory cannot re-include its contents. Most
  // callers already avoid reaching this point because their tree walk skips
  // the directory, but enforce the rule here too so manually assembled walks
  // cannot add a scope that would incorrectly override its excluded parent.
  if (relativeBase !== '' && isIgnored(matcher, relativeBase, true)) {
    return;
  }

  // Order matters, because the last matching pattern decides. Git ranks a
  // repository's `.gitignore` ABOVE `.git/info/exclude`, so the exclude file
  // goes in first and `.gitignore` gets the final say (verified: with
  // `fixture.ts` in info/exclude and `!fixture.ts` in .gitignore, git reports
  // the file as not ignored). Nested `.gitignore` files are added later still,
  // as the walk reaches them, which is what makes the deepest one win.
  const infoExclude =
    relativeBase === '' && options?.includeInfoExclude !== false
      ? await resolveGitInfoExclude(dir)
      : null;

  const sources =
    infoExclude === null
      ? [path.join(dir, '.gitignore')]
      : [infoExclude, path.join(dir, '.gitignore')];

  for (const source of sources) {
    let text: string;

    try {
      text = await fs.readFile(source, 'utf8');
    } catch {
      // No such file, the normal case for most directories.
      continue;
    }

    // Keep the base as literal path data rather than interpolating it into the
    // patterns. The ignore package handles comments, blank lines, CRLF, and
    // significant whitespace when given the source text directly.
    matcher.scopes.push({ base: relativeBase, matcher: ignore().add(text) });
  }
}

/**
 * Whether a path is excluded by the rules gathered so far.
 *
 * Directories are tested with a trailing slash so a directory-only rule
 * (`build/`, the common form) matches the directory itself rather than only
 * the paths beneath it.
 */
export function isIgnored(
  matcher: GitignoreMatcher,
  relativePath: string,
  isDirectory: boolean,
): boolean {
  const candidate = isDirectory ? `${relativePath}/` : relativePath;
  let isPathIgnored = false;

  for (const scope of matcher.scopes) {
    let scopedPath: string;

    if (scope.base === '') {
      scopedPath = candidate;
    } else {
      const prefix = `${scope.base}/`;

      if (!candidate.startsWith(prefix)) {
        continue;
      }

      scopedPath = candidate.slice(prefix.length);
    }

    const result = scope.matcher.test(scopedPath);

    if (result.ignored) {
      isPathIgnored = true;
    } else if (result.unignored) {
      isPathIgnored = false;
    }
  }

  return isPathIgnored;
}

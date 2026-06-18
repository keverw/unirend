import { existsSync as nodeExistsSync } from 'fs';
import { dirname, join } from 'path';

// Directory -> nearest tsconfig dir (or null). Memoizing every directory
// visited during a walk means that across a whole lint run, each directory is
// stat-ed at most once: siblings and cousins reuse their ancestors' answers.
// This matters on large monorepos where a single `eslint .` lints thousands of
// files that share a handful of tsconfig boundaries.
const tsconfigDirCache = new Map<string, string | null>();

/**
 * Clear the tsconfig-directory cache.
 *
 * The cache is process-global, which is ideal for a one-shot `eslint` CLI run
 * but means a long-lived language server won't notice a newly added/removed
 * `tsconfig.json` until it's cleared (editors typically restart the ESLint
 * worker on config changes). Exposed mainly for that case and for tests.
 */
export function clearTsconfigDirCache(): void {
  tsconfigDirCache.clear();
}

/**
 * Walk up from `fromDir` and return the first directory that contains a
 * `tsconfig.json`, or `null` if none is found before the filesystem root.
 *
 * This locates the project boundary the same way VSCode's `project-relative`
 * import preference does — the nearest tsconfig to the importing file. Each
 * generated app ships its own `tsconfig.json`, so the boundary lands on the app
 * folder rather than collapsing to the repo root.
 *
 * Results are memoized (see {@link clearTsconfigDirCache}). `existsSync` is
 * injectable so the walk can be unit-tested without touching the real
 * filesystem.
 */
export function findNearestTsconfigDir(
  fromDir: string,
  existsSync: (path: string) => boolean = nodeExistsSync,
): string | null {
  // Every directory we step through on the way up has the *same* nearest
  // tsconfig as wherever the walk ends — none of them held one (that's why we
  // kept climbing). So once we know the answer we cache it for all of them, and
  // a later lookup from any sibling/cousin short-circuits at the first of these
  // it reaches instead of re-stat-ing the whole chain.
  const walked: string[] = [];
  let current = fromDir;

  for (;;) {
    const cached = tsconfigDirCache.get(current);

    if (cached !== undefined) {
      cacheWalked(walked, cached);

      return cached;
    }

    walked.push(current);

    if (existsSync(join(current, 'tsconfig.json'))) {
      cacheWalked(walked, current);

      return current;
    }

    const parent = dirname(current);

    // dirname() of a filesystem root returns the root itself — stop there.
    if (parent === current) {
      cacheWalked(walked, null);

      return null;
    }

    current = parent;
  }
}

// Record every directory the walk stepped through with the resolved answer.
function cacheWalked(dirs: string[], result: string | null): void {
  for (const dir of dirs) {
    tsconfigDirCache.set(dir, result);
  }
}

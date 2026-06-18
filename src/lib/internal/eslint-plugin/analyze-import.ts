import { posix } from 'path';

/**
 * Inputs for {@link analyzeRelativeImport}.
 */
export interface AnalyzeImportOptions {
  /** Absolute path of the file that contains the import. */
  importerFile: string;
  /** The import specifier exactly as written in the source. */
  importSource: string;
  /**
   * Absolute path of the directory that defines the import boundary — the
   * nearest `tsconfig.json` directory to {@link importerFile}. Relative imports
   * that resolve inside this directory are left alone; ones that escape it are
   * candidates for the alias. This mirrors how VSCode's
   * `importModuleSpecifier: "project-relative"` chooses between a relative path
   * and the alias.
   */
  boundaryDir: string;
  /**
   * Directory the alias maps to, as a single path segment (default `"src"`).
   * Matches the `@/*` -> `./src/*` mapping in the generated tsconfig.
   */
  rootDir?: string;
  /** Alias prefix that stands in for {@link rootDir} (default `"@/"`). */
  prefix?: string;
}

/**
 * Result of {@link analyzeRelativeImport}.
 */
export interface AnalyzeImportResult {
  /**
   * True when the import is relative, escapes the boundary, and a matching
   * alias path could be constructed. False for non-relative imports, imports
   * that stay within the boundary, or targets that fall outside `rootDir`
   * (which have no alias form and so are left untouched).
   */
  shouldUseAlias: boolean;
  /** The aliased specifier to swap in, present only when `shouldUseAlias`. */
  aliasedSource?: string;
}

/** Convert any platform path to forward-slash (POSIX) form for comparison. */
function toPosix(value: string): string {
  return value.replaceAll('\\', '/');
}

/** Strip a single trailing slash so prefix comparisons are unambiguous. */
function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * Decide whether a relative import should be rewritten to the `@/` alias.
 *
 * Pure and filesystem-free: callers supply the boundary directory (the nearest
 * tsconfig dir) so this can be unit-tested without touching disk. A relative
 * import is flagged only when it resolves *outside* the boundary directory and
 * the target lives under `rootDir` (so an alias path actually exists). Imports
 * that stay within the boundary — any depth of `./` or `../` inside the same
 * app — are intentionally left relative, matching the editor's
 * `project-relative` behavior.
 */
export function analyzeRelativeImport(
  options: AnalyzeImportOptions,
): AnalyzeImportResult {
  const { importerFile, importSource } = options;
  const rootDir = options.rootDir ?? 'src';
  const prefix = options.prefix ?? '@/';

  // Only relative specifiers are candidates. Bare and already-aliased imports
  // (`@/...`, `react`, `node:fs`, ...) are left untouched.
  if (!importSource.startsWith('.')) {
    return { shouldUseAlias: false };
  }

  const importerDir = posix.dirname(toPosix(importerFile));
  const resolvedTarget = posix.normalize(
    posix.join(importerDir, toPosix(importSource)),
  );
  const boundary = stripTrailingSlash(toPosix(options.boundaryDir));

  // Stays within the boundary directory → relative is fine.
  const isWithinBoundary =
    resolvedTarget === boundary || resolvedTarget.startsWith(`${boundary}/`);

  if (isWithinBoundary) {
    return { shouldUseAlias: false };
  }

  // Escaped the boundary: rebuild the path through the `@/` alias. The alias
  // root (`<workspaceRoot>/<rootDir>`) is an ancestor of both the boundary and
  // the target, so it lives within their deepest common directory. Searching
  // that common ancestor — rather than the full target path — keeps a
  // `rootDir`-named segment in the *checkout* path from being mistaken for the
  // workspace's own (e.g. a project cloned into `~/src/my-app`). The last
  // matching segment wins, so an outer `src/` can't shadow the inner one.
  const commonAncestor = deepestCommonDir(boundary, resolvedTarget);
  const aliasRoot = lastSegmentDir(commonAncestor, rootDir);

  // No `rootDir` segment above the target (e.g. it escaped into a repo-root
  // `scripts/` dir) → no alias form exists, so leave the import alone.
  if (aliasRoot === null) {
    return { shouldUseAlias: false };
  }

  const subPath = resolvedTarget.slice(aliasRoot.length + 1);

  return {
    shouldUseAlias: true,
    aliasedSource: `${prefix}${subPath}`,
  };
}

/** Deepest directory that is an ancestor of both POSIX paths (segment-wise). */
function deepestCommonDir(a: string, b: string): string {
  const aSegments = a.split('/');
  const bSegments = b.split('/');
  const common: string[] = [];

  for (const [index, segment] of aSegments.entries()) {
    if (segment !== bSegments[index]) {
      break;
    }

    common.push(segment);
  }

  return common.join('/');
}

/**
 * Truncate `dir` to its last segment equal to `name` (inclusive), or return
 * null when no such segment exists. Matching the *last* occurrence means an
 * outer checkout-path segment can't shadow the workspace's own `rootDir`.
 */
function lastSegmentDir(dir: string, name: string): string | null {
  const segments = dir.split('/');
  const index = segments.lastIndexOf(name);

  return index === -1 ? null : segments.slice(0, index + 1).join('/');
}

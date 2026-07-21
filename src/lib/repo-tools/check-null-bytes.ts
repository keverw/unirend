import { promises as fs } from 'fs';
import path from 'path';
import type { Ignore } from 'ignore';
import {
  addIgnoreRules,
  createIgnoreMatcher,
  isIgnored,
} from '../internal/gitignore-matcher';

/**
 * Null-byte check for scaffolded repos, exported via `unirend/repo-tools`.
 *
 * Fails when a file that should be plain text contains a NUL (0x00) byte.
 *
 * Why this exists: a stray NUL in source is invisible in virtually every
 * editor, survives copy/paste, and is silently ignored by the usual guards.
 * Prettier formats the file, ESLint lints it, and a spellchecker reads it,
 * none of them complaining. What it does break is the tooling you reach for
 * when something goes wrong:
 *
 * - Git classifies the whole file as binary and stops showing diffs for it,
 *   reporting only "Binary files a/x.ts and b/x.ts differ", so the file
 *   can no longer be reviewed in any diff or code review.
 * - grep finds nothing in it. Not an error, not a warning: a pattern that is
 *   definitely present simply does not match, and the exit code says "no
 *   match". Any search-based audit of that file silently returns clean.
 *
 * Both behaviors are verified. The second is the dangerous one, because it
 * makes a file quietly opt out of exactly the searches used to check it.
 *
 * The check is a plain byte scan over files whose extension or exact name says
 * they are text, so it needs no network and no subprocess, and it is fast
 * enough to sit in the `check` chain.
 *
 * Which files to scan comes from walking the tree and applying the repo's own
 * `.gitignore` rules, matched in memory by the `ignore` package. Your ignore
 * rules already say which files are generated, per path rather than per name,
 * which a list of directory names cannot do: the same name is build output in
 * one part of a repo and tracked fixtures in another.
 *
 * One consequence worth knowing: a file that is force-added to git despite
 * matching an ignore rule (`git add -f`) is NOT scanned, because the rules say
 * it is generated even though git tracks it. Git itself treats tracking as the
 * stronger signal. If such a file needs scanning, add a negation so the rules
 * match reality, which is worth doing regardless since the mismatch is
 * confusing on its own.
 *
 * Note this is about a NUL byte written *literally* into a file. Using one as
 * a value is fine and often deliberate (it makes a good separator, since it
 * cannot occur in most real data) — the fix in that case is to write the
 * escape `\u0000` in source rather than embedding the raw byte.
 *
 * The function acts as a main: it prints its own report through the injectable
 * loggers and returns a result instead of exiting, so the scaffolded
 * `scripts/check-null-bytes.ts` stays a thin wrapper that sets the exit code
 * (and is the place to customize).
 */

/**
 * Extensions treated as text. Deliberately an allowlist rather than a binary
 * denylist: a NUL is only a bug in a file that is supposed to be text, and an
 * allowlist fails safe by staying quiet about file types it does not know
 * instead of flagging some new binary format as broken source.
 */
const DEFAULT_TEXT_EXTENSIONS = [
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'jsonc',
  'md',
  'markdown',
  'css',
  'scss',
  'sass',
  'less',
  'html',
  'htm',
  'xml',
  'svg',
  'yml',
  'yaml',
  'toml',
  'ini',
  'txt',
  'csv',
  'php',
  'sh',
  'bash',
  'zsh',
  'sql',
  'graphql',
  'gql',
  'env',
  'editorconfig',
  'gitignore',
  'gitattributes',
  'prettierignore',
];

/** Common text files whose names do not carry a recognized text extension. */
const DEFAULT_TEXT_FILE_NAMES = [
  'Dockerfile',
  'Containerfile',
  'Makefile',
  'Procfile',
  'LICENSE',
  'NOTICE',
  'COPYING',
  'AUTHORS',
  'CONTRIBUTORS',
  'CODEOWNERS',
  'Gemfile',
  'Rakefile',
  'bun.lock',
  'yarn.lock',
  'Gemfile.lock',
  'Cargo.lock',
  'Pipfile.lock',
  'poetry.lock',
  'uv.lock',
  'composer.lock',
  '.npmrc',
  '.yarnrc',
  '.nvmrc',
  '.node-version',
];

/**
 * Directories skipped by name, on top of whatever `.gitignore` excludes.
 *
 * Deliberately short, and deliberately without `dist` or `build`. Those are
 * the names that collide: `build` is generated output in one part of a repo
 * and tracked fixtures in another, so skipping by name alone hides real source
 * (this repo has both). `.gitignore` already says which one a given directory
 * is, and it says it per path rather than per name, so that is where the
 * decision belongs.
 *
 * What is left is the insurance a rule file cannot provide: a dependency
 * directory is never hand-authored and is enormous, so walking into one is
 * pure cost. Skipping it by name means the scan stays fast even in a project
 * that has no `.gitignore` at all, or one that forgot the usual entries.
 */
const DEFAULT_SKIP_DIRECTORIES = [
  '.git',
  'node_modules',
  'vendor',
  '.next',
  '.turbo',
  '.cache',
];

/** Options for {@link checkNullBytes}. */
export interface CheckNullBytesOptions {
  /** Repo root to scan. Defaults to process.cwd(). */
  rootDir?: string;
  /** Sink for progress output. Defaults to console.log. */
  log?: (message: string) => void;
  /** Sink for the problem report. Defaults to console.error. */
  logError?: (message: string) => void;
  /**
   * Extensions to treat as text, without the leading dot. Replaces the
   * built-in list entirely when given.
   */
  extensions?: string[];
  /**
   * Extra extensions to scan on top of the built-in list. Use this rather
   * than `extensions` to add a project-specific text format without
   * restating the defaults.
   */
  extraExtensions?: string[];
  /**
   * Exact file names to treat as text. Replaces the built-in list of common
   * extensionless files and text lockfiles when given. Matching is
   * case-insensitive.
   */
  fileNames?: string[];
  /** Extra exact file names to scan on top of the built-in list. */
  extraFileNames?: string[];
  /**
   * Directory names to skip anywhere in the tree. Replaces the built-in list
   * entirely when given.
   *
   * Applies on top of `.gitignore`, not instead of it. Reach for it only for
   * directories your ignore rules do not already cover, since a name matches
   * at every depth and cannot tell two directories of the same name apart.
   */
  skipDirectories?: string[];
}

/** Result of {@link checkNullBytes}. */
export interface CheckNullBytesResult {
  /** True when no text file contained a NUL byte. */
  success: boolean;
  /** Repo-relative paths of offending files, with where the first NUL sits. */
  offenders: Array<{
    /** Repo-relative path, using forward slashes. */
    file: string;
    /** 1-based line number of the first NUL byte. */
    line: number;
    /** How many NUL bytes the file contains. */
    count: number;
  }>;
  /** How many files were read. */
  scannedCount: number;
}

/** True when the file's exact name or extension is one we treat as text. */
function isTextFile(
  fileName: string,
  extensions: Set<string>,
  fileNames: Set<string>,
): boolean {
  if (fileNames.has(fileName.toLowerCase())) {
    return true;
  }

  // Dotfiles like .gitignore have no separate extension, so fall back to the
  // name with its leading dot stripped.
  const lastDot = fileName.lastIndexOf('.');
  const ext =
    lastDot > 0
      ? fileName.slice(lastDot + 1).toLowerCase()
      : fileName.replace(/^\./, '').toLowerCase();

  return extensions.has(ext);
}

/**
 * Recursively collect text files under dir, skipping anything git would.
 *
 * Accumulates into `found` rather than returning and concatenating arrays,
 * which keeps one array alive across the whole walk instead of allocating a
 * new one per directory. Symlinks are not followed: readdir reports a symlink
 * as neither file nor directory, so a link is skipped, which is what we want
 * here since its target is either outside the tree or already visited on its
 * own path.
 *
 * An ignored directory is not descended into, matching git, which cannot
 * re-include a path whose parent directory is excluded. That is why a
 * negation meant to rescue tracked files inside an ignored directory has to
 * re-include the directory itself before its contents.
 */
async function collectTextFiles(
  dir: string,
  relativeDir: string,
  extensions: Set<string>,
  fileNames: Set<string>,
  skipDirectories: Set<string>,
  matcher: Ignore,
  found: string[],
): Promise<void> {
  let entries;

  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // An unreadable directory is not a null-byte problem, so skip it rather
    // than failing a check that is about file contents.
    return;
  }

  // Directories first, so a nested .gitignore is read before anything it
  // governs is tested. Sibling directories cannot interfere with each other
  // even though they share one matcher, because rebasing anchors every nested
  // pattern to the directory it came from.
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const relativePath =
      relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;

    if (
      skipDirectories.has(entry.name) ||
      isIgnored(matcher, relativePath, true)
    ) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    await addIgnoreRules(matcher, fullPath, relativePath);

    await collectTextFiles(
      fullPath,
      relativePath,
      extensions,
      fileNames,
      skipDirectories,
      matcher,
      found,
    );
  }

  for (const entry of entries) {
    if (!entry.isFile() || !isTextFile(entry.name, extensions, fileNames)) {
      continue;
    }

    const relativePath =
      relativeDir === '' ? entry.name : `${relativeDir}/${entry.name}`;

    if (!isIgnored(matcher, relativePath, false)) {
      found.push(path.join(dir, entry.name));
    }
  }
}

/**
 * Scan the repo for NUL bytes in text files. Prints its report through the
 * injected loggers and returns the outcome instead of exiting — the caller
 * decides the exit code.
 */
export async function checkNullBytes(
  options?: CheckNullBytesOptions,
): Promise<CheckNullBytesResult> {
  const rootDir = options?.rootDir ?? process.cwd();
  // eslint-disable-next-line no-console
  const log = options?.log ?? console.log;
  // eslint-disable-next-line no-console
  const logError = options?.logError ?? console.error;

  // Normalize caller-supplied extensions so both '.ts' and 'ts' work, and so
  // matching is case-insensitive (a file named README.MD is still Markdown).
  // extraExtensions is concatenated AFTER the base list, which means it
  // extends whichever list is in play: the defaults normally, or a custom
  // `extensions` when one was given.
  const extensions = new Set(
    (options?.extensions ?? DEFAULT_TEXT_EXTENSIONS)
      .concat(options?.extraExtensions ?? [])
      .map((ext) => ext.replace(/^\./, '').toLowerCase()),
  );

  const fileNames = new Set(
    (options?.fileNames ?? DEFAULT_TEXT_FILE_NAMES)
      .concat(options?.extraFileNames ?? [])
      .map((fileName) => fileName.toLowerCase()),
  );

  const skipDirectories = new Set(
    options?.skipDirectories ?? DEFAULT_SKIP_DIRECTORIES,
  );

  // One matcher for the whole walk. Nested .gitignore rules are added to it as
  // the walk reaches them, rebased so they still mean what they meant in their
  // own directory, which reproduces git's "deepest file wins" by ordering.
  const matcher = createIgnoreMatcher();
  await addIgnoreRules(matcher, rootDir, '');

  const files: string[] = [];
  await collectTextFiles(
    rootDir,
    '',
    extensions,
    fileNames,
    skipDirectories,
    matcher,
    files,
  );

  const offenders: CheckNullBytesResult['offenders'] = [];
  let scannedCount = 0;

  for (const file of files) {
    let buffer: Buffer;

    try {
      // Read the whole file rather than streaming it. These are files the
      // extension list says are text, so they are small enough that the
      // simplicity is worth more than the memory saved, and a NUL can sit
      // anywhere in the file so there is no early exit to gain.
      buffer = await fs.readFile(file);
    } catch {
      // Unreadable (permissions, or deleted between listing and reading).
      // Skipping matches collectTextFiles above: this check is about file
      // contents, so it should not fail a build over a file it cannot open.
      continue;
    }

    // Counted here rather than as files.length, which would overstate it: a
    // collected path can still turn out to be unreadable, whether from
    // permissions or from being deleted between the walk and the read, so the
    // number reported is the files actually scanned.
    scannedCount++;

    const firstIndex = buffer.indexOf(0);

    if (firstIndex === -1) {
      continue;
    }

    // Report a line number so the byte is findable: it is invisible on screen,
    // so "somewhere in this file" would not be actionable. Counting newlines
    // before the first NUL gives the 1-based line it sits on.
    let line = 1;

    for (let index = 0; index < firstIndex; index++) {
      if (buffer[index] === 0x0a) {
        line++;
      }
    }

    // Count every occurrence, not just the first. The number separates the two
    // cases that look identical in a one-line report: a single stray byte
    // (a typo, fix that one spot) versus thousands (the file is genuinely
    // binary and its extension is wrong, or it should be gitignored).
    let count = 0;

    for (const byte of buffer) {
      if (byte === 0) {
        count++;
      }
    }

    offenders.push({
      // Report a repo-relative path with forward slashes, so the same file
      // produces the same line on Windows as on macOS and Linux. CI output and
      // test expectations both depend on that being stable.
      file: path.relative(rootDir, file).split(path.sep).join('/'),
      line,
      count,
    });
  }

  if (offenders.length > 0) {
    // Sort by path so the report is deterministic. Directory listing order is
    // filesystem-dependent, and an unstable ordering makes CI output churn
    // between runs for no reason.
    offenders.sort((a, b) => a.file.localeCompare(b.file));

    logError(
      'null-byte check failed:\n\n' +
        'These text files contain NUL (0x00) bytes, which are invisible in most editors:\n' +
        offenders
          .map(
            ({ file, line, count }) =>
              `  - ${file}:${line}${count > 1 ? ` (${count} occurrences)` : ''}`,
          )
          .join('\n') +
        '\n\n  Git treats a file containing one as binary and stops showing diffs for it, and\n' +
        '  grep silently finds nothing in it, so the file drops out of reviews and searches\n' +
        '  without any error. Remove the byte. If you meant a NUL as a value (it makes a good\n' +
        '  separator), write the escape \\u0000 in source instead of embedding the raw byte.\n',
    );

    return { success: false, offenders, scannedCount };
  }

  log(
    `null-byte check passed (${scannedCount} text ` +
      `${scannedCount === 1 ? 'file' : 'files'} scanned).`,
  );

  return { success: true, offenders: [], scannedCount };
}

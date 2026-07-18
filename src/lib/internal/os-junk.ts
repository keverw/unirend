/**
 * Common operating-system metadata entries that should never be treated as
 * application content. Match file names case-insensitively because macOS and
 * Windows commonly use case-insensitive filesystems.
 */
const OS_JUNK_NAMES = new Set([
  // macOS
  '.ds_store',
  '.appledouble',
  '.lsoverride',
  '.spotlight-v100',
  '.trashes',
  '.fseventsd',
  'icon\r',
  // Windows
  'thumbs.db',
  'ehthumbs.db',
  'desktop.ini',
  // Linux
  '.directory',
]);

const OS_JUNK_BASENAME_PATTERNS: RegExp[] = [
  /^\._.*$/, // macOS AppleDouble resource forks (._*)
  /^\.trash-.*$/, // Linux trash directories (.Trash-*)
];

/**
 * Whether a single filesystem basename is operating-system metadata rather
 * than application content.
 */
export function isOSJunkBasename(basename: string): boolean {
  const lowered = basename.toLowerCase();

  return (
    OS_JUNK_NAMES.has(lowered) ||
    OS_JUNK_BASENAME_PATTERNS.some((pattern) => pattern.test(lowered))
  );
}

// Both path separators, so the segment checks below stay correct wherever the
// path is later resolved. A URL uses '/', but the static server joins the
// matched path with path.join, which treats '\' as a separator on Windows, so
// a request like '/x/.AppleDouble\metadata' would otherwise walk into the junk
// directory unrecognized. Mirrors the traversal guard, which already checks
// both '../' and '..\\'.
const PATH_SEPARATOR = /[/\\]/;

/**
 * Whether any segment of a path is OS metadata, not just its basename. Several
 * recognized names are directories (`.AppleDouble`, `.Spotlight-V100`,
 * `.Trashes`, `.fseventsd`, and the rest), so a path like
 * `/assets/.AppleDouble/metadata` is junk even though its basename
 * (`metadata`) is not, and serving it would expose the contents of an OS
 * metadata directory. Splits on either path separator and ignores empty
 * segments (leading slash, doubled slashes), so it accepts URL paths and
 * mount-relative paths on any platform.
 */
export function isOSJunkPath(urlPath: string): boolean {
  return urlPath
    .split(PATH_SEPARATOR)
    .some((segment) => segment !== '' && isOSJunkBasename(segment));
}

/**
 * The first OS metadata segment in a path, or undefined if none. Used to name
 * the actual offender in guidance: for `/images/.AppleDouble/metadata` the fix
 * is to gitignore `.AppleDouble`, not the file name `metadata` inside it.
 */
export function firstOSJunkSegment(urlPath: string): string | undefined {
  return urlPath
    .split(PATH_SEPARATOR)
    .find((segment) => segment !== '' && isOSJunkBasename(segment));
}

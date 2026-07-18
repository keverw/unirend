import path from 'path';
import fs from 'fs';
import type {
  StaticContentRouterOptions,
  ResponseCompressionOptions,
} from '../types';
import { firstOSJunkSegment } from './os-junk';

/**
 * Helpers for assembling and validating a prod app's static content router
 * config: `publicFiles`/`publicFolders` entry validation, the root-mount
 * guard, the defaults assembly, and the startup existence check.
 *
 * These run at config time (constructor / registerBuiltApp) and at listen()
 * time so misconfiguration fails loudly at boot instead of 404ing silently in
 * production. Kept separate from SSRServer so the rules are directly testable.
 */

/**
 * Validate and normalize `publicFiles` entries.
 *
 * Entries are URL paths as the browser requests them (e.g. `/favicon.svg`);
 * because Vite mirrors `public/` filenames 1:1 into the client build root,
 * they double as paths relative to the client build dir. A missing leading
 * slash is tolerated and normalized.
 *
 * Rejects (throws) entries that could escape the client build dir or can
 * never match a request: non-strings, empty strings, null bytes, backslashes,
 * `..` segments, bare `/`, and trailing slashes (directories are declared via
 * `publicFolders`, not here).
 *
 * Also rejects entries that would expose build internals — the same files the
 * root-mount guard protects: `/index.html` (the raw, un-rendered HTML
 * template, which would shadow SSR at that URL) and anything under `.vite/`
 * (build metadata like the manifest). These are not public files; the
 * `staticContentRouter.singleAssetMap` escape hatch remains for anyone who
 * truly needs to expose them.
 *
 * @param entries - The raw `publicFiles` array from app config
 * @param appLabel - App identifier used in error messages (e.g. `default app`)
 * @returns Normalized entries, each with a leading slash
 */
export function validatePublicFiles(
  entries: string[],
  appLabel: string,
): string[] {
  if (!Array.isArray(entries)) {
    throw new TypeError(
      `Invalid publicFiles for ${appLabel}: expected an array of URL paths`,
    );
  }

  return entries.map((entry) => {
    const normalized = validateCommonPublicEntry(
      entry,
      'publicFiles',
      appLabel,
    );

    if (normalized === '/' || normalized.endsWith('/')) {
      throw new Error(
        `Invalid publicFiles entry for ${appLabel}: ${JSON.stringify(entry)} is a directory path — declare folders via publicFolders instead`,
      );
    }

    // Reserved paths compare case-insensitively — on case-insensitive
    // filesystems '/INDEX.HTML' serves the same protected file.
    const lowered = normalized.toLowerCase();

    if (lowered === '/index.html') {
      throw new Error(
        `Invalid publicFiles entry for ${appLabel}: /index.html is the raw HTML template, not a public file — serving it would bypass SSR. Remove it (SSR already renders every page from it).`,
      );
    }

    // Check every segment, not just the basename: names like .AppleDouble and
    // .Trashes are directories, so '/x/.Trashes/y' is junk too.
    const junkSegment = firstOSJunkSegment(normalized);

    if (junkSegment) {
      throw new Error(
        `Invalid publicFiles entry for ${appLabel}: ${JSON.stringify(entry)} is or is under OS metadata (${junkSegment}), not a public asset. Add "${junkSegment}" to .gitignore so it stays out of the repo, and do not declare it in publicFiles or publicFolders. The static server also refuses to serve these from folder mounts; if you genuinely need to serve a file with this name, use the staticContentRouter.singleAssetMap escape hatch.`,
      );
    }

    // /assets is Vite's generated output dir, served by the default mount
    // with immutable-asset detection. A single-asset entry would shadow the
    // mount and silently lose the immutable header on a hashed bundle.
    if (lowered === '/assets' || lowered.startsWith('/assets/')) {
      throw new Error(
        `Invalid publicFiles entry for ${appLabel}: ${JSON.stringify(entry)} is under /assets, which Vite generates and the default mount already serves (with immutable caching a single-asset entry would lose). Remove it, or use staticContentRouter.singleAssetMap if you truly need a per-file override.`,
      );
    }

    return normalized;
  });
}

/**
 * Validate and normalize `publicFolders` entries.
 *
 * Entries are URL prefixes (e.g. `/.well-known`) that double as subfolder
 * paths under the client build root, since Vite copies `public/` verbatim.
 * A missing leading slash is tolerated and a trailing slash is stripped, so
 * `.well-known`, `/.well-known`, and `/.well-known/` are equivalent.
 *
 * Rejects (throws): non-strings, empty strings, null bytes, backslashes,
 * `.`/`..` segments, bare `/` (the root-mount guard exists for a reason —
 * mount the root and you expose `/index.html` and `.vite/`), anything under
 * `.vite/`, and `/assets` or anything under it (already the default mount,
 * and a nested mount would win on longest-prefix and lose the immutable
 * header). The error points anyone customizing the mount at
 * `folderMap['/assets']` WITH `detectImmutableAssets: true`, so the escape
 * hatch does not read as an invitation to recreate the footgun.
 *
 * @param entries - The raw `publicFolders` array from app config
 * @param appLabel - App identifier used in error messages
 * @returns Normalized entries: leading slash, no trailing slash
 */
export function validatePublicFolders(
  entries: string[],
  appLabel: string,
): string[] {
  if (!Array.isArray(entries)) {
    throw new TypeError(
      `Invalid publicFolders for ${appLabel}: expected an array of URL prefixes`,
    );
  }

  return entries.map((entry) => {
    let normalized = validateCommonPublicEntry(
      entry,
      'publicFolders',
      appLabel,
    );

    // Strip a trailing slash so '/x' and '/x/' are the same declaration.
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    if (normalized === '') {
      throw new Error(
        `Invalid publicFolders entry for ${appLabel}: ${JSON.stringify(entry)} mounts the client build root. ` +
          `This would stat the disk on every page request and expose /index.html and /.vite/manifest.json — declare subfolders or use publicFiles for root-level files.`,
      );
    }

    // Case-insensitive for the same reason as the file checks above. Subpaths
    // are rejected too: folder mounts resolve by longest prefix, so a
    // '/assets/foo' mount would beat the default '/assets' mount for those
    // requests and serve hashed bundles without the immutable header.
    const loweredFolder = normalized.toLowerCase();

    if (loweredFolder === '/assets' || loweredFolder.startsWith('/assets/')) {
      throw new Error(
        `Invalid publicFolders entry for ${appLabel}: ${JSON.stringify(entry)} is under /assets, which is already served by default. ` +
          `If you truly need to customize that mount, configure staticContentRouter.folderMap['/assets'] with detectImmutableAssets: true, so hashed bundles keep their immutable headers.`,
      );
    }

    // A junk-named folder (e.g. '/.Trashes', or any segment like
    // '/x/.AppleDouble') is OS metadata, not a public asset. The static server
    // refuses to serve anything under it anyway, so declaring it is always a
    // mistake — reject it with the same guidance as the file check.
    const junkSegment = firstOSJunkSegment(normalized);

    if (junkSegment) {
      throw new Error(
        `Invalid publicFolders entry for ${appLabel}: ${JSON.stringify(entry)} is or is under OS metadata (${junkSegment}), not a public asset. Add "${junkSegment}" to .gitignore so it stays out of the repo, and do not declare it. The static server refuses to serve anything under these directories.`,
      );
    }

    return normalized;
  });
}

/**
 * Shared validation for `publicFiles`/`publicFolders` entries: type, null
 * bytes, backslashes, `..` segments, URL-unsafe characters (anything a
 * browser would percent-encode, which could never match the raw-URL matcher),
 * and the reserved `.vite` directory.
 * Returns the entry trimmed and with a leading slash.
 */
function validateCommonPublicEntry(
  entry: string,
  optionName: 'publicFiles' | 'publicFolders',
  appLabel: string,
): string {
  if (typeof entry !== 'string' || entry.trim() === '') {
    throw new Error(
      `Invalid ${optionName} entry for ${appLabel}: entries must be non-empty strings (got ${JSON.stringify(entry)})`,
    );
  }

  // Collapse repeated slashes BEFORE any check. StaticContentCache normalizes
  // prefixes the same way, so validation must see what the cache will
  // actually mount — otherwise '//' dodges the root guard (one trailing-slash
  // strip leaves '/') and '/assets//' dodges the reserved-/assets check while
  // normalizing to the same mount as the default.
  const trimmed = entry.trim().replace(/\/+/g, '/');

  if (trimmed.includes('\0')) {
    throw new Error(
      `Invalid ${optionName} entry for ${appLabel}: ${JSON.stringify(trimmed)} contains a null byte`,
    );
  }

  if (trimmed.includes('\\')) {
    throw new Error(
      `Invalid ${optionName} entry for ${appLabel}: ${JSON.stringify(trimmed)} contains a backslash — use forward-slash URL paths`,
    );
  }

  // Reject `..` segments (path traversal out of the client build dir) and
  // `.` segments. A `.` is harmless on disk (path.join collapses it, so the
  // boot existence check would pass) but poisons the URL maps: browsers
  // normalize '/icons/./logo.png' to '/icons/logo.png' before requesting,
  // so the declared key would never match and the asset 404s in production.
  const segments = trimmed.split('/');

  if (segments.includes('..') || segments.includes('.')) {
    throw new Error(
      `Invalid ${optionName} entry for ${appLabel}: ${JSON.stringify(trimmed)} contains a "." or ".." path segment`,
    );
  }

  // Reject characters browsers never send raw in a request path. The static
  // router matches the raw, undecoded URL, so an entry like '/og image.png'
  // would pass every other check (and the boot existence check — the file is
  // on disk) yet never match the browser's '/og%20image.png' request,
  // recreating exactly the silent production 404 these options exist to
  // prevent. Allowed: the RFC 3986 path character set minus '%' (the router
  // does not percent-decode, so an encoded entry cannot match either), plus
  // '[', ']', and '|', which the WHATWG URL path percent-encode set leaves
  // raw — a browser really does request '/icon[1].png' verbatim. '^' is NOT
  // in that group: the serializer turns '/a^b' into '/a%5Eb'.
  const unsafeMatch = /[^A-Za-z0-9\-._~!$&'()*+,;=:@/[\]|]/.exec(trimmed);

  if (unsafeMatch) {
    throw new Error(
      `Invalid ${optionName} entry for ${appLabel}: ${JSON.stringify(trimmed)} contains ${JSON.stringify(unsafeMatch[0])}, which browsers percent-encode in request URLs, so this entry could never match a request. Rename the file in public/ to use URL-safe characters (letters, digits, and -._~).`,
    );
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;

  // Reserved-path checks compare case-insensitively (here and in the
  // callers): on case-insensitive filesystems (macOS, Windows) '/.VITE/...'
  // resolves to the same protected files as '/.vite/...'.
  if (normalized.toLowerCase().split('/').includes('.vite')) {
    throw new Error(
      `Invalid ${optionName} entry for ${appLabel}: ${JSON.stringify(trimmed)} exposes Vite build metadata (the .vite directory) — remove it.`,
    );
  }

  return normalized;
}

/**
 * Normalize a custom `folderMap` prefix the way `StaticContentCache` will
 * mount it: collapse repeated slashes, ensure a leading slash, and strip a
 * trailing one (except for bare `/`). Both the root-mount guard and the
 * shadow check must see the mounted form, not the raw key — otherwise keys
 * like `'//x'` or `'x/'` dodge comparisons against normalized declarations.
 */
function normalizeFolderPrefixKey(prefix: string): string {
  const collapsed = (prefix || '/').replace(/\/+/g, '/');
  const withLead = collapsed.startsWith('/') ? collapsed : `/${collapsed}`;

  return withLead.length > 1 && withLead.endsWith('/')
    ? withLead.slice(0, -1)
    : withLead;
}

/**
 * Resolve a path for identity comparison, following symlinks when the path
 * exists on disk. `path.resolve` alone lets a symlink to a protected
 * directory dodge same-directory checks.
 */
function resolveRealPath(target: string): string {
  try {
    return fs.realpathSync(target);
  } catch {
    // Path doesn't exist (yet) — fall back to lexical resolution so the
    // comparison still normalizes '.' segments and relative paths.
    return path.resolve(target);
  }
}

/**
 * Guard against mounting the client build root as a static folder.
 *
 * A `folderMap` prefix of `'/'` (or a folder whose path resolves to the client
 * build root) would "work" — misses fall through to SSR — but it makes every
 * page request stat the disk and exposes `/index.html` and
 * `/.vite/manifest.json`. It should be an error, not a pattern: root-level
 * files belong in `publicFiles`, subfolders in `publicFolders`.
 *
 * @param folderMap - The custom `staticContentRouter.folderMap`, if any
 * @param clientRootDir - Absolute path of the client build root
 * @param appLabel - App identifier used in error messages
 */
export function assertNoRootFolderMount(
  folderMap: StaticContentRouterOptions['folderMap'],
  clientRootDir: string,
  appLabel: string,
): void {
  if (!folderMap) {
    return;
  }

  for (const [prefix, config] of Object.entries(folderMap)) {
    // Mirror StaticContentCache's prefix normalization so '', '/', and '//'
    // are all caught.
    const normalizedPrefix = normalizeFolderPrefixKey(prefix);

    if (normalizedPrefix === '/') {
      throw new Error(
        `Invalid staticContentRouter for ${appLabel}: folderMap prefix "${prefix}" mounts the root. ` +
          `This would stat the disk on every page request and expose /index.html and /.vite/manifest.json. ` +
          `Declare root-level public/ files with the publicFiles option (and subfolders with publicFolders) instead.`,
      );
    }

    const folderPath = typeof config === 'string' ? config : config.path;

    // Compare real paths so a symlink to the client build root cannot dodge
    // the guard.
    if (resolveRealPath(folderPath) === resolveRealPath(clientRootDir)) {
      throw new Error(
        `Invalid staticContentRouter for ${appLabel}: folderMap prefix "${prefix}" points at the client build root (${clientRootDir}). ` +
          `This would expose /index.html and /.vite/manifest.json. ` +
          `Declare root-level public/ files with the publicFiles option (and subfolders with publicFolders) instead.`,
      );
    }
  }
}

/** Normalized `publicFiles`/`publicFolders` for a prod app. */
export interface NormalizedPublicPaths {
  publicFiles?: string[];
  publicFolders?: string[];
}

/**
 * Build the final static router config for a prod app.
 *
 * A custom `staticContentRouter` that defines maps REPLACES the framework
 * defaults (matching pre-`publicFiles` behavior): the `/assets` mount is only
 * provided when no custom maps are given, and a map-defining config must
 * mount `/assets` itself (with `detectImmutableAssets`) or hashed bundles
 * will not be served.
 *
 * A custom config whose `singleAssetMap` and `folderMap` are both absent (or
 * empty) is tuning-only — cache sizes, TTLs, compression, cache headers. It
 * keeps the default `/assets` mount, since "replace the defaults with
 * nothing" can only be a footgun: there is no way to serve a Vite build
 * without its `/assets` output, and `staticContentRouter: false` already
 * exists for the CDN case.
 *
 * `publicFiles`/`publicFolders` are the exception, because they are
 * explicitly declared: files resolve to exact-match `singleAssetMap` paths
 * and folders to `folderMap` mounts under the client build root, folded into
 * whichever config is in effect. Explicit `singleAssetMap`/`folderMap` keys
 * for the same URL win (the server warns about the shadowed entries at boot —
 * see findShadowedPublicPaths). Folder mounts never get immutable-asset
 * detection: `public/` files are copied verbatim, not fingerprinted.
 *
 * @param customConfig - The app's `staticContentRouter` config, if any (not `false`)
 * @param publicPaths - Normalized `publicFiles`/`publicFolders` entries
 * @param clientRootDir - Absolute path of the client build root
 * @param defaultCompression - Server-wide compression setting used when the
 *   custom config doesn't specify one
 */
export function buildProdStaticRouterConfig(
  customConfig: StaticContentRouterOptions | undefined,
  publicPaths: NormalizedPublicPaths,
  clientRootDir: string,
  defaultCompression: boolean | ResponseCompressionOptions | undefined,
): StaticContentRouterOptions {
  const publicFileMap: Record<string, string> = {};

  for (const urlPath of publicPaths.publicFiles ?? []) {
    // Entries are validated (validatePublicFiles), so joining the URL path's
    // segments under the client root cannot escape it.
    publicFileMap[urlPath] = path.join(clientRootDir, ...urlPath.split('/'));
  }

  const publicFolderMap: Record<string, { path: string }> = {};

  for (const urlPrefix of publicPaths.publicFolders ?? []) {
    publicFolderMap[urlPrefix] = {
      path: path.join(clientRootDir, ...urlPrefix.split('/')),
    };
  }

  // Only a config that actually defines maps replaces the defaults. A
  // tuning-only config (cache sizes, TTLs, headers, compression) falls
  // through to the default branch below, keeping the /assets mount.
  const hasCustomMaps =
    customConfig !== undefined &&
    (Object.keys(customConfig.singleAssetMap ?? {}).length > 0 ||
      Object.keys(customConfig.folderMap ?? {}).length > 0);

  if (customConfig && hasCustomMaps) {
    return {
      ...customConfig,
      singleAssetMap: {
        ...publicFileMap,
        ...customConfig.singleAssetMap,
      },
      folderMap: {
        ...publicFolderMap,
        ...customConfig.folderMap,
      },
      compression: customConfig.compression ?? defaultCompression,
    };
  }

  return {
    // Spread tuning fields from a map-less custom config (no-op when there
    // is no custom config at all); the maps below overwrite its empty ones.
    ...customConfig,
    folderMap: {
      '/assets': {
        path: path.join(clientRootDir, 'assets'),
        detectImmutableAssets: true,
      },
      ...publicFolderMap,
    },
    singleAssetMap: publicFileMap,
    compression: customConfig?.compression ?? defaultCompression,
  };
}

/**
 * Run all config-time static router checks for a prod app in one place:
 * the `publicFiles`/`publicFolders` × `staticContentRouter: false` conflict,
 * the root-mount guard, and entry validation for both options.
 *
 * Called from the SSRServer constructor and registerBuiltApp() so a bad
 * config throws where it was written, not later at listen().
 *
 * @param appLabel - App identifier used in error messages
 * @param buildDir - The app's build directory
 * @param clientFolderName - Client folder name within the build directory
 * @param staticContentRouter - The app's raw `staticContentRouter` option
 * @param publicFiles - The app's raw `publicFiles` option
 * @param publicFolders - The app's raw `publicFolders` option
 * @returns Normalized `publicFiles`/`publicFolders` entries
 */
export function validateProdAppStaticConfig(
  appLabel: string,
  buildDir: string,
  clientFolderName: string,
  staticContentRouter: StaticContentRouterOptions | false | undefined,
  publicFiles: string[] | undefined,
  publicFolders: string[] | undefined,
): NormalizedPublicPaths {
  if (
    staticContentRouter === false &&
    ((publicFiles && publicFiles.length > 0) ||
      (publicFolders && publicFolders.length > 0))
  ) {
    throw new Error(
      `Invalid config for ${appLabel}: publicFiles/publicFolders require the static content router, but staticContentRouter is false. ` +
        `Remove them (e.g. when a CDN serves these files) or re-enable the router.`,
    );
  }

  if (staticContentRouter) {
    assertNoRootFolderMount(
      staticContentRouter.folderMap,
      path.join(buildDir, clientFolderName),
      appLabel,
    );
  }

  return {
    publicFiles: publicFiles
      ? validatePublicFiles(publicFiles, appLabel)
      : undefined,
    publicFolders: publicFolders
      ? validatePublicFolders(publicFolders, appLabel)
      : undefined,
  };
}

/**
 * Find `publicFiles`/`publicFolders` entries shadowed by explicit
 * `singleAssetMap` keys / `folderMap` prefixes in a custom
 * `staticContentRouter`.
 *
 * Shadowing is allowed (explicit entries win by design), but declaring the
 * same URL in both places is usually a mistake — the public declaration is
 * silently discarded — so the server logs a warning listing these at boot.
 *
 * The exception is a `folderMap` entry that points at the same directory the
 * `publicFolders` mount would have used AND sets `detectImmutableAssets:
 * true`. That is the intentional pattern for enabling detection on a
 * `public/` subfolder (which `publicFolders` deliberately never does) while
 * keeping the folder declared for the `check:public-assets` drift script, so
 * it is not reported. A same-directory entry that changes nothing still
 * warns, since it is duplication with no effect.
 *
 * @param customConfig - The app's custom `staticContentRouter` config, if any
 * @param publicPaths - Normalized `publicFiles`/`publicFolders` entries
 * @param clientRootDir - Absolute path of the client build root, used to
 *   resolve where each `publicFolders` mount would point
 * @returns The shadowed entries (files then folders), in declaration order
 */
export function findShadowedPublicPaths(
  customConfig: StaticContentRouterOptions | undefined,
  publicPaths: NormalizedPublicPaths,
  clientRootDir: string,
): string[] {
  if (!customConfig) {
    return [];
  }

  const shadowed: string[] = [];

  if (customConfig.singleAssetMap && publicPaths.publicFiles) {
    // Mirror StaticContentCache's key normalization (ensure leading slash) so
    // a custom key given without one still counts as a shadow.
    const customKeys = new Set(
      Object.keys(customConfig.singleAssetMap).map((key) =>
        key.startsWith('/') ? key : `/${key}`,
      ),
    );

    shadowed.push(
      ...publicPaths.publicFiles.filter((entry) => customKeys.has(entry)),
    );
  }

  if (customConfig.folderMap && publicPaths.publicFolders) {
    // Index the custom folderMap by normalized prefix (collapsed slashes,
    // leading slash, no trailing slash, so '/x', 'x', '/x/', and '//x' all
    // count as the same mount — the cache collapses repeated slashes too),
    // keeping the full config value for the intent check below.
    const customFolders = new Map(
      Object.entries(customConfig.folderMap).map(([prefix, config]) => [
        normalizeFolderPrefixKey(prefix),
        config,
      ]),
    );

    shadowed.push(
      ...publicPaths.publicFolders.filter((entry) => {
        const customEntry = customFolders.get(entry);

        // No folderMap entry for this prefix — nothing shadows it.
        if (customEntry === undefined) {
          return false;
        }

        // From here on the declaration IS shadowed (the folderMap entry
        // wins); what's left to decide is whether that looks intentional
        // or like the usual accidental duplication worth warning about.

        // A publicFolders declaration would mount clientRoot/<prefix> with
        // immutable detection off. The one legitimate reason to also define
        // the same prefix in folderMap is to change that: point at the SAME
        // directory and turn detection ON (the declaration stays for the
        // check:public-assets drift script). Only that combination is
        // treated as intentional and skipped.
        const customPath =
          typeof customEntry === 'string' ? customEntry : customEntry.path;
        const declaredPath = path.join(clientRootDir, ...entry.split('/'));
        const isSameDirectory =
          resolveRealPath(customPath) === resolveRealPath(declaredPath);
        const doesEnableDetection =
          typeof customEntry !== 'string' &&
          customEntry.detectImmutableAssets === true;

        // Everything else warns: a different directory is a real conflict,
        // and a same-directory entry that changes nothing (plain string, or
        // detection omitted/false) is duplication with no effect.
        return !(isSameDirectory && doesEnableDetection);
      }),
    );
  }

  return shadowed;
}

/**
 * Verify every declared `publicFiles` file and `publicFolders` directory
 * actually exists in the client build dir, throwing a single error that lists
 * everything missing.
 *
 * Without this, a typo or a bad build is invisible: StaticContentCache
 * returns `not-found` for a path that isn't a file and the request falls
 * through to the SSR 404. A boot-time failure is the loud alternative.
 *
 * @param publicPaths - Normalized `publicFiles`/`publicFolders` entries
 * @param clientRootDir - Absolute path of the client build root
 * @param appLabel - App identifier used in error messages
 */
export async function assertPublicPathsExist(
  publicPaths: NormalizedPublicPaths,
  clientRootDir: string,
  appLabel: string,
): Promise<void> {
  // Collect every problem before throwing so one boot failure reports the
  // whole list, instead of fix-one-rebuild-discover-the-next loop.
  const missing: string[] = [];

  // publicFiles: each declared URL path must exist as a file
  for (const urlPath of publicPaths.publicFiles ?? []) {
    // Split on '/' and rejoin with path.join so the URL path maps to the
    // right separators on any platform. Entries were already validated
    // (leading slash, no '..' or backslashes), so this can't escape the root.
    const filePath = path.join(clientRootDir, ...urlPath.split('/'));

    try {
      const stat = await fs.promises.stat(filePath);

      // A directory at a publicFiles path is a declaration mistake (should be
      // publicFolders), and StaticContentCache would return not-found for it
      // anyway — call it out instead of reporting it as merely missing.
      if (!stat.isFile()) {
        missing.push(`${urlPath} (exists but is not a file)`);
      }
    } catch {
      // stat failed — treat any error (ENOENT, EACCES, ...) as missing, since
      // the server won't be able to serve it either way.
      missing.push(urlPath);
    }
  }

  // publicFolders: each declared URL prefix must exist as a directory
  for (const urlPrefix of publicPaths.publicFolders ?? []) {
    const folderPath = path.join(clientRootDir, ...urlPrefix.split('/'));

    try {
      const stat = await fs.promises.stat(folderPath);

      // The mirror of the file check above: a file at a publicFolders prefix
      // belongs in publicFiles instead.
      if (!stat.isDirectory()) {
        missing.push(`${urlPrefix} (exists but is not a directory)`);
      }
    } catch {
      // Tag folder entries so the combined error message distinguishes a
      // missing folder from a missing file with the same-looking path.
      missing.push(`${urlPrefix} (folder)`);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `publicFiles/publicFolders for ${appLabel} declare paths that do not exist in the client build dir (${clientRootDir}):\n` +
        missing.map((m) => `  - ${m}`).join('\n') +
        `\nEither remove the entries or ensure the paths exist in the app's public/ directory and rebuild. ` +
        `If a custom staticContentRouter entry intentionally serves one of these URLs from another directory, remove the duplicate publicFiles/publicFolders declaration instead.`,
    );
  }
}

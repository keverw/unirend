import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { InlineConfig, Plugin, UserConfig } from 'vite';

/**
 * Per-app Vite dep-optimizer cache directories.
 *
 * When a project runs several apps out of one repo, each app gets its own Vite
 * instance but they all resolve the same default `cacheDir`. Vite derives that
 * default by walking up from `root` to the nearest `package.json` and using
 * `<pkgDir>/node_modules/.vite`, so apps that share a repo (and therefore a
 * root `package.json`) share one `deps/` directory even though each has a
 * different entry graph.
 *
 * That directory is not shared-safe. Every optimizer run rewrites `deps/` and
 * stamps a fresh `browserHash` into the URLs it serves, so whichever app
 * optimized last owns the cache and any page still holding an earlier app's
 * `?v=` hash fails with a 504 "Outdated Optimize Dep". It happens sequentially
 * too, not just when the apps run at once, which is why clearing the cache and
 * starting the apps in a different order never helps for long.
 *
 * Giving each app its own subdirectory removes the sharing. We nest under the
 * default `.vite` directory rather than beside it so existing `.gitignore`
 * entries and any "delete the Vite cache" habit keep working unchanged.
 *
 * This is applied from one place, `withUnirendViteConfig()`, so it lives in the
 * app's own Vite config rather than in whatever happens to start the app. That
 * covers plain `vite` and `vite build` as well as Unirend's SSR dev server,
 * since that server loads the app's config file and its plugins along with it.
 * A `cacheDir` the project sets for itself still wins.
 *
 * ## How the directory gets its name
 *
 * Four rules, in order, each one a fallback for the last:
 *
 * 1. The project passed an `appKey`. That name is used as written, because the
 *    project chose it and owns keeping it unique. `{ appKey: 'ssg' }` gives
 *    `node_modules/.vite/ssg`.
 * 2. It didn't. Then the name is derived from *where the app lives*, which for
 *    apps in their own folders is the thing guaranteed to differ. The app's
 *    `root` relative to its package becomes the key, so an app at
 *    `<repo>/demos/ssg` keys on `demos/ssg` and gets
 *    `node_modules/.vite/demos_ssg-28600e64`.
 * 3. `root` couldn't answer, because several apps share one folder and are told
 *    apart only by which config file they load. Then the config file's own path
 *    becomes the key, since those are distinct by construction.
 *
 * 4. Nothing identifies the app. It uses `__unidentified__`, keeping every
 *    Unirend-managed cache beneath `.vite` rather than using `.vite` directly.
 *    Several apps in this position still need distinct `appKey` values.
 *
 * That second name is two parts and it helps to read them separately:
 *
 * ```text
 *   demos_ssg-28600e64
 *   └───┬───┘ └───┬──┘
 *  readability  uniqueness
 * ```
 *
 * The suffix is a digest of the key and is what actually prevents collisions.
 * The prefix is cosmetic, present only so someone looking at a directory of
 * caches can tell which app each one belongs to. It cannot carry uniqueness on
 * its own because a directory name cannot contain `/`: flattening the separator
 * maps `demos/ssg`, `demos_ssg`, and `demos ssg` onto one string, so a prefix
 * alone would put unrelated apps back in a shared directory. Dropping the
 * prefix and keeping only the digest would be equally correct, just harder to
 * work with by hand.
 *
 * A key that is already a valid directory name skips all of that and is used
 * as-is, which is why an `appKey` never picks up a digest.
 */

const CACHE_DIR_SEGMENT_SAFE = /^[A-Za-z0-9._-]+$/;

// Keep the fallback cache inside Vite's normal cache directory, even when an
// app did not provide enough information to derive a unique name. This avoids
// mixing Unirend-managed files with Vite's bare default cache. It cannot make
// several unidentified apps distinct, so those apps must pass appKey values.
const DEFAULT_APP_CACHE_KEY = '__unidentified__';

/**
 * Characters the sanitizer replaces. Deliberately stricter than
 * {@link CACHE_DIR_SEGMENT_SAFE}, which permits a dot: a key kept verbatim may
 * contain dots (`app-b.v2` is a fine directory name), but a key being
 * transformed must come out with none.
 *
 * That is because Windows applies its device-name rule to the part before the
 * first dot, so appending a digest does not rescue a reserved name that has one
 * of its own. `nul.cache` would become `nul.cache-3a3e779a`, whose leading
 * segment is still `nul`, and it would still fail to be created. Dropping every
 * dot leaves the digest inside a single segment, so the result is always an
 * ordinary directory name.
 */
const CACHE_DIR_SANITIZE_CHAR = /[^A-Za-z0-9_-]/g;

/**
 * At least one letter or digit, which is what makes a name identify an app to
 * someone reading it. Applied both to a key being kept verbatim and to the
 * prefix left after sanitizing, so `-`, `__`, and `///` all end up on the same
 * fallback instead of becoming directories that name nothing.
 */
const CACHE_DIR_HAS_READABLE_CHAR = /[A-Za-z0-9]/;

/**
 * How long a key may be and still be used as the directory name unchanged.
 *
 * Filesystems cap a single path component at 255 bytes, and a key over that
 * limit would not fail here but later, when Vite tries to create the optimizer
 * cache in a directory that cannot exist. The bound is well under 255 so the
 * `.vite` listing stays readable and the whole path keeps room to grow, which
 * costs nothing: a key past it still works, it just arrives as the sanitized
 * form, which is capped at 32 characters plus a digest and so is always
 * shorter. Counted in characters rather than bytes because
 * {@link CACHE_DIR_SEGMENT_SAFE} admits ASCII only, where the two are equal.
 */
const MAX_VERBATIM_CACHE_DIR_NAME_LENGTH = 64;

/**
 * Names Windows reserves for character devices. They are reserved with or
 * without an extension, so `con` and `con.cache` are both refused, and the
 * match is case-insensitive. Creating one fails rather than colliding, so a key
 * that spells one has to be transformed.
 */
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

/**
 * Whether a key can be used as a directory name exactly as written.
 *
 * Beyond the character set, two Windows rules matter, because a key that trips
 * either one stops being a faithful directory name and can quietly land two
 * apps in the same place:
 *
 * - A trailing dot is stripped, so `admin.` and `admin` are the same directory
 *   there and different ones everywhere else.
 * - A reserved device name cannot be created at all.
 *
 * Both are treated as unsafe so they go down the sanitize-and-digest path,
 * where the digest keeps them distinct from the key they would have collided
 * with.
 *
 * A key also has to be short enough to be a path component at all. Left
 * verbatim, one over the filesystem's 255-byte limit would not be caught here,
 * it would surface later as a failure to create the optimizer cache in a
 * directory that cannot exist.
 *
 * A key also has to contain at least one letter or digit. `.` and `..` are the
 * cases of that worth naming, since as a directory name they mean "here" and
 * "the parent" rather than a new subdirectory, but the rule covers the rest of
 * the punctuation-only keys for the same reason it covers a sanitized prefix
 * with nothing left in it: a name like `-` or `__` identifies no app to anyone
 * reading it, and `-` in particular reads as an option to anything later handed
 * the path on a command line.
 *
 * One collision this does not attempt to prevent: case. `Admin` and `admin` are
 * one directory on Windows and on a default macOS volume, two on Linux. Folding
 * that in would mean putting a digest on every key containing a capital letter,
 * including ordinary ones like `Marketing`, which costs readability for every
 * project to guard against a pair of app keys differing only in case. Pick keys
 * that differ by more than capitalization.
 */
function isSafeCacheDirName(key: string): boolean {
  return (
    CACHE_DIR_SEGMENT_SAFE.test(key) &&
    CACHE_DIR_HAS_READABLE_CHAR.test(key) &&
    key.length <= MAX_VERBATIM_CACHE_DIR_NAME_LENGTH &&
    !key.endsWith('.') &&
    !WINDOWS_RESERVED_NAME.test(key)
  );
}

/**
 * A filesystem-safe directory name for a cache key. See "How the directory gets
 * its name" at the top of this file for the two cases below in context.
 *
 * Keys are arbitrary user strings (an app key, or a path relative to the
 * package root), so they can contain path separators, `..`, or characters no
 * filesystem accepts. Keys that are already safe (the overwhelmingly common
 * case) are used verbatim so the directory on disk stays recognizable. Anything
 * else is sanitized and given a short digest suffix, because sanitizing alone
 * can map two distinct keys onto one name and would reintroduce exactly the
 * sharing this exists to prevent.
 *
 * The digest covers the original key rather than the sanitized form, which is
 * the whole point: the sanitized form is what lost the distinction.
 *
 * "Safe" is more than the character set, since `.`, `..`, a trailing dot, and
 * the Windows device names are all spelled with safe characters yet do not name
 * a new subdirectory. See {@link isSafeCacheDirName} for each case. Appending
 * `-<digest>` is what rescues them: it lands past whatever made the bare key
 * unusable, so the result is an ordinary directory name again.
 */
export function cacheDirNameForKey(key: string): string {
  if (isSafeCacheDirName(key)) {
    return key;
  }

  const digest = createHash('sha256').update(key).digest('hex').slice(0, 8);
  const sanitized = key.replace(CACHE_DIR_SANITIZE_CHAR, '_').slice(0, 32);

  // The prefix exists only to be read by a human, so it is worth nothing once
  // it holds no letters or digits: `///` sanitizes to `___`, which says less
  // than "app" does and is no more unique, since the digest carries all of
  // that. An empty key is the same case with nothing left at all, and there the
  // fallback also avoids a bare `-e3b0c442`, whose leading dash would read as
  // an option to anything later handed the path on a command line.
  const prefix = CACHE_DIR_HAS_READABLE_CHAR.test(sanitized)
    ? sanitized
    : 'app';

  return `${prefix}-${digest}`;
}

/**
 * Whether a path returned by `path.relative()` points outside the directory it
 * was resolved against.
 *
 * Testing the first two characters is not enough, because a directory may be
 * named with them: `..admin` is an ordinary folder, and rejecting it would drop
 * that app onto the shared unidentified cache, which is the sharing this file
 * exists to prevent. Only a `..` on its own or one followed by a separator is a
 * step upward.
 *
 * `path.sep` alone would cover both call sites, since `path.relative()` returns
 * the platform separator regardless of how its arguments were spelled: on
 * Windows it answers `..\sibling` even when given forward slashes. The forward
 * slash is checked as well so the answer does not depend on that, because this
 * file normalizes its keys to forward slashes and a caller handing one of those
 * back would otherwise read as inside the package on Windows.
 */
function isOutsidePackage(relative: string): boolean {
  return (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    relative.startsWith('../')
  );
}

/**
 * The nearest ancestor directory of `from` that contains a `package.json`, or
 * `null` when there is none. Mirrors how Vite locates the package a root
 * belongs to.
 */
function nearestPackageDir(from: string): string | null {
  let current = from;

  for (;;) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }

    const parent = path.dirname(current);

    if (!parent || parent === current) {
      return null;
    }

    current = parent;
  }
}

/**
 * The directory Vite would resolve `cacheDir` to when the project has not set
 * one: `node_modules/.vite` under the nearest ancestor package, else
 * `node_modules/.vite` under the root when that directory exists, else `.vite`
 * in the root. Kept in step with Vite's own resolution because the point is to
 * place per-app caches where the default cache would have gone.
 */
export function defaultViteCacheDir(resolvedRoot: string): string {
  const pkgDir = nearestPackageDir(resolvedRoot);

  if (pkgDir) {
    return path.join(pkgDir, 'node_modules', '.vite');
  }

  const nodeModulesDir = path.join(resolvedRoot, 'node_modules');

  return fs.existsSync(nodeModulesDir)
    ? path.join(nodeModulesDir, '.vite')
    : path.join(resolvedRoot, '.vite');
}

/**
 * Resolve the cache directory for one app, given the app's Vite `root` as
 * written in its config (Vite defaults an unset root to the cwd) and a key that
 * distinguishes it from the project's other apps.
 */
export function resolveAppCacheDir(
  root: string | undefined,
  key: string,
): string {
  const resolvedRoot = path.resolve(root ?? process.cwd());

  return path.join(defaultViteCacheDir(resolvedRoot), cacheDirNameForKey(key));
}

/**
 * Derive a cache key from an app's `root` for projects that didn't name one,
 * i.e. rule 2 in "How the directory gets its name" at the top of this file.
 *
 * `root` is used rather than the path to the Vite config file, which would be
 * the other obvious candidate. Vite does not resolve `configFile` before the
 * `config` hook runs, and leaves it `undefined` altogether when the config was
 * auto-discovered, which is exactly what the plain `vite` CLI does. So it is
 * unavailable in the case that needs it most.
 *
 * Returns the app's path relative to its package, which is stable across
 * working directories and distinct per app. Returns `null` when there is
 * nothing meaningful to derive:
 *
 * - No `root`, which means Vite will fall back to the cwd. A key derived from
 *   the cwd would name the same app differently depending on where the process
 *   started, and would name *different* apps identically when one server starts
 *   several of them from the repo root. Both are worse than doing nothing.
 * - A `root` that is the package directory itself, which is a single-app
 *   project where the default cache is already unshared.
 *
 * In both cases the caller falls through to the config-file key and then the
 * named unidentified cache. An app sharing that fallback with another app needs an
 * explicit `appKey` to get its own cache.
 *
 * A relative `root` is resolved against the cwd, as Vite resolves it, so an app
 * that sets one can land on a different key depending on where it was started.
 * That costs at most a second cache directory for the same app, never a shared
 * one, since two distinct keys can only come from two distinct directories. An
 * absolute `root` (`import.meta.dirname` or `__dirname`) avoids it, which is
 * why the scaffolded config uses one.
 */
export function cacheKeyFromRoot(root: string | undefined): string | null {
  if (!root) {
    return null;
  }

  const resolvedRoot = path.resolve(root);
  const pkgDir = nearestPackageDir(resolvedRoot);

  if (!pkgDir) {
    return null;
  }

  const relative = path.relative(pkgDir, resolvedRoot);

  // Empty means the root *is* the package directory (single-app project), and a
  // leading `..` segment means it sits outside the package, which
  // `nearestPackageDir` does not produce today but would make the key
  // meaningless if it ever did.
  if (!relative || isOutsidePackage(relative)) {
    return null;
  }

  // Normalize to forward slashes so a given app keys the same on Windows as it
  // does elsewhere. They are flattened into the directory name anyway, but the
  // separator is part of what gets hashed.
  return relative.split(path.sep).join('/');
}

/**
 * Derive a cache key from the app's Vite config file, for the case `root`
 * cannot answer: several apps in one folder told apart only by which config
 * they load, such as a `vite.config.ts` beside a `vite.marketing.config.ts`.
 * They share a `root`, so {@link cacheKeyFromRoot} has nothing to work with,
 * but the config files themselves are distinct by construction.
 *
 * Tried only after `root`, never instead of it. Vite leaves `configFile`
 * `undefined` when it discovered the config itself, which is what the plain
 * `vite` CLI does, so preferring it would key the same app differently
 * depending on how it was started. Coming last means the ordinary layout keeps
 * the `root`-derived key it already had in every mode, and this only fills in
 * where there was no root-derived key.
 *
 * The extension is dropped so the key does not turn on whether the project
 * writes `.ts` or `.mts`, and `configFile: false` is treated as absent, since
 * it means there is no config file rather than one named `false`.
 */
export function cacheKeyFromConfigFile(
  configFile: string | false | undefined,
): string | null {
  if (typeof configFile !== 'string' || !configFile) {
    return null;
  }

  const resolvedConfigFile = path.resolve(configFile);
  const pkgDir = nearestPackageDir(path.dirname(resolvedConfigFile));

  if (!pkgDir) {
    return null;
  }

  const relative = path.relative(pkgDir, resolvedConfigFile);

  if (!relative || isOutsidePackage(relative)) {
    return null;
  }

  const withoutExtension = relative.slice(
    0,
    relative.length - path.extname(relative).length,
  );

  return (withoutExtension || relative).split(path.sep).join('/');
}

/**
 * The plugin `withUnirendViteConfig()` injects, which gives the app its own
 * dep-optimizer cache directory. Uses the app key the project passed, and
 * otherwise derives one from `root`, then from the config file's own path.
 *
 * A plugin rather than a plain `cacheDir` value, because the key can depend on
 * `root`, and `root` is not knowable until Vite has merged the config. Vite
 * merges a `config` hook's return value *over* the user config, so the guard
 * below does the deferring explicitly: when the project set `cacheDir`, we
 * return nothing and leave that choice alone.
 */
export function viteConfigCacheDirPlugin(appKey: string | undefined): Plugin {
  return {
    name: 'unirend:per-app-cache-dir',
    config(config: UserConfig) {
      // The project picked a location itself, so there is nothing to decide.
      if (config.cacheDir) {
        return;
      }

      // Rules 1, 2, 3, then 4. A blank key counts as no key: it is a mistake
      // rather than a choice, and taking it literally would name the directory
      // after its digest alone ("-e3b0c442"), which is both ugly and shared by
      // every app that made the same mistake.
      const trimmedAppKey = appKey?.trim();

      // The hook's parameter is declared as `UserConfig`, but what Vite passes
      // is the merged inline config, where `configFile` is the path it was
      // given (and `undefined` when it discovered the config itself).
      // `InlineConfig` is that same shape with the field declared.
      const { configFile } = config as InlineConfig;

      const key =
        trimmedAppKey ||
        cacheKeyFromRoot(config.root) ||
        cacheKeyFromConfigFile(configFile) ||
        DEFAULT_APP_CACHE_KEY;

      return { cacheDir: resolveAppCacheDir(config.root, key) };
    },
  };
}

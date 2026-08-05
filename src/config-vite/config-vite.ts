import { mergeConfig } from 'vite';
import type { UserConfig } from 'vite';
import { viteConfigCacheDirPlugin } from '../lib/internal/vite-cache-dir';

export const UNIREND_VITE_DEDUPE_PACKAGES = [
  'react',
  'react-dom',
  'react-router',
] as const;

export const UNIREND_VITE_NO_EXTERNAL_PACKAGES = ['unirend'] as const;

type DedupeConfig = NonNullable<UserConfig['resolve']>['dedupe'];
type NoExternalConfig = NonNullable<UserConfig['ssr']>['noExternal'];

function mergeDedupeConfig(dedupe: DedupeConfig): string[] {
  // mergeConfig() combines arrays, so the Unirend defaults may already be
  // present here. Normalize to one stable dedupe list so the final config is
  // easy to inspect and user-added entries stay appended.
  return Array.from(
    new Set([...UNIREND_VITE_DEDUPE_PACKAGES, ...(dedupe ?? [])]),
  );
}

function mergeNoExternalConfig(noExternal: NoExternalConfig): NoExternalConfig {
  if (noExternal === true) {
    return true;
  }

  const userNoExternal = Array.isArray(noExternal)
    ? noExternal
    : noExternal
      ? [noExternal]
      : [];

  // Like dedupe, mergeConfig() can leave duplicated defaults here. Keep one
  // stable list while preserving user-added entries.
  return Array.from(
    new Set([...UNIREND_VITE_NO_EXTERNAL_PACKAGES, ...userNoExternal]),
  );
}

/**
 * Options for {@link withUnirendViteConfig}.
 */
export interface UnirendViteConfigOptions {
  /**
   * A name for this app, unique within the project.
   *
   * Used to give the app its own Vite dep-optimizer cache directory
   * (`node_modules/.vite/<appKey>`) instead of the single default one that
   * every app in a repo would otherwise share. Sharing that directory makes
   * each app's optimizer run invalidate the others', which surfaces in the
   * browser as `504 (Outdated Optimize Dep)` on a dependency URL.
   *
   * When omitted, a key is derived from the app's `root`, then from the path
   * of its Vite config file. If neither identifies the app, Unirend uses its
   * named unidentified cache. Between them those cover apps in their own folders
   * and apps sharing a folder while loading different configs, so a key is
   * usually only worth passing to get a tidier directory name than the derived
   * one. Apps that would otherwise use the same named unidentified cache need
   * distinct keys. Set `cacheDir` yourself to opt out of all of this and pick
   * the location directly.
   *
   * A plain lowercase name is used as the directory name verbatim. A key that
   * is not usable as one, whether because of a path separator or a Windows rule
   * such as a trailing dot or a reserved device name like `con`, is flattened
   * and given a short digest suffix so it stays distinct from the key it would
   * otherwise have collided with. Two keys differing only in capitalization are
   * not distinguished, since a default macOS or Windows volume treats them as
   * one directory regardless.
   */
  appKey?: string;
}

/**
 * Apply the Vite config defaults unirend expects for React SSR/SSG projects.
 *
 * These defaults configure Vite to avoid externalizing Unirend during SSR and
 * dedupe React, React DOM, and React Router so SSR/SSG rendering uses the same
 * package instances and avoids split router contexts. They also give the app
 * its own dep-optimizer cache directory so several apps in one repo don't
 * overwrite each other's optimized dependencies (see
 * {@link UnirendViteConfigOptions.appKey}).
 */
export function withUnirendViteConfig(
  config: UserConfig = {},
  options: UnirendViteConfigOptions = {},
): UserConfig {
  const mergedConfig: UserConfig = mergeConfig(
    {
      resolve: {
        dedupe: [...UNIREND_VITE_DEDUPE_PACKAGES],
      },
      ssr: {
        noExternal: [...UNIREND_VITE_NO_EXTERNAL_PACKAGES],
      },
      // mergeConfig() concatenates arrays defaults-first, so this lands ahead
      // of the project's own plugins without reordering them. Position doesn't
      // affect the outcome anyway: the plugin only reads config and defers to
      // any `cacheDir` already set.
      plugins: [viteConfigCacheDirPlugin(options.appKey)],
    },
    config,
  );

  const dedupe = mergeDedupeConfig(mergedConfig.resolve?.dedupe);
  const noExternal = mergeNoExternalConfig(mergedConfig.ssr?.noExternal);

  return {
    ...mergedConfig,
    resolve: {
      ...mergedConfig.resolve,
      dedupe,
    },
    ssr: {
      ...mergedConfig.ssr,
      noExternal,
    },
  };
}

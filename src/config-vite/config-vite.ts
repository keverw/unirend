import { mergeConfig } from 'vite';
import type { UserConfig } from 'vite';

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
 * Apply the Vite config defaults unirend expects for React SSR/SSG projects.
 *
 * These defaults configure Vite to avoid externalizing Unirend during SSR and
 * dedupe React, React DOM, and React Router so SSR/SSG rendering uses the same
 * package instances and avoids split router contexts.
 */
export function withUnirendViteConfig(config: UserConfig = {}): UserConfig {
  const mergedConfig: UserConfig = mergeConfig(
    {
      resolve: {
        dedupe: [...UNIREND_VITE_DEDUPE_PACKAGES],
      },
      ssr: {
        noExternal: [...UNIREND_VITE_NO_EXTERNAL_PACKAGES],
      },
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

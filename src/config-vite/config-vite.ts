import { mergeConfig } from 'vite';
import type { UserConfig } from 'vite';

export const UNIREND_VITE_DEDUPE_PACKAGES = [
  'react',
  'react-dom',
  'react-router',
] as const;

/**
 * Apply the Vite config defaults unirend expects for React SSR/SSG projects.
 *
 * Today this ensures Vite SSR and build flows dedupe the core React packages
 * that must remain singletons across the app and router contexts.
 */
export function withUnirendViteConfig(config: UserConfig = {}): UserConfig {
  const mergedConfig: UserConfig = mergeConfig(
    {
      resolve: {
        dedupe: [...UNIREND_VITE_DEDUPE_PACKAGES],
      },
    },
    config,
  );

  const userDedupe = mergedConfig.resolve?.dedupe ?? [];

  // mergeConfig() combines arrays, so the Unirend defaults may already be
  // present here. Normalize to one stable dedupe list so the final config is
  // easy to inspect and user-added entries stay appended.
  const dedupe: string[] = Array.from(
    new Set([...UNIREND_VITE_DEDUPE_PACKAGES, ...userDedupe]),
  );

  return {
    ...mergedConfig,
    resolve: {
      ...mergedConfig.resolve,
      dedupe,
    },
  };
}

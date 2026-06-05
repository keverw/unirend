import { vfsWriteIfNotExists } from '../../vfs';
import type { FileRoot } from '../../vfs';
import type { LoggerFunction } from '../../types';

/**
 * Source for a Vite app's `components/theme/ThemeProvider.tsx`.
 *
 * Static and byte-identical across the Vite-based templates (SSG, SSR), so it
 * lives in `templates-shared/react-components/`. Wraps the app tree and
 * manages theme state: seeds preference from request context (SSR middleware /
 * SSG build-time), syncs with the cookie on mount, tracks OS-level dark/light
 * changes via `matchMedia`, toggles the `dark` class on `<html>`, cycles the
 * preference cookie on demand, and cross-tab syncs via `BroadcastChannel`.
 * The API template doesn't ship one — it has no client-side rendering.
 */
const fileSrc = `import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRequestContextValue, useDomainInfo, UnirendHead } from 'unirend/client';
import {
  ThemeContext,
  type ThemePreference,
  type ResolvedTheme,
} from './context';

const CYCLE: ThemePreference[] = ['auto', 'dark', 'light'];

// Evaluated once when the module loads on the client; null on the server (no window)
const darkMQ =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null;

export function ThemeProvider({ children }: { children: ReactNode }) {
  // preference is seeded from requestContext (SSG build-time or SSR middleware)
  const [preference, setContextPref] =
    useRequestContextValue<ThemePreference>('themePreference');
  // ref is shared between cycleTheme (sender) and the BroadcastChannel effect (receiver)
  const channelRef = useRef<BroadcastChannel | null>(null);

  // useDomainInfo() gives us the root domain for subdomain-spanning cookies.
  // Available in SSR (always) and SSG (when hostname is configured at build time).
  // Returns null otherwise — cookie is then scoped to the current host, which is fine.
  const domainInfo = useDomainInfo();

  // systemTheme always defaults to 'light' on the server (window.matchMedia isn't available
  // during SSR/SSG). The client reads matchMedia immediately via the lazy initializer.
  // We don't render conditional JSX based on resolvedTheme, so the server/client
  // difference doesn't cause a hydration mismatch — the effect only toggles a class.
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    darkMQ?.matches ? 'dark' : 'light',
  );

  // On mount, reconcile cookie with the server-seeded context value. The cookie is always
  // the most up-to-date source — SSG bakes the context at build time, and even SSR reads
  // it at request time so a change in another tab mid-request can leave them out of sync.
  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\\s*)themePreference=([^;]+)/);
    const val = match?.[1] as ThemePreference | undefined;
    const valid: ThemePreference[] = ['light', 'dark', 'auto'];

    if (val && valid.includes(val) && val !== preference) {
      setContextPref(val);
    }
  }, [preference, setContextPref]);

  // Subscribe to OS-level dark/light preference changes (e.g. user switches system theme)
  useEffect(() => {
    if (!darkMQ) {
      return;
    }

    function handler(e: MediaQueryListEvent) {
      setSystemTheme(e.matches ? 'dark' : 'light');
    }

    darkMQ.addEventListener('change', handler);
    return () => darkMQ.removeEventListener('change', handler);
  }, []);

  // Missing or 'auto' preferences follow the OS theme.
  const resolvedTheme: ResolvedTheme =
    preference && preference !== 'auto' ? preference : systemTheme;

  const cycleTheme = () => {
    const next =
      CYCLE[(CYCLE.indexOf(preference ?? 'auto') + 1) % CYCLE.length];

    document.cookie = [
      \`themePreference=\${next}\`,
      'path=/',
      \`max-age=\${60 * 60 * 24 * 365}\`,
      domainInfo?.rootDomain ? \`domain=.\${domainInfo.rootDomain}\` : null,
    ]
      .filter(Boolean)
      .join('; ');

    // Notify other same-origin tabs
    channelRef.current?.postMessage({ themePreference: next });
    setContextPref(next);
  };

  // Single BroadcastChannel instance for cross-tab sync
  useEffect(() => {
    if (typeof BroadcastChannel !== 'function') {
      return;
    }

    const channel = new BroadcastChannel('theme');
    channelRef.current = channel;

    channel.onmessage = (
      e: MessageEvent<{ themePreference?: ThemePreference }>,
    ) => {
      if (e.data?.themePreference) {
        setContextPref(e.data.themePreference);
      }
    };

    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [setContextPref]);

  // Re-read cookie when tab becomes visible — catches changes made in other tabs or
  // subdomains while this tab was in the background. Intentionally does NOT broadcast
  // so we don't loop back to tabs that already made the change.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      const match = document.cookie.match(/(?:^|;\\s*)themePreference=([^;]+)/);
      const val = match?.[1] as ThemePreference | undefined;
      const valid: ThemePreference[] = ['light', 'dark', 'auto'];

      if (val && valid.includes(val)) {
        setContextPref(val);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () =>
      document.removeEventListener('visibilitychange', handleVisibility);
  }, [setContextPref]);

  return (
    <ThemeContext.Provider
      value={{
        preference: preference ?? 'auto',
        systemTheme,
        resolvedTheme,
        cycleTheme,
      }}
    >
      <UnirendHead>
        {/* eslint-disable-next-line jsx-a11y/html-has-lang */}
        <html className={resolvedTheme === 'dark' ? 'dark' : ''} />
      </UnirendHead>
      {children}
    </ThemeContext.Provider>
  );
}
`;

/**
 * Ensure a Vite app's `components/theme/ThemeProvider.tsx` exists at
 * `${projectPath}/components/theme/ThemeProvider.tsx`.
 * Only creates the file if it doesn't exist - never overwrites.
 *
 * @param root - File root (filesystem path or in-memory object)
 * @param projectPath - Relative path to the project directory (e.g. "src/apps/my-app")
 * @param log - Optional logger function for output
 * @throws {Error} If file creation fails
 */
export async function ensureAppThemeProvider(
  root: FileRoot,
  projectPath: string,
  log?: LoggerFunction,
): Promise<void> {
  const relPath = `${projectPath}/components/theme/ThemeProvider.tsx`;

  try {
    const didWrite = await vfsWriteIfNotExists(root, relPath, fileSrc);

    if (didWrite && log) {
      log('info', `Created ${relPath}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to ensure ${relPath}: ${errorMessage}`);
  }
}

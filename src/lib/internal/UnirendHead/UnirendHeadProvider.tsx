import type { ReactNode } from 'react';
import { UnirendHeadContext } from './context';
import type { HeadCollector } from './context';

/**
 * Wraps the app tree to enable UnirendHead on both server and client.
 *
 * Server: pass a collector object — UnirendHead will push entries into it
 * during renderToString, then the caller reads the collected data.
 *
 * Client: pass null — UnirendHead renders the actual <title>/<meta>/<link>
 * tags and React 19 hoists them to <head> automatically.
 */
export function UnirendHeadProvider({
  children,
  collector,
}: {
  children: ReactNode;
  collector: HeadCollector | null;
}) {
  return (
    <UnirendHeadContext.Provider value={collector}>
      {children}
    </UnirendHeadContext.Provider>
  );
}
